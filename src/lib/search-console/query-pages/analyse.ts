import {
  CANDIDATE_MAX_POSITION_GAP,
  CANDIDATE_MIN_IMPRESSIONS,
  CANDIDATE_MIN_PAGES,
  MAX_CONCENTRATION_PAGES,
  OVERLAP_MIN_PAGES,
} from "@/lib/search-console/query-pages/thresholds";
import type { SearchPerformance, SearchQueryPageRow } from "@/types/search-console";

/**
 * One window's stored query × page rows, analysed (milestone M1, phase 4,
 * checkpoint P4c).
 *
 * Pure and deterministic: the same rows always give the same answer, every
 * figure is arithmetic over the pairs, and every label follows the constants
 * in `thresholds.ts`. Overlaps are sorted by the query's impressions across
 * its pages, then by query text; pages within an overlap by impressions,
 * then clicks, then URL. Nothing is cut here: the counts are the true
 * counts, and a reader that shows fewer says how many there are.
 */

export type OverlapPage = SearchPerformance & {
  readonly page: string;
  /** This page's share of the query's impressions across its stored pages, four decimals. */
  readonly share: number;
};

export type QueryOverlap = {
  readonly query: string;
  /** Impressions descending, then clicks, then URL. */
  readonly pages: readonly OverlapPage[];
  readonly pageCount: number;
  /** Sums over the query's stored pages. */
  readonly impressions: number;
  readonly clicks: number;
  /** The page Google showed most for the query (impressions, then clicks, then URL). */
  readonly leadingPage: string;
  readonly leadingShare: number;
  /** The rule in `thresholds.ts` held: a candidate for review, not a finding. */
  readonly candidate: boolean;
  /** How many pages had at least CANDIDATE_MIN_IMPRESSIONS impressions for the query. */
  readonly meaningfulPages: number;
  /** Best minus worst average position among the meaningful pages, one decimal; null under two such pages. */
  readonly positionGap: number | null;
};

export type PageConcentration = {
  readonly page: string;
  /** Overlapping queries this page leads. */
  readonly overlapsLed: number;
  /** Overlapping queries this page appears under at all. */
  readonly overlaps: number;
  /** Impressions this page received across the overlapping queries. */
  readonly impressions: number;
};

export type QueryPageAnalysis = {
  /** True counts over the stored set. */
  readonly pairs: number;
  readonly queries: number;
  readonly pages: number;
  readonly overlaps: readonly QueryOverlap[];
  readonly overlapCount: number;
  readonly candidateCount: number;
  /** Pages leading the most overlaps, at most MAX_CONCENTRATION_PAGES, by overlaps led, impressions, URL. */
  readonly concentration: readonly PageConcentration[];
};

const round = (value: number, decimals: number) => Number(value.toFixed(decimals));

function pageOrder(a: SearchQueryPageRow, b: SearchQueryPageRow): number {
  return b.impressions - a.impressions || b.clicks - a.clicks || a.page.localeCompare(b.page);
}

export function analyseQueryPages(rows: readonly SearchQueryPageRow[]): QueryPageAnalysis {
  const byQuery = new Map<string, SearchQueryPageRow[]>();
  const pages = new Set<string>();
  const seen = new Set<string>();
  let pairs = 0;
  for (const row of rows) {
    const key = `${row.query}\n${row.page}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs += 1;
    pages.add(row.page);
    const list = byQuery.get(row.query);
    if (list) list.push(row);
    else byQuery.set(row.query, [row]);
  }

  const overlaps: QueryOverlap[] = [];
  for (const [query, list] of byQuery) {
    if (list.length < OVERLAP_MIN_PAGES) continue;
    const sorted = [...list].sort(pageOrder);
    const impressions = sorted.reduce((sum, row) => sum + row.impressions, 0);
    const clicks = sorted.reduce((sum, row) => sum + row.clicks, 0);
    const meaningful = sorted.filter((row) => row.impressions >= CANDIDATE_MIN_IMPRESSIONS);
    const positionGap =
      meaningful.length >= 2 ? round(Math.max(...meaningful.map((r) => r.position)) - Math.min(...meaningful.map((r) => r.position)), 1) : null;
    const candidate = meaningful.length >= CANDIDATE_MIN_PAGES && positionGap !== null && positionGap <= CANDIDATE_MAX_POSITION_GAP;
    const leading = sorted[0];
    overlaps.push({
      query,
      pages: sorted.map((row) => ({
        page: row.page,
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position,
        share: round(row.impressions / impressions, 4),
      })),
      pageCount: sorted.length,
      impressions,
      clicks,
      leadingPage: leading.page,
      leadingShare: round(leading.impressions / impressions, 4),
      candidate,
      meaningfulPages: meaningful.length,
      positionGap,
    });
  }
  overlaps.sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks || a.query.localeCompare(b.query));

  const concentration = new Map<string, { overlapsLed: number; overlaps: number; impressions: number }>();
  for (const overlap of overlaps) {
    for (const page of overlap.pages) {
      const entry = concentration.get(page.page) ?? { overlapsLed: 0, overlaps: 0, impressions: 0 };
      entry.overlaps += 1;
      entry.impressions += page.impressions;
      if (page.page === overlap.leadingPage) entry.overlapsLed += 1;
      concentration.set(page.page, entry);
    }
  }

  return {
    pairs,
    queries: byQuery.size,
    pages: pages.size,
    overlaps,
    overlapCount: overlaps.length,
    candidateCount: overlaps.filter((o) => o.candidate).length,
    concentration: [...concentration]
      .map(([page, entry]) => ({ page, ...entry }))
      .sort((a, b) => b.overlapsLed - a.overlapsLed || b.impressions - a.impressions || a.page.localeCompare(b.page))
      .slice(0, MAX_CONCENTRATION_PAGES),
  };
}
