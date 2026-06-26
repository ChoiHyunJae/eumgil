import * as admin from "firebase-admin";
import {Timestamp} from "firebase-admin/firestore";
import {Escort, EscortParty} from "../types";

/**
 * escort 노쇼/패널티 공유 로직.
 * callable(judgeEscortNoShow, cancelEscort)과 scheduled(judgeNoShow) 모두 같은
 * 정책을 쓰도록 한 곳에서 정의한다(정책 드리프트 방지).
 */

/** US#32: 노쇼 판정 가능 시점(약속 시간 + 30분, 밀리초). */
export const NO_SHOW_GRACE_MS = 30 * 60 * 1000;

/** US#33/#60: 약속 위반(노쇼+당일취소) 누적 임계. 이 이상이면 매칭 제한. */
export const PENALTY_THRESHOLD = 3;

/** US#60: 매칭 제한 기간(7일, 밀리초). */
export const MATCH_BLOCK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 도착을 확인하지 않은 당사자(노쇼 대상)를 산출한다.
 * 빈 배열이면 양쪽 모두 확인한 것이므로 노쇼가 아니다.
 *
 * @param {object} escort 도착 확인 시각 필드를 가진 escort 데이터.
 * @return {EscortParty[]} 노쇼로 판정할 당사자 목록(없으면 빈 배열).
 */
export function noShowParties(
  escort: Pick<
    Escort,
    "guideArrivalConfirmedAt" | "travelerArrivalConfirmedAt"
  >
): EscortParty[] {
  const parties: EscortParty[] = [];
  if (escort.guideArrivalConfirmedAt == null) parties.push("guide");
  if (escort.travelerArrivalConfirmedAt == null) parties.push("traveler");
  return parties;
}

/**
 * 약속 위반(노쇼 또는 당일취소) 패널티를 트랜잭션 안에서 사용자 문서에 적용한다.
 * noShowCount를 1 증가시키고, 누적이 임계 이상이면 matchBlockedUntil을 now+7일로
 * 설정한다. 모든 read 이후에 호출해야 한다(트랜잭션 read-before-write 규칙).
 *
 * @param {admin.firestore.Transaction} tx 진행 중 트랜잭션.
 * @param {admin.firestore.DocumentReference} userRef 대상 사용자 문서 참조.
 * @param {admin.firestore.DocumentSnapshot} userSnap 미리 읽어둔 사용자 스냅샷.
 * @param {Timestamp} now 기준 현재 시각.
 * @return {void}
 */
export function applyEscortPenalty(
  tx: admin.firestore.Transaction,
  userRef: admin.firestore.DocumentReference,
  userSnap: admin.firestore.DocumentSnapshot,
  now: Timestamp
): void {
  if (!userSnap.exists) {
    return; // 사용자 문서가 없으면 패널티를 생략한다(데이터 정합성 보호).
  }
  const current = (userSnap.data()?.noShowCount as number | undefined) ?? 0;
  const next = current + 1;
  const updates: Record<string, unknown> = {noShowCount: next, updatedAt: now};
  if (next >= PENALTY_THRESHOLD) {
    updates.matchBlockedUntil = Timestamp.fromMillis(
      now.toMillis() + MATCH_BLOCK_MS
    );
  }
  tx.update(userRef, updates);
}
