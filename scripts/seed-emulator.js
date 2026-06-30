/**
 * 로컬 Firebase Emulator 전용 시드 스크립트.
 *
 * Auth/Firestore Emulator를 매번 수동으로 채우지 않도록 테스트 계정·문서를 만든다.
 *  - admin 사용자(custom claim {admin:true})
 *  - 일반 탐방자 사용자
 *  - 승인된 안내자 사용자(guideApproved=true, guideLocation 포함)
 *  - 운영자 승인 흐름 테스트용 pending guideApplications 문서
 *
 * 안전장치: FIREBASE_AUTH_EMULATOR_HOST(및 FIRESTORE_EMULATOR_HOST)가 설정되어
 * 있지 않으면 실행을 거부한다. 즉 실제 Firebase 프로젝트에는 절대 쓰지 않는다.
 *
 * 실행:
 *   FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 \
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 \
 *   node scripts/seed-emulator.js
 * (또는 functions/package.json의 `npm run seed:emulator` 사용)
 */

"use strict";

const path = require("path");

const PROJECT_ID = "eumgil-2577b";

// firebase-admin은 functions/node_modules에 설치되어 있으므로 명시 경로로 로드한다
// (루트에 별도 node_modules가 없어도 동작하도록).
const adminPath = path.resolve(
  __dirname,
  "../functions/node_modules/firebase-admin"
);
const admin = require(adminPath);

/** Emulator 환경이 아니면 실행을 거부한다(프로덕션 보호). */
function assertEmulatorOnly() {
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
  if (!authHost || !firestoreHost) {
    console.error(
      "[seed-emulator] 거부: FIREBASE_AUTH_EMULATOR_HOST와 " +
        "FIRESTORE_EMULATOR_HOST가 모두 설정되어 있어야 합니다.\n" +
        "  실제 Firebase 프로젝트에 쓰지 않도록 emulator 환경에서만 실행됩니다.\n" +
        "  예) FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 " +
        "FIRESTORE_EMULATOR_HOST=localhost:8080 node scripts/seed-emulator.js"
    );
    process.exit(1);
  }
  console.log(
    `[seed-emulator] Auth=${authHost} Firestore=${firestoreHost} ` +
      `project=${PROJECT_ID}`
  );
}

/** 기본 guideStats(신규 안내자). */
const defaultGuideStats = {
  averageSatisfaction: null,
  totalRequestsReceived: 0,
  completedEscortCount: 0,
};

/** 시드할 테스트 계정 정의. */
const ACCOUNTS = [
  {
    uid: "seed-admin",
    email: "admin@eumgil.test",
    password: "password",
    claims: {admin: true},
    user: {guideApproved: false},
  },
  {
    uid: "seed-traveler",
    email: "traveler@eumgil.test",
    password: "password",
    claims: null,
    user: {guideApproved: false},
  },
  {
    uid: "seed-guide",
    email: "guide@eumgil.test",
    password: "password",
    claims: null,
    user: {
      guideApproved: true,
      guideLocation: {lat: 37.5665, lng: 126.978},
    },
  },
  // 반경 1km 테스트용 추가 안내자 (서울 시청 기준)
  {
    uid: "seed-guide2",
    email: "guide2@eumgil.test",
    password: "password",
    claims: null,
    user: {
      guideApproved: true,
      guideLocation: {lat: 37.5683, lng: 126.9795}, // 약 220m
      residenceYears: 5,
      interests: ["산책", "카페"],
      guideStats: {
        averageSatisfaction: 4.8,
        totalRequestsReceived: 12,
        completedEscortCount: 10,
        ratedEscortCount: 9,
      },
    },
  },
  {
    uid: "seed-guide3",
    email: "guide3@eumgil.test",
    password: "password",
    claims: null,
    user: {
      guideApproved: true,
      guideLocation: {lat: 37.5700, lng: 126.9760}, // 약 410m
      residenceYears: 12,
      interests: ["역사", "전통시장"],
      guideStats: {
        averageSatisfaction: 4.5,
        totalRequestsReceived: 28,
        completedEscortCount: 25,
        ratedEscortCount: 22,
      },
    },
  },
  {
    uid: "seed-guide4",
    email: "guide4@eumgil.test",
    password: "password",
    claims: null,
    user: {
      guideApproved: true,
      guideLocation: {lat: 37.5720, lng: 126.9820}, // 약 620m
      guideStats: {
        averageSatisfaction: null,
        totalRequestsReceived: 1,
        completedEscortCount: 0,
        ratedEscortCount: 0,
      },
    },
  },
  {
    uid: "seed-guide5",
    email: "guide5@eumgil.test",
    password: "password",
    claims: null,
    user: {
      guideApproved: true,
      guideLocation: {lat: 37.5745, lng: 126.9800}, // 약 890m
      residenceYears: 3,
      interests: ["맛집", "골목길"],
      guideStats: {
        averageSatisfaction: 4.2,
        totalRequestsReceived: 7,
        completedEscortCount: 6,
        ratedEscortCount: 5,
      },
    },
  },
];

/**
 * Auth Emulator에 계정을 멱등 생성하고(있으면 갱신), custom claim을 설정한다.
 * @param {import("firebase-admin").auth.Auth} auth Auth 인스턴스.
 * @param {object} account 계정 정의.
 * @return {Promise<void>} 완료 Promise.
 */
async function ensureAccount(auth, account) {
  const {uid, email, password, claims} = account;
  try {
    await auth.createUser({uid, email, password});
    console.log(`  + auth 생성: ${uid} (${email})`);
  } catch (e) {
    if (
      e.code === "auth/uid-already-exists" ||
      e.code === "auth/email-already-exists"
    ) {
      await auth.updateUser(uid, {email, password});
      console.log(`  = auth 갱신: ${uid} (${email})`);
    } else {
      throw e;
    }
  }
  // claims가 null이면 빈 claim으로 초기화해 멱등성을 유지한다.
  await auth.setCustomUserClaims(uid, claims || {});
  if (claims) {
    console.log(`    claim 설정: ${uid} -> ${JSON.stringify(claims)}`);
  }
}

/**
 * Firestore users/{uid} 문서를 멱등 생성한다.
 * @param {FirebaseFirestore.Firestore} db Firestore 인스턴스.
 * @param {object} account 계정 정의.
 * @return {Promise<void>} 완료 Promise.
 */
async function ensureUserDoc(db, account) {
  const now = admin.firestore.Timestamp.now();
  const doc = {
    phoneNumber: "+821000000000",
    emergencyContact: {name: "보호자", phoneNumber: "+821011112222"},
    guideApproved: account.user.guideApproved,
    matchBlockedUntil: null,
    noShowCount: 0,
    guideStats: account.user.guideStats ?? defaultGuideStats,
    createdAt: now,
    updatedAt: now,
  };
  if (account.user.guideLocation) {
    doc.guideLocation = account.user.guideLocation;
  }
  if (account.user.residenceYears !== undefined) {
    doc.residenceYears = account.user.residenceYears;
  }
  if (account.user.interests !== undefined) {
    doc.interests = account.user.interests;
  }
  if (account.user.bio !== undefined) {
    doc.bio = account.user.bio;
  }
  if (account.user.photoUrl !== undefined) {
    doc.photoUrl = account.user.photoUrl;
  }
  await db.collection("users").doc(account.uid).set(doc);
  console.log(
    `  users/${account.uid} (guideApproved=${account.user.guideApproved})`
  );
}

/**
 * 운영자 승인 흐름 테스트용 pending guideApplications 문서를 멱등 생성한다.
 * 신청자는 탐방자 계정(seed-traveler)으로 둔다(승인 시 안내자가 된다).
 * @param {FirebaseFirestore.Firestore} db Firestore 인스턴스.
 * @return {Promise<void>} 완료 Promise.
 */
async function ensurePendingApplication(db) {
  const now = admin.firestore.Timestamp.now();
  // 결정적 id로 set하여 재실행 시 중복 생성되지 않도록 한다.
  await db.collection("guideApplications").doc("seed-app-traveler").set({
    userId: "seed-traveler",
    status: "pending",
    appliedAt: now,
    reviewedAt: null,
    reviewedBy: null,
    createdAt: now,
    updatedAt: now,
  });
  console.log("  guideApplications/seed-app-traveler (status=pending)");
}

/** 시드 메인 루틴. */
async function main() {
  assertEmulatorOnly();
  admin.initializeApp({projectId: PROJECT_ID});
  const auth = admin.auth();
  const db = admin.firestore();

  console.log("[seed-emulator] Auth 계정/claim 시드...");
  for (const account of ACCOUNTS) {
    await ensureAccount(auth, account);
  }

  console.log("[seed-emulator] Firestore users 문서 시드...");
  for (const account of ACCOUNTS) {
    await ensureUserDoc(db, account);
  }

  console.log("[seed-emulator] pending guideApplications 시드...");
  await ensurePendingApplication(db);

  console.log("[seed-emulator] 완료. 로그인 계정:");
  for (const a of ACCOUNTS) {
    const tag = a.claims && a.claims.admin ? " [admin]" : "";
    console.log(`  - ${a.email} / ${a.password} (uid=${a.uid})${tag}`);
  }
}

main().catch((e) => {
  console.error("[seed-emulator] 실패:", e);
  process.exit(1);
});
