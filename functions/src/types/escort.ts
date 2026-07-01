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

/**
 * 만남 시간/장소 재제안("이 시간은 안 되니 이 시간은 어떠세요") 한 건.
 * proposedBy가 상대방에게 새 시간/장소를 제시한 상태이며, 상대가 수락하면
 * MeetingConfirmed로 전환되고, 다시 재제안하면 이 필드가 교체된다.
 */
export interface EscortCounterProposal {
  /** 이번 제안을 보낸 쪽. */
  proposedBy: EscortParty;
  proposedAt: Timestamp;
  /** 제안하는 만남 시간. */
  meetingTime: Timestamp;
  /** 제안하는 만남 장소(좌표). */
  meetingLocation: GeoPoint;
  /** 장소 표시 라벨(동네 지식으로 지정한 경우). 없으면 null. */
  meetingLocationLabel: string | null;
  /** 제안과 함께 남기는 짧은 메모(선택, 최대 200자). */
  message?: string | null;
}

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
  /**
   * 만남 장소를 사람이 읽을 수 있는 라벨로 표시(예: 안내자의 동네 지식 제목/동 이름).
   * 안내자가 본인 동네 지식을 만남 장소로 선택한 경우 그 제목이 들어간다.
   * 수동 좌표 입력이면 null.
   */
  meetingLocationLabel?: string | null;
  /**
   * 탐방자가 특정 동네 지식을 보고 동행을 요청한 경우, 그 동네 지식 문서 id.
   * 안내자 찾기 화면에서 일반 요청을 보낸 경우는 null.
   */
  requestedArchiveItemId?: string | null;
  /**
   * 탐방자가 동네 지식을 보고 요청할 때 미리 제안한 만남 시간(선택).
   * 안내자는 이 시간을 그대로 수락하거나 다른 시간으로 재제안할 수 있다.
   * 안내자가 수락하면 meetingTime으로 확정된다.
   */
  proposedMeetingTime?: Timestamp | null;
  /**
   * 진행 중인 만남 시간/장소 재제안(상대방이 "이 시간은 안 되니 이 시간은
   * 어떠세요"라고 다시 제안한 상태). status는 Requested를 유지하며, 이 필드가
   * null이 아니면 응답 대기 중임을 뜻한다. 한쪽이 상대 제안을 수락하면
   * MeetingConfirmed로 전환되고 이 필드는 null로 정리된다.
   */
  counterProposal?: EscortCounterProposal | null;
  /**
   * 재제안 왕복 횟수(무한 핑퐁 방지). CounterProposal 최대 3회까지만 허용하고
   * 그 이후에는 수락/거절만 가능하다.
   */
  counterProposalCount?: number;
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
  /**
   * 탐방자가 안내자의 응답(승인/거절) 결과 안내를 확인한 시각.
   * null이면 아직 확인 안내를 보여준 적이 없다는 뜻이며, 클라이언트는 이
   * 필드가 null이고 status가 MeetingConfirmed/Rejected일 때만 안내
   * 다이얼로그를 띄운다. 확인 후 acknowledgeEscortResponse로 기록한다.
   */
  travelerNotifiedAt?: Timestamp | null;
  /** US#25: scheduled/expireEscortRequests가 Requested→Expired 전환 시 기록. */
  expiredAt?: Timestamp | null;
  /** US#35: scheduled/autoCompleteEscort가 InProgress→Completed 자동 완료 시 기록. */
  autoCompletedAt?: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
