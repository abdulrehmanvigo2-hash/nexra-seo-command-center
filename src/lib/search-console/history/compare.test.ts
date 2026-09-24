import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { SearchPerformanceRow } from "../../../types/search-console.ts";
import type { SearchConsoleSnapshot, SnapshotPartial } from "../snapshots/contract.ts";
import { COMPARISON_CAVEAT, TOP_LIST_CAVEAT, compareRowLists, compareSnapshotHistory, ctrDelta, metricDelta, positionDelta } from "./compare.ts";
import { daysBetween, selectComparableSnapshots } from "./select.ts";
import {
  LOW_CONFIDENCE_GAP_DAYS,
  MIN_GAP_DAYS,
  MOVEMENT_MIN_IMPRESSIONS,
  MOVEMENT_MIN_POSITION_DELTA,
  OPPORTUNITY_MAX_CTR,
  OPPORTUNITY_MAX_POSITION,
  OPPORTUNITY_MIN_IMPRESSIONS,
  isOpportunity,
  movementOf,
} from "./thresholds.ts";

/**
 * Milestone M1, phase 4, checkpoint P4a. On trial: that two stored
 * snapshots are chosen by fixed rules and compared by arithmetic alone —
 * the same input always the same answer — that a zero baseline is never a
 * percentage, that a lower position reads as better, that a list is only
 * compared when both windows carry it, and that a row leaving a top-25 list
 * is never called lost.
 */

const PROPERTY = "sc-domain:halcyon.example";
const OTHER = "https://www.halcyon.example/";

const row = (key: string, clicks: number, impressions: number, position: number): SearchPerformanceRow => ({
  key,
  clicks,
  impressions,
  ctr: impressions > 0 ? clicks / impressions : 0,
  position,
});

let counter = 0;
function snap(
  endDate: string,
  options: {
    state?: SearchConsoleSnapshot["state"];
    property?: string;
    totals?: { clicks: number; impressions: number; ctr: number; position: number } | null;
    queries?: SearchPerformanceRow[];
    pages?: SearchPerformanceRow[];
    partial?: SnapshotPartial[];
    capturedAt?: string;
  } = {},
): SearchConsoleSnapshot {
  const state = options.state ?? "connected";
  counter += 1;
  return {
    id: `snap-${String(counter).padStart(3, "0")}`,
    projectId: "halcyon-fintech",
    property: options.property ?? PROPERTY,
    rangeId: "30d",
    days: 30,
    startDate: endDate,
    endDate,
    state,
    totals: state === "no-data" ? null : (options.totals ?? { clicks: 120, impressions: 4000, ctr: 0.03, position: 12.4 }),
    queries: state === "no-data" ? [] : (options.queries ?? []),
    pages: state === "no-data" ? [] : (options.pages ?? []),
    partial: state === "no-data" ? [] : (options.partial ?? []),
    source: "scheduled",
    fetchedAt: `${endDate}T12:00:00.000Z`,
    capturedAt: options.capturedAt ?? `${endDate}T12:00:00.000Z`,
  };
}

const keys = (rows: readonly { key: string }[]) => rows.map((r) => r.key);

describe("choosing the two snapshots", () => {
  test("no snapshots", () => {
    assert.deepEqual(selectComparableSnapshots([], PROPERTY), { ok: false, reason: "no-snapshots", latestEndDate: null, eligible: 0, otherProperty: 0 });
    assert.equal(compareSnapshotHistory([], PROPERTY).available, false);
  });

  test("one snapshot: insufficient history, naming the one it has", () => {
    const s = selectComparableSnapshots([snap("2026-09-21")], PROPERTY);
    assert.deepEqual(s, { ok: false, reason: "insufficient-history", latestEndDate: "2026-09-21", eligible: 1, otherProperty: 0 });
  });

  test("two snapshots 7 days apart compare; 6 days apart do not", () => {
    const ok = selectComparableSnapshots([snap("2026-09-14"), snap("2026-09-21")], PROPERTY);
    assert.ok(ok.ok && ok.gapDays === MIN_GAP_DAYS && ok.latest.endDate === "2026-09-21" && ok.previous.endDate === "2026-09-14");
    const tooClose = selectComparableSnapshots([snap("2026-09-15"), snap("2026-09-21")], PROPERTY);
    assert.ok(!tooClose.ok && tooClose.reason === "insufficient-history" && tooClose.eligible === 2);
  });

  test("the previous is the newest snapshot at least 7 days older, not the oldest", () => {
    const s = selectComparableSnapshots([snap("2026-08-01"), snap("2026-09-10"), snap("2026-09-14"), snap("2026-09-18"), snap("2026-09-21")], PROPERTY);
    assert.ok(s.ok && s.previous.endDate === "2026-09-14" && s.gapDays === 7);
  });

  test("input order does not matter", () => {
    const a = selectComparableSnapshots([snap("2026-09-21"), snap("2026-09-01"), snap("2026-09-14")], PROPERTY);
    const b = selectComparableSnapshots([snap("2026-09-01"), snap("2026-09-14"), snap("2026-09-21")], PROPERTY);
    assert.ok(a.ok && b.ok && a.latest.endDate === b.latest.endDate && a.previous.endDate === b.previous.endDate);
  });

  test("a property change: rows under the old property are set aside, never mixed in", () => {
    const rows = [snap("2026-09-01", { property: OTHER }), snap("2026-09-10", { property: OTHER }), snap("2026-09-21")];
    const s = selectComparableSnapshots(rows, PROPERTY);
    assert.deepEqual(s, { ok: false, reason: "insufficient-history", latestEndDate: "2026-09-21", eligible: 1, otherProperty: 2 });
    const none = selectComparableSnapshots(rows.slice(0, 2), PROPERTY);
    assert.deepEqual(none, { ok: false, reason: "no-history-for-property", latestEndDate: null, eligible: 0, otherProperty: 2 });
    const c = compareSnapshotHistory([...rows, snap("2026-09-14")], PROPERTY);
    assert.ok(c.available && c.previousEndDate === "2026-09-14" && c.coverage.otherProperty === 2 && c.property === PROPERTY);
  });

  test("days are whole calendar days", () => {
    assert.equal(daysBetween("2026-08-23", "2026-09-21"), 29);
    assert.equal(daysBetween("2026-09-21", "2026-09-21"), 0);
  });
});

describe("metric arithmetic", () => {
  test("clicks and impressions: absolute always, percentage against a positive baseline, one decimal", () => {
    assert.deepEqual(metricDelta(150, 120), { latest: 150, previous: 120, absolute: 30, percent: 25, direction: "up" });
    assert.deepEqual(metricDelta(100, 120), { latest: 100, previous: 120, absolute: -20, percent: -16.7, direction: "down" });
    assert.deepEqual(metricDelta(120, 120), { latest: 120, previous: 120, absolute: 0, percent: 0, direction: "unchanged" });
  });

  test("a zero baseline has no percentage, never infinity", () => {
    assert.deepEqual(metricDelta(40, 0), { latest: 40, previous: 0, absolute: 40, percent: null, direction: "up" });
    assert.deepEqual(metricDelta(0, 0), { latest: 0, previous: 0, absolute: 0, percent: null, direction: "unchanged" });
  });

  test("click-through rate moves in percentage points", () => {
    assert.deepEqual(ctrDelta(0.035, 0.02), { latest: 0.035, previous: 0.02, points: 1.5, direction: "up" });
    assert.deepEqual(ctrDelta(0.02, 0.02), { latest: 0.02, previous: 0.02, points: 0, direction: "unchanged" });
  });

  test("position: previous minus latest, lower is better", () => {
    assert.deepEqual(positionDelta(8.2, 12.4), { latest: 8.2, previous: 12.4, delta: 4.2, direction: "improved" });
    assert.deepEqual(positionDelta(15, 12.4), { latest: 15, previous: 12.4, delta: -2.6, direction: "declined" });
    assert.deepEqual(positionDelta(12.4, 12.4), { latest: 12.4, previous: 12.4, delta: 0, direction: "unchanged" });
    assert.deepEqual(positionDelta(3, null), { latest: 3, previous: null, delta: null, direction: "not-established" });
  });
});

describe("totals and states", () => {
  test("two connected windows: every total compared, normal confidence at 14 days", () => {
    const c = compareSnapshotHistory(
      [snap("2026-09-07", { totals: { clicks: 100, impressions: 5000, ctr: 0.02, position: 14 } }), snap("2026-09-21", { totals: { clicks: 120, impressions: 4000, ctr: 0.03, position: 12.4 } })],
      PROPERTY,
    );
    assert.ok(c.available && c.totals);
    assert.deepEqual([c.gapDays, c.coverage.confidence, c.latestState, c.previousState], [LOW_CONFIDENCE_GAP_DAYS, "normal", "connected", "connected"]);
    assert.deepEqual(c.totals.clicks, { latest: 120, previous: 100, absolute: 20, percent: 20, direction: "up" });
    assert.deepEqual(c.totals.impressions.percent, -20);
    assert.deepEqual(c.totals.ctr.points, 1);
    assert.deepEqual(c.totals.position, { latest: 12.4, previous: 14, delta: 1.6, direction: "improved" });
    assert.equal(c.totals.previousNoData, false);
    assert.equal(c.caveat, COMPARISON_CAVEAT);
  });

  test("no-data latest: no totals, no lists, low confidence", () => {
    const c = compareSnapshotHistory([snap("2026-09-07", { queries: [row("q", 1, 10, 3)] }), snap("2026-09-21", { state: "no-data" })], PROPERTY);
    assert.ok(c.available);
    assert.equal(c.totals, null);
    assert.deepEqual(c.queries, { available: false, reason: "no-data-latest" });
    assert.deepEqual(c.pages, { available: false, reason: "no-data-latest" });
    assert.equal(c.coverage.confidence, "low");
  });

  test("no-data previous: counts against zero with no percentage, position not established, every latest row appeared", () => {
    const c = compareSnapshotHistory([snap("2026-09-07", { state: "no-data" }), snap("2026-09-21", { queries: [row("a", 5, 50, 4), row("b", 9, 90, 6)] })], PROPERTY);
    assert.ok(c.available && c.totals && c.queries.available);
    assert.equal(c.totals.previousNoData, true);
    assert.deepEqual(c.totals.clicks, { latest: 120, previous: 0, absolute: 120, percent: null, direction: "up" });
    assert.equal(c.totals.position.direction, "not-established");
    assert.deepEqual([keys(c.queries.appeared), c.queries.matched, c.queries.left, c.queries.previousNoData], [["b", "a"], [], [], true]);
    assert.equal(c.coverage.confidence, "low");
  });

  test("a short gap is low confidence", () => {
    const c = compareSnapshotHistory([snap("2026-09-14"), snap("2026-09-21")], PROPERTY);
    assert.ok(c.available && c.gapDays === 7 && c.coverage.confidence === "low");
  });
});

describe("partial lists", () => {
  const q = [row("q1", 10, 100, 5)];
  const p = [row("https://halcyon.example/a", 10, 100, 5)];

  test("queries unavailable on the latest side disables query comparison only", () => {
    const c = compareSnapshotHistory([snap("2026-09-07", { queries: q, pages: p }), snap("2026-09-21", { pages: p, partial: ["queries-unavailable"] })], PROPERTY);
    assert.ok(c.available);
    assert.deepEqual(c.queries, { available: false, reason: "queries-unavailable" });
    assert.ok(c.pages.available && c.pages.matched.length === 1);
    assert.deepEqual([c.coverage.latestPartial, c.coverage.confidence], [["queries-unavailable"], "low"]);
  });

  test("pages unavailable on the previous side disables page comparison only", () => {
    const c = compareSnapshotHistory([snap("2026-09-07", { queries: q, partial: ["pages-unavailable"] }), snap("2026-09-21", { queries: q, pages: p })], PROPERTY);
    assert.ok(c.available);
    assert.deepEqual(c.pages, { available: false, reason: "pages-unavailable" });
    assert.ok(c.queries.available && c.queries.matched.length === 1);
    assert.deepEqual(c.coverage.previousPartial, ["pages-unavailable"]);
  });

  test("a previous no-data window is not partial: latest rows appeared even when the latest side lacks the other list", () => {
    const list = compareRowLists("queries", snap("2026-09-21", { queries: q, partial: ["pages-unavailable"] }), snap("2026-09-07", { state: "no-data" }));
    assert.ok(list.available && keys(list.appeared).length === 1);
  });
});

describe("rows appearing, leaving, matching", () => {
  test("appeared and left are by key; left is worded as leaving the observed top 25", () => {
    const previous = snap("2026-09-07", { queries: [row("stay", 10, 100, 5), row("gone", 8, 80, 7)] });
    const latest = snap("2026-09-21", { queries: [row("stay", 12, 100, 4), row("fresh", 3, 30, 9)] });
    const list = compareRowLists("queries", latest, previous);
    assert.ok(list.available);
    assert.deepEqual([keys(list.matched), keys(list.appeared), keys(list.left)], [["stay"], ["fresh"], ["gone"]]);
    assert.equal(list.caveat, TOP_LIST_CAVEAT);
    assert.match(TOP_LIST_CAVEAT, /does not prove it lost/);
    assert.match(TOP_LIST_CAVEAT, /nothing here maps a query to a page/);
  });

  test("a matched row carries every delta and its own movement", () => {
    const list = compareRowLists("queries", snap("2026-09-21", { queries: [row("k", 4, 200, 6)] }), snap("2026-09-07", { queries: [row("k", 2, 100, 9.5)] }));
    assert.ok(list.available);
    const [m] = list.matched;
    assert.deepEqual([m.clicks.absolute, m.clicks.percent, m.impressions.percent, m.ctr.points, m.position.delta, m.position.direction, m.movement], [2, 100, 100, 0, 3.5, "improved", "improving"]);
  });

  test("stable ordering: matched by latest clicks then key; ties broken by key", () => {
    const rows = [row("b", 5, 50, 3), row("a", 5, 50, 3), row("c", 9, 90, 3)];
    const list = compareRowLists("queries", snap("2026-09-21", { queries: rows }), snap("2026-09-07", { queries: [...rows].reverse() }));
    assert.ok(list.available);
    assert.deepEqual(keys(list.matched), ["c", "a", "b"]);
    const again = compareRowLists("queries", snap("2026-09-21", { queries: [...rows].reverse() }), snap("2026-09-07", { queries: rows }));
    assert.ok(again.available);
    assert.deepEqual(keys(again.matched), ["c", "a", "b"]);
  });

  test("pages are compared the same way, independently of queries", () => {
    const c = compareSnapshotHistory(
      [snap("2026-09-07", { pages: [row("https://halcyon.example/x", 10, 100, 5)] }), snap("2026-09-21", { pages: [row("https://halcyon.example/x", 20, 100, 4), row("https://halcyon.example/y", 1, 300, 15)] })],
      PROPERTY,
    );
    assert.ok(c.available && c.pages.available && c.queries.available);
    assert.deepEqual([keys(c.pages.matched), keys(c.pages.appeared), keys(c.pages.opportunities)], [["https://halcyon.example/x"], ["https://halcyon.example/y"], ["https://halcyon.example/y"]]);
    assert.deepEqual([c.queries.matched, c.queries.appeared, c.queries.left], [[], [], []]);
  });
});

describe("thresholds", () => {
  test("opportunity boundaries: impressions ≥ 100, CTR ≤ 1 %, position ≤ 20", () => {
    assert.deepEqual([OPPORTUNITY_MIN_IMPRESSIONS, OPPORTUNITY_MAX_CTR, OPPORTUNITY_MAX_POSITION], [100, 0.01, 20]);
    assert.equal(isOpportunity({ clicks: 1, impressions: 100, ctr: 0.01, position: 20 }), true);
    assert.equal(isOpportunity({ clicks: 0, impressions: 99, ctr: 0, position: 20 }), false);
    assert.equal(isOpportunity({ clicks: 2, impressions: 100, ctr: 0.0101, position: 20 }), false);
    assert.equal(isOpportunity({ clicks: 1, impressions: 100, ctr: 0.01, position: 20.1 }), false);
  });

  test("opportunities come from the latest list, by impressions then key, regardless of the previous list", () => {
    const list = compareRowLists("queries", snap("2026-09-21", { queries: [row("z", 1, 500, 8), row("a", 1, 500, 8), row("m", 1, 900, 12), row("hot", 50, 500, 2)] }), snap("2026-09-07", { queries: [] }));
    assert.ok(list.available);
    assert.deepEqual(keys(list.opportunities), ["m", "a", "z"]);
  });

  test("improving and declining boundaries: one whole place, 20 impressions on both sides", () => {
    assert.deepEqual([MOVEMENT_MIN_POSITION_DELTA, MOVEMENT_MIN_IMPRESSIONS], [1, 20]);
    assert.equal(movementOf(1.0, 20, 20), "improving");
    assert.equal(movementOf(0.9, 20, 20), null);
    assert.equal(movementOf(-1.0, 20, 20), "declining");
    assert.equal(movementOf(-0.9, 20, 20), null);
    assert.equal(movementOf(5, 19, 20), null);
    assert.equal(movementOf(5, 20, 19), null);
    assert.equal(movementOf(0, 20, 20), null);
  });

  test("improving and declining lists are by size of move then key", () => {
    const previous = snap("2026-09-07", { queries: [row("up1", 5, 50, 10), row("up3", 5, 50, 10), row("down2", 5, 50, 5), row("flat", 5, 50, 5), row("thin", 1, 10, 30)] });
    const latest = snap("2026-09-21", { queries: [row("up1", 5, 50, 9), row("up3", 5, 50, 7), row("down2", 5, 50, 7), row("flat", 5, 50, 5.5), row("thin", 1, 10, 3)] });
    const list = compareRowLists("queries", latest, previous);
    assert.ok(list.available);
    assert.deepEqual([keys(list.improving), keys(list.declining)], [["up3", "up1"], ["down2"]]);
    assert.equal(list.matched.find((r) => r.key === "thin")?.movement, null);
  });
});

describe("determinism and bounds", () => {
  test("the same input gives an identical answer twice", () => {
    const rows = [snap("2026-09-07", { queries: [row("a", 1, 200, 3), row("b", 2, 100, 30)] }), snap("2026-09-21", { queries: [row("a", 1, 300, 2), row("c", 4, 40, 8)] })];
    assert.deepEqual(compareSnapshotHistory(rows, PROPERTY), compareSnapshotHistory([...rows].reverse(), PROPERTY));
  });

  test("lists never exceed the stored top 25 on either side", () => {
    const many = (prefix: string) => Array.from({ length: 25 }, (_, i) => row(`${prefix}${i}`, 1, 500 + i, 10));
    const list = compareRowLists("queries", snap("2026-09-21", { queries: many("n") }), snap("2026-09-07", { queries: many("o") }));
    assert.ok(list.available);
    assert.deepEqual([list.appeared.length, list.left.length, list.matched.length, list.opportunities.length], [25, 25, 0, 25]);
  });

  test("no field carries search volume, difficulty or a query-to-page mapping; only the caveats name them, to deny them", () => {
    const c = compareSnapshotHistory([snap("2026-09-07", { queries: [row("q", 1, 10, 3)] }), snap("2026-09-21", { queries: [row("q", 2, 10, 2)] })], PROPERTY);
    assert.ok(c.available && c.queries.available);
    const fields = JSON.stringify({ ...c, caveat: undefined, queries: { ...c.queries, caveat: undefined }, pages: undefined }).toLowerCase();
    assert.ok(!fields.includes("volume") && !fields.includes("difficulty") && !fields.includes("page"));
    assert.match(c.caveat, /no search volume, keyword difficulty/);
    assert.match(c.queries.caveat, /nothing here maps a query to a page/);
  });
});
