import { selectComparableSnapshots } from "@/lib/search-console/history/select";
import { groupQueries, type LexicalGroup } from "@/lib/search-console/keywords/groups";
import { intentHintOf, type IntentHint } from "@/lib/search-console/keywords/intent";
import {
  BAND_MAX_POSITION,
  BAND_MIN_IMPRESSIONS,
  BAND_MIN_POSITION,
  HUB_MIN_QUERIES,
  isOpportunity,
  OPPORTUNITY_LABELS,
  WEAK_LEAD_MAX_SHARE,
  type OpportunityLabel,
} from "@/lib/search-console/keywords/thresholds";
import { analyseQueryPages } from "@/lib/search-console/query-pages/analyse";
import type { StoredQueryPage } from "@/lib/search-console/query-pages/contract";
import { groupQueryPageWindows, selectQueryPageWindows } from "@/lib/search-console/query-pages/select";
import type { SearchConsoleSnapshot } from "@/lib/search-console/snapshots/contract";
import type { SearchPerformance } from "@/types/search-console";

/**
 * A project's observed query inventory (milestone M4), derived on read from
 * what this product already stores from Search Console: the top queries of
 * every stored snapshot for the property the project is mapped to now (M1
 * CP1a) and the latest stored query × page window (M1 P4c). No new table:
 * a query is an entity here because Google reported it, and the inventory
 * is recomputed from the immutable rows every time.
 *
 * Pure and deterministic. Every figure is arithmetic over stored rows;
 * every label follows the constants in `thresholds.ts`; the intent hint and
 * the lexical group are derived from the query's own words and say so.
 * The rows are sorted by the latest window's impressions, then clicks, then
 * query text, and nothing is cut here: the counts are the true counts, and a
 * reader that shows fewer says how many there are.
 *
 * What it is not: the property's whole demand (snapshots keep the top 25
 * queries by clicks, pair windows the top 250 pairs, and anonymised queries
 * are absent), a rank tracker (average position is Search Console's
 * impression-weighted average), a search-volume, difficulty or cost source
 * (none exists here), or a classification of any searcher.
 */

export type QueryMetricsSource = "snapshot" | "pairs";

export type ObservedPage = SearchPerformance & {
  readonly page: string;
  /** This page's share of the query's impressions across its stored pages, four decimals. */
  readonly share: number;
};

export type PageMapping =
  /** The latest pair window holds no pair for this query. */
  | { readonly state: "no-pairs" }
  /** One page in the set. Google may show others the set did not return. */
  | { readonly state: "single-page"; readonly leadingPage: string; readonly pages: readonly ObservedPage[] }
  /** Two or more pages in the set: P4c's potential query overlap, candidate or not. */
  | { readonly state: "overlap"; readonly leadingPage: string; readonly leadingShare: number; readonly pages: readonly ObservedPage[]; readonly candidate: boolean };

export type ObservedQuery = {
  readonly query: string;
  /** Stored snapshot windows whose top rows listed the query, with the earliest and latest window end. */
  readonly windows: number;
  readonly firstSeenEndDate: string | null;
  readonly lastSeenEndDate: string | null;
  /** Whether the latest snapshot's top rows list the query. */
  readonly inLatestTop: boolean;
  /** The latest window's figures: the snapshot row when the query is in the latest top rows, else the sum of its pairs. */
  readonly latest: SearchPerformance | null;
  readonly latestSource: QueryMetricsSource | null;
  readonly intent: IntentHint;
  readonly intentMarker: string | null;
  /** The lexical group's term, or null when ungrouped. */
  readonly group: string | null;
  readonly mapping: PageMapping;
  readonly opportunities: readonly OpportunityLabel[];
};

export type PageHub = {
  readonly page: string;
  /** Distinct observed queries the page appears under in the latest pair window. */
  readonly queries: number;
  readonly impressions: number;
  readonly clicks: number;
};

export type KeywordInventory = {
  readonly available: true;
  readonly property: string;
  /** The latest snapshot window end for the current property. */
  readonly latestEndDate: string;
  readonly latestState: SearchConsoleSnapshot["state"];
  /** Snapshots of the current property that contributed queries. */
  readonly snapshotsUsed: number;
  /** Snapshots under another property, set aside. */
  readonly otherProperty: number;
  /** The latest pair window's end, or null when no pairs are stored for the property. */
  readonly pairsEndDate: string | null;
  readonly rows: readonly ObservedQuery[];
  readonly counts: {
    readonly queries: number;
    readonly inLatestTop: number;
    readonly withPairs: number;
    readonly byIntent: Readonly<Record<IntentHint, number>>;
    readonly byOpportunity: Readonly<Record<OpportunityLabel, number>>;
    readonly overlaps: number;
    readonly candidates: number;
    readonly grouped: number;
    readonly ungrouped: number;
  };
  readonly groups: readonly LexicalGroup[];
  readonly hubs: readonly PageHub[];
};

export type KeywordIntelligence =
  | KeywordInventory
  | {
      readonly available: false;
      readonly reason:
        /** The project has no stored snapshot at all. */
        | "no-snapshots"
        /** Snapshots exist only under a previous property. */
        | "no-history-for-property"
        /** Snapshots exist for the property, but none of them lists a query and no pair is stored. */
        | "no-queries";
      readonly otherProperty: number;
    };

/** The reader's full input, including the two states only the server wiring can produce. */
export type KeywordIntelligenceInput =
  | KeywordIntelligence
  /** This deployment keeps no snapshots (fixture data source). */
  | { readonly available: false; readonly reason: "not-kept" }
  /** The stored rows could not be read. */
  | { readonly available: false; readonly reason: "read-failed" };

export type KeywordInventoryInput = {
  readonly snapshots: readonly SearchConsoleSnapshot[];
  readonly pairs: readonly StoredQueryPage[];
  /** The store's read ceiling for pairs, so a cut oldest window is dropped as P4c drops it. */
  readonly pairsReadLimit: number;
  readonly currentProperty: string;
  readonly brandTokens: readonly string[];
};

const round = (value: number, decimals: number) => Number(value.toFixed(decimals));

const INTENTS: readonly IntentHint[] = ["informational", "commercial", "transactional", "navigational", "local", "mixed", "unclassified"];

function newestFirst(a: SearchConsoleSnapshot, b: SearchConsoleSnapshot): number {
  return b.endDate.localeCompare(a.endDate) || b.capturedAt.localeCompare(a.capturedAt) || a.id.localeCompare(b.id);
}

function opportunitiesOf(latest: SearchPerformance | null, mapping: PageMapping): OpportunityLabel[] {
  const labels: OpportunityLabel[] = [];
  if (latest !== null && latest.impressions > 0) {
    if (isOpportunity(latest)) labels.push("low-ctr");
    if (latest.position >= BAND_MIN_POSITION && latest.position <= BAND_MAX_POSITION && latest.impressions >= BAND_MIN_IMPRESSIONS) labels.push("position-band");
  }
  if (mapping.state === "overlap") {
    if (mapping.leadingShare < WEAK_LEAD_MAX_SHARE) labels.push("weak-lead");
    if (mapping.candidate) labels.push("cannibalization-candidate");
  }
  return labels;
}

export function buildKeywordInventory(input: KeywordInventoryInput): KeywordIntelligence {
  const { currentProperty } = input;
  // The same property rule as P4a and P4c: rows under a previous property describe another site.
  const selection = selectComparableSnapshots(input.snapshots, currentProperty);
  const own = input.snapshots.filter((s) => s.property === currentProperty).sort(newestFirst);
  const otherProperty = input.snapshots.length - own.length;
  if (own.length === 0) {
    return { available: false, reason: selection.ok || selection.reason === "insufficient-history" ? "no-snapshots" : selection.reason, otherProperty };
  }
  const latestSnapshot = own[0];

  // 1. Queries from every stored snapshot's top rows.
  type Seen = { windows: number; first: string; last: string; latest: SearchPerformance | null };
  const seen = new Map<string, Seen>();
  let snapshotsUsed = 0;
  for (const snapshot of own) {
    if (snapshot.state !== "connected" || snapshot.partial.includes("queries-unavailable") || snapshot.queries.length === 0) continue;
    snapshotsUsed += 1;
    for (const row of snapshot.queries) {
      const entry = seen.get(row.key);
      const isLatest = snapshot === latestSnapshot;
      const metrics = { clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position };
      if (entry) {
        entry.windows += 1;
        if (snapshot.endDate < entry.first) entry.first = snapshot.endDate;
        if (snapshot.endDate > entry.last) entry.last = snapshot.endDate;
        if (isLatest) entry.latest = metrics;
      } else {
        seen.set(row.key, { windows: 1, first: snapshot.endDate, last: snapshot.endDate, latest: isLatest ? metrics : null });
      }
    }
  }

  // 2. The latest stored pair window for the property, analysed by the P4c rules.
  const pairSelection = selectQueryPageWindows(groupQueryPageWindows(input.pairs, input.pairsReadLimit), currentProperty);
  const pairWindow = pairSelection.ok ? pairSelection.latest : null;
  const analysis = pairWindow ? analyseQueryPages(pairWindow.rows) : null;
  const overlapByQuery = new Map(analysis ? analysis.overlaps.map((o) => [o.query, o]) : []);
  const pairsByQuery = new Map<string, StoredQueryPage[]>();
  const pageStats = new Map<string, { queries: Set<string>; impressions: number; clicks: number }>();
  if (pairWindow) {
    const dedupe = new Set<string>();
    for (const row of pairWindow.rows) {
      const key = `${row.query}\n${row.page}`;
      if (dedupe.has(key)) continue;
      dedupe.add(key);
      const list = pairsByQuery.get(row.query);
      if (list) list.push(row as StoredQueryPage);
      else pairsByQuery.set(row.query, [row as StoredQueryPage]);
      const stats = pageStats.get(row.page) ?? { queries: new Set<string>(), impressions: 0, clicks: 0 };
      stats.queries.add(row.query);
      stats.impressions += row.impressions;
      stats.clicks += row.clicks;
      pageStats.set(row.page, stats);
    }
  }

  const queries = new Set<string>([...seen.keys(), ...pairsByQuery.keys()]);
  if (queries.size === 0) return { available: false, reason: "no-queries", otherProperty };

  const grouping = groupQueries([...queries].sort());

  const rows: ObservedQuery[] = [];
  for (const query of queries) {
    const entry = seen.get(query);
    const pairs = pairsByQuery.get(query);

    let mapping: PageMapping = { state: "no-pairs" };
    let pairTotals: SearchPerformance | null = null;
    if (pairs && pairs.length > 0) {
      const sorted = [...pairs].sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks || a.page.localeCompare(b.page));
      const impressions = sorted.reduce((sum, row) => sum + row.impressions, 0);
      const clicks = sorted.reduce((sum, row) => sum + row.clicks, 0);
      const pages: ObservedPage[] = sorted.map((row) => ({
        page: row.page,
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position,
        share: impressions > 0 ? round(row.impressions / impressions, 4) : 0,
      }));
      // Summed pairs: an impression-weighted position over the pages, as Search Console itself averages.
      pairTotals = {
        clicks,
        impressions,
        ctr: impressions > 0 ? round(clicks / impressions, 4) : 0,
        position: impressions > 0 ? round(sorted.reduce((sum, row) => sum + row.position * row.impressions, 0) / impressions, 1) : 0,
      };
      const overlap = overlapByQuery.get(query);
      mapping =
        overlap && sorted.length >= 2
          ? { state: "overlap", leadingPage: overlap.leadingPage, leadingShare: overlap.leadingShare, pages, candidate: overlap.candidate }
          : { state: "single-page", leadingPage: pages[0].page, pages };
    }

    const inLatestTop = entry?.latest !== null && entry?.latest !== undefined;
    const latest = inLatestTop ? entry!.latest : pairTotals;
    const latestSource: QueryMetricsSource | null = inLatestTop ? "snapshot" : pairTotals ? "pairs" : null;
    const hint = intentHintOf(query, input.brandTokens);

    rows.push({
      query,
      windows: entry?.windows ?? 0,
      firstSeenEndDate: entry?.first ?? null,
      lastSeenEndDate: entry?.last ?? null,
      inLatestTop,
      latest,
      latestSource,
      intent: hint.intent,
      intentMarker: hint.marker,
      group: grouping.termOf.get(query) ?? null,
      mapping,
      opportunities: opportunitiesOf(latest, mapping),
    });
  }
  rows.sort((a, b) => (b.latest?.impressions ?? -1) - (a.latest?.impressions ?? -1) || (b.latest?.clicks ?? -1) - (a.latest?.clicks ?? -1) || a.query.localeCompare(b.query));

  const byIntent = Object.fromEntries(INTENTS.map((intent) => [intent, 0])) as Record<IntentHint, number>;
  const byOpportunity = Object.fromEntries(OPPORTUNITY_LABELS.map((label) => [label, 0])) as Record<OpportunityLabel, number>;
  for (const row of rows) {
    byIntent[row.intent] += 1;
    for (const label of row.opportunities) byOpportunity[label] += 1;
  }

  const hubs: PageHub[] = [...pageStats]
    .filter(([, stats]) => stats.queries.size >= HUB_MIN_QUERIES)
    .map(([page, stats]) => ({ page, queries: stats.queries.size, impressions: stats.impressions, clicks: stats.clicks }))
    .sort((a, b) => b.queries - a.queries || b.impressions - a.impressions || a.page.localeCompare(b.page));

  return {
    available: true,
    property: currentProperty,
    latestEndDate: latestSnapshot.endDate,
    latestState: latestSnapshot.state,
    snapshotsUsed,
    otherProperty,
    pairsEndDate: pairWindow?.endDate ?? null,
    rows,
    counts: {
      queries: rows.length,
      inLatestTop: rows.filter((row) => row.inLatestTop).length,
      withPairs: rows.filter((row) => row.mapping.state !== "no-pairs").length,
      byIntent,
      byOpportunity,
      overlaps: analysis?.overlapCount ?? 0,
      candidates: analysis?.candidateCount ?? 0,
      grouped: grouping.termOf.size,
      ungrouped: grouping.ungrouped,
    },
    groups: grouping.groups,
    hubs,
  };
}
