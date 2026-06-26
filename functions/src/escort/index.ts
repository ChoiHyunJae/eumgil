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
 * US#30~31: 두 기기 GPS 50m 이내 근접 시 "만났어요" 확인.
 * Invariant: 근접 조건 미충족 시 거부(클라이언트 비활성화는 보조 수단일 뿐 서버가 최종 검증).
 */
export const confirmMeeting = onCall<
  ConfirmMeetingInput, Promise<ConfirmMeetingOutput>
>(
  async () => {
    throw new Error("not implemented");
  }
);

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
