import {onCall} from "firebase-functions/v2/https";
import {
  RequestEscortInput,
  RequestEscortOutput,
  RespondToRequestInput,
  RespondToRequestOutput,
  SearchGuidesInput,
  SearchGuidesOutput,
} from "./types";

/**
 * matching 모듈 — 위치 스냅샷 기반 안내자 탐색, 동행 요청 생성/응답.
 * 계약 정의만 포함(Slice 0, Issue #2). 구현은 후속 슬라이스에서 채운다.
 */

/**
 * US#17~21: 반경 1km 안내자 탐색.
 * 정렬: ① 만족도 평균 ↓ → ② 성사율 ↓ → ③ 거리 ↑. 신규 안내자(요청 0건)는 거리만 적용.
 */
export const searchGuides = onCall<
  SearchGuidesInput, Promise<SearchGuidesOutput>
>(
  async () => {
    throw new Error("not implemented");
  }
);

/**
 * US#23,#25: 탐방자 → 안내자 단방향 동행 요청 생성. escorts 문서를 Requested 상태로 생성.
 * Invariant: 역방향(안내자→탐방자) 요청 생성 경로 없음, 비상연락처 미등록/매칭제한 중이면 거부.
 */
export const requestEscort = onCall<
  RequestEscortInput, Promise<RequestEscortOutput>
>(
  async () => {
    throw new Error("not implemented");
  }
);

/**
 * US#24,#26: 안내자가 요청에 수락/거절. 수락 시 만남 장소·시간 확정(MeetingConfirmed).
 */
export const respondToRequest = onCall<
  RespondToRequestInput,
  Promise<RespondToRequestOutput>
>(async () => {
  throw new Error("not implemented");
});
