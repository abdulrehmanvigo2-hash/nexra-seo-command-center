import { selectComparableSnapshots } from "@/lib/search-console/history/select";
import { isOpportunity, LOW_CONFIDENCE_GAP_DAYS, movementOf, type Movement } from "@/lib/search-console/history/thresholds";
import { SNAPSHOT_MAX_ROWS, type SearchConsoleSnapshot, type SnapshotPartial } from "@/lib/search-console/snapshots/contract";
import type { SearchPerformance, SearchPerformanceRow } from "@/types/search-console";

/**
 * Two stored Search Console snapshots, compared (milestone M1, phase 4,
 * checkpoint P4a).
 *
 * Pure and deterministic: the same two rows always give the same answer,
 * every figure is arithmetic over what the snapshots store, and every
 * classification follows the constants in `thresholds.ts`. No model, no
 * live read, no search volume, no difficulty, and nothing that maps a query
 * to a page — the snapshots keep queries and pages as two separate top-25
 * lists, and so does this.
 *
 * Rules, in short. A difference is always given as an absolute change;
 * as a percentage only when the previous value was above zero (a zero
 * baseline has no percentage, and is said so rather than shown as infinite).
 * Click-through rate moves in percentage points. Position moves as
 * previous minus latest, so a positive number is an improvement, because a
 * lower position is better. A zero difference is `unchanged`. A list is
 * compared only when both snapshots carry it; a no-data latest window has
 * nothing to list, and a no-data previous window — Google reporting no
 * impressions at all — makes every latest row genuinely new. A row that
 * left the latest list has left Google's top 25 by clicks; it is not proven
 * lost, and the caveat says so beside the list.
 */

export type Direction = "up" | "down" | "unchanged";

export type MetricDelta = {
  readonly latest: number;
  readonly previous: number;
  readonly absolute: number;
  /** Percentage change, one decimal; null when the previous value was zero (no baseline). */
  readonly percent: number | null;
  readonly direction: Direction;
};

export type CtrDelta = {
  readonly latest: number;
  readonly previous: number;
  /** Percentage points, two decimals: 0.02 → 0.035 is +1.5 points. */
  readonly points: number;
  readonly direction: Direction;
};

export type PositionDelta = {
  readonly latest: number;
  /** Null when the previous window had no impressions: no position was observed. */
  readonly previous: number | null;
  /** previous − latest, one decimal; positive is an improvement. Null when previous is null. */
  readonly delta: number | null;
  readonly direction: "improved" | "declined" | "unchanged" | "not-established";
};

export type TotalsComparison = {
  readonly clicks: MetricDelta;
  readonly impressions: MetricDelta;
  readonly ctr: CtrDelta;
  readonly position: PositionDelta;
  /** The previous window reported no impressions: its counts are zero and its position unknown. */
  readonly previousNoData: boolean;
};

export type RowComparison = {
  readonly key: string;
  readonly latest: SearchPerformance;
  readonly previous: SearchPerformance;
  readonly clicks: MetricDelta;
  readonly impressions: MetricDelta;
  readonly ctr: CtrDelta;
  readonly position: PositionDelta & { readonly previous: number; readonly delta: number };
  readonly movement: Movement | null;
};

export type RowListComparison =
  | {
      readonly available: true;
      /** Rows in both lists, by latest clicks, then key. */
      readonly matched: readonly RowComparison[];
      /** Latest rows absent from the previous top 25, by clicks, then key. */
      readonly appeared: readonly SearchPerformanceRow[];
      /** Previous rows absent from the latest top 25: left the observed top 25, not proven lost. */
      readonly left: readonly SearchPerformanceRow[];
      /** Latest rows meeting the opportunity rule, by impressions, then key. */
      readonly opportunities: readonly SearchPerformanceRow[];
      /** Matched rows that improved by at least a place, by size of move, then key. */
      readonly improving: readonly RowComparison[];
      /** Matched rows that declined by at least a place, by size of move, then key. */
      readonly declining: readonly RowComparison[];
      /** The previous window had no impressions, so every latest row appeared. */
      readonly previousNoData: boolean;
      readonly caveat: string;
    }
  | {
      readonly available: false;
      readonly reason: "no-data-latest" | "queries-unavailable" | "pages-unavailable";
    };

export type SnapshotHistoryComparison =
  | {
      readonly available: true;
      readonly property: string;
      readonly rangeId: "30d";
      readonly latestEndDate: string;
      readonly previousEndDate: string;
      readonly gapDays: number;
      readonly latestState: SearchConsoleSnapshot["state"];
      readonly previousState: SearchConsoleSnapshot["state"];
      /** Null when the latest window reported no impressions. */
      readonly totals: TotalsComparison | null;
      readonly queries: RowListComparison;
      readonly pages: RowListComparison;
      readonly coverage: {
        readonly latestPartial: readonly SnapshotPartial[];
        readonly previousPartial: readonly SnapshotPartial[];
        /** Snapshots of the project under another property, set aside. */
        readonly otherProperty: number;
        /** Low when the gap is short or either side is partial or no-data. */
        readonly confidence: "normal" | "low";
      };
      readonly caveat: string;
    }
  | {
      readonly available: false;
      readonly reason: "no-snapshots" | "no-history-for-property" | "insufficient-history";
      readonly latestEndDate: string | null;
      readonly eligible: number;
      readonly otherProperty: number;
    };

export const TOP_LIST_CAVEAT = `Each list is Google's top ${SNAPSHOT_MAX_ROWS} rows by clicks for its window, not everything the property received. A row that appeared entered that top ${SNAPSHOT_MAX_ROWS}; a row that left fell out of it, which does not prove it lost all clicks. Queries and pages are separate lists: nothing here maps a query to a page.`;

export const COMPARISON_CAVEAT =
  "Two stored windows compared. A difference between them is not a trend and says nothing about cause. There is no search volume, keyword difficulty, ranking history or competitor data here.";

const round = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const directionOf = (delta: number): Direction => (delta > 0 ? "up" : delta < 0 ? "down" : "unchanged");

export function metricDelta(latest: number, previous: number): MetricDelta {
  const absolute = latest - previous;
  return {
    latest,
    previous,
    absolute,
    percent: previous > 0 ? round((absolute / previous) * 100, 1) : null,
    direction: directionOf(absolute),
  };
}

export function ctrDelta(latest: number, previous: number): CtrDelta {
  const points = round((latest - previous) * 100, 2);
  return { latest, previous, points, direction: directionOf(points) };
}

export function positionDelta(latest: number, previous: number | null): PositionDelta {
  if (previous === null) return { latest, previous: null, delta: null, direction: "not-established" };
  const delta = round(previous - latest, 1);
  return { latest, previous, delta, direction: delta > 0 ? "improved" : delta < 0 ? "declined" : "unchanged" };
}

function totalsComparison(latest: SearchPerformance, previous: SearchPerformance | null): TotalsComparison {
  const before = previous ?? { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  return {
    clicks: metricDelta(latest.clicks, before.clicks),
    impressions: metricDelta(latest.impressions, before.impressions),
    ctr: ctrDelta(latest.ctr, before.ctr),
    position: positionDelta(latest.position, previous ? previous.position : null),
    previousNoData: previous === null,
  };
}

const byClicksThenKey = (a: SearchPerformance & { key: string }, b: SearchPerformance & { key: string }) =>
  b.clicks - a.clicks || a.key.localeCompare(b.key);
const byImpressionsThenKey = (a: SearchPerformanceRow, b: SearchPerformanceRow) =>
  b.impressions - a.impressions || a.key.localeCompare(b.key);
const byMoveThenKey = (a: RowComparison, b: RowComparison) =>
  Math.abs(b.position.delta) - Math.abs(a.position.delta) || a.key.localeCompare(b.key);

function compareRow(latest: SearchPerformanceRow, previous: SearchPerformanceRow): RowComparison {
  const position = positionDelta(latest.position, previous.position) as RowComparison["position"];
  return {
    key: latest.key,
    latest: { clicks: latest.clicks, impressions: latest.impressions, ctr: latest.ctr, position: latest.position },
    previous: { clicks: previous.clicks, impressions: previous.impressions, ctr: previous.ctr, position: previous.position },
    clicks: metricDelta(latest.clicks, previous.clicks),
    impressions: metricDelta(latest.impressions, previous.impressions),
    ctr: ctrDelta(latest.ctr, previous.ctr),
    position,
    movement: movementOf(position.delta, latest.impressions, previous.impressions),
  };
}

/** One list (queries or pages) across the two snapshots. */
export function compareRowLists(
  kind: "queries" | "pages",
  latest: SearchConsoleSnapshot,
  previous: SearchConsoleSnapshot,
): RowListComparison {
  const unavailable: SnapshotPartial = kind === "queries" ? "queries-unavailable" : "pages-unavailable";
  if (latest.state === "no-data") return { available: false, reason: "no-data-latest" };
  if (latest.partial.includes(unavailable)) return { available: false, reason: unavailable };
  const previousNoData = previous.state === "no-data";
  if (!previousNoData && previous.partial.includes(unavailable)) return { available: false, reason: unavailable };

  const latestRows = [...latest[kind]].sort(byClicksThenKey);
  const previousRows = previousNoData ? [] : [...previous[kind]].sort(byClicksThenKey);
  const previousByKey = new Map(previousRows.map((row) => [row.key, row]));
  const latestKeys = new Set(latestRows.map((row) => row.key));

  const matched: RowComparison[] = [];
  const appeared: SearchPerformanceRow[] = [];
  for (const row of latestRows) {
    const before = previousByKey.get(row.key);
    if (before) matched.push(compareRow(row, before));
    else appeared.push(row);
  }
  const left = previousRows.filter((row) => !latestKeys.has(row.key));

  return {
    available: true,
    matched,
    appeared,
    left,
    opportunities: latestRows.filter(isOpportunity).sort(byImpressionsThenKey),
    improving: matched.filter((row) => row.movement === "improving").sort(byMoveThenKey),
    declining: matched.filter((row) => row.movement === "declining").sort(byMoveThenKey),
    previousNoData,
    caveat: TOP_LIST_CAVEAT,
  };
}

/**
 * The comparison for one project: selects the two snapshots for the
 * property the project is mapped to now, then compares them.
 */
export function compareSnapshotHistory(
  snapshots: readonly SearchConsoleSnapshot[],
  currentProperty: string,
): SnapshotHistoryComparison {
  const selection = selectComparableSnapshots(snapshots, currentProperty);
  if (!selection.ok) {
    return {
      available: false,
      reason: selection.reason,
      latestEndDate: selection.latestEndDate,
      eligible: selection.eligible,
      otherProperty: selection.otherProperty,
    };
  }
  const { latest, previous, gapDays, otherProperty } = selection;
  const lowConfidence =
    gapDays < LOW_CONFIDENCE_GAP_DAYS ||
    latest.partial.length > 0 ||
    previous.partial.length > 0 ||
    latest.state === "no-data" ||
    previous.state === "no-data";

  return {
    available: true,
    property: currentProperty,
    rangeId: "30d",
    latestEndDate: latest.endDate,
    previousEndDate: previous.endDate,
    gapDays,
    latestState: latest.state,
    previousState: previous.state,
    totals: latest.totals ? totalsComparison(latest.totals, previous.totals) : null,
    queries: compareRowLists("queries", latest, previous),
    pages: compareRowLists("pages", latest, previous),
    coverage: {
      latestPartial: [...latest.partial],
      previousPartial: [...previous.partial],
      otherProperty,
      confidence: lowConfidence ? "low" : "normal",
    },
    caveat: COMPARISON_CAVEAT,
  };
}
