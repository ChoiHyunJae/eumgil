import * as admin from "firebase-admin";
import {Timestamp} from "firebase-admin/firestore";
import {
  autoCompleteEscort,
  expireEscortRequests,
  judgeNoShow,
} from "../src/scheduled";

/**
 * Slice 7 (scheduled, Issue #9) — 동행 상태 자동 전환 스케줄러 emulator 테스트.
 * onSchedule 함수는 (fn as {run}).run()으로 직접 호출한다.
 */
describe("scheduled escort lifecycle", () => {
  let app: admin.app.App;
  let db: admin.firestore.Firestore;

  beforeAll(() => {
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
      throw new Error(
        "FIRESTORE_EMULATOR_HOST가 설정되어 있지 않습니다. " +
          "`npm test`(firebase emulators:exec)로 실행하세요."
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
   * onSchedule 함수를 .run()으로 직접 호출한다.
   * @param {unknown} fn 스케줄 함수.
   * @return {Promise<void>} 실행 완료 Promise.
   */
  function runScheduled(fn: unknown): Promise<void> {
    return (fn as {run: (event?: unknown) => Promise<void>}).run({});
  }

  /**
   * escorts/{auto} 문서를 만든다.
   * @param {object} fields escort 핵심 필드.
   * @return {Promise<string>} 생성된 문서 id.
   */
  async function seedEscort(fields: {
    guideId: string;
    travelerId: string;
    status: string;
    requestExpiresAt?: Timestamp;
    meetingTime?: Timestamp | null;
    guideArrivalConfirmedAt?: Timestamp | null;
    travelerArrivalConfirmedAt?: Timestamp | null;
    updatedAt?: Timestamp;
    satisfactionRating?: number | null;
    satisfactionStatsAppliedAt?: Timestamp | null;
  }): Promise<string> {
    const now = Timestamp.now();
    const ref = db.collection("escorts").doc();
    await ref.set({
      guideId: fields.guideId,
      travelerId: fields.travelerId,
      status: fields.status,
      requestedAt: now,
      respondedAt: now,
      requestExpiresAt:
        fields.requestExpiresAt ?? Timestamp.fromMillis(now.toMillis() + 1000),
      meetingLocation: null,
      meetingTime: fields.meetingTime ?? null,
      cancelledBy: null,
      cancelledAt: null,
      isSameDayCancellation: null,
      noShowBy: [],
      guideArrivalConfirmedAt: fields.guideArrivalConfirmedAt ?? null,
      travelerArrivalConfirmedAt: fields.travelerArrivalConfirmedAt ?? null,
      midTerminatedBy: null,
      midTerminatedAt: null,
      guideCompletedAt: null,
      travelerCompletedAt: null,
      satisfactionRating: fields.satisfactionRating ?? null,
      satisfactionStatsAppliedAt: fields.satisfactionStatsAppliedAt ?? null,
      createdAt: now,
      updatedAt: fields.updatedAt ?? now,
    });
    return ref.id;
  }

  /**
   * users/{uid} 문서를 noShowCount 지정값으로 만든다.
   * @param {string} uid 사용자 uid.
   * @param {number} noShowCount 초기 누적 위반 횟수.
   * @return {Promise<void>} 쓰기 완료 Promise.
   */
  async function seedUser(uid: string, noShowCount: number): Promise<void> {
    await db.collection("users").doc(uid).set({
      phoneNumber: "+821000000000",
      emergencyContact: {name: "보호자", phoneNumber: "+821011112222"},
      guideApproved: false,
      matchBlockedUntil: null,
      noShowCount,
      guideStats: {
        averageSatisfaction: null,
        totalRequestsReceived: 0,
        completedEscortCount: 0,
      },
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  }

  const minutesAgo = (m: number): Timestamp =>
    Timestamp.fromMillis(Date.now() - m * 60 * 1000);
  const minutesFromNow = (m: number): Timestamp =>
    Timestamp.fromMillis(Date.now() + m * 60 * 1000);
  const hoursAgo = (h: number): Timestamp =>
    Timestamp.fromMillis(Date.now() - h * 60 * 60 * 1000);

  // ---- expireEscortRequests ----

  it("만료 시간이 지난 Requested는 Expired로 전환된다", async () => {
    const id = await seedEscort({
      guideId: "sx-g",
      travelerId: "sx-t",
      status: "Requested",
      requestExpiresAt: minutesAgo(1),
    });
    await runScheduled(expireEscortRequests);
    const data = (await db.collection("escorts").doc(id).get()).data();
    expect(data?.status).toBe("Expired");
    expect(data?.expiredAt).not.toBeNull();
  });

  it("만료 시간이 지나지 않은 Requested는 유지된다", async () => {
    const id = await seedEscort({
      guideId: "sx-keep-g",
      travelerId: "sx-keep-t",
      status: "Requested",
      requestExpiresAt: minutesFromNow(60),
    });
    await runScheduled(expireEscortRequests);
    const data = (await db.collection("escorts").doc(id).get()).data();
    expect(data?.status).toBe("Requested");
  });

  // ---- judgeNoShow (scheduled) ----

  it("30분 경과 + guide만 확인 → traveler NoShow", async () => {
    await seedUser("sn-only-t", 0);
    const id = await seedEscort({
      guideId: "sn-only-g",
      travelerId: "sn-only-t",
      status: "MeetingConfirmed",
      meetingTime: minutesAgo(31),
      guideArrivalConfirmedAt: minutesAgo(20),
    });
    await runScheduled(judgeNoShow);
    const escort = (await db.collection("escorts").doc(id).get()).data();
    expect(escort?.status).toBe("NoShow");
    expect(escort?.noShowBy).toEqual(["traveler"]);
    const t = (await db.collection("users").doc("sn-only-t").get()).data();
    expect(t?.noShowCount).toBe(1);
  });

  it("30분 경과 + traveler만 확인 → guide NoShow", async () => {
    await seedUser("sn-only-g2", 0);
    const id = await seedEscort({
      guideId: "sn-only-g2",
      travelerId: "sn-only-t2",
      status: "MeetingConfirmed",
      meetingTime: minutesAgo(31),
      travelerArrivalConfirmedAt: minutesAgo(20),
    });
    await runScheduled(judgeNoShow);
    const escort = (await db.collection("escorts").doc(id).get()).data();
    expect(escort?.noShowBy).toEqual(["guide"]);
    const g = (await db.collection("users").doc("sn-only-g2").get()).data();
    expect(g?.noShowCount).toBe(1);
  });

  it("30분 경과 + 둘 다 미확인 → 둘 다 NoShow", async () => {
    await seedUser("sn-both-g", 0);
    await seedUser("sn-both-t", 0);
    const id = await seedEscort({
      guideId: "sn-both-g",
      travelerId: "sn-both-t",
      status: "MeetingConfirmed",
      meetingTime: minutesAgo(31),
    });
    await runScheduled(judgeNoShow);
    const escort = (await db.collection("escorts").doc(id).get()).data();
    expect(escort?.noShowBy).toEqual(["guide", "traveler"]);
    const g = (await db.collection("users").doc("sn-both-g").get()).data();
    const t = (await db.collection("users").doc("sn-both-t").get()).data();
    expect(g?.noShowCount).toBe(1);
    expect(t?.noShowCount).toBe(1);
  });

  it("양쪽 확인 완료면 NoShow로 바꾸지 않는다", async () => {
    const id = await seedEscort({
      guideId: "sn-done-g",
      travelerId: "sn-done-t",
      status: "MeetingConfirmed",
      meetingTime: minutesAgo(31),
      guideArrivalConfirmedAt: minutesAgo(20),
      travelerArrivalConfirmedAt: minutesAgo(20),
    });
    await runScheduled(judgeNoShow);
    const escort = (await db.collection("escorts").doc(id).get()).data();
    expect(escort?.status).toBe("MeetingConfirmed");
  });

  it("30분 전이면 노쇼 판정하지 않는다", async () => {
    const id = await seedEscort({
      guideId: "sn-early-g",
      travelerId: "sn-early-t",
      status: "MeetingConfirmed",
      meetingTime: minutesFromNow(10),
    });
    await runScheduled(judgeNoShow);
    const escort = (await db.collection("escorts").doc(id).get()).data();
    expect(escort?.status).toBe("MeetingConfirmed");
  });

  it("노쇼 누적 3회 이상이면 matchBlockedUntil 설정", async () => {
    await seedUser("sn-block-t", 2);
    const id = await seedEscort({
      guideId: "sn-block-g",
      travelerId: "sn-block-t",
      status: "MeetingConfirmed",
      meetingTime: minutesAgo(31),
      guideArrivalConfirmedAt: minutesAgo(20),
    });
    await runScheduled(judgeNoShow);
    const t = (await db.collection("users").doc("sn-block-t").get()).data();
    expect(t?.noShowCount).toBe(3);
    expect(t?.matchBlockedUntil).not.toBeNull();
    const escort = (await db.collection("escorts").doc(id).get()).data();
    expect(escort?.status).toBe("NoShow");
  });

  // ---- autoCompleteEscort ----

  it("InProgress 24시간 경과 → Completed", async () => {
    const id = await seedEscort({
      guideId: "ac-g",
      travelerId: "ac-t",
      status: "InProgress",
      guideArrivalConfirmedAt: hoursAgo(25),
      travelerArrivalConfirmedAt: hoursAgo(25),
    });
    await runScheduled(autoCompleteEscort);
    const escort = (await db.collection("escorts").doc(id).get()).data();
    expect(escort?.status).toBe("Completed");
    expect(escort?.autoCompletedAt).not.toBeNull();
  });

  it("InProgress 24시간 미경과 → 유지", async () => {
    const id = await seedEscort({
      guideId: "ac-keep-g",
      travelerId: "ac-keep-t",
      status: "InProgress",
      guideArrivalConfirmedAt: hoursAgo(1),
      travelerArrivalConfirmedAt: hoursAgo(1),
    });
    await runScheduled(autoCompleteEscort);
    const escort = (await db.collection("escorts").doc(id).get()).data();
    expect(escort?.status).toBe("InProgress");
  });

  it("autoComplete Completed 전환 시 기존 rating이 guideStats에 반영된다", async () => {
    // traveler가 먼저 rating 제출(InProgress) → 24h 후 자동 완료 상황을 가정한다.
    await seedUser("ac-rate-g", 0);
    const id = await seedEscort({
      guideId: "ac-rate-g",
      travelerId: "ac-rate-t",
      status: "InProgress",
      guideArrivalConfirmedAt: hoursAgo(25),
      travelerArrivalConfirmedAt: hoursAgo(25),
      satisfactionRating: 5,
    });

    await runScheduled(autoCompleteEscort);

    const escort = (await db.collection("escorts").doc(id).get()).data();
    expect(escort?.status).toBe("Completed");
    expect(escort?.satisfactionStatsAppliedAt).not.toBeNull();
    const guide = (await db.collection("users").doc("ac-rate-g").get()).data();
    expect(guide?.guideStats.averageSatisfaction).toBe(5);
    expect(guide?.guideStats.ratedEscortCount).toBe(1);
  });

  it("autoComplete: rating 없으면 guideStats 미변경", async () => {
    await seedUser("ac-norate-g", 0);
    const id = await seedEscort({
      guideId: "ac-norate-g",
      travelerId: "ac-norate-t",
      status: "InProgress",
      guideArrivalConfirmedAt: hoursAgo(25),
      travelerArrivalConfirmedAt: hoursAgo(25),
    });

    await runScheduled(autoCompleteEscort);

    const escort = (await db.collection("escorts").doc(id).get()).data();
    expect(escort?.status).toBe("Completed");
    const guideRef = db.collection("users").doc("ac-norate-g");
    const guide = (await guideRef.get()).data();
    expect(guide?.guideStats.averageSatisfaction).toBeNull();
  });

  it("autoComplete: 이미 반영(flag)된 escort는 중복 반영하지 않는다", async () => {
    await seedUser("ac-flag-g", 0);
    const id = await seedEscort({
      guideId: "ac-flag-g",
      travelerId: "ac-flag-t",
      status: "InProgress",
      guideArrivalConfirmedAt: hoursAgo(25),
      travelerArrivalConfirmedAt: hoursAgo(25),
      satisfactionRating: 4,
      satisfactionStatsAppliedAt: Timestamp.now(),
    });

    await runScheduled(autoCompleteEscort);

    const escort = (await db.collection("escorts").doc(id).get()).data();
    expect(escort?.status).toBe("Completed");
    const guide = (await db.collection("users").doc("ac-flag-g").get()).data();
    expect(guide?.guideStats.averageSatisfaction).toBeNull(); // 중복 반영 안 됨
  });
});

// ---- AC4/AC2 추가 테스트 ----

describe("autoCompleteEscort — AC4/AC2", () => {
  let app: admin.app.App;
  let db: admin.firestore.Firestore;

  beforeAll(() => {
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
      throw new Error("FIRESTORE_EMULATOR_HOST가 설정되어 있지 않습니다.");
    }
    app = admin.initializeApp({projectId: "eumgil-test-harness-ac"});
    db = admin.firestore(app);
  });

  afterAll(async () => {
    db.terminate();
    await app.delete();
  });

  /**
   * @param {unknown} fn 스케줄 함수.
   * @return {Promise<void>} 완료.
   */
  function runScheduled(fn: unknown): Promise<void> {
    return (fn as {run: (e?: unknown) => Promise<void>}).run({});
  }

  /**
   * @param {number} h 시간.
   * @return {Timestamp} 과거 Timestamp.
   */
  const hoursAgo = (h: number): Timestamp =>
    Timestamp.fromMillis(Date.now() - h * 3600_000);

  /**
   * @param {object} f escort 필드.
   * @return {Promise<string>} 문서 id.
   */
  async function seedEscort(f: {
    guideId: string;
    travelerId: string;
    status: string;
    guideArrivalConfirmedAt?: Timestamp | null;
    travelerArrivalConfirmedAt?: Timestamp | null;
    guideCompletedAt?: Timestamp | null;
    travelerCompletedAt?: Timestamp | null;
  }): Promise<string> {
    const now = Timestamp.now();
    const ref = db.collection("escorts").doc();
    await ref.set({
      guideId: f.guideId,
      travelerId: f.travelerId,
      status: f.status,
      requestedAt: now,
      respondedAt: now,
      requestExpiresAt: Timestamp.fromMillis(now.toMillis() + 3600_000),
      meetingLocation: null,
      meetingTime: now,
      cancelledBy: null,
      cancelledAt: null,
      isSameDayCancellation: null,
      noShowBy: [],
      guideArrivalConfirmedAt: f.guideArrivalConfirmedAt ?? null,
      travelerArrivalConfirmedAt: f.travelerArrivalConfirmedAt ?? null,
      midTerminatedBy: null,
      midTerminatedAt: null,
      guideCompletedAt: f.guideCompletedAt ?? null,
      travelerCompletedAt: f.travelerCompletedAt ?? null,
      satisfactionRating: null,
      satisfactionStatsAppliedAt: null,
      createdAt: now,
      updatedAt: f.guideArrivalConfirmedAt ?? now,
    });
    return ref.id;
  }

  it(
    "AC4: MidTerminated 동행은 autoCompleteEscort가 Completed로 덮어쓰지 않는다",
    async () => {
      const id = await seedEscort({
        guideId: "ac2-mid-g",
        travelerId: "ac2-mid-t",
        status: "MidTerminated",
        guideArrivalConfirmedAt: hoursAgo(25),
        travelerArrivalConfirmedAt: hoursAgo(25),
      });
      await runScheduled(autoCompleteEscort);
      const escort = (await db.collection("escorts").doc(id).get()).data();
      expect(escort?.status).toBe("MidTerminated");
    });

  it("AC2: 한쪽 completeEscort 호출 후 24시간 경과 → 자동 완료", async () => {
    const id = await seedEscort({
      guideId: "ac2-half-g",
      travelerId: "ac2-half-t",
      status: "InProgress",
      guideArrivalConfirmedAt: hoursAgo(30),
      travelerArrivalConfirmedAt: hoursAgo(30),
      guideCompletedAt: hoursAgo(25),
    });
    await runScheduled(autoCompleteEscort);
    const escort = (await db.collection("escorts").doc(id).get()).data();
    expect(escort?.status).toBe("Completed");
    expect(escort?.autoCompletedAt).not.toBeNull();
  });

  it("AC2: 한쪽 completeEscort 후 24시간 미경과면 자동 완료 안 됨", async () => {
    const id = await seedEscort({
      guideId: "ac2-early-g",
      travelerId: "ac2-early-t",
      status: "InProgress",
      guideArrivalConfirmedAt: hoursAgo(30),
      travelerArrivalConfirmedAt: hoursAgo(30),
      guideCompletedAt: hoursAgo(10),
    });
    await runScheduled(autoCompleteEscort);
    const escort = (await db.collection("escorts").doc(id).get()).data();
    expect(escort?.status).toBe("InProgress");
  });
});
