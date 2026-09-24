import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { SearchPerformanceRow } from "../../../types/search-console.ts";
import { MAX_QUERY_LENGTH, PERFORMANCE_REVIEW_INSTRUCTIONS, SEARCH_CONSOLE_LIMITS_NOTE, SEARCH_QUERY_REVIEW_INSTRUCTIONS } from "../grounding.ts";
import type { SearchConsoleSnapshot, SnapshotPartial } from "../snapshots/contract.ts";
import { compareSnapshotHistory } from "./compare.ts";
import {
  MAX_HISTORY_BYTES,
  MAX_HISTORY_MOVEMENT_ROWS,
  MAX_HISTORY_SUMMARY_ROWS,
  SEARCH_CONSOLE_HISTORY_LIMITS_NOTE,
  formatSearchConsoleHistory,
  type HistoryInput,
} from "./grounding.ts";

/**
 * Milestone M1, phase 4, checkpoint P4b. On trial: that stored history is
 * serialised as a bounded second block that adds to the live report and
 * never stands in for it, that it names what it is not, that missing
 * history produces one note and nothing invented, and that the two
 * audiences each get their own side of the comparison.
 */

const PROPERTY = "sc-domain:halcyon.example";
const bytes = (text: string) => new TextEncoder().encode(text).length;

const row = (key: string, clicks: number, impressions: number, position: number): SearchPerformanceRow => ({ key, clicks, impressions, ctr: impressions ? clicks / impressions : 0, position });

let n = 0;
function snap(endDate: string, o: { state?: SearchConsoleSnapshot["state"]; queries?: readonly SearchPerformanceRow[]; pages?: readonly SearchPerformanceRow[]; partial?: SnapshotPartial[]; totals?: SearchConsoleSnapshot["totals"] } = {}): SearchConsoleSnapshot {
  const state = o.state ?? "connected";
  n += 1;
  return {
    id: `s${n}`,
    projectId: "halcyon-fintech",
    property: PROPERTY,
    rangeId: "30d",
    days: 30,
    startDate: endDate,
    endDate,
    state,
    totals: state === "no-data" ? null : (o.totals ?? { clicks: 120, impressions: 4000, ctr: 0.03, position: 12.4 }),
    queries: state === "no-data" ? [] : (o.queries ?? []),
    pages: state === "no-data" ? [] : (o.pages ?? []),
    partial: state === "no-data" ? [] : (o.partial ?? []),
    source: "scheduled",
    fetchedAt: `${endDate}T12:00:00.000Z`,
    capturedAt: `${endDate}T12:00:00.000Z`,
  };
}

const compared = (latest: SearchConsoleSnapshot, previous: SearchConsoleSnapshot) => compareSnapshotHistory([previous, latest], PROPERTY);

const PREVIOUS = snap("2026-09-03", {
  totals: { clicks: 100, impressions: 5000, ctr: 0.02, position: 14 },
  queries: [row("stay", 30, 250, 2.6), row("gone", 4, 40, 9), row("slip", 5, 50, 4)],
  pages: [row("https://halcyon.example/", 40, 1000, 3.4)],
});
const LATEST = snap("2026-09-17", {
  queries: [row("stay", 40, 300, 2.1), row("fresh", 12, 900, 8.4), row("slip", 5, 50, 6), row("quiet", 1, 500, 12)],
  pages: [row("https://halcyon.example/", 50, 1200, 3.0), row("https://halcyon.example/blog", 1, 400, 14)],
});

describe("history available", () => {
  const keyword = formatSearchConsoleHistory(compared(LATEST, PREVIOUS), "keyword");
  const analytics = formatSearchConsoleHistory(compared(LATEST, PREVIOUS), "analytics");

  test("the header names the property, both window ends, the gap and the confidence, and says gaps are not filled", () => {
    assert.match(keyword.text, /^STORED SEARCH CONSOLE HISTORY \(two snapshots this product recorded[^\n]*the live report above is the current evidence\)/);
    assert.match(keyword.text, /Property: sc-domain:halcyon\.example\. Stored window: 30d \(30 days\)\. Latest window ended 2026-09-17; previous window ended 2026-09-03; 14 days apart\. Missing days between them are gaps, not filled in\./);
    assert.match(keyword.text, /States: latest connected, previous connected\. Confidence: normal\./);
  });

  test("totals carry absolute and percentage change, CTR in points, position in places with direction", () => {
    for (const g of [keyword, analytics]) {
      assert.match(g.text, /- Clicks: 100 → 120 \(\+20; \+20\.0%\)/);
      assert.match(g.text, /- Impressions: 5000 → 4000 \(-1000; -20\.0%\)/);
      assert.match(g.text, /- Click-through rate: 2\.00% → 3\.00% \(\+1\.00 points\)/);
      assert.match(g.text, /- Average position: 14\.0 → 12\.4 \(up 1\.6 places\)/);
    }
  });

  test("the keyword audience gets the query side only: movements, opportunities, improving, declining, appeared, left", () => {
    const t = keyword.text;
    assert.match(t, /QUERY MOVEMENTS \(2 queries in both windows' top 25, by latest clicks; previous → latest\)/);
    assert.ok(t.includes('- Query: "stay" — clicks 30 → 40 (+10; +33.3%), impressions 250 → 300 (+50; +20.0%), CTR 12.00% → 13.33% (+1.33 points), average position 2.6 → 2.1 (up 0.5 places)'));
    assert.ok(t.includes('- Query: "slip" — clicks 5 → 5 (+0; +0.0%)') && t.includes("average position 4.0 → 6.0 (down 2.0 places); declining"));
    assert.match(t, /QUERY OPPORTUNITIES in the latest window[^\n]*\(1\)\n- Query: "quiet" — clicks 1, impressions 500, CTR 0\.20%, average position 12\.0/);
    assert.match(t, /QUERY IMPROVING[^\n]*\(0\)\n- none/);
    assert.match(t, /QUERY DECLINING[^\n]*\(1\)\n- Query: "slip"/);
    assert.match(t, /QUERY ROWS THAT APPEARED in the latest top 25[^\n]*\(2\)\n- Query: "fresh"[^\n]*\n- Query: "quiet"/);
    assert.match(t, /QUERY ROWS THAT LEFT the observed top 25 \(present before, absent now — not proven lost\) \(1\)\n- Query: "gone"/);
    assert.doesNotMatch(t, /PAGE/);
    assert.ok(!t.includes("halcyon.example/blog"));
  });

  test("the analytics audience gets the page side only, never the query lists", () => {
    const t = analytics.text;
    assert.match(t, /PAGE MOVEMENTS \(1 pages in both windows' top 25/);
    assert.ok(t.includes('- Page: "https://halcyon.example/" — clicks 40 → 50 (+10; +25.0%)'));
    assert.match(t, /PAGE OPPORTUNITIES[^\n]*\(1\)\n- Page: "https:\/\/halcyon\.example\/blog"/);
    assert.match(t, /PAGE ROWS THAT APPEARED[^\n]*\(1\)\n- Page: "https:\/\/halcyon\.example\/blog"/);
    assert.doesNotMatch(t, /QUERY/);
    assert.ok(!t.includes('"stay"') && !t.includes('"gone"'));
  });

  test("the summary carries the metadata the run stores, and bytes are the text's own", () => {
    assert.deepEqual(keyword.summary, {
      history: "available",
      audience: "keyword",
      snapshotsUsed: 2,
      latestEndDate: "2026-09-17",
      previousEndDate: "2026-09-03",
      gapDays: 14,
      confidence: "normal",
      latestPartial: [],
      previousPartial: [],
      truncated: false,
      bytes: bytes(keyword.text),
    });
    assert.equal(analytics.summary.audience, "analytics");
  });

  test("the block ends with the history limits note", () => {
    assert.ok(keyword.text.endsWith(SEARCH_CONSOLE_HISTORY_LIMITS_NOTE));
    assert.ok(analytics.text.endsWith(SEARCH_CONSOLE_HISTORY_LIMITS_NOTE));
  });
});

describe("history missing", () => {
  const cases: [HistoryInput, string, RegExp][] = [
    [{ available: false, reason: "not-kept" }, "not-kept", /^STORED SEARCH CONSOLE HISTORY: none\. This deployment keeps no stored snapshots/],
    [{ available: false, reason: "read-failed" }, "read-failed", /^STORED SEARCH CONSOLE HISTORY: unavailable\. The stored snapshots could not be read/],
    [compareSnapshotHistory([], PROPERTY), "no-snapshots", /^STORED SEARCH CONSOLE HISTORY: none yet\. No snapshot has been stored/],
    [compareSnapshotHistory([{ ...LATEST, property: "sc-domain:old.example" }], PROPERTY), "no-history-for-property", /none for the current property\. 1 stored snapshot\(s\) describe a property this project was mapped to earlier/],
    [compareSnapshotHistory([LATEST], PROPERTY), "insufficient-history", /insufficient\. 1 stored snapshot\(s\) for this property, the latest ending 2026-09-17; a comparison needs two at least 7 days apart/],
  ];

  test("each case is one short note that tells the model to infer nothing, with no lists and no figures", () => {
    for (const [input, status, pattern] of cases) {
      const g = formatSearchConsoleHistory(input, "keyword");
      assert.match(g.text, pattern);
      assert.match(g.text, /Only the live report above is available|only the live report above is available/);
      assert.match(g.text, /[Dd]o not infer any history/);
      assert.ok(!g.text.includes("MOVEMENTS") && !g.text.includes("→"), status);
      assert.ok(bytes(g.text) < 400);
      assert.deepEqual([g.summary.history, g.summary.snapshotsUsed, g.summary.gapDays, g.summary.confidence, g.summary.previousEndDate], [status, 0, null, null, null]);
    }
    assert.equal(formatSearchConsoleHistory(cases[4][0], "analytics").summary.latestEndDate, "2026-09-17");
  });
});

describe("partial and no-data sides", () => {
  test("queries unavailable on either side: the query lists are not compared and nothing is inferred; pages still are", () => {
    const g = formatSearchConsoleHistory(compared(snap("2026-09-17", { queries: [], pages: LATEST.pages, partial: ["queries-unavailable"] }), PREVIOUS), "keyword");
    assert.match(g.text, /QUERY LISTS: not compared — queries were unavailable in one of the two snapshots\. Nothing is inferred in their place\./);
    assert.doesNotMatch(g.text, /QUERY MOVEMENTS/);
    assert.match(g.text, /Confidence: low — the latest snapshot is partial \(queries-unavailable\)/);
    assert.deepEqual([g.summary.confidence, g.summary.latestPartial], ["low", ["queries-unavailable"]]);
    const a = formatSearchConsoleHistory(compared(snap("2026-09-17", { queries: [], pages: LATEST.pages, partial: ["queries-unavailable"] }), PREVIOUS), "analytics");
    assert.match(a.text, /PAGE MOVEMENTS/);
  });

  test("pages unavailable on the previous side: the page lists are not compared", () => {
    const a = formatSearchConsoleHistory(compared(LATEST, snap("2026-09-03", { queries: PREVIOUS.queries, partial: ["pages-unavailable"] })), "analytics");
    assert.match(a.text, /PAGE LISTS: not compared — pages were unavailable in one of the two snapshots/);
    assert.deepEqual(a.summary.previousPartial, ["pages-unavailable"]);
  });

  test("a no-data latest window: no totals and no lists, said plainly", () => {
    const g = formatSearchConsoleHistory(compared(snap("2026-09-17", { state: "no-data" }), PREVIOUS), "keyword");
    assert.match(g.text, /States: latest no-data, previous connected\. Confidence: low — the latest window reported no impressions/);
    assert.match(g.text, /- The latest stored window reported no impressions at all \(no-data\), so there are no totals to compare\./);
    assert.match(g.text, /QUERY LISTS: not compared — the latest stored window reported no impressions/);
  });

  test("a no-data previous window: counts against zero with no percentage, position not established, every row appeared", () => {
    const g = formatSearchConsoleHistory(compared(LATEST, snap("2026-09-03", { state: "no-data" })), "keyword");
    assert.match(g.text, /the previous window reported no impressions, so every count is against zero/);
    assert.match(g.text, /- Clicks: 0 → 120 \(\+120; previous was 0, so no percentage\)/);
    assert.match(g.text, /- Average position: 12\.4 \(previous not established: no impressions\)/);
    assert.match(g.text, /QUERY MOVEMENTS \(0 queries[^\n]*— none: the previous window had no impressions/);
    assert.match(g.text, /QUERY ROWS THAT APPEARED[^\n]*\(4\)/);
  });
});

describe("bounds", () => {
  const many = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => row(`${prefix}${i}`, 1, 500 + i, 5 + (i % 3)));

  test("at most 25 movement rows and 10 rows per summary list, with the counts stated", () => {
    const previous = snap("2026-09-03", { queries: many("q", 25) });
    const latest = snap("2026-09-17", { queries: many("q", 25).map((r) => ({ ...r, position: r.position - 2 })) });
    const g = formatSearchConsoleHistory(compared(latest, previous), "keyword");
    assert.match(g.text, /QUERY MOVEMENTS \(25 queries/);
    assert.match(g.text, /QUERY OPPORTUNITIES[^\n]*\(10 of 25\)/);
    assert.match(g.text, /QUERY IMPROVING[^\n]*\(10 of 25\)/);
    assert.equal((g.text.match(/^- Query: /gm) ?? []).length, 25 + 10 + 10);
    assert.deepEqual([MAX_HISTORY_MOVEMENT_ROWS, MAX_HISTORY_SUMMARY_ROWS], [25, 10]);
  });

  test("a long key is cut at the live block's limit and marked", () => {
    const long = "x".repeat(MAX_QUERY_LENGTH + 50);
    const g = formatSearchConsoleHistory(compared(snap("2026-09-17", { queries: [row(long, 1, 10, 3)] }), snap("2026-09-03", { queries: [row(long, 1, 10, 3)] })), "keyword");
    assert.ok(g.text.includes(`"${"x".repeat(MAX_QUERY_LENGTH)}…"`));
    assert.ok(!g.text.includes("x".repeat(MAX_QUERY_LENGTH + 1)));
  });

  test("the whole block stays under 16,000 bytes with full lists of long keys; sections are cut in order and the limits note is kept", () => {
    const key = (i: number) => `${"w".repeat(190)}${String(i).padStart(3, "0")}`;
    const rows = (shift: number) => Array.from({ length: 25 }, (_, i) => row(key(i), 1, 1000 + i, 15 - shift));
    const g = formatSearchConsoleHistory(compared(snap("2026-09-17", { queries: rows(3) }), snap("2026-09-03", { queries: rows(0) })), "keyword");
    assert.ok(bytes(g.text) <= MAX_HISTORY_BYTES, `${bytes(g.text)} bytes`);
    assert.equal(g.summary.bytes, bytes(g.text));
    assert.ok(g.text.endsWith(SEARCH_CONSOLE_HISTORY_LIMITS_NOTE));
    assert.equal(g.summary.truncated, true);
    assert.match(g.text, /\(further history sections were cut to keep this evidence within its size bound\)/);
    assert.match(g.text, /QUERY MOVEMENTS/);
    assert.equal(MAX_HISTORY_BYTES, 16_000);
  });

  test("a typical block is well under the ceiling and not cut", () => {
    const g = formatSearchConsoleHistory(compared(LATEST, PREVIOUS), "keyword");
    assert.ok(bytes(g.text) < 4_000);
    assert.equal(g.summary.truncated, false);
  });
});

describe("limits and instructions", () => {
  test("the history limits note denies volume, difficulty, query-to-page, cannibalisation, complete rankings, trends and rank tracking", () => {
    for (const phrase of [
      "no search volume, keyword difficulty, SERP feature, competitor or ranking-cause data",
      "Nothing here maps a query to a page",
      "No cannibalisation conclusion can be drawn",
      "an observed cut, not a complete ranking",
      "not a long-term trend and says nothing about cause",
      "not a rank tracker reading",
      "labels for review, not findings",
    ]) {
      assert.ok(SEARCH_CONSOLE_HISTORY_LIMITS_NOTE.includes(phrase), `missing: ${phrase}`);
    }
  });

  test("the live limits note keeps its earlier statements and now also denies cannibalisation and rank tracking", () => {
    for (const phrase of ["not every query the property received", "no search volume, keyword difficulty", "Nothing here maps a query to a page", "not a trend", "No cannibalisation conclusion", "not a rank tracker reading"]) {
      assert.ok(SEARCH_CONSOLE_LIMITS_NOTE.includes(phrase), `missing: ${phrase}`);
    }
  });

  test("both task instructions tell the model how to read a stored history block and what never to conclude from it", () => {
    for (const instructions of [SEARCH_QUERY_REVIEW_INSTRUCTIONS, PERFORMANCE_REVIEW_INSTRUCTIONS]) {
      assert.ok(instructions.includes("Where a STORED HISTORY block follows the report"));
      assert.ok(instructions.includes("never read it as a long-term trend, a ranking cause, a SERP feature, a cannibalisation finding or a query mapped to a page"));
      assert.ok(instructions.includes("If it says history is unavailable or insufficient, say so and infer nothing in its place"));
      assert.ok(instructions.includes("Do not state or estimate search volume, keyword difficulty"));
    }
    assert.ok(SEARCH_QUERY_REVIEW_INSTRUCTIONS.includes("opportunity, improving, declining, appeared and left labels as review lists rather than findings"));
    assert.ok(PERFORMANCE_REVIEW_INSTRUCTIONS.includes("state its confidence and any partial or no-data side"));
  });

  test("no output field claims volume, difficulty, a SERP feature, a cause or cannibalisation as data", () => {
    const g = formatSearchConsoleHistory(compared(LATEST, PREVIOUS), "keyword");
    const body = g.text.slice(0, g.text.indexOf("LIMITS OF THIS HISTORY")).toLowerCase();
    for (const word of ["volume", "difficulty", "serp", "cannibal", "because"]) assert.ok(!body.includes(word), word);
    assert.ok(!JSON.stringify(g.summary).toLowerCase().includes("volume"));
  });
});
