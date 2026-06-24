import * as admin from "firebase-admin";
import {GeoPoint, Timestamp} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/v2/https";
import {ArchiveCategory, ArchiveItem, UserProfile} from "../types";
import {assertGuideApproved} from "../shared/guards";
import {
  CreateArchiveItemInput,
  CreateArchiveItemOutput,
  DeleteArchiveItemInput,
  DeleteArchiveItemOutput,
  ListNearbyArchiveItemsInput,
  ListNearbyArchiveItemsOutput,
  ReportArchiveItemInput,
  ReportArchiveItemOutput,
  UpdateArchiveItemInput,
  UpdateArchiveItemOutput,
} from "./types";

/**
 * archive 모듈 — 안내자의 동네 지식 등록/수정/삭제/신고, 탐방자의 탐색.
 * Slice 3 구현.
 *
 * Invariant(CONTEXT.md): 음성 없이 등록 불가, 정확 좌표(exactLocation)는
 * 작성자 본인을 제외한 누구에게도 노출하지 않는다.
 */

/** US#3~6: 녹음 전 1차 분류, 3개로 고정. */
const VALID_CATEGORIES: ArchiveCategory[] = ["PLACE", "WALK", "OTHER"];

/** US#12: 노출 반경(3km) 고정값. */
const VISIBILITY_RADIUS_M = 3000;

/**
 * 두 좌표 사이의 거리(미터)를 Haversine 공식으로 계산한다.
 *
 * @param {number} lat1 기준 위도.
 * @param {number} lng1 기준 경도.
 * @param {number} lat2 대상 위도.
 * @param {number} lng2 대상 경도.
 * @return {number} 두 좌표 사이의 거리(미터).
 */
function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const earthRadiusM = 6371000;
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const cosLat1 = Math.cos(toRad(lat1));
  const cosLat2 = Math.cos(toRad(lat2));
  const a = sinLat * sinLat + cosLat1 * cosLat2 * sinLng * sinLng;
  return earthRadiusM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * users/{uid} 문서를 조회한다. 존재하지 않으면 not-found 에러를 던진다.
 *
 * @param {string} uid 조회할 사용자 uid.
 * @return {Promise<UserProfile>} 조회된 사용자 프로필.
 */
async function getUser(uid: string): Promise<UserProfile> {
  const snap = await admin.firestore().collection("users").doc(uid).get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "사용자를 찾을 수 없습니다.");
  }
  return {id: snap.id, ...(snap.data() as Omit<UserProfile, "id">)};
}

/**
 * US#1,#3~9: 동네 지식 등록.
 * Invariant(CONTEXT.md): 음성 없이 등록 불가, 정확 좌표는 작성자 본인에게만 노출.
 */
export const createArchiveItem = onCall<
  CreateArchiveItemInput,
  Promise<CreateArchiveItemOutput>
>(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }

  const {category, voiceTranscript, photoUrls, location} = request.data;

  if (!VALID_CATEGORIES.includes(category)) {
    throw new HttpsError("invalid-argument", "유효하지 않은 카테고리입니다.");
  }

  const transcript = voiceTranscript?.trim();
  if (!transcript) {
    throw new HttpsError("invalid-argument", "voiceTranscript는 필수입니다.");
  }

  if (
    !location ||
    typeof location.lat !== "number" ||
    typeof location.lng !== "number"
  ) {
    throw new HttpsError("invalid-argument", "위치 좌표가 필요합니다.");
  }

  const uid = request.auth.uid;
  const user = await getUser(uid);
  assertGuideApproved(user);

  const ref = admin.firestore().collection("archiveItems").doc();
  const now = Timestamp.now();
  const stored: Omit<ArchiveItem, "id"> = {
    authorId: uid,
    category,
    voiceTranscript: transcript,
    aiSummary: null,
    // TODO(Slice 4): AI 요약 확인 단계 도입 시 confirmedByAuthor 흐름 재검토.
    confirmedByAuthor: true,
    photoUrls: photoUrls ?? [],
    exactLocation: new GeoPoint(location.lat, location.lng),
    // TODO: 역지오코딩 미연동. 임시 fallback이며 연동 후 실제 행정동으로 교체.
    dongLabel: "행정동 확인 필요",
    visibilityRadiusM: VISIBILITY_RADIUS_M,
    published: true,
    reportCount: 0,
    hidden: false,
    createdAt: now,
    updatedAt: now,
  };

  await ref.set(stored);

  return {item: {id: ref.id, ...stored}};
});

/** US#9: 안내자 본인의 동네 지식 수정. */
export const updateArchiveItem = onCall<
  UpdateArchiveItemInput,
  Promise<UpdateArchiveItemOutput>
>(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }

  const {itemId, category, voiceTranscript, photoUrls} = request.data;
  if (!itemId) {
    throw new HttpsError("invalid-argument", "itemId가 필요합니다.");
  }

  if (category !== undefined && !VALID_CATEGORIES.includes(category)) {
    throw new HttpsError("invalid-argument", "유효하지 않은 카테고리입니다.");
  }

  const uid = request.auth.uid;
  const ref = admin.firestore().collection("archiveItems").doc(itemId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "동네 지식을 찾을 수 없습니다.");
  }

  const existing = snap.data() as Omit<ArchiveItem, "id">;
  if (existing.authorId !== uid) {
    throw new HttpsError(
      "permission-denied",
      "본인이 등록한 동네 지식만 수정할 수 있습니다."
    );
  }

  const user = await getUser(uid);
  assertGuideApproved(user);

  const updates: Partial<ArchiveItem> = {updatedAt: Timestamp.now()};
  if (category !== undefined) {
    updates.category = category;
  }
  if (voiceTranscript !== undefined) {
    const trimmed = voiceTranscript.trim();
    if (!trimmed) {
      throw new HttpsError(
        "invalid-argument",
        "voiceTranscript는 빈 문자열일 수 없습니다."
      );
    }
    updates.voiceTranscript = trimmed;
  }
  if (photoUrls !== undefined) {
    updates.photoUrls = photoUrls;
  }

  await ref.update(updates);

  const updated = await ref.get();
  const item: ArchiveItem = {
    id: updated.id,
    ...(updated.data() as Omit<ArchiveItem, "id">),
  };

  return {item};
});

/** US#9: 안내자 본인의 동네 지식 삭제. */
export const deleteArchiveItem = onCall<
  DeleteArchiveItemInput,
  Promise<DeleteArchiveItemOutput>
>(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }

  const {itemId} = request.data;
  if (!itemId) {
    throw new HttpsError("invalid-argument", "itemId가 필요합니다.");
  }

  const uid = request.auth.uid;
  const ref = admin.firestore().collection("archiveItems").doc(itemId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "동네 지식을 찾을 수 없습니다.");
  }

  const existing = snap.data() as Omit<ArchiveItem, "id">;
  if (existing.authorId !== uid) {
    throw new HttpsError(
      "permission-denied",
      "본인이 등록한 동네 지식만 삭제할 수 있습니다."
    );
  }

  const user = await getUser(uid);
  assertGuideApproved(user);

  await ref.delete();

  return {deleted: true};
});

/** US#15: 신고 누적 → 운영자 사후 모더레이션 대상으로 표시. */
export const reportArchiveItem = onCall<
  ReportArchiveItemInput,
  Promise<ReportArchiveItemOutput>
>(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }

  const {itemId} = request.data;
  if (!itemId) {
    throw new HttpsError("invalid-argument", "itemId가 필요합니다.");
  }

  const db = admin.firestore();
  const ref = db.collection("archiveItems").doc(itemId);

  const reportCount = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      throw new HttpsError("not-found", "동네 지식을 찾을 수 없습니다.");
    }
    const current = (snap.data() as Omit<ArchiveItem, "id">).reportCount;
    const next = current + 1;
    tx.update(ref, {reportCount: next});
    return next;
  });

  return {reportCount};
});

/**
 * US#11~14: 탐방자가 반경 3km 이내 공개된 동네 지식 탐색.
 * Invariant: 응답에는 행정동 표시값만 포함, 정확 좌표(exactLocation) 제외.
 */
export const listNearbyArchiveItems = onCall<
  ListNearbyArchiveItemsInput,
  Promise<ListNearbyArchiveItemsOutput>
>(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }

  const {location, category} = request.data;
  if (
    !location ||
    typeof location.lat !== "number" ||
    typeof location.lng !== "number"
  ) {
    throw new HttpsError("invalid-argument", "위치 좌표가 필요합니다.");
  }

  let query: admin.firestore.Query = admin
    .firestore()
    .collection("archiveItems")
    .where("published", "==", true)
    .where("hidden", "==", false);

  if (category !== undefined) {
    if (!VALID_CATEGORIES.includes(category)) {
      throw new HttpsError("invalid-argument", "유효하지 않은 카테고리입니다.");
    }
    query = query.where("category", "==", category);
  }

  const snap = await query.get();

  const items: ListNearbyArchiveItemsOutput["items"] = [];
  for (const doc of snap.docs) {
    const item: ArchiveItem = {
      id: doc.id,
      ...(doc.data() as Omit<ArchiveItem, "id">),
    };
    // exactLocation을 거리 계산에만 사용하고, 응답에서는 구조분해로 제거한다.
    const {exactLocation, ...publicView} = item;
    const distanceM = haversineMeters(
      location.lat,
      location.lng,
      exactLocation.latitude,
      exactLocation.longitude
    );
    if (distanceM <= item.visibilityRadiusM) {
      items.push(publicView);
    }
  }

  return {items};
});
