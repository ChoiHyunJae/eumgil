import {EmergencyContact} from "../types";

/**
 * user 모듈 callable function 계약.
 * PRD (Issue #1) User Stories #52~57, Implementation Decisions > 인증/역할 모델.
 */

/**
 * US#52~53,#56~57: 전화번호 인증 후 온보딩에서 비상연락처 필수 등록(건너뛰기 불가).
 * Invariant: 세대 구분 없이 단일 사용자 모델, 별도 모드 전환 없음.
 * phoneNumber는 입력값이 아니라 request.auth.token.phone_number(전화번호 인증 토큰)에서
 * 가져온다 — 클라이언트가 임의의 전화번호를 주입할 수 없도록.
 */
export interface RegisterUserInput {
  emergencyContact: EmergencyContact;
}
export interface RegisterUserOutput {
  userId: string;
}

/** US#54: 마이페이지에서 비상연락처 변경. */
export interface UpdateEmergencyContactInput {
  emergencyContact: EmergencyContact;
}
export interface UpdateEmergencyContactOutput {
  emergencyContact: EmergencyContact;
}
