import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { SearchQueryPageRow } from "../../../types/search-console.ts";
import type { StoredQueryPage } from "./contract.ts";
import { buildQueryPageIntelligence, type QueryPageInput } from "./intelligence.ts";
import { formatQueryPageGrounding, MAX_QUERY_PAGE_BYTES, QUERY_PAGE_LIMITS_NOTE } from "./grounding.ts";
import { MAX_OVERLAPS, MAX_PAGES_PER_OVERLAP } from "./thresholds.ts";

/**
 * P4c grounding: what an agent is told. Every case is a claim the block
 * must never make — a confirmed cannibalisation, a ranking, a search
 * volume, an owned query — or a bound it must keep: no block without pair
 * evidence, at most MAX_OVERLAPS × MAX_PAGES_PER_OVERLAP, under
 * MAX_QUERY_PAGE_BYTES, keys quoted.
 */

const P = "sc-domain:nexraagency.com";
const pair = (query: string, page: string, impressions: number, clicks = 0, position = 5): SearchQueryPageRow => ({ query, page, clicks, impressions, ctr: clicks / impressions, position });
let n = 0;
function stored(endDate: string, rows: readonly SearchQueryPageRow[]): StoredQueryPage[] {
  const startDate = new Date(Date.parse(`${endDate}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
  return rows.map((row) => ({ ...row, id: `row-${++n}`, projectId: "nexra-agency", property: P, rangeId: "30d", days: 30, startDate, endDate, source: "scheduled", fetchedAt: `${endDate}T12:00:00.000Z`, capturedAt: `${endDate}T12:00:01.000Z` }));
}

const LATEST = stored("2026-09-17", [
  pair("seo agency london", "https://nexraagency.com/", 300, 12, 4.1),
  pair("seo agency london", "https://nexraagency.com/services/seo", 120, 3, 6.8),
  pair("seo agency london", "https://nexraagency.com/blog/agency", 4, 0, 30),
  pair("nexra", "https://nexraagency.com/", 900, 200, 1.1),
  pair("thin overlap", "https://nexraagency.com/a", 500, 1, 2),
  pair("thin overlap", "https://nexraagency.com/b", 3, 0, 40),
]);
const PREVIOUS = stored("2026-09-03", [
  pair("seo agency london", "https://nexraagency.com/services/seo", 200, 3, 4.5),
  pair("seo agency london", "https://nexraagency.com/", 100, 12, 5.1),
  pair("old overlap", "https://nexraagency.com/a", 40, 0, 3),
  pair("old overlap", "https://nexraagency.com/b", 40, 0, 4),
]);

/** Affirmative claims the block must never make; the limits note names them only to deny them. */
const FORBIDDEN = [/is a confirmed cannibali[sz]ation/i, /confirmed cannibali[sz]ation (of|on|for|between)/i, /search volume of/i, /keyword difficulty of/i, /owns the query/i, /ranks? (#|number )?\d/i, /is indexed/i, /because Google/i];

describe("no block without pair evidence", () => {
  test("not kept, no pairs, another property and a failed read give a null text and a named summary", () => {
    const inputs: QueryPageInput[] = [
      { available: false, reason: "not-kept" },
      { available: false, reason: "read-failed" },
      { available: false, reason: "no-pairs", otherProperty: 0 },
      { available: false, reason: "no-pairs-for-property", otherProperty: 2 },
    ];
    for (const input of inputs) {
      assert.ok(!input.available);
      const g = formatQueryPageGrounding(input, "keyword");
      assert.equal(g.text, null);
      assert.deepEqual(g.summary, { queryPages: input.reason, audience: "keyword", latestEndDate: null, previousEndDate: null, pairs: 0, overlaps: 0, candidates: 0, shownOverlaps: 0, truncated: false, bytes: 0 });
    }
  });
});

describe("the block", () => {
  const input = buildQueryPageIntelligence([...LATEST, ...PREVIOUS], P, 750);
  const g = formatQueryPageGrounding(input, "keyword");
  const text = g.text ?? "";

  test("names the window, the counts, each overlap with its label, pages and leading page, and ends with the limits note", () => {
    assert.match(text, /^STORED SEARCH CONSOLE QUERY × PAGE EVIDENCE/);
    assert.match(text, /Property: sc-domain:nexraagency\.com\. Stored window: 30d \(30 days\), 2026-08-19 to 2026-09-17\. 6 query × page pairs over 3 queries and 5 pages/);
    assert.match(text, /Observed: 2 potential query overlap\(s\), of which 1 cannibalization candidate\(s\) for review/);
    assert.ok(text.includes('- Query "seo agency london" on 3 pages — CANNIBALIZATION CANDIDATE FOR REVIEW (2 pages with at least 20 impressions, positions 2.7 places apart); impressions 424, clicks 15; leading page "https://nexraagency.com/" with 70.8% of the query\'s impressions'));
    assert.ok(text.includes('    · "https://nexraagency.com/services/seo" — impressions 120 (28.3%), clicks 3, CTR 2.50%, average position 6.8'));
    assert.ok(text.includes('- Query "thin overlap" on 2 pages — potential query overlap; impressions 503'));
    assert.match(text, /PAGE CONCENTRATION[\s\S]*"https:\/\/nexraagency\.com\/" — leads 1 of the 1 overlapping queries it appears under; 300 impressions/);
    assert.ok(text.endsWith(QUERY_PAGE_LIMITS_NOTE));
    assert.ok(!text.includes('"nexra"'), "a query on one page is not listed as an overlap");
  });

  test("states the change against the previous window with its confidence", () => {
    assert.match(text, /CHANGE BETWEEN STORED WINDOWS: previous window ended 2026-09-03, 14 days before the latest; 1 overlapping query in both\. Confidence: normal\./);
    assert.match(text, /OVERLAPS THAT APPEARED[^\n]*\n- "thin overlap" — 2 pages, 503 impressions/);
    assert.match(text, /OVERLAPS THAT DISAPPEARED[^\n]*\n- "old overlap" — was on 2 pages with 80 impressions/);
    assert.match(text, /LEADING PAGE CHANGED \(1\)\n- "seo agency london" — "https:\/\/nexraagency\.com\/services\/seo" → "https:\/\/nexraagency\.com\/"; impressions 300 → 424/);
    assert.match(text, /IMPRESSIONS CHANGED[^\n]*\n- "seo agency london" — 300 → 424 \(\+124; \+41\.3%\)/);
  });

  test("makes none of the forbidden claims and says what the evidence is not", () => {
    // The limits note names the claim only to deny it; the denial is set aside before the check.
    const claims = text.replace(/neither is a confirmed cannibalisation/g, "");
    for (const forbidden of FORBIDDEN) assert.doesNotMatch(claims, forbidden, `forbidden claim ${forbidden}`);
    for (const stated of ["anonymised queries", "incomplete by design", "neither is a confirmed cannibalisation", "no page owns a query", "not a rank tracker", "no search volume, keyword difficulty, SERP feature, indexation", "not a trend and not a cause"]) {
      assert.ok(text.includes(stated), stated);
    }
  });

  test("the summary is scalar and true to the block", () => {
    assert.deepEqual(g.summary, { queryPages: "available", audience: "keyword", latestEndDate: "2026-09-17", previousEndDate: "2026-09-03", pairs: 6, overlaps: 2, candidates: 1, shownOverlaps: 2, truncated: false, bytes: new TextEncoder().encode(text).length });
    for (const value of Object.values(g.summary)) assert.ok(value === null || typeof value !== "object");
  });

  test("one window only: the change section says it is not established, never compares against nothing", () => {
    const one = formatQueryPageGrounding(buildQueryPageIntelligence(LATEST, P, 750), "analytics").text ?? "";
    assert.match(one, /CHANGE BETWEEN STORED WINDOWS: not established\. 1 stored window\(s\) for this property; a comparison needs an earlier one ending at least 7 days before 2026-09-17\./);
    assert.doesNotMatch(one, /OVERLAPS THAT APPEARED/);
  });

  test("no overlap in the set is said plainly and never filled", () => {
    const none = formatQueryPageGrounding(buildQueryPageIntelligence(stored("2026-09-17", [pair("a", "https://nexraagency.com/", 10)]), P, 750), "keyword").text ?? "";
    assert.match(none, /POTENTIAL QUERY OVERLAPS: none in the stored set\./);
    assert.match(none, /overlaps outside the set are unobserved, not ruled out/);
    assert.match(none, /PAGE CONCENTRATION: none/);
  });
});

describe("bounds", () => {
  test("at most MAX_OVERLAPS overlaps and MAX_PAGES_PER_OVERLAP pages each, with the true counts, keys quoted and cut", () => {
    const long = `${"x".repeat(250)} query`;
    // The long query has the most impressions, so it is the first overlap shown; the rest tie and sort by text.
    const rows = Array.from({ length: 14 }, (_, i) => Array.from({ length: 7 }, (_, j) => pair(i === 0 ? long : `overlap ${i}`, `https://nexraagency.com/p${j}`, (i === 0 ? 200 : 100) - j))).flat();
    const g = formatQueryPageGrounding(buildQueryPageIntelligence(stored("2026-09-17", rows), P, 750), "keyword");
    const text = g.text ?? "";
    assert.match(text, new RegExp(`POTENTIAL QUERY OVERLAPS \\(${MAX_OVERLAPS} of 14`));
    assert.equal((text.match(/^- Query /gm) ?? []).length, MAX_OVERLAPS);
    assert.match(text, new RegExp(`; ${MAX_PAGES_PER_OVERLAP} of 7 pages shown`));
    assert.equal((text.match(/^    · /gm) ?? []).length, MAX_OVERLAPS * MAX_PAGES_PER_OVERLAP);
    assert.ok(text.includes(`"${"x".repeat(200)}…"`), "a long key is cut and marked");
    assert.ok(!text.includes(long));
    assert.equal(g.summary.shownOverlaps, MAX_OVERLAPS);
    assert.ok(g.summary.bytes <= MAX_QUERY_PAGE_BYTES);
  });

  test("a block that would exceed the byte bound drops trailing sections, marks the cut, and keeps the limits note", () => {
    const rows = Array.from({ length: 10 }, (_, i) => Array.from({ length: 5 }, (_, j) => pair(`${"q".repeat(190)} ${i}`, `https://nexraagency.com/${"p".repeat(180)}${j}`, 100 - j))).flat();
    const previous = rows.map((r) => ({ ...r, impressions: r.impressions + 50 }));
    const g = formatQueryPageGrounding(buildQueryPageIntelligence([...stored("2026-09-17", rows), ...stored("2026-09-03", previous)], P, 750), "analytics");
    const text = g.text ?? "";
    assert.ok(g.summary.bytes <= MAX_QUERY_PAGE_BYTES);
    assert.equal(g.summary.truncated, true);
    assert.ok(text.includes("(further query × page sections were cut to keep this evidence within its size bound)"));
    assert.ok(text.endsWith(QUERY_PAGE_LIMITS_NOTE));
  });
});
