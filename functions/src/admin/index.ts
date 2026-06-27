import * as admin from "firebase-admin";
import {Timestamp} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/v2/https";
import {assertOperator} from "../shared/guards";
import {
  ArchiveItem,
  Group,
  GuideApplication,
  GuideApplicationStatus,
  UserProfile,
} from "../types";
import {
  ApproveGuideInput,
  ApproveGuideOutput,
  ApprovedGuideView,
  DeleteArchiveItemAsAdminInput,
  DeleteArchiveItemAsAdminOutput,
  HideArchiveItemInput,
  HideArchiveItemOutput,
  ListApprovedGuidesInput,
  ListApprovedGuidesOutput,
  ListPendingGuideApplicationsInput,
  ListPendingGuideApplicationsOutput,
  ListReportedArchiveItemsInput,
  ListReportedArchiveItemsOutput,
  RejectGuideInput,
  RejectGuideOutput,
  ReportedArchiveItemView,
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
 * 안내자가 개설한 모든 비해산 소모임을 자동 해산한다.
 * Slice 13 (Issue #15): rejectGuide의 cascade 처리.
 * AC: 권한 위임 없이 종료 — 다른 멤버가 이어받는 경로 없음.
 *
 * @param {string} guideId 자격을 잃은 안내자 uid.
 * @param {Timestamp} now 해산 시각.
 * @return {Promise<string[]>} 알림 대상 멤버 uid 목록(안내자 본인 제외).
 */
async function dissolveGuideGroups(
  guideId: string,
  now: Timestamp
): Promise<string[]> {
  const db = admin.firestore();
  const groupsSnap = await db
    .collection("groups")
    .where("guideId", "==", guideId)
    .where("dissolved", "==", false)
    .get();

  if (groupsSnap.empty) return [];

  const batch = db.batch();
  const notifySet = new Set<string>();

  for (const doc of groupsSnap.docs) {
    batch.update(doc.ref, {
      dissolved: true,
      dissolvedReason: "guide_unapproved",
      dissolvedAt: now,
      updatedAt: now,
    });
    const group = doc.data() as Group;
    for (const memberId of group.memberIds) {
      if (memberId !== guideId) notifySet.add(memberId);
    }
  }

  await batch.commit();
  return Array.from(notifySet);
}

/**
 * 소모임 자동 해산 알림 발송.
 * TODO: 카카오 알림톡 / FCM 연동 — 외부 알림 API 미구현으로 현재 stub.
 *
 * @param {string[]} memberIds 알림 수신 대상 uid 목록.
 * @param {string} guideId 자격을 잃은 안내자 uid.
 * @return {Promise<void>}
 */
async function notifyGroupDissolution(
  memberIds: string[],
  guideId: string
): Promise<void> {
  if (memberIds.length === 0) return;
  // stub: 실제 알림 API 연동 시 여기에 구현
  console.info(
    `[stub] 소모임 해산 알림 대상 ${memberIds.length}명 (안내자: ${guideId})`
  );
}

/**
 * admin 모듈 — 운영자 전용 안내자 승인/거부, 신고된 동네 지식 숨김.
 * Slice 13(Issue #15): rejectGuide에 소모임 자동 해산 cascade 추가.
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

  const now = Timestamp.now();
  await ref.update({guideApproved: false, updatedAt: now});
  await syncGuideApplicationStatus(userId, "rejected", request.auth.uid);

  // Slice 13 (Issue #15): 안내자 자격 상실 시 소모임 자동 해산 cascade.
  const notifyTargets = await dissolveGuideGroups(userId, now);
  await notifyGroupDissolution(notifyTargets, userId);

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

/**
 * US#15,#61 / Slice 5: 신고된(reportCount>0) 동네 지식 검토 목록 조회.
 * reportCount>0 단일 부등식 쿼리만 사용하고(복합 색인 회피), hidden 필터·정렬은
 * 메모리에서 처리한다. reportCount 내림차순(동률이면 updatedAt 최신)으로 정렬하며,
 * exactLocation은 응답에서 제외한다.
 */
export const listReportedArchiveItems = onCall<
  ListReportedArchiveItemsInput,
  Promise<ListReportedArchiveItemsOutput>
>(async (request) => {
  assertOperator(request.auth);
  const includeHidden = request.data?.includeHidden === true;

  const snap = await admin
    .firestore()
    .collection("archiveItems")
    .where("reportCount", ">", 0)
    .get();

  const items: ReportedArchiveItemView[] = snap.docs
    .map((doc) => ({id: doc.id, ...(doc.data() as Omit<ArchiveItem, "id">)}))
    .filter((item) => includeHidden || item.hidden !== true)
    .sort((a, b) => {
      if (b.reportCount !== a.reportCount) {
        return b.reportCount - a.reportCount;
      }
      return b.updatedAt.toMillis() - a.updatedAt.toMillis();
    })
    .map((item) => ({
      id: item.id,
      authorId: item.authorId,
      category: item.category,
      voiceTranscript: item.voiceTranscript,
      aiSummary: item.aiSummary ?? null,
      dongLabel: item.dongLabel ?? "행정동 확인 필요",
      reportCount: item.reportCount,
      hidden: item.hidden === true,
      published: item.published === true,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));

  return {items};
});

/**
 * US#15,#61 / Slice 5: 운영자가 신고된 동네 지식을 영구 삭제한다.
 * 안내자 본인 삭제(archive/deleteArchiveItem)와 별개의 운영자 전용 경로다.
 */
export const deleteArchiveItemAsAdmin = onCall<
  DeleteArchiveItemAsAdminInput,
  Promise<DeleteArchiveItemAsAdminOutput>
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

  await ref.delete();

  return {deleted: true};
});

/**
 * US#16,#60 / Slice 5: 운영자가 승인된 안내자(guideApproved==true) 목록을 조회한다.
 * 자격 상실 처리는 기존 rejectGuide(userId)를 재사용한다. 단일 등식 쿼리로 색인 불필요.
 */
export const listApprovedGuides = onCall<
  ListApprovedGuidesInput,
  Promise<ListApprovedGuidesOutput>
>(async (request) => {
  assertOperator(request.auth);

  const snap = await admin
    .firestore()
    .collection("users")
    .where("guideApproved", "==", true)
    .get();

  const guides: ApprovedGuideView[] = snap.docs.map((doc) => {
    const user = doc.data() as Omit<UserProfile, "id">;
    const view: ApprovedGuideView = {
      userId: doc.id,
      phoneNumber: user.phoneNumber,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
    const years = user.residenceYears ?? user.residencyYears;
    if (typeof years === "number") {
      view.residenceYears = years;
    }
    if (Array.isArray(user.interests) && user.interests.length > 0) {
      view.interests = user.interests;
    }
    return view;
  });

  return {guides};
});
