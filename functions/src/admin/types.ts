/**
 * admin 모듈 callable function 계약.
 * PRD (Issue #1) User Stories #16,#60~61, Implementation Decisions > 운영자 화면
 * (1차 포함, 일정에 따라 축소·연기 가능). Flutter 앱과 별개로 운영자 전용 웹 페이지에서 호출.
 */

import {Timestamp} from "firebase-admin/firestore";
import {ArchiveCategory, GuideApplication} from "../types";

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

/**
 * US#16,#60 / Slice 2: 운영자가 처리 대기 중인(pending) 안내자 신청 목록을 조회.
 * 별도 입력 필드는 없다. 운영자 권한(assertOperator)으로만 호출 가능.
 */
export type ListPendingGuideApplicationsInput = Record<string, never>;
export interface ListPendingGuideApplicationsOutput {
  applications: GuideApplication[];
}

/**
 * US#15,#61 / Slice 5: 운영자가 신고된(reportCount>0) 동네 지식 검토 목록을 조회.
 * 기본은 미숨김 항목만, includeHidden=true면 숨김 항목도 포함한다.
 * 정확 좌표(exactLocation)는 운영자 검토 목록에서도 반환하지 않는다(Slice 3 원칙).
 */
export interface ListReportedArchiveItemsInput {
  includeHidden?: boolean;
}
export interface ReportedArchiveItemView {
  id: string;
  authorId: string;
  category: ArchiveCategory;
  voiceTranscript: string;
  aiSummary: string | null;
  dongLabel: string;
  reportCount: number;
  hidden: boolean;
  published: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
export interface ListReportedArchiveItemsOutput {
  items: ReportedArchiveItemView[];
}

/**
 * US#15,#61 / Slice 5: 운영자가 신고된 동네 지식을 영구 삭제한다.
 * 안내자 본인 삭제(archive/deleteArchiveItem)와 별개의 운영자 전용 경로다.
 */
export interface DeleteArchiveItemAsAdminInput {
  itemId: string;
  reason?: string;
}
export interface DeleteArchiveItemAsAdminOutput {
  deleted: true;
}

/**
 * US#16,#60 / Slice 5: 운영자가 승인된 안내자 목록을 조회(자격 상실 처리 대상).
 * 자격 상실은 기존 rejectGuide(userId)를 재사용한다.
 */
export type ListApprovedGuidesInput = Record<string, never>;
export interface ApprovedGuideView {
  userId: string;
  phoneNumber: string;
  residenceYears?: number;
  interests?: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
export interface ListApprovedGuidesOutput {
  guides: ApprovedGuideView[];
}
