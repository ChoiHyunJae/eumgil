import * as admin from "firebase-admin";
import {GeoPoint, Timestamp} from "firebase-admin/firestore";
import type {CallableRequest} from "firebase-functions/v2/https";
import {
  completeEscort,
  confirmMeeting,
  midTerminate,
} from "../src/escort";
import {autoCompleteEscort} from "../src/scheduled";
import {
  NotificationGateway,
  NotificationRequest,
  setNotificationGateway,
} from "../src/notifications";

/**
 * Slice 8 (notifications, Issue #10) — 동행 생명주기 알림 발송 emulator 테스트.
 *
 * 외부 API(카카오 알림톡/SMS)는 실제 호출하지 않는다. 게이트웨이를 가짜로 주입해
 * 호출 파라미터를 검증하고, 알림톡 실패 시 SMS fallback 경로를 확인한다.
 */

/** 호출 파라미터를 기록하고 실패를 시뮬레이션할 수 있는 가짜 게이트웨이. */
class FakeGateway implements NotificationGateway {
  alimtalk: NotificationRequest[] = [];
  sms: NotificationRequest[] = [];
  failAlimtalk = false;

  /**
   * 알림톡 발송을 기록한다(failAlimtalk면 실패 시뮬레이션).
   * @param {NotificationRequest} req 알림 요청.
   * @return {Promise<void>} 완료 Promise.
   */
  async sendAlimtalk(req: NotificationRequest): Promise<void> {
    this.alimtalk.push(req);
    if (this.failAlimtalk) {
      throw new Error("alimtalk failed (stub)");
    }
  }

  /**
   * SMS 발송을 기록한다.
   * @param {NotificationRequest} req 알림 요청.
   * @return {Promise<void>} 완료 Promise.
   */
  async sendSms(req: NotificationRequest): Promise<void> {
    this.sms.push(req);
  }
}

describe("escort lifecycle notifications", () => {
  let app: admin.app.App;
  let db: admin.firestore.Firestore;
  let fake: FakeGateway;

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
    setNotificationGateway(null); // 기본 스텁으로 복원
    db.terminate();
    await app.delete();
  });

  beforeEach(() => {
    fake = new FakeGateway();
    setNotificationGateway(fake);
  });

  /**
   * 테스트 CallableRequest를 만든다.
   * @param {string | undefined} uid 호출자 uid.
   * @param {unknown} data 입력 페이로드.
   * @return {CallableRequest<unknown>} 구성된 요청.
   */
  function buildRequest(
    uid: string | undefined,
    data: unknown
  ): CallableRequest<unknown> {
    return {
      data,
      auth: uid === undefined ?
        undefined :
        {uid, token: {} as unknown, rawToken: "dummy"} as
          CallableRequest["auth"],
      rawRequest: {} as CallableRequest["rawRequest"],
      acceptsStreaming: false,
    } as CallableRequest<unknown>;
  }

  /**
   * v2 onCall 함수를 .run()으로 직접 호출한다.
   * @param {unknown} fn callable.
   * @param {CallableRequest<unknown>} request 요청.
   * @return {Promise<O>} 결과.
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
   * onSchedule 함수를 .run()으로 직접 호출한다.
   * @param {unknown} fn 스케줄 함수.
   * @return {Promise<void>} 완료 Promise.
   */
  function runScheduled(fn: unknown): Promise<void> {
    return (fn as {run: (event?: unknown) => Promise<void>}).run({});
  }

  /**
   * 비상연락처를 가진 users/{uid} 문서를 만든다.
   * @param {string} uid 사용자 uid.
   * @param {string} contactPhone 비상연락처 전화번호.
   * @return {Promise<void>} 쓰기 완료 Promise.
   */
  async function seedUserWithContact(
    uid: string,
    contactPhone: string
  ): Promise<void> {
    await db.collection("users").doc(uid).set({
      phoneNumber: "+821000000000",
      emergencyContact: {name: `${uid}-보호자`, phoneNumber: contactPhone},
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

  /**
   * escorts 문서를 만든다.
   * @param {object} fields escort 필드.
   * @return {Promise<string>} 생성 문서 id.
   */
  async function seedEscort(fields: {
    guideId: string;
    travelerId: string;
    status: string;
    meetingLocation?: GeoPoint | null;
    guideArrivalConfirmedAt?: Timestamp | null;
    travelerArrivalConfirmedAt?: Timestamp | null;
    guideCompletedAt?: Timestamp | null;
    travelerCompletedAt?: Timestamp | null;
  }): Promise<string> {
    const now = Timestamp.now();
    const ref = db.collection("escorts").doc();
    await ref.set({
      guideId: fields.guideId,
      travelerId: fields.travelerId,
      status: fields.status,
      requestedAt: now,
      respondedAt: now,
      requestExpiresAt: Timestamp.fromMillis(now.toMillis() + 3600_000),
      meetingLocation: fields.meetingLocation ?? null,
      meetingTime: now,
      cancelledBy: null,
      cancelledAt: null,
      isSameDayCancellation: null,
      noShowBy: [],
      guideArrivalConfirmedAt: fields.guideArrivalConfirmedAt ?? null,
      travelerArrivalConfirmedAt: fields.travelerArrivalConfirmedAt ?? null,
      midTerminatedBy: null,
      midTerminatedAt: null,
      guideCompletedAt: fields.guideCompletedAt ?? null,
      travelerCompletedAt: fields.travelerCompletedAt ?? null,
      satisfactionRating: null,
      createdAt: now,
      updatedAt: now,
    });
    return ref.id;
  }

  const phones = (alimtalk: NotificationRequest[]): string[] =>
    alimtalk.map((r) => r.to).sort();

  it("동행 시작(InProgress 전환) 시 양측 비상연락처로 알림이 발송된다", async () => {
    await seedUserWithContact("nt-start-g", "+8210AAAA0001");
    await seedUserWithContact("nt-start-t", "+8210BBBB0001");
    const id = await seedEscort({
      guideId: "nt-start-g",
      travelerId: "nt-start-t",
      status: "MeetingConfirmed",
      meetingLocation: new GeoPoint(37.5665, 126.978),
      guideArrivalConfirmedAt: Timestamp.now(),
    });

    await runCallable(
      confirmMeeting,
      buildRequest("nt-start-t", {
        escortId: id,
        location: {lat: 37.5665, lng: 126.978},
      })
    );

    expect(phones(fake.alimtalk)).toEqual(["+8210AAAA0001", "+8210BBBB0001"]);
    expect(fake.sms).toHaveLength(0);
  });

  it("completeEscort로 Completed 전환 시 양측에 종료 알림", async () => {
    await seedUserWithContact("nt-comp-g", "+8210AAAA0002");
    await seedUserWithContact("nt-comp-t", "+8210BBBB0002");
    const id = await seedEscort({
      guideId: "nt-comp-g",
      travelerId: "nt-comp-t",
      status: "InProgress",
      guideCompletedAt: Timestamp.now(),
    });

    await runCallable(
      completeEscort,
      buildRequest("nt-comp-t", {escortId: id})
    );

    expect(phones(fake.alimtalk)).toEqual(["+8210AAAA0002", "+8210BBBB0002"]);
  });

  it("한쪽만 완료(InProgress 유지)면 종료 알림이 발송되지 않는다", async () => {
    await seedUserWithContact("nt-one-g", "+8210AAAA0003");
    await seedUserWithContact("nt-one-t", "+8210BBBB0003");
    const id = await seedEscort({
      guideId: "nt-one-g",
      travelerId: "nt-one-t",
      status: "InProgress",
    });

    await runCallable(
      completeEscort,
      buildRequest("nt-one-g", {escortId: id})
    );

    expect(fake.alimtalk).toHaveLength(0);
  });

  it("autoCompleteEscort로 Completed 전환 시 종료 알림", async () => {
    await seedUserWithContact("nt-auto-g", "+8210AAAA0004");
    await seedUserWithContact("nt-auto-t", "+8210BBBB0004");
    const old = Timestamp.fromMillis(Date.now() - 25 * 60 * 60 * 1000);
    const id = await seedEscort({
      guideId: "nt-auto-g",
      travelerId: "nt-auto-t",
      status: "InProgress",
      guideArrivalConfirmedAt: old,
      travelerArrivalConfirmedAt: old,
    });

    await runScheduled(autoCompleteEscort);

    const escort = (await db.collection("escorts").doc(id).get()).data();
    expect(escort?.status).toBe("Completed");
    expect(phones(fake.alimtalk)).toContain("+8210AAAA0004");
    expect(phones(fake.alimtalk)).toContain("+8210BBBB0004");
  });

  it("midTerminate로 MidTerminated 전환 시 종료 알림", async () => {
    await seedUserWithContact("nt-mid-g", "+8210AAAA0005");
    await seedUserWithContact("nt-mid-t", "+8210BBBB0005");
    const id = await seedEscort({
      guideId: "nt-mid-g",
      travelerId: "nt-mid-t",
      status: "InProgress",
    });

    await runCallable(
      midTerminate,
      buildRequest("nt-mid-g", {escortId: id})
    );

    expect(phones(fake.alimtalk)).toEqual(["+8210AAAA0005", "+8210BBBB0005"]);
  });

  it("알림톡 실패 시 SMS fallback이 호출된다", async () => {
    fake.failAlimtalk = true;
    await seedUserWithContact("nt-fb-g", "+8210AAAA0006");
    await seedUserWithContact("nt-fb-t", "+8210BBBB0006");
    const id = await seedEscort({
      guideId: "nt-fb-g",
      travelerId: "nt-fb-t",
      status: "InProgress",
      guideCompletedAt: Timestamp.now(),
    });

    await runCallable(
      completeEscort,
      buildRequest("nt-fb-t", {escortId: id})
    );

    // 알림톡은 시도(실패)되고, 양측 모두 SMS로 대체 발송된다.
    expect(fake.alimtalk).toHaveLength(2);
    expect(phones(fake.sms)).toEqual(["+8210AAAA0006", "+8210BBBB0006"]);
  });

  it("비상연락처가 없는 사용자는 알림 대상에서 제외된다", async () => {
    // traveler만 비상연락처를 가진 경우.
    await seedUserWithContact("nt-miss-t", "+8210BBBB0007");
    const id = await seedEscort({
      guideId: "nt-miss-g", // users 문서 없음
      travelerId: "nt-miss-t",
      status: "InProgress",
      guideCompletedAt: Timestamp.now(),
    });

    await runCallable(
      completeEscort,
      buildRequest("nt-miss-t", {escortId: id})
    );

    expect(phones(fake.alimtalk)).toEqual(["+8210BBBB0007"]);
  });
});
