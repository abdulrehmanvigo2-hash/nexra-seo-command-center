import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { SearchQueryPageRow } from "../../../types/search-console.ts";
import type { StoredQueryPage } from "./contract.ts";
import { buildQueryPageIntelligence } from "./intelligence.ts";
import { MAX_OVERLAPS, MAX_PAGES_PER_OVERLAP } from "./thresholds.ts";
import { CHANGE_CONFIDENCE_COPY, NO_CHANGE_COPY, QUERY_PAGE_CAVEATS, describeQueryPageStatus, presentQueryPages, queryPagesReadFailure, queryPagesUrl } from "./view.ts";

/**
 * P4c view: every case is a way the section could mislead an operator — a
 * cut list read as the whole, a property or row id reaching the browser,
 * a missing comparison read as "nothing changed", or an empty set read as
 * "no overlap exists".
 */

const P = "sc-domain:nexraagency.com";
const pair = (query: string, page: string, impressions: number, clicks = 0, position = 5): SearchQueryPageRow => ({ query, page, clicks, impressions, ctr: clicks / impressions, position });
let n = 0;
function stored(endDate: string, rows: readonly SearchQueryPageRow[], property = P): StoredQueryPage[] {
  const startDate = new Date(Date.parse(`${endDate}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
  return rows.map((row) => ({ ...row, id: `row-${++n}`, projectId: "nexra-agency", property, rangeId: "30d", days: 30, startDate, endDate, source: "scheduled", fetchedAt: `${endDate}T12:00:00.000Z`, capturedAt: `${endDate}T12:00:01.000Z` }));
}

describe("presentQueryPages", () => {
  test("each unavailable state is its own status, and a failed read is never a view of its own", () => {
    assert.deepEqual(presentQueryPages(null), { status: "not-kept" });
    assert.deepEqual(presentQueryPages({ available: false, reason: "not-kept" }), { status: "not-kept" });
    assert.deepEqual(presentQueryPages({ available: false, reason: "read-failed" }), { status: "not-kept" });
    assert.deepEqual(presentQueryPages({ available: false, reason: "no-pairs", otherProperty: 0 }), { status: "no-pairs" });
    assert.deepEqual(presentQueryPages({ available: false, reason: "no-pairs-for-property", otherProperty: 3 }), { status: "no-pairs-for-property" });
  });

  test("pairs without an overlap are the no-overlap state with the true counts and the caveats", () => {
    const view = presentQueryPages(buildQueryPageIntelligence(stored("2026-09-17", [pair("a", "https://x.example/1", 10), pair("b", "https://x.example/2", 10)]), P, 750));
    assert.deepEqual(view, { status: "no-overlap", startDate: "2026-08-19", endDate: "2026-09-17", pairs: 2, queries: 2, pageTotal: 2, windows: 1, caveats: QUERY_PAGE_CAVEATS });
    assert.ok(view.status === "no-overlap");
    assert.match(describeQueryPageStatus(view).description, /2 stored pairs over 2 queries and 2 pages[\s\S]*unobserved, not ruled out/);
  });

  test("overlaps carry the pages with the leading page marked, the candidate flag, counts, concentration and change; no property or id", () => {
    const rows = [
      ...stored("2026-09-17", [pair("q", "https://x.example/a", 300, 5, 3), pair("q", "https://x.example/b", 100, 1, 6), pair("solo", "https://x.example/a", 50)]),
      ...stored("2026-09-03", [pair("q", "https://x.example/b", 100, 1, 3), pair("q", "https://x.example/a", 90, 5, 4)]),
      ...stored("2026-09-17", [pair("q", "https://old.example/", 1)], "https://old.example/"),
    ];
    const view = presentQueryPages(buildQueryPageIntelligence(rows, P, 750));
    assert.ok(view.status === "overlaps");
    assert.deepEqual([view.pairs, view.queries, view.pageTotal, view.counts, view.windows, view.underOtherProperty], [3, 2, 2, { overlaps: 1, candidates: 1 }, 2, true]);
    assert.deepEqual(view.overlaps.map((o) => [o.query, o.candidate, o.pageCount, o.impressions, o.pages.map((p) => [p.page, p.leading, p.share])]), [["q", true, 2, 400, [["https://x.example/a", true, 0.75], ["https://x.example/b", false, 0.25]]]]);
    assert.deepEqual(view.concentration, [{ page: "https://x.example/a", overlapsLed: 1, overlaps: 1, impressions: 300 }, { page: "https://x.example/b", overlapsLed: 0, overlaps: 1, impressions: 100 }]);
    assert.ok(view.change);
    assert.deepEqual([view.change.previousEndDate, view.change.gapDays, view.change.confidence, view.change.matched], ["2026-09-03", 14, "normal", 1]);
    assert.deepEqual(view.change.leaderChanged, [{ query: "q", previousLeadingPage: "https://x.example/b", latestLeadingPage: "https://x.example/a" }]);
    assert.deepEqual(view.change.impressionsChanged, [{ query: "q", previous: 190, latest: 400, absolute: 210 }]);
    assert.deepEqual(view.change.counts, { appeared: 0, disappeared: 0, leaderChanged: 1, impressionsChanged: 1 });
    const json = JSON.stringify(view);
    assert.ok(!json.includes(P) && !json.includes("row-") && !json.includes("old.example"), "no property, no row id, no other property's rows");
  });

  test("one window: change is null and the copy says a comparison needs an earlier window, never 'no change'", () => {
    const view = presentQueryPages(buildQueryPageIntelligence(stored("2026-09-17", [pair("q", "https://x.example/a", 30), pair("q", "https://x.example/b", 30)]), P, 750));
    assert.ok(view.status === "overlaps" && view.change === null);
    assert.match(NO_CHANGE_COPY, /needs an earlier window ending at least 7 days before/);
    assert.match(CHANGE_CONFIDENCE_COPY.low, /under 14 days apart/);
  });

  test("at most MAX_OVERLAPS overlaps of MAX_PAGES_PER_OVERLAP pages each, keys cut to 200 characters, with the true counts", () => {
    const long = "k".repeat(300);
    const rows = Array.from({ length: 12 }, (_, i) => Array.from({ length: 7 }, (_, j) => pair(i === 0 ? long : `q${i}`, `https://x.example/${i}/${j}`, (i === 0 ? 200 : 100) - j))).flat();
    const view = presentQueryPages(buildQueryPageIntelligence(stored("2026-09-17", rows), P, 750));
    assert.ok(view.status === "overlaps");
    assert.equal(view.overlaps.length, MAX_OVERLAPS);
    assert.equal(view.counts.overlaps, 12);
    assert.ok(view.overlaps.every((o) => o.pages.length === MAX_PAGES_PER_OVERLAP && o.pageCount === 7));
    assert.equal(view.overlaps[0].query, "k".repeat(200));
  });

  test("the caveats deny what the section must not claim", () => {
    const text = QUERY_PAGE_CAVEATS.join(" ");
    for (const stated of ["anonymised queries", "incomplete by design", "neither confirms cannibalisation", "No page owns a query", "not a rank tracker", "no search volume, difficulty, SERP feature or indexation data", "not a trend and not a cause"]) assert.ok(text.includes(stated), stated);
  });

  test("the browser side: a fixed URL, and failure wording that never says there is no overlap", () => {
    assert.equal(queryPagesUrl("nexra-agency"), "/api/search-console/query-pages?project=nexra-agency&range=30d");
    for (const status of [0, 401, 404, 429, 500, 503]) assert.doesNotMatch(queryPagesReadFailure(status), /no overlap|no pairs/i);
    assert.match(queryPagesReadFailure(401), /sign in/);
    assert.match(queryPagesReadFailure(503), /live report above is unaffected/);
    for (const status of ["not-kept", "no-pairs", "no-pairs-for-property"] as const) assert.ok(describeQueryPageStatus({ status }).title.length > 0);
  });
});
