import {onCall} from "firebase-functions/v2/https";
import {
  CancelEscortInput,
  CancelEscortOutput,
  CheckArrivalInput,
  CheckArrivalOutput,
  CompleteEscortInput,
  CompleteEscortOutput,
  ConfirmMeetingInput,
  ConfirmMeetingOutput,
  MidTerminateInput,
  MidTerminateOutput,
} from "./types";

/**
 * escort 모듈 — 동행 생명주기(MeetingConfirmed 이후) 상태 전환.
 * 계약 정의만 포함(Slice 0, Issue #2). 구현은 후속 슬라이스에서 채운다.
 * 48시간 만료/30분 노쇼판정/24시간 자동완료는 scheduled/ 모듈의 별도 트리거가 담당한다.
 */

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
 * US#27~29: 동행 시작 전 취소. 당일 취소는 노쇼와 동일 패널티(ADR-0001), 전날 이전은 패널티 없음.
 * 취소 시 상대방에게 즉시 푸시 알림(US#28).
 */
export const cancelEscort = onCall<
  CancelEscortInput, Promise<CancelEscortOutput>
>(
  async () => {
    throw new Error("not implemented");
  }
);

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
