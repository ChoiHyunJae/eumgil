import {Timestamp} from "firebase-admin/firestore";
import {assertEmergencyContactRegistered} from "../src/shared/guards";
import {UserProfile} from "../src/types";

/**
 * Slice 1(Issue #3) — assertEmergencyContactRegistered 단위 테스트.
 * 후속 동행 슬라이스가 재사용할 가드이므로 Firestore 에뮬레이터 없이 순수 함수로 검증한다.
 */
describe("assertEmergencyContactRegistered", () => {
  const baseUser: UserProfile = {
    id: "user-1",
    phoneNumber: "+821000000000",
    emergencyContact: null,
    guideApproved: false,
    matchBlockedUntil: null,
    noShowCount: 0,
    guideStats: {
      averageSatisfaction: null,
      totalRequestsReceived: 0,
      completedEscortCount: 0,
    },
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };

  it("비상연락처가 없으면 throw한다", () => {
    expect(() => assertEmergencyContactRegistered(baseUser)).toThrow();
  });

  it("비상연락처가 있으면 통과한다", () => {
    const user: UserProfile = {
      ...baseUser,
      emergencyContact: {name: "보호자", phoneNumber: "+821011112222"},
    };
    expect(() => assertEmergencyContactRegistered(user)).not.toThrow();
  });
});
