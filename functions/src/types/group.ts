import {Timestamp} from "firebase-admin/firestore";

/**
 * Firestore `groups` collection.
 *
 * PRD (Issue #1) User Stories #39~51,
 * Implementation Decisions > `group-suggestion` 모듈.
 * CONTEXT.md Entities: 소모임은 한 명의 개설 안내자 + 최대 4인의 탐방자 멤버.
 * CONTEXT.md Invariants: 소모임 인원은 4인을 넘을 수 없다.
 */

/** US#48: 반복 주기, 버튼 선택. */
export type GroupFrequency = "WEEKLY" | "BIWEEKLY" | "MONTHLY";
/** US#48: 시간대, 버튼 선택. */
export type GroupTimeOfDay = "MORNING" | "AFTERNOON";

export type GroupDissolvedReason = "guide_unapproved" | "manual";

export interface Group {
  id: string;
  /** US#44~45: 개설/초대 권한은 안내자에게만 있음. */
  guideId: string;
  /**
   * guideId 포함 전체 멤버. Invariant: 최대 4인(개설 안내자 1 + 탐방자 최대 3,
   * 또는 안내자 1 + 탐방자 1~3 — 총원 상한이 4).
   */
  memberIds: string[];
  frequency: GroupFrequency;
  timeOfDay: GroupTimeOfDay;
  /** US#49 (1차 포함, 일정에 따라 축소·연기 가능). 인앱 채팅 대체. */
  kakaoOpenChatUrl: string | null;
  /** US#45~46: 신규 탐방자 초대 시 기존 탐방자 멤버 전원의 동의가 필요. */
  pendingInvites: GroupInvite[];
  /** US#50: 개설 안내자가 승인 자격을 잃으면 자동 해산. */
  dissolved: boolean;
  dissolvedReason: GroupDissolvedReason | null;
  dissolvedAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** US#45~46: 초대받은 탐방자별 동의 진행 상태. */
export interface GroupInvite {
  travelerId: string;
  invitedAt: Timestamp;
  /** 동의를 완료한 기존 탐방자 멤버 uid 목록. */
  consentingMemberIds: string[];
  status: "pending" | "accepted" | "rejected";
}
