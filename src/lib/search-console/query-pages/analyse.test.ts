import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { SearchQueryPageRow } from "../../../types/search-console.ts";
import { analyseQueryPages } from "./analyse.ts";
import { compareQueryPageWindows } from "./compare.ts";
import { buildQueryPageIntelligence } from "./intelligence.ts";
import { groupQueryPageWindows, selectQueryPageWindows } from "./select.ts";
import type { StoredQueryPage } from "./contract.ts";
import {
  CANDIDATE_MAX_POSITION_GAP,
  CANDIDATE_MIN_IMPRESSIONS,
  CANDIDATE_MIN_PAGES,
  CHANGE_MIN_IMPRESSIONS,
  MAX_CONCENTRATION_PAGES,
  OVERLAP_MIN_PAGES,
} from "./thresholds.ts";

/**
 * P4c rules A–D over fixtures. Every case is a way the intelligence could
 * say more than the pairs support: an overlap from one page, a candidate
 * from thin impressions or far-apart positions, a leader chosen by anything
 * but impressions, a change from windows too close together, or a set cut
 * by the read ceiling analysed as if whole.
 */

const P = "sc-domain:nexraagency.com";
const pair = (query: string, page: string, impressions: number, clicks = 0, position = 5): SearchQueryPageRow => ({ query, page, clicks, impressions, ctr: clicks / impressions, position });

let n = 0;
function stored(endDate: string, rows: readonly SearchQueryPageRow[], property = P): StoredQueryPage[] {
  const startDate = new Date(Date.parse(`${endDate}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
  return rows.map((row) => ({ ...row, id: `row-${++n}`, projectId: "nexra-agency", property, rangeId: "30d", days: 30, startDate, endDate, source: "scheduled", fetchedAt: `${endDate}T12:00:00.000Z`, capturedAt: `${endDate}T12:00:01.000Z` }));
}

describe("rule A — query overlap", () => {
  test("a query on two or more pages is an overlap; a query on one page is not; counts are true", () => {
    const a = analyseQueryPages([pair("seo agency", "https://x.example/a", 100, 5), pair("seo agency", "https://x.example/b", 40), pair("solo", "https://x.example/a", 30)]);
    assert.deepEqual([a.pairs, a.queries, a.pages, a.overlapCount], [3, 2, 2, 1]);
    assert.equal(OVERLAP_MIN_PAGES, 2);
    assert.deepEqual(a.overlaps.map((o) => [o.query, o.pageCount, o.impressions, o.clicks]), [["seo agency", 2, 140, 5]]);
  });

  test("a repeated pair counts once, and overlaps sort by the query's impressions, then clicks, then query text", () => {
    const a = analyseQueryPages([
      pair("b", "https://x.example/1", 50), pair("b", "https://x.example/2", 50),
      pair("a", "https://x.example/1", 50), pair("a", "https://x.example/2", 50),
      pair("c", "https://x.example/1", 200), pair("c", "https://x.example/2", 1), pair("c", "https://x.example/2", 999),
    ]);
    assert.deepEqual(a.overlaps.map((o) => o.query), ["c", "a", "b"]);
    assert.equal(a.overlaps[0].impressions, 201);
  });
});

describe("rule B — cannibalization candidate", () => {
  const page = (i: number) => `https://x.example/${i}`;
  test("two pages with meaningful impressions and close positions is a candidate; the thresholds are the documented constants", () => {
    assert.deepEqual([CANDIDATE_MIN_PAGES, CANDIDATE_MIN_IMPRESSIONS, CANDIDATE_MAX_POSITION_GAP], [2, 20, 5]);
    const [o] = analyseQueryPages([pair("q", page(1), 20, 0, 4), pair("q", page(2), 20, 0, 9)]).overlaps;
    assert.deepEqual([o.candidate, o.meaningfulPages, o.positionGap], [true, 2, 5]);
  });

  test("thin impressions on the second page, or positions further apart than the gap, is an overlap but not a candidate", () => {
    const thin = analyseQueryPages([pair("q", page(1), 500, 0, 4), pair("q", page(2), 19, 0, 4)]).overlaps[0];
    assert.deepEqual([thin.candidate, thin.meaningfulPages, thin.positionGap], [false, 1, null]);
    const far = analyseQueryPages([pair("q", page(1), 500, 0, 4), pair("q", page(2), 100, 0, 9.1)]).overlaps[0];
    assert.deepEqual([far.candidate, far.meaningfulPages, far.positionGap], [false, 2, 5.1]);
  });

  test("the gap is measured among the meaningful pages only", () => {
    const o = analyseQueryPages([pair("q", page(1), 100, 0, 3), pair("q", page(2), 100, 0, 6), pair("q", page(3), 5, 0, 40)]).overlaps[0];
    assert.deepEqual([o.candidate, o.meaningfulPages, o.positionGap, o.pageCount], [true, 2, 3, 3]);
  });
});

describe("rule C — leading page and concentration", () => {
  test("the leading page has the most impressions (ties: clicks, then URL), with its share; pages sort the same way", () => {
    const [o] = analyseQueryPages([pair("q", "https://x.example/b", 100, 1), pair("q", "https://x.example/a", 100, 1), pair("q", "https://x.example/c", 300, 0)]).overlaps;
    assert.deepEqual([o.leadingPage, o.leadingShare], ["https://x.example/c", 0.6]);
    assert.deepEqual(o.pages.map((p) => [p.page, p.share]), [["https://x.example/c", 0.6], ["https://x.example/a", 0.2], ["https://x.example/b", 0.2]]);
  });

  test("concentration counts overlaps led and appeared under per page, at most MAX_CONCENTRATION_PAGES, by led then impressions", () => {
    const rows = [
      pair("q1", "https://x.example/hub", 100), pair("q1", "https://x.example/leaf", 10),
      pair("q2", "https://x.example/hub", 100), pair("q2", "https://x.example/other", 10),
      pair("q3", "https://x.example/leaf", 100), pair("q3", "https://x.example/hub", 10),
    ];
    const a = analyseQueryPages(rows);
    assert.deepEqual(a.concentration, [
      { page: "https://x.example/hub", overlapsLed: 2, overlaps: 3, impressions: 210 },
      { page: "https://x.example/leaf", overlapsLed: 1, overlaps: 2, impressions: 110 },
      { page: "https://x.example/other", overlapsLed: 0, overlaps: 1, impressions: 10 },
    ]);
    const many = Array.from({ length: 8 }, (_, i) => [pair(`q${i}`, `https://x.example/p${i}`, 100), pair(`q${i}`, "https://x.example/z", 1)]).flat();
    assert.equal(analyseQueryPages(many).concentration.length, MAX_CONCENTRATION_PAGES);
  });
});

describe("rule D — change across two windows", () => {
  const latest = analyseQueryPages([
    pair("kept", "https://x.example/a", 200), pair("kept", "https://x.example/b", 50),
    pair("swapped", "https://x.example/b", 90), pair("swapped", "https://x.example/a", 80),
    pair("new", "https://x.example/a", 30), pair("new", "https://x.example/b", 30),
    pair("grew", "https://x.example/a", 100), pair("grew", "https://x.example/b", 100),
  ]);
  const previous = analyseQueryPages([
    pair("kept", "https://x.example/a", 195), pair("kept", "https://x.example/b", 50),
    pair("swapped", "https://x.example/a", 90), pair("swapped", "https://x.example/b", 80),
    pair("gone", "https://x.example/a", 30), pair("gone", "https://x.example/b", 30),
    pair("grew", "https://x.example/a", 100), pair("grew", "https://x.example/b", 50),
    pair("new", "https://x.example/a", 500),
  ]);

  test("appeared, disappeared, leader changed and impressions changed are each named from the two analyses", () => {
    const c = compareQueryPageWindows(latest, previous, 14);
    assert.deepEqual(c.appeared.map((r) => r.query), ["new"], "a query on one page before is an overlap that appeared");
    assert.deepEqual(c.disappeared.map((r) => r.query), ["gone"]);
    assert.deepEqual(c.leaderChanged.map((r) => [r.query, r.previousLeadingPage, r.latestLeadingPage]), [["swapped", "https://x.example/a", "https://x.example/b"]]);
    assert.deepEqual(c.impressionsChanged.map((r) => [r.query, r.previousImpressions, r.latestImpressions, r.absolute, r.percent, r.direction]), [["grew", 150, 200, 50, 33.3, "up"]]);
    assert.equal(CHANGE_MIN_IMPRESSIONS, 20);
    assert.deepEqual([c.matched, c.confidence], [3, "normal"]);
  });

  test("a change under the minimum is not named, and windows under two weeks apart are low confidence", () => {
    const c = compareQueryPageWindows(latest, previous, 7);
    assert.ok(!c.impressionsChanged.some((r) => r.query === "kept"), "5 impressions is below the rule");
    assert.equal(c.confidence, "low");
  });
});

describe("window selection", () => {
  test("rows group into windows newest first; the previous is the newest window at least seven days earlier; other properties are set aside", () => {
    const rows = [
      ...stored("2026-09-17", [pair("q", "https://x.example/a", 10), pair("q", "https://x.example/b", 10)]),
      ...stored("2026-09-15", [pair("q", "https://x.example/a", 10)]),
      ...stored("2026-09-03", [pair("q", "https://x.example/a", 10)]),
      ...stored("2026-09-17", [pair("q", "https://x.example/a", 10)], "https://old.example/"),
    ];
    const windows = groupQueryPageWindows(rows, 750);
    assert.deepEqual(windows.map((w) => [w.endDate, w.property, w.rows.length]), [["2026-09-17", "https://old.example/", 1], ["2026-09-17", P, 2], ["2026-09-15", P, 1], ["2026-09-03", P, 1]]);
    const selection = selectQueryPageWindows(windows, P);
    assert.ok(selection.ok);
    assert.deepEqual([selection.latest.endDate, selection.previous?.endDate, selection.gapDays, selection.eligible, selection.otherProperty], ["2026-09-17", "2026-09-03", 14, 3, 1]);
    assert.ok(!("id" in selection.latest.rows[0]) && !("projectId" in selection.latest.rows[0]), "rows carry the pair and its metrics only");
  });

  test("no rows, rows only under another property, and one window each answer their own state", () => {
    assert.deepEqual(selectQueryPageWindows([], P), { ok: false, reason: "no-pairs", otherProperty: 0 });
    const other = groupQueryPageWindows(stored("2026-09-17", [pair("q", "https://x.example/a", 1)], "https://old.example/"), 750);
    assert.deepEqual(selectQueryPageWindows(other, P), { ok: false, reason: "no-pairs-for-property", otherProperty: 1 });
    const one = selectQueryPageWindows(groupQueryPageWindows(stored("2026-09-17", [pair("q", "https://x.example/a", 1)]), 750), P);
    assert.ok(one.ok && one.previous === null && one.gapDays === null);
  });

  test("a read that filled its ceiling drops the oldest group rather than analysing a cut set", () => {
    const rows = [...stored("2026-09-17", [pair("q", "https://x.example/a", 1)]), ...stored("2026-09-03", [pair("q", "https://x.example/a", 1)])];
    assert.equal(groupQueryPageWindows(rows, 2).length, 1);
    assert.equal(groupQueryPageWindows(rows, 3).length, 2);
    assert.equal(groupQueryPageWindows(stored("2026-09-17", [pair("q", "https://x.example/a", 1)]), 1).length, 1, "a single group is never dropped");
  });

  test("the composed intelligence carries the latest analysis, the previous one and the comparison", () => {
    const rows = [
      ...stored("2026-09-17", [pair("q", "https://x.example/a", 100), pair("q", "https://x.example/b", 100)]),
      ...stored("2026-09-03", [pair("q", "https://x.example/a", 100)]),
    ];
    const i = buildQueryPageIntelligence(rows, P, 750);
    assert.ok(i.available);
    assert.deepEqual([i.property, i.rangeId, i.latest.endDate, i.previous?.endDate, i.windows, i.otherProperty], [P, "30d", "2026-09-17", "2026-09-03", 2, 0]);
    assert.deepEqual(i.comparison?.appeared.map((r) => r.query), ["q"]);
    assert.equal(i.latest.analysis.candidateCount, 1);
  });
});
