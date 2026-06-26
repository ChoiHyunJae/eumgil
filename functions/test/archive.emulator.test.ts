import * as admin from "firebase-admin";
import {GeoPoint, Timestamp} from "firebase-admin/firestore";
import type {CallableRequest} from "firebase-functions/v2/https";
import {
  createArchiveItem,
  deleteArchiveItem,
  listNearbyArchiveItems,
  reportArchiveItem,
  updateArchiveItem,
} from "../src/archive";
import type {
  CreateArchiveItemInput,
  CreateArchiveItemOutput,
  DeleteArchiveItemOutput,
  ListNearbyArchiveItemsOutput,
  ReportArchiveItemOutput,
  UpdateArchiveItemInput,
  UpdateArchiveItemOutput,
} from "../src/archive/types";
import type {ArchiveCategory} from "../src/types";

/**
 * Slice 3 (archive) — 동네 지식 등록/수정/삭제/신고/탐색 emulator 테스트.
 *
 * Callable은 (fn as unknown as {run}).run(request) 방식으로 직접 호출한다.
 * CONTEXT.md Invariant: 음성 없이 등록 불가, exactLocation은 작성자 외 비노출.
 */

/** seedArchiveItem 옵션. */
interface SeedOptions {
  lat: number;
  lng: number;
  authorId?: string;
  category?: ArchiveCategory;
  published?: boolean;
  hidden?: boolean;
}

const GUIDE_A = "archive-guide-a";
const GUIDE_B = "archive-guide-b";
const UNAPPROVED_GUIDE = "archive-guide-unapproved";
const EXPLORER = "archive-explorer";

/** 동네 지식 등록/수정/삭제/신고용 좌표(서울 목록 반경 밖). */
const BUSAN = {lat: 35.1796, lng: 129.0756};
/** listNearby 탐색 기준 좌표. */
const SEOUL = {lat: 37.5665, lng: 126.978};

describe("archive module", () => {
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
   * 테스트용 CallableRequest를 만든다. uid가 없으면 미인증 요청이 된다.
   * @param {string | undefined} uid 인증 사용자 uid (없으면 미인증).
   * @param {unknown} data 함수 입력 payload.
   * @return {CallableRequest<unknown>} 구성된 호출 요청.
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
   * @param {unknown} fn 호출할 callable function.
   * @param {CallableRequest<unknown>} request 호출 요청.
   * @return {Promise<O>} callable 실행 결과.
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
   * users/{uid} 문서를 직접 생성한다.
   * @param {string} uid 사용자 uid.
   * @param {boolean} guideApproved 안내자 승인 여부.
   * @return {Promise<void>} 쓰기 완료 Promise.
   */
  async function seedUser(
    uid: string,
    guideApproved: boolean
  ): Promise<void> {
    await db.collection("users").doc(uid).set({
      phoneNumber: "+821000000000",
      emergencyContact: {name: "보호자", phoneNumber: "+821011112222"},
      guideApproved,
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
   * archiveItems/{id} 문서를 직접 생성한다(목록 필터 테스트용).
   * @param {string} id 문서 id.
   * @param {SeedOptions} opts 좌표/카테고리/공개·숨김 옵션.
   * @return {Promise<void>} 쓰기 완료 Promise.
   */
  async function seedArchiveItem(
    id: string,
    opts: SeedOptions
  ): Promise<void> {
    await db.collection("archiveItems").doc(id).set({
      authorId: opts.authorId ?? "seed-author",
      category: opts.category ?? "PLACE",
      voiceTranscript: "시드 데이터",
      aiSummary: null,
      confirmedByAuthor: true,
      photoUrls: [],
      exactLocation: new GeoPoint(opts.lat, opts.lng),
      dongLabel: "행정동 확인 필요",
      visibilityRadiusM: 3000,
      published: opts.published ?? true,
      reportCount: 0,
      hidden: opts.hidden ?? false,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  }

  it(
    "승인된 안내자가 createArchiveItem 호출 시 archiveItems 문서가 생성된다",
    async () => {
      await seedUser(GUIDE_A, true);
      const input: CreateArchiveItemInput = {
        category: "PLACE",
        voiceTranscript: "  좋은 산책로 정보  ",
        location: BUSAN,
      };

      const result = await runCallable<CreateArchiveItemOutput>(
        createArchiveItem,
        buildRequest(GUIDE_A, input)
      );

      const itemId = result.item.id;
      expect(itemId).toBeTruthy();
      // voiceTranscript trim 확인
      expect(result.item.voiceTranscript).toBe("좋은 산책로 정보");
      // owner view에는 exactLocation이 포함된다
      expect(result.item.exactLocation.latitude).toBeCloseTo(BUSAN.lat);

      const doc = await db.collection("archiveItems").doc(itemId).get();
      expect(doc.exists).toBe(true);
      const data = doc.data();
      expect(data?.authorId).toBe(GUIDE_A);
      expect(data?.category).toBe("PLACE");
      expect(data?.voiceTranscript).toBe("좋은 산책로 정보");
      expect(data?.aiSummary).toBeNull();
      expect(data?.confirmedByAuthor).toBe(true);
      expect(data?.published).toBe(true);
      expect(data?.reportCount).toBe(0);
      expect(data?.hidden).toBe(false);
      expect(data?.visibilityRadiusM).toBe(3000);
      expect(data?.dongLabel).toBe("행정동 확인 필요");
      expect(data?.exactLocation.latitude).toBeCloseTo(BUSAN.lat);
      expect(data?.exactLocation.longitude).toBeCloseTo(BUSAN.lng);
    }
  );

  it("미승인 안내자가 createArchiveItem 호출 시 거부된다", async () => {
    await seedUser(UNAPPROVED_GUIDE, false);
    const input: CreateArchiveItemInput = {
      category: "WALK",
      voiceTranscript: "산책로 설명",
      location: BUSAN,
    };

    await expect(
      runCallable<CreateArchiveItemOutput>(
        createArchiveItem,
        buildRequest(UNAPPROVED_GUIDE, input)
      )
    ).rejects.toThrow();
  });

  it("인증되지 않은 createArchiveItem 호출은 거부된다", async () => {
    const input: CreateArchiveItemInput = {
      category: "OTHER",
      voiceTranscript: "설명",
      location: BUSAN,
    };

    await expect(
      runCallable<CreateArchiveItemOutput>(
        createArchiveItem,
        buildRequest(undefined, input)
      )
    ).rejects.toThrow();
  });

  it("updateArchiveItem은 작성자 본인만 수정할 수 있다", async () => {
    await seedUser(GUIDE_A, true);
    await seedUser(GUIDE_B, true);
    const itemId = "update-target-item";
    await seedArchiveItem(itemId, {
      authorId: GUIDE_A,
      lat: BUSAN.lat,
      lng: BUSAN.lng,
      category: "PLACE",
    });

    // 본인 수정 성공
    const ownInput: UpdateArchiveItemInput = {
      itemId,
      category: "WALK",
      voiceTranscript: "수정된 설명",
    };
    const result = await runCallable<UpdateArchiveItemOutput>(
      updateArchiveItem,
      buildRequest(GUIDE_A, ownInput)
    );
    expect(result.item.category).toBe("WALK");
    expect(result.item.voiceTranscript).toBe("수정된 설명");

    const doc = await db.collection("archiveItems").doc(itemId).get();
    expect(doc.data()?.category).toBe("WALK");
    expect(doc.data()?.voiceTranscript).toBe("수정된 설명");

    // 다른 사용자 수정 시 reject
    const otherInput: UpdateArchiveItemInput = {itemId, category: "OTHER"};
    await expect(
      runCallable<UpdateArchiveItemOutput>(
        updateArchiveItem,
        buildRequest(GUIDE_B, otherInput)
      )
    ).rejects.toThrow();
  });

  it("deleteArchiveItem은 작성자 본인만 삭제할 수 있다", async () => {
    await seedUser(GUIDE_A, true);
    await seedUser(GUIDE_B, true);
    const itemId = "delete-target-item";
    await seedArchiveItem(itemId, {
      authorId: GUIDE_A,
      lat: BUSAN.lat,
      lng: BUSAN.lng,
    });

    // 다른 사용자 삭제 시 reject
    await expect(
      runCallable<DeleteArchiveItemOutput>(
        deleteArchiveItem,
        buildRequest(GUIDE_B, {itemId})
      )
    ).rejects.toThrow();

    // 본인 삭제 성공
    const result = await runCallable<DeleteArchiveItemOutput>(
      deleteArchiveItem,
      buildRequest(GUIDE_A, {itemId})
    );
    expect(result.deleted).toBe(true);

    const doc = await db.collection("archiveItems").doc(itemId).get();
    expect(doc.exists).toBe(false);
  });

  it("reportArchiveItem 호출 시 reportCount가 1 증가한다", async () => {
    await seedUser(GUIDE_A, true);
    const itemId = "report-target-item";
    await seedArchiveItem(itemId, {
      authorId: GUIDE_A,
      lat: BUSAN.lat,
      lng: BUSAN.lng,
    });

    const result = await runCallable<ReportArchiveItemOutput>(
      reportArchiveItem,
      buildRequest(EXPLORER, {itemId})
    );
    expect(result.reportCount).toBe(1);

    const doc = await db.collection("archiveItems").doc(itemId).get();
    expect(doc.data()?.reportCount).toBe(1);

    // 다시 신고하면 2가 된다
    const result2 = await runCallable<ReportArchiveItemOutput>(
      reportArchiveItem,
      buildRequest(EXPLORER, {itemId})
    );
    expect(result2.reportCount).toBe(2);
  });

  it(
    "listNearbyArchiveItems는 published=true, hidden=false, " +
      "3km 이내 문서만 반환하고 exactLocation을 숨긴다",
    async () => {
      await seedArchiveItem("near-place", {lat: 37.5665, lng: 126.978});
      await seedArchiveItem("near-walk", {
        lat: 37.567,
        lng: 126.9785,
        category: "WALK",
      });
      await seedArchiveItem("far-place", {lat: 37.7, lng: 126.978});
      await seedArchiveItem("hidden-place", {
        lat: 37.5665,
        lng: 126.978,
        hidden: true,
      });
      await seedArchiveItem("unpublished-place", {
        lat: 37.5665,
        lng: 126.978,
        published: false,
      });

      // 카테고리 필터 없음
      const all = await runCallable<ListNearbyArchiveItemsOutput>(
        listNearbyArchiveItems,
        buildRequest(EXPLORER, {location: SEOUL})
      );
      const allIds = all.items.map((item) => item.id);
      expect(allIds).toContain("near-place");
      expect(allIds).toContain("near-walk");
      // 3km 초과 / hidden / 미게시 제외
      expect(allIds).not.toContain("far-place");
      expect(allIds).not.toContain("hidden-place");
      expect(allIds).not.toContain("unpublished-place");

      // 응답 item에는 exactLocation key가 없어야 한다(행정동 표시값만 노출)
      for (const item of all.items) {
        expect(item).not.toHaveProperty("exactLocation");
      }
      const nearPlace = all.items.find((item) => item.id === "near-place");
      expect(nearPlace?.dongLabel).toBe("행정동 확인 필요");

      // 카테고리 필터: PLACE만
      const placeOnly = await runCallable<ListNearbyArchiveItemsOutput>(
        listNearbyArchiveItems,
        buildRequest(EXPLORER, {location: SEOUL, category: "PLACE"})
      );
      const placeIds = placeOnly.items.map((item) => item.id);
      expect(placeIds).toContain("near-place");
      expect(placeIds).not.toContain("near-walk");
    }
  );

  it("exactLocation 없는 문서는 에러 없이 무시된다", async () => {
    // exactLocation 없이 published=true, hidden=false인 불완전 문서를 직접 시드한다.
    await db.collection("archiveItems").doc("no-exactlocation").set({
      authorId: "seed-author",
      category: "PLACE",
      voiceTranscript: "좌표 없는 문서",
      aiSummary: null,
      confirmedByAuthor: true,
      photoUrls: [],
      dongLabel: "행정동 확인 필요",
      visibilityRadiusM: 3000,
      published: true,
      reportCount: 0,
      hidden: false,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    await seedArchiveItem("valid-near-place", {lat: 37.5665, lng: 126.978});

    const result = await runCallable<ListNearbyArchiveItemsOutput>(
      listNearbyArchiveItems,
      buildRequest(EXPLORER, {location: SEOUL})
    );

    const ids = result.items.map((item) => item.id);
    expect(ids).not.toContain("no-exactlocation"); // 무효 문서는 제외
    expect(ids).toContain("valid-near-place"); // 정상 문서는 그대로 반환
  });
});
