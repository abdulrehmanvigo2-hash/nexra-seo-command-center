import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { StoredQueryPage } from "../query-pages/contract.ts";
import { QUERY_PAGE_LIST_LIMIT } from "../query-pages/contract.ts";
import type { SearchConsoleSnapshot } from "../snapshots/contract.ts";
import { KEYWORD_LIMITS_NOTE, MAX_GROUNDING_QUERIES, MAX_KEYWORD_BYTES, formatKeywordGrounding } from "./grounding.ts";
import { groupQueries, topicTokensOf } from "./groups.ts";
import { INTENT_PROVENANCE, brandTokensOf, intentHintOf, tokensOf } from "./intent.ts";
import { buildKeywordInventory, type KeywordIntelligence, type KeywordInventory } from "./inventory.ts";
import { BAND_MIN_IMPRESSIONS, HUB_MIN_QUERIES, MAX_GROUPS, MAX_HUBS, MAX_INVENTORY_ROWS, OPPORTUNITY_LABEL_META } from "./thresholds.ts";
import { KEYWORD_CAVEATS, describeKeywordStatus, keywordsReadFailure, keywordsUrl, presentKeywordIntelligence } from "./view.ts";

/**
 * Milestone M4: the observed query inventory. Every case here is a way the
 * inventory could claim more than the stored rows support — a lexical hint
 * read as an observed intent, a word group read as a topic, a cut set read
 * as demand, a candidate label read as a win, another project's or another
 * property's rows read as this site's, or an average position read as a
 * rank — and every rule boundary is pinned at its edge.
 */

const PROPERTY = "sc-domain:nexraagency.com";
const BRAND = brandTokensOf("Nexra Agency", PROPERTY);

const row = (key: string, clicks: number, impressions: number, position: number) => ({ key, clicks, impressions, ctr: impressions > 0 ? Number((clicks / impressions).toFixed(4)) : 0, position });

let n = 0;
function snapshot(endDate: string, over: Partial<SearchConsoleSnapshot> = {}): SearchConsoleSnapshot {
  n += 1;
  const start = new Date(Date.parse(`${endDate}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
  return {
    id: `snap-${n}`,
    projectId: "nexra-agency",
    property: PROPERTY,
    rangeId: "30d",
    days: 30,
    startDate: start,
    endDate,
    state: "connected",
    totals: { clicks: 200, impressions: 10_000, ctr: 0.02, position: 12.5 },
    queries: [row("nexra seo", 120, 3_000, 2.1), row("seo agency london", 40, 4_000, 8.4), row("what is technical seo", 5, 2_000, 14.2), row("seo audit price", 3, 150, 6.0)],
    pages: [row("https://nexraagency.com/", 150, 6_000, 3.0)],
    partial: [],
    source: "scheduled",
    fetchedAt: `${endDate}T05:30:00.000Z`,
    capturedAt: `${endDate}T05:30:01.000Z`,
    ...over,
  };
}

let p = 0;
function pair(query: string, page: string, clicks: number, impressions: number, position: number, over: Partial<StoredQueryPage> = {}): StoredQueryPage {
  p += 1;
  return {
    id: `pair-${p}`,
    projectId: "nexra-agency",
    property: PROPERTY,
    rangeId: "30d",
    days: 30,
    startDate: "2026-08-26",
    endDate: "2026-09-24",
    query,
    page,
    clicks,
    impressions,
    ctr: impressions > 0 ? Number((clicks / impressions).toFixed(4)) : 0,
    position,
    source: "scheduled",
    fetchedAt: "2026-09-25T05:30:00.000Z",
    capturedAt: "2026-09-25T05:30:02.000Z",
    ...over,
  };
}

const LATEST = snapshot("2026-09-24");
const EARLIER = snapshot("2026-09-10", { queries: [row("nexra seo", 100, 2_800, 2.5), row("seo agency london", 30, 3_500, 9.0), row("old query", 10, 500, 11.0)] });

const PAIRS: readonly StoredQueryPage[] = [
  pair("seo agency london", "https://nexraagency.com/", 30, 2_500, 8.0),
  pair("seo agency london", "https://nexraagency.com/services", 10, 1_500, 9.5),
  pair("what is technical seo", "https://nexraagency.com/blog/technical-seo", 5, 2_000, 14.2),
  pair("seo pricing", "https://nexraagency.com/pricing", 2, 60, 5.0),
  pair("seo pricing", "https://nexraagency.com/", 1, 40, 6.0),
];

function build(over: Partial<Parameters<typeof buildKeywordInventory>[0]> = {}): KeywordIntelligence {
  return buildKeywordInventory({ snapshots: [LATEST, EARLIER], pairs: PAIRS, pairsReadLimit: QUERY_PAGE_LIST_LIMIT, currentProperty: PROPERTY, brandTokens: BRAND, ...over });
}

function inventory(over: Partial<Parameters<typeof buildKeywordInventory>[0]> = {}): KeywordInventory {
  const result = build(over);
  assert.ok(result.available, `expected an inventory, got ${JSON.stringify(result)}`);
  return result;
}

const UNSUPPORTED = /\b(search volume of|keyword difficulty of|ranks? #|is a rank tracker|confirmed cannibali[sz]ation|guaranteed|will rank|owns the query)\b/i;

describe("intent hints", () => {
  test("are lexical, deterministic, and name the word that decided them", () => {
    assert.deepEqual(intentHintOf("what is technical seo", BRAND), { intent: "informational", marker: "what" });
    assert.deepEqual(intentHintOf("best seo agency london", BRAND), { intent: "commercial", marker: "best" });
    assert.deepEqual(intentHintOf("seo audit price", BRAND), { intent: "transactional", marker: "price" });
    assert.deepEqual(intentHintOf("seo agency near me", BRAND), { intent: "local", marker: "near me" });
    assert.deepEqual(intentHintOf("nexra seo", BRAND), { intent: "navigational", marker: "nexra" });
    assert.deepEqual(intentHintOf("nexraagency login", []), { intent: "navigational", marker: "login" });
    assert.deepEqual(intentHintOf("technical seo checklist", BRAND), { intent: "informational", marker: "checklist" });
    assert.deepEqual(intentHintOf("zeta omega", BRAND), { intent: "unclassified", marker: null });
  });

  test("the brand wins over every other list, transactional over commercial, and a bare 'in' or 'sign' marks nothing", () => {
    assert.equal(intentHintOf("buy nexra agency services", BRAND).intent, "navigational");
    assert.equal(intentHintOf("best seo agency pricing", BRAND).intent, "transactional");
    assert.equal(intentHintOf("seo in london", []).intent, "unclassified");
    assert.equal(intentHintOf("sign of good seo", []).intent, "unclassified");
    assert.equal(intentHintOf("sign in", []).intent, "navigational");
  });

  test("brand tokens come from the host label and the name's longer words, never short words", () => {
    assert.deepEqual([...BRAND], ["nexra", "nexraagency"], "a generic word in the name is never a brand token");
    assert.deepEqual([...brandTokensOf("The SEO Co", "https://www.seo.co/")], []);
    assert.deepEqual([...brandTokensOf("", "sc-domain:verdanthome.example")], ["verdanthome"]);
    assert.deepEqual([...tokensOf("  SEO-Agency, London! ")], ["seo", "agency", "london"]);
    assert.match(INTENT_PROVENANCE, /derived from the query's own words; not an observation/);
  });
});

describe("lexical groups", () => {
  test("file each query under its most frequent topic word, keep groups of two or more, and never call the result a topic", () => {
    const grouping = groupQueries(["seo agency london", "best seo agency", "what is technical seo", "seo pricing", "nexra seo", "content marketing tips"]);
    assert.deepEqual(grouping.groups.map((g) => [g.term, g.queryCount]), [["seo", 5]]);
    assert.equal(grouping.termOf.get("content marketing tips"), undefined);
    assert.equal(grouping.ungrouped, 1);
    assert.deepEqual([...topicTokensOf("what is the best seo agency near me")], ["seo", "agency"]);
  });

  test("ties fall to the alphabetically earlier word, and a query with no topic word is ungrouped", () => {
    const grouping = groupQueries(["alpha beta", "alpha gamma", "beta gamma", "how to"]);
    // alpha, beta and gamma each occur twice: each query takes its alphabetically earliest word.
    assert.deepEqual(grouping.groups.map((g) => [g.term, [...g.queries]]), [["alpha", ["alpha beta", "alpha gamma"]]]);
    assert.equal(grouping.termOf.get("beta gamma"), undefined, "a group of one is not kept");
    assert.equal(grouping.ungrouped, 2);
  });
});

describe("the inventory over stored snapshots and pairs", () => {
  test("unions the snapshots' top queries with the latest pair window, sorted by the latest window's impressions", () => {
    const inv = inventory();
    assert.equal(inv.property, PROPERTY);
    assert.equal(inv.latestEndDate, "2026-09-24");
    assert.equal(inv.snapshotsUsed, 2);
    assert.equal(inv.pairsEndDate, "2026-09-24");
    assert.deepEqual(inv.rows.map((r) => r.query), ["seo agency london", "nexra seo", "what is technical seo", "seo audit price", "seo pricing", "old query"]);
    assert.equal(inv.counts.queries, 6);
    assert.equal(inv.counts.inLatestTop, 4);
    assert.equal(inv.counts.withPairs, 3);
  });

  test("a query in the latest top rows carries the snapshot row; one only in the pairs carries the summed pairs, labelled so", () => {
    const inv = inventory();
    const london = inv.rows.find((r) => r.query === "seo agency london")!;
    assert.deepEqual([london.latestSource, london.latest?.impressions, london.windows, london.firstSeenEndDate, london.lastSeenEndDate, london.inLatestTop], ["snapshot", 4_000, 2, "2026-09-10", "2026-09-24", true]);
    const pricing = inv.rows.find((r) => r.query === "seo pricing")!;
    assert.deepEqual([pricing.latestSource, pricing.latest, pricing.windows, pricing.inLatestTop], ["pairs", { clicks: 3, impressions: 100, ctr: 0.03, position: 5.4 }, 0, false]);
    const old = inv.rows.find((r) => r.query === "old query")!;
    assert.deepEqual([old.latestSource, old.latest, old.windows, old.inLatestTop, old.mapping.state], [null, null, 1, false, "no-pairs"]);
  });

  test("maps a query to its pages from the pairs: overlap with the P4c leading page and share, single page observed, or no pair", () => {
    const inv = inventory();
    const london = inv.rows.find((r) => r.query === "seo agency london")!.mapping;
    assert.equal(london.state, "overlap");
    if (london.state === "overlap") {
      assert.equal(london.leadingPage, "https://nexraagency.com/");
      assert.equal(london.leadingShare, 0.625);
      assert.equal(london.candidate, true, "two pages with ≥ 20 impressions within 5 places");
      assert.deepEqual(london.pages.map((page) => page.share), [0.625, 0.375]);
    }
    const technical = inv.rows.find((r) => r.query === "what is technical seo")!.mapping;
    assert.deepEqual(technical, { state: "single-page", leadingPage: "https://nexraagency.com/blog/technical-seo", pages: [{ page: "https://nexraagency.com/blog/technical-seo", clicks: 5, impressions: 2_000, ctr: 0.0025, position: 14.2, share: 1 }] });
    assert.equal(inv.rows.find((r) => r.query === "nexra seo")!.mapping.state, "no-pairs");
    assert.deepEqual([inv.counts.overlaps, inv.counts.candidates], [2, 2], "seo pricing: two pages with ≥ 20 impressions one place apart is a candidate too");
  });

  test("leading-page ties break by clicks, then by URL, exactly as P4c", () => {
    const tied = [pair("q", "https://nexraagency.com/b", 5, 100, 4.0), pair("q", "https://nexraagency.com/a", 5, 100, 4.0), pair("q", "https://nexraagency.com/c", 6, 100, 4.0)];
    const inv = inventory({ snapshots: [snapshot("2026-09-24", { queries: [row("q", 16, 300, 4.0)] })], pairs: tied });
    const mapping = inv.rows[0]!.mapping;
    assert.equal(mapping.state, "overlap");
    if (mapping.state === "overlap") {
      assert.equal(mapping.leadingPage, "https://nexraagency.com/c", "more clicks wins the tie on impressions");
      assert.deepEqual(mapping.pages.map((page) => page.page), ["https://nexraagency.com/c", "https://nexraagency.com/a", "https://nexraagency.com/b"], "then the earlier URL");
    }
  });

  test("opportunity rules hold at their boundaries and never fire without figures", () => {
    const at = (clicks: number, impressions: number, position: number) => inventory({ snapshots: [snapshot("2026-09-24", { queries: [row("q", clicks, impressions, position)] })], pairs: [] }).rows[0]!.opportunities;
    assert.deepEqual(at(1, 100, 20), ["low-ctr", "position-band"], "100 impressions, 1% CTR, position 20: both rules at their edge");
    assert.deepEqual(at(2, 100, 20), ["position-band"], "1.99% is over the low-CTR ceiling; 2% CTR is not");
    assert.deepEqual(at(1, 99, 20), ["position-band"], "99 impressions: under the low-CTR floor");
    assert.deepEqual(at(0, 100, 20.1), [], "position 20.1 is outside both bands");
    assert.deepEqual(at(0, BAND_MIN_IMPRESSIONS, 4), ["position-band"], "band floor at 20 impressions and position 4");
    assert.deepEqual(at(0, BAND_MIN_IMPRESSIONS - 1, 4), [], "19 impressions is under the band floor");
    assert.deepEqual(at(0, 100, 3.9), ["low-ctr"], "position 3.9 is above the band but inside the low-CTR rule");
    assert.deepEqual(at(0, 0, 0), [], "no impressions: no position, no label");
  });

  test("no strong landing page fires under a 50% lead across two pages, and the cannibalization label follows P4c", () => {
    const inv = inventory();
    const london = inv.rows.find((r) => r.query === "seo agency london")!;
    assert.deepEqual(london.opportunities, ["low-ctr", "position-band", "cannibalization-candidate"], "62.5% lead is a strong lead, so no weak-lead; 40 of 4,000 is exactly the 1% low-CTR ceiling");
    const weak = inventory({ snapshots: [snapshot("2026-09-24", { queries: [] })], pairs: [pair("split", "https://nexraagency.com/a", 5, 100, 5.0), pair("split", "https://nexraagency.com/b", 5, 100, 12.0), pair("split", "https://nexraagency.com/c", 1, 50, 8.0)] }).rows[0]!;
    assert.equal(weak.mapping.state, "overlap");
    assert.ok(weak.opportunities.includes("weak-lead"), "a 40% lead across three pages");
    assert.equal(weak.opportunities.includes("cannibalization-candidate"), false, "positions 7 places apart are outside the candidate gap");
    assert.deepEqual(inv.counts.byOpportunity, { "low-ctr": 2, "position-band": 4, "weak-lead": 0, "cannibalization-candidate": 2 }, "seo agency london at exactly 1% and what is technical seo at 0.25% are low CTR");
  });

  test("page hubs need at least five distinct observed queries", () => {
    const many = Array.from({ length: HUB_MIN_QUERIES }, (_, i) => pair(`hub query ${i}`, "https://nexraagency.com/hub", 1, 30, 9.0));
    const few = Array.from({ length: HUB_MIN_QUERIES - 1 }, (_, i) => pair(`thin query ${i}`, "https://nexraagency.com/thin", 1, 30, 9.0));
    const inv = inventory({ snapshots: [snapshot("2026-09-24", { queries: [] })], pairs: [...many, ...few] });
    assert.deepEqual(inv.hubs, [{ page: "https://nexraagency.com/hub", queries: 5, impressions: 150, clicks: 5 }]);
  });

  test("intent hints and lexical groups are attached with counts, and intent counts cover every row", () => {
    const inv = inventory();
    const byQuery = new Map(inv.rows.map((r) => [r.query, r]));
    assert.deepEqual([byQuery.get("nexra seo")!.intent, byQuery.get("what is technical seo")!.intent, byQuery.get("seo audit price")!.intent, byQuery.get("seo agency london")!.intent], ["navigational", "informational", "transactional", "commercial"]);
    assert.equal(Object.values(inv.counts.byIntent).reduce((a, b) => a + b, 0), inv.counts.queries);
    assert.deepEqual(inv.groups.map((g) => [g.term, g.queryCount]), [["seo", 5]]);
    assert.deepEqual([inv.counts.grouped, inv.counts.ungrouped], [5, 1]);
    assert.equal(byQuery.get("old query")!.group, null);
  });

  test("project isolation and the property rule: another property's rows are set aside, and only the current property is read", () => {
    const foreign = snapshot("2026-09-24", { property: "sc-domain:other.example", queries: [row("other site query", 50, 900, 3.0)] });
    const inv = inventory({ snapshots: [LATEST, foreign], pairs: [] });
    assert.equal(inv.otherProperty, 1);
    assert.equal(inv.rows.some((r) => r.query === "other site query"), false);
    const onlyForeign = build({ snapshots: [foreign], pairs: [] });
    assert.deepEqual(onlyForeign, { available: false, reason: "no-history-for-property", otherProperty: 1 });
    const foreignPairs = inventory({ snapshots: [LATEST], pairs: PAIRS.map((r) => ({ ...r, property: "sc-domain:other.example" })) });
    assert.equal(foreignPairs.pairsEndDate, null, "pairs under another property are not read");
    assert.equal(foreignPairs.counts.withPairs, 0);
  });

  test("empty states are named, never filled: no snapshots, one no-data window, queries unavailable, no clicks or impressions", () => {
    assert.deepEqual(build({ snapshots: [], pairs: [] }), { available: false, reason: "no-snapshots", otherProperty: 0 });
    assert.deepEqual(build({ snapshots: [snapshot("2026-09-24", { state: "no-data", totals: null, queries: [], pages: [] })], pairs: [] }), { available: false, reason: "no-queries", otherProperty: 0 });
    assert.deepEqual(build({ snapshots: [snapshot("2026-09-24", { partial: ["queries-unavailable"], queries: [] })], pairs: [] }), { available: false, reason: "no-queries", otherProperty: 0 });
    const single = inventory({ snapshots: [LATEST], pairs: [] });
    assert.equal(single.snapshotsUsed, 1);
    assert.ok(single.rows.every((r) => r.windows === 1 && r.mapping.state === "no-pairs"));
    const zero = inventory({ snapshots: [snapshot("2026-09-24", { queries: [row("silent", 0, 0, 0)] })], pairs: [] });
    assert.deepEqual([zero.rows[0]!.latest, zero.rows[0]!.opportunities], [{ clicks: 0, impressions: 0, ctr: 0, position: 0 }, []]);
    const noDataLatestWithPairs = inventory({ snapshots: [snapshot("2026-09-24", { state: "no-data", totals: null, queries: [], pages: [] })], pairs: PAIRS });
    assert.equal(noDataLatestWithPairs.latestState, "no-data");
    assert.equal(noDataLatestWithPairs.counts.queries, 3, "pairs alone still make an inventory");
  });

  test("a pair read that filled its ceiling drops the possibly cut oldest window, as P4c does", () => {
    const older = PAIRS.map((r) => ({ ...r, endDate: "2026-09-01", startDate: "2026-08-03" }));
    const inv = inventory({ snapshots: [LATEST], pairs: [...PAIRS, ...older], pairsReadLimit: PAIRS.length * 2 });
    assert.equal(inv.pairsEndDate, "2026-09-24", "the newest window is kept");
  });
});

describe("the presented inventory", () => {
  test("cuts rows, groups and hubs to their limits with true counts, carries no property or id, and always the caveats", () => {
    const many = Array.from({ length: MAX_INVENTORY_ROWS + 5 }, (_, i) => row(`query number ${i}`, 1, 1_000 - i, 7.0));
    const inv = inventory({ snapshots: [snapshot("2026-09-24", { queries: many })], pairs: [] });
    const view = presentKeywordIntelligence(inv);
    assert.equal(view.status, "inventory");
    if (view.status !== "inventory") return;
    assert.equal(view.rows.length, MAX_INVENTORY_ROWS);
    assert.equal(view.counts.queries, MAX_INVENTORY_ROWS + 5);
    assert.ok(view.groups.length <= MAX_GROUPS && view.hubs.length <= MAX_HUBS);
    assert.equal(view.caveats, KEYWORD_CAVEATS);
    const json = JSON.stringify(view);
    assert.doesNotMatch(json, /sc-domain|"id":|snap-|pair-/);
    assert.match(json, /"latestSource":"snapshot"/);
  });

  test("every non-inventory state is named for the operator and none says the site has no demand", () => {
    assert.deepEqual(presentKeywordIntelligence(null), { status: "not-kept" });
    assert.deepEqual(presentKeywordIntelligence({ available: false, reason: "read-failed" }), { status: "not-kept" });
    for (const status of ["no-snapshots", "no-history-for-property", "no-queries", "not-kept"] as const) {
      const message = describeKeywordStatus({ status });
      assert.ok(message.title.length > 0 && message.description.length > 0);
      assert.doesNotMatch(`${message.title} ${message.description}`, /no demand|nothing to rank|no traffic/i);
    }
    assert.equal(keywordsUrl("nexra-agency"), "/api/search-console/keywords?project=nexra-agency&range=30d");
    for (const status of [0, 401, 404, 429, 503]) assert.doesNotMatch(keywordsReadFailure(status), /no queries|no demand/i);
  });

  test("the caveats and label descriptions claim nothing the rows cannot support", () => {
    for (const text of [...KEYWORD_CAVEATS, ...Object.values(OPPORTUNITY_LABEL_META).map((m) => m.description)]) {
      assert.doesNotMatch(text, UNSUPPORTED);
    }
    assert.match(KEYWORD_CAVEATS[1]!, /derived labels for review/);
    assert.match(KEYWORD_CAVEATS[2]!, /never predicted wins/);
    assert.match(KEYWORD_CAVEATS[3]!, /not a rank tracker's reading/);
  });
});

describe("the agent block", () => {
  test("is appended only when an inventory exists, names derived labels as derived, and ends with the limits", () => {
    const grounding = formatKeywordGrounding(inventory());
    assert.ok(grounding.text);
    assert.match(grounding.text!, /^OBSERVED QUERY INVENTORY \(derived by fixed rules/);
    assert.match(grounding.text!, /intent hint navigational \(word "nexra"\)/);
    assert.match(grounding.text!, /CANNIBALIZATION CANDIDATE FOR REVIEW on 2 pages, leading page "https:\/\/nexraagency\.com\/" with 62\.5%/);
    assert.match(grounding.text!, /single page observed "https:\/\/nexraagency\.com\/blog\/technical-seo"/);
    assert.match(grounding.text!, /sum of its stored pairs/);
    assert.match(grounding.text!, /LEXICAL GROUPS \(1, by query count; a shared word, not a topic\)/);
    assert.match(grounding.text!, /PAGE HUBS: none/);
    assert.ok(grounding.text!.endsWith(KEYWORD_LIMITS_NOTE));
    assert.doesNotMatch(grounding.text!, UNSUPPORTED);
    assert.deepEqual([grounding.summary.keywords, grounding.summary.queries, grounding.summary.shownQueries, grounding.summary.groups, grounding.summary.opportunities, grounding.summary.truncated], ["available", 6, 6, 1, 4, false]);
    assert.ok(grounding.summary.bytes <= MAX_KEYWORD_BYTES);
    for (const reason of ["no-snapshots", "no-history-for-property", "no-queries", "not-kept", "read-failed"] as const) {
      const none = formatKeywordGrounding(reason === "not-kept" || reason === "read-failed" ? { available: false, reason } : { available: false, reason, otherProperty: 0 });
      assert.equal(none.text, null);
      assert.equal(none.summary.keywords, reason);
    }
  });

  test("stays under its byte bound with long keys and many rows, cutting whole sections and saying so", () => {
    const long = Array.from({ length: 25 }, (_, i) => row(`${"very long query text ".repeat(12)}${i}`, 1, 500 - i, 9.0));
    const longPairs = Array.from({ length: 200 }, (_, i) => pair(`${"long pair query ".repeat(10)}${i}`, `https://nexraagency.com/${"p".repeat(150)}/${i}`, 1, 50, 8.0));
    const grounding = formatKeywordGrounding(inventory({ snapshots: [snapshot("2026-09-24", { queries: long })], pairs: longPairs }));
    assert.ok(grounding.text);
    assert.ok(grounding.summary.bytes <= MAX_KEYWORD_BYTES, `${grounding.summary.bytes} bytes`);
    assert.equal(grounding.summary.shownQueries, MAX_GROUNDING_QUERIES);
    assert.ok(grounding.text!.endsWith(KEYWORD_LIMITS_NOTE));
    if (grounding.summary.truncated) assert.match(grounding.text!, /further inventory sections were cut/);
  });
});
