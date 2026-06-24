import {UserProfile} from "../types";

/**
 * 모듈 간 공용 가드. CONTEXT.md Invariant: 비상연락처가 등록되지 않은 사용자는
 * 동행을 시작할 수 없다. escort/matching 모듈이 동행 생성 시점에 호출해 재사용한다.
 *
 * Slice 1(Issue #3)에서는 가드만 준비하고, 실제 동행 생성 경로 연결은
 * 해당 동행 슬라이스에서 수행한다.
 */
/** @param {UserProfile} user 검증할 사용자 문서. */
export function assertEmergencyContactRegistered(user: UserProfile): void {
  if (!user.emergencyContact) {
    throw new Error("emergency contact is not registered");
  }
}
