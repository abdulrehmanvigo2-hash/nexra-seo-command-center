import type { IntentHint } from "@/lib/search-console/keywords/intent";
import type { KeywordIntelligence } from "@/lib/search-console/keywords/inventory";
import type { OpportunityLabel } from "@/lib/search-console/keywords/thresholds";
import type { StoredQueryPage } from "@/lib/search-console/query-pages/contract";
import { groupQueryPageWindows, selectQueryPageWindows } from "@/lib/search-console/query-pages/select";
import type { SearchConsoleSnapshot } from "@/lib/search-console/snapshots/contract";
import type { SearchPerformance } from "@/types/search-console";

/**
 * A curated keyword's link to what Google reported (checkpoint 3.5),
 * computed on read by exact query text against the stored Search Console
 * rows — the same rule tasks use. Nothing is stored for it, and a keyword
 * that matches nothing reads "not observed in stored rows", never zero. Pure.
 */

export type ObservedLink =
  | {
      readonly state: "observed";
      /** Stored snapshot windows whose top rows listed the query. */
      readonly windows: number;
      readonly inLatestTop: boolean;
      /** The latest window's figures (the snapshot row, else the sum of its latest pairs); null when neither lists it. */
      readonly latest: SearchPerformance | null;
      readonly latestSource: "snapshot" | "pairs" | null;
      readonly intent: IntentHint;
      readonly opportunities: readonly OpportunityLabel[];
    }
  /** Stored rows exist for the project's property, and none of them names this exact query. */
  | { readonly state: "not-observed" }
  /** There are no stored rows to compare with: none kept, none yet, only a previous property's, or they could not be read. */
  | { readonly state: "no-stored-rows"; readonly reason: "not-kept" | "no-snapshots" | "no-history-for-property" | "no-queries" | "unreadable" };

export const NOT_OBSERVED = "Not observed in stored rows";

export const NO_STORED_ROWS_COPY: Readonly<Record<Extract<ObservedLink, { state: "no-stored-rows" }>["reason"], string>> = {
  "not-kept": "No Search Console rows are kept on this deployment",
  "no-snapshots": "No Search Console snapshot is stored for this project yet",
  "no-history-for-property": "Stored rows are for a previous Search Console property",
  "no-queries": "Stored snapshots list no query yet",
  unreadable: "Stored Search Console rows could not be read",
};

/** The link for one exact query against the project's inventory (null: this deployment keeps no snapshots). */
export function observedLinkFor(query: string, inventory: KeywordIntelligence | null | "unreadable"): ObservedLink {
  if (inventory === "unreadable") return { state: "no-stored-rows", reason: "unreadable" };
  if (inventory === null) return { state: "no-stored-rows", reason: "not-kept" };
  if (!inventory.available) return { state: "no-stored-rows", reason: inventory.reason };
  const row = inventory.rows.find((r) => r.query === query);
  if (row === undefined) return { state: "not-observed" };
  return { state: "observed", windows: row.windows, inLatestTop: row.inLatestTop, latest: row.latest, latestSource: row.latestSource, intent: row.intent, opportunities: row.opportunities };
}

export type ObservedWindow = {
  readonly startDate: string;
  readonly endDate: string;
  /**
   * `listed`: the window's top query rows name the query, with Google's figures.
   * `not-in-top-rows`: they do not — the query may still have had impressions below the cut.
   * `no-data`: Google reported no impressions for the window at all.
   * `queries-unavailable`: the window's query rows could not be read when it was captured.
   */
  readonly state: "listed" | "not-in-top-rows" | "no-data" | "queries-unavailable";
  readonly metrics: SearchPerformance | null;
};

export type ObservedPage = SearchPerformance & { readonly page: string };

export type ObservedHistory = {
  /** The project's current property's stored windows, newest first. */
  readonly windows: readonly ObservedWindow[];
  /** Snapshots under another property, set aside. */
  readonly otherProperty: number;
  /** The latest stored pair window for the property, or null when none is stored. */
  readonly pairsEndDate: string | null;
  /** The pages the query appears on in that window, by impressions; empty when it appears on none. */
  readonly pages: readonly ObservedPage[];
};

/** Per-window figures and pages for one exact query, from the project's stored rows. */
export function observedHistoryFor(
  query: string,
  input: { readonly snapshots: readonly SearchConsoleSnapshot[]; readonly pairs: readonly StoredQueryPage[]; readonly pairsReadLimit: number; readonly currentProperty: string },
): ObservedHistory {
  const own = input.snapshots
    .filter((s) => s.property === input.currentProperty)
    .sort((a, b) => b.endDate.localeCompare(a.endDate) || b.capturedAt.localeCompare(a.capturedAt));
  const seenEnds = new Set<string>();
  const windows: ObservedWindow[] = [];
  for (const snapshot of own) {
    if (seenEnds.has(snapshot.endDate)) continue;
    seenEnds.add(snapshot.endDate);
    const base = { startDate: snapshot.startDate, endDate: snapshot.endDate };
    if (snapshot.state !== "connected") windows.push({ ...base, state: "no-data", metrics: null });
    else if (snapshot.partial.includes("queries-unavailable")) windows.push({ ...base, state: "queries-unavailable", metrics: null });
    else {
      const row = snapshot.queries.find((q) => q.key === query);
      windows.push(row ? { ...base, state: "listed", metrics: { clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position } } : { ...base, state: "not-in-top-rows", metrics: null });
    }
  }

  const selection = selectQueryPageWindows(groupQueryPageWindows(input.pairs, input.pairsReadLimit), input.currentProperty);
  const latestPairs = selection.ok ? selection.latest : null;
  const pages = (latestPairs?.rows ?? [])
    .filter((row) => row.query === query)
    .map((row) => ({ page: row.page, clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position }))
    .sort((a, b) => b.impressions - a.impressions || a.page.localeCompare(b.page));

  return { windows, otherProperty: input.snapshots.length - own.length, pairsEndDate: latestPairs?.endDate ?? null, pages };
}
