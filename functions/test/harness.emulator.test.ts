import * as admin from "firebase-admin";
import type {CallableRequest} from "firebase-functions/v2/https";
import {midTerminate} from "../src/escort";
import type {
  MidTerminateInput,
  MidTerminateOutput,
} from "../src/escort/types";

/**
 * Slice 0 (Issue #2) 테스트 하니스 검증용 테스트.
 *
 * 목적: 기능 모듈이 아직 구현되지 않은 상태에서도
 * (1) Firestore 에뮬레이터에 실제로 쓰고 읽을 수 있고,
 * (2) callable function(v2 onCall)을 .run()으로 직접 호출할 수 있다는
 * 두 가지 하니스 전제를 증명한다. 외부 API(Google Maps/STT, 카카오 알림톡 등) 호출은 없다.
 *
 * 실행: `npm test` → `firebase emulators:exec --only firestore`가
 * FIRESTORE_EMULATOR_HOST / GCLOUD_PROJECT를 주입한 뒤 jest를 구동한다.
 */
describe("Slice 0 test harness", () => {
  let app: admin.app.App;

  beforeAll(() => {
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
      throw new Error(
        "FIRESTORE_EMULATOR_HOST가 설정되어 있지 않습니다. " +
          "`npm test`(firebase emulators:exec)로 실행하세요."
      );
    }
    app = admin.initializeApp({projectId: "eumgil-test-harness"});
  });

  afterAll(async () => {
    admin.firestore(app).terminate();
    await app.delete();
  });

  it("Firestore 에뮬레이터에 문서를 쓰고 읽을 수 있다", async () => {
    const db = admin.firestore(app);
    const ref = db.collection("_harnessCheck").doc("ping");

    await ref.set({pong: true, writtenAt: Date.now()});
    const snapshot = await ref.get();

    expect(snapshot.exists).toBe(true);
    expect(snapshot.data()?.pong).toBe(true);
  });

  it("escort 모듈의 callable을 .run()으로 직접 호출할 수 있다", async () => {
    // Slice 7 완료로 escort callable에 더 이상 stub이 없으므로, 하니스 전제(.run
    // 직접 호출 가능)는 미인증 호출이 unauthenticated로 거부되는 것으로 확인한다.
    const request = {
      data: {escortId: "dummy"},
      rawRequest: {} as CallableRequest<MidTerminateInput>["rawRequest"],
    } as CallableRequest<MidTerminateInput>;

    await expect(
      (midTerminate as unknown as {
        run: (
          req: CallableRequest<MidTerminateInput>
        ) => Promise<MidTerminateOutput>;
      }).run(request)
    ).rejects.toThrow("로그인이 필요합니다.");
  });
});
