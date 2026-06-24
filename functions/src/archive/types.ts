import {
  ArchiveCategory,
  ArchiveItemOwnerView,
  ArchiveItemPublicView,
} from "../types";

/**
 * archive 모듈 callable function 계약.
 * PRD (Issue #1) User Stories #1~15, Implementation Decisions > `archive` 모듈.
 */

/** US#1,#3~7: 1차 분류 + 음성(필수) + 사진(선택) + GPS 좌표 확정. */
export interface CreateArchiveItemInput {
  category: ArchiveCategory;
  /** Invariant: 빈 문자열/미제공 시 거부. */
  voiceTranscript: string;
  photoUrls?: string[];
  /** US#7: 녹음 시점 GPS 자동 태깅 값. */
  location: {lat: number; lng: number};
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
