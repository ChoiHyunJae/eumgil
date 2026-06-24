import * as admin from "firebase-admin";
import {Timestamp} from "firebase-admin/firestore";
import type {CallableRequest} from "firebase-functions/v2/https";
import {hideArchiveItem, rejectGuide} from "../src/admin";
import type {
  HideArchiveItemOutput,
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
});
