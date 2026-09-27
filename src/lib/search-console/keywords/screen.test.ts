import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { keywordTaskProposal } from "../../agent-tasks/proposals.ts";
import { HISTORY_KEY_MAX } from "../history/view.ts";
import type { StoredQueryPage } from "../query-pages/contract.ts";
import { QUERY_PAGE_LIST_LIMIT } from "../query-pages/contract.ts";
import type { SearchConsoleSnapshot } from "../snapshots/contract.ts";
import { brandTokensOf } from "./intent.ts";
import { buildKeywordInventory, type KeywordInventoryInput } from "./inventory.ts";
import {
  EMPTY_KEYWORD_SCREEN_FILTERS,
  GROUP_NOTE,
  HIDDEN_KEYWORD_TABS,
  KEYWORD_TABS,
  MOVEMENT_NOTE,
  OBSERVED_FOOTER,
  POSITION_NOTE,
  hasKeywordScreenFilters,
  positionBucketOf,
  presentKeywordScreen,
  resolveKeywordTab,
  windowsLine,
} from "./screen.ts";
import { describeKeywordStatus, presentKeywordIntelligence, type KeywordInventoryView } from "./view.ts";

/**
 * Checkpoint 3.4: the Keyword Intelligence screen over observed data only.
 * The fixture mirrors production as read for the 3.1 design note: three
 * stored snapshot windows (ending 21, 22 and 23 Sep) and twenty query ×
 * page pairs over nine distinct queries in two pair windows.
 */

const PROPERTY = "sc-domain:nexraagency.com";
const BRAND = brandTokensOf("Nexra Agency", PROPERTY);
const HOME = "https://nexraagency.com/";

const metric = (key: string, clicks: number, impressions: number, position: number) => ({ key, clicks, impressions, ctr: impressions > 0 ? Number((clicks / impressions).toFixed(4)) : 0, position });

function snapshot(endDate: string, queries: ReturnType<typeof metric>[]): SearchConsoleSnapshot {
  const start = new Date(Date.parse(`${endDate}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
  return {
    id: `snap-${endDate}`,
    projectId: "nexra-agency",
    property: PROPERTY,
    rangeId: "30d",
    days: 30,
    startDate: start,
    endDate,
    state: "connected",
    totals: { clicks: 40, impressions: 900, ctr: 0.0444, position: 9.1 },
    queries,
    pages: [metric(HOME, 30, 600, 6.0)],
    partial: [],
    source: "scheduled",
    fetchedAt: `${endDate}T05:30:00.000Z`,
    capturedAt: `${endDate}T05:30:01.000Z`,
  };
}

let n = 0;
function pair(endDate: string, query: string, page: string, clicks: number, impressions: number, position: number): StoredQueryPage {
  n += 1;
  return {
    id: `pair-${n}`,
    projectId: "nexra-agency",
    property: PROPERTY,
    rangeId: "30d",
    days: 30,
    startDate: "2026-08-24",
    endDate,
    query,
    page,
    clicks,
    impressions,
    ctr: impressions > 0 ? Number((clicks / impressions).toFixed(4)) : 0,
    position,
    source: "scheduled",
    fetchedAt: `${endDate}T05:30:00.000Z`,
    capturedAt: `${endDate}T05:30:02.000Z`,
  };
}

const SNAPSHOTS = [
  snapshot("2026-09-21", [metric("nexra agency", 12, 40, 1.2), metric("nexra seo", 6, 30, 1.8), metric("seo agency london", 1, 120, 14.0)]),
  snapshot("2026-09-22", [metric("nexra agency", 13, 42, 1.1), metric("nexra seo", 5, 28, 2.0), metric("seo agency london", 1, 130, 13.5), metric("what is technical seo", 0, 60, 24.0)]),
  snapshot("2026-09-23", [
    metric("nexra agency", 14, 45, 1.1),
    metric("nexra seo", 6, 31, 1.9),
    metric("seo agency london", 1, 140, 12.8),
    metric("what is technical seo", 0, 65, 22.5),
    metric("seo audit price", 0, 25, 7.0),
  ]),
];

// Ten pairs in each of two windows, nine distinct queries across the latest window's pairs and the snapshots.
const PAIR_ROWS: [string, string, number, number, number][] = [
  ["nexra agency", HOME, 14, 45, 1.1],
  ["nexra seo", HOME, 6, 31, 1.9],
  ["seo agency london", HOME, 1, 90, 12.0],
  ["seo agency london", `${HOME}services`, 0, 50, 14.0],
  ["what is technical seo", `${HOME}blog/technical-seo`, 0, 65, 22.5],
  ["seo audit price", `${HOME}pricing`, 0, 25, 7.0],
  ["ai seo agency", `${HOME}services`, 0, 22, 8.0],
  ["seo pricing", `${HOME}pricing`, 0, 21, 9.0],
  ["technical seo checklist", `${HOME}blog/technical-seo`, 0, 12, 35.0],
  ["local seo services", `${HOME}services`, 0, 8, 61.0],
];
const PAIRS: StoredQueryPage[] = [
  ...PAIR_ROWS.map(([q, page, c, i, pos]) => pair("2026-09-22", q, page, c, i, pos)),
  ...PAIR_ROWS.map(([q, page, c, i, pos]) => pair("2026-09-23", q, page, c, i, pos)),
];

function inventoryView(over: Partial<KeywordInventoryInput> = {}): KeywordInventoryView {
  const view = presentKeywordIntelligence(
    buildKeywordInventory({ snapshots: SNAPSHOTS, pairs: PAIRS, pairsReadLimit: QUERY_PAGE_LIST_LIMIT, currentProperty: PROPERTY, brandTokens: BRAND, ...over }),
  );
  assert.equal(view.status, "inventory", JSON.stringify(view));
  return view as KeywordInventoryView;
}

const VIEW = inventoryView();

describe("the Keywords tab over the production shape", () => {
  test("nine observed queries, three stored windows, one pair window read; the table is the inventory", () => {
    assert.equal(PAIRS.length, 20);
    assert.equal(VIEW.counts.queries, 9, "nine distinct queries in the snapshots and the latest pair window");
    const screen = presentKeywordScreen(VIEW, EMPTY_KEYWORD_SCREEN_FILTERS);
    assert.deepEqual(screen.rows, VIEW.rows);
    assert.equal(screen.tabCounts.keywords, VIEW.rows.length);
    assert.equal(screen.portfolio.observed, VIEW.counts.queries);
    assert.equal(VIEW.snapshotsUsed, 3);
    assert.equal(VIEW.pairsEndDate, "2026-09-23");
    assert.equal(windowsLine(VIEW), "3 stored snapshot windows listed queries, the latest ending 23 Sep 2026; query × page pairs from the window ending 23 Sep 2026.");
  });

  test("position buckets come from each row's latest average position and add up to the rows shown", () => {
    const screen = presentKeywordScreen(VIEW, EMPTY_KEYWORD_SCREEN_FILTERS);
    const byId = Object.fromEntries(screen.portfolio.buckets.map((b) => [b.id, b.count]));
    assert.equal(screen.portfolio.buckets.reduce((sum, b) => sum + b.count, 0), screen.rows.length);
    assert.deepEqual(byId, { "top-3": 2, "4-10": 3, "11-20": 1, "21-50": 2, "over-50": 1, none: 0 });
    assert.equal(POSITION_NOTE, "Search Console average position, not rank");
  });

  test("bucket edges: 3 is top-3, just over 3 is 4–10, 50 is 21–50, no impressions or no figure is none", () => {
    const at = (position: number, impressions = 10) => positionBucketOf({ latest: { clicks: 0, impressions, ctr: 0, position } });
    assert.equal(at(3), "top-3");
    assert.equal(at(3.01), "4-10");
    assert.equal(at(20), "11-20");
    assert.equal(at(50), "21-50");
    assert.equal(at(50.1), "over-50");
    assert.equal(at(5, 0), "none");
    assert.equal(positionBucketOf({ latest: null }), "none");
  });

  test("intent counts are hints over the shown rows, most first", () => {
    const screen = presentKeywordScreen(VIEW, EMPTY_KEYWORD_SCREEN_FILTERS);
    assert.equal(screen.portfolio.intents.reduce((sum, i) => sum + i.count, 0), screen.rows.length);
    assert.equal(screen.portfolio.intents.find((i) => i.intent === "navigational")?.count, 2, "the two brand queries");
    for (let i = 1; i < screen.portfolio.intents.length; i += 1) assert.ok(screen.portfolio.intents[i - 1].count >= screen.portfolio.intents[i].count);
  });

  test("filters narrow the rows and each option counts over the other filters", () => {
    const search = presentKeywordScreen(VIEW, { ...EMPTY_KEYWORD_SCREEN_FILTERS, search: "  SEO AGENCY " });
    assert.deepEqual(search.rows.map((r) => r.query).sort(), ["ai seo agency", "seo agency london"]);
    const nav = presentKeywordScreen(VIEW, { ...EMPTY_KEYWORD_SCREEN_FILTERS, intent: "navigational" });
    assert.ok(nav.rows.every((r) => r.intent === "navigational"));
    assert.equal(nav.filterCounts.intent.navigational, 2);
    assert.ok((nav.filterCounts.intent.informational ?? 0) > 0, "other intents still counted under the other filters");
    const band = presentKeywordScreen(VIEW, { ...EMPTY_KEYWORD_SCREEN_FILTERS, opportunity: "position-band" });
    assert.ok(band.rows.length > 0 && band.rows.every((r) => r.opportunities.includes("position-band")));
    assert.equal(hasKeywordScreenFilters(EMPTY_KEYWORD_SCREEN_FILTERS), false);
    assert.equal(hasKeywordScreenFilters({ ...EMPTY_KEYWORD_SCREEN_FILTERS, search: " " }), false);
    assert.equal(hasKeywordScreenFilters({ ...EMPTY_KEYWORD_SCREEN_FILTERS, opportunity: "low-ctr" }), true);
  });
});

describe("the Groups and Opportunities tabs", () => {
  test("groups are the inventory's lexical groups, labelled a shared word", () => {
    const screen = presentKeywordScreen(VIEW, EMPTY_KEYWORD_SCREEN_FILTERS);
    assert.deepEqual(screen.groups, VIEW.groups);
    assert.equal(screen.tabCounts.clusters, VIEW.counts.groups);
    assert.ok(VIEW.groups.some((g) => g.term === "seo"));
    assert.equal(GROUP_NOTE, "a shared word, not a topic");
  });

  test("opportunities are the four M4 rule labels, in order, with the rows each names and no predicted figure", () => {
    const screen = presentKeywordScreen(VIEW, EMPTY_KEYWORD_SCREEN_FILTERS);
    assert.deepEqual(screen.opportunities.map((o) => o.label), ["low-ctr", "position-band", "weak-lead", "cannibalization-candidate"]);
    for (const group of screen.opportunities) {
      assert.ok(group.rows.every((r) => r.opportunities.includes(group.label)));
      assert.doesNotMatch(`${group.title} ${group.description}`, /upside|target ctr|potential|forecast(?!s? that)|will gain/i);
    }
    const band = screen.opportunities.find((o) => o.label === "position-band")!;
    assert.ok(band.rows.some((r) => r.query === "seo agency london"));
    assert.equal(screen.tabCounts.opportunities, screen.rows.filter((r) => r.opportunities.length > 0).length);
  });
});

describe("tabs, wording and empty states", () => {
  test("the five observed tabs only; the hidden tabs are absent and a deep link to one opens Keywords", () => {
    assert.deepEqual(KEYWORD_TABS.map((t) => t.id), ["keywords", "clusters", "opportunities", "movement", "cannibalization"]);
    for (const hidden of HIDDEN_KEYWORD_TABS) {
      assert.equal(KEYWORD_TABS.some((t) => t.id === hidden), false, hidden);
      assert.equal(resolveKeywordTab(hidden), "keywords");
    }
    assert.deepEqual([...HIDDEN_KEYWORD_TABS], ["gaps", "competitors", "serp", "ai", "lists"]);
    assert.equal(resolveKeywordTab("movement"), "movement");
    assert.equal(resolveKeywordTab(null), "keywords");
    assert.equal(OBSERVED_FOOTER, "Observed in stored Search Console rows · derived labels");
    assert.equal(MOVEMENT_NOTE, "Change between two stored windows, not a trend.");
  });

  test("no stored snapshot, a previous property's rows, no queries and no store are empty states, never zeros", () => {
    assert.deepEqual(presentKeywordIntelligence(buildKeywordInventory({ snapshots: [], pairs: [], pairsReadLimit: QUERY_PAGE_LIST_LIMIT, currentProperty: PROPERTY, brandTokens: BRAND })), { status: "no-snapshots" });
    assert.deepEqual(presentKeywordIntelligence(buildKeywordInventory({ snapshots: SNAPSHOTS, pairs: [], pairsReadLimit: QUERY_PAGE_LIST_LIMIT, currentProperty: "sc-domain:other.example", brandTokens: BRAND })), { status: "no-history-for-property" });
    assert.deepEqual(presentKeywordIntelligence(null), { status: "not-kept" });
    for (const status of ["no-snapshots", "no-history-for-property", "no-queries", "not-kept"] as const) {
      const message = describeKeywordStatus({ status });
      assert.ok(message.title.length > 0 && message.description.length > 0);
      assert.doesNotMatch(message.description, /\b0 (queries|clicks)\b/);
    }
  });

  test("snapshots without pairs say so in the windows line", () => {
    const view = inventoryView({ pairs: [] });
    assert.equal(view.pairsEndDate, null);
    assert.match(windowsLine(view), /; no stored query × page pairs\.$/);
    const screen = presentKeywordScreen(view, EMPTY_KEYWORD_SCREEN_FILTERS);
    assert.ok(screen.rows.every((r) => r.mapping.state === "no-pairs"));
  });
});

describe("Record as task names the full stored query (Q7)", () => {
  test("a query over 200 characters is cut for display only; the proposal's source is the exact stored text", () => {
    const long = `${"how to choose an seo agency for a small business in london ".repeat(5)}today`;
    assert.ok(long.length > HISTORY_KEY_MAX);
    const view = inventoryView({ snapshots: [...SNAPSHOTS.slice(0, 2), snapshot("2026-09-23", [metric(long, 1, 30, 9.0)])], pairs: [] });
    const row = view.rows.find((r) => r.query.startsWith("how to choose"))!;
    assert.equal(row.query, long, "the view keeps the full stored text");
    assert.equal(row.queryLabel.length, HISTORY_KEY_MAX, "the label is cut");
    assert.equal(row.queryLabel, long.slice(0, HISTORY_KEY_MAX));
    const proposal = keywordTaskProposal(row.query);
    assert.equal(proposal.sourceKind, "keyword");
    assert.equal(proposal.sourceRef, long);
    assert.equal(proposal.sourceRef.length, long.length);
  });

  test("a short query's label is the query itself", () => {
    for (const row of VIEW.rows) assert.equal(row.queryLabel, row.query);
  });
});
