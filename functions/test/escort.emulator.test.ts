import * as admin from "firebase-admin";
import {GeoPoint, Timestamp} from "firebase-admin/firestore";
import type {CallableRequest} from "firebase-functions/v2/https";
import {cancelEscort, confirmMeeting, listMyEscorts} from "../src/escort";
import type {
  CancelEscortOutput,
  ConfirmMeetingOutput,
  ListMyEscortsOutput,
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
      guideCompletedAt: null,
      travelerCompletedAt: null,
      satisfactionRating: null,
      createdAt: now,
      updatedAt: now,
    });
    return ref.id;
  }

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
});
