import {EscortParty, EscortStatus} from "../types";

/**
 * escort 모듈 callable function 계약.
 * PRD (Issue #1) User Stories #27~38,
 * Implementation Decisions > `escort` 모듈 상태 머신:
 * Requested → (Expired|Rejected|Accepted) → MeetingConfirmed →
 *   (Cancelled|NoShow|InProgress) → (Completed|MidTerminated)
 */

/**
 * US#30~31: "만났어요" 확인. 호출 전 두 기기 GPS가 약 50m 이내로 근접해야 클라이언트가
 * 버튼을 활성화한다 — 서버는 동일 조건을 재검증해 근접하지 않으면 거부한다.
 */
export interface ConfirmMeetingInput {
  escortId: string;
  location: {lat: number; lng: number};
}
export interface ConfirmMeetingOutput {
  /** 양쪽 모두 확인되면 InProgress로 전환. */
  status: "MeetingConfirmed" | "InProgress";
}

/**
 * US#32 / Slice 7-3: 동행의 도착 확인 상태와 노쇼 판정 가능 여부를 조회한다.
 * 당사자만 조회할 수 있다.
 */
export interface CheckArrivalInput {
  escortId: string;
}
export interface CheckArrivalOutput {
  status: EscortStatus;
  guideArrivalConfirmed: boolean;
  travelerArrivalConfirmed: boolean;
  /** MeetingConfirmed이고 약속+30분 경과, 양쪽 모두 확인은 아님 → 노쇼 판정 가능. */
  canJudgeNoShow: boolean;
  /** 만남 확정 시각(ISO 8601). 미확정이면 null. */
  meetingTime: string | null;
}

/**
 * US#32 / Slice 7-3: 약속 시간 + 30분 이후 미확인 당사자를 NoShow로 판정한다.
 * 당사자만 호출할 수 있으며 MeetingConfirmed 상태에서만 허용한다.
 */
export interface JudgeNoShowInput {
  escortId: string;
}
export interface JudgeNoShowOutput {
  status: "NoShow";
  noShowBy: EscortParty[];
}

/**
 * US#27~29: 동행 시작 전 취소. 당일 취소는 노쇼와 동일 패널티, 전날 이전 취소는 패널티 없음.
 * Invariant(ADR-0001): 당일 취소 패널티는 노쇼 카운터에 합산.
 */
export interface CancelEscortInput {
  escortId: string;
}
export interface CancelEscortOutput {
  status: "Cancelled";
  isSameDayCancellation: boolean;
}

/**
 * Slice 7: 현재 로그인 사용자가 당사자(guide 또는 traveler)인 진행 중 동행 목록 조회.
 * 입력은 없으며 request.auth.uid 기준으로 조회한다. 만남 전·중 상태만 반환한다.
 */
export type ListMyEscortsInput = Record<string, never>;
export interface MyEscortSummary {
  escortId: string;
  guideId: string;
  travelerId: string;
  status: EscortStatus;
  /** 만남 확정 시각(ISO 8601). 미확정이면 null. */
  meetingTime: string | null;
}
export interface ListMyEscortsOutput {
  escorts: MyEscortSummary[];
}

/** US#34: 동행 시작 후 응급 상황 등으로 중도 종료(InProgress → MidTerminated). */
export interface MidTerminateInput {
  escortId: string;
  reason?: string;
}
export interface MidTerminateOutput {
  status: "MidTerminated";
}

/**
 * US#35,#38: 각자 "동행 종료" 확인. 양쪽 모두 누르면 Completed.
 * US#38 (1차 포함, 일정에 따라 축소·연기 가능): 탐방자가 만족도 평가 동반 제출.
 */
export interface CompleteEscortInput {
  escortId: string;
  /** 탐방자가 호출할 때만 의미 있음. */
  satisfactionRating?: number;
}
export interface CompleteEscortOutput {
  /** 상대방이 아직 누르지 않았으면 InProgress 유지. */
  status: "InProgress" | "Completed";
}
