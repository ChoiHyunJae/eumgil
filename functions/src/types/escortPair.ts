import {Timestamp} from "firebase-admin/firestore";

/**
 * Firestore `escortPairs` collection — 같은 안내자-탐방자 쌍의 정상 완료 동행 누적과
 * 소모임 제안 상태를 추적한다(group-suggestion 모듈 전용 집계 컬렉션).
 *
 * PRD (Issue #1) User Stories #39~43,
 * Implementation Decisions > `group-suggestion` 모듈.
 * CONTEXT.md Invariants: Completed(양쪽 종료 확인)만 카운트, 노쇼/취소/중도종료/만료/거절은 제외.
 */

export type GroupSuggestionStatus =
  | "none"
  | "proposed"
  | "accepted"
  | "rejected"
  | "expired";

export interface EscortPair {
  /** 결정적 키, 예: `${guideId}_${travelerId}`. */
  id: string;
  guideId: string;
  travelerId: string;
  /** US#39~40: Completed 동행만 카운트. 3회 누적 시 제안 생성 트리거. */
  completedEscortCount: number;
  /**
   * US#41,#43: proposed 이후 거절(rejected)되면 같은 쌍에 재제안하지 않음.
   * 7일 무응답이면 스케줄러가 expired로 전환(소모임 제안 전용 스케줄러는 별도 정의하지 않고
   * group 모듈의 expireGroupSuggestions로 통합 — group/index.ts 참고).
   */
  groupSuggestionStatus: GroupSuggestionStatus;
  suggestedAt: Timestamp | null;
  /** US#43: 7일 응답 기한 판정 기준. */
  suggestionExpiresAt: Timestamp | null;
  respondedAt: Timestamp | null;
  /** US#42: 양쪽 동의로 생성된 group 참조. */
  resultingGroupId: string | null;
  /**
   * US#42: respondToSuggestion 양방향 동의 중간 상태 추적.
   * 안내자/탐방자 각각의 동의 시각. 둘 다 채워지면 소모임 생성.
   * ⚠️ Slice 11 추가 필드 — 팀 합의 필요.
   */
  guideConsentedAt: Timestamp | null;
  travelerConsentedAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
