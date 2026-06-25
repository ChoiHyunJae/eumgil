import * as admin from "firebase-admin";
import {GeoPoint, Timestamp} from "firebase-admin/firestore";
import type {CallableRequest} from "firebase-functions/v2/https";
import {requestEscort, respondToRequest, searchGuides} from "../src/matching";
import type {
  RequestEscortOutput,
  RespondToRequestOutput,
  SearchGuidesOutput,
} from "../src/matching/types";

/**
 * Slice 6 (matching, Issue #8) — 안내자 탐색/요청 생성/요청 응답 emulator 테스트.
 *
 * Callable은 (fn as unknown as {run}).run(request) 방식으로 직접 호출한다.
 * 후보 조건: guideApproved, guideLocation 존재, 매칭 비제한, 본인 제외, 반경 1km.
 */

/** 검색 기준 좌표(서울시청 인근). */
const SEOUL = {lat: 37.5665, lng: 126.978};
/** SEOUL에서 약 60m. */
const NEAR_CLOSE = {lat: 37.567, lng: 126.9785};
/** SEOUL에서 약 400m(NEAR_CLOSE보다 멀다). */
const NEAR_FAR = {lat: 37.57, lng: 126.98};
/** SEOUL에서 약 1.5km(반경 밖). */
const FAR = {lat: 37.58, lng: 126.99};

describe("matching module", () => {
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
        {
          uid,
          token: {} as unknown,
          rawToken: "dummy",
        } as CallableRequest["auth"],
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

  /** seedGuide 옵션. */
  interface SeedGuideOptions {
    approved?: boolean;
    location?: {lat: number; lng: number} | null;
    matchBlockedUntil?: Timestamp | null;
    totalRequestsReceived?: number;
  }

  /**
   * users/{id} 안내자 후보 문서를 만든다.
   * @param {string} id 사용자 uid.
   * @param {SeedGuideOptions} options 후보 속성.
   * @return {Promise<void>} 쓰기 완료 시 resolve.
   */
  async function seedGuide(
    id: string,
    options: SeedGuideOptions = {}
  ): Promise<void> {
    const {
      approved = true,
      location = NEAR_CLOSE,
      matchBlockedUntil = null,
      totalRequestsReceived = 0,
    } = options;
    await db.collection("users").doc(id).set({
      phoneNumber: "+821000000000",
      emergencyContact: {name: "보호자", phoneNumber: "+821011112222"},
      guideApproved: approved,
      matchBlockedUntil,
      noShowCount: 0,
      guideLocation: location,
      guideStats: {
        averageSatisfaction: null,
        totalRequestsReceived,
        completedEscortCount: 0,
      },
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  }

  /**
   * escorts/{auto} 문서를 지정 상태로 만든다.
   * @param {object} fields 핵심 필드(guideId, travelerId, status, 만료시각).
   * @return {Promise<string>} 생성된 escort 문서 id.
   */
  async function seedEscort(fields: {
    guideId: string;
    travelerId: string;
    status: string;
    requestExpiresAt: Timestamp;
  }): Promise<string> {
    const now = Timestamp.now();
    const ref = db.collection("escorts").doc();
    await ref.set({
      guideId: fields.guideId,
      travelerId: fields.travelerId,
      status: fields.status,
      requestedAt: now,
      respondedAt: null,
      requestExpiresAt: fields.requestExpiresAt,
      meetingLocation: null,
      meetingTime: null,
      cancelledBy: null,
      cancelledAt: null,
      isSameDayCancellation: null,
      noShowBy: [],
      guideArrivalConfirmedAt: null,
      travelerArrivalConfirmedAt: null,
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

  const future = (): Timestamp =>
    Timestamp.fromMillis(Date.now() + 60 * 60 * 1000);
  const past = (): Timestamp => Timestamp.fromMillis(Date.now() - 1000);

  // ---- searchGuides ----

  it("반경 내 승인 안내자를 거리 오름차순으로 반환한다", async () => {
    await seedGuide("sg-close", {location: NEAR_CLOSE});
    await seedGuide("sg-far", {location: NEAR_FAR});

    const result = await runCallable<SearchGuidesOutput>(
      searchGuides,
      buildRequest("sg-traveler", {location: SEOUL})
    );

    const ids = result.candidates.map((c) => c.guide.id);
    const closeIdx = ids.indexOf("sg-close");
    const farIdx = ids.indexOf("sg-far");
    expect(closeIdx).toBeGreaterThanOrEqual(0);
    expect(farIdx).toBeGreaterThanOrEqual(0);
    expect(closeIdx).toBeLessThan(farIdx); // 가까운 안내자가 앞
  });

  it("미승인/위치없음/매칭제한/반경밖/본인은 후보에서 제외된다", async () => {
    await seedGuide("sg-unapproved", {approved: false, location: NEAR_CLOSE});
    await seedGuide("sg-noloc", {location: null});
    await seedGuide("sg-blocked", {
      location: NEAR_CLOSE,
      matchBlockedUntil: future(),
    });
    await seedGuide("sg-out", {location: FAR});
    await seedGuide("sg-self", {location: NEAR_CLOSE});

    const result = await runCallable<SearchGuidesOutput>(
      searchGuides,
      buildRequest("sg-self", {location: SEOUL})
    );
    const ids = result.candidates.map((c) => c.guide.id);

    expect(ids).not.toContain("sg-unapproved");
    expect(ids).not.toContain("sg-noloc");
    expect(ids).not.toContain("sg-blocked");
    expect(ids).not.toContain("sg-out");
    expect(ids).not.toContain("sg-self"); // 호출자 본인 제외
  });

  it("매칭제한이 과거면 후보에 포함된다", async () => {
    await seedGuide("sg-block-expired", {
      location: NEAR_CLOSE,
      matchBlockedUntil: past(),
    });

    const result = await runCallable<SearchGuidesOutput>(
      searchGuides,
      buildRequest("sg-traveler2", {location: SEOUL})
    );
    expect(result.candidates.map((c) => c.guide.id)).toContain(
      "sg-block-expired"
    );
  });

  it("요청 0건 안내자는 isNewGuide=true로 표시된다", async () => {
    await seedGuide("sg-new", {location: NEAR_CLOSE, totalRequestsReceived: 0});
    await seedGuide("sg-exp", {location: NEAR_CLOSE, totalRequestsReceived: 5});

    const result = await runCallable<SearchGuidesOutput>(
      searchGuides,
      buildRequest("sg-traveler3", {location: SEOUL})
    );
    const map = new Map(
      result.candidates.map((c) => [c.guide.id, c.isNewGuide])
    );
    expect(map.get("sg-new")).toBe(true);
    expect(map.get("sg-exp")).toBe(false);
  });

  it("미인증 호출은 거부된다", async () => {
    await expect(
      runCallable<SearchGuidesOutput>(
        searchGuides,
        buildRequest(undefined, {location: SEOUL})
      )
    ).rejects.toThrow();
  });

  it("좌표가 없으면 거부된다", async () => {
    await expect(
      runCallable<SearchGuidesOutput>(
        searchGuides,
        buildRequest("sg-traveler4", {})
      )
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  // ---- requestEscort ----

  it("동행 요청을 생성하면 Requested escort가 만들어진다", async () => {
    await seedGuide("re-guide");

    const result = await runCallable<RequestEscortOutput>(
      requestEscort,
      buildRequest("re-traveler", {guideId: "re-guide"})
    );
    expect(typeof result.escortId).toBe("string");
    expect(typeof result.requestExpiresAt).toBe("string");

    const doc = await db.collection("escorts").doc(result.escortId).get();
    const data = doc.data();
    expect(data?.status).toBe("Requested");
    expect(data?.guideId).toBe("re-guide");
    expect(data?.travelerId).toBe("re-traveler");
  });

  it("자기 자신에게 요청하면 거부된다", async () => {
    await seedGuide("re-self");
    await expect(
      runCallable<RequestEscortOutput>(
        requestEscort,
        buildRequest("re-self", {guideId: "re-self"})
      )
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  it("guideId가 없으면 거부된다", async () => {
    await expect(
      runCallable<RequestEscortOutput>(
        requestEscort,
        buildRequest("re-traveler2", {})
      )
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  it("존재하지 않는 안내자 요청은 거부된다", async () => {
    await expect(
      runCallable<RequestEscortOutput>(
        requestEscort,
        buildRequest("re-traveler3", {guideId: "no-such-guide"})
      )
    ).rejects.toMatchObject({code: "not-found"});
  });

  it("미승인 안내자 요청은 거부된다", async () => {
    await seedGuide("re-unapproved", {approved: false});
    await expect(
      runCallable<RequestEscortOutput>(
        requestEscort,
        buildRequest("re-traveler4", {guideId: "re-unapproved"})
      )
    ).rejects.toMatchObject({code: "failed-precondition"});
  });

  it("매칭제한 중인 안내자 요청은 거부된다", async () => {
    await seedGuide("re-blocked", {matchBlockedUntil: future()});
    await expect(
      runCallable<RequestEscortOutput>(
        requestEscort,
        buildRequest("re-traveler5", {guideId: "re-blocked"})
      )
    ).rejects.toMatchObject({code: "failed-precondition"});
  });

  it("같은 쌍의 진행 중 요청이 있으면 중복 요청을 막는다", async () => {
    await seedGuide("re-dup-guide");
    await runCallable<RequestEscortOutput>(
      requestEscort,
      buildRequest("re-dup-traveler", {guideId: "re-dup-guide"})
    );
    await expect(
      runCallable<RequestEscortOutput>(
        requestEscort,
        buildRequest("re-dup-traveler", {guideId: "re-dup-guide"})
      )
    ).rejects.toMatchObject({code: "already-exists"});
  });

  it("미인증 요청 생성은 거부된다", async () => {
    await seedGuide("re-guide2");
    await expect(
      runCallable<RequestEscortOutput>(
        requestEscort,
        buildRequest(undefined, {guideId: "re-guide2"})
      )
    ).rejects.toThrow();
  });

  // ---- respondToRequest ----

  it("수락 시 만남 정보와 함께 MeetingConfirmed로 전환된다", async () => {
    const escortId = await seedEscort({
      guideId: "rr-guide",
      travelerId: "rr-traveler",
      status: "Requested",
      requestExpiresAt: future(),
    });

    const result = await runCallable<RespondToRequestOutput>(
      respondToRequest,
      buildRequest("rr-guide", {
        escortId,
        accept: true,
        meetingLocation: {lat: 37.5665, lng: 126.978},
        meetingTime: "2026-07-01T10:00:00.000Z",
      })
    );
    expect(result.status).toBe("MeetingConfirmed");

    const data = (await db.collection("escorts").doc(escortId).get()).data();
    expect(data?.status).toBe("MeetingConfirmed");
    expect(data?.meetingLocation).toBeInstanceOf(GeoPoint);
    expect(data?.meetingTime).not.toBeNull();
    expect(data?.respondedAt).not.toBeNull();
  });

  it("거절 시 Rejected로 전환된다", async () => {
    const escortId = await seedEscort({
      guideId: "rr-guide-rej",
      travelerId: "rr-traveler-rej",
      status: "Requested",
      requestExpiresAt: future(),
    });

    const result = await runCallable<RespondToRequestOutput>(
      respondToRequest,
      buildRequest("rr-guide-rej", {escortId, accept: false})
    );
    expect(result.status).toBe("Rejected");

    const data = (await db.collection("escorts").doc(escortId).get()).data();
    expect(data?.status).toBe("Rejected");
  });

  it("수락인데 만남 정보가 없으면 거부된다", async () => {
    const escortId = await seedEscort({
      guideId: "rr-guide-nomeet",
      travelerId: "rr-traveler-nomeet",
      status: "Requested",
      requestExpiresAt: future(),
    });
    await expect(
      runCallable<RespondToRequestOutput>(
        respondToRequest,
        buildRequest("rr-guide-nomeet", {escortId, accept: true})
      )
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  it("요청 대상 안내자가 아니면 거부된다", async () => {
    const escortId = await seedEscort({
      guideId: "rr-guide-owner",
      travelerId: "rr-traveler-x",
      status: "Requested",
      requestExpiresAt: future(),
    });
    await expect(
      runCallable<RespondToRequestOutput>(
        respondToRequest,
        buildRequest("rr-someone-else", {escortId, accept: false})
      )
    ).rejects.toMatchObject({code: "permission-denied"});
  });

  it("Requested 상태가 아니면 거부된다", async () => {
    const escortId = await seedEscort({
      guideId: "rr-guide-done",
      travelerId: "rr-traveler-done",
      status: "Rejected",
      requestExpiresAt: future(),
    });
    await expect(
      runCallable<RespondToRequestOutput>(
        respondToRequest,
        buildRequest("rr-guide-done", {escortId, accept: false})
      )
    ).rejects.toMatchObject({code: "failed-precondition"});
  });

  it("만료된 요청은 Expired로 전환되고 거부된다", async () => {
    const escortId = await seedEscort({
      guideId: "rr-guide-exp",
      travelerId: "rr-traveler-exp",
      status: "Requested",
      requestExpiresAt: past(),
    });
    await expect(
      runCallable<RespondToRequestOutput>(
        respondToRequest,
        buildRequest("rr-guide-exp", {escortId, accept: false})
      )
    ).rejects.toMatchObject({code: "failed-precondition"});

    const data = (await db.collection("escorts").doc(escortId).get()).data();
    expect(data?.status).toBe("Expired");
  });

  it("escortId가 없으면 거부된다", async () => {
    await expect(
      runCallable<RespondToRequestOutput>(
        respondToRequest,
        buildRequest("rr-guide-z", {accept: false})
      )
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  it("미인증 응답은 거부된다", async () => {
    await expect(
      runCallable<RespondToRequestOutput>(
        respondToRequest,
        buildRequest(undefined, {escortId: "x", accept: false})
      )
    ).rejects.toThrow();
  });
});
