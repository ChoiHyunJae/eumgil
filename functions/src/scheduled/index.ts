import {onSchedule} from "firebase-functions/v2/scheduler";

/**
 * scheduled 모듈 — PRD에서 시간 경과로 자동 트리거되는 3개 규칙.
 * callable이 아니라 Cloud Scheduler 기반 onSchedule 함수이므로 입출력 타입 계약 대신
 * 트리거 조건을 주석으로 명시한다. 구현은 후속 슬라이스에서 채운다.
 */

/**
 * US#25: escorts.status === "Requested"이고 requestExpiresAt(요청 생성 + 48시간)이
 * 지난 문서를 "Expired"로 전환하고 탐방자에게 만료 알림을 발송한다.
 * 트리거 조건: requestExpiresAt <= now() AND status == "Requested".
 */
export const expireEscortRequests = onSchedule("every 15 minutes", async () => {
  throw new Error("not implemented");
});

/**
 * US#30~33: escorts.status === "MeetingConfirmed"이고 meetingTime + 30분이 지난 문서에서
 * "만났어요"를 누르지 않은 쪽(guideArrivalConfirmedAt/travelerArrivalConfirmedAt이 null인 쪽,
 * 양쪽 다 null이면 양쪽 모두)에 noShowBy를 기록하고 status를 "NoShow"로 전환한다.
 * 이어서 users.noShowCount를 증가시키고 3회 이상이면 matchBlockedUntil(+7일)을 설정한다.
 * 트리거 조건: meetingTime + 30min <= now() AND status == "MeetingConfirmed".
 */
export const judgeNoShow = onSchedule("every 5 minutes", async () => {
  throw new Error("not implemented");
});

/**
 * US#35: escorts.status === "InProgress"이고
 * guideCompletedAt/travelerCompletedAt 중
 * 한쪽만 채워진 상태로 24시간이 지난 문서를 자동으로 "Completed"로 전환한다
 * (영구 InProgress 방지 안전장치). 양쪽 다 비어있는 경우는 대상에서 제외.
 * 트리거 조건: status == "InProgress" AND
 *   (guideCompletedAt XOR travelerCompletedAt)이 채워진 시각 + 24시간 <= now().
 */
export const autoCompleteEscort = onSchedule("every 15 minutes", async () => {
  throw new Error("not implemented");
});
