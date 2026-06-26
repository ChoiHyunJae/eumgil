import * as admin from "firebase-admin";
import {Timestamp} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/v2/https";
import {assertGuideApproved} from "../shared/guards";
import {EscortPair, Group, GroupInvite, UserProfile} from "../types";
import {
  CreateGroupInput,
  CreateGroupOutput,
  DissolveGroupInput,
  DissolveGroupOutput,
  GetGroupInput,
  GetGroupOutput,
  InviteToGroupInput,
  InviteToGroupOutput,
  RespondToGroupInviteInput,
  RespondToGroupInviteOutput,
  RespondToSuggestionInput,
  RespondToSuggestionOutput,
  SuggestGroupInput,
  SuggestGroupOutput,
  UpdateGroupInput,
  UpdateGroupOutput,
} from "./types";

/**
 * group 모듈 — 소모임 자동 제안/응답/개설/초대/해산.
 * Slice 11 (Issue #13): suggestGroup, respondToSuggestion, createGroup,
 *   inviteToGroup, respondToGroupInvite, dissolveGroup 구현.
 * 제안 7일 무응답 만료는 scheduled/expireGroupSuggestions가 담당한다.
 */

const MAX_GROUP_SIZE = 4;
const SUGGESTION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * US#39~40: 같은 안내자-탐방자 쌍의 Completed 누적 3회 시점에 제안 생성.
 * 정상적으로는 escort 모듈의 completeEscort 처리 흐름에서 내부적으로 트리거되지만,
 * 팀 간 계약 가시성을 위해 callable로도 노출한다(운영/테스트 용도).
 */
export const suggestGroup = onCall<
  SuggestGroupInput, Promise<SuggestGroupOutput>
>(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }

  const {escortPairId} = request.data;
  if (!escortPairId) {
    throw new HttpsError("invalid-argument", "escortPairId가 필요합니다.");
  }

  const db = admin.firestore();
  const pairRef = db.collection("escortPairs").doc(escortPairId);

  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(pairRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", "동행 쌍을 찾을 수 없습니다.");
    }

    const pair = {id: snap.id, ...snap.data()} as EscortPair;

    // CONTEXT.md Invariant: Completed만 카운트. 제안은 1회만.
    if (
      pair.completedEscortCount < 3 ||
      pair.groupSuggestionStatus !== "none"
    ) {
      return {suggested: false};
    }

    const now = Timestamp.now();
    tx.update(pairRef, {
      groupSuggestionStatus: "proposed",
      suggestedAt: now,
      suggestionExpiresAt: Timestamp.fromMillis(now.toMillis() + SUGGESTION_EXPIRY_MS),
      guideConsentedAt: null,
      travelerConsentedAt: null,
      updatedAt: now,
    });

    return {suggested: true};
  });
});

/**
 * US#41~42,#51: 제안에 동의/거절. 양쪽 모두 동의해야 모임 생성, 거절 시 재제안 금지.
 * 양방향 동의 중간 상태는 EscortPair의 guideConsentedAt/travelerConsentedAt으로 추적.
 * 소모임 제안 수락으로 생성된 그룹의 frequency/timeOfDay는 기본값(WEEKLY/MORNING)으로 설정된다.
 */
export const respondToSuggestion = onCall<
  RespondToSuggestionInput,
  Promise<RespondToSuggestionOutput>
>(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }

  const {escortPairId, accept} = request.data;
  if (!escortPairId) {
    throw new HttpsError("invalid-argument", "escortPairId가 필요합니다.");
  }

  const callerUid = request.auth.uid;
  const db = admin.firestore();
  const pairRef = db.collection("escortPairs").doc(escortPairId);

  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(pairRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", "동행 쌍을 찾을 수 없습니다.");
    }

    const pair = {id: snap.id, ...snap.data()} as EscortPair;

    if (pair.groupSuggestionStatus !== "proposed") {
      throw new HttpsError(
        "failed-precondition",
        "진행 중인 소모임 제안이 없습니다."
      );
    }

    const now = Timestamp.now();
    if (pair.suggestionExpiresAt && pair.suggestionExpiresAt.toMillis() < now.toMillis()) {
      throw new HttpsError("failed-precondition", "소모임 제안이 만료됐습니다.");
    }

    const isGuide = callerUid === pair.guideId;
    const isTraveler = callerUid === pair.travelerId;
    if (!isGuide && !isTraveler) {
      throw new HttpsError(
        "permission-denied",
        "동행 쌍 참여자만 응답할 수 있습니다."
      );
    }

    // 거절: 즉시 확정. US#41: 재제안 금지.
    if (!accept) {
      tx.update(pairRef, {
        groupSuggestionStatus: "rejected",
        respondedAt: now,
        updatedAt: now,
      });
      return {status: "rejected"};
    }

    // 동의: 내 동의 기록 후 상대방 동의 여부 확인
    const myConsentField = isGuide ? "guideConsentedAt" : "travelerConsentedAt";
    const pairData = snap.data() as EscortPair;
    const otherConsentedAt = isGuide ?
      pairData.travelerConsentedAt :
      pairData.guideConsentedAt;

    if (!otherConsentedAt) {
      // 상대방 아직 미응답 — 내 동의만 기록
      tx.update(pairRef, {[myConsentField]: now, updatedAt: now});
      return {status: "accepted"};
    }

    // 양쪽 모두 동의 → 소모임 생성. US#42.
    const groupRef = db.collection("groups").doc();
    const group: Omit<Group, "id"> = {
      guideId: pair.guideId,
      memberIds: [pair.guideId, pair.travelerId],
      // 제안 수락 경로: frequency/timeOfDay 기본값. 이후 업데이트 callable 필요.
      frequency: "WEEKLY",
      timeOfDay: "MORNING",
      kakaoOpenChatUrl: null,
      pendingInvites: [],
      dissolved: false,
      dissolvedReason: null,
      dissolvedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    tx.set(groupRef, group);
    tx.update(pairRef, {
      [myConsentField]: now,
      groupSuggestionStatus: "accepted",
      resultingGroupId: groupRef.id,
      respondedAt: now,
      updatedAt: now,
    });

    return {status: "accepted", createdGroupId: groupRef.id};
  });
});

/**
 * US#44: 안내자가 소모임 직접 개설(제안 흐름과 별도 경로).
 * Invariant: 개설자는 안내자만 가능, 인원 상한 4인(개설자 포함).
 */
export const createGroup = onCall<
  CreateGroupInput, Promise<CreateGroupOutput>
>(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }

  const {frequency, timeOfDay, kakaoOpenChatUrl, initialMemberIds = []} =
    request.data;

  if (!frequency || !timeOfDay) {
    throw new HttpsError(
      "invalid-argument",
      "frequency와 timeOfDay는 필수입니다."
    );
  }

  const guideId = request.auth.uid;
  const db = admin.firestore();

  const userSnap = await db.collection("users").doc(guideId).get();
  if (!userSnap.exists) {
    throw new HttpsError("not-found", "사용자를 찾을 수 없습니다.");
  }
  assertGuideApproved(userSnap.data() as UserProfile);

  // CONTEXT.md Invariant: 소모임 인원은 4인을 넘을 수 없다.
  const memberIds = [guideId, ...initialMemberIds];
  if (memberIds.length > MAX_GROUP_SIZE) {
    throw new HttpsError(
      "invalid-argument",
      `소모임 인원은 최대 ${MAX_GROUP_SIZE}인입니다.`
    );
  }

  const now = Timestamp.now();
  const groupRef = db.collection("groups").doc();
  const group: Omit<Group, "id"> = {
    guideId,
    memberIds,
    frequency,
    timeOfDay,
    kakaoOpenChatUrl: kakaoOpenChatUrl ?? null,
    pendingInvites: [],
    dissolved: false,
    dissolvedReason: null,
    dissolvedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await groupRef.set(group);

  return {groupId: groupRef.id};
});

/**
 * US#45~46: 안내자가 신규 탐방자 초대 → 기존 탐방자 멤버 전원의 동의 필요.
 * 기존 탐방자 멤버가 없으면 즉시 수락(동의할 사람이 없음).
 * Invariant: 초대 권한은 개설 안내자에게만 있음, 인원 4인 초과 시 거부.
 */
export const inviteToGroup = onCall<
  InviteToGroupInput, Promise<InviteToGroupOutput>
>(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }

  const {groupId, travelerId} = request.data;
  if (!groupId || !travelerId) {
    throw new HttpsError("invalid-argument", "groupId와 travelerId가 필요합니다.");
  }

  const callerUid = request.auth.uid;
  const db = admin.firestore();
  const groupRef = db.collection("groups").doc(groupId);

  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(groupRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", "소모임을 찾을 수 없습니다.");
    }

    const group = {id: snap.id, ...snap.data()} as Group;

    if (group.dissolved) {
      throw new HttpsError("failed-precondition", "해산된 소모임입니다.");
    }

    if (callerUid !== group.guideId) {
      throw new HttpsError(
        "permission-denied",
        "초대 권한은 개설 안내자에게만 있습니다."
      );
    }

    if (group.memberIds.includes(travelerId)) {
      throw new HttpsError("already-exists", "이미 소모임 멤버입니다.");
    }

    // 활성 초대(pending)가 이미 있으면 중복 거부
    const hasActiveInvite = group.pendingInvites.some(
      (inv) => inv.travelerId === travelerId && inv.status === "pending"
    );
    if (hasActiveInvite) {
      throw new HttpsError("already-exists", "이미 진행 중인 초대가 있습니다.");
    }

    // CONTEXT.md Invariant: 소모임 인원은 4인을 넘을 수 없다.
    // pending 초대도 자리를 점유한다.
    const reservedSlots = group.pendingInvites.filter(
      (inv) => inv.status === "pending"
    ).length;
    if (group.memberIds.length + reservedSlots >= MAX_GROUP_SIZE) {
      throw new HttpsError(
        "resource-exhausted",
        "소모임 인원이 가득 찼습니다."
      );
    }

    const now = Timestamp.now();

    // 기존 탐방자 멤버(가이드 제외)가 없으면 즉시 수락
    const existingTravelerIds = group.memberIds.filter(
      (id) => id !== group.guideId
    );
    if (existingTravelerIds.length === 0) {
      tx.update(groupRef, {
        memberIds: [...group.memberIds, travelerId],
        updatedAt: now,
      });
      return {status: "accepted"};
    }

    // 기존 탐방자가 있으면 전원 동의 필요 — pendingInvites에 추가
    const newInvite: GroupInvite = {
      travelerId,
      invitedAt: now,
      consentingMemberIds: [],
      status: "pending",
    };
    tx.update(groupRef, {
      pendingInvites: [...group.pendingInvites, newInvite],
      updatedAt: now,
    });

    return {status: "pending"};
  });
});

/**
 * US#46: 기존 탐방자 멤버가 신규 초대에 동의/거절.
 * 전원 동의 시 travelerId → memberIds. 1명이라도 거절 시 invite rejected.
 * ⚠️ Slice 11 신규 callable — 팀 합의 필요.
 */
export const respondToGroupInvite = onCall<
  RespondToGroupInviteInput,
  Promise<RespondToGroupInviteOutput>
>(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }

  const {groupId, inviteTravelerId, accept} = request.data;
  if (!groupId || !inviteTravelerId) {
    throw new HttpsError(
      "invalid-argument",
      "groupId와 inviteTravelerId가 필요합니다."
    );
  }

  const callerUid = request.auth.uid;
  const db = admin.firestore();
  const groupRef = db.collection("groups").doc(groupId);

  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(groupRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", "소모임을 찾을 수 없습니다.");
    }

    const group = {id: snap.id, ...snap.data()} as Group;

    if (group.dissolved) {
      throw new HttpsError("failed-precondition", "해산된 소모임입니다.");
    }

    // 기존 탐방자 멤버만 동의 가능 (안내자 제외)
    const existingTravelerIds = group.memberIds.filter(
      (id) => id !== group.guideId
    );
    if (!existingTravelerIds.includes(callerUid)) {
      throw new HttpsError(
        "permission-denied",
        "기존 탐방자 멤버만 초대에 응답할 수 있습니다."
      );
    }

    const inviteIdx = group.pendingInvites.findIndex(
      (inv) => inv.travelerId === inviteTravelerId && inv.status === "pending"
    );
    if (inviteIdx === -1) {
      throw new HttpsError("not-found", "진행 중인 초대를 찾을 수 없습니다.");
    }

    const invite = group.pendingInvites[inviteIdx];
    const now = Timestamp.now();
    const updatedInvites = [...group.pendingInvites];

    if (!accept) {
      // 1명이라도 거절 → 초대 rejected
      updatedInvites[inviteIdx] = {...invite, status: "rejected"};
      tx.update(groupRef, {pendingInvites: updatedInvites, updatedAt: now});
      return {status: "rejected"};
    }

    // 동의: 내 uid 추가 후 전원 동의 여부 확인
    const newConsentingIds = [...invite.consentingMemberIds, callerUid];
    const allConsented = existingTravelerIds.every((id) =>
      newConsentingIds.includes(id)
    );

    if (!allConsented) {
      updatedInvites[inviteIdx] = {
        ...invite,
        consentingMemberIds: newConsentingIds,
      };
      tx.update(groupRef, {pendingInvites: updatedInvites, updatedAt: now});
      return {status: "pending"};
    }

    // 전원 동의 → 멤버로 추가, invite 목록에서 제거
    updatedInvites[inviteIdx] = {
      ...invite,
      consentingMemberIds: newConsentingIds,
      status: "accepted",
    };
    tx.update(groupRef, {
      memberIds: [...group.memberIds, inviteTravelerId],
      pendingInvites: updatedInvites,
      updatedAt: now,
    });

    return {status: "accepted"};
  });
});

/**
 * US#49 / Slice 12: 소모임 정보 수정(카카오톡 오픈채팅 링크 포함).
 * 개설 안내자만 수정 가능. 해산된 소모임은 수정 불가.
 */
export const updateGroup = onCall<
  UpdateGroupInput, Promise<UpdateGroupOutput>
>(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }

  const {groupId, kakaoOpenChatUrl, frequency, timeOfDay} = request.data;
  if (!groupId) {
    throw new HttpsError("invalid-argument", "groupId가 필요합니다.");
  }

  const callerUid = request.auth.uid;
  const db = admin.firestore();
  const groupRef = db.collection("groups").doc(groupId);

  const snap = await groupRef.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "소모임을 찾을 수 없습니다.");
  }

  const group = {id: snap.id, ...snap.data()} as Group;

  if (group.guideId !== callerUid) {
    throw new HttpsError("permission-denied", "개설 안내자만 수정할 수 있습니다.");
  }

  if (group.dissolved) {
    throw new HttpsError("failed-precondition", "해산된 소모임은 수정할 수 없습니다.");
  }

  const updates: Record<string, unknown> = {updatedAt: Timestamp.now()};
  // kakaoOpenChatUrl은 null로 명시하면 삭제, 문자열이면 등록/변경
  if (kakaoOpenChatUrl !== undefined) updates.kakaoOpenChatUrl = kakaoOpenChatUrl;
  if (frequency !== undefined) updates.frequency = frequency;
  if (timeOfDay !== undefined) updates.timeOfDay = timeOfDay;

  await groupRef.update(updates);

  return {updated: true};
});

/**
 * US#49 / Slice 12: 소모임 상세 조회. 멤버 전원에게 kakaoOpenChatUrl 노출.
 * 멤버 외 접근 불가.
 */
export const getGroup = onCall<
  GetGroupInput, Promise<GetGroupOutput>
>(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }

  const {groupId} = request.data;
  if (!groupId) {
    throw new HttpsError("invalid-argument", "groupId가 필요합니다.");
  }

  const callerUid = request.auth.uid;
  const db = admin.firestore();
  const snap = await db.collection("groups").doc(groupId).get();

  if (!snap.exists) {
    throw new HttpsError("not-found", "소모임을 찾을 수 없습니다.");
  }

  const group = {id: snap.id, ...snap.data()} as Group;

  if (!group.memberIds.includes(callerUid)) {
    throw new HttpsError("permission-denied", "소모임 멤버만 조회할 수 있습니다.");
  }

  return {
    groupId: group.id,
    guideId: group.guideId,
    memberIds: group.memberIds,
    frequency: group.frequency,
    timeOfDay: group.timeOfDay,
    kakaoOpenChatUrl: group.kakaoOpenChatUrl,
    dissolved: group.dissolved,
  };
});

/**
 * US#50: 소모임 해산(개설 안내자 자격 상실 시 자동 해산 로직과 동일 결과를 만드는 수동 경로).
 * 안내자 본인만 호출 가능.
 */
export const dissolveGroup = onCall<
  DissolveGroupInput, Promise<DissolveGroupOutput>
>(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }

  const {groupId} = request.data;
  if (!groupId) {
    throw new HttpsError("invalid-argument", "groupId가 필요합니다.");
  }

  const callerUid = request.auth.uid;
  const db = admin.firestore();
  const groupRef = db.collection("groups").doc(groupId);

  const snap = await groupRef.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "소모임을 찾을 수 없습니다.");
  }

  const group = {id: snap.id, ...snap.data()} as Group;

  if (group.guideId !== callerUid) {
    throw new HttpsError(
      "permission-denied",
      "소모임을 해산할 권한이 없습니다."
    );
  }

  if (group.dissolved) {
    throw new HttpsError("failed-precondition", "이미 해산된 소모임입니다.");
  }

  const now = Timestamp.now();
  await groupRef.update({
    dissolved: true,
    dissolvedReason: "manual",
    dissolvedAt: now,
    updatedAt: now,
  });

  return {status: "dissolved"};
});
