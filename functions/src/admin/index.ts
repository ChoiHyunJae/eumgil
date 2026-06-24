import {onCall} from "firebase-functions/v2/https";
import {
  ApproveGuideInput,
  ApproveGuideOutput,
  HideArchiveItemInput,
  HideArchiveItemOutput,
  RejectGuideInput,
  RejectGuideOutput,
} from "./types";

/**
 * admin 모듈 — 운영자 전용 안내자 승인/거부, 신고된 동네 지식 숨김.
 * 계약 정의만 포함(Slice 0, Issue #2). 구현은 후속 슬라이스에서 채운다.
 * 호출 권한은 운영자 전용 Firebase Auth 계정으로 제한(구현 시 request.auth 검증 필요).
 */

/** US#16,#60: 안내자 승인. */
export const approveGuide = onCall<
  ApproveGuideInput, Promise<ApproveGuideOutput>
>(
  async () => {
    throw new Error("not implemented");
  }
);

/** US#16,#60: 안내자 신청 거부. */
export const rejectGuide = onCall<
  RejectGuideInput, Promise<RejectGuideOutput>
>(
  async () => {
    throw new Error("not implemented");
  }
);

/** US#15,#61: 신고된 동네 지식 숨김 처리. */
export const hideArchiveItem = onCall<
  HideArchiveItemInput, Promise<HideArchiveItemOutput>
>(async () => {
  throw new Error("not implemented");
});
