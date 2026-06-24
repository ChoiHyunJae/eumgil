import * as admin from "firebase-admin";
import type {CallableRequest} from "firebase-functions/v2/https";
import {registerUser, updateEmergencyContact} from "../src/user";
import type {
  RegisterUserInput,
  RegisterUserOutput,
  UpdateEmergencyContactInput,
  UpdateEmergencyContactOutput,
} from "../src/user/types";

/**
 * Slice 1 (Issue #3) — 사용자 가입 & 비상연락처 온보딩.
 * PRD(Issue #1) US#52~55, CONTEXT.md Invariant: 비상연락처 없으면 동행 불가.
 */
describe("user module", () => {
  let app: admin.app.App;
  let db: admin.firestore.Firestore;

  beforeAll(() => {
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
      throw new Error(
        "FIRESTORE_EMULATOR_HOST가 설정되어 있지 않습니다. " +
          "`npm test`(firebase emulators:exec)로 실행하세요."
      );
    }
    // registerUser/updateEmergencyContact는 내부적으로 admin.firestore()
    // (default app)를 참조하므로, 여기서 default app을 초기화한다.
    app = admin.initializeApp({projectId: "eumgil-test-harness"});
    db = admin.firestore(app);
  });

  afterAll(async () => {
    db.terminate();
    await app.delete();
  });

  function buildRequest(
    uid: string,
    phoneNumber: string | undefined,
    data: RegisterUserInput | UpdateEmergencyContactInput
  ): CallableRequest<RegisterUserInput | UpdateEmergencyContactInput> {
    return {
      data,
      auth: phoneNumber === undefined ?
        undefined :
        {
          uid,
          token: {phone_number: phoneNumber} as unknown,
          rawToken: "dummy",
        } as CallableRequest["auth"],
      rawRequest: {} as CallableRequest["rawRequest"],
      acceptsStreaming: false,
    } as CallableRequest<RegisterUserInput | UpdateEmergencyContactInput>;
  }

  function runRegister(request: CallableRequest<RegisterUserInput>) {
    return (registerUser as unknown as {
      run: (
        req: CallableRequest<RegisterUserInput>
      ) => Promise<RegisterUserOutput>;
    }).run(request);
  }

  function runUpdate(request: CallableRequest<UpdateEmergencyContactInput>) {
    return (updateEmergencyContact as unknown as {
      run: (
        req: CallableRequest<UpdateEmergencyContactInput>
      ) => Promise<UpdateEmergencyContactOutput>;
    }).run(request);
  }

  it(
    "신규 사용자가 비상연락처와 함께 등록하면 " +
      "guideApproved=false, matchBlockedUntil=null로 생성된다",
    async () => {
      const uid = "uid-register-1";
      const request = buildRequest(uid, "+821011110001", {
        emergencyContact: {name: "보호자A", phoneNumber: "+821022220001"},
      });

      const result = await runRegister(
        request as CallableRequest<RegisterUserInput>
      );
      expect(result.userId).toBe(uid);

      const doc = await db.collection("users").doc(uid).get();
      expect(doc.exists).toBe(true);
      const data = doc.data();
      expect(data?.phoneNumber).toBe("+821011110001");
      expect(data?.guideApproved).toBe(false);
      expect(data?.matchBlockedUntil).toBeNull();
      expect(data?.emergencyContact).toEqual({
        name: "보호자A",
        phoneNumber: "+821022220001",
      });
    }
  );

  it("같은 uid로 재호출되면 기존 문서를 덮어쓰지 않고 그대로 반환한다", async () => {
    const uid = "uid-register-2";
    const firstRequest = buildRequest(uid, "+821011110002", {
      emergencyContact: {name: "원래보호자", phoneNumber: "+821022220002"},
    });
    await runRegister(firstRequest as CallableRequest<RegisterUserInput>);

    const secondRequest = buildRequest(uid, "+821011110002", {
      emergencyContact: {name: "다른보호자", phoneNumber: "+821099990002"},
    });
    const result = await runRegister(
      secondRequest as CallableRequest<RegisterUserInput>
    );
    expect(result.userId).toBe(uid);

    const doc = await db.collection("users").doc(uid).get();
    expect(doc.data()?.emergencyContact).toEqual({
      name: "원래보호자",
      phoneNumber: "+821022220002",
    });
  });

  it("비상연락처 없이 등록을 시도하면 거부된다", async () => {
    const uid = "uid-register-3";
    const request = buildRequest(
      uid,
      "+821011110003",
      {} as RegisterUserInput
    );

    await expect(
      runRegister(request as CallableRequest<RegisterUserInput>)
    ).rejects.toThrow();
  });

  it("인증되지 않은 호출은 거부된다", async () => {
    const request = buildRequest("uid-register-4", undefined, {
      emergencyContact: {name: "보호자", phoneNumber: "+821022220004"},
    });

    await expect(
      runRegister(request as CallableRequest<RegisterUserInput>)
    ).rejects.toThrow();
  });

  it("마이페이지에서 비상연락처를 변경하면 Firestore에 반영된다", async () => {
    const uid = "uid-update-1";
    const registerRequest = buildRequest(uid, "+821011110005", {
      emergencyContact: {name: "최초보호자", phoneNumber: "+821022220005"},
    });
    await runRegister(registerRequest as CallableRequest<RegisterUserInput>);

    const updateRequest = buildRequest(uid, "+821011110005", {
      emergencyContact: {name: "변경된보호자", phoneNumber: "+821033330005"},
    });
    const result = await runUpdate(
      updateRequest as CallableRequest<UpdateEmergencyContactInput>
    );
    expect(result.emergencyContact).toEqual({
      name: "변경된보호자",
      phoneNumber: "+821033330005",
    });

    const doc = await db.collection("users").doc(uid).get();
    expect(doc.data()?.emergencyContact).toEqual({
      name: "변경된보호자",
      phoneNumber: "+821033330005",
    });
  });

  it("존재하지 않는 사용자의 비상연락처 변경은 거부된다", async () => {
    const request = buildRequest("uid-does-not-exist", "+821011110006", {
      emergencyContact: {name: "보호자", phoneNumber: "+821022220006"},
    });

    await expect(
      runUpdate(request as CallableRequest<UpdateEmergencyContactInput>)
    ).rejects.toThrow();
  });
});
