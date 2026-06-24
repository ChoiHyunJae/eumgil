import {onCall} from "firebase-functions/v2/https";
import {
  CreateArchiveItemInput,
  CreateArchiveItemOutput,
  DeleteArchiveItemInput,
  DeleteArchiveItemOutput,
  ListNearbyArchiveItemsInput,
  ListNearbyArchiveItemsOutput,
  ReportArchiveItemInput,
  ReportArchiveItemOutput,
  UpdateArchiveItemInput,
  UpdateArchiveItemOutput,
} from "./types";

/**
 * archive 모듈 — 안내자의 동네 지식 등록/수정/삭제/신고, 탐방자의 탐색.
 * 계약 정의만 포함(Slice 0, Issue #2). 구현은 후속 슬라이스에서 채운다.
 */

/**
 * US#1,#3~9: 동네 지식 등록.
 * Invariant(CONTEXT.md): 음성 없이 등록 불가, 정확 좌표는 작성자 본인에게만 노출.
 */
export const createArchiveItem = onCall<
  CreateArchiveItemInput,
  Promise<CreateArchiveItemOutput>
>(async () => {
  throw new Error("not implemented");
});

/** US#9: 안내자 본인의 동네 지식 수정. */
export const updateArchiveItem = onCall<
  UpdateArchiveItemInput,
  Promise<UpdateArchiveItemOutput>
>(async () => {
  throw new Error("not implemented");
});

/** US#9: 안내자 본인의 동네 지식 삭제. */
export const deleteArchiveItem = onCall<
  DeleteArchiveItemInput,
  Promise<DeleteArchiveItemOutput>
>(async () => {
  throw new Error("not implemented");
});

/** US#15: 신고 누적 → 운영자 사후 모더레이션 대상으로 표시. */
export const reportArchiveItem = onCall<
  ReportArchiveItemInput,
  Promise<ReportArchiveItemOutput>
>(async () => {
  throw new Error("not implemented");
});

/**
 * US#11~14: 탐방자가 반경 3km 이내 공개된 동네 지식 탐색.
 * Invariant: 응답에는 행정동 표시값만 포함, 정확 좌표 제외.
 */
export const listNearbyArchiveItems = onCall<
  ListNearbyArchiveItemsInput,
  Promise<ListNearbyArchiveItemsOutput>
>(async () => {
  throw new Error("not implemented");
});
