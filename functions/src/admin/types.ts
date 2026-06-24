/**
 * admin 모듈 callable function 계약.
 * PRD (Issue #1) User Stories #16,#60~61, Implementation Decisions > 운영자 화면
 * (1차 포함, 일정에 따라 축소·연기 가능). Flutter 앱과 별개로 운영자 전용 웹 페이지에서 호출.
 */

/**
 * US#16,#60: 복지관·주민센터의 오프라인 확인을 거친 뒤 운영자가 안내자 승인.
 * Invariant: guideApproved는 matchBlockedUntil과 독립된 별도 필드로 갱신.
 */
export interface ApproveGuideInput {
  userId: string;
}
export interface ApproveGuideOutput {
  guideApproved: true;
}

/** US#16,#60: 안내자 신청 거부(guideApproved를 false로 유지/갱신). */
export interface RejectGuideInput {
  userId: string;
  reason?: string;
}
export interface RejectGuideOutput {
  guideApproved: false;
}

/** US#15,#61: 신고 누적된 동네 지식을 운영자가 검토해 숨김 처리(삭제는 별도 경로로 확장 가능). */
export interface HideArchiveItemInput {
  itemId: string;
  reason?: string;
}
export interface HideArchiveItemOutput {
  hidden: true;
}
