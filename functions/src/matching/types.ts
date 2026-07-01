import {UserProfile} from "../types";

/**
 * matching 모듈 callable function 계약.
 * PRD (Issue #1) User Stories #16~26, Implementation Decisions > `matching` 모듈.
 */

/** 매칭 후보로 노출되는 안내자 요약. exactLocation을 포함하지 않는다(archive와 동일 원칙). */
export interface GuideCandidate {
  guide: UserProfile;
  distanceM: number;
  /**
   * US#21: totalRequestsReceived === 0이면 신규 안내자(거리 기준만 적용).
   * 정렬 자체는 함수 구현부 책임이며 이 타입은 응답 형태만 정의한다.
   */
  isNewGuide: boolean;
}

/**
 * US#17~21: "현재 위치로 검색" 시점 좌표 스냅샷 기준 반경 1km 안내자 탐색.
 * Invariant: 위치 권한 거부 시 이 함수 자체를 호출할 수 없음(클라이언트 책임).
 */
export interface SearchGuidesInput {
  /** US#19: 검색 버튼을 누른 시점의 좌표(실시간 추적 아님). */
  location: {lat: number; lng: number};
}
export interface SearchGuidesOutput {
  candidates: GuideCandidate[];
}

/**
 * US#23: 탐방자 → 안내자 단방향 요청 생성.
 * Invariant: 안내자가 먼저 탐방자에게 요청을 보내는 경로는 존재하지 않음(역방향 거부).
 * 매칭 제한 기간(matchBlockedUntil) 중인 탐방자는 요청 생성 불가.
 */
export interface RequestEscortInput {
  guideId: string;
  /**
   * 탐방자가 해당 안내자가 등록한 특정 동네 지식을 보고 요청하는 경우 그 문서 id.
   * archiveItems.authorId === guideId 인지 서버가 검증한다.
   */
  archiveItemId?: string;
}
export interface RequestEscortOutput {
  escortId: string;
  /** US#25: 48시간 응답 기한, escorts.requestExpiresAt과 동일 값. */
  requestExpiresAt: string;
}

/**
 * US#24,#26: 안내자가 들어온 요청을 수락/거절. 수락 시 만남 장소·시간 확정(MeetingConfirmed).
 * Invariant: 매칭 제한 기간 중인 안내자는 수락 불가.
 */
export interface RespondToRequestInput {
  escortId: string;
  accept: boolean;
  /**
   * accept=true일 때 필수(meetingArchiveItemId를 주지 않는 경우): US#26 만남
   * 장소·시간 확정. meetingLocation 또는 meetingArchiveItemId 중 하나 제공.
   */
  meetingLocation?: {lat: number; lng: number};
  /**
   * accept=true일 때, 좌표 대신 안내자 본인의 동네 지식 문서 id로 만남 장소를
   * 지정할 수 있다. 서버가 해당 동네 지식의 exactLocation을 만남 장소로 사용하고
   * 제목을 meetingLocationLabel에 저장한다. authorId가 호출자와 다르면 거부.
   */
  meetingArchiveItemId?: string;
  meetingTime?: string;
}
export interface RespondToRequestOutput {
  status: "Accepted" | "Rejected" | "MeetingConfirmed";
}

/**
 * US#24: 안내자가 자신에게 들어온 Requested(미만료) 요청 한 건의 요약.
 * traveler 상세 프로필은 포함하지 않고 travelerId만 노출한다.
 * Timestamp는 Flutter 파싱 편의를 위해 ISO 8601 문자열로 반환한다.
 */
export interface ReceivedEscortRequestSummary {
  escortId: string;
  travelerId: string;
  requestedAt: string;
  requestExpiresAt: string;
  /** 탐방자가 특정 동네 지식을 보고 요청한 경우 그 문서 id. 없으면 null. */
  requestedArchiveItemId: string | null;
}

/**
 * US#24: 안내자(request.auth.uid)가 받은 Requested 요청 목록 조회.
 * 입력은 없으며 호출자 본인이 guideId인 요청만 대상으로 한다.
 */
export type ListReceivedEscortRequestsInput = Record<string, never>;
export interface ListReceivedEscortRequestsOutput {
  requests: ReceivedEscortRequestSummary[];
}
