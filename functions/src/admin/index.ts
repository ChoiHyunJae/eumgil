import * as admin from "firebase-admin";
import {Timestamp} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/v2/https";
import {assertOperator} from "../shared/guards";
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
 * Slice 5(Issue #7): hideArchiveItem(숨김), rejectGuide(승인 취소) 구현.
 * approveGuide는 안내자 승인 슬라이스 소관이라 이번 범위에서 stub 유지.
 * 운영자 권한은 custom claim(admin=true)으로 검증한다(assertOperator).
 */

/** US#16,#60: 안내자 승인. (승인 슬라이스 소관 — Slice 5 범위 외, stub 유지) */
export const approveGuide = onCall<
  ApproveGuideInput, Promise<ApproveGuideOutput>
>(
  async () => {
    throw new Error("not implemented");
  }
);

/**
 * US#16,#60 / Slice 5: 운영자가 안내자 승인을 취소한다.
 * guideApproved를 false로 갱신한다(matchBlockedUntil과 독립).
 */
export const rejectGuide = onCall<
  RejectGuideInput, Promise<RejectGuideOutput>
>(async (request) => {
  assertOperator(request.auth);

  const {userId} = request.data;
  if (!userId) {
    throw new HttpsError("invalid-argument", "userId가 필요합니다.");
  }

  const ref = admin.firestore().collection("users").doc(userId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "사용자를 찾을 수 없습니다.");
  }

  await ref.update({guideApproved: false, updatedAt: Timestamp.now()});

  return {guideApproved: false};
});

/** US#15,#61: 신고된 동네 지식을 운영자가 숨김 처리. */
export const hideArchiveItem = onCall<
  HideArchiveItemInput, Promise<HideArchiveItemOutput>
>(async (request) => {
  assertOperator(request.auth);

  const {itemId} = request.data;
  if (!itemId) {
    throw new HttpsError("invalid-argument", "itemId가 필요합니다.");
  }

  const ref = admin.firestore().collection("archiveItems").doc(itemId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "동네 지식을 찾을 수 없습니다.");
  }

  await ref.update({hidden: true, updatedAt: Timestamp.now()});

  return {hidden: true};
});
