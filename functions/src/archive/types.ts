import {
  ArchiveCategory,
  ArchiveItemOwnerView,
  ArchiveItemPublicView,
} from "../types";

/**
 * archive 모듈 callable function 계약.
 * PRD (Issue #1) User Stories #1~15, Implementation Decisions > `archive` 모듈.
 */

/** US#1,#3~7: 1차 분류 + 음성(필수) + 사진(선택) + 위치 확정. */
export interface CreateArchiveItemInput {
  category: ArchiveCategory;
  /** Invariant: 빈 문자열/미제공 시 거부. */
  voiceTranscript: string;
  photoUrls?: string[];
  /**
   * US#7: GPS 좌표 직접 입력 방식. dong을 제공하지 않을 때 사용.
   * location과 dong 중 하나는 반드시 제공해야 한다.
   */
  location?: {lat: number; lng: number};
  /**
   * 동 단위 입력 방식. location을 제공하지 않을 때 사용.
   * getAvailableDongs로 조회한 동 이름 중 하나여야 한다.
   */
  dong?: string;
}
export interface CreateArchiveItemOutput {
  item: ArchiveItemOwnerView;
}

/** US#9: 안내자 본인의 동네 지식 수정. */
export interface UpdateArchiveItemInput {
  itemId: string;
  category?: ArchiveCategory;
  voiceTranscript?: string;
  photoUrls?: string[];
}
export interface UpdateArchiveItemOutput {
  item: ArchiveItemOwnerView;
}

/** US#9: 안내자 본인의 동네 지식 삭제. */
export interface DeleteArchiveItemInput {
  itemId: string;
}
export interface DeleteArchiveItemOutput {
  deleted: true;
}

/** US#15: 탐방자가 부적절/오류 동네 지식 신고 → 운영자 사후 검토 대상. */
export interface ReportArchiveItemInput {
  itemId: string;
  reason?: string;
}
export interface ReportArchiveItemOutput {
  reportCount: number;
}

/** US#11~14: 탐방자가 반경 3km 이내 공개된 동네 지식 탐색(정확 좌표 비노출). */
export interface ListNearbyArchiveItemsInput {
  location: {lat: number; lng: number};
  category?: ArchiveCategory;
}
export interface ListNearbyArchiveItemsOutput {
  items: ArchiveItemPublicView[];
}

/** 동 이름으로 해당 동의 공개된 동네 지식 목록을 조회한다. */
export interface ListArchiveItemsByDongInput {
  /** getAvailableDongs에서 반환된 dong 이름 중 하나. */
  dong: string;
  category?: ArchiveCategory;
}
export type ListArchiveItemsByDongOutput = ListNearbyArchiveItemsOutput;

/** 등록/검색에 사용 가능한 동 이름 목록을 반환한다. */
export type GetAvailableDongsInput = Record<string, never>;
export interface GetAvailableDongsOutput {
  dongs: string[];
}
