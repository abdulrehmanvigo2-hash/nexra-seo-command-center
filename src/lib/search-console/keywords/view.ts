import { HISTORY_KEY_MAX, HISTORY_RANGE_ID } from "@/lib/search-console/history/view";
import type { IntentHint } from "@/lib/search-console/keywords/intent";
import { INTENT_PROVENANCE } from "@/lib/search-console/keywords/intent";
import type { KeywordIntelligenceInput, ObservedQuery, PageMapping } from "@/lib/search-console/keywords/inventory";
import {
  BAND_MAX_POSITION,
  BAND_MIN_IMPRESSIONS,
  BAND_MIN_POSITION,
  HUB_MIN_QUERIES,
  MAX_GROUPS,
  MAX_HUBS,
  MAX_INVENTORY_ROWS,
  MAX_QUERIES_PER_GROUP,
  OPPORTUNITY_LABEL_META,
  OPPORTUNITY_MAX_CTR,
  OPPORTUNITY_MAX_POSITION,
  OPPORTUNITY_MIN_IMPRESSIONS,
  WEAK_LEAD_MAX_SHARE,
  type OpportunityLabel,
} from "@/lib/search-console/keywords/thresholds";
import { QUERY_PAGE_ROW_LIMIT } from "@/lib/search-console/query-pages/contract";
import { SNAPSHOT_MAX_ROWS } from "@/lib/search-console/snapshots/contract";
import type { SearchPerformance } from "@/types/search-console";

/**
 * The observed query inventory, as the operator's screen may see it
 * (milestone M4). A projection of the inventory to what a panel needs and
 * nothing the browser should hold: no property name, no row id, no full
 * pair list. At most MAX_INVENTORY_ROWS rows, MAX_GROUPS groups and
 * MAX_HUBS hubs, with the true counts beside them; every figure is the
 * inventory's own arithmetic, passed through. The caveats are fixed
 * sentences the section always shows. Pure and client-safe: no store, no
 * server import, so the component can share the URL and the wording with
 * the route.
 */

export const KEYWORDS_VIEW_RANGE_ID = HISTORY_RANGE_ID;

export type MappingView =
  | { readonly state: "no-pairs" }
  | { readonly state: "single-page"; readonly leadingPage: string }
  | { readonly state: "overlap"; readonly leadingPage: string; readonly leadingShare: number; readonly pageCount: number; readonly candidate: boolean };

export type ObservedQueryView = {
  readonly query: string;
  readonly windows: number;
  readonly inLatestTop: boolean;
  readonly latest: SearchPerformance | null;
  readonly latestSource: "snapshot" | "pairs" | null;
  readonly intent: IntentHint;
  readonly intentMarker: string | null;
  readonly group: string | null;
  readonly mapping: MappingView;
  readonly opportunities: readonly OpportunityLabel[];
};

export type KeywordInventoryView = {
  readonly status: "inventory";
  readonly latestEndDate: string;
  readonly latestState: "connected" | "no-data";
  readonly snapshotsUsed: number;
  readonly pairsEndDate: string | null;
  readonly underOtherProperty: boolean;
  readonly rows: readonly ObservedQueryView[];
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
    readonly groups: number;
    readonly hubs: number;
  };
  readonly groups: readonly { readonly term: string; readonly queryCount: number; readonly queries: readonly string[] }[];
  readonly hubs: readonly { readonly page: string; readonly queries: number; readonly impressions: number; readonly clicks: number }[];
  readonly caveats: readonly string[];
};

export type KeywordIntelligenceView =
  | KeywordInventoryView
  | { readonly status: "no-snapshots" | "no-history-for-property" | "no-queries" }
  /** This deployment keeps no snapshots. */
  | { readonly status: "not-kept" };

export const KEYWORD_CAVEATS: readonly string[] = [
  `Observed queries are what Google reported in this product's stored Search Console rows: each snapshot's top ${SNAPSHOT_MAX_ROWS} queries by clicks and the latest window's top ${QUERY_PAGE_ROW_LIMIT} query × page pairs. Anonymised queries are absent and the sets are cut by clicks, so this is never the property's whole demand, and a query absent here is unobserved, not absent.`,
  `Intent is a ${INTENT_PROVENANCE}. Lexical groups share a word, not necessarily a topic. Both are derived labels for review; Search Console records what was typed, never why.`,
  `Opportunity labels are fixed rules over stored figures and name candidates for a person's review, never predicted wins: low CTR (at least ${OPPORTUNITY_MIN_IMPRESSIONS} impressions, CTR at most ${(OPPORTUNITY_MAX_CTR * 100).toFixed(0)}%, position within ${OPPORTUNITY_MAX_POSITION}), position band (${BAND_MIN_POSITION} to ${BAND_MAX_POSITION} with at least ${BAND_MIN_IMPRESSIONS} impressions), no strong landing page (leading page under ${(WEAK_LEAD_MAX_SHARE * 100).toFixed(0)}% of the query's impressions across two or more pages), and the P4c cannibalization candidate rule. A page hub is a page under at least ${HUB_MIN_QUERIES} observed queries in the pairs.`,
  "The leading page is the page shown most for the query in the stored pairs; a single page observed does not prove Google shows the query nowhere else, and no page owns a query. Average position is Search Console's impression-weighted average, not a rank tracker's reading. There is no search volume, keyword difficulty, cost per click, SERP feature, indexation or competitor data here, and nothing is estimated in their place.",
];

const cutKey = (key: string) => (key.length > HISTORY_KEY_MAX ? key.slice(0, HISTORY_KEY_MAX) : key);

function mappingView(mapping: PageMapping): MappingView {
  switch (mapping.state) {
    case "no-pairs":
      return { state: "no-pairs" };
    case "single-page":
      return { state: "single-page", leadingPage: cutKey(mapping.leadingPage) };
    case "overlap":
      return { state: "overlap", leadingPage: cutKey(mapping.leadingPage), leadingShare: mapping.leadingShare, pageCount: mapping.pages.length, candidate: mapping.candidate };
  }
}

function rowView(row: ObservedQuery): ObservedQueryView {
  return {
    query: cutKey(row.query),
    windows: row.windows,
    inLatestTop: row.inLatestTop,
    latest: row.latest,
    latestSource: row.latestSource,
    intent: row.intent,
    intentMarker: row.intentMarker,
    group: row.group,
    mapping: mappingView(row.mapping),
    opportunities: row.opportunities,
  };
}

export function presentKeywordIntelligence(input: KeywordIntelligenceInput | null): KeywordIntelligenceView {
  if (input === null) return { status: "not-kept" };
  if (!input.available) {
    if (input.reason === "not-kept" || input.reason === "read-failed") return { status: "not-kept" };
    return { status: input.reason };
  }
  return {
    status: "inventory",
    latestEndDate: input.latestEndDate,
    latestState: input.latestState,
    snapshotsUsed: input.snapshotsUsed,
    pairsEndDate: input.pairsEndDate,
    underOtherProperty: input.otherProperty > 0,
    rows: input.rows.slice(0, MAX_INVENTORY_ROWS).map(rowView),
    counts: { ...input.counts, groups: input.groups.length, hubs: input.hubs.length },
    groups: input.groups.slice(0, MAX_GROUPS).map((group) => ({ term: group.term, queryCount: group.queryCount, queries: group.queries.slice(0, MAX_QUERIES_PER_GROUP).map(cutKey) })),
    hubs: input.hubs.slice(0, MAX_HUBS).map((hub) => ({ page: cutKey(hub.page), queries: hub.queries, impressions: hub.impressions, clicks: hub.clicks })),
    caveats: KEYWORD_CAVEATS,
  };
}

// ---------------------------------------------------------------------------
// The browser's side: where to ask, and how each answer reads.

export function keywordsUrl(projectId: string): string {
  const params = new URLSearchParams({ project: projectId, range: KEYWORDS_VIEW_RANGE_ID });
  return `/api/search-console/keywords?${params.toString()}`;
}

/** What a refused or failed read means. None of these says the project has no queries. */
export function keywordsReadFailure(httpStatus: number): string {
  if (httpStatus === 401) return "Your session has ended. Reload the page to sign in again.";
  if (httpStatus === 404) return "This project is not stored, so its observed queries were not read.";
  if (httpStatus === 429) return "Too many requests. Wait a moment and refresh.";
  return "Stored Search Console rows could not be read. The live report above is unaffected.";
}

export type KeywordStatusMessage = { readonly title: string; readonly description: string };

export function describeKeywordStatus(view: Exclude<KeywordIntelligenceView, { status: "inventory" }>): KeywordStatusMessage {
  switch (view.status) {
    case "not-kept":
      return { title: "No stored Search Console rows on this deployment", description: "Snapshots are not kept here, so no observed query inventory can be derived. The live report above stands alone." };
    case "no-snapshots":
      return { title: "No stored snapshot yet", description: "The scheduled capture has not recorded a Search Console snapshot for this project. The inventory is derived from stored snapshots and pairs, so there is nothing to derive it from yet." };
    case "no-history-for-property":
      return { title: "Stored rows are for a previous property", description: "This project's snapshots were recorded under another Search Console property. They describe a different site and are not analysed." };
    case "no-queries":
      return { title: "No observed query yet", description: "Stored snapshots exist for this property, but none of them lists a query and no query × page pair is stored. This says nothing about the site's demand; Google reported no top rows in those windows." };
  }
}

export const INTENT_LABEL: Readonly<Record<IntentHint, string>> = {
  informational: "Informational",
  commercial: "Commercial",
  transactional: "Transactional",
  navigational: "Navigational",
  local: "Local",
  mixed: "Mixed",
  unclassified: "Unclassified",
};

export const OPPORTUNITY_LABEL = OPPORTUNITY_LABEL_META;
