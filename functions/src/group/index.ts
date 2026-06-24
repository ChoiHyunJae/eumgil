import {onCall} from "firebase-functions/v2/https";
import {
  CreateGroupInput,
  CreateGroupOutput,
  DissolveGroupInput,
  DissolveGroupOutput,
  InviteToGroupInput,
  InviteToGroupOutput,
  RespondToSuggestionInput,
  RespondToSuggestionOutput,
  SuggestGroupInput,
  SuggestGroupOutput,
} from "./types";

/**
 * group 모듈 — 소모임 자동 제안/응답/개설/초대/해산.
 * 계약 정의만 포함(Slice 0, Issue #2). 구현은 후속 슬라이스에서 채운다.
 * 제안 7일 무응답 만료는 scheduled/ 모듈의 별도 트리거가 담당한다.
 */

/**
 * US#39~40: 같은 안내자-탐방자 쌍의 Completed 누적 3회 시점에 제안 생성.
 * 정상적으로는 escort 모듈의 completeEscort 처리 흐름에서 내부적으로 트리거되지만,
 * 팀 간 계약 가시성을 위해 callable로도 노출한다(운영/테스트 용도).
 */
export const suggestGroup = onCall<
  SuggestGroupInput, Promise<SuggestGroupOutput>
>(
  async () => {
    throw new Error("not implemented");
  }
);

/**
 * US#41~42,#51: 제안에 동의/거절. 양쪽 모두 동의해야 모임 생성, 거절 시 재제안 금지.
 */
export const respondToSuggestion = onCall<
  RespondToSuggestionInput,
  Promise<RespondToSuggestionOutput>
>(async () => {
  throw new Error("not implemented");
});

/** US#44: 안내자가 소모임 직접 개설. */
export const createGroup = onCall<
  CreateGroupInput, Promise<CreateGroupOutput>
>(
  async () => {
    throw new Error("not implemented");
  }
);

/** US#45~46: 안내자가 신규 탐방자 초대, 기존 탐방자 멤버 전원 동의 필요. */
export const inviteToGroup = onCall<
  InviteToGroupInput, Promise<InviteToGroupOutput>
>(
  async () => {
    throw new Error("not implemented");
  }
);

/** US#50: 소모임 해산(개설 안내자 자격 상실 시 자동 해산 로직과 동일 결과를 만드는 수동 경로). */
export const dissolveGroup = onCall<
  DissolveGroupInput, Promise<DissolveGroupOutput>
>(
  async () => {
    throw new Error("not implemented");
  }
);
