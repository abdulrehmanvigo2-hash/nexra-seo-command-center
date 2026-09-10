import { deltaFor, round } from "@/lib/mock/dashboard/core";
import {
  getSnapshotBands,
  getSnapshotOpportunityCount,
  getSnapshotRates,
  getSnapshotRows,
} from "@/lib/mock/keywords";
import type {
  DashboardProject,
  DateRange,
  KeywordSnapshot,
  RankBucket,
  RankBucketId,
  TrendSeries,
} from "@/types/dashboard";

/**
 * Keyword performance for the selected project and window.
 *
 * Nothing about a keyword is defined here. The terms, their positions, their
 * volumes, and their movement all come from the canonical keyword registry in
 * `@/lib/mock/keywords`, which the Keyword Intelligence module renders in
 * full — so a term shown on this dashboard is the same record that module
 * holds, and opening it there shows the same numbers.
 *
 * The one thing this file still does is scale. The dashboard reports across a
 * ranking universe of thousands, derived from the trend series; the registry
 * holds the few hundred keywords analysed in detail. The registry therefore
 * supplies *shares* — what proportion of the set sits in each band, what
 * proportion won or lost places — and those shares are applied to the ranking
 * universe here. The two views describe the same behaviour at two different
 * sizes rather than disagreeing about it.
 */

const BUCKET_LABELS: Readonly<Record<RankBucketId, string>> = {
  "top-3": "Positions 1-3",
  "4-10": "Positions 4-10",
  "11-20": "Positions 11-20",
  "21-50": "Positions 21-50",
  "51-100": "Positions 51-100",
};

const BUCKET_ORDER: readonly RankBucketId[] = [
  "top-3",
  "4-10",
  "11-20",
  "21-50",
  "51-100",
];

/**
 * The ranking distribution, scaled from the analysed set to the full universe.
 *
 * `change` is still modelled: the registry holds one previous position per
 * keyword, not a full history of band transitions, so how many keywords
 * crossed a band boundary this window is not something it can answer. It is
 * derived from the project's own seed, as the rest of the dashboard's deltas
 * are.
 */
function distributionFor(
  project: DashboardProject,
  range: DateRange,
  ranking: number,
): readonly RankBucket[] {
  const shares = getSnapshotBands(project.id);

  return BUCKET_ORDER.map((id, index) => {
    const share = shares[id];
    const count = Math.round(ranking * share);
    const change = Math.round(
      count * (deltaFor(project, range, index + 7, index < 2 ? 6 : 2, 4) / 100),
    );

    return {
      id,
      label: BUCKET_LABELS[id],
      count,
      share: round(share * 100, 1),
      change,
    };
  });
}

/** Ranking distribution, movement counters, and the snapshot table. */
export function buildKeywordSnapshot(
  project: DashboardProject,
  range: DateRange,
  trend: TrendSeries,
): KeywordSnapshot {
  const latest = trend.current[trend.current.length - 1];
  const ranking = latest.organicKeywords;
  // Not every tracked term ranks; the rest sit outside the top 100.
  const tracked = Math.round(ranking / 0.78);

  const rates = getSnapshotRates(project.id);

  // Movement scales with the window: a quarter shows more of it than a week.
  const windowScale = (range.days / 30) ** 0.6;

  return {
    tracked,
    distribution: distributionFor(project, range, ranking),
    movement: {
      winners: Math.round(ranking * rates.winners),
      losers: Math.round(ranking * rates.losers),
      newRankings: Math.round(ranking * rates.newRankings * windowScale),
      lostRankings: Math.round(ranking * rates.lostRankings * windowScale),
      averagePosition: rates.averagePosition,
      averagePositionTrend: {
        value: deltaFor(project, range, 11, -1.8, 1.4),
        invert: true,
      },
      opportunities: getSnapshotOpportunityCount(project.id),
    },
    rows: getSnapshotRows(project.id),
  };
}
