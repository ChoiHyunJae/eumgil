import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/v2/https";
import {EmergencyContact, GuideStats, UserProfile} from "../types";
import {
  RegisterUserInput,
  RegisterUserOutput,
  UpdateEmergencyContactInput,
  UpdateEmergencyContactOutput,
} from "./types";

/**
 * user 모듈 — 사용자 등록(전화번호 인증 + 비상연락처 온보딩), 비상연락처 변경.
 * Slice 1 (Issue #3) 구현.
 *
 * assertEmergencyContactRegistered 가드(../shared/guards)는 동행 슬라이스가
 * 동행 시작 시점에 재사용할 용도로만 준비되어 있고, 이 모듈에서는 호출하지 않는다 —
 * 등록/변경 흐름은 가입 자체를 막을 이유가 없기 때문.
 */

/**
 * name, phoneNumber가 모두 비어 있지 않은 문자열인지 검증.
 * @param {unknown} value 검증할 값.
 * @return {boolean} EmergencyContact 형태를 만족하면 true.
 */
function isValidEmergencyContact(
  value: unknown
): value is EmergencyContact {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.name === "string" &&
    candidate.name.trim().length > 0 &&
    typeof candidate.phoneNumber === "string" &&
    candidate.phoneNumber.trim().length > 0
  );
}

const defaultGuideStats: GuideStats = {
  averageSatisfaction: null,
  totalRequestsReceived: 0,
  completedEscortCount: 0,
};

/**
 * US#52~53,#56~57: 전화번호 인증 로그인 후 최초 등록.
 * Invariant: 비상연락처는 건너뛰기 불가, 등록되지 않으면 이후 동행 시작 불가.
 * 같은 uid로 재호출되면 멱등 처리(기존 문서를 그대로 반환, 덮어쓰지 않음).
 */
export const registerUser = onCall<
  RegisterUserInput, Promise<RegisterUserOutput>
>(
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const phoneNumber = request.auth.token.phone_number;
    if (!phoneNumber) {
      throw new HttpsError(
        "failed-precondition",
        "전화번호 인증 토큰이 필요합니다."
      );
    }

    if (!isValidEmergencyContact(request.data?.emergencyContact)) {
      throw new HttpsError(
        "invalid-argument",
        "비상연락처(이름, 전화번호)를 모두 입력해야 합니다."
      );
    }

    const uid = request.auth.uid;
    const db = admin.firestore();
    const userRef = db.collection("users").doc(uid);
    const existing = await userRef.get();

    if (existing.exists) {
      return {userId: uid};
    }

    const newUser: Omit<UserProfile, "id"> = {
      phoneNumber,
      emergencyContact: request.data.emergencyContact,
      guideApproved: false,
      matchBlockedUntil: null,
      noShowCount: 0,
      guideStats: defaultGuideStats,
      createdAt:
        FieldValue.serverTimestamp() as unknown as UserProfile["createdAt"],
      updatedAt:
        FieldValue.serverTimestamp() as unknown as UserProfile["updatedAt"],
    };

    await userRef.set(newUser);

    return {userId: uid};
  }
);

/** US#54: 마이페이지에서 비상연락처 변경. */
export const updateEmergencyContact = onCall<
  UpdateEmergencyContactInput,
  Promise<UpdateEmergencyContactOutput>
>(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }

  if (!isValidEmergencyContact(request.data?.emergencyContact)) {
    throw new HttpsError(
      "invalid-argument",
      "비상연락처(이름, 전화번호)를 모두 입력해야 합니다."
    );
  }

  const uid = request.auth.uid;
  const db = admin.firestore();
  const userRef = db.collection("users").doc(uid);
  const existing = await userRef.get();

  if (!existing.exists) {
    throw new HttpsError("not-found", "사용자를 찾을 수 없습니다.");
  }

  await userRef.update({
    emergencyContact: request.data.emergencyContact,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return {emergencyContact: request.data.emergencyContact};
});
