import * as admin from "firebase-admin";
import {Timestamp} from "firebase-admin/firestore";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {Escort, GuideStats} from "../types";
import {notifyEscortLifecycle} from "../notifications";
import {
  applyEscortPenalty,
  NO_SHOW_GRACE_MS,
  noShowParties,
} from "../escort/penalty";
import {nextSatisfactionStats} from "../escort/satisfaction";

/**
 * scheduled 모듈 — PRD에서 시간 경과로 자동 트리거되는 규칙.
 * callable이 아니라 Cloud Scheduler 기반 onSchedule 함수이므로 입출력 타입 계약 대신
 * 트리거 조건을 주석으로 명시한다.
 *
 * 노쇼/패널티 정책은 escort callable(judgeEscortNoShow, cancelEscort)과 동일한
 * 공유 헬퍼(../escort/penalty)를 사용해 정책 드리프트를 방지한다.
 */

/** US#35: InProgress가 24시간 이상 지속되면 자동 완료(영구 InProgress 방지). */
const AUTO_COMPLETE_MS = 24 * 60 * 60 * 1000;

/**
 * InProgress 동행의 시작 기준 시각(밀리초)을 추정한다.
 * 별도 startedAt 필드가 없으므로, 양쪽 "만났어요" 확인 시각 중 더 늦은 시각을
 * InProgress 진입 시점으로 본다(confirmMeeting이 양쪽 확인 시 InProgress 전환).
 * 둘 다 비어 있는 비정상 케이스는 updatedAt으로 폴백한다.
 *
 * @param {Omit<Escort, "id">} escort 대상 escort 문서 데이터.
 * @return {number} InProgress 시작 추정 시각(밀리초).
 */
function inProgressStartMs(escort: Omit<Escort, "id">): number {
  const guide = escort.guideArrivalConfirmedAt?.toMillis();
  const traveler = escort.travelerArrivalConfirmedAt?.toMillis();
  if (guide != null && traveler != null) return Math.max(guide, traveler);
  return guide ?? traveler ?? escort.updatedAt.toMillis();
}

/**
 * US#25: escorts.status === "Requested"이고 requestExpiresAt가 지난 문서를
 * "Expired"로 자동 전환한다(expiredAt 기록). 알림 발송은 별도 슬라이스.
 * 트리거 조건: requestExpiresAt <= now() AND status == "Requested".
 */
export const expireEscortRequests = onSchedule("every 15 minutes", async () => {
  const db = admin.firestore();
  const now = Timestamp.now();

  const snap = await db
    .collection("escorts")
    .where("status", "==", "Requested")
    .where("requestExpiresAt", "<=", now)
    .get();

  if (snap.empty) return;

  const batch = db.batch();
  for (const doc of snap.docs) {
    batch.update(doc.ref, {status: "Expired", expiredAt: now, updatedAt: now});
  }
  await batch.commit();
});

/**
 * US#30~33: escorts.status === "MeetingConfirmed"이고 meetingTime + 30분이 지난
 * 문서에서 "만났어요"를 누르지 않은 쪽을 noShowBy로 기록하고 status를 "NoShow"로
 * 전환한다. 이어서 noShowCount를 증가시키고 3회 이상이면 matchBlockedUntil(+7일)을
 * 설정한다(escort callable judgeEscortNoShow와 동일 정책 공유). 양쪽 모두 확인한
 * 문서는 대상에서 제외한다. 각 문서를 트랜잭션으로 처리해 callable과의 경합에서도
 * 일관성을 유지한다.
 * 트리거 조건: meetingTime + 30min <= now() AND status == "MeetingConfirmed".
 */
export const judgeNoShow = onSchedule("every 5 minutes", async () => {
  const db = admin.firestore();
  const now = Timestamp.now();
  const cutoff = Timestamp.fromMillis(now.toMillis() - NO_SHOW_GRACE_MS);

  const snap = await db
    .collection("escorts")
    .where("status", "==", "MeetingConfirmed")
    .where("meetingTime", "<=", cutoff)
    .get();

  for (const doc of snap.docs) {
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(doc.ref);
      if (!fresh.exists) return;
      const escort = fresh.data() as Omit<Escort, "id">;
      // 트랜잭션 재확인: 그사이 callable/다른 트리거가 처리했으면 건너뛴다.
      if (escort.status !== "MeetingConfirmed" || !escort.meetingTime) return;
      if (now.toMillis() < escort.meetingTime.toMillis() + NO_SHOW_GRACE_MS) {
        return;
      }
      const noShowBy = noShowParties(escort);
      if (noShowBy.length === 0) return; // 양쪽 확인 → 노쇼 아님

      const penaltyRefs = noShowBy.map((party) =>
        db
          .collection("users")
          .doc(party === "guide" ? escort.guideId : escort.travelerId)
      );
      const penaltySnaps = await Promise.all(
        penaltyRefs.map((ref) => tx.get(ref))
      );

      tx.update(doc.ref, {status: "NoShow", noShowBy, updatedAt: now});
      penaltyRefs.forEach((ref, i) => {
        applyEscortPenalty(tx, ref, penaltySnaps[i], now);
      });
    });
  }
});

/**
 * US#35: escorts.status === "InProgress"이고 InProgress 진입 후 24시간이 지난
 * 문서를 자동으로 "Completed"로 전환한다(영구 InProgress 방지 안전장치).
 * 시작 기준은 inProgressStartMs(양쪽 도착 확인 중 늦은 시각, 폴백 updatedAt)이다.
 * Completed/MidTerminated/Cancelled/NoShow 등은 쿼리에서 제외(status 등식)된다.
 * 트리거 조건: status == "InProgress" AND inProgressStart + 24h <= now().
 */
export const autoCompleteEscort = onSchedule("every 15 minutes", async () => {
  const db = admin.firestore();
  const now = Timestamp.now();

  const snap = await db
    .collection("escorts")
    .where("status", "==", "InProgress")
    .get();

  if (snap.empty) return;

  // 1) 24시간 경과한 자동 완료 대상 선별.
  const toComplete: Array<{
    ref: admin.firestore.DocumentReference;
    escort: Omit<Escort, "id">;
  }> = [];
  for (const doc of snap.docs) {
    const escort = doc.data() as Omit<Escort, "id">;
    if (now.toMillis() - inProgressStartMs(escort) >= AUTO_COMPLETE_MS) {
      toComplete.push({ref: doc.ref, escort});
    }
  }
  if (toComplete.length === 0) return;

  // 2) 만족도 통계 반영 대상(평가 있고 미반영)을 guideId별로 모은다.
  //    같은 guide에 여러 평가가 있으면 순차 누적한다.
  const ratingsByGuide = new Map<string, number[]>();
  for (const {escort} of toComplete) {
    if (
      escort.satisfactionRating != null &&
      escort.satisfactionStatsAppliedAt == null
    ) {
      const list = ratingsByGuide.get(escort.guideId) ?? [];
      list.push(escort.satisfactionRating);
      ratingsByGuide.set(escort.guideId, list);
    }
  }

  // 3) batch 전에 필요한 guide 문서를 먼저 읽는다(read-before-write).
  const guideIds = [...ratingsByGuide.keys()];
  const guideSnaps = await Promise.all(
    guideIds.map((id) => db.collection("users").doc(id).get())
  );
  const guideStatsById = new Map<string, Partial<GuideStats>>();
  guideSnaps.forEach((gs, i) => {
    if (gs.exists) {
      guideStatsById.set(
        guideIds[i],
        (gs.data()?.guideStats ?? {}) as Partial<GuideStats>
      );
    }
  });

  // 4) 단일 batch로 escort 자동 완료 + guide 통계 갱신을 처리한다.
  const batch = db.batch();
  const completed: Array<Pick<Escort, "guideId" | "travelerId">> = [];
  for (const {ref, escort} of toComplete) {
    const escortUpdate: Record<string, unknown> = {
      status: "Completed",
      autoCompletedAt: now,
      updatedAt: now,
    };
    // 이 escort의 평가를 이번에 통계 반영할 수 있으면 플래그를 기록한다.
    if (
      escort.satisfactionRating != null &&
      escort.satisfactionStatsAppliedAt == null &&
      guideStatsById.has(escort.guideId)
    ) {
      escortUpdate.satisfactionStatsAppliedAt = now;
    }
    batch.update(ref, escortUpdate);
    completed.push({guideId: escort.guideId, travelerId: escort.travelerId});
  }
  for (const [guideId, ratings] of ratingsByGuide) {
    const stats = guideStatsById.get(guideId);
    if (!stats) continue; // guide 문서가 없으면 통계 반영 생략
    let acc: Partial<GuideStats> = stats;
    for (const rating of ratings) {
      acc = nextSatisfactionStats(acc, rating);
    }
    batch.update(db.collection("users").doc(guideId), {
      "guideStats.averageSatisfaction": acc.averageSatisfaction,
      "guideStats.ratedEscortCount": acc.ratedEscortCount,
      "updatedAt": now,
    });
  }

  await batch.commit();

  // 자동 완료된 동행마다 종료 알림(best-effort, 실패가 배치를 깨지 않도록 격리).
  for (const escort of completed) {
    try {
      await notifyEscortLifecycle(escort, "ended");
    } catch (e) {
      console.error("[notify] autoComplete 종료 알림 실패:", e);
    }
  }
});

/**
 * US#43 / Slice 11: escortPairs.groupSuggestionStatus === "proposed" 이고
 * suggestionExpiresAt <= now() 인 문서를 "expired"로 전환한다.
 * 트리거 조건: groupSuggestionStatus == "proposed" AND suggestionExpiresAt <= now().
 */
export const expireGroupSuggestions = onSchedule("every 60 minutes", async () => {
  const db = admin.firestore();
  const now = Timestamp.now();

  const snap = await db
    .collection("escortPairs")
    .where("groupSuggestionStatus", "==", "proposed")
    .where("suggestionExpiresAt", "<=", now)
    .get();

  if (snap.empty) return;

  const batch = db.batch();
  for (const doc of snap.docs) {
    batch.update(doc.ref, {
      groupSuggestionStatus: "expired",
      updatedAt: now,
    });
  }
  await batch.commit();
});
