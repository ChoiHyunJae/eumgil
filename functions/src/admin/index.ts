import * as admin from "firebase-admin";
import {Timestamp} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/v2/https";
import {assertOperator} from "../shared/guards";
import {GuideApplication, GuideApplicationStatus} from "../types";
import {
  ApproveGuideInput,
  ApproveGuideOutput,
  HideArchiveItemInput,
  HideArchiveItemOutput,
  ListPendingGuideApplicationsInput,
  ListPendingGuideApplicationsOutput,
  RejectGuideInput,
  RejectGuideOutput,
} from "./types";

/**
 * 사용자의 pending 안내자 신청을 승인/거부 결과로 동기화한다.
 * pending 신청이 없으면 아무 것도 하지 않는다(no-op) — 신청 흐름 없이 운영자가
 * 직접 승인/거부하는 기존 경로와 호환되도록.
 *
 * @param {string} userId 신청자 uid.
 * @param {GuideApplicationStatus} status 반영할 상태("approved" | "rejected").
 * @param {string} reviewedBy 처리한 운영자 uid.
 * @return {Promise<void>} 동기화 완료 시 resolve.
 */
async function syncGuideApplicationStatus(
  userId: string,
  status: Extract<GuideApplicationStatus, "approved" | "rejected">,
  reviewedBy: string
): Promise<void> {
  const db = admin.firestore();
  const snap = await db
    .collection("guideApplications")
    .where("userId", "==", userId)
    .where("status", "==", "pending")
    .get();
  if (snap.empty) {
    return;
  }

  const now = Timestamp.now();
  const batch = db.batch();
  for (const doc of snap.docs) {
    batch.update(doc.ref, {
      status,
      reviewedAt: now,
      reviewedBy,
      updatedAt: now,
    });
  }
  await batch.commit();
}

/**
 * admin 모듈 — 운영자 전용 안내자 승인/거부, 신고된 동네 지식 숨김.
 * Slice 5(Issue #7): hideArchiveItem(숨김), rejectGuide(승인 취소) 구현.
 * Slice 2(Issue #4): approveGuide(안내자 승인), listPendingGuideApplications
 *   (대기 신청 목록) 구현. 승인/거부 시 guideApplications 상태를 동기화한다.
 * 운영자 권한은 custom claim(admin=true)으로 검증한다(assertOperator).
 */

/**
 * US#16,#60 / Slice 2: 운영자가 오프라인 확인을 거친 안내자를 승인한다.
 * guideApproved를 true로 갱신한다. matchBlockedUntil(매칭 제한)은 독립된
 * 별도 필드이므로 승인 처리에서 절대 변경하지 않는다(Issue #4 AC, ADR-0001).
 */
export const approveGuide = onCall<
  ApproveGuideInput, Promise<ApproveGuideOutput>
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

  await ref.update({guideApproved: true, updatedAt: Timestamp.now()});
  await syncGuideApplicationStatus(userId, "approved", request.auth.uid);

  return {guideApproved: true};
});

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
  await syncGuideApplicationStatus(userId, "rejected", request.auth.uid);

  return {guideApproved: false};
});

/**
 * US#16,#60 / Slice 2: 운영자가 처리 대기 중인(pending) 안내자 신청 목록을 조회.
 * 운영자 전용 화면에서 승인/거부 대상을 확인하는 데 사용한다.
 */
export const listPendingGuideApplications = onCall<
  ListPendingGuideApplicationsInput,
  Promise<ListPendingGuideApplicationsOutput>
>(async (request) => {
  assertOperator(request.auth);

  const snap = await admin
    .firestore()
    .collection("guideApplications")
    .where("status", "==", "pending")
    .get();

  const applications: GuideApplication[] = snap.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Omit<GuideApplication, "id">),
  }));

  return {applications};
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
