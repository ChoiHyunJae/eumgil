import * as admin from "firebase-admin";
import {GeoPoint, Timestamp} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/v2/https";
import {Escort, EscortStatus, GuideStats, UserProfile} from "../types";
import {
  GuideCandidate,
  ListReceivedEscortRequestsInput,
  ListReceivedEscortRequestsOutput,
  RequestEscortInput,
  RequestEscortOutput,
  RespondToRequestInput,
  RespondToRequestOutput,
  SearchGuidesInput,
  SearchGuidesOutput,
} from "./types";

/**
 * matching 모듈 — 위치 스냅샷 기반 안내자 탐색, 동행 요청 생성/응답.
 * Slice 6(Issue #8): searchGuides, requestEscort, respondToRequest.
 * Slice 10(Issue #12): searchGuides 정렬 고도화(만족도→성사율→거리).
 *
 * escort 생명주기(MeetingConfirmed 이후)는 escort 모듈이 담당한다.
 */

/** US#18: 매칭 노출 반경(1km). 동네 지식 노출 반경(3km)보다 좁다. */
const MATCH_RADIUS_M = 1000;

/**
 * US#21: 받은 요청 이력이 0건(또는 미존재)이면 신규 안내자.
 * 신규 안내자는 만족도/성사율 정렬을 건너뛰고 거리 기준만 적용한다.
 *
 * @param {GuideStats} stats 안내자 통계.
 * @return {boolean} 신규 안내자면 true.
 */
function isNewGuide(stats: GuideStats): boolean {
  return (stats.totalRequestsReceived ?? 0) === 0;
}

/**
 * US#21,#38: 정렬 1순위로 쓰는 만족도 평균(null-safe).
 * 평가 데이터(ratedEscortCount>=1 && averageSatisfaction이 number)가 있으면
 * 그 값을, 없으면 0을 반환해 정렬이 깨지지 않게 한다.
 *
 * @param {GuideStats} stats 안내자 통계.
 * @return {number} 정렬용 만족도 값.
 */
function effectiveSatisfaction(stats: GuideStats): number {
  if (
    (stats.ratedEscortCount ?? 0) >= 1 &&
    typeof stats.averageSatisfaction === "number"
  ) {
    return stats.averageSatisfaction;
  }
  return 0;
}

/**
 * US#21: 정렬 2순위로 쓰는 성사율(완료/받은요청). 받은 요청이 0이면 0.
 *
 * @param {GuideStats} stats 안내자 통계.
 * @return {number} 0~1 성사율.
 */
function successRate(stats: GuideStats): number {
  const total = stats.totalRequestsReceived ?? 0;
  if (total < 1) return 0;
  return (stats.completedEscortCount ?? 0) / total;
}

/**
 * 기존 안내자 정렬 비교: 만족도 내림차순 → 성사율 내림차순 → 거리 오름차순.
 *
 * @param {GuideCandidate} a 후보 A.
 * @param {GuideCandidate} b 후보 B.
 * @return {number} 정렬 비교값.
 */
function compareExistingGuides(a: GuideCandidate, b: GuideCandidate): number {
  const satA = effectiveSatisfaction(a.guide.guideStats);
  const satB = effectiveSatisfaction(b.guide.guideStats);
  if (satA !== satB) return satB - satA;
  const srA = successRate(a.guide.guideStats);
  const srB = successRate(b.guide.guideStats);
  if (srA !== srB) return srB - srA;
  return a.distanceM - b.distanceM;
}

/** US#25: 동행 요청 응답 기한(48시간). */
const REQUEST_TTL_MS = 48 * 60 * 60 * 1000;

/** 신규 요청을 막아야 하는 "진행 중" escort 상태. */
const ACTIVE_ESCORT_STATUSES: EscortStatus[] = [
  "Requested",
  "Accepted",
  "MeetingConfirmed",
];

/**
 * 두 좌표 사이의 거리(미터)를 Haversine 공식으로 계산한다.
 *
 * @param {number} lat1 기준 위도.
 * @param {number} lng1 기준 경도.
 * @param {number} lat2 대상 위도.
 * @param {number} lng2 대상 경도.
 * @return {number} 두 좌표 사이의 거리(미터).
 */
function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const earthRadiusM = 6371000;
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const cosLat1 = Math.cos(toRad(lat1));
  const cosLat2 = Math.cos(toRad(lat2));
  const a = sinLat * sinLat + cosLat1 * cosLat2 * sinLng * sinLng;
  return earthRadiusM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * matchBlockedUntil이 현재 시점보다 미래이면 매칭이 제한된 상태다.
 *
 * @param {Timestamp | null | undefined} until 매칭 제한 만료 시각.
 * @param {Timestamp} now 비교 기준 현재 시각.
 * @return {boolean} 현재 매칭이 제한되어 있으면 true.
 */
function isMatchBlocked(
  until: Timestamp | null | undefined,
  now: Timestamp
): boolean {
  return until != null && until.toMillis() > now.toMillis();
}

/**
 * US#17~21: "현재 위치로 검색" 시점 좌표 기준 반경 1km 승인 안내자 탐색.
 * 후보 조건: guideApproved===true, guideLocation 존재, 매칭 비제한, 호출자 본인 제외,
 * 반경 1km 이내. 거리 오름차순 정렬(만족도/성사율 정렬은 Slice 10에서 적용).
 */
export const searchGuides = onCall<
  SearchGuidesInput, Promise<SearchGuidesOutput>
>(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }

  const {location} = request.data;
  if (
    !location ||
    typeof location.lat !== "number" ||
    typeof location.lng !== "number"
  ) {
    throw new HttpsError("invalid-argument", "위치 좌표가 필요합니다.");
  }

  const uid = request.auth.uid;
  const now = Timestamp.now();
  const snap = await admin
    .firestore()
    .collection("users")
    .where("guideApproved", "==", true)
    .get();

  const candidates: GuideCandidate[] = [];
  for (const doc of snap.docs) {
    if (doc.id === uid) {
      continue; // 호출자 본인 제외
    }
    const guide: UserProfile = {
      id: doc.id,
      ...(doc.data() as Omit<UserProfile, "id">),
    };
    const loc = guide.guideLocation;
    if (!loc || typeof loc.lat !== "number" || typeof loc.lng !== "number") {
      continue; // 위치 미등록 안내자 제외
    }
    if (isMatchBlocked(guide.matchBlockedUntil, now)) {
      continue; // 매칭 제한 중 제외
    }
    const distanceM = haversineMeters(
      location.lat,
      location.lng,
      loc.lat,
      loc.lng
    );
    if (distanceM > MATCH_RADIUS_M) {
      continue;
    }
    candidates.push({
      guide,
      distanceM,
      isNewGuide: isNewGuide(guide.guideStats),
    });
  }

  // Slice 10: 기존 안내자(요청 1건 이상)는 만족도→성사율→거리로 정렬하고,
  // 신규 안내자(요청 0건)는 ①②를 건너뛰고 거리순으로 정렬해 뒤에 둔다.
  const existing = candidates
    .filter((c) => !c.isNewGuide)
    .sort(compareExistingGuides);
  const fresh = candidates
    .filter((c) => c.isNewGuide)
    .sort((a, b) => a.distanceM - b.distanceM);

  return {candidates: [...existing, ...fresh]};
});

/**
 * US#23,#25: 탐방자 → 안내자 단방향 동행 요청 생성(escorts Requested 문서).
 * 본인에게 요청 불가, 미승인/매칭제한 안내자 요청 불가, 같은 쌍의 진행 중
 * (Requested/Accepted/MeetingConfirmed) 요청이 있으면 중복 요청 금지.
 */
export const requestEscort = onCall<
  RequestEscortInput, Promise<RequestEscortOutput>
>(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }

  const {guideId} = request.data;
  if (!guideId) {
    throw new HttpsError("invalid-argument", "guideId가 필요합니다.");
  }

  const travelerId = request.auth.uid;
  if (guideId === travelerId) {
    throw new HttpsError(
      "invalid-argument",
      "자기 자신에게 동행을 요청할 수 없습니다."
    );
  }

  const db = admin.firestore();
  const guideSnap = await db.collection("users").doc(guideId).get();
  if (!guideSnap.exists) {
    throw new HttpsError("not-found", "안내자를 찾을 수 없습니다.");
  }
  const guide = guideSnap.data() as Omit<UserProfile, "id">;
  if (!guide.guideApproved) {
    throw new HttpsError("failed-precondition", "승인된 안내자가 아닙니다.");
  }

  const now = Timestamp.now();
  if (isMatchBlocked(guide.matchBlockedUntil, now)) {
    throw new HttpsError(
      "failed-precondition",
      "현재 매칭이 제한된 안내자입니다."
    );
  }

  // AC8 / CONTEXT 불변규칙: 매칭 제한 기간 중인 탐방자 본인은 새 동행 요청을
  // 생성할 수 없다. 대상 안내자의 차단과 별개로 호출자 본인의 차단도 검사한다.
  const travelerSnap = await db.collection("users").doc(travelerId).get();
  const traveler = travelerSnap.data() as Omit<UserProfile, "id"> | undefined;
  if (traveler && isMatchBlocked(traveler.matchBlockedUntil, now)) {
    throw new HttpsError(
      "failed-precondition",
      "매칭이 제한된 상태에서는 동행을 요청할 수 없습니다."
    );
  }

  // 같은 (traveler, guide) 쌍의 진행 중 요청 여부를 메모리에서 판정한다
  // (등식 2개만 사용해 복합 색인 불필요).
  const existing = await db
    .collection("escorts")
    .where("travelerId", "==", travelerId)
    .where("guideId", "==", guideId)
    .get();
  const hasActive = existing.docs.some((d) =>
    ACTIVE_ESCORT_STATUSES.includes((d.data() as Escort).status)
  );
  if (hasActive) {
    throw new HttpsError(
      "already-exists",
      "이미 진행 중인 동행 요청이 있습니다."
    );
  }

  const ref = db.collection("escorts").doc();
  const requestExpiresAt = Timestamp.fromMillis(
    now.toMillis() + REQUEST_TTL_MS
  );
  const stored: Omit<Escort, "id"> = {
    guideId,
    travelerId,
    status: "Requested",
    requestedAt: now,
    respondedAt: null,
    requestExpiresAt,
    meetingLocation: null,
    meetingTime: null,
    cancelledBy: null,
    cancelledAt: null,
    isSameDayCancellation: null,
    noShowBy: [],
    guideArrivalConfirmedAt: null,
    travelerArrivalConfirmedAt: null,
    midTerminatedBy: null,
    midTerminatedAt: null,
    guideCompletedAt: null,
    travelerCompletedAt: null,
    satisfactionRating: null,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(stored);

  return {
    escortId: ref.id,
    requestExpiresAt: requestExpiresAt.toDate().toISOString(),
  };
});

/**
 * US#24,#26: 안내자가 들어온 요청에 수락/거절한다.
 * 호출자는 해당 요청의 guideId와 일치해야 하며 현재 상태가 Requested여야 한다.
 * 만료된 요청은 Expired로 전환하고 거부한다. 거절 시 Rejected, 수락 시에는
 * 만남 장소·시간이 필수이며 곧바로 MeetingConfirmed로 전환한다.
 */
export const respondToRequest = onCall<
  RespondToRequestInput,
  Promise<RespondToRequestOutput>
>(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }

  const {escortId, accept, meetingLocation, meetingTime} = request.data;
  if (!escortId) {
    throw new HttpsError("invalid-argument", "escortId가 필요합니다.");
  }

  const db = admin.firestore();
  const ref = db.collection("escorts").doc(escortId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "동행 요청을 찾을 수 없습니다.");
  }

  const escort = snap.data() as Omit<Escort, "id">;
  if (escort.guideId !== request.auth.uid) {
    throw new HttpsError(
      "permission-denied",
      "요청 대상 안내자만 응답할 수 있습니다."
    );
  }
  if (escort.status !== "Requested") {
    throw new HttpsError("failed-precondition", "이미 처리된 요청입니다.");
  }

  const now = Timestamp.now();
  if (escort.requestExpiresAt.toMillis() <= now.toMillis()) {
    await ref.update({status: "Expired", updatedAt: now});
    throw new HttpsError("failed-precondition", "요청이 만료되었습니다.");
  }

  if (!accept) {
    await ref.update({status: "Rejected", respondedAt: now, updatedAt: now});
    return {status: "Rejected"};
  }

  // AC8 / CONTEXT 불변규칙: 매칭 제한 기간 중인 안내자 본인은 요청을 수락할 수
  // 없다. 거절(위 분기)은 허용하되, 수락 경로에서만 호출자의 차단을 검사한다.
  const guideSnap = await db.collection("users").doc(escort.guideId).get();
  const guideProfile = guideSnap.data() as Omit<UserProfile, "id"> | undefined;
  if (guideProfile && isMatchBlocked(guideProfile.matchBlockedUntil, now)) {
    throw new HttpsError(
      "failed-precondition",
      "매칭이 제한된 상태에서는 요청을 수락할 수 없습니다."
    );
  }

  // 수락 시 만남 장소·시간 필수(Accepted를 거치지 않고 MeetingConfirmed로 확정).
  if (
    !meetingLocation ||
    typeof meetingLocation.lat !== "number" ||
    typeof meetingLocation.lng !== "number" ||
    !meetingTime
  ) {
    throw new HttpsError(
      "invalid-argument",
      "수락 시 만남 장소와 시간이 필요합니다."
    );
  }
  const meetingDate = new Date(meetingTime);
  if (Number.isNaN(meetingDate.getTime())) {
    throw new HttpsError("invalid-argument", "만남 시간 형식이 올바르지 않습니다.");
  }

  await ref.update({
    status: "MeetingConfirmed",
    respondedAt: now,
    meetingLocation: new GeoPoint(meetingLocation.lat, meetingLocation.lng),
    meetingTime: Timestamp.fromDate(meetingDate),
    updatedAt: now,
  });

  return {status: "MeetingConfirmed"};
});

/**
 * US#24: 안내자(request.auth.uid)가 받은 Requested(미만료) 동행 요청 목록 조회.
 * guideId == uid 등식 쿼리만 사용하고(복합 색인 불필요), status === "Requested"와
 * requestExpiresAt > now 만료 필터는 메모리에서 처리한다. requestedAt 오름차순으로
 * 정렬해 반환하며, Timestamp는 ISO 8601 문자열로 변환한다.
 */
export const listReceivedEscortRequests = onCall<
  ListReceivedEscortRequestsInput,
  Promise<ListReceivedEscortRequestsOutput>
>(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }

  const uid = request.auth.uid;
  const now = Timestamp.now();
  const snap = await admin
    .firestore()
    .collection("escorts")
    .where("guideId", "==", uid)
    .get();

  const requests = snap.docs
    .map((doc) => ({id: doc.id, ...(doc.data() as Omit<Escort, "id">)}))
    .filter(
      (escort) =>
        escort.status === "Requested" &&
        escort.requestExpiresAt.toMillis() > now.toMillis()
    )
    .sort((a, b) => a.requestedAt.toMillis() - b.requestedAt.toMillis())
    .map((escort) => ({
      escortId: escort.id,
      travelerId: escort.travelerId,
      requestedAt: escort.requestedAt.toDate().toISOString(),
      requestExpiresAt: escort.requestExpiresAt.toDate().toISOString(),
    }));

  return {requests};
});
