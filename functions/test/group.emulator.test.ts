import * as admin from "firebase-admin";
import {Timestamp} from "firebase-admin/firestore";
import type {CallableRequest} from "firebase-functions/v2/https";
import {
  createGroup,
  dissolveGroup,
  inviteToGroup,
  respondToGroupInvite,
  respondToSuggestion,
  suggestGroup,
} from "../src/group";
import type {
  CreateGroupOutput,
  DissolveGroupOutput,
  InviteToGroupOutput,
  RespondToGroupInviteOutput,
  RespondToSuggestionOutput,
  SuggestGroupOutput,
} from "../src/group/types";

/**
 * Slice 11 (group, Issue #13) — 소모임 생성 및 운영.
 * callable을 .run()으로 직접 호출해 입력/출력과 Firestore 최종 상태를 검증한다.
 */

const GUIDE = {uid: "guide-user-1", admin: false};
const TRAVELER = {uid: "traveler-user-1", admin: false};
const TRAVELER_2 = {uid: "traveler-user-2", admin: false};
const STRANGER = {uid: "stranger-user", admin: false};

describe("group module", () => {
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

  function buildRequest(
    auth: {uid: string; admin: boolean} | undefined,
    data: unknown
  ): CallableRequest<unknown> {
    return {
      data,
      auth:
        auth === undefined
          ? undefined
          : {
              uid: auth.uid,
              token: {admin: auth.admin} as unknown,
              rawToken: "dummy",
            } as CallableRequest["auth"],
      rawRequest: {} as CallableRequest["rawRequest"],
      acceptsStreaming: false,
    } as CallableRequest<unknown>;
  }

  function runCallable<O>(
    fn: unknown,
    request: CallableRequest<unknown>
  ): Promise<O> {
    return (
      fn as {run: (r: CallableRequest<unknown>) => Promise<O>}
    ).run(request);
  }

  // ─── 시드 헬퍼 ────────────────────────────────────────────────

  async function seedApprovedGuide(uid: string): Promise<void> {
    await db.collection("users").doc(uid).set({
      phoneNumber: "+821000000000",
      emergencyContact: {name: "보호자", phoneNumber: "+821011112222"},
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

  async function seedUnapprovedUser(uid: string): Promise<void> {
    await db.collection("users").doc(uid).set({
      phoneNumber: "+821099990000",
      emergencyContact: null,
      guideApproved: false,
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

  /** completedEscortCount를 지정해 escortPairs 문서를 생성. */
  async function seedEscortPair(
    pairId: string,
    guideId: string,
    travelerId: string,
    completedEscortCount: number,
    groupSuggestionStatus = "none"
  ): Promise<void> {
    await db.collection("escortPairs").doc(pairId).set({
      guideId,
      travelerId,
      completedEscortCount,
      groupSuggestionStatus,
      suggestedAt: null,
      suggestionExpiresAt: null,
      guideConsentedAt: null,
      travelerConsentedAt: null,
      respondedAt: null,
      resultingGroupId: null,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  }

  /** 이미 제안이 발송된 escortPair를 생성(suggestionExpiresAt을 미래로 설정). */
  async function seedProposedPair(
    pairId: string,
    guideId: string,
    travelerId: string
  ): Promise<void> {
    const now = Timestamp.now();
    await db.collection("escortPairs").doc(pairId).set({
      guideId,
      travelerId,
      completedEscortCount: 3,
      groupSuggestionStatus: "proposed",
      suggestedAt: now,
      suggestionExpiresAt: Timestamp.fromMillis(
        now.toMillis() + 7 * 24 * 60 * 60 * 1000
      ),
      guideConsentedAt: null,
      travelerConsentedAt: null,
      respondedAt: null,
      resultingGroupId: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  /** groups 문서를 직접 생성. */
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

  // ─── suggestGroup ─────────────────────────────────────────────

  describe("suggestGroup", () => {
    it("Completed 3회 누적 쌍에 제안이 생성된다", async () => {
      const pairId = "suggest-ok-pair";
      await seedEscortPair(pairId, GUIDE.uid, TRAVELER.uid, 3);

      const result = await runCallable<SuggestGroupOutput>(
        suggestGroup,
        buildRequest(GUIDE, {escortPairId: pairId})
      );
      expect(result.suggested).toBe(true);

      const doc = await db.collection("escortPairs").doc(pairId).get();
      expect(doc.data()?.groupSuggestionStatus).toBe("proposed");
      expect(doc.data()?.suggestedAt).not.toBeNull();
      expect(doc.data()?.suggestionExpiresAt).not.toBeNull();
    });

    it("Completed 2회 이하이면 제안하지 않는다", async () => {
      const pairId = "suggest-too-few-pair";
      await seedEscortPair(pairId, GUIDE.uid, TRAVELER.uid, 2);

      const result = await runCallable<SuggestGroupOutput>(
        suggestGroup,
        buildRequest(GUIDE, {escortPairId: pairId})
      );
      expect(result.suggested).toBe(false);

      const doc = await db.collection("escortPairs").doc(pairId).get();
      expect(doc.data()?.groupSuggestionStatus).toBe("none");
    });

    it("이미 제안된 쌍에 재제안하지 않는다", async () => {
      const pairId = "suggest-dup-pair";
      await seedProposedPair(pairId, GUIDE.uid, TRAVELER.uid);

      const result = await runCallable<SuggestGroupOutput>(
        suggestGroup,
        buildRequest(GUIDE, {escortPairId: pairId})
      );
      expect(result.suggested).toBe(false);
    });

    it("비인증 호출은 거부된다", async () => {
      await expect(
        runCallable<SuggestGroupOutput>(
          suggestGroup,
          buildRequest(undefined, {escortPairId: "any"})
        )
      ).rejects.toThrow();
    });
  });

  // ─── respondToSuggestion ──────────────────────────────────────

  describe("respondToSuggestion", () => {
    it("한쪽만 동의하면 그룹이 생성되지 않는다", async () => {
      const pairId = "respond-half-pair";
      await seedProposedPair(pairId, GUIDE.uid, TRAVELER.uid);

      const result = await runCallable<RespondToSuggestionOutput>(
        respondToSuggestion,
        buildRequest(GUIDE, {escortPairId: pairId, accept: true})
      );
      expect(result.status).toBe("accepted");
      expect(result.createdGroupId).toBeUndefined();

      const doc = await db.collection("escortPairs").doc(pairId).get();
      expect(doc.data()?.groupSuggestionStatus).toBe("proposed");
      expect(doc.data()?.guideConsentedAt).not.toBeNull();
    });

    it("양쪽 모두 동의하면 소모임이 생성된다", async () => {
      const pairId = "respond-both-pair";
      await seedProposedPair(pairId, GUIDE.uid, TRAVELER.uid);

      await runCallable<RespondToSuggestionOutput>(
        respondToSuggestion,
        buildRequest(GUIDE, {escortPairId: pairId, accept: true})
      );
      const result = await runCallable<RespondToSuggestionOutput>(
        respondToSuggestion,
        buildRequest(TRAVELER, {escortPairId: pairId, accept: true})
      );

      expect(result.status).toBe("accepted");
      expect(result.createdGroupId).toBeDefined();

      const pair = await db.collection("escortPairs").doc(pairId).get();
      expect(pair.data()?.groupSuggestionStatus).toBe("accepted");
      expect(pair.data()?.resultingGroupId).toBe(result.createdGroupId);

      const group = await db.collection("groups").doc(result.createdGroupId!).get();
      expect(group.exists).toBe(true);
      expect(group.data()?.memberIds).toContain(GUIDE.uid);
      expect(group.data()?.memberIds).toContain(TRAVELER.uid);
    });

    it("거절 시 즉시 rejected로 전환되고 재제안 불가 상태가 된다", async () => {
      const pairId = "respond-reject-pair";
      await seedProposedPair(pairId, GUIDE.uid, TRAVELER.uid);

      const result = await runCallable<RespondToSuggestionOutput>(
        respondToSuggestion,
        buildRequest(TRAVELER, {escortPairId: pairId, accept: false})
      );
      expect(result.status).toBe("rejected");

      const doc = await db.collection("escortPairs").doc(pairId).get();
      expect(doc.data()?.groupSuggestionStatus).toBe("rejected");
    });

    it("동행 쌍 외부인은 응답할 수 없다", async () => {
      const pairId = "respond-stranger-pair";
      await seedProposedPair(pairId, GUIDE.uid, TRAVELER.uid);

      await expect(
        runCallable<RespondToSuggestionOutput>(
          respondToSuggestion,
          buildRequest(STRANGER, {escortPairId: pairId, accept: true})
        )
      ).rejects.toThrow();
    });

    it("proposed 상태가 아닌 쌍에 응답하면 오류가 발생한다", async () => {
      const pairId = "respond-wrong-status-pair";
      await seedEscortPair(pairId, GUIDE.uid, TRAVELER.uid, 3, "rejected");

      await expect(
        runCallable<RespondToSuggestionOutput>(
          respondToSuggestion,
          buildRequest(GUIDE, {escortPairId: pairId, accept: true})
        )
      ).rejects.toThrow();
    });
  });

  // ─── createGroup ──────────────────────────────────────────────

  describe("createGroup", () => {
    beforeAll(async () => {
      await seedApprovedGuide(GUIDE.uid);
      await seedUnapprovedUser(STRANGER.uid);
    });

    it("승인된 안내자가 소모임을 직접 개설한다", async () => {
      const result = await runCallable<CreateGroupOutput>(
        createGroup,
        buildRequest(GUIDE, {frequency: "WEEKLY", timeOfDay: "MORNING"})
      );
      expect(result.groupId).toBeDefined();

      const doc = await db.collection("groups").doc(result.groupId).get();
      expect(doc.data()?.guideId).toBe(GUIDE.uid);
      expect(doc.data()?.memberIds).toEqual([GUIDE.uid]);
      expect(doc.data()?.frequency).toBe("WEEKLY");
      expect(doc.data()?.kakaoOpenChatUrl).toBeNull();
    });

    it("kakaoOpenChatUrl을 함께 등록할 수 있다", async () => {
      const result = await runCallable<CreateGroupOutput>(
        createGroup,
        buildRequest(GUIDE, {
          frequency: "MONTHLY",
          timeOfDay: "AFTERNOON",
          kakaoOpenChatUrl: "https://open.kakao.com/test",
        })
      );

      const doc = await db.collection("groups").doc(result.groupId).get();
      expect(doc.data()?.kakaoOpenChatUrl).toBe("https://open.kakao.com/test");
    });

    it("초기 멤버 포함 4인 초과 시 거부된다", async () => {
      await expect(
        runCallable<CreateGroupOutput>(
          createGroup,
          buildRequest(GUIDE, {
            frequency: "WEEKLY",
            timeOfDay: "MORNING",
            initialMemberIds: ["t1", "t2", "t3", "t4"],
          })
        )
      ).rejects.toThrow();
    });

    it("미승인 사용자는 소모임을 개설할 수 없다", async () => {
      await expect(
        runCallable<CreateGroupOutput>(
          createGroup,
          buildRequest(STRANGER, {frequency: "WEEKLY", timeOfDay: "MORNING"})
        )
      ).rejects.toThrow();
    });

    it("frequency 없이 개설하면 오류가 발생한다", async () => {
      await expect(
        runCallable<CreateGroupOutput>(
          createGroup,
          buildRequest(GUIDE, {timeOfDay: "MORNING"})
        )
      ).rejects.toMatchObject({code: "invalid-argument"});
    });
  });

  // ─── inviteToGroup ────────────────────────────────────────────

  describe("inviteToGroup", () => {
    it("기존 탐방자가 없으면 초대 즉시 수락된다", async () => {
      const groupId = "invite-auto-accept-group";
      await seedGroup(groupId, GUIDE.uid, [GUIDE.uid]);

      const result = await runCallable<InviteToGroupOutput>(
        inviteToGroup,
        buildRequest(GUIDE, {groupId, travelerId: TRAVELER.uid})
      );
      expect(result.status).toBe("accepted");

      const doc = await db.collection("groups").doc(groupId).get();
      expect(doc.data()?.memberIds).toContain(TRAVELER.uid);
    });

    it("기존 탐방자가 있으면 pending 상태가 된다", async () => {
      const groupId = "invite-pending-group";
      await seedGroup(groupId, GUIDE.uid, [GUIDE.uid, TRAVELER.uid]);

      const result = await runCallable<InviteToGroupOutput>(
        inviteToGroup,
        buildRequest(GUIDE, {groupId, travelerId: TRAVELER_2.uid})
      );
      expect(result.status).toBe("pending");

      const doc = await db.collection("groups").doc(groupId).get();
      const pendingInvites = doc.data()?.pendingInvites ?? [];
      expect(pendingInvites.some(
        (inv: {travelerId: string}) => inv.travelerId === TRAVELER_2.uid
      )).toBe(true);
    });

    it("안내자가 아닌 멤버는 초대할 수 없다", async () => {
      const groupId = "invite-no-perm-group";
      await seedGroup(groupId, GUIDE.uid, [GUIDE.uid, TRAVELER.uid]);

      await expect(
        runCallable<InviteToGroupOutput>(
          inviteToGroup,
          buildRequest(TRAVELER, {groupId, travelerId: TRAVELER_2.uid})
        )
      ).rejects.toThrow();
    });

    it("4인 정원 초과 시 초대가 거부된다", async () => {
      const groupId = "invite-full-group";
      await seedGroup(groupId, GUIDE.uid, [GUIDE.uid, "t1", "t2", "t3"]);

      await expect(
        runCallable<InviteToGroupOutput>(
          inviteToGroup,
          buildRequest(GUIDE, {groupId, travelerId: "t4"})
        )
      ).rejects.toThrow();
    });

    it("이미 멤버인 사용자를 초대하면 오류가 발생한다", async () => {
      const groupId = "invite-dup-member-group";
      await seedGroup(groupId, GUIDE.uid, [GUIDE.uid, TRAVELER.uid]);

      await expect(
        runCallable<InviteToGroupOutput>(
          inviteToGroup,
          buildRequest(GUIDE, {groupId, travelerId: TRAVELER.uid})
        )
      ).rejects.toThrow();
    });
  });

  // ─── respondToGroupInvite ─────────────────────────────────────

  describe("respondToGroupInvite", () => {
    it("기존 멤버 1명이 동의하면 pending이 유지된다", async () => {
      const groupId = "resp-invite-pending-group";
      await seedGroup(groupId, GUIDE.uid, [GUIDE.uid, TRAVELER.uid, TRAVELER_2.uid]);
      await db.collection("groups").doc(groupId).update({
        pendingInvites: [{
          travelerId: STRANGER.uid,
          invitedAt: Timestamp.now(),
          consentingMemberIds: [],
          status: "pending",
        }],
      });

      const result = await runCallable<RespondToGroupInviteOutput>(
        respondToGroupInvite,
        buildRequest(TRAVELER, {
          groupId,
          inviteTravelerId: STRANGER.uid,
          accept: true,
        })
      );
      expect(result.status).toBe("pending");

      const doc = await db.collection("groups").doc(groupId).get();
      const invite = doc.data()?.pendingInvites[0];
      expect(invite.consentingMemberIds).toContain(TRAVELER.uid);
      expect(doc.data()?.memberIds).not.toContain(STRANGER.uid);
    });

    it("전원 동의 시 초대받은 탐방자가 멤버로 추가된다", async () => {
      const groupId = "resp-invite-accepted-group";
      await seedGroup(groupId, GUIDE.uid, [GUIDE.uid, TRAVELER.uid]);
      await db.collection("groups").doc(groupId).update({
        pendingInvites: [{
          travelerId: STRANGER.uid,
          invitedAt: Timestamp.now(),
          consentingMemberIds: [],
          status: "pending",
        }],
      });

      const result = await runCallable<RespondToGroupInviteOutput>(
        respondToGroupInvite,
        buildRequest(TRAVELER, {
          groupId,
          inviteTravelerId: STRANGER.uid,
          accept: true,
        })
      );
      expect(result.status).toBe("accepted");

      const doc = await db.collection("groups").doc(groupId).get();
      expect(doc.data()?.memberIds).toContain(STRANGER.uid);
    });

    it("한 명이 거절하면 초대가 rejected된다", async () => {
      const groupId = "resp-invite-rejected-group";
      await seedGroup(groupId, GUIDE.uid, [GUIDE.uid, TRAVELER.uid, TRAVELER_2.uid]);
      await db.collection("groups").doc(groupId).update({
        pendingInvites: [{
          travelerId: STRANGER.uid,
          invitedAt: Timestamp.now(),
          consentingMemberIds: [],
          status: "pending",
        }],
      });

      const result = await runCallable<RespondToGroupInviteOutput>(
        respondToGroupInvite,
        buildRequest(TRAVELER, {
          groupId,
          inviteTravelerId: STRANGER.uid,
          accept: false,
        })
      );
      expect(result.status).toBe("rejected");

      const doc = await db.collection("groups").doc(groupId).get();
      expect(doc.data()?.memberIds).not.toContain(STRANGER.uid);
    });

    it("기존 탐방자가 아닌 사람은 응답할 수 없다", async () => {
      const groupId = "resp-invite-noperm-group";
      await seedGroup(groupId, GUIDE.uid, [GUIDE.uid, TRAVELER.uid]);
      await db.collection("groups").doc(groupId).update({
        pendingInvites: [{
          travelerId: STRANGER.uid,
          invitedAt: Timestamp.now(),
          consentingMemberIds: [],
          status: "pending",
        }],
      });

      await expect(
        runCallable<RespondToGroupInviteOutput>(
          respondToGroupInvite,
          buildRequest(TRAVELER_2, {
            groupId,
            inviteTravelerId: STRANGER.uid,
            accept: true,
          })
        )
      ).rejects.toThrow();
    });
  });

  // ─── dissolveGroup ────────────────────────────────────────────

  describe("dissolveGroup", () => {
    it("안내자가 소모임을 수동 해산할 수 있다", async () => {
      const groupId = "dissolve-ok-group";
      await seedGroup(groupId, GUIDE.uid, [GUIDE.uid, TRAVELER.uid]);

      const result = await runCallable<DissolveGroupOutput>(
        dissolveGroup,
        buildRequest(GUIDE, {groupId})
      );
      expect(result.status).toBe("dissolved");

      const doc = await db.collection("groups").doc(groupId).get();
      expect(doc.data()?.dissolved).toBe(true);
      expect(doc.data()?.dissolvedReason).toBe("manual");
      expect(doc.data()?.dissolvedAt).not.toBeNull();
    });

    it("안내자가 아닌 멤버는 해산할 수 없다", async () => {
      const groupId = "dissolve-noperm-group";
      await seedGroup(groupId, GUIDE.uid, [GUIDE.uid, TRAVELER.uid]);

      await expect(
        runCallable<DissolveGroupOutput>(
          dissolveGroup,
          buildRequest(TRAVELER, {groupId})
        )
      ).rejects.toThrow();

      const doc = await db.collection("groups").doc(groupId).get();
      expect(doc.data()?.dissolved).toBe(false);
    });

    it("이미 해산된 소모임은 다시 해산할 수 없다", async () => {
      const groupId = "dissolve-dup-group";
      await seedGroup(groupId, GUIDE.uid, [GUIDE.uid]);
      await db.collection("groups").doc(groupId).update({
        dissolved: true,
        dissolvedReason: "manual",
        dissolvedAt: Timestamp.now(),
      });

      await expect(
        runCallable<DissolveGroupOutput>(
          dissolveGroup,
          buildRequest(GUIDE, {groupId})
        )
      ).rejects.toThrow();
    });

    it("비인증 호출은 거부된다", async () => {
      await expect(
        runCallable<DissolveGroupOutput>(
          dissolveGroup,
          buildRequest(undefined, {groupId: "any"})
        )
      ).rejects.toThrow();
    });
  });
});
