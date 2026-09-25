import {
  COMPARISON_CAVEAT,
  type CtrDelta,
  type MetricDelta,
  type PositionDelta,
  type RowComparison,
  type RowListComparison,
  type SnapshotHistoryComparison,
} from "@/lib/search-console/history/compare";
import type { HistoryInput } from "@/lib/search-console/history/grounding";
import { LOW_CONFIDENCE_GAP_DAYS, MIN_GAP_DAYS, OPPORTUNITY_MAX_CTR, OPPORTUNITY_MAX_POSITION, OPPORTUNITY_MIN_IMPRESSIONS } from "@/lib/search-console/history/thresholds";
import { SNAPSHOT_MAX_ROWS, SNAPSHOT_RANGE_ID, type SnapshotPartial, type SnapshotState } from "@/lib/search-console/snapshots/contract";
import type { SearchPerformance, SearchPerformanceRow } from "@/types/search-console";

/**
 * Stored Search Console history, as the operator's screen may see it
 * (milestone M1, phase 4, checkpoint P4d).
 *
 * A projection of the P4a comparison to what a panel needs and nothing the
 * browser should hold: no property name, no snapshot id, no full top-25
 * list. At most HISTORY_LIST_LIMIT rows per list, with the true counts
 * beside them; every figure is the comparison's own arithmetic, passed
 * through, never recomputed here; a value the comparison could not
 * establish (a percentage over a zero baseline, a position with no previous
 * impressions) stays null and is shown as such, never as a zero. The
 * caveats are fixed sentences the section always shows.
 *
 * Pure and client-safe: no store, no server import, so the component can
 * share the URL and the wording with the route.
 */

/** The one window snapshots are kept for; the route accepts no other range. */
export const HISTORY_RANGE_ID = SNAPSHOT_RANGE_ID;
export const HISTORY_LIST_LIMIT = 5;
/** The longest query text or page URL carried to the browser; the true key is cut, not replaced. */
export const HISTORY_KEY_MAX = 200;

export type CountView = {
  readonly latest: number;
  readonly previous: number;
  readonly absolute: number;
  /** Null when the previous window was zero: no baseline, no percentage. */
  readonly percent: number | null;
};

export type CtrView = {
  readonly latest: number;
  readonly previous: number;
  /** Percentage points, two decimals. */
  readonly points: number;
};

export type PositionView = {
  readonly latest: number;
  /** Null when the previous window had no impressions. */
  readonly previous: number | null;
  /** previous − latest, one decimal; positive is an improvement. Null when previous is null. */
  readonly delta: number | null;
  readonly direction: PositionDelta["direction"];
};

export type TotalsView = {
  readonly clicks: CountView;
  readonly impressions: CountView;
  readonly ctr: CtrView;
  readonly position: PositionView;
  readonly previousNoData: boolean;
};

export type RowView = {
  readonly key: string;
  readonly latest: SearchPerformance;
  readonly previousPosition: number;
  /** previous − latest, one decimal; positive is an improvement. */
  readonly positionDelta: number;
  readonly clicksAbsolute: number;
};

export type OpportunityView = {
  readonly key: string;
  readonly latest: SearchPerformance;
};

export type ListView =
  | {
      readonly available: true;
      readonly improving: readonly RowView[];
      readonly declining: readonly RowView[];
      readonly opportunities: readonly OpportunityView[];
      /** True totals, before the per-list cut. */
      readonly counts: {
        readonly matched: number;
        readonly appeared: number;
        readonly left: number;
        readonly improving: number;
        readonly declining: number;
        readonly opportunities: number;
      };
      readonly previousNoData: boolean;
    }
  | { readonly available: false; readonly reason: Extract<RowListComparison, { available: false }>["reason"] };

export type HistoryView =
  | {
      readonly status: "available";
      readonly latestEndDate: string;
      readonly previousEndDate: string;
      readonly gapDays: number;
      readonly confidence: "normal" | "low";
      readonly latestState: SnapshotState;
      readonly previousState: SnapshotState;
      readonly latestPartial: readonly SnapshotPartial[];
      readonly previousPartial: readonly SnapshotPartial[];
      /** The project also has snapshots under a previous property, set aside. */
      readonly historyUnderOtherProperty: boolean;
      /** Null when the latest window reported no impressions. */
      readonly totals: TotalsView | null;
      readonly queries: ListView;
      readonly pages: ListView;
      readonly caveats: readonly string[];
    }
  | {
      readonly status: "no-snapshots" | "no-history-for-property" | "insufficient-history";
      readonly latestEndDate: string | null;
      /** Snapshots of the current property. */
      readonly eligible: number;
    }
  /** This deployment keeps no snapshots. */
  | { readonly status: "not-kept" };

export const HISTORY_CAVEATS: readonly string[] = [
  COMPARISON_CAVEAT,
  "Average position is Search Console's impression-weighted average for the window, not a rank tracker's reading.",
  `Improving, declining and opportunity rows come from Google's top ${SNAPSHOT_MAX_ROWS} rows by clicks in each window, so a row absent from either window's top ${SNAPSHOT_MAX_ROWS} is not compared. The lists are incomplete by design.`,
  "Queries and pages are separate lists. Nothing here maps a query to a page, and no cannibalisation conclusion can be drawn from them.",
];

const cutKey = (key: string) => (key.length > HISTORY_KEY_MAX ? key.slice(0, HISTORY_KEY_MAX) : key);

const countView = (delta: MetricDelta): CountView => ({ latest: delta.latest, previous: delta.previous, absolute: delta.absolute, percent: delta.percent });
const ctrView = (delta: CtrDelta): CtrView => ({ latest: delta.latest, previous: delta.previous, points: delta.points });
const positionView = (delta: PositionDelta): PositionView => ({ latest: delta.latest, previous: delta.previous, delta: delta.delta, direction: delta.direction });

const rowView = (row: RowComparison): RowView => ({
  key: cutKey(row.key),
  latest: row.latest,
  previousPosition: row.position.previous,
  positionDelta: row.position.delta,
  clicksAbsolute: row.clicks.absolute,
});

const opportunityView = (row: SearchPerformanceRow): OpportunityView => ({
  key: cutKey(row.key),
  latest: { clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position },
});

function listView(list: RowListComparison): ListView {
  if (!list.available) return { available: false, reason: list.reason };
  return {
    available: true,
    improving: list.improving.slice(0, HISTORY_LIST_LIMIT).map(rowView),
    declining: list.declining.slice(0, HISTORY_LIST_LIMIT).map(rowView),
    opportunities: list.opportunities.slice(0, HISTORY_LIST_LIMIT).map(opportunityView),
    counts: {
      matched: list.matched.length,
      appeared: list.appeared.length,
      left: list.left.length,
      improving: list.improving.length,
      declining: list.declining.length,
      opportunities: list.opportunities.length,
    },
    previousNoData: list.previousNoData,
  };
}

export function presentHistory(input: HistoryInput | null): HistoryView {
  if (input === null) return { status: "not-kept" };
  if (!input.available) {
    if (input.reason === "not-kept") return { status: "not-kept" };
    // A failed read is the route's 503, never a view: the caller decides before here.
    if (input.reason === "read-failed") return { status: "not-kept" };
    return { status: input.reason, latestEndDate: input.latestEndDate, eligible: input.eligible };
  }
  const comparison: Extract<SnapshotHistoryComparison, { available: true }> = input;
  return {
    status: "available",
    latestEndDate: comparison.latestEndDate,
    previousEndDate: comparison.previousEndDate,
    gapDays: comparison.gapDays,
    confidence: comparison.coverage.confidence,
    latestState: comparison.latestState,
    previousState: comparison.previousState,
    latestPartial: comparison.coverage.latestPartial,
    previousPartial: comparison.coverage.previousPartial,
    historyUnderOtherProperty: comparison.coverage.otherProperty > 0,
    totals: comparison.totals
      ? {
          clicks: countView(comparison.totals.clicks),
          impressions: countView(comparison.totals.impressions),
          ctr: ctrView(comparison.totals.ctr),
          position: positionView(comparison.totals.position),
          previousNoData: comparison.totals.previousNoData,
        }
      : null,
    queries: listView(comparison.queries),
    pages: listView(comparison.pages),
    caveats: HISTORY_CAVEATS,
  };
}

// ---------------------------------------------------------------------------
// The browser's side: where to ask, and how each answer reads.

/** The history endpoint for one project; the range is fixed to the stored window. */
export function historyUrl(projectId: string): string {
  const params = new URLSearchParams({ project: projectId, range: HISTORY_RANGE_ID });
  return `/api/search-console/history?${params.toString()}`;
}

/** What a refused or failed read means. None of these says the project has no history. */
export function historyReadFailure(httpStatus: number): string {
  if (httpStatus === 401) return "Your session has ended. Reload the page to sign in again.";
  if (httpStatus === 404) return "This project is not stored, so its history was not read.";
  if (httpStatus === 429) return "Too many requests. Wait a moment and refresh.";
  return "Stored history could not be read. The live report above is unaffected.";
}

export type HistoryStatusMessage = { readonly title: string; readonly description: string };

/** The one line for a comparison that does not exist, worded by why. Never a comparison of zeros. */
export function describeHistoryStatus(view: Exclude<HistoryView, { status: "available" }>): HistoryStatusMessage {
  switch (view.status) {
    case "not-kept":
      return { title: "No stored history on this deployment", description: "Snapshots are not kept here, so there is nothing to compare. The live report above stands alone." };
    case "no-snapshots":
      return { title: "No stored snapshots yet", description: "The scheduled capture has not recorded a 30-day window for this project. A comparison needs two, at least a week apart." };
    case "no-history-for-property":
      return { title: "Stored history is for a previous property", description: "This project's snapshots were recorded under another Search Console property. They describe a different site and are not compared." };
    case "insufficient-history":
      return {
        title: view.eligible === 1 ? "One snapshot stored" : "Not enough history to compare",
        description: `${view.eligible === 1 ? "The only" : "The latest"} snapshot ends ${view.latestEndDate ?? "on an unknown date"}. A comparison needs a second window ending at least ${MIN_GAP_DAYS} days earlier.`,
      };
  }
}

/** Why a list has nothing to compare, worded by reason. */
export const LIST_UNAVAILABLE_COPY: Readonly<Record<Extract<ListView, { available: false }>["reason"], string>> = {
  "no-data-latest": "The latest window reported no impressions, so there are no rows to compare.",
  "queries-unavailable": "Top queries were not stored for one of the two windows, so queries are not compared.",
  "pages-unavailable": "Top pages were not stored for one of the two windows, so pages are not compared.",
};

export const CONFIDENCE_COPY: Readonly<Record<"normal" | "low", string>> = {
  normal: "Normal confidence",
  low: `Low confidence: the gap is under ${LOW_CONFIDENCE_GAP_DAYS} days, or one window is partial or reported no impressions.`,
};

export const OPPORTUNITY_RULE_COPY = `Opportunity: at least ${OPPORTUNITY_MIN_IMPRESSIONS} impressions, click-through rate at or under ${OPPORTUNITY_MAX_CTR * 100}%, average position at or under ${OPPORTUNITY_MAX_POSITION}, in the latest window.`;
