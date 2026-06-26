import * as admin from "firebase-admin";
import {Timestamp} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/v2/https";
import {Escort, EscortParty, EscortStatus} from "../types";
import {
  CancelEscortInput,
  CancelEscortOutput,
  CheckArrivalInput,
  CheckArrivalOutput,
  CompleteEscortInput,
  CompleteEscortOutput,
  ConfirmMeetingInput,
  ConfirmMeetingOutput,
  ListMyEscortsInput,
  ListMyEscortsOutput,
  MidTerminateInput,
  MidTerminateOutput,
  MyEscortSummary,
} from "./types";

/**
 * escort 모듈 — 동행 생명주기 상태 전환.
 * Slice 7: listMyEscorts(내 동행 조회), cancelEscort(시작 전 취소) 구현.
 * confirmMeeting/checkArrival/midTerminate/completeEscort는 후속 슬라이스.
 * 48시간 만료/30분 노쇼판정/24시간 자동완료는 scheduled/ 모듈의 별도 트리거가 담당한다.
 */

/** 만남 전·중으로 보아 "내 동행" 목록에 노출하는 상태. */
const ACTIVE_ESCORT_STATUSES: EscortStatus[] = [
  "Accepted",
  "MeetingConfirmed",
  "InProgress",
];

/** 동행 시작 전이라 취소가 허용되는 상태. */
const CANCELLABLE_STATUSES: EscortStatus[] = ["Accepted", "MeetingConfirmed"];

/** US#30~31: "만났어요" 확인을 허용하는 두 기기 GPS 근접 임계(미터). */
const MEETING_PROXIMITY_M = 50;

/**
 * 두 Timestamp가 같은 UTC 날짜인지 판정한다(당일 취소 판정용).
 *
 * @param {Timestamp} a 비교 대상 시각 1.
 * @param {Timestamp} b 비교 대상 시각 2.
 * @return {boolean} 같은 UTC 날짜면 true.
 */
function isSameUtcDay(a: Timestamp, b: Timestamp): boolean {
  return (
    a.toDate().toISOString().slice(0, 10) ===
    b.toDate().toISOString().slice(0, 10)
  );
}

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
 * Slice 7: 현재 로그인 사용자가 당사자인 진행 중 동행 목록을 조회한다.
 * guideId == uid, travelerId == uid를 각각 등식 쿼리로 조회 후(복합 색인 불필요)
 * 만남 전·중 상태만 메모리 필터링하고 requestedAt 오름차순으로 반환한다.
 */
export const listMyEscorts = onCall<
  ListMyEscortsInput, Promise<ListMyEscortsOutput>
>(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }

  const uid = request.auth.uid;
  const col = admin.firestore().collection("escorts");
  const [asGuide, asTraveler] = await Promise.all([
    col.where("guideId", "==", uid).get(),
    col.where("travelerId", "==", uid).get(),
  ]);

  const byId = new Map<string, Escort>();
  for (const doc of [...asGuide.docs, ...asTraveler.docs]) {
    byId.set(doc.id, {id: doc.id, ...(doc.data() as Omit<Escort, "id">)});
  }

  const escorts: MyEscortSummary[] = [...byId.values()]
    .filter((e) => ACTIVE_ESCORT_STATUSES.includes(e.status))
    .sort((a, b) => a.requestedAt.toMillis() - b.requestedAt.toMillis())
    .map((e) => ({
      escortId: e.id,
      guideId: e.guideId,
      travelerId: e.travelerId,
      status: e.status,
      meetingTime: e.meetingTime ? e.meetingTime.toDate().toISOString() : null,
    }));

  return {escorts};
});

/**
 * US#30~31 / Slice 7-2: 두 기기 GPS 50m 이내 근접 시 "만났어요" 확인.
 * MeetingConfirmed 상태에서만 허용하며, 호출자 좌표와 escort.meetingLocation의
 * 거리가 50m를 초과하면 거부한다(클라이언트 비활성화는 보조 수단, 서버가 최종 검증).
 * 호출자 역할에 따라 도착 확인 시각을 기록하고, 양쪽 모두 확인되면 InProgress로
 * 전환한다.
 */
export const confirmMeeting = onCall<
  ConfirmMeetingInput, Promise<ConfirmMeetingOutput>
>(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }

  const {escortId, location} = request.data;
  if (!escortId) {
    throw new HttpsError("invalid-argument", "escortId가 필요합니다.");
  }
  if (
    !location ||
    typeof location.lat !== "number" ||
    typeof location.lng !== "number"
  ) {
    throw new HttpsError("invalid-argument", "위치 좌표가 필요합니다.");
  }

  const uid = request.auth.uid;
  const ref = admin.firestore().collection("escorts").doc(escortId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "동행을 찾을 수 없습니다.");
  }

  const escort = snap.data() as Omit<Escort, "id">;
  let party: EscortParty;
  if (escort.guideId === uid) {
    party = "guide";
  } else if (escort.travelerId === uid) {
    party = "traveler";
  } else {
    throw new HttpsError(
      "permission-denied",
      "본인이 참여한 동행만 확인할 수 있습니다."
    );
  }

  if (escort.status !== "MeetingConfirmed") {
    throw new HttpsError(
      "failed-precondition",
      "만남 확정 상태에서만 도착을 확인할 수 있습니다."
    );
  }

  if (!escort.meetingLocation) {
    throw new HttpsError("failed-precondition", "만남 위치가 설정되지 않았습니다.");
  }

  const distanceM = haversineMeters(
    location.lat,
    location.lng,
    escort.meetingLocation.latitude,
    escort.meetingLocation.longitude
  );
  if (distanceM > MEETING_PROXIMITY_M) {
    throw new HttpsError(
      "failed-precondition",
      "만남 장소에서 50m 이내에서만 확인할 수 있습니다."
    );
  }

  const now = Timestamp.now();
  const guideAt =
    party === "guide" ? now : escort.guideArrivalConfirmedAt;
  const travelerAt =
    party === "traveler" ? now : escort.travelerArrivalConfirmedAt;
  const bothConfirmed = guideAt != null && travelerAt != null;
  const status: ConfirmMeetingOutput["status"] = bothConfirmed ?
    "InProgress" :
    "MeetingConfirmed";

  const updates: Record<string, unknown> = {status, updatedAt: now};
  if (party === "guide") {
    updates.guideArrivalConfirmedAt = now;
  } else {
    updates.travelerArrivalConfirmedAt = now;
  }
  await ref.update(updates);

  return {status};
});

/** US#32: 노쇼 판정 결과 조회. */
export const checkArrival = onCall<
  CheckArrivalInput, Promise<CheckArrivalOutput>
>(
  async () => {
    throw new Error("not implemented");
  }
);

/**
 * US#27~29 / Slice 7: 동행 시작 전 취소(Accepted|MeetingConfirmed → Cancelled).
 * 당사자(guide 또는 traveler)만 취소할 수 있다. 만남 시각과 같은 UTC 날짜에
 * 취소하면 당일 취소로 표시한다(isSameDayCancellation). 노쇼 카운터/매칭 제한
 * 누적(ADR-0001 패널티)은 별도 슬라이스로 두며 여기서는 상태 전이만 수행한다.
 */
export const cancelEscort = onCall<
  CancelEscortInput, Promise<CancelEscortOutput>
>(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }

  const {escortId} = request.data;
  if (!escortId) {
    throw new HttpsError("invalid-argument", "escortId가 필요합니다.");
  }

  const uid = request.auth.uid;
  const ref = admin.firestore().collection("escorts").doc(escortId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "동행을 찾을 수 없습니다.");
  }

  const escort = snap.data() as Omit<Escort, "id">;
  let cancelledBy: EscortParty;
  if (escort.guideId === uid) {
    cancelledBy = "guide";
  } else if (escort.travelerId === uid) {
    cancelledBy = "traveler";
  } else {
    throw new HttpsError(
      "permission-denied",
      "본인이 참여한 동행만 취소할 수 있습니다."
    );
  }

  if (!CANCELLABLE_STATUSES.includes(escort.status)) {
    throw new HttpsError(
      "failed-precondition",
      "취소할 수 없는 상태입니다(시작 전 동행만 취소 가능)."
    );
  }

  const now = Timestamp.now();
  const isSameDayCancellation =
    escort.meetingTime != null && isSameUtcDay(escort.meetingTime, now);

  await ref.update({
    status: "Cancelled",
    cancelledBy,
    cancelledAt: now,
    isSameDayCancellation,
    updatedAt: now,
  });

  return {status: "Cancelled", isSameDayCancellation};
});

/** US#34: InProgress 중 중도 종료. 소모임 카운트에서 제외(group-suggestion 모듈 규칙). */
export const midTerminate = onCall<
  MidTerminateInput, Promise<MidTerminateOutput>
>(
  async () => {
    throw new Error("not implemented");
  }
);

/**
 * US#35,#38: 각자 "동행 종료" 확인 → 양쪽 모두 누르면 Completed.
 * 24시간 내 상대방 미확인 시 자동 완료는 scheduled/autoCompleteEscort가 처리.
 */
export const completeEscort = onCall<
  CompleteEscortInput, Promise<CompleteEscortOutput>
>(
  async () => {
    throw new Error("not implemented");
  }
);
