import {Timestamp} from "firebase-admin/firestore";

/**
 * Firestore `users` collection.
 *
 * PRD (Issue #1) Implementation Decisions > 데이터 스키마 방향 > 사용자,
 * User Stories #52~60. CONTEXT.md Invariants: 비상연락처 없으면 동행 불가,
 * 안내자 미승인이면 안내자 활동 불가, 매칭 제한 기간 중 신규 요청 생성/수락 불가.
 */
export interface UserProfile {
  /** Firestore doc id === Firebase Auth uid. */
  id: string;
  /** US#52: 전화번호 인증만으로 로그인. */
  phoneNumber: string;
  /**
   * US#53~55: 온보딩 필수 등록(건너뛰기 불가), 마이페이지에서 변경 가능.
   * Invariant: null이면 동행을 시작할 수 없음.
   */
  emergencyContact: EmergencyContact | null;
  /**
   * US#60: 안내자 승인 여부(운영자가 설정). matchBlockedUntil과 독립된 별도 필드로 관리.
   * Invariant: false면 안내자로서 동행 요청 수신/동네 지식 등록 불가(탐방자 활동은 무관).
   */
  guideApproved: boolean;
  /**
   * US#60/#33: 약속 위반(노쇼+당일취소) 3회 누적 시 설정되는 매칭 제한 만료 시각.
   * null이면 제한 없음. guideApproved와 분리된 별도 필드(ADR-0001).
   */
  matchBlockedUntil: Timestamp | null;
  /** US#33: 약속 위반(노쇼+당일취소) 합산 누적 횟수, ADR-0001에 따라 두 유형 구분 없이 합산. */
  noShowCount: number;
  /** US#10: 안내자 프로필 서사 — 거주 기간. */
  residencyYears?: number;
  /** US#10: 안내자 프로필 서사 — 관심 분야. */
  interests?: string[];
  /**
   * US#17~21 / Slice 6: 매칭 후보 검색(searchGuides)에 쓰이는 안내자의 위치 좌표.
   * null/미존재면 후보 검색에서 제외된다. "현재 위치로 검색" 시점 비교용 스냅샷이며,
   * 동네 지식의 exactLocation(GeoPoint)과는 무관한 별도 매칭용 위치다.
   */
  guideLocation?: {lat: number; lng: number} | null;
  /** US#21,#38,#64: 매칭 후보 정렬 및 KPI 측정에 쓰이는 안내자 통계. */
  guideStats: GuideStats;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** US#53~55. */
export interface EmergencyContact {
  name: string;
  phoneNumber: string;
}

/**
 * US#21: 매칭 후보 정렬 기준(만족도 평균 → 성사율 → 거리).
 * totalRequestsReceived === 0인 안내자는 "신규 안내자"로 취급되어 ①②를 건너뛴다.
 */
export interface GuideStats {
  /** US#38: null이면 평가 데이터 없음. */
  averageSatisfaction: number | null;
  /** US#21: 성사율 분모. 0이면 신규 안내자. */
  totalRequestsReceived: number;
  /** US#21: 성사율 분자(Completed 동행 수). */
  completedEscortCount: number;
}
