import * as admin from "firebase-admin";
import {Timestamp} from "firebase-admin/firestore";
import type {CallableRequest} from "firebase-functions/v2/https";
import {
  approveGuide,
  hideArchiveItem,
  listPendingGuideApplications,
  rejectGuide,
} from "../src/admin";
import type {
  ApproveGuideOutput,
  HideArchiveItemOutput,
  ListPendingGuideApplicationsOutput,
  RejectGuideOutput,
} from "../src/admin/types";

/**
 * Slice 5 (admin, Issue #7) - hide reported archive items and revoke guide
 * approval. Operator permission is checked via the custom claim admin=true
 * (assertOperator).
 *
 * Callables are invoked directly via (fn as unknown as {run}).run(request).
 */

/** Operator: authenticated user carrying custom claim admin=true. */
const OPERATOR = {uid: "admin-operator", admin: true};
/** Authenticated user who is NOT an operator. */
const NON_OPERATOR = {uid: "normal-user", admin: false};

describe("admin module", () => {
  let app: admin.app.App;
  let db: admin.firestore.Firestore;

  beforeAll(() => {
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
      throw new Error(
        "FIRESTORE_EMULATOR_HOST is not set. " +
          "Run via `npm test` (firebase emulators:exec)."
      );
    }
    app = admin.initializeApp({projectId: "eumgil-test-harness"});
    db = admin.firestore(app);
  });

  afterAll(async () => {
    db.terminate();
    await app.delete();
  });

  /**
   * Builds a test CallableRequest. When auth is undefined the request is
   * treated as unauthenticated.
   * @param {{uid: string, admin: boolean} | undefined} auth Caller auth.
   * @param {unknown} data Function input payload.
   * @return {CallableRequest<unknown>} The constructed request.
   */
  function buildRequest(
    auth: {uid: string; admin: boolean} | undefined,
    data: unknown
  ): CallableRequest<unknown> {
    return {
      data,
      auth: auth === undefined ?
        undefined :
        {
          uid: auth.uid,
          token: {admin: auth.admin} as unknown,
          rawToken: "dummy",
        } as CallableRequest["auth"],
      rawRequest: {} as CallableRequest["rawRequest"],
      acceptsStreaming: false,
    } as CallableRequest<unknown>;
  }

  /**
   * Invokes a v2 onCall function directly through its .run() method.
   * @param {unknown} fn The callable function to invoke.
   * @param {CallableRequest<unknown>} request The request to pass in.
   * @return {Promise<O>} The callable result.
   */
  function runCallable<O>(
    fn: unknown,
    request: CallableRequest<unknown>
  ): Promise<O> {
    return (fn as {
      run: (r: CallableRequest<unknown>) => Promise<O>;
    }).run(request);
  }

  /**
   * Creates an archiveItems/{id} document with hidden=false (minimal fixture).
   * @param {string} id Document id.
   * @return {Promise<void>} Resolves once the write completes.
   */
  async function seedArchiveItem(id: string): Promise<void> {
    await db.collection("archiveItems").doc(id).set({
      authorId: "seed-guide",
      category: "PLACE",
      voiceTranscript: "seed transcript",
      reportCount: 3,
      published: true,
      hidden: false,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  }

  /**
   * Creates a users/{id} document with guideApproved=true.
   * @param {string} id User uid.
   * @return {Promise<void>} Resolves once the write completes.
   */
  async function seedApprovedGuide(id: string): Promise<void> {
    await db.collection("users").doc(id).set({
      phoneNumber: "+821000000000",
      emergencyContact: {name: "Guardian", phoneNumber: "+821011112222"},
      guideApproved: true,
      matchBlockedUntil: null,
      noShowCount: 0,
      guideStats: {
        averageSatisfaction: null,
        totalRequestsReceived: 0,
        completedEscortCount: 0,
      },
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  }

  /**
   * Creates a users/{id} document with guideApproved=false. matchBlockedUntil
   * is set to a non-null value so approval can be checked not to touch it.
   * @param {string} id User uid.
   * @param {Timestamp | null} matchBlockedUntil Initial match-block expiry.
   * @return {Promise<void>} Resolves once the write completes.
   */
  async function seedUnapprovedGuide(
    id: string,
    matchBlockedUntil: Timestamp | null
  ): Promise<void> {
    await db.collection("users").doc(id).set({
      phoneNumber: "+821000000000",
      emergencyContact: {name: "Guardian", phoneNumber: "+821011112222"},
      guideApproved: false,
      matchBlockedUntil,
      noShowCount: 0,
      guideStats: {
        averageSatisfaction: null,
        totalRequestsReceived: 0,
        completedEscortCount: 0,
      },
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  }

  /**
   * Creates a guideApplications/{auto} doc with status=pending for a user.
   * @param {string} userId Applicant uid.
   * @return {Promise<string>} The created application document id.
   */
  async function seedPendingApplication(userId: string): Promise<string> {
    const ref = db.collection("guideApplications").doc();
    await ref.set({
      userId,
      status: "pending",
      appliedAt: Timestamp.now(),
      reviewedAt: null,
      reviewedBy: null,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    return ref.id;
  }

  it("operator can hide archive item", async () => {
    const itemId = "hide-target-item";
    await seedArchiveItem(itemId);

    const result = await runCallable<HideArchiveItemOutput>(
      hideArchiveItem,
      buildRequest(OPERATOR, {itemId})
    );
    expect(result.hidden).toBe(true);

    const doc = await db.collection("archiveItems").doc(itemId).get();
    expect(doc.data()?.hidden).toBe(true);
  });

  it("non-operator cannot hide archive item", async () => {
    const itemId = "hide-forbidden-item";
    await seedArchiveItem(itemId);

    await expect(
      runCallable<HideArchiveItemOutput>(
        hideArchiveItem,
        buildRequest(NON_OPERATOR, {itemId})
      )
    ).rejects.toThrow();

    const doc = await db.collection("archiveItems").doc(itemId).get();
    expect(doc.data()?.hidden).toBe(false);
  });

  it("unauthenticated user cannot hide archive item", async () => {
    const itemId = "hide-unauth-item";
    await seedArchiveItem(itemId);

    await expect(
      runCallable<HideArchiveItemOutput>(
        hideArchiveItem,
        buildRequest(undefined, {itemId})
      )
    ).rejects.toThrow();
  });

  it("missing archive item rejects", async () => {
    await expect(
      runCallable<HideArchiveItemOutput>(
        hideArchiveItem,
        buildRequest(OPERATOR, {itemId: "no-such-item"})
      )
    ).rejects.toThrow();
  });

  it("operator can approve guide", async () => {
    const userId = "approve-target-user";
    await seedUnapprovedGuide(userId, null);

    const result = await runCallable<ApproveGuideOutput>(
      approveGuide,
      buildRequest(OPERATOR, {userId})
    );
    expect(result.guideApproved).toBe(true);

    const doc = await db.collection("users").doc(userId).get();
    expect(doc.data()?.guideApproved).toBe(true);
  });

  it("approval does not touch matchBlockedUntil", async () => {
    const userId = "approve-blocked-user";
    const blockedUntil = Timestamp.fromMillis(Date.now() + 86_400_000);
    await seedUnapprovedGuide(userId, blockedUntil);

    await runCallable<ApproveGuideOutput>(
      approveGuide,
      buildRequest(OPERATOR, {userId})
    );

    const doc = await db.collection("users").doc(userId).get();
    expect(doc.data()?.guideApproved).toBe(true);
    expect(
      (doc.data()?.matchBlockedUntil as Timestamp).toMillis()
    ).toBe(blockedUntil.toMillis());
  });

  it("non-operator cannot approve guide", async () => {
    const userId = "approve-forbidden-user";
    await seedUnapprovedGuide(userId, null);

    await expect(
      runCallable<ApproveGuideOutput>(
        approveGuide,
        buildRequest(NON_OPERATOR, {userId})
      )
    ).rejects.toThrow();

    const doc = await db.collection("users").doc(userId).get();
    expect(doc.data()?.guideApproved).toBe(false);
  });

  it("unauthenticated user cannot approve guide", async () => {
    const userId = "approve-unauth-user";
    await seedUnapprovedGuide(userId, null);

    await expect(
      runCallable<ApproveGuideOutput>(
        approveGuide,
        buildRequest(undefined, {userId})
      )
    ).rejects.toThrow();

    const doc = await db.collection("users").doc(userId).get();
    expect(doc.data()?.guideApproved).toBe(false);
  });

  it("approving missing user rejects", async () => {
    await expect(
      runCallable<ApproveGuideOutput>(
        approveGuide,
        buildRequest(OPERATOR, {userId: "no-such-user"})
      )
    ).rejects.toThrow();
  });

  it("operator approving without userId rejects", async () => {
    await expect(
      runCallable<ApproveGuideOutput>(
        approveGuide,
        buildRequest(OPERATOR, {})
      )
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  it("operator can reject guide approval", async () => {
    const userId = "reject-target-user";
    await seedApprovedGuide(userId);

    const result = await runCallable<RejectGuideOutput>(
      rejectGuide,
      buildRequest(OPERATOR, {userId})
    );
    expect(result.guideApproved).toBe(false);

    const doc = await db.collection("users").doc(userId).get();
    expect(doc.data()?.guideApproved).toBe(false);
  });

  it("non-operator cannot reject guide approval", async () => {
    const userId = "reject-forbidden-user";
    await seedApprovedGuide(userId);

    await expect(
      runCallable<RejectGuideOutput>(
        rejectGuide,
        buildRequest(NON_OPERATOR, {userId})
      )
    ).rejects.toThrow();

    const doc = await db.collection("users").doc(userId).get();
    expect(doc.data()?.guideApproved).toBe(true);
  });

  it("unauthenticated user cannot reject guide approval", async () => {
    const userId = "reject-unauth-user";
    await seedApprovedGuide(userId);

    await expect(
      runCallable<RejectGuideOutput>(
        rejectGuide,
        buildRequest(undefined, {userId})
      )
    ).rejects.toThrow();
  });

  it("missing user rejects", async () => {
    await expect(
      runCallable<RejectGuideOutput>(
        rejectGuide,
        buildRequest(OPERATOR, {userId: "no-such-user"})
      )
    ).rejects.toThrow();
  });

  it("approval syncs the pending application to approved", async () => {
    const userId = "approve-syncs-app";
    await seedUnapprovedGuide(userId, null);
    const appId = await seedPendingApplication(userId);

    await runCallable<ApproveGuideOutput>(
      approveGuide,
      buildRequest(OPERATOR, {userId})
    );

    const appDoc = await db.collection("guideApplications").doc(appId).get();
    expect(appDoc.data()?.status).toBe("approved");
    expect(appDoc.data()?.reviewedBy).toBe(OPERATOR.uid);
    expect(appDoc.data()?.reviewedAt).not.toBeNull();
  });

  it("approval without a pending application is a no-op", async () => {
    const userId = "approve-no-app";
    await seedUnapprovedGuide(userId, null);

    const result = await runCallable<ApproveGuideOutput>(
      approveGuide,
      buildRequest(OPERATOR, {userId})
    );
    expect(result.guideApproved).toBe(true);

    const snap = await db
      .collection("guideApplications")
      .where("userId", "==", userId)
      .get();
    expect(snap.empty).toBe(true);
  });

  it("rejection syncs the pending application to rejected", async () => {
    const userId = "reject-syncs-app";
    await seedApprovedGuide(userId);
    const appId = await seedPendingApplication(userId);

    await runCallable<RejectGuideOutput>(
      rejectGuide,
      buildRequest(OPERATOR, {userId})
    );

    const appDoc = await db.collection("guideApplications").doc(appId).get();
    expect(appDoc.data()?.status).toBe("rejected");
    expect(appDoc.data()?.reviewedBy).toBe(OPERATOR.uid);
    expect(appDoc.data()?.reviewedAt).not.toBeNull();
  });

  it("operator can list pending guide applications", async () => {
    const userId = "list-pending-user";
    await seedPendingApplication(userId);

    const result = await runCallable<ListPendingGuideApplicationsOutput>(
      listPendingGuideApplications,
      buildRequest(OPERATOR, {})
    );

    expect(
      result.applications.some(
        (a) => a.userId === userId && a.status === "pending"
      )
    ).toBe(true);
    // Only pending applications are returned.
    expect(result.applications.every((a) => a.status === "pending")).toBe(true);
  });

  it("non-operator cannot list pending guide applications", async () => {
    await expect(
      runCallable<ListPendingGuideApplicationsOutput>(
        listPendingGuideApplications,
        buildRequest(NON_OPERATOR, {})
      )
    ).rejects.toThrow();
  });

  it("unauthenticated cannot list pending applications", async () => {
    await expect(
      runCallable<ListPendingGuideApplicationsOutput>(
        listPendingGuideApplications,
        buildRequest(undefined, {})
      )
    ).rejects.toThrow();
  });

  // ─── Slice 13: 안내자 자격 상실 시 소모임 자동 해산 ──────────────

  /**
   * groups/{id} 문서를 직접 생성하는 시드 헬퍼.
   * @param {string} groupId 문서 id.
   * @param {string} guideId 개설 안내자 uid.
   * @param {string[]} memberIds 전체 멤버 uid(안내자 포함).
   * @return {Promise<void>}
   */
  async function seedGroup(
    groupId: string,
    guideId: string,
    memberIds: string[]
  ): Promise<void> {
    await db.collection("groups").doc(groupId).set({
      guideId,
      memberIds,
      frequency: "WEEKLY",
      timeOfDay: "MORNING",
      kakaoOpenChatUrl: null,
      pendingInvites: [],
      dissolved: false,
      dissolvedReason: null,
      dissolvedAt: null,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  }

  it("안내자 승인 취소 시 해당 안내자가 개설한 비해산 소모임이 모두 해산된다", async () => {
    const guideId = "cascade-guide-1";
    await seedApprovedGuide(guideId);
    await seedGroup("cascade-group-1", guideId, [guideId, "traveler-a"]);
    await seedGroup("cascade-group-2", guideId, [guideId, "traveler-b", "traveler-c"]);

    await runCallable<RejectGuideOutput>(
      rejectGuide,
      buildRequest(OPERATOR, {userId: guideId})
    );

    const g1 = await db.collection("groups").doc("cascade-group-1").get();
    const g2 = await db.collection("groups").doc("cascade-group-2").get();

    expect(g1.data()?.dissolved).toBe(true);
    expect(g1.data()?.dissolvedReason).toBe("guide_unapproved");
    expect(g1.data()?.dissolvedAt).not.toBeNull();

    expect(g2.data()?.dissolved).toBe(true);
    expect(g2.data()?.dissolvedReason).toBe("guide_unapproved");
  });

  it("이미 해산된 소모임은 다시 건드리지 않는다", async () => {
    const guideId = "cascade-guide-2";
    await seedApprovedGuide(guideId);
    await seedGroup("cascade-already-dissolved", guideId, [guideId]);
    await db.collection("groups").doc("cascade-already-dissolved").update({
      dissolved: true,
      dissolvedReason: "manual",
      dissolvedAt: Timestamp.now(),
    });

    await runCallable<RejectGuideOutput>(
      rejectGuide,
      buildRequest(OPERATOR, {userId: guideId})
    );

    const doc = await db.collection("groups").doc("cascade-already-dissolved").get();
    // dissolvedReason이 manual 그대로여야 한다(덮어쓰지 않음)
    expect(doc.data()?.dissolvedReason).toBe("manual");
  });

  it("다른 안내자의 소모임은 해산되지 않는다", async () => {
    const guideId = "cascade-guide-3";
    const otherGuideId = "other-guide-unaffected";
    await seedApprovedGuide(guideId);
    await seedGroup("other-guide-group", otherGuideId, [otherGuideId, "traveler-x"]);

    await runCallable<RejectGuideOutput>(
      rejectGuide,
      buildRequest(OPERATOR, {userId: guideId})
    );

    const doc = await db.collection("groups").doc("other-guide-group").get();
    expect(doc.data()?.dissolved).toBe(false);
  });

  it("소모임이 없는 안내자 승인 취소는 정상 처리된다", async () => {
    const guideId = "cascade-guide-no-groups";
    await seedApprovedGuide(guideId);

    const result = await runCallable<RejectGuideOutput>(
      rejectGuide,
      buildRequest(OPERATOR, {userId: guideId})
    );
    expect(result.guideApproved).toBe(false);
  });
});
