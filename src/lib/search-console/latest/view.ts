import type { IconName } from "@/components/icons";
import { formatFullDate, formatNumber, formatPercent } from "@/lib/format";
import { daysBetween } from "@/lib/search-console/history/select";
import { MIN_GAP_DAYS } from "@/lib/search-console/history/thresholds";
import type { SearchConsoleSnapshot, SnapshotPartial, SnapshotState } from "@/lib/search-console/snapshots/contract";

/**
 * The latest stored Search Console window for one project (Phase 4,
 * checkpoint 4.3, decision Q6): what the Analytics tiles show.
 *
 * The tiles read the one newest snapshot of the property the project is
 * mapped to now, exactly as the scheduled capture stored it — Google's
 * clicks, impressions, click-through rate and average position for that
 * 30-day window. No delta, no trend and no second window: a comparison is
 * the stored-history section's job (P4a/P4d), and until two windows at least
 * MIN_GAP_DAYS apart exist this view says when the first could. Snapshots
 * of another property are set aside, never mixed in (the P4a rule). The view
 * never carries the property, a snapshot id or a stored row list. Pure and
 * client-safe.
 */

export type LatestWindowTotals = {
  readonly clicks: number;
  readonly impressions: number;
  /** A fraction, 0–1, as Google reported it. */
  readonly ctr: number;
  readonly position: number;
};

export type LatestWindowView =
  | {
      readonly status: "window";
      /** Inclusive ISO dates of the latest stored window. */
      readonly startDate: string;
      readonly endDate: string;
      readonly state: SnapshotState;
      /** Null for a no-data window: Google reported no impressions. */
      readonly totals: LatestWindowTotals | null;
      readonly partial: readonly SnapshotPartial[];
      /** When the scheduled capture wrote the row, ISO timestamp. */
      readonly capturedAt: string;
      /** Stored windows of the current property. */
      readonly storedWindows: number;
      readonly oldestEndDate: string;
      /** The earliest window end a first comparison can use: the oldest stored end plus MIN_GAP_DAYS. */
      readonly firstComparableEndDate: string;
      /** Whether two stored windows at least MIN_GAP_DAYS apart exist now. */
      readonly comparable: boolean;
    }
  /** The project has no stored snapshot, or none for the property it is mapped to now. */
  | { readonly status: "no-snapshots" | "no-history-for-property" }
  /** This deployment keeps no snapshots. */
  | { readonly status: "not-kept" };

const DAY_MS = 86_400_000;

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function newestFirst(a: SearchConsoleSnapshot, b: SearchConsoleSnapshot): number {
  return b.endDate.localeCompare(a.endDate) || b.capturedAt.localeCompare(a.capturedAt) || a.id.localeCompare(b.id);
}

export function presentLatestWindow(snapshots: readonly SearchConsoleSnapshot[], currentProperty: string): LatestWindowView {
  if (snapshots.length === 0) return { status: "no-snapshots" };
  const own = snapshots.filter((s) => s.property === currentProperty).sort(newestFirst);
  if (own.length === 0) return { status: "no-history-for-property" };
  const latest = own[0];
  const oldest = own[own.length - 1];
  const totals =
    latest.state === "connected" && latest.totals !== null
      ? { clicks: latest.totals.clicks, impressions: latest.totals.impressions, ctr: latest.totals.ctr, position: latest.totals.position }
      : null;
  return {
    status: "window",
    startDate: latest.startDate,
    endDate: latest.endDate,
    state: latest.state,
    totals,
    partial: [...latest.partial],
    capturedAt: latest.capturedAt,
    storedWindows: own.length,
    oldestEndDate: oldest.endDate,
    firstComparableEndDate: addDays(oldest.endDate, MIN_GAP_DAYS),
    comparable: daysBetween(oldest.endDate, latest.endDate) >= MIN_GAP_DAYS,
  };
}

export const POSITION_NOT_RANK = "Search Console average position, not rank";
export const LATEST_WINDOW_FOOTER = "Observed in stored Search Console snapshots · latest window only";
/** Checkpoint 4.8: the tiles and the Search Console panel beneath them can show different windows. */
export const STORED_VS_LIVE_NOTE =
  "These tiles show the latest stored window; the Search Console panel below reads Google's live report, so its window can end later and its figures differ.";

export type LatestWindowTile = {
  readonly id: "clicks" | "impressions" | "ctr" | "position";
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly icon: IconName;
};

/** The four tiles, formatted; null when the window has no totals to show. */
export function latestWindowTiles(view: Extract<LatestWindowView, { status: "window" }>): readonly LatestWindowTile[] | null {
  const totals = view.totals;
  if (totals === null) return null;
  return [
    { id: "clicks", label: "Clicks", value: formatNumber(totals.clicks), detail: "Google-reported clicks in the window", icon: "target" },
    { id: "impressions", label: "Impressions", value: formatNumber(totals.impressions), detail: "Times a result from the property was shown", icon: "search" },
    { id: "ctr", label: "Click-through rate", value: formatPercent(totals.ctr * 100, 2), detail: "Clicks divided by impressions, as Google reported", icon: "activity" },
    {
      id: "position",
      label: "Average position",
      value: totals.impressions > 0 ? totals.position.toFixed(1) : "—",
      detail: POSITION_NOT_RANK,
      icon: "gauge",
    },
  ];
}

/** "Latest stored window 25 Aug 2026 – 23 Sep 2026 · captured 27 Sep 2026 · 3 stored windows" */
export function latestWindowLine(view: Extract<LatestWindowView, { status: "window" }>): string {
  const partial = view.partial.length > 0 ? ` · partial: ${view.partial.map((p) => (p === "queries-unavailable" ? "queries unavailable" : "pages unavailable")).join(", ")}` : "";
  const noData = view.state === "no-data" ? " · Google reported no impressions" : "";
  return `Latest stored window ${formatFullDate(view.startDate)} – ${formatFullDate(view.endDate)} · captured ${formatFullDate(view.capturedAt)} · ${view.storedWindows} stored ${view.storedWindows === 1 ? "window" : "windows"}${noData}${partial}`;
}

/**
 * Whether the stored-history comparison can run yet, and when it first could.
 * "Insufficient" until a stored window ends at least MIN_GAP_DAYS after the
 * oldest one; the date is the earliest window end that qualifies, not a
 * promise of when the scheduled capture records it.
 */
export function comparisonReadiness(view: Extract<LatestWindowView, { status: "window" }>): string {
  if (view.comparable) {
    return `Stored history is sufficient: two windows at least ${MIN_GAP_DAYS} days apart are stored, and the comparison below reads them.`;
  }
  return `Stored history is insufficient to compare: the oldest stored window ends ${formatFullDate(view.oldestEndDate)} and the latest ${formatFullDate(view.endDate)}. A comparison needs two windows at least ${MIN_GAP_DAYS} days apart — the first possible is a window ending ${formatFullDate(view.firstComparableEndDate)} or later, once the scheduled capture stores it.`;
}

export function describeLatestWindow(view: Exclude<LatestWindowView, { status: "window" }>): { readonly title: string; readonly description: string } {
  switch (view.status) {
    case "not-kept":
      return { title: "No stored snapshots on this deployment", description: "Snapshots are not kept here, so there is no stored window to show." };
    case "no-snapshots":
      return { title: "No stored window yet", description: "The scheduled capture has not recorded a 30-day window for this project." };
    case "no-history-for-property":
      return { title: "No stored window for the current property", description: "Stored windows exist only under a property this project no longer maps to; they are set aside, not shown." };
  }
}

export function latestWindowUrl(projectId: string): string {
  return `/api/search-console/latest-window?${new URLSearchParams({ project: projectId }).toString()}`;
}

/** Why the read failed — never worded as "no data". */
export function latestWindowReadFailure(status: number): string {
  if (status === 401) return "Sign in again to read the stored window.";
  if (status === 404) return "This project is not stored on this server.";
  if (status === 400) return "The stored window could not be requested for this project.";
  return "The stored window could not be read. This is a read failure, not an empty window.";
}
