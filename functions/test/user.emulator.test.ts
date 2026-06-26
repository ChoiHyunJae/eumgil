import * as admin from "firebase-admin";
import {Timestamp} from "firebase-admin/firestore";
import type {CallableRequest} from "firebase-functions/v2/https";
import {
  applyForGuide,
  getMyGuideApplicationStatus,
  registerUser,
  updateEmergencyContact,
} from "../src/user";
import type {
  ApplyForGuideInput,
  ApplyForGuideOutput,
  GetMyGuideApplicationStatusInput,
  GetMyGuideApplicationStatusOutput,
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

  /**
   * 테스트 CallableRequest를 만든다. phoneNumber가 undefined면 미인증 요청.
   * @param {string} uid 호출자 uid.
   * @param {string | undefined} phoneNumber 전화번호 인증 토큰(없으면 미인증).
   * @param {RegisterUserInput | UpdateEmergencyContactInput} data 입력 페이로드.
   * @return {CallableRequest<RegisterUserInput | UpdateEmergencyContactInput>}
   *   구성된 요청.
   */
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

  /**
   * registerUser v2 onCall 함수를 .run()으로 직접 호출한다.
   * @param {CallableRequest<RegisterUserInput>} request 전달할 요청.
   * @return {Promise<RegisterUserOutput>} 호출 결과.
   */
  function runRegister(request: CallableRequest<RegisterUserInput>) {
    return (registerUser as unknown as {
      run: (
        req: CallableRequest<RegisterUserInput>
      ) => Promise<RegisterUserOutput>;
    }).run(request);
  }

  /**
   * updateEmergencyContact v2 onCall 함수를 .run()으로 직접 호출한다.
   * @param {CallableRequest<UpdateEmergencyContactInput>} request 전달할 요청.
   * @return {Promise<UpdateEmergencyContactOutput>} 호출 결과.
   */
  function runUpdate(request: CallableRequest<UpdateEmergencyContactInput>) {
    return (updateEmergencyContact as unknown as {
      run: (
        req: CallableRequest<UpdateEmergencyContactInput>
      ) => Promise<UpdateEmergencyContactOutput>;
    }).run(request);
  }

  /**
   * applyForGuide 호출용 요청을 만든다. uid가 undefined면 미인증 요청.
   * applyForGuide는 phone_number 토큰을 요구하지 않고 auth.uid만 사용한다.
   * @param {string | undefined} uid 호출자 uid(미인증이면 undefined).
   * @return {CallableRequest<ApplyForGuideInput>} 구성된 요청.
   */
  function buildApplyRequest(
    uid: string | undefined
  ): CallableRequest<ApplyForGuideInput> {
    return {
      data: {},
      auth: uid === undefined ?
        undefined :
        {
          uid,
          token: {} as unknown,
          rawToken: "dummy",
        } as CallableRequest["auth"],
      rawRequest: {} as CallableRequest["rawRequest"],
      acceptsStreaming: false,
    } as CallableRequest<ApplyForGuideInput>;
  }

  /**
   * applyForGuide v2 onCall 함수를 .run()으로 직접 호출한다.
   * @param {CallableRequest<ApplyForGuideInput>} request 전달할 요청.
   * @return {Promise<ApplyForGuideOutput>} 호출 결과.
   */
  function runApply(request: CallableRequest<ApplyForGuideInput>) {
    return (applyForGuide as unknown as {
      run: (
        req: CallableRequest<ApplyForGuideInput>
      ) => Promise<ApplyForGuideOutput>;
    }).run(request);
  }

  /**
   * users/{uid} 문서를 생성한다(applyForGuide 사전 조건용).
   * @param {string} uid 사용자 uid.
   * @param {boolean} guideApproved 안내자 승인 여부.
   * @return {Promise<void>} 쓰기 완료 시 resolve.
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
   * getMyGuideApplicationStatus 호출용 요청을 만든다. uid가 undefined면 미인증.
   * @param {string | undefined} uid 호출자 uid(미인증이면 undefined).
   * @return {CallableRequest<GetMyGuideApplicationStatusInput>} 구성된 요청.
   */
  function buildStatusRequest(
    uid: string | undefined
  ): CallableRequest<GetMyGuideApplicationStatusInput> {
    return {
      data: {},
      auth: uid === undefined ?
        undefined :
        {
          uid,
          token: {} as unknown,
          rawToken: "dummy",
        } as CallableRequest["auth"],
      rawRequest: {} as CallableRequest["rawRequest"],
      acceptsStreaming: false,
    } as CallableRequest<GetMyGuideApplicationStatusInput>;
  }

  /**
   * getMyGuideApplicationStatus v2 onCall 함수를 .run()으로 직접 호출한다.
   * @param {CallableRequest<GetMyGuideApplicationStatusInput>} request 전달할 요청.
   * @return {Promise<GetMyGuideApplicationStatusOutput>} 호출 결과.
   */
  function runStatus(
    request: CallableRequest<GetMyGuideApplicationStatusInput>
  ) {
    return (getMyGuideApplicationStatus as unknown as {
      run: (
        req: CallableRequest<GetMyGuideApplicationStatusInput>
      ) => Promise<GetMyGuideApplicationStatusOutput>;
    }).run(request);
  }

  /**
   * guideApplications/{auto} 문서를 지정 상태/시각으로 생성한다.
   * @param {string} userId 신청자 uid.
   * @param {"pending" | "approved" | "rejected"} status 신청 상태.
   * @param {Timestamp} updatedAt 최신 판단 기준이 되는 updatedAt.
   * @return {Promise<string>} 생성된 신청 문서 id.
   */
  async function seedApplication(
    userId: string,
    status: "pending" | "approved" | "rejected",
    updatedAt: Timestamp
  ): Promise<string> {
    const ref = db.collection("guideApplications").doc();
    await ref.set({
      userId,
      status,
      appliedAt: Timestamp.now(),
      reviewedAt: status === "pending" ? null : updatedAt,
      reviewedBy: status === "pending" ? null : "op-reviewer",
      createdAt: Timestamp.now(),
      updatedAt,
    });
    return ref.id;
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

  it("미승인 사용자가 신청하면 pending 신청 문서가 생성된다", async () => {
    const uid = "uid-apply-1";
    await seedUser(uid, false);

    const result = await runApply(buildApplyRequest(uid));
    expect(result.status).toBe("pending");
    expect(typeof result.applicationId).toBe("string");

    const doc = await db
      .collection("guideApplications")
      .doc(result.applicationId)
      .get();
    expect(doc.exists).toBe(true);
    const data = doc.data();
    expect(data?.userId).toBe(uid);
    expect(data?.status).toBe("pending");
    expect(data?.reviewedAt).toBeNull();
    expect(data?.reviewedBy).toBeNull();
  });

  it("인증되지 않은 안내자 신청은 거부된다", async () => {
    await expect(runApply(buildApplyRequest(undefined))).rejects.toThrow();
  });

  it("사용자 문서가 없으면 안내자 신청은 거부된다", async () => {
    await expect(
      runApply(buildApplyRequest("uid-apply-missing"))
    ).rejects.toThrow();
  });

  it("이미 승인된 안내자는 신청할 수 없다", async () => {
    const uid = "uid-apply-approved";
    await seedUser(uid, true);

    await expect(
      runApply(buildApplyRequest(uid))
    ).rejects.toMatchObject({code: "failed-precondition"});

    const snap = await db
      .collection("guideApplications")
      .where("userId", "==", uid)
      .get();
    expect(snap.empty).toBe(true);
  });

  it("이미 pending 신청이 있으면 중복 신청할 수 없다", async () => {
    const uid = "uid-apply-dup";
    await seedUser(uid, false);

    await runApply(buildApplyRequest(uid));

    await expect(
      runApply(buildApplyRequest(uid))
    ).rejects.toMatchObject({code: "already-exists"});

    const snap = await db
      .collection("guideApplications")
      .where("userId", "==", uid)
      .get();
    expect(snap.size).toBe(1);
  });

  it("인증되지 않은 신청 상태 조회는 거부된다", async () => {
    await expect(runStatus(buildStatusRequest(undefined))).rejects.toThrow();
  });

  it("사용자 문서가 없으면 신청 상태 조회는 거부된다", async () => {
    await expect(
      runStatus(buildStatusRequest("uid-status-missing"))
    ).rejects.toMatchObject({code: "not-found"});
  });

  it("guideApproved=true이면 status approved를 반환한다", async () => {
    const uid = "uid-status-approved";
    await seedUser(uid, true);

    const result = await runStatus(buildStatusRequest(uid));
    expect(result.status).toBe("approved");
  });

  it("미승인 + pending 신청이 있으면 status pending과 id를 반환한다", async () => {
    const uid = "uid-status-pending";
    await seedUser(uid, false);
    const appId = await seedApplication(uid, "pending", Timestamp.now());

    const result = await runStatus(buildStatusRequest(uid));
    expect(result.status).toBe("pending");
    expect(result.applicationId).toBe(appId);
  });

  it("미승인 + pending이 없고 rejected가 있으면 status rejected", async () => {
    const uid = "uid-status-rejected";
    await seedUser(uid, false);
    const appId = await seedApplication(uid, "rejected", Timestamp.now());

    const result = await runStatus(buildStatusRequest(uid));
    expect(result.status).toBe("rejected");
    expect(result.applicationId).toBe(appId);
  });

  it("미승인 + 신청 이력이 없으면 status none을 반환한다", async () => {
    const uid = "uid-status-none";
    await seedUser(uid, false);

    const result = await runStatus(buildStatusRequest(uid));
    expect(result.status).toBe("none");
    expect(result.applicationId).toBeUndefined();
  });

  it("미승인 + approved 신청 이력만 있으면 status approved와 id", async () => {
    const uid = "uid-status-approved-history";
    await seedUser(uid, false);
    const appId = await seedApplication(uid, "approved", Timestamp.now());

    const result = await runStatus(buildStatusRequest(uid));
    expect(result.status).toBe("approved");
    expect(result.applicationId).toBe(appId);
  });

  it("rejected가 여러 건이면 updatedAt 최신 건의 id를 반환한다", async () => {
    const uid = "uid-status-rejected-multi";
    await seedUser(uid, false);
    const older = Timestamp.fromMillis(Date.now() - 86_400_000);
    const newer = Timestamp.fromMillis(Date.now());
    await seedApplication(uid, "rejected", older);
    const latestId = await seedApplication(uid, "rejected", newer);

    const result = await runStatus(buildStatusRequest(uid));
    expect(result.status).toBe("rejected");
    expect(result.applicationId).toBe(latestId);
  });

  it("미승인 + pending과 rejected가 모두 있으면 pending이 우선한다", async () => {
    const uid = "uid-status-pending-over-rejected";
    await seedUser(uid, false);
    await seedApplication(uid, "rejected", Timestamp.now());
    const pendingId = await seedApplication(uid, "pending", Timestamp.now());

    const result = await runStatus(buildStatusRequest(uid));
    expect(result.status).toBe("pending");
    expect(result.applicationId).toBe(pendingId);
  });
});
