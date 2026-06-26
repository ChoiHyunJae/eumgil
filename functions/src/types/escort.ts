import {GeoPoint, Timestamp} from "firebase-admin/firestore";

/**
 * Firestore `escorts` collection.
 *
 * PRD (Issue #1) User Stories #23~38, Implementation Decisions > `escort` 모듈
 * 상태 머신: Requested → (Expired | Rejected | Accepted) → MeetingConfirmed →
 *           (Cancelled | NoShow | InProgress) → (Completed | MidTerminated)
 * CONTEXT.md: 동행은 정확히 한 명의 안내자와 한 명의 탐방자 사이에서만 성립.
 */

/** PRD escort 상태머신의 10개 상태. */
export type EscortStatus =
  | "Requested"
  | "Expired"
  | "Rejected"
  | "Accepted"
  | "MeetingConfirmed"
  | "Cancelled"
  | "NoShow"
  | "InProgress"
  | "Completed"
  | "MidTerminated";

export type EscortParty = "guide" | "traveler";

export interface Escort {
  id: string;
  guideId: string;
  travelerId: string;
  status: EscortStatus;
  /** US#23: 탐방자 → 안내자 단방향 요청만 생성 가능. */
  requestedAt: Timestamp;
  /** US#24: 안내자가 수락/거절만 가능. 거절 시 Rejected. */
  respondedAt: Timestamp | null;
  /** US#25: 48시간 무응답 시 스케줄러가 Expired로 전환(scheduled/expireEscortRequests). */
  requestExpiresAt: Timestamp;
  /** US#26: 수락 후 만남 장소·시간 확정(Accepted → MeetingConfirmed). */
  meetingLocation: GeoPoint | null;
  meetingTime: Timestamp | null;
  /** US#27~29: 동행 시작 전 취소 가능. 누가 취소했는지. */
  cancelledBy: EscortParty | null;
  cancelledAt: Timestamp | null;
  /**
   * US#29: 취소 시각의 날짜 == 약속 날짜이면 당일 취소(노쇼와 동일 패널티),
   * 전날 이전 취소면 패널티 없음. ADR-0001 참고.
   */
  isSameDayCancellation: boolean | null;
  /**
   * US#30~32: 약속 시간 + 30분 시점에 "만났어요"를 누르지 않은 쪽에만 기록(양쪽 다 안 누르면 양쪽 모두).
   * 스케줄러(scheduled/judgeNoShow)가 이 필드를 근거로 NoShow 전환 및 패널티 누적을 수행.
   */
  noShowBy: EscortParty[];
  /** US#30~31: 두 기기 GPS가 약 50m 이내로 근접해야 활성화되는 "만났어요" 확인. */
  guideArrivalConfirmedAt: Timestamp | null;
  travelerArrivalConfirmedAt: Timestamp | null;
  /** US#34: InProgress 중 응급 상황 등으로 중도 종료. */
  midTerminatedBy: EscortParty | null;
  midTerminatedAt: Timestamp | null;
  /** US#34: 중도 종료 사유(선택, 최대 500자). 미입력이면 null. */
  midTerminateReason?: string | null;
  /**
   * US#35: 양쪽이 각자 "동행 종료"를 눌러야 Completed.
   * 한쪽만 누른 뒤 24시간 경과 시 스케줄러(scheduled/autoCompleteEscort)가 자동 Completed 처리.
   */
  guideCompletedAt: Timestamp | null;
  travelerCompletedAt: Timestamp | null;
  /** US#38 (1차 포함, 일정에 따라 축소·연기 가능): 1~5 또는 만족/보통/불만족을 수치화. */
  satisfactionRating: number | null;
  /**
   * US#38 / Slice 9: satisfactionRating이 안내자 guideStats(평균)에 반영된 시각.
   * Completed 전환 시 1회 반영하고 기록한다. null/미존재면 아직 미반영.
   */
  satisfactionStatsAppliedAt?: Timestamp | null;
  /** US#25: scheduled/expireEscortRequests가 Requested→Expired 전환 시 기록. */
  expiredAt?: Timestamp | null;
  /** US#35: scheduled/autoCompleteEscort가 InProgress→Completed 자동 완료 시 기록. */
  autoCompletedAt?: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
