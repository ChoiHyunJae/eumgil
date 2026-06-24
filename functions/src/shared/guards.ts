import {HttpsError} from "firebase-functions/v2/https";
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

