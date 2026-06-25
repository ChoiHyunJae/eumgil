import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/v2/https";
import {
  EmergencyContact,
  GuideApplication,
  GuideStats,
  UserProfile,
} from "../types";
import {
  ApplyForGuideInput,
  ApplyForGuideOutput,
  GetMyGuideApplicationStatusInput,
  GetMyGuideApplicationStatusOutput,
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

/**
 * US#16,#60 / Slice 2: 사용자가 본인 계정으로 안내자 신청을 제출한다.
 * 신청 대상은 request.auth.uid이며(본인 신청만 허용), guideApplications에
 * status="pending" 문서를 생성한다. 운영자가 오프라인 확인 후 승인/거부한다.
 *
 * 이미 승인된 안내자(guideApproved=true)는 신청할 수 없고(failed-precondition),
 * 이미 처리 대기 중인 pending 신청이 있으면 중복 신청할 수 없다(already-exists).
 */
export const applyForGuide = onCall<
  ApplyForGuideInput, Promise<ApplyForGuideOutput>
>(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }

  const uid = request.auth.uid;
  const db = admin.firestore();
  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    throw new HttpsError("not-found", "사용자를 찾을 수 없습니다.");
  }

  const user = userSnap.data() as Omit<UserProfile, "id">;
  if (user.guideApproved) {
    throw new HttpsError(
      "failed-precondition",
      "이미 안내자로 승인된 사용자입니다."
    );
  }

  const applicationsRef = db.collection("guideApplications");
  const pending = await applicationsRef
    .where("userId", "==", uid)
    .where("status", "==", "pending")
    .limit(1)
    .get();
  if (!pending.empty) {
    throw new HttpsError(
      "already-exists",
      "이미 처리 대기 중인 안내자 신청이 있습니다."
    );
  }

  const ref = applicationsRef.doc();
  const now = Timestamp.now();
  const stored: Omit<GuideApplication, "id"> = {
    userId: uid,
    status: "pending",
    appliedAt: now,
    reviewedAt: null,
    reviewedBy: null,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(stored);

  return {applicationId: ref.id, status: "pending"};
});

/**
 * updatedAt이 가장 최신인 신청 문서를 고른다.
 * approved/rejected 신청이 여러 개 있을 수 있어 최신 항목으로 상태를 판단한다.
 *
 * @param {GuideApplication[]} items 비어 있지 않은 신청 목록.
 * @return {GuideApplication} updatedAt 기준 가장 최신 신청.
 */
function latestByUpdatedAt(items: GuideApplication[]): GuideApplication {
  return items.reduce((latest, item) =>
    item.updatedAt.toMillis() > latest.updatedAt.toMillis() ? item : latest
  );
}

/**
 * US#16,#60 / Slice 2: 사용자가 본인의 안내자 신청 상태를 조회한다.
 * 조회 대상은 request.auth.uid이며(본인 조회만 허용), Flutter UI의 신청 버튼
 * 상태 분기에 사용한다.
 *
 * 판단 순서:
 * 1) users/{uid}.guideApproved === true  → "approved"
 * 2) 그 외에는 guideApplications에서 본인 신청 이력을 조회해
 *    pending이 있으면 "pending",
 *    없고 rejected가 있으면 "rejected",
 *    없고 approved가 있으면 "approved"(승인 후 별도 경로로 guideApproved가
 *      내려간 상태에서도 재신청 가능처럼 보이지 않도록),
 *    신청 이력이 전혀 없으면 "none".
 * 각 상태가 여러 건이면 updatedAt 최신 건으로 applicationId를 정한다.
 */
export const getMyGuideApplicationStatus = onCall<
  GetMyGuideApplicationStatusInput,
  Promise<GetMyGuideApplicationStatusOutput>
>(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }

  const uid = request.auth.uid;
  const db = admin.firestore();
  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) {
    throw new HttpsError("not-found", "사용자를 찾을 수 없습니다.");
  }

  const user = userSnap.data() as Omit<UserProfile, "id">;
  if (user.guideApproved) {
    return {status: "approved"};
  }

  // userId 단일 등식 쿼리로 본인 신청만 조회하고, 최신 판단은 메모리에서 처리한다
  // (userId + updatedAt 복합 색인 불필요).
  const snap = await db
    .collection("guideApplications")
    .where("userId", "==", uid)
    .get();

  const applications: GuideApplication[] = snap.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Omit<GuideApplication, "id">),
  }));

  const pending = applications.filter((a) => a.status === "pending");
  if (pending.length > 0) {
    return {status: "pending", applicationId: latestByUpdatedAt(pending).id};
  }

  const rejected = applications.filter((a) => a.status === "rejected");
  if (rejected.length > 0) {
    return {status: "rejected", applicationId: latestByUpdatedAt(rejected).id};
  }

  const approved = applications.filter((a) => a.status === "approved");
  if (approved.length > 0) {
    return {status: "approved", applicationId: latestByUpdatedAt(approved).id};
  }

  return {status: "none"};
});
