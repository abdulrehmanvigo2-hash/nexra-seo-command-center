import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { SearchConsoleSnapshot } from "../snapshots/contract.ts";
import type { SearchPerformanceRow } from "../../../types/search-console.ts";
import { compareSnapshotHistory } from "./compare.ts";
import {
  CONFIDENCE_COPY,
  HISTORY_CAVEATS,
  HISTORY_KEY_MAX,
  HISTORY_LIST_LIMIT,
  LIST_UNAVAILABLE_COPY,
  describeHistoryStatus,
  historyReadFailure,
  historyUrl,
  presentHistory,
} from "./view.ts";

/**
 * Every case is a way the history section could mislead an operator: a
 * cut list read as the whole, a zero baseline shown as a percentage, an
 * absent previous position shown as unchanged, a property or snapshot id
 * reaching the browser, or a missing comparison read as "nothing changed".
 * Fixtures only; nothing here touches a store.
 */

const PROPERTY = "sc-domain:nexraagency.com";

function row(key: string, clicks: number, impressions: number, position: number): SearchPerformanceRow {
  return { key, clicks, impressions, ctr: impressions === 0 ? 0 : clicks / impressions, position };
}

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
    queries: [row("nexra seo", 120, 3_000, 2.1), row("seo agency", 40, 4_000, 8.4), row("ai seo tools", 5, 2_000, 14.2)],
    pages: [row("https://nexraagency.com/", 150, 6_000, 3.0), row("https://nexraagency.com/services", 30, 2_500, 9.1)],
    partial: [],
    source: "scheduled",
    fetchedAt: `${endDate}T05:30:00.000Z`,
    capturedAt: `${endDate}T05:30:01.000Z`,
    ...over,
  };
}

const LATEST = snapshot("2026-09-24", {
  totals: { clicks: 260, impressions: 12_000, ctr: 0.0217, position: 11.0 },
  queries: [row("nexra seo", 150, 3_200, 1.4), row("seo agency", 45, 4_100, 10.0), row("ai seo tools", 8, 2_400, 13.9), row("new query", 20, 900, 6.0)],
  pages: [row("https://nexraagency.com/", 180, 6_500, 2.2), row("https://nexraagency.com/services", 28, 2_600, 11.5)],
});
const PREVIOUS = snapshot("2026-09-10");
const TWO = compareSnapshotHistory([LATEST, PREVIOUS], PROPERTY);

describe("presentHistory", () => {
  test("projects an available comparison to dates, gap, confidence, totals and both lists, with the caveats", () => {
    const view = presentHistory(TWO);
    assert.equal(view.status, "available");
    if (view.status !== "available") return;
    assert.deepEqual([view.latestEndDate, view.previousEndDate, view.gapDays, view.confidence], ["2026-09-24", "2026-09-10", 14, "normal"]);
    assert.deepEqual([view.latestState, view.previousState, view.historyUnderOtherProperty], ["connected", "connected", false]);
    assert.ok(view.totals);
    assert.deepEqual(view.totals.clicks, { latest: 260, previous: 200, absolute: 60, percent: 30 });
    assert.deepEqual(view.totals.impressions, { latest: 12_000, previous: 10_000, absolute: 2_000, percent: 20 });
    // CTR moves in percentage points, two decimals: 2.00% → 2.17% is +0.17 points.
    assert.deepEqual(view.totals.ctr, { latest: 0.0217, previous: 0.02, points: 0.17 });
    // Position: previous − latest, positive is an improvement.
    assert.deepEqual(view.totals.position, { latest: 11, previous: 12.5, delta: 1.5, direction: "improved" });
    assert.equal(view.totals.previousNoData, false);
    assert.equal(view.caveats, HISTORY_CAVEATS);
  });

  test("lists carry improving, declining and opportunity rows with the true counts, keyed with the row's own position move", () => {
    const view = presentHistory(TWO);
    if (view.status !== "available" || !view.queries.available) return assert.fail("queries expected");
    assert.deepEqual(view.queries.counts, { matched: 3, appeared: 1, left: 0, improving: 0, declining: 1, opportunities: 1 });
    // "nexra seo" moved 0.7 places: under the one-place rule, so not listed as improving.
    assert.deepEqual(view.queries.improving, []);
    assert.deepEqual(view.queries.declining.map((r) => [r.key, r.previousPosition, r.positionDelta, r.clicksAbsolute]), [["seo agency", 8.4, -1.6, 5]]);
    assert.deepEqual(view.queries.opportunities.map((r) => r.key), ["ai seo tools"]);
    assert.ok(view.pages.available);
    assert.deepEqual(view.pages.counts.declining, 1);
  });

  test("cuts every list to HISTORY_LIST_LIMIT rows and keeps the true count beside it", () => {
    // Every row improves by five places and meets the opportunity rule (CTR 0.8%, position ≤ 20, 500 impressions).
    const many = Array.from({ length: 12 }, (_, i) => row(`q${i}`, 4, 500, 20 - i));
    const before = Array.from({ length: 12 }, (_, i) => row(`q${i}`, 4, 500, 25 - i));
    const latest = snapshot("2026-09-24", { queries: many, pages: [] });
    const previous = snapshot("2026-09-10", { queries: before, pages: [] });
    const view = presentHistory(compareSnapshotHistory([latest, previous], PROPERTY));
    if (view.status !== "available" || !view.queries.available) return assert.fail();
    assert.equal(view.queries.improving.length, HISTORY_LIST_LIMIT);
    assert.equal(view.queries.counts.improving, 12);
    assert.equal(view.queries.opportunities.length, HISTORY_LIST_LIMIT);
    assert.equal(view.queries.counts.opportunities, 12);
  });

  test("a zero baseline keeps percent null, and a previous window with no impressions keeps position not established: never a zero", () => {
    const previous = snapshot("2026-09-10", { state: "no-data", totals: null, queries: [], pages: [] });
    const view = presentHistory(compareSnapshotHistory([LATEST, previous], PROPERTY));
    if (view.status !== "available" || !view.totals) return assert.fail();
    assert.equal(view.totals.clicks.percent, null);
    assert.equal(view.totals.impressions.percent, null);
    assert.deepEqual(view.totals.position, { latest: 11, previous: null, delta: null, direction: "not-established" });
    assert.equal(view.totals.previousNoData, true);
    assert.equal(view.confidence, "low");
    assert.ok(view.queries.available && view.queries.previousNoData && view.queries.counts.appeared === 4);
  });

  test("a latest window with no impressions has null totals and unavailable lists, with a reason", () => {
    const latest = snapshot("2026-09-24", { state: "no-data", totals: null, queries: [], pages: [] });
    const view = presentHistory(compareSnapshotHistory([latest, PREVIOUS], PROPERTY));
    if (view.status !== "available") return assert.fail();
    assert.equal(view.totals, null);
    assert.deepEqual(view.queries, { available: false, reason: "no-data-latest" });
    assert.match(LIST_UNAVAILABLE_COPY["no-data-latest"], /no impressions/);
  });

  test("partial history: a missing query list on one side makes queries unavailable while pages still compare", () => {
    const previous = snapshot("2026-09-10", { partial: ["queries-unavailable"], queries: [] });
    const view = presentHistory(compareSnapshotHistory([LATEST, previous], PROPERTY));
    if (view.status !== "available") return assert.fail();
    assert.deepEqual(view.queries, { available: false, reason: "queries-unavailable" });
    assert.ok(view.pages.available);
    assert.deepEqual(view.previousPartial, ["queries-unavailable"]);
    assert.equal(view.confidence, "low");
    assert.match(CONFIDENCE_COPY.low, /Low confidence/);
  });

  test("cuts a key to HISTORY_KEY_MAX characters", () => {
    const long = "https://nexraagency.com/" + "x".repeat(400);
    const latest = snapshot("2026-09-24", { pages: [row(long, 100, 1_000, 5)], queries: [] });
    const previous = snapshot("2026-09-10", { pages: [row(long, 90, 1_000, 8)], queries: [] });
    const view = presentHistory(compareSnapshotHistory([latest, previous], PROPERTY));
    if (view.status !== "available" || !view.pages.available) return assert.fail();
    assert.equal(view.pages.improving[0].key.length, HISTORY_KEY_MAX);
  });

  test("never carries the property, a snapshot id, a full row list or a range beyond the literal", () => {
    const json = JSON.stringify(presentHistory(TWO));
    assert.doesNotMatch(json, /sc-domain|snap-\d|"property"|"id"|"matched":\[|"appeared":\[|"left":\[|capturedAt|fetchedAt/);
  });

  test("each missing-history state is named, with the latest date and the eligible count, and nothing else", () => {
    assert.deepEqual(presentHistory(null), { status: "not-kept" });
    assert.deepEqual(presentHistory({ available: false, reason: "not-kept" }), { status: "not-kept" });
    assert.deepEqual(presentHistory(compareSnapshotHistory([], PROPERTY)), { status: "no-snapshots", latestEndDate: null, eligible: 0 });
    assert.deepEqual(presentHistory(compareSnapshotHistory([LATEST], PROPERTY)), { status: "insufficient-history", latestEndDate: "2026-09-24", eligible: 1 });
    assert.deepEqual(presentHistory(compareSnapshotHistory([LATEST, snapshot("2026-09-20")], PROPERTY)), { status: "insufficient-history", latestEndDate: "2026-09-24", eligible: 2 });
    assert.deepEqual(presentHistory(compareSnapshotHistory([snapshot("2026-09-24", { property: "sc-domain:old.example" })], PROPERTY)), { status: "no-history-for-property", latestEndDate: null, eligible: 0 });
  });

  test("history under a previous property is flagged when the current property also has a comparison", () => {
    const view = presentHistory(compareSnapshotHistory([LATEST, PREVIOUS, snapshot("2026-08-01", { property: "sc-domain:old.example" })], PROPERTY));
    assert.equal(view.status === "available" && view.historyUnderOtherProperty, true);
  });
});

describe("wording", () => {
  test("each missing-history state has a title and a description, and none reads as a comparison of zeros", () => {
    const one = describeHistoryStatus({ status: "insufficient-history", latestEndDate: "2026-09-24", eligible: 1 });
    assert.equal(one.title, "One snapshot stored");
    assert.match(one.description, /ends 2026-09-24/);
    assert.match(describeHistoryStatus({ status: "insufficient-history", latestEndDate: "2026-09-24", eligible: 3 }).title, /Not enough history/);
    assert.match(describeHistoryStatus({ status: "no-snapshots", latestEndDate: null, eligible: 0 }).title, /No stored snapshots/);
    assert.match(describeHistoryStatus({ status: "no-history-for-property", latestEndDate: null, eligible: 0 }).description, /previous property|another Search Console property/);
    assert.match(describeHistoryStatus({ status: "not-kept" }).description, /live report above stands alone/);
  });

  test("the caveats say two windows, not a trend; GSC average position, not a rank tracker; incomplete top rows; no query-to-page mapping; no cannibalisation", () => {
    const all = HISTORY_CAVEATS.join(" ");
    assert.match(all, /Two stored windows compared/);
    assert.match(all, /not a trend/);
    assert.match(all, /not a rank tracker/);
    assert.match(all, /incomplete by design/);
    assert.match(all, /Nothing here maps a query to a page/);
    assert.match(all, /no cannibalisation conclusion/);
  });

  test("the URL fixes the range and encodes the project; a failed read never claims there is no history", () => {
    assert.equal(historyUrl("nexra-agency"), "/api/search-console/history?project=nexra-agency&range=30d");
    assert.equal(historyUrl("a&b"), "/api/search-console/history?project=a%26b&range=30d");
    for (const status of [0, 401, 404, 429, 500, 503]) {
      assert.doesNotMatch(historyReadFailure(status), /no history|no snapshots|no change/i);
    }
    assert.match(historyReadFailure(500), /live report above is unaffected/);
  });
});
