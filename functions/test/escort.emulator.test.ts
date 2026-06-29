import * as admin from "firebase-admin";
import {GeoPoint, Timestamp} from "firebase-admin/firestore";
import type {CallableRequest} from "firebase-functions/v2/https";
import {
  cancelEscort,
  checkArrival,
  completeEscort,
  confirmMeeting,
  judgeEscortNoShow,
  listMyEscorts,
  midTerminate,
} from "../src/escort";
import type {
  CancelEscortOutput,
  CheckArrivalOutput,
  CompleteEscortOutput,
  ConfirmMeetingOutput,
  JudgeNoShowOutput,
  ListMyEscortsOutput,
  MidTerminateOutput,
} from "../src/escort/types";

/**
 * Slice 7 (escort, Issue #9) — 내 동행 조회 / 시작 전 취소 emulator 테스트.
 * Callable은 (fn as unknown as {run}).run(request) 방식으로 직접 호출한다.
 */
describe("escort module", () => {
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
   * 테스트 CallableRequest를 만든다. uid가 undefined면 미인증 요청.
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
   * @param {unknown} fn 호출할 callable.
   * @param {CallableRequest<unknown>} request 전달할 요청.
   * @return {Promise<O>} 호출 결과.
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
   * escorts/{auto} 문서를 지정 상태로 만든다.
   * @param {object} fields guideId/travelerId/status 및 선택적 meetingTime.
   * @return {Promise<string>} 생성된 escort 문서 id.
   */
  async function seedEscort(fields: {
    guideId: string;
    travelerId: string;
    status: string;
    meetingTime?: Timestamp | null;
    meetingLocation?: GeoPoint | null;
    requestedAt?: Timestamp;
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
      requestedAt: fields.requestedAt ?? now,
      respondedAt: now,
      requestExpiresAt: Timestamp.fromMillis(now.toMillis() + 3600_000),
      meetingLocation: fields.meetingLocation ?? null,
      meetingTime: fields.meetingTime ?? null,
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

  /**
   * users/{uid} 문서를 noShowCount 지정값으로 만든다(패널티 테스트용).
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

  // 약속 시간이 과거(31분 전)인 Timestamp.
  const meetingPast31 = (): Timestamp =>
    Timestamp.fromMillis(Date.now() - 31 * 60 * 1000);
  // 약속 시간이 미래(10분 후)인 Timestamp.
  const meetingFuture = (): Timestamp =>
    Timestamp.fromMillis(Date.now() + 10 * 60 * 1000);

  // ---- listMyEscorts ----

  it("미인증 사용자는 내 동행을 조회할 수 없다", async () => {
    await expect(
      runCallable<ListMyEscortsOutput>(
        listMyEscorts,
        buildRequest(undefined, {})
      )
    ).rejects.toThrow();
  });

  it("guide/traveler 어느 쪽이든 본인 관련 진행 중 동행을 반환한다", async () => {
    const asGuide = await seedEscort({
      guideId: "es-user",
      travelerId: "es-other-t",
      status: "MeetingConfirmed",
      meetingTime: Timestamp.now(),
    });
    const asTraveler = await seedEscort({
      guideId: "es-other-g",
      travelerId: "es-user",
      status: "Accepted",
    });

    const result = await runCallable<ListMyEscortsOutput>(
      listMyEscorts,
      buildRequest("es-user", {})
    );
    const ids = result.escorts.map((e) => e.escortId);
    expect(ids).toContain(asGuide);
    expect(ids).toContain(asTraveler);
  });

  it("진행 중이 아닌(취소/완료 등) 동행은 제외한다", async () => {
    const guide = "es-status-user";
    const cancelled = await seedEscort({
      guideId: guide,
      travelerId: "es-t1",
      status: "Cancelled",
    });
    const completed = await seedEscort({
      guideId: guide,
      travelerId: "es-t2",
      status: "Completed",
    });

    const result = await runCallable<ListMyEscortsOutput>(
      listMyEscorts,
      buildRequest(guide, {})
    );
    const ids = result.escorts.map((e) => e.escortId);
    expect(ids).not.toContain(cancelled);
    expect(ids).not.toContain(completed);
  });

  it("내가 당사자가 아닌 동행은 반환하지 않는다", async () => {
    const other = await seedEscort({
      guideId: "es-g-x",
      travelerId: "es-t-x",
      status: "MeetingConfirmed",
    });
    const result = await runCallable<ListMyEscortsOutput>(
      listMyEscorts,
      buildRequest("es-viewer", {})
    );
    expect(result.escorts.map((e) => e.escortId)).not.toContain(other);
  });

  it("meetingTime은 ISO 문자열 또는 null로 반환된다", async () => {
    const withTime = await seedEscort({
      guideId: "es-mt-guide",
      travelerId: "es-mt-t",
      status: "MeetingConfirmed",
      meetingTime: Timestamp.now(),
    });
    const result = await runCallable<ListMyEscortsOutput>(
      listMyEscorts,
      buildRequest("es-mt-guide", {})
    );
    const item = result.escorts.find((e) => e.escortId === withTime);
    expect(item).toBeDefined();
    expect(typeof item?.meetingTime).toBe("string");
    expect(Number.isNaN(Date.parse(item?.meetingTime ?? ""))).toBe(false);
  });

  // ---- cancelEscort ----

  it("당사자는 시작 전 동행을 취소할 수 있다", async () => {
    const escortId = await seedEscort({
      guideId: "es-cancel-g",
      travelerId: "es-cancel-t",
      status: "MeetingConfirmed",
      meetingTime: Timestamp.now(),
    });

    const result = await runCallable<CancelEscortOutput>(
      cancelEscort,
      buildRequest("es-cancel-t", {escortId})
    );
    expect(result.status).toBe("Cancelled");

    const data = (await db.collection("escorts").doc(escortId).get()).data();
    expect(data?.status).toBe("Cancelled");
    expect(data?.cancelledBy).toBe("traveler");
    expect(data?.cancelledAt).not.toBeNull();
  });

  it("만남 당일 취소는 isSameDayCancellation=true", async () => {
    const escortId = await seedEscort({
      guideId: "es-sameday-g",
      travelerId: "es-sameday-t",
      status: "MeetingConfirmed",
      meetingTime: Timestamp.now(),
    });
    const result = await runCallable<CancelEscortOutput>(
      cancelEscort,
      buildRequest("es-sameday-g", {escortId})
    );
    expect(result.isSameDayCancellation).toBe(true);
  });

  it("당사자가 아니면 취소할 수 없다", async () => {
    const escortId = await seedEscort({
      guideId: "es-perm-g",
      travelerId: "es-perm-t",
      status: "MeetingConfirmed",
    });
    await expect(
      runCallable<CancelEscortOutput>(
        cancelEscort,
        buildRequest("es-stranger", {escortId})
      )
    ).rejects.toMatchObject({code: "permission-denied"});
  });

  it("시작 전 상태가 아니면 취소할 수 없다", async () => {
    const escortId = await seedEscort({
      guideId: "es-inprog-g",
      travelerId: "es-inprog-t",
      status: "InProgress",
    });
    await expect(
      runCallable<CancelEscortOutput>(
        cancelEscort,
        buildRequest("es-inprog-g", {escortId})
      )
    ).rejects.toMatchObject({code: "failed-precondition"});
  });

  it("없는 escort 취소는 not-found", async () => {
    await expect(
      runCallable<CancelEscortOutput>(
        cancelEscort,
        buildRequest("es-any", {escortId: "no-such-escort"})
      )
    ).rejects.toMatchObject({code: "not-found"});
  });

  it("escortId가 없으면 거부된다", async () => {
    await expect(
      runCallable<CancelEscortOutput>(
        cancelEscort,
        buildRequest("es-any", {})
      )
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  it("미인증 취소는 거부된다", async () => {
    await expect(
      runCallable<CancelEscortOutput>(
        cancelEscort,
        buildRequest(undefined, {escortId: "x"})
      )
    ).rejects.toThrow();
  });

  // ---- confirmMeeting ----

  /** 만남 장소(서울시청). */
  const MEET = new GeoPoint(37.5665, 126.978);
  /** MEET에서 약 60m(50m 초과). */
  const FAR = {lat: 37.5671, lng: 126.978};

  it("미인증 사용자는 만남 확인을 할 수 없다", async () => {
    const escortId = await seedEscort({
      guideId: "cm-g",
      travelerId: "cm-t",
      status: "MeetingConfirmed",
      meetingLocation: MEET,
    });
    await expect(
      runCallable<ConfirmMeetingOutput>(
        confirmMeeting,
        buildRequest(undefined, {
          escortId,
          location: {lat: 37.5665, lng: 126.978},
        })
      )
    ).rejects.toThrow();
  });

  it("당사자가 아니면 만남 확인을 할 수 없다", async () => {
    const escortId = await seedEscort({
      guideId: "cm-perm-g",
      travelerId: "cm-perm-t",
      status: "MeetingConfirmed",
      meetingLocation: MEET,
    });
    await expect(
      runCallable<ConfirmMeetingOutput>(
        confirmMeeting,
        buildRequest("cm-stranger", {
          escortId,
          location: {lat: 37.5665, lng: 126.978},
        })
      )
    ).rejects.toMatchObject({code: "permission-denied"});
  });

  it("MeetingConfirmed가 아니면 거부된다", async () => {
    const escortId = await seedEscort({
      guideId: "cm-st-g",
      travelerId: "cm-st-t",
      status: "InProgress",
      meetingLocation: MEET,
    });
    await expect(
      runCallable<ConfirmMeetingOutput>(
        confirmMeeting,
        buildRequest("cm-st-g", {
          escortId,
          location: {lat: 37.5665, lng: 126.978},
        })
      )
    ).rejects.toMatchObject({code: "failed-precondition"});
  });

  it("만남 장소에서 50m 초과면 거부된다", async () => {
    const escortId = await seedEscort({
      guideId: "cm-far-g",
      travelerId: "cm-far-t",
      status: "MeetingConfirmed",
      meetingLocation: MEET,
    });
    await expect(
      runCallable<ConfirmMeetingOutput>(
        confirmMeeting,
        buildRequest("cm-far-g", {escortId, location: FAR})
      )
    ).rejects.toMatchObject({code: "failed-precondition"});
  });

  it("유효하지 않은 좌표는 invalid-argument", async () => {
    const escortId = await seedEscort({
      guideId: "cm-inv-g",
      travelerId: "cm-inv-t",
      status: "MeetingConfirmed",
      meetingLocation: MEET,
    });
    await expect(
      runCallable<ConfirmMeetingOutput>(
        confirmMeeting,
        buildRequest("cm-inv-g", {escortId, location: {lat: "x", lng: 1}})
      )
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  it("guide 한쪽만 확인하면 MeetingConfirmed 유지 + 시각 기록", async () => {
    const escortId = await seedEscort({
      guideId: "cm-one-g",
      travelerId: "cm-one-t",
      status: "MeetingConfirmed",
      meetingLocation: MEET,
    });
    const result = await runCallable<ConfirmMeetingOutput>(
      confirmMeeting,
      buildRequest("cm-one-g", {
        escortId,
        location: {lat: 37.5665, lng: 126.978},
      })
    );
    expect(result.status).toBe("MeetingConfirmed");

    const data = (await db.collection("escorts").doc(escortId).get()).data();
    expect(data?.status).toBe("MeetingConfirmed");
    expect(data?.guideArrivalConfirmedAt).not.toBeNull();
    expect(data?.travelerArrivalConfirmedAt).toBeNull();
  });

  it("양쪽 모두 확인하면 InProgress로 전환 + 시각 기록", async () => {
    const escortId = await seedEscort({
      guideId: "cm-both-g",
      travelerId: "cm-both-t",
      status: "MeetingConfirmed",
      meetingLocation: MEET,
      guideArrivalConfirmedAt: Timestamp.now(),
    });
    const result = await runCallable<ConfirmMeetingOutput>(
      confirmMeeting,
      buildRequest("cm-both-t", {
        escortId,
        location: {lat: 37.5665, lng: 126.978},
      })
    );
    expect(result.status).toBe("InProgress");

    const data = (await db.collection("escorts").doc(escortId).get()).data();
    expect(data?.status).toBe("InProgress");
    expect(data?.guideArrivalConfirmedAt).not.toBeNull();
    expect(data?.travelerArrivalConfirmedAt).not.toBeNull();
  });

  // ---- judgeEscortNoShow ----

  it("미인증 사용자는 노쇼 판정을 할 수 없다", async () => {
    const escortId = await seedEscort({
      guideId: "ns-g",
      travelerId: "ns-t",
      status: "MeetingConfirmed",
      meetingTime: meetingPast31(),
    });
    await expect(
      runCallable<JudgeNoShowOutput>(
        judgeEscortNoShow,
        buildRequest(undefined, {escortId})
      )
    ).rejects.toThrow();
  });

  it("당사자가 아니면 노쇼 판정을 할 수 없다", async () => {
    const escortId = await seedEscort({
      guideId: "ns-perm-g",
      travelerId: "ns-perm-t",
      status: "MeetingConfirmed",
      meetingTime: meetingPast31(),
    });
    await expect(
      runCallable<JudgeNoShowOutput>(
        judgeEscortNoShow,
        buildRequest("ns-stranger", {escortId})
      )
    ).rejects.toMatchObject({code: "permission-denied"});
  });

  it("MeetingConfirmed가 아니면 노쇼 판정 불가", async () => {
    const escortId = await seedEscort({
      guideId: "ns-st-g",
      travelerId: "ns-st-t",
      status: "InProgress",
      meetingTime: meetingPast31(),
    });
    await expect(
      runCallable<JudgeNoShowOutput>(
        judgeEscortNoShow,
        buildRequest("ns-st-g", {escortId})
      )
    ).rejects.toMatchObject({code: "failed-precondition"});
  });

  it("meetingTime이 없으면 노쇼 판정 불가", async () => {
    const escortId = await seedEscort({
      guideId: "ns-nomt-g",
      travelerId: "ns-nomt-t",
      status: "MeetingConfirmed",
    });
    await expect(
      runCallable<JudgeNoShowOutput>(
        judgeEscortNoShow,
        buildRequest("ns-nomt-g", {escortId})
      )
    ).rejects.toMatchObject({code: "failed-precondition"});
  });

  it("약속 + 30분 전이면 노쇼 판정 불가", async () => {
    const escortId = await seedEscort({
      guideId: "ns-early-g",
      travelerId: "ns-early-t",
      status: "MeetingConfirmed",
      meetingTime: meetingFuture(),
    });
    await expect(
      runCallable<JudgeNoShowOutput>(
        judgeEscortNoShow,
        buildRequest("ns-early-g", {escortId})
      )
    ).rejects.toMatchObject({code: "failed-precondition"});
  });

  it("guide만 확인했고 traveler 미확인이면 traveler 노쇼", async () => {
    await seedUser("ns-only-t", 0);
    const escortId = await seedEscort({
      guideId: "ns-only-g",
      travelerId: "ns-only-t",
      status: "MeetingConfirmed",
      meetingTime: meetingPast31(),
      guideArrivalConfirmedAt: Timestamp.now(),
    });
    const result = await runCallable<JudgeNoShowOutput>(
      judgeEscortNoShow,
      buildRequest("ns-only-g", {escortId})
    );
    expect(result.status).toBe("NoShow");
    expect(result.noShowBy).toEqual(["traveler"]);

    const escort = (await db.collection("escorts").doc(escortId).get()).data();
    expect(escort?.status).toBe("NoShow");
    const t = (await db.collection("users").doc("ns-only-t").get()).data();
    expect(t?.noShowCount).toBe(1);
  });

  it("traveler만 확인했고 guide 미확인이면 guide 노쇼", async () => {
    await seedUser("ns-onlyg-g", 0);
    const escortId = await seedEscort({
      guideId: "ns-onlyg-g",
      travelerId: "ns-onlyg-t",
      status: "MeetingConfirmed",
      meetingTime: meetingPast31(),
      travelerArrivalConfirmedAt: Timestamp.now(),
    });
    const result = await runCallable<JudgeNoShowOutput>(
      judgeEscortNoShow,
      buildRequest("ns-onlyg-t", {escortId})
    );
    expect(result.noShowBy).toEqual(["guide"]);
    const g = (await db.collection("users").doc("ns-onlyg-g").get()).data();
    expect(g?.noShowCount).toBe(1);
  });

  it("둘 다 미확인이면 둘 다 노쇼", async () => {
    await seedUser("ns-both-g", 0);
    await seedUser("ns-both-t", 0);
    const escortId = await seedEscort({
      guideId: "ns-both-g",
      travelerId: "ns-both-t",
      status: "MeetingConfirmed",
      meetingTime: meetingPast31(),
    });
    const result = await runCallable<JudgeNoShowOutput>(
      judgeEscortNoShow,
      buildRequest("ns-both-g", {escortId})
    );
    expect(result.noShowBy).toEqual(["guide", "traveler"]);
    const g = (await db.collection("users").doc("ns-both-g").get()).data();
    const t = (await db.collection("users").doc("ns-both-t").get()).data();
    expect(g?.noShowCount).toBe(1);
    expect(t?.noShowCount).toBe(1);
  });

  it("둘 다 확인했으면 노쇼 판정 불가", async () => {
    const escortId = await seedEscort({
      guideId: "ns-done-g",
      travelerId: "ns-done-t",
      status: "MeetingConfirmed",
      meetingTime: meetingPast31(),
      guideArrivalConfirmedAt: Timestamp.now(),
      travelerArrivalConfirmedAt: Timestamp.now(),
    });
    await expect(
      runCallable<JudgeNoShowOutput>(
        judgeEscortNoShow,
        buildRequest("ns-done-g", {escortId})
      )
    ).rejects.toMatchObject({code: "failed-precondition"});
  });

  it("노쇼 누적이 3회 이상이면 matchBlockedUntil이 설정된다", async () => {
    await seedUser("ns-block-t", 2); // 이번 판정으로 3회
    const escortId = await seedEscort({
      guideId: "ns-block-g",
      travelerId: "ns-block-t",
      status: "MeetingConfirmed",
      meetingTime: meetingPast31(),
      guideArrivalConfirmedAt: Timestamp.now(),
    });
    await runCallable<JudgeNoShowOutput>(
      judgeEscortNoShow,
      buildRequest("ns-block-g", {escortId})
    );
    const t = (await db.collection("users").doc("ns-block-t").get()).data();
    expect(t?.noShowCount).toBe(3);
    expect(t?.matchBlockedUntil).not.toBeNull();
  });

  // ---- checkArrival ----

  it("checkArrival은 도착 상태와 판정 가능 여부를 반환한다", async () => {
    const escortId = await seedEscort({
      guideId: "ca-g",
      travelerId: "ca-t",
      status: "MeetingConfirmed",
      meetingTime: meetingPast31(),
      guideArrivalConfirmedAt: Timestamp.now(),
    });
    const result = await runCallable<CheckArrivalOutput>(
      checkArrival,
      buildRequest("ca-g", {escortId})
    );
    expect(result.guideArrivalConfirmed).toBe(true);
    expect(result.travelerArrivalConfirmed).toBe(false);
    expect(result.canJudgeNoShow).toBe(true);
    expect(typeof result.meetingTime).toBe("string");
  });

  it("checkArrival은 당사자가 아니면 거부된다", async () => {
    const escortId = await seedEscort({
      guideId: "ca-perm-g",
      travelerId: "ca-perm-t",
      status: "MeetingConfirmed",
      meetingTime: meetingPast31(),
    });
    await expect(
      runCallable<CheckArrivalOutput>(
        checkArrival,
        buildRequest("ca-stranger", {escortId})
      )
    ).rejects.toMatchObject({code: "permission-denied"});
  });

  // ---- cancelEscort 당일 취소 패널티 ----

  it("당일 취소 시 취소자 noShowCount가 증가한다", async () => {
    await seedUser("cp-t", 0);
    const escortId = await seedEscort({
      guideId: "cp-g",
      travelerId: "cp-t",
      status: "MeetingConfirmed",
      meetingTime: Timestamp.now(),
    });
    await runCallable<CancelEscortOutput>(
      cancelEscort,
      buildRequest("cp-t", {escortId})
    );
    const t = (await db.collection("users").doc("cp-t").get()).data();
    expect(t?.noShowCount).toBe(1);
  });

  it("당일 취소 누적 3회 이상이면 matchBlockedUntil 설정", async () => {
    await seedUser("cp-block-g", 2);
    const escortId = await seedEscort({
      guideId: "cp-block-g",
      travelerId: "cp-block-t",
      status: "MeetingConfirmed",
      meetingTime: Timestamp.now(),
    });
    await runCallable<CancelEscortOutput>(
      cancelEscort,
      buildRequest("cp-block-g", {escortId})
    );
    const g = (await db.collection("users").doc("cp-block-g").get()).data();
    expect(g?.noShowCount).toBe(3);
    expect(g?.matchBlockedUntil).not.toBeNull();
  });

  it("전날 이전 취소는 noShowCount가 증가하지 않는다(패널티 없음)", async () => {
    // AC3: 약속 전날 또는 그 이전에 취소하면 페널티가 없어야 한다.
    await seedUser("cp-nopenalty-t", 0);
    const yesterday = Timestamp.fromMillis(Date.now() - 25 * 60 * 60 * 1000);
    const escortId = await seedEscort({
      guideId: "cp-nopenalty-g",
      travelerId: "cp-nopenalty-t",
      status: "MeetingConfirmed",
      meetingTime: yesterday, // 만남 시간이 어제 → 오늘 취소 = 전날 이전 취소
    });
    // meetingTime이 어제이고 오늘 취소하면 isSameUtcDay가 false → 패널티 없음.
    // (단, 어제와 오늘이 UTC 기준 같은 날일 수 없는 25시간 차이로 설정)
    const result = await runCallable<CancelEscortOutput>(
      cancelEscort,
      buildRequest("cp-nopenalty-t", {escortId})
    );
    expect(result.isSameDayCancellation).toBe(false);
    const t = (await db.collection("users").doc("cp-nopenalty-t").get()).data();
    expect(t?.noShowCount).toBe(0); // 패널티 없음
  });

  // ---- midTerminate ----

  it("미인증 사용자는 중도 종료할 수 없다", async () => {
    const id = await seedEscort({
      guideId: "mt-g",
      travelerId: "mt-t",
      status: "InProgress",
    });
    await expect(
      runCallable<MidTerminateOutput>(
        midTerminate,
        buildRequest(undefined, {escortId: id})
      )
    ).rejects.toThrow();
  });

  it("당사자가 아니면 중도 종료할 수 없다", async () => {
    const id = await seedEscort({
      guideId: "mt-perm-g",
      travelerId: "mt-perm-t",
      status: "InProgress",
    });
    await expect(
      runCallable<MidTerminateOutput>(
        midTerminate,
        buildRequest("mt-stranger", {escortId: id})
      )
    ).rejects.toMatchObject({code: "permission-denied"});
  });

  it("InProgress가 아니면 중도 종료할 수 없다", async () => {
    const id = await seedEscort({
      guideId: "mt-st-g",
      travelerId: "mt-st-t",
      status: "MeetingConfirmed",
    });
    await expect(
      runCallable<MidTerminateOutput>(
        midTerminate,
        buildRequest("mt-st-g", {escortId: id})
      )
    ).rejects.toMatchObject({code: "failed-precondition"});
  });

  it("guide 중도 종료 → MidTerminated + midTerminatedBy=guide", async () => {
    const id = await seedEscort({
      guideId: "mt-guide-g",
      travelerId: "mt-guide-t",
      status: "InProgress",
    });
    const result = await runCallable<MidTerminateOutput>(
      midTerminate,
      buildRequest("mt-guide-g", {escortId: id})
    );
    expect(result.status).toBe("MidTerminated");
    const data = (await db.collection("escorts").doc(id).get()).data();
    expect(data?.status).toBe("MidTerminated");
    expect(data?.midTerminatedBy).toBe("guide");
    expect(data?.midTerminatedAt).not.toBeNull();
  });

  it("traveler 중도 종료 → MidTerminated + midTerminatedBy=traveler", async () => {
    const id = await seedEscort({
      guideId: "mt-trav-g",
      travelerId: "mt-trav-t",
      status: "InProgress",
    });
    await runCallable<MidTerminateOutput>(
      midTerminate,
      buildRequest("mt-trav-t", {escortId: id})
    );
    const data = (await db.collection("escorts").doc(id).get()).data();
    expect(data?.midTerminatedBy).toBe("traveler");
  });

  it("reason이 있으면 저장된다", async () => {
    const id = await seedEscort({
      guideId: "mt-reason-g",
      travelerId: "mt-reason-t",
      status: "InProgress",
    });
    await runCallable<MidTerminateOutput>(
      midTerminate,
      buildRequest("mt-reason-g", {escortId: id, reason: "응급 상황 발생"})
    );
    const data = (await db.collection("escorts").doc(id).get()).data();
    expect(data?.midTerminateReason).toBe("응급 상황 발생");
  });

  it("reason이 500자를 초과하면 거부된다", async () => {
    const id = await seedEscort({
      guideId: "mt-long-g",
      travelerId: "mt-long-t",
      status: "InProgress",
    });
    await expect(
      runCallable<MidTerminateOutput>(
        midTerminate,
        buildRequest("mt-long-g", {escortId: id, reason: "x".repeat(501)})
      )
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  it("중도 종료는 패널티(noShowCount)를 증가시키지 않는다", async () => {
    await seedUser("mt-pen-g", 0);
    const id = await seedEscort({
      guideId: "mt-pen-g",
      travelerId: "mt-pen-t",
      status: "InProgress",
    });
    await runCallable<MidTerminateOutput>(
      midTerminate,
      buildRequest("mt-pen-g", {escortId: id})
    );
    const g = (await db.collection("users").doc("mt-pen-g").get()).data();
    expect(g?.noShowCount).toBe(0);
  });

  // ---- completeEscort ----

  it("미인증 사용자는 완료 확인할 수 없다", async () => {
    const id = await seedEscort({
      guideId: "ce-g",
      travelerId: "ce-t",
      status: "InProgress",
    });
    await expect(
      runCallable<CompleteEscortOutput>(
        completeEscort,
        buildRequest(undefined, {escortId: id})
      )
    ).rejects.toThrow();
  });

  it("당사자가 아니면 완료 확인할 수 없다", async () => {
    const id = await seedEscort({
      guideId: "ce-perm-g",
      travelerId: "ce-perm-t",
      status: "InProgress",
    });
    await expect(
      runCallable<CompleteEscortOutput>(
        completeEscort,
        buildRequest("ce-stranger", {escortId: id})
      )
    ).rejects.toMatchObject({code: "permission-denied"});
  });

  it("InProgress가 아니면 완료 확인할 수 없다", async () => {
    const id = await seedEscort({
      guideId: "ce-st-g",
      travelerId: "ce-st-t",
      status: "MeetingConfirmed",
    });
    await expect(
      runCallable<CompleteEscortOutput>(
        completeEscort,
        buildRequest("ce-st-g", {escortId: id})
      )
    ).rejects.toMatchObject({code: "failed-precondition"});
  });

  it("guide만 완료하면 InProgress 유지 + guideCompletedAt 기록", async () => {
    const id = await seedEscort({
      guideId: "ce-one-g",
      travelerId: "ce-one-t",
      status: "InProgress",
    });
    const result = await runCallable<CompleteEscortOutput>(
      completeEscort,
      buildRequest("ce-one-g", {escortId: id})
    );
    expect(result.status).toBe("InProgress");
    const data = (await db.collection("escorts").doc(id).get()).data();
    expect(data?.status).toBe("InProgress");
    expect(data?.guideCompletedAt).not.toBeNull();
    expect(data?.travelerCompletedAt).toBeNull();
  });

  it("traveler만 완료하면 InProgress 유지 + travelerCompletedAt 기록", async () => {
    const id = await seedEscort({
      guideId: "ce-onet-g",
      travelerId: "ce-onet-t",
      status: "InProgress",
    });
    const result = await runCallable<CompleteEscortOutput>(
      completeEscort,
      buildRequest("ce-onet-t", {escortId: id})
    );
    expect(result.status).toBe("InProgress");
    const data = (await db.collection("escorts").doc(id).get()).data();
    expect(data?.travelerCompletedAt).not.toBeNull();
  });

  it("양쪽 모두 완료하면 Completed로 전환", async () => {
    const id = await seedEscort({
      guideId: "ce-both-g",
      travelerId: "ce-both-t",
      status: "InProgress",
      guideCompletedAt: Timestamp.now(),
    });
    const result = await runCallable<CompleteEscortOutput>(
      completeEscort,
      buildRequest("ce-both-t", {escortId: id})
    );
    expect(result.status).toBe("Completed");
    const data = (await db.collection("escorts").doc(id).get()).data();
    expect(data?.status).toBe("Completed");
  });

  it("traveler가 satisfactionRating 1~5를 보내면 저장된다", async () => {
    const id = await seedEscort({
      guideId: "ce-rate-g",
      travelerId: "ce-rate-t",
      status: "InProgress",
    });
    await runCallable<CompleteEscortOutput>(
      completeEscort,
      buildRequest("ce-rate-t", {escortId: id, satisfactionRating: 4})
    );
    const data = (await db.collection("escorts").doc(id).get()).data();
    expect(data?.satisfactionRating).toBe(4);
  });

  it("traveler가 rating 없이도 완료 확인 가능", async () => {
    const id = await seedEscort({
      guideId: "ce-norate-g",
      travelerId: "ce-norate-t",
      status: "InProgress",
    });
    const result = await runCallable<CompleteEscortOutput>(
      completeEscort,
      buildRequest("ce-norate-t", {escortId: id})
    );
    expect(result.status).toBe("InProgress");
    const data = (await db.collection("escorts").doc(id).get()).data();
    expect(data?.satisfactionRating).toBeNull();
  });

  it("guide가 satisfactionRating을 보내면 거부", async () => {
    const id = await seedEscort({
      guideId: "ce-grate-g",
      travelerId: "ce-grate-t",
      status: "InProgress",
    });
    await expect(
      runCallable<CompleteEscortOutput>(
        completeEscort,
        buildRequest("ce-grate-g", {escortId: id, satisfactionRating: 5})
      )
    ).rejects.toMatchObject({code: "permission-denied"});
  });

  it("satisfactionRating이 범위를 벗어나면 거부", async () => {
    const id = await seedEscort({
      guideId: "ce-range-g",
      travelerId: "ce-range-t",
      status: "InProgress",
    });
    await expect(
      runCallable<CompleteEscortOutput>(
        completeEscort,
        buildRequest("ce-range-t", {escortId: id, satisfactionRating: 6})
      )
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  it("Completed/NoShow/Cancelled/MidTerminated에서는 완료 불가", async () => {
    for (const status of [
      "Completed",
      "NoShow",
      "Cancelled",
      "MidTerminated",
    ]) {
      const id = await seedEscort({
        guideId: "ce-term-g",
        travelerId: "ce-term-t",
        status,
      });
      await expect(
        runCallable<CompleteEscortOutput>(
          completeEscort,
          buildRequest("ce-term-g", {escortId: id})
        )
      ).rejects.toMatchObject({code: "failed-precondition"});
    }
  });

  // ---- Slice 9: 만족도 통계 반영 ----

  it("rating 제출 시 안내자 guideStats.averageSatisfaction이 갱신된다", async () => {
    await seedUser("st-guide-1", 0); // guideStats 초기값(avg null)
    const id = await seedEscort({
      guideId: "st-guide-1",
      travelerId: "st-trav-1",
      status: "InProgress",
      guideCompletedAt: Timestamp.now(),
    });
    await runCallable<CompleteEscortOutput>(
      completeEscort,
      buildRequest("st-trav-1", {escortId: id, satisfactionRating: 5})
    );

    const escort = (await db.collection("escorts").doc(id).get()).data();
    expect(escort?.satisfactionRating).toBe(5);
    const guide = (await db.collection("users").doc("st-guide-1").get()).data();
    expect(guide?.guideStats.averageSatisfaction).toBe(5);
    expect(guide?.guideStats.ratedEscortCount).toBe(1);
  });

  it("여러 완료 동행의 rating 평균이 올바르게 계산된다", async () => {
    await seedUser("st-guide-2", 0);
    const idA = await seedEscort({
      guideId: "st-guide-2",
      travelerId: "st-trav-a",
      status: "InProgress",
      guideCompletedAt: Timestamp.now(),
    });
    await runCallable<CompleteEscortOutput>(
      completeEscort,
      buildRequest("st-trav-a", {escortId: idA, satisfactionRating: 4})
    );
    const idB = await seedEscort({
      guideId: "st-guide-2",
      travelerId: "st-trav-b",
      status: "InProgress",
      guideCompletedAt: Timestamp.now(),
    });
    await runCallable<CompleteEscortOutput>(
      completeEscort,
      buildRequest("st-trav-b", {escortId: idB, satisfactionRating: 2})
    );

    const guide = (await db.collection("users").doc("st-guide-2").get()).data();
    expect(guide?.guideStats.averageSatisfaction).toBe(3); // (4+2)/2
    expect(guide?.guideStats.ratedEscortCount).toBe(2);
  });

  it("rating 없이 완료하면 averageSatisfaction이 변하지 않는다", async () => {
    await seedUser("st-guide-3", 0);
    const id = await seedEscort({
      guideId: "st-guide-3",
      travelerId: "st-trav-3",
      status: "InProgress",
      guideCompletedAt: Timestamp.now(),
    });
    await runCallable<CompleteEscortOutput>(
      completeEscort,
      buildRequest("st-trav-3", {escortId: id})
    );

    const guide = (await db.collection("users").doc("st-guide-3").get()).data();
    expect(guide?.guideStats.averageSatisfaction).toBeNull();
    expect(guide?.guideStats.ratedEscortCount ?? 0).toBe(0);
  });

  it("traveler 먼저 rating, InProgress면 guideStats 미변경", async () => {
    await seedUser("st-first-g", 0);
    // guide 미완료 → traveler 완료해도 status는 InProgress 유지.
    const id = await seedEscort({
      guideId: "st-first-g",
      travelerId: "st-first-t",
      status: "InProgress",
    });
    const r1 = await runCallable<CompleteEscortOutput>(
      completeEscort,
      buildRequest("st-first-t", {escortId: id, satisfactionRating: 5})
    );
    expect(r1.status).toBe("InProgress");

    // escort에는 rating 저장, 통계는 아직 미반영.
    let escort = (await db.collection("escorts").doc(id).get()).data();
    expect(escort?.satisfactionRating).toBe(5);
    expect(escort?.satisfactionStatsAppliedAt ?? null).toBeNull();
    let guide = (await db.collection("users").doc("st-first-g").get()).data();
    expect(guide?.guideStats.averageSatisfaction).toBeNull();

    // 이후 guide가 완료 → Completed 전환 시 기존 rating이 통계에 반영된다.
    const r2 = await runCallable<CompleteEscortOutput>(
      completeEscort,
      buildRequest("st-first-g", {escortId: id})
    );
    expect(r2.status).toBe("Completed");

    escort = (await db.collection("escorts").doc(id).get()).data();
    expect(escort?.satisfactionStatsAppliedAt).not.toBeNull();
    guide = (await db.collection("users").doc("st-first-g").get()).data();
    expect(guide?.guideStats.averageSatisfaction).toBe(5);
    expect(guide?.guideStats.ratedEscortCount).toBe(1);
  });

  it("satisfactionStatsAppliedAt이 있으면 같은 escort는 중복 반영되지 않는다", async () => {
    await seedUser("st-flag-g", 0);
    // 이미 통계 반영된(플래그 존재) escort. traveler는 완료 상태, guide만 미완료.
    const id = await seedEscort({
      guideId: "st-flag-g",
      travelerId: "st-flag-t",
      status: "InProgress",
      travelerCompletedAt: Timestamp.now(),
    });
    await db.collection("escorts").doc(id).update({
      satisfactionRating: 5,
      satisfactionStatsAppliedAt: Timestamp.now(),
    });

    // guide 완료 → Completed 전환되지만 플래그가 있어 통계 재반영 안 함.
    const r = await runCallable<CompleteEscortOutput>(
      completeEscort,
      buildRequest("st-flag-g", {escortId: id})
    );
    expect(r.status).toBe("Completed");

    const guide = (await db.collection("users").doc("st-flag-g").get()).data();
    expect(guide?.guideStats.averageSatisfaction).toBeNull(); // 중복 반영 안 됨
    expect(guide?.guideStats.ratedEscortCount ?? 0).toBe(0);
  });
});
