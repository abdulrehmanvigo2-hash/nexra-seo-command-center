import { LOW_CONFIDENCE_GAP_DAYS } from "@/lib/search-console/history/thresholds";
import type { QueryOverlap, QueryPageAnalysis } from "@/lib/search-console/query-pages/analyse";
import { CHANGE_MIN_IMPRESSIONS } from "@/lib/search-console/query-pages/thresholds";

/**
 * Two windows' overlap analyses, compared (M1 P4c, rule D).
 *
 * Pure and deterministic. A query's overlap "appeared" when the latest
 * window has it overlapping and the previous does not (whether the query
 * was on one page or absent from the previous set); "disappeared" is the
 * reverse. The "leader changed" list holds queries overlapping in both
 * windows whose leading page differs. "Impressions changed" holds queries
 * overlapping in both windows whose summed impressions moved by at least
 * CHANGE_MIN_IMPRESSIONS. Every list is sorted by the latest (or, for
 * disappeared, previous) impressions, then query. Two windows are two
 * observed cuts: a query absent from a cut is unobserved, not gone, and
 * the confidence says so when the windows are close.
 */

export type OverlapAppearance = {
  readonly query: string;
  readonly pageCount: number;
  readonly impressions: number;
  readonly leadingPage: string;
};

export type LeaderChange = {
  readonly query: string;
  readonly previousLeadingPage: string;
  readonly latestLeadingPage: string;
  readonly previousImpressions: number;
  readonly latestImpressions: number;
};

export type ImpressionsChange = {
  readonly query: string;
  readonly previousImpressions: number;
  readonly latestImpressions: number;
  readonly absolute: number;
  /** One decimal; null when the previous sum was zero (impossible for an overlap, kept for shape). */
  readonly percent: number | null;
  readonly direction: "up" | "down";
};

export type QueryPageComparison = {
  readonly gapDays: number;
  readonly confidence: "normal" | "low";
  readonly appeared: readonly OverlapAppearance[];
  readonly disappeared: readonly OverlapAppearance[];
  readonly leaderChanged: readonly LeaderChange[];
  readonly impressionsChanged: readonly ImpressionsChange[];
  /** Overlapping queries present in both windows. */
  readonly matched: number;
};

const appearance = (o: QueryOverlap): OverlapAppearance => ({ query: o.query, pageCount: o.pageCount, impressions: o.impressions, leadingPage: o.leadingPage });
const byImpressions = <T extends { impressions: number; query: string }>(a: T, b: T) => b.impressions - a.impressions || a.query.localeCompare(b.query);

export function compareQueryPageWindows(latest: QueryPageAnalysis, previous: QueryPageAnalysis, gapDays: number): QueryPageComparison {
  const previousByQuery = new Map(previous.overlaps.map((o) => [o.query, o]));
  const latestByQuery = new Map(latest.overlaps.map((o) => [o.query, o]));

  const appeared = latest.overlaps.filter((o) => !previousByQuery.has(o.query)).map(appearance).sort(byImpressions);
  const disappeared = previous.overlaps.filter((o) => !latestByQuery.has(o.query)).map(appearance).sort(byImpressions);

  const leaderChanged: LeaderChange[] = [];
  const impressionsChanged: ImpressionsChange[] = [];
  let matched = 0;
  for (const now of latest.overlaps) {
    const before = previousByQuery.get(now.query);
    if (!before) continue;
    matched += 1;
    if (before.leadingPage !== now.leadingPage) {
      leaderChanged.push({
        query: now.query,
        previousLeadingPage: before.leadingPage,
        latestLeadingPage: now.leadingPage,
        previousImpressions: before.impressions,
        latestImpressions: now.impressions,
      });
    }
    const absolute = now.impressions - before.impressions;
    if (Math.abs(absolute) >= CHANGE_MIN_IMPRESSIONS) {
      impressionsChanged.push({
        query: now.query,
        previousImpressions: before.impressions,
        latestImpressions: now.impressions,
        absolute,
        percent: before.impressions > 0 ? Number(((absolute / before.impressions) * 100).toFixed(1)) : null,
        direction: absolute > 0 ? "up" : "down",
      });
    }
  }
  leaderChanged.sort((a, b) => b.latestImpressions - a.latestImpressions || a.query.localeCompare(b.query));
  impressionsChanged.sort((a, b) => Math.abs(b.absolute) - Math.abs(a.absolute) || a.query.localeCompare(b.query));

  return {
    gapDays,
    confidence: gapDays < LOW_CONFIDENCE_GAP_DAYS ? "low" : "normal",
    appeared,
    disappeared,
    leaderChanged,
    impressionsChanged,
    matched,
  };
}
