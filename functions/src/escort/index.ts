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
  JudgeNoShowInput,
  JudgeNoShowOutput,
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

/** US#32: 노쇼 판정 가능 시점(약속 시간 + 30분, 밀리초). */
const NO_SHOW_GRACE_MS = 30 * 60 * 1000;

/** US#33/#60: 약속 위반(노쇼+당일취소) 누적 임계. 이 이상이면 매칭 제한. */
const PENALTY_THRESHOLD = 3;

/** US#60: 매칭 제한 기간(7일, 밀리초). */
const MATCH_BLOCK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 약속 위반(노쇼 또는 당일취소) 패널티를 트랜잭션 안에서 사용자 문서에 적용한다.
 * noShowCount를 1 증가시키고, 누적이 임계 이상이면 matchBlockedUntil을 now+7일로
 * 설정한다. 모든 read 이후에 호출해야 한다(트랜잭션 read-before-write 규칙).
 *
 * @param {admin.firestore.Transaction} tx 진행 중 트랜잭션.
 * @param {admin.firestore.DocumentReference} userRef 대상 사용자 문서 참조.
 * @param {admin.firestore.DocumentSnapshot} userSnap 미리 읽어둔 사용자 스냅샷.
 * @param {Timestamp} now 기준 현재 시각.
 * @return {void}
 */
function applyEscortPenalty(
  tx: admin.firestore.Transaction,
  userRef: admin.firestore.DocumentReference,
  userSnap: admin.firestore.DocumentSnapshot,
  now: Timestamp
): void {
  if (!userSnap.exists) {
    return; // 사용자 문서가 없으면 패널티를 생략한다(데이터 정합성 보호).
  }
  const current = (userSnap.data()?.noShowCount as number | undefined) ?? 0;
  const next = current + 1;
  const updates: Record<string, unknown> = {noShowCount: next, updatedAt: now};
  if (next >= PENALTY_THRESHOLD) {
    updates.matchBlockedUntil = Timestamp.fromMillis(
      now.toMillis() + MATCH_BLOCK_MS
    );
  }
  tx.update(userRef, updates);
}

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

/**
 * US#32 / Slice 7-3: 동행의 도착 확인 상태와 노쇼 판정 가능 여부를 조회한다(당사자 전용).
 */
export const checkArrival = onCall<
  CheckArrivalInput, Promise<CheckArrivalOutput>
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
  if (escort.guideId !== uid && escort.travelerId !== uid) {
    throw new HttpsError(
      "permission-denied",
      "본인이 참여한 동행만 조회할 수 있습니다."
    );
  }

  const now = Timestamp.now();
  const guideArrivalConfirmed = escort.guideArrivalConfirmedAt != null;
  const travelerArrivalConfirmed = escort.travelerArrivalConfirmedAt != null;
  const past30 =
    escort.meetingTime != null &&
    now.toMillis() >= escort.meetingTime.toMillis() + NO_SHOW_GRACE_MS;
  const canJudgeNoShow =
    escort.status === "MeetingConfirmed" &&
    past30 &&
    !(guideArrivalConfirmed && travelerArrivalConfirmed);

  return {
    status: escort.status,
    guideArrivalConfirmed,
    travelerArrivalConfirmed,
    canJudgeNoShow,
    meetingTime: escort.meetingTime ?
      escort.meetingTime.toDate().toISOString() :
      null,
  };
});

/**
 * US#32~33 / Slice 7-3: 약속 시간 + 30분 이후 미확인 당사자를 NoShow로 판정한다.
 * MeetingConfirmed 상태에서만 허용하며 당사자만 호출할 수 있다. 도착을 확인하지
 * 않은 쪽(guide/traveler, 양쪽 다 미확인이면 둘 다)을 noShowBy로 기록하고
 * status를 NoShow로 전이한다. 각 노쇼 대상에 약속 위반 패널티를 적용한다.
 * escort 상태와 사용자 패널티를 트랜잭션으로 일관되게 갱신한다.
 *
 * 이름은 scheduled/judgeNoShow(onSchedule 자동 판정)와의 export 충돌을 피하려고
 * judgeEscortNoShow로 둔다. 클라이언트는 이 callable로 수동 판정을 트리거한다.
 */
export const judgeEscortNoShow = onCall<
  JudgeNoShowInput, Promise<JudgeNoShowOutput>
>(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  const {escortId} = request.data;
  if (!escortId) {
    throw new HttpsError("invalid-argument", "escortId가 필요합니다.");
  }

  const uid = request.auth.uid;
  const db = admin.firestore();
  const escortRef = db.collection("escorts").doc(escortId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(escortRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", "동행을 찾을 수 없습니다.");
    }
    const escort = snap.data() as Omit<Escort, "id">;
    if (escort.guideId !== uid && escort.travelerId !== uid) {
      throw new HttpsError(
        "permission-denied",
        "본인이 참여한 동행만 판정할 수 있습니다."
      );
    }
    if (escort.status !== "MeetingConfirmed") {
      throw new HttpsError(
        "failed-precondition",
        "만남 확정 상태에서만 노쇼를 판정할 수 있습니다."
      );
    }
    if (!escort.meetingTime) {
      throw new HttpsError("failed-precondition", "만남 시간이 없습니다.");
    }

    const now = Timestamp.now();
    if (now.toMillis() < escort.meetingTime.toMillis() + NO_SHOW_GRACE_MS) {
      throw new HttpsError(
        "failed-precondition",
        "약속 시간 + 30분 이후에만 노쇼를 판정할 수 있습니다."
      );
    }

    const guideArrived = escort.guideArrivalConfirmedAt != null;
    const travelerArrived = escort.travelerArrivalConfirmedAt != null;
    if (guideArrived && travelerArrived) {
      throw new HttpsError(
        "failed-precondition",
        "양쪽 모두 도착을 확인해 노쇼가 아닙니다."
      );
    }

    const noShowBy: EscortParty[] = [];
    if (!guideArrived) noShowBy.push("guide");
    if (!travelerArrived) noShowBy.push("traveler");

    // 패널티 대상 사용자 문서를 모두 먼저 읽는다(read-before-write).
    const penaltyRefs = noShowBy.map((party) =>
      db
        .collection("users")
        .doc(party === "guide" ? escort.guideId : escort.travelerId)
    );
    const penaltySnaps = await Promise.all(penaltyRefs.map((r) => tx.get(r)));

    // 쓰기: escort 상태 + 각 대상 패널티.
    tx.update(escortRef, {status: "NoShow", noShowBy, updatedAt: now});
    penaltyRefs.forEach((ref, i) => {
      applyEscortPenalty(tx, ref, penaltySnaps[i], now);
    });

    return {status: "NoShow" as const, noShowBy};
  });
});

/**
 * US#27~29 / Slice 7-3: 동행 시작 전 취소(Accepted|MeetingConfirmed → Cancelled).
 * 당사자(guide 또는 traveler)만 취소할 수 있다. 만남 시각과 같은 UTC 날짜에
 * 취소하면 당일 취소(isSameDayCancellation)로 표시하고, 노쇼와 동일하게 취소자에게
 * 약속 위반 패널티를 적용한다(ADR-0001). escort 상태와 패널티를 트랜잭션으로 갱신한다.
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
  const db = admin.firestore();
  const escortRef = db.collection("escorts").doc(escortId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(escortRef);
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

    // 당일 취소면 취소자 패널티 적용을 위해 사용자 문서를 미리 읽는다.
    const userRef = db.collection("users").doc(uid);
    const userSnap = isSameDayCancellation ? await tx.get(userRef) : null;

    tx.update(escortRef, {
      status: "Cancelled",
      cancelledBy,
      cancelledAt: now,
      isSameDayCancellation,
      updatedAt: now,
    });
    if (userSnap) {
      applyEscortPenalty(tx, userRef, userSnap, now);
    }

    return {status: "Cancelled", isSameDayCancellation};
  });
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
