import * as admin from "firebase-admin";
import {GeoPoint, Timestamp} from "firebase-admin/firestore";
import type {CallableRequest} from "firebase-functions/v2/https";
import {
  acceptCounterOffer,
  acknowledgeEscortResponse,
  listReceivedEscortRequests,
  proposeCounterOffer,
  requestEscort,
  respondToRequest,
  searchGuides,
} from "../src/matching";
import type {
  AcceptCounterOfferOutput,
  AcknowledgeEscortResponseOutput,
  ListReceivedEscortRequestsOutput,
  ProposeCounterOfferOutput,
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
    completedEscortCount?: number;
    averageSatisfaction?: number | null;
    ratedEscortCount?: number;
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
      completedEscortCount = 0,
      averageSatisfaction = null,
      ratedEscortCount = 0,
    } = options;
    await db.collection("users").doc(id).set({
      phoneNumber: "+821000000000",
      emergencyContact: {name: "보호자", phoneNumber: "+821011112222"},
      guideApproved: approved,
      matchBlockedUntil,
      noShowCount: 0,
      guideLocation: location,
      guideStats: {
        averageSatisfaction,
        totalRequestsReceived,
        completedEscortCount,
        ratedEscortCount,
      },
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  }

  /**
   * escorts/{auto} 문서를 지정 상태로 만든다.
   * @param {object} fields 핵심 필드(guideId, travelerId, status, 만료시각, 요청시각).
   * @return {Promise<string>} 생성된 escort 문서 id.
   */
  async function seedEscort(fields: {
    guideId: string;
    travelerId: string;
    status: string;
    requestExpiresAt: Timestamp;
    requestedAt?: Timestamp;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    counterProposal?: any;
    counterProposalCount?: number;
  }): Promise<string> {
    const now = Timestamp.now();
    const requestedAt = fields.requestedAt ?? now;
    const ref = db.collection("escorts").doc();
    await ref.set({
      guideId: fields.guideId,
      travelerId: fields.travelerId,
      status: fields.status,
      requestedAt,
      respondedAt: null,
      travelerNotifiedAt: null,
      requestExpiresAt: fields.requestExpiresAt,
      meetingLocation: null,
      meetingTime: null,
      counterProposal: fields.counterProposal ?? null,
      counterProposalCount: fields.counterProposalCount ?? 0,
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

  // ---- searchGuides 정렬(Slice 10) ----

  /**
   * 결과에서 특정 guideId의 순위(인덱스)를 반환한다(없으면 -1).
   * @param {SearchGuidesOutput} result 검색 결과.
   * @param {string} id guide uid.
   * @return {number} 후보 목록 내 인덱스.
   */
  function rankOf(result: SearchGuidesOutput, id: string): number {
    return result.candidates.findIndex((c) => c.guide.id === id);
  }

  it("요청 1건 이상 안내자는 averageSatisfaction 내림차순으로 정렬된다", async () => {
    await seedGuide("rk1-hi", {
      totalRequestsReceived: 10,
      completedEscortCount: 5,
      averageSatisfaction: 5,
      ratedEscortCount: 3,
    });
    await seedGuide("rk1-mid", {
      totalRequestsReceived: 10,
      completedEscortCount: 5,
      averageSatisfaction: 4,
      ratedEscortCount: 3,
    });
    await seedGuide("rk1-lo", {
      totalRequestsReceived: 10,
      completedEscortCount: 5,
      averageSatisfaction: 3,
      ratedEscortCount: 3,
    });

    const r = await runCallable<SearchGuidesOutput>(
      searchGuides,
      buildRequest("rk1-trav", {location: SEOUL})
    );
    expect(rankOf(r, "rk1-hi")).toBeLessThan(rankOf(r, "rk1-mid"));
    expect(rankOf(r, "rk1-mid")).toBeLessThan(rankOf(r, "rk1-lo"));
  });

  it("만족도가 같으면 성사율 내림차순으로 정렬된다", async () => {
    await seedGuide("rk2-hi", {
      totalRequestsReceived: 10,
      completedEscortCount: 8, // 0.8
      averageSatisfaction: 4,
      ratedEscortCount: 2,
    });
    await seedGuide("rk2-lo", {
      totalRequestsReceived: 10,
      completedEscortCount: 4, // 0.4
      averageSatisfaction: 4,
      ratedEscortCount: 2,
    });

    const r = await runCallable<SearchGuidesOutput>(
      searchGuides,
      buildRequest("rk2-trav", {location: SEOUL})
    );
    expect(rankOf(r, "rk2-hi")).toBeLessThan(rankOf(r, "rk2-lo"));
  });

  it("만족도·성사율이 같으면 거리 오름차순으로 정렬된다", async () => {
    await seedGuide("rk3-near", {
      location: NEAR_CLOSE,
      totalRequestsReceived: 10,
      completedEscortCount: 5,
      averageSatisfaction: 4,
      ratedEscortCount: 2,
    });
    await seedGuide("rk3-far", {
      location: NEAR_FAR,
      totalRequestsReceived: 10,
      completedEscortCount: 5,
      averageSatisfaction: 4,
      ratedEscortCount: 2,
    });

    const r = await runCallable<SearchGuidesOutput>(
      searchGuides,
      buildRequest("rk3-trav", {location: SEOUL})
    );
    expect(rankOf(r, "rk3-near")).toBeLessThan(rankOf(r, "rk3-far"));
  });

  it("신규 안내자는 거리순으로만 정렬되고 기존 안내자보다 뒤에 온다", async () => {
    // 기존 안내자(요청 1건 이상)는 멀어도 신규보다 앞.
    await seedGuide("rk4-exist", {
      location: NEAR_FAR,
      totalRequestsReceived: 5,
      completedEscortCount: 0,
    });
    await seedGuide("rk4-new-near", {
      location: NEAR_CLOSE,
      totalRequestsReceived: 0,
    });
    await seedGuide("rk4-new-far", {
      location: NEAR_FAR,
      totalRequestsReceived: 0,
    });

    const r = await runCallable<SearchGuidesOutput>(
      searchGuides,
      buildRequest("rk4-trav", {location: SEOUL})
    );
    // 신규끼리는 거리 오름차순
    expect(rankOf(r, "rk4-new-near")).toBeLessThan(rankOf(r, "rk4-new-far"));
    // 기존(먼) 안내자가 더 가까운 신규 안내자보다 앞
    expect(rankOf(r, "rk4-exist")).toBeLessThan(rankOf(r, "rk4-new-near"));
  });

  it("요청 1건 이상·완료 0건은 신규가 아니며 성사율 0으로 정렬에 포함된다", async () => {
    await seedGuide("rk5-better", {
      totalRequestsReceived: 3,
      completedEscortCount: 3, // 성사율 1.0
    });
    await seedGuide("rk5-zero", {
      totalRequestsReceived: 3,
      completedEscortCount: 0, // 성사율 0, 신규 아님
    });
    await seedGuide("rk5-new", {totalRequestsReceived: 0});

    const r = await runCallable<SearchGuidesOutput>(
      searchGuides,
      buildRequest("rk5-trav", {location: SEOUL})
    );
    const zero = r.candidates.find((c) => c.guide.id === "rk5-zero");
    expect(zero?.isNewGuide).toBe(false); // 신규 아님
    // 성사율 1.0 > 0 → better가 앞
    expect(rankOf(r, "rk5-better")).toBeLessThan(rankOf(r, "rk5-zero"));
    // 완료 0건이지만 신규 안내자보다는 앞(기존 그룹)
    expect(rankOf(r, "rk5-zero")).toBeLessThan(rankOf(r, "rk5-new"));
  });

  it("만족도 데이터가 없어도 성사율·거리로 정렬이 깨지지 않는다", async () => {
    await seedGuide("rk6-hi", {
      totalRequestsReceived: 4,
      completedEscortCount: 4, // 성사율 1.0
      averageSatisfaction: null, // 만족도 없음
      ratedEscortCount: 0,
    });
    await seedGuide("rk6-lo", {
      totalRequestsReceived: 4,
      completedEscortCount: 2, // 성사율 0.5
      averageSatisfaction: null,
      ratedEscortCount: 0,
    });

    const r = await runCallable<SearchGuidesOutput>(
      searchGuides,
      buildRequest("rk6-trav", {location: SEOUL})
    );
    expect(rankOf(r, "rk6-hi")).toBeGreaterThanOrEqual(0);
    expect(rankOf(r, "rk6-hi")).toBeLessThan(rankOf(r, "rk6-lo"));
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

  it("동네 지식을 보고 요청하면 requestedArchiveItemId가 저장된다", async () => {
    await seedGuide("re-item-guide");
    const itemRef = await db.collection("archiveItems").add({
      authorId: "re-item-guide",
      category: "PLACE",
      voiceTranscript: "제가 자주 가는 카페입니다.",
      aiSummary: null,
      confirmedByAuthor: true,
      photoUrls: [],
      exactLocation: new GeoPoint(37.5665, 126.978),
      dongLabel: "종로구 광화문·세종로 인근",
      visibilityRadiusM: 3000,
      published: true,
      reportCount: 0,
      hidden: false,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });

    const result = await runCallable<RequestEscortOutput>(
      requestEscort,
      buildRequest("re-item-traveler", {
        guideId: "re-item-guide",
        archiveItemId: itemRef.id,
      })
    );
    const data = (await db.collection("escorts").doc(result.escortId).get())
      .data();
    expect(data?.requestedArchiveItemId).toBe(itemRef.id);
  });

  it("다른 안내자의 동네 지식으로 요청하면 거부된다", async () => {
    await seedGuide("re-item-guideA");
    await seedGuide("re-item-guideB");
    const itemRef = await db.collection("archiveItems").add({
      authorId: "re-item-guideB",
      category: "PLACE",
      voiceTranscript: "제가 자주 가는 카페입니다.",
      aiSummary: null,
      confirmedByAuthor: true,
      photoUrls: [],
      exactLocation: new GeoPoint(37.5665, 126.978),
      dongLabel: "종로구 광화문·세종로 인근",
      visibilityRadiusM: 3000,
      published: true,
      reportCount: 0,
      hidden: false,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });

    await expect(
      runCallable<RequestEscortOutput>(
        requestEscort,
        buildRequest("re-item-traveler2", {
          guideId: "re-item-guideA", // itemRef의 작성자(guideB)와 다름
          archiveItemId: itemRef.id,
        })
      )
    ).rejects.toMatchObject({code: "invalid-argument"});
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

  it("meetingArchiveItemId로 수락하면 본인 동네 지식 위치가 만남 장소가 된다", async () => {
    const escortId = await seedEscort({
      guideId: "rr-item-guide",
      travelerId: "rr-item-traveler",
      status: "Requested",
      requestExpiresAt: future(),
    });
    const itemRef = await db.collection("archiveItems").add({
      authorId: "rr-item-guide",
      category: "PLACE",
      voiceTranscript: "제가 자주 가는 카페입니다.",
      aiSummary: null,
      confirmedByAuthor: true,
      photoUrls: [],
      exactLocation: new GeoPoint(37.5665, 126.978),
      dongLabel: "종로구 광화문·세종로 인근",
      visibilityRadiusM: 3000,
      published: true,
      reportCount: 0,
      hidden: false,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });

    const result = await runCallable<RespondToRequestOutput>(
      respondToRequest,
      buildRequest("rr-item-guide", {
        escortId,
        accept: true,
        meetingArchiveItemId: itemRef.id,
        meetingTime: "2026-07-01T10:00:00.000Z",
      })
    );
    expect(result.status).toBe("MeetingConfirmed");

    const data = (await db.collection("escorts").doc(escortId).get()).data();
    expect(data?.meetingLocation).toBeInstanceOf(GeoPoint);
    expect((data?.meetingLocation as GeoPoint).latitude).toBeCloseTo(37.5665);
    expect(data?.meetingLocationLabel).toBe("종로구 광화문·세종로 인근");
  });

  it("타인의 동네 지식으로 만남 장소를 지정하면 거부된다", async () => {
    await seedGuide("rr-item-other");
    const escortId = await seedEscort({
      guideId: "rr-item-guide2",
      travelerId: "rr-item-traveler2",
      status: "Requested",
      requestExpiresAt: future(),
    });
    const itemRef = await db.collection("archiveItems").add({
      authorId: "rr-item-other", // rr-item-guide2가 아닌 다른 사람의 글
      category: "PLACE",
      voiceTranscript: "제가 자주 가는 카페입니다.",
      aiSummary: null,
      confirmedByAuthor: true,
      photoUrls: [],
      exactLocation: new GeoPoint(37.5665, 126.978),
      dongLabel: "종로구 광화문·세종로 인근",
      visibilityRadiusM: 3000,
      published: true,
      reportCount: 0,
      hidden: false,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });

    await expect(
      runCallable<RespondToRequestOutput>(
        respondToRequest,
        buildRequest("rr-item-guide2", {
          escortId,
          accept: true,
          meetingArchiveItemId: itemRef.id,
          meetingTime: "2026-07-01T10:00:00.000Z",
        })
      )
    ).rejects.toMatchObject({code: "invalid-argument"});
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

  it("매칭제한 중인 안내자 본인은 요청을 수락할 수 없다", async () => {
    await seedGuide("rr-blocked-guide", {matchBlockedUntil: future()});
    const escortId = await seedEscort({
      guideId: "rr-blocked-guide",
      travelerId: "rr-t-blk",
      status: "Requested",
      requestExpiresAt: future(),
    });
    await expect(
      runCallable<RespondToRequestOutput>(
        respondToRequest,
        buildRequest("rr-blocked-guide", {
          escortId,
          accept: true,
          meetingLocation: {lat: 37.5665, lng: 126.978},
          meetingTime: "2026-07-01T10:00:00.000Z",
        })
      )
    ).rejects.toMatchObject({code: "failed-precondition"});
  });

  it("매칭제한 중인 안내자도 요청을 거절할 수는 있다", async () => {
    await seedGuide("rr-blocked-guide2", {matchBlockedUntil: future()});
    const escortId = await seedEscort({
      guideId: "rr-blocked-guide2",
      travelerId: "rr-t-blk2",
      status: "Requested",
      requestExpiresAt: future(),
    });
    const result = await runCallable<RespondToRequestOutput>(
      respondToRequest,
      buildRequest("rr-blocked-guide2", {escortId, accept: false})
    );
    expect(result.status).toBe("Rejected");
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

  // ---- listReceivedEscortRequests ----

  it("미인증 사용자는 받은 요청 목록을 조회할 수 없다", async () => {
    await expect(
      runCallable<ListReceivedEscortRequestsOutput>(
        listReceivedEscortRequests,
        buildRequest(undefined, {})
      )
    ).rejects.toThrow();
  });

  it("본인이 guideId인 Requested 요청만 반환한다", async () => {
    const guide = "lr-guide-self";
    const escortId = await seedEscort({
      guideId: guide,
      travelerId: "lr-traveler-1",
      status: "Requested",
      requestExpiresAt: future(),
    });

    const result = await runCallable<ListReceivedEscortRequestsOutput>(
      listReceivedEscortRequests,
      buildRequest(guide, {})
    );
    const ids = result.requests.map((r) => r.escortId);
    expect(ids).toContain(escortId);
    expect(result.requests.every((r) => r.travelerId === "lr-traveler-1")).toBe(
      true
    );
  });

  it("다른 guideId의 요청은 반환하지 않는다", async () => {
    const otherEscort = await seedEscort({
      guideId: "lr-guide-other",
      travelerId: "lr-traveler-2",
      status: "Requested",
      requestExpiresAt: future(),
    });

    const result = await runCallable<ListReceivedEscortRequestsOutput>(
      listReceivedEscortRequests,
      buildRequest("lr-guide-viewer", {})
    );
    expect(result.requests.map((r) => r.escortId)).not.toContain(otherEscort);
  });

  it("Requested가 아닌 요청은 반환하지 않는다", async () => {
    const guide = "lr-guide-status";
    const rejected = await seedEscort({
      guideId: guide,
      travelerId: "lr-t-rej",
      status: "Rejected",
      requestExpiresAt: future(),
    });
    const accepted = await seedEscort({
      guideId: guide,
      travelerId: "lr-t-acc",
      status: "Accepted",
      requestExpiresAt: future(),
    });
    const confirmed = await seedEscort({
      guideId: guide,
      travelerId: "lr-t-conf",
      status: "MeetingConfirmed",
      requestExpiresAt: future(),
    });

    const result = await runCallable<ListReceivedEscortRequestsOutput>(
      listReceivedEscortRequests,
      buildRequest(guide, {})
    );
    const ids = result.requests.map((r) => r.escortId);
    expect(ids).not.toContain(rejected);
    expect(ids).not.toContain(accepted);
    expect(ids).not.toContain(confirmed);
  });

  it("만료된 Requested 요청은 반환하지 않는다", async () => {
    const guide = "lr-guide-expired";
    const expired = await seedEscort({
      guideId: guide,
      travelerId: "lr-t-exp",
      status: "Requested",
      requestExpiresAt: past(),
    });

    const result = await runCallable<ListReceivedEscortRequestsOutput>(
      listReceivedEscortRequests,
      buildRequest(guide, {})
    );
    expect(result.requests.map((r) => r.escortId)).not.toContain(expired);
  });

  it("반환 항목에 escortId/travelerId/요청시각/만료시각이 포함된다", async () => {
    const guide = "lr-guide-fields";
    const escortId = await seedEscort({
      guideId: guide,
      travelerId: "lr-t-fields",
      status: "Requested",
      requestExpiresAt: future(),
    });

    const result = await runCallable<ListReceivedEscortRequestsOutput>(
      listReceivedEscortRequests,
      buildRequest(guide, {})
    );
    const item = result.requests.find((r) => r.escortId === escortId);
    expect(item).toBeDefined();
    expect(item?.travelerId).toBe("lr-t-fields");
    expect(typeof item?.requestedAt).toBe("string");
    expect(typeof item?.requestExpiresAt).toBe("string");
    expect(Number.isNaN(Date.parse(item?.requestedAt ?? ""))).toBe(false);
    expect(Number.isNaN(Date.parse(item?.requestExpiresAt ?? ""))).toBe(false);
  });

  it("requestedAt 오름차순 정렬이 유지된다", async () => {
    const guide = "lr-guide-sort";
    const older = Timestamp.fromMillis(Date.now() - 3 * 60 * 1000);
    const newer = Timestamp.fromMillis(Date.now() - 1 * 60 * 1000);
    const newerId = await seedEscort({
      guideId: guide,
      travelerId: "lr-t-newer",
      status: "Requested",
      requestExpiresAt: future(),
      requestedAt: newer,
    });
    const olderId = await seedEscort({
      guideId: guide,
      travelerId: "lr-t-older",
      status: "Requested",
      requestExpiresAt: future(),
      requestedAt: older,
    });

    const result = await runCallable<ListReceivedEscortRequestsOutput>(
      listReceivedEscortRequests,
      buildRequest(guide, {})
    );
    const ids = result.requests.map((r) => r.escortId);
    expect(ids.indexOf(olderId)).toBeLessThan(ids.indexOf(newerId));
  });

  // ---- proposeCounterOffer / acceptCounterOffer ----

  it("당사자가 재제안하면 Requested를 유지하며 counterProposal이 저장된다", async () => {
    const escortId = await seedEscort({
      guideId: "cp-guide",
      travelerId: "cp-traveler",
      status: "Requested",
      requestExpiresAt: future(),
    });

    const result = await runCallable<ProposeCounterOfferOutput>(
      proposeCounterOffer,
      buildRequest("cp-guide", {
        escortId,
        meetingTime: "2026-08-01T10:00:00.000Z",
        meetingLocation: {lat: 37.5665, lng: 126.978},
        message: "이 시간은 어렵고 오후는 어떨까요?",
      })
    );
    expect(result.counterProposal.proposedBy).toBe("guide");
    expect(result.counterProposalCount).toBe(1);

    const data = (await db.collection("escorts").doc(escortId).get()).data();
    expect(data?.status).toBe("Requested");
    expect(data?.counterProposal).not.toBeNull();
    expect(data?.counterProposalCount).toBe(1);
  });

  it("당사자가 아니면 재제안할 수 없다", async () => {
    const escortId = await seedEscort({
      guideId: "cp-perm-guide",
      travelerId: "cp-perm-traveler",
      status: "Requested",
      requestExpiresAt: future(),
    });
    await expect(
      runCallable<ProposeCounterOfferOutput>(
        proposeCounterOffer,
        buildRequest("cp-stranger", {
          escortId,
          meetingTime: "2026-08-01T10:00:00.000Z",
          meetingLocation: {lat: 37.5665, lng: 126.978},
        })
      )
    ).rejects.toMatchObject({code: "permission-denied"});
  });

  it("Requested가 아니면 재제안할 수 없다", async () => {
    const escortId = await seedEscort({
      guideId: "cp-status-guide",
      travelerId: "cp-status-traveler",
      status: "MeetingConfirmed",
      requestExpiresAt: future(),
    });
    await expect(
      runCallable<ProposeCounterOfferOutput>(
        proposeCounterOffer,
        buildRequest("cp-status-guide", {
          escortId,
          meetingTime: "2026-08-01T10:00:00.000Z",
          meetingLocation: {lat: 37.5665, lng: 126.978},
        })
      )
    ).rejects.toMatchObject({code: "failed-precondition"});
  });

  it("재제안 횟수가 3회를 넘으면 거부된다", async () => {
    const escortId = await seedEscort({
      guideId: "cp-max-guide",
      travelerId: "cp-max-traveler",
      status: "Requested",
      requestExpiresAt: future(),
      counterProposalCount: 3,
    });
    await expect(
      runCallable<ProposeCounterOfferOutput>(
        proposeCounterOffer,
        buildRequest("cp-max-guide", {
          escortId,
          meetingTime: "2026-08-01T10:00:00.000Z",
          meetingLocation: {lat: 37.5665, lng: 126.978},
        })
      )
    ).rejects.toMatchObject({code: "failed-precondition"});
  });

  it("탐방자는 동네 지식으로 장소를 지정해 재제안할 수 없다", async () => {
    const escortId = await seedEscort({
      guideId: "cp-item-guide",
      travelerId: "cp-item-traveler",
      status: "Requested",
      requestExpiresAt: future(),
    });
    await expect(
      runCallable<ProposeCounterOfferOutput>(
        proposeCounterOffer,
        buildRequest("cp-item-traveler", {
          escortId,
          meetingTime: "2026-08-01T10:00:00.000Z",
          meetingArchiveItemId: "no-such-item",
        })
      )
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  it("상대방이 재제안을 수락하면 MeetingConfirmed로 전환된다", async () => {
    const escortId = await seedEscort({
      guideId: "co-guide",
      travelerId: "co-traveler",
      status: "Requested",
      requestExpiresAt: future(),
    });
    await runCallable<ProposeCounterOfferOutput>(
      proposeCounterOffer,
      buildRequest("co-guide", {
        escortId,
        meetingTime: "2026-08-01T10:00:00.000Z",
        meetingLocation: {lat: 37.5665, lng: 126.978},
      })
    );

    const result = await runCallable<AcceptCounterOfferOutput>(
      acceptCounterOffer,
      buildRequest("co-traveler", {escortId})
    );
    expect(result.status).toBe("MeetingConfirmed");

    const data = (await db.collection("escorts").doc(escortId).get()).data();
    expect(data?.status).toBe("MeetingConfirmed");
    expect(data?.counterProposal).toBeNull();
    expect(data?.meetingLocation).toBeInstanceOf(GeoPoint);
  });

  it("본인이 보낸 재제안은 스스로 수락할 수 없다", async () => {
    const escortId = await seedEscort({
      guideId: "co-self-guide",
      travelerId: "co-self-traveler",
      status: "Requested",
      requestExpiresAt: future(),
    });
    await runCallable<ProposeCounterOfferOutput>(
      proposeCounterOffer,
      buildRequest("co-self-guide", {
        escortId,
        meetingTime: "2026-08-01T10:00:00.000Z",
        meetingLocation: {lat: 37.5665, lng: 126.978},
      })
    );
    await expect(
      runCallable<AcceptCounterOfferOutput>(
        acceptCounterOffer,
        buildRequest("co-self-guide", {escortId})
      )
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  it("응답 대기 중인 재제안이 없으면 수락할 수 없다", async () => {
    const escortId = await seedEscort({
      guideId: "co-none-guide",
      travelerId: "co-none-traveler",
      status: "Requested",
      requestExpiresAt: future(),
    });
    await expect(
      runCallable<AcceptCounterOfferOutput>(
        acceptCounterOffer,
        buildRequest("co-none-traveler", {escortId})
      )
    ).rejects.toMatchObject({code: "failed-precondition"});
  });

  // ---- requestEscort with proposedMeetingTime ----

  it("탐방자가 요청 시 제안한 만남 시간이 저장된다", async () => {
    await seedGuide("re-time-guide");
    const result = await runCallable<RequestEscortOutput>(
      requestEscort,
      buildRequest("re-time-traveler", {
        guideId: "re-time-guide",
        proposedMeetingTime: "2026-08-01T10:00:00.000Z",
      })
    );
    const data = (await db.collection("escorts").doc(result.escortId).get())
      .data();
    expect(data?.proposedMeetingTime).not.toBeNull();
  });

  it("받은 요청 목록에 제안 시간이 포함된다", async () => {
    await seedGuide("re-time-guide2");
    const result = await runCallable<RequestEscortOutput>(
      requestEscort,
      buildRequest("re-time-traveler2", {
        guideId: "re-time-guide2",
        proposedMeetingTime: "2026-08-01T10:00:00.000Z",
      })
    );
    const list = await runCallable<ListReceivedEscortRequestsOutput>(
      listReceivedEscortRequests,
      buildRequest("re-time-guide2", {})
    );
    const item = list.requests.find((r) => r.escortId === result.escortId);
    expect(item?.proposedMeetingTime).toBe("2026-08-01T10:00:00.000Z");
  });

  // ---- acknowledgeEscortResponse ----

  it("확인 처리하면 travelerNotifiedAt이 기록된다", async () => {
    const escortId = await seedEscort({
      guideId: "ack-guide",
      travelerId: "ack-traveler",
      status: "Rejected",
      requestExpiresAt: future(),
    });
    await runCallable<AcknowledgeEscortResponseOutput>(
      acknowledgeEscortResponse,
      buildRequest("ack-traveler", {escortId})
    );
    const data = (await db.collection("escorts").doc(escortId).get()).data();
    expect(data?.travelerNotifiedAt).not.toBeNull();
  });

  it("당사자가 아니면 확인 처리할 수 없다", async () => {
    const escortId = await seedEscort({
      guideId: "ack-perm-guide",
      travelerId: "ack-perm-traveler",
      status: "Rejected",
      requestExpiresAt: future(),
    });
    await expect(
      runCallable<AcknowledgeEscortResponseOutput>(
        acknowledgeEscortResponse,
        buildRequest("ack-stranger", {escortId})
      )
    ).rejects.toMatchObject({code: "permission-denied"});
  });
});
