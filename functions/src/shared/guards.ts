import {HttpsError, type CallableRequest} from "firebase-functions/v2/https";
import {UserProfile} from "../types";

/**
 * 비상연락처 등록 여부를 검증한다.
 *
 * 실제 동행 시작 가능 여부 판단은 해당 동행 슬라이스에서 수행한다.
 *
 * @param {UserProfile} user 검증할 사용자 문서.
 */
export function assertEmergencyContactRegistered(user: UserProfile): void {
  if (!user.emergencyContact) {
    throw new Error("emergency contact is not registered");
  }
}

/**
 * 안내자 승인 가드. CONTEXT.md Invariant: 미승인 안내자는 동네 지식 등록·수정·삭제 불가.
 *
 * @param {UserProfile} user 검증할 사용자 문서.
 */
export function assertGuideApproved(user: UserProfile): void {
  if (!user.guideApproved) {
    throw new HttpsError("permission-denied", "안내자 승인이 필요합니다.");
  }
}

/**
 * 운영자 권한 가드. 운영자 전용 callable(admin 모듈)에서 호출한다.
 * CONTEXT.md: 운영자만 안내자 승인/거부·동네 지식 숨김을 수행할 수 있다.
 * UserProfile 필드가 아니라 custom claim `admin === true`로 판정한다.
 *
 * @param {CallableRequest} auth 호출자 인증 정보(request.auth, 없으면 미인증).
 */
export function assertOperator(auth: CallableRequest["auth"]): void {
  if (!auth) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  if (auth.token.admin !== true) {
    throw new HttpsError("permission-denied", "운영자 권한이 필요합니다.");
  }
}
