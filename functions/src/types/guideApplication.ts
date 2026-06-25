import {Timestamp} from "firebase-admin/firestore";

/**
 * Firestore `guideApplications` collection.
 *
 * PRD (Issue #1) User Stories #16,#60. CONTEXT.md Invariant: 안내자 승인을 받지
 * 못한 사용자는 안내자로 활동할 수 없다 — 사용자는 안내자 신청을 제출하고
 * 운영자가 오프라인 확인 후 승인/거부한다. 신청 상태는 users 문서가 아니라
 * 별도 컬렉션으로 관리한다(승인 이력 추적 및 대기 목록 조회 용도).
 *
 * guideApproved(users 문서)와 matchBlockedUntil은 독립된 필드이며,
 * 신청 승인/거부 처리에서 matchBlockedUntil은 절대 변경하지 않는다(ADR-0001).
 */

/** 안내자 신청의 처리 상태. */
export type GuideApplicationStatus = "pending" | "approved" | "rejected";

/**
 * 안내자 신청 문서.
 * 한 사용자는 동시에 하나의 pending 신청만 가질 수 있다(중복 신청 불가).
 */
export interface GuideApplication {
  /** Firestore doc id. */
  id: string;
  /** 신청자 uid(=Firebase Auth uid, users 문서 id). */
  userId: string;
  /** 신청 처리 상태. 생성 시 항상 "pending". */
  status: GuideApplicationStatus;
  /** 신청 제출 시각. */
  appliedAt: Timestamp;
  /** 운영자가 승인/거부한 시각. pending이면 null. */
  reviewedAt: Timestamp | null;
  /** 승인/거부한 운영자 uid. pending이면 null. */
  reviewedBy: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
