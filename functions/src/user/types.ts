import {EmergencyContact, GuideApplicationStatus} from "../types";

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

/**
 * US#16,#60 / Slice 2: 사용자가 본인 계정으로 안내자 신청을 제출한다.
 * 신청 대상은 입력값이 아니라 request.auth.uid에서 가져온다 — 타인 계정으로
 * 신청할 수 없도록(본인 신청만 허용). 별도 입력 필드는 없다.
 */
export type ApplyForGuideInput = Record<string, never>;
export interface ApplyForGuideOutput {
  applicationId: string;
  status: GuideApplicationStatus;
}

/**
 * US#16,#60 / Slice 2: 사용자가 본인의 안내자 신청 상태를 조회한다.
 * Flutter UI가 신청 버튼 상태("신청하기"/"검토 중"/"승인됨"/"재신청")를 분기하는 데 쓴다.
 * 조회 대상은 입력값이 아니라 request.auth.uid에서 가져온다 — 타인의 신청 상태를
 * 조회하는 경로는 만들지 않는다(본인 조회만 허용).
 *
 * GuideApplicationStatus(문서 status: pending|approved|rejected)와 달리, 신청 이력이
 * 전혀 없는 "none"을 추가로 구분한다 — UI의 최초 신청 가능 상태 표현용.
 */
export type GuideApplicationViewStatus =
  | "none"
  | "pending"
  | "approved"
  | "rejected";

export type GetMyGuideApplicationStatusInput = Record<string, never>;
export interface GetMyGuideApplicationStatusOutput {
  status: GuideApplicationViewStatus;
  /**
   * 상태를 결정한 신청 문서 id. 신청 이력으로 status가 정해진 경우
   * (pending/rejected, 또는 미승인 상태에서 approved 이력으로 판단된 경우) 포함.
   * 신청 이력 없이 판단된 경우(none, 또는 guideApproved 플래그만으로 approved)는 생략.
   */
  applicationId?: string;
}
