import { formatFullDate } from "@/lib/format";
import type { IntentHint } from "@/lib/search-console/keywords/intent";
import { OPPORTUNITY_LABELS, OPPORTUNITY_LABEL_META, type OpportunityLabel } from "@/lib/search-console/keywords/thresholds";
import type { KeywordInventoryView, ObservedQueryView } from "@/lib/search-console/keywords/view";

/**
 * The Keyword Intelligence screen over observed data only (Phase 3,
 * checkpoint 3.4).
 *
 * One read answers the Keywords, Groups and Opportunities tabs: the M4
 * observed query inventory (`GET /api/search-console/keywords`). Movement
 * and Cannibalisation read their own existing endpoints (P4a/P4d stored
 * history, P4c query × page pairs). Nothing here is the modelled keyword
 * universe: no volume, difficulty, cost per click, potential, SERP feature,
 * predicted upside or target CTR, because this product holds nothing to
 * back them. Every figure is Google's, from the stored rows; every label is
 * derived by fixed rules and says so. Pure and client-safe.
 */

export const KEYWORD_TABS = [
  { id: "keywords", label: "Keywords", icon: "keywords" },
  // The id stays "clusters" so earlier deep links land here; the content is lexical groups.
  { id: "clusters", label: "Groups", icon: "layers" },
  { id: "opportunities", label: "Opportunities", icon: "target" },
  { id: "movement", label: "Movement", icon: "activity" },
  { id: "cannibalization", label: "Cannibalisation", icon: "split" },
] as const;

export type KeywordTabId = (typeof KEYWORD_TABS)[number]["id"];

/**
 * Tabs the modelled screen had and this one does not show (decision Q1):
 * content gap, competitors, SERP and AI search need data this product does
 * not hold; lists wait for the curated keyword entity (checkpoint 3.5).
 */
export const HIDDEN_KEYWORD_TABS: readonly string[] = ["gaps", "competitors", "serp", "ai", "lists"];

/** A deep link's `?tab=`; an unknown or hidden tab opens the Keywords tab. */
export function resolveKeywordTab(param: string | null): KeywordTabId {
  return KEYWORD_TABS.some((tab) => tab.id === param) ? (param as KeywordTabId) : "keywords";
}

export const OBSERVED_FOOTER = "Observed in stored Search Console rows · derived labels";
export const POSITION_NOTE = "Search Console average position, not rank";
export const MOVEMENT_NOTE = "Change between two stored windows, not a trend.";
export const GROUP_NOTE = "a shared word, not a topic";
export const CANNIBALIZATION_NOTE = "Candidates for review from the stored query × page pairs, never a confirmed cannibalisation.";

export type KeywordScreenFilters = {
  readonly search: string;
  readonly intent: IntentHint | "all";
  readonly opportunity: OpportunityLabel | "all";
};

export const EMPTY_KEYWORD_SCREEN_FILTERS: KeywordScreenFilters = { search: "", intent: "all", opportunity: "all" };

export function hasKeywordScreenFilters(filters: KeywordScreenFilters): boolean {
  return filters.search.trim().length > 0 || filters.intent !== "all" || filters.opportunity !== "all";
}

export type PositionBucketId = "top-3" | "4-10" | "11-20" | "21-50" | "over-50" | "none";

export const POSITION_BUCKETS: readonly { readonly id: PositionBucketId; readonly label: string; readonly max: number }[] = [
  { id: "top-3", label: "1–3", max: 3 },
  { id: "4-10", label: "4–10", max: 10 },
  { id: "11-20", label: "11–20", max: 20 },
  { id: "21-50", label: "21–50", max: 50 },
  { id: "over-50", label: "Over 50", max: Number.POSITIVE_INFINITY },
];

/** The bucket of a row's latest average position; "none" when the latest window reported no impressions for it. */
export function positionBucketOf(row: Pick<ObservedQueryView, "latest">): PositionBucketId {
  const latest = row.latest;
  if (latest === null || latest.impressions <= 0) return "none";
  return POSITION_BUCKETS.find((bucket) => latest.position <= bucket.max)!.id;
}

export type OpportunityGroup = {
  readonly label: OpportunityLabel;
  readonly title: string;
  readonly description: string;
  readonly rows: readonly ObservedQueryView[];
};

export type KeywordScreen = {
  /** Rows matching the filters, in the inventory's order. */
  readonly rows: readonly ObservedQueryView[];
  readonly portfolio: {
    readonly buckets: readonly { readonly id: PositionBucketId; readonly label: string; readonly count: number }[];
    readonly intents: readonly { readonly intent: IntentHint; readonly count: number }[];
    /** Rows the buckets and intent counts are taken over (the shown rows, not every observed query). */
    readonly over: number;
    readonly observed: number;
  };
  readonly groups: KeywordInventoryView["groups"];
  readonly opportunities: readonly OpportunityGroup[];
  readonly tabCounts: Readonly<Partial<Record<KeywordTabId, number>>>;
  readonly filterCounts: {
    readonly intent: Readonly<Partial<Record<IntentHint, number>>>;
    readonly opportunity: Readonly<Record<OpportunityLabel, number>>;
  };
  /** What stored windows the screen read. */
  readonly windows: string;
};

const dateOf = (iso: string) => formatFullDate(`${iso}T00:00:00Z`);

/** The stored windows the inventory was derived from, in one line. */
export function windowsLine(view: KeywordInventoryView): string {
  const snapshots = `${view.snapshotsUsed} stored snapshot window${view.snapshotsUsed === 1 ? "" : "s"} listed queries, the latest ending ${dateOf(view.latestEndDate)}${view.latestState === "no-data" ? " (no impressions reported)" : ""}`;
  const pairs = view.pairsEndDate === null ? "no stored query × page pairs" : `query × page pairs from the window ending ${dateOf(view.pairsEndDate)}`;
  return `${snapshots}; ${pairs}.`;
}

function matches(row: ObservedQueryView, filters: KeywordScreenFilters): boolean {
  const search = filters.search.trim().toLowerCase();
  if (search.length > 0 && !row.query.toLowerCase().includes(search)) return false;
  if (filters.intent !== "all" && row.intent !== filters.intent) return false;
  if (filters.opportunity !== "all" && !row.opportunities.includes(filters.opportunity)) return false;
  return true;
}

/** The screen's derived view over one inventory. Pure. */
export function presentKeywordScreen(view: KeywordInventoryView, filters: KeywordScreenFilters): KeywordScreen {
  const rows = view.rows.filter((row) => matches(row, filters));

  const buckets = [...POSITION_BUCKETS.map((b) => ({ id: b.id, label: b.label })), { id: "none" as const, label: "No impressions" }].map((bucket) => ({
    ...bucket,
    count: rows.filter((row) => positionBucketOf(row) === bucket.id).length,
  }));

  const intentTally = new Map<IntentHint, number>();
  for (const row of rows) intentTally.set(row.intent, (intentTally.get(row.intent) ?? 0) + 1);
  const intents = [...intentTally.entries()].map(([intent, count]) => ({ intent, count })).sort((a, b) => b.count - a.count || a.intent.localeCompare(b.intent));

  const opportunities = OPPORTUNITY_LABELS.map((label) => ({
    label,
    title: OPPORTUNITY_LABEL_META[label].label,
    description: OPPORTUNITY_LABEL_META[label].description,
    rows: rows.filter((row) => row.opportunities.includes(label)),
  }));

  // Filter counts are taken over the other filters, so each option says what choosing it would show.
  const intentBase = view.rows.filter((row) => matches(row, { ...filters, intent: "all" }));
  const intentCounts: Partial<Record<IntentHint, number>> = {};
  for (const row of intentBase) intentCounts[row.intent] = (intentCounts[row.intent] ?? 0) + 1;
  const opportunityBase = view.rows.filter((row) => matches(row, { ...filters, opportunity: "all" }));
  const opportunityCounts = Object.fromEntries(OPPORTUNITY_LABELS.map((label) => [label, opportunityBase.filter((row) => row.opportunities.includes(label)).length])) as Record<OpportunityLabel, number>;

  return {
    rows,
    portfolio: { buckets, intents, over: rows.length, observed: view.counts.queries },
    groups: view.groups,
    opportunities,
    tabCounts: {
      keywords: rows.length,
      clusters: view.counts.groups,
      opportunities: rows.filter((row) => row.opportunities.length > 0).length,
    },
    filterCounts: { intent: intentCounts, opportunity: opportunityCounts },
    windows: windowsLine(view),
  };
}
