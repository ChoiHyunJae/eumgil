import {GroupFrequency, GroupTimeOfDay} from "../types";

/**
 * group 모듈 callable function 계약.
 * PRD (Issue #1) User Stories #39~51,
 * Implementation Decisions > `group-suggestion` 모듈.
 * 자동 제안 생성(완료 3회 누적 판정)은 escort 모듈의 completeEscort 처리 흐름에서 트리거되며,
 * 이 파일은 사용자가 직접 호출하는 callable 계약만 정의한다.
 */

/**
 * US#42,#51: 시스템이 생성한 소모임 제안에 응답(동의/거절).
 * Invariant: 양쪽 모두 동의해야 모임 생성. US#41: 거절 시 같은 쌍에 재제안 금지.
 */
export interface RespondToSuggestionInput {
  escortPairId: string;
  accept: boolean;
}
export interface RespondToSuggestionOutput {
  status: "accepted" | "rejected";
  /** accept=true이고 양쪽 모두 동의 완료된 경우에만 채워짐. */
  createdGroupId?: string;
}

/**
 * US#44: 안내자가 소모임 직접 개설(제안 흐름과 별도 경로).
 * Invariant: 개설자는 안내자만 가능, 인원 상한 4인.
 */
export interface CreateGroupInput {
  frequency: GroupFrequency;
  timeOfDay: GroupTimeOfDay;
  /** US#49 (1차 포함, 일정에 따라 축소·연기 가능). */
  kakaoOpenChatUrl?: string;
  initialMemberIds?: string[];
}
export interface CreateGroupOutput {
  groupId: string;
}

/**
 * US#45~46: 안내자가 신규 탐방자를 초대 → 기존 탐방자 멤버 전원의 동의 필요.
 * Invariant: 초대 권한은 개설 안내자에게만 있음, 인원 4인 초과 시 거부.
 */
export interface InviteToGroupInput {
  groupId: string;
  travelerId: string;
}
export interface InviteToGroupOutput {
  status: "pending" | "accepted";
}

/**
 * US#50: 개설 안내자가 승인 자격을 잃으면 시스템이 자동 해산하지만,
 * 이 stub은 운영/테스트 편의를 위한 수동 해산 경로(안내자 본인 호출)를 정의한다.
 */
export interface DissolveGroupInput {
  groupId: string;
}
export interface DissolveGroupOutput {
  status: "dissolved";
}

/**
 * group-suggestion 자동 판정 결과 — escort 모듈의 completeEscort 내부에서 호출되는
 * 모듈 간 경계용 시그니처. HTTP callable이 아니라 모듈 간 내부 계약임을 명시한다.
 * US#39~40: Completed 3회 누적 시 제안 1회 생성.
 */
export interface SuggestGroupInput {
  escortPairId: string;
}
export interface SuggestGroupOutput {
  suggested: boolean;
}
