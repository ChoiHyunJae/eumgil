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
 * Slice 7 (escort, Issue #9) ?????숉뻾 議고쉶 / ?쒖옉 ??痍⑥냼 emulator ?뚯뒪??
 * Callable? (fn as unknown as {run}).run(request) 諛⑹떇?쇰줈 吏곸젒 ?몄텧?쒕떎.
 */
describe("escort module", () => {
  let app: admin.app.App;
  let db: admin.firestore.Firestore;

  beforeAll(() => {
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
      throw new Error(
        "FIRESTORE_EMULATOR_HOST媛 ?ㅼ젙?섏뼱 ?덉? ?딆뒿?덈떎. " +
          "`npm test`(firebase emulators:exec)濡??ㅽ뻾?섏꽭??"
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
   * ?뚯뒪??CallableRequest瑜?留뚮뱺?? uid媛 undefined硫?誘몄씤利??붿껌.
   * @param {string | undefined} uid ?몄텧??uid.
   * @param {unknown} data ?낅젰 ?섏씠濡쒕뱶.
   * @return {CallableRequest<unknown>} 援ъ꽦???붿껌.
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
   * v2 onCall ?⑥닔瑜?.run()?쇰줈 吏곸젒 ?몄텧?쒕떎.
   * @param {unknown} fn ?몄텧??callable.
   * @param {CallableRequest<unknown>} request ?꾨떖???붿껌.
   * @return {Promise<O>} ?몄텧 寃곌낵.
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
   * escorts/{auto} 臾몄꽌瑜?吏???곹깭濡?留뚮뱺??
   * @param {object} fields guideId/travelerId/status 諛??좏깮??meetingTime.
   * @return {Promise<string>} ?앹꽦??escort 臾몄꽌 id.
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

  it("誘몄씤利??ъ슜?먮뒗 ???숉뻾??議고쉶?????녿떎", async () => {
    await expect(
      runCallable<ListMyEscortsOutput>(
        listMyEscorts,
        buildRequest(undefined, {})
      )
    ).rejects.toThrow();
  });

  it("guide/traveler ?대뒓 履쎌씠??蹂몄씤 愿??吏꾪뻾 以??숉뻾??諛섑솚?쒕떎", async () => {
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

  it("吏꾪뻾 以묒씠 ?꾨땶(痍⑥냼/?꾨즺 ?? ?숉뻾? ?쒖쇅?쒕떎", async () => {
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

  it("?닿? ?뱀궗?먭? ?꾨땶 ?숉뻾? 諛섑솚?섏? ?딅뒗??, async () => {
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

  it("meetingTime? ISO 臾몄옄???먮뒗 null濡?諛섑솚?쒕떎", async () => {
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

  it("?뱀궗?먮뒗 ?쒖옉 ???숉뻾??痍⑥냼?????덈떎", async () => {
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

  it("留뚮궓 ?뱀씪 痍⑥냼??isSameDayCancellation=true", async () => {
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

  it("?뱀궗?먭? ?꾨땲硫?痍⑥냼?????녿떎", async () => {
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

  it("?쒖옉 ???곹깭媛 ?꾨땲硫?痍⑥냼?????녿떎", async () => {
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

  it("?녿뒗 escort 痍⑥냼??not-found", async () => {
    await expect(
      runCallable<CancelEscortOutput>(
        cancelEscort,
        buildRequest("es-any", {escortId: "no-such-escort"})
      )
    ).rejects.toMatchObject({code: "not-found"});
  });

  it("escortId媛 ?놁쑝硫?嫄곕??쒕떎", async () => {
    await expect(
      runCallable<CancelEscortOutput>(
        cancelEscort,
        buildRequest("es-any", {})
      )
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  it("誘몄씤利?痍⑥냼??嫄곕??쒕떎", async () => {
    await expect(
      runCallable<CancelEscortOutput>(
        cancelEscort,
        buildRequest(undefined, {escortId: "x"})
      )
    ).rejects.toThrow();
  });

  // ---- confirmMeeting ----

  /** 留뚮궓 ?μ냼(?쒖슱?쒖껌). */
  const MEET = new GeoPoint(37.5665, 126.978);
  /** MEET?먯꽌 ??60m(50m 珥덇낵). */
  const FAR = {lat: 37.5671, lng: 126.978};

  it("誘몄씤利??ъ슜?먮뒗 留뚮궓 ?뺤씤???????녿떎", async () => {
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

  it("?뱀궗?먭? ?꾨땲硫?留뚮궓 ?뺤씤???????녿떎", async () => {
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

  it("MeetingConfirmed媛 ?꾨땲硫?嫄곕??쒕떎", async () => {
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

  it("留뚮궓 ?μ냼?먯꽌 50m 珥덇낵硫?嫄곕??쒕떎", async () => {
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

  it("?좏슚?섏? ?딆? 醫뚰몴??invalid-argument", async () => {
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

  it("guide ?쒖そ留??뺤씤?섎㈃ MeetingConfirmed ?좎? + ?쒓컖 湲곕줉", async () => {
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

  it("?묒そ 紐⑤몢 ?뺤씤?섎㈃ InProgress濡??꾪솚 + ?쒓컖 湲곕줉", async () => {
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

