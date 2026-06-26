import {GuideStats} from "../types";

/**
 * escort 만족도 통계 공유 계산.
 * completeEscort(트랜잭션)와 scheduled/autoCompleteEscort(배치)가 동일한 러닝
 * 평균 식을 쓰도록 한 곳에서 정의한다(정책 드리프트 방지).
 */

/** 평균/건수만 담은 통계 스냅샷. */
export interface SatisfactionStats {
  averageSatisfaction: number;
  ratedEscortCount: number;
}

/**
 * 기존 guideStats에 새 평가 1건을 반영한 러닝 평균/건수를 계산한다(I/O 없음).
 * averageSatisfaction이 null/미존재면 0, ratedEscortCount가 미존재면 0으로 본다.
 *
 * @param {Partial<GuideStats> | undefined} stats 현재 guideStats(없으면 초기값).
 * @param {number} rating 반영할 만족도 평가(1~5).
 * @return {SatisfactionStats} 반영 후 averageSatisfaction/ratedEscortCount.
 */
export function nextSatisfactionStats(
  stats: Partial<GuideStats> | undefined,
  rating: number
): SatisfactionStats {
  const current = stats ?? {};
  const oldCount = current.ratedEscortCount ?? 0;
  const oldAvg = current.averageSatisfaction ?? 0;
  const newCount = oldCount + 1;
  return {
    averageSatisfaction: (oldAvg * oldCount + rating) / newCount,
    ratedEscortCount: newCount,
  };
}
