import * as admin from "firebase-admin";
import {Timestamp} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/v2/https";
import {UserProfile} from "../types";
import {UpdateUserProfileInput, UpdateUserProfileOutput} from "./types";

/**
 * 안내자 프로필(소개말·사진 URL)을 업데이트한다.
 * 호출자 본인의 users/{uid} 문서만 수정할 수 있다.
 */
export const updateUserProfile = onCall<
  UpdateUserProfileInput,
  Promise<UpdateUserProfileOutput>
>(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }

  const {bio, photoUrl} = request.data;

  if (bio !== undefined && typeof bio !== "string") {
    throw new HttpsError("invalid-argument", "bio는 문자열이어야 합니다.");
  }
  if (bio !== undefined && bio.length > 300) {
    throw new HttpsError("invalid-argument", "소개말은 300자 이하여야 합니다.");
  }
  if (photoUrl !== undefined && typeof photoUrl !== "string") {
    throw new HttpsError("invalid-argument", "photoUrl은 문자열이어야 합니다.");
  }

  const uid = request.auth.uid;
  const ref = admin.firestore().collection("users").doc(uid);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "사용자를 찾을 수 없습니다.");
  }

  const updates: Record<string, unknown> = {updatedAt: Timestamp.now()};
  if (bio !== undefined) updates.bio = bio;
  if (photoUrl !== undefined) updates.photoUrl = photoUrl;

  await ref.update(updates);

  const updated = (await ref.get()).data() as Omit<UserProfile, "id">;
  return {
    bio: updated.bio ?? null,
    photoUrl: updated.photoUrl ?? null,
  };
});
