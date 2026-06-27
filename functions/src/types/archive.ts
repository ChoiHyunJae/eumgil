import {GeoPoint, Timestamp} from "firebase-admin/firestore";

/**
 * Firestore `archiveItems` collection.
 *
 * PRD (Issue #1) User Stories #1~15, Implementation Decisions > `archive` 모듈.
 * CONTEXT.md Invariants: 음성 없이 등록 불가, 정확 좌표는 작성자 외 누구에게도 비노출.
 */

/** US#3~6: 녹음 전 1차 분류, 3개로 고정. */
export type ArchiveCategory = "PLACE" | "WALK" | "OTHER";

export interface ArchiveItem {
  id: string;
  /** 안내자 uid. 동네 지식은 정확히 한 명의 안내자에게 귀속(CONTEXT.md Entities). */
  authorId: string;
  category: ArchiveCategory;
  /** US#1: STT 변환 결과. Invariant: 필수, 음성 없이 등록되는 경로 없음. */
  voiceTranscript: string;
  /**
   * US#8 (1차 포함, 일정에 따라 축소·연기 가능): AI 요약/정리 결과.
   * 이 단계가 축소될 경우 null로 유지하고 voiceTranscript만 노출.
   */
  aiSummary: string | null;
  /** US#8: 안내자가 AI 요약 결과를 확인하고 게시를 확정했는지. false면 미게시. */
  confirmedByAuthor: boolean;
  /** US#2: 선택적 첨부, 단독으로 동네 지식을 구성하지 않음. */
  photoUrls: string[];
  /**
   * US#7: 녹음 시점 GPS 자동 태깅 후 확인 버튼 1개로 확정된 정확 좌표.
   * Invariant(CONTEXT.md): 작성자 본인을 제외한 누구에게도 노출 금지 — 내부 저장 전용.
   */
  exactLocation: GeoPoint;
  /** US#13: 행정동 단위 역지오코딩 표시값(예: "종로구 ○○동 인근"). 모든 사용자에게 노출 가능. */
  dongLabel: string;
  /** US#12: 노출 반경(3km) 판정에 쓰이는 고정값. 매칭 반경(1km)보다 넓음. */
  visibilityRadiusM: number;
  /** US#14: 사전 검수 없이 등록 즉시 공개. */
  published: boolean;
  /** US#15: 사후 모더레이션을 위한 신고 누적 카운트. */
  reportCount: number;
  /** US#61: 운영자가 신고 검토 후 숨김 처리했는지. */
  hidden: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** 작성자 본인에게만 반환되는 뷰. exactLocation 포함. */
export type ArchiveItemOwnerView = ArchiveItem;

/**
 * US#10 / Slice 3: 동네 지식 카드에 함께 노출하는 작성 안내자 프로필 요약.
 * 모두 optional이며, 값이 있을 때만 채운다(없으면 authorProfile 자체를 생략).
 */
export interface AuthorProfileSummary {
  residenceYears?: number;
  interests?: string[];
}

/**
 * 작성자 외 사용자(탐방자, 다른 안내자)에게 반환되는 뷰.
 * Invariant: exactLocation은 어떤 응답에도 포함하지 않는다.
 * Slice 3: 작성 안내자 프로필 요약(authorProfile)을 optional로 포함할 수 있다.
 */
export type ArchiveItemPublicView = Omit<ArchiveItem, "exactLocation"> & {
  authorProfile?: AuthorProfileSummary;
};
