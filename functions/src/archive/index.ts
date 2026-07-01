import * as admin from "firebase-admin";
import {GeoPoint, Timestamp} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/v2/https";
import {
  ArchiveCategory,
  ArchiveItem,
  AuthorProfileSummary,
  UserProfile,
} from "../types";
import {assertGuideApproved} from "../shared/guards";
import {
  CreateArchiveItemInput,
  CreateArchiveItemOutput,
  DeleteArchiveItemInput,
  DeleteArchiveItemOutput,
  GetAvailableDongsInput,
  GetAvailableDongsOutput,
  ListArchiveItemsByDongInput,
  ListArchiveItemsByDongOutput,
  ListMyArchiveItemsInput,
  ListMyArchiveItemsOutput,
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

/** 역지오코딩 미연동 시 사용하는 행정동 fallback 표시값. */
const DONG_FALLBACK = "행정동 확인 필요";

/**
 * MVP 데모용 행정동 bounding box. 외부 reverse geocoding 없이 서울/종로 인근
 * 데모 좌표를 예측 가능한 행정동 라벨로 매핑한다. 범위 밖은 fallback을 쓴다.
 */
const DONG_BOXES: ReadonlyArray<{
  label: string;
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}> = [
  {
    label: "종로구 청운효자동 인근",
    minLat: 37.578,
    maxLat: 37.595,
    minLng: 126.965,
    maxLng: 126.985,
  },
  {
    label: "종로구 사직동 인근",
    minLat: 37.565,
    maxLat: 37.578,
    minLng: 126.96,
    maxLng: 126.973,
  },
  {
    label: "종로구 광화문·세종로 인근",
    minLat: 37.568,
    maxLat: 37.58,
    minLng: 126.973,
    maxLng: 126.99,
  },
  {
    label: "종로구 혜화동 인근",
    minLat: 37.58,
    maxLat: 37.595,
    minLng: 126.995,
    maxLng: 127.01,
  },
];

/**
 * US#13 / Slice 3: 좌표를 행정동 표시값으로 변환한다(외부 API 미연동 MVP).
 * 데모 bounding box에 들면 해당 행정동 라벨을, 아니면 fallback을 반환한다.
 *
 * @param {number} lat 위도.
 * @param {number} lng 경도.
 * @return {string} 행정동 표시값(또는 "행정동 확인 필요").
 */
function resolveDongLabel(lat: number, lng: number): string {
  for (const box of DONG_BOXES) {
    if (
      lat >= box.minLat &&
      lat <= box.maxLat &&
      lng >= box.minLng &&
      lng <= box.maxLng
    ) {
      return box.label;
    }
  }
  return DONG_FALLBACK;
}

/**
 * 동 단위 입력/검색을 지원하기 위한 동 정보.
 * 각 동의 대표 좌표(중심점)를 포함해 동 이름만으로 등록 시 exactLocation을 추정한다.
 * label은 DONG_BOXES의 label과 동일하게 유지한다.
 */
const DONG_DATA: ReadonlyArray<{
  label: string;
  centerLat: number;
  centerLng: number;
}> = [
  {label: "종로구 청운효자동 인근", centerLat: 37.5865, centerLng: 126.975},
  {label: "종로구 사직동 인근", centerLat: 37.5715, centerLng: 126.9665},
  {
    label: "종로구 광화문·세종로 인근",
    centerLat: 37.574,
    centerLng: 126.9815,
  },
  {label: "종로구 혜화동 인근", centerLat: 37.5875, centerLng: 127.0025},
];

/** 등록/검색에 사용 가능한 동 이름 목록. */
export const AVAILABLE_DONGS: ReadonlyArray<string> =
  DONG_DATA.map((d) => d.label);

/**
 * dong 이름으로 해당 동의 대표 좌표를 반환한다. 지원하지 않는 동이면 null.
 *
 * @param {string} dong 동 이름.
 * @return {{lat: number; lng: number} | null} 대표 좌표 또는 null.
 */
function dongToCoords(dong: string): {lat: number; lng: number} | null {
  const found = DONG_DATA.find((d) => d.label === dong);
  if (!found) return null;
  return {lat: found.centerLat, lng: found.centerLng};
}

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

  const {category, voiceTranscript, photoUrls, location, dong} = request.data;

  if (!VALID_CATEGORIES.includes(category)) {
    throw new HttpsError("invalid-argument", "유효하지 않은 카테고리입니다.");
  }

  const transcript = voiceTranscript?.trim();
  if (!transcript) {
    throw new HttpsError("invalid-argument", "voiceTranscript는 필수입니다.");
  }

  // location 또는 dong 중 하나는 반드시 제공해야 한다.
  let resolvedLat: number;
  let resolvedLng: number;
  let resolvedDongLabel: string;

  if (dong) {
    const coords = dongToCoords(dong);
    if (!coords) {
      throw new HttpsError(
        "invalid-argument",
        `지원하지 않는 동입니다: ${dong}. getAvailableDongs로 목록을 확인하세요.`
      );
    }
    resolvedLat = coords.lat;
    resolvedLng = coords.lng;
    resolvedDongLabel = dong;
  } else if (
    location &&
    typeof location.lat === "number" &&
    typeof location.lng === "number"
  ) {
    resolvedLat = location.lat;
    resolvedLng = location.lng;
    resolvedDongLabel = resolveDongLabel(location.lat, location.lng);
  } else {
    throw new HttpsError(
      "invalid-argument",
      "dong 또는 location 중 하나는 반드시 제공해야 합니다."
    );
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
    exactLocation: new GeoPoint(resolvedLat, resolvedLng),
    dongLabel: resolvedDongLabel,
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
    // exactLocation이 없거나 잘못된 문서는 거리 계산이 불가하므로 결과에서 제외한다
    // (타입상 GeoPoint이지만 런타임 문서가 이를 보장하지 않는다).
    if (
      !exactLocation ||
      typeof exactLocation.latitude !== "number" ||
      typeof exactLocation.longitude !== "number"
    ) {
      continue;
    }
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

  // Slice 3: 작성 안내자 프로필 요약(거주 연차·관심 분야)을 optional로 덧붙인다.
  const authorIds = [...new Set(items.map((i) => i.authorId))];
  const db = admin.firestore();
  const authorSnaps = await Promise.all(
    authorIds.map((id) => db.collection("users").doc(id).get())
  );
  const profileById = new Map<string, AuthorProfileSummary>();
  authorSnaps.forEach((s, idx) => {
    if (!s.exists) return;
    const u = s.data() as Omit<UserProfile, "id">;
    const summary: AuthorProfileSummary = {};
    const years = u.residenceYears ?? u.residencyYears;
    if (typeof years === "number") {
      summary.residenceYears = years;
    }
    if (Array.isArray(u.interests) && u.interests.length > 0) {
      summary.interests = u.interests;
    }
    if (summary.residenceYears !== undefined || summary.interests) {
      profileById.set(authorIds[idx], summary);
    }
  });
  for (const item of items) {
    const profile = profileById.get(item.authorId);
    if (profile) {
      item.authorProfile = profile;
    }
  }

  return {items};
});

/**
 * 동 이름으로 해당 동의 공개된 동네 지식 목록을 조회한다.
 * Invariant: 응답에는 행정동 표시값만 포함, 정확 좌표(exactLocation) 제외.
 */
export const listArchiveItemsByDong = onCall<
  ListArchiveItemsByDongInput,
  Promise<ListArchiveItemsByDongOutput>
>(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }

  const {dong, category} = request.data;
  if (!dong || typeof dong !== "string" || !dong.trim()) {
    throw new HttpsError("invalid-argument", "dong은 필수입니다.");
  }
  if (!AVAILABLE_DONGS.includes(dong)) {
    throw new HttpsError(
      "invalid-argument",
      `지원하지 않는 동입니다: ${dong}.`
    );
  }
  if (category !== undefined && !VALID_CATEGORIES.includes(category)) {
    throw new HttpsError("invalid-argument", "유효하지 않은 카테고리입니다.");
  }

  const snap = await admin
    .firestore()
    .collection("archiveItems")
    .where("dongLabel", "==", dong)
    .get();

  const items: ListArchiveItemsByDongOutput["items"] = [];
  for (const doc of snap.docs) {
    const item: ArchiveItem = {
      id: doc.id,
      ...(doc.data() as Omit<ArchiveItem, "id">),
    };
    if (!item.published || item.hidden) continue;
    if (category !== undefined && item.category !== category) continue;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const {exactLocation, ...publicView} = item;
    items.push(publicView);
  }

  // 작성 안내자 프로필 요약 덧붙이기.
  const authorIds = [...new Set(items.map((i) => i.authorId))];
  const db = admin.firestore();
  const authorSnaps = await Promise.all(
    authorIds.map((id) => db.collection("users").doc(id).get())
  );
  const profileById = new Map<string, AuthorProfileSummary>();
  authorSnaps.forEach((s, idx) => {
    if (!s.exists) return;
    const u = s.data() as Omit<UserProfile, "id">;
    const summary: AuthorProfileSummary = {};
    const years = u.residenceYears ?? u.residencyYears;
    if (typeof years === "number") summary.residenceYears = years;
    if (Array.isArray(u.interests) && u.interests.length > 0) {
      summary.interests = u.interests;
    }
    if (summary.residenceYears !== undefined || summary.interests) {
      profileById.set(authorIds[idx], summary);
    }
  });
  for (const item of items) {
    const profile = profileById.get(item.authorId);
    if (profile) item.authorProfile = profile;
  }

  return {items};
});

/**
 * 등록/검색에 사용 가능한 동 이름 목록을 반환한다.
 */
export const getAvailableDongs = onCall<
  GetAvailableDongsInput,
  Promise<GetAvailableDongsOutput>
>((request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  return Promise.resolve({dongs: [...AVAILABLE_DONGS]});
});

/**
 * 호출자 본인이 등록한 동네 지식 목록을 조회한다(hidden 여부 무관, 자기 관리용).
 * 안내자가 동행 만남 장소를 본인 동네 지식 중에서 선택할 때 사용한다.
 */
export const listMyArchiveItems = onCall<
  ListMyArchiveItemsInput,
  Promise<ListMyArchiveItemsOutput>
>(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }

  const uid = request.auth.uid;
  const snap = await admin
    .firestore()
    .collection("archiveItems")
    .where("authorId", "==", uid)
    .get();

  const items: ArchiveItem[] = snap.docs
    .map((doc) => ({id: doc.id, ...(doc.data() as Omit<ArchiveItem, "id">)}))
    .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());

  return {items};
});
