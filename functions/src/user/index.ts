import {onCall} from "firebase-functions/v2/https";
import {
  RegisterUserInput,
  RegisterUserOutput,
  UpdateEmergencyContactInput,
  UpdateEmergencyContactOutput,
} from "./types";

/**
 * user 모듈 — 사용자 등록(전화번호 인증 + 비상연락처 온보딩), 비상연락처 변경.
 * 계약 정의만 포함(Slice 0, Issue #2). 구현은 후속 슬라이스에서 채운다.
 */

/**
 * US#52~53,#56~57: 전화번호 인증 로그인 후 최초 등록.
 * Invariant: 비상연락처는 건너뛰기 불가, 등록되지 않으면 이후 동행 시작 불가.
 */
export const registerUser = onCall<
  RegisterUserInput, Promise<RegisterUserOutput>
>(
  async () => {
    throw new Error("not implemented");
  }
);

/** US#54: 비상연락처 변경. */
export const updateEmergencyContact = onCall<
  UpdateEmergencyContactInput,
  Promise<UpdateEmergencyContactOutput>
>(async () => {
  throw new Error("not implemented");
});
