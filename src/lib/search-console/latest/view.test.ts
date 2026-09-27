import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { SearchConsoleSnapshot } from "../snapshots/contract.ts";
import {
  LATEST_WINDOW_FOOTER,
  POSITION_NOT_RANK,
  comparisonReadiness,
  describeLatestWindow,
  latestWindowLine,
  latestWindowReadFailure,
  latestWindowTiles,
  latestWindowUrl,
  presentLatestWindow,
  type LatestWindowView,
} from "./view.ts";

/**
 * Checkpoint 4.3: the Analytics tiles read the latest stored window only
 * (decision Q6). Each case is a way the tiles could mislead: an older or
 * another property's window shown as current, a no-data window shown as
 * zeros, a position read as a rank, a comparison claimed before two windows
 * a week apart exist, or the property reaching the browser. Fixtures mirror
 * production's figures (144 impressions, 1 click, 0.69%, position 30.5).
 */

const PROPERTY = "sc-domain:nexraagency.com";

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
    totals: { clicks: 0, impressions: 132, ctr: 0, position: 29.045 },
    queries: [],
    pages: [],
    partial: [],
    source: "scheduled",
    fetchedAt: `${endDate}T06:20:00.000Z`,
    capturedAt: `${endDate}T06:20:01.000Z`,
    ...over,
  };
}

const PRODUCTION = [
  snapshot("2026-09-21"),
  snapshot("2026-09-24", { totals: { clicks: 1, impressions: 144, ctr: 1 / 144, position: 30.5 }, capturedAt: "2026-09-27T06:20:21.000Z" }),
  snapshot("2026-09-22", { totals: { clicks: 0, impressions: 138, ctr: 0, position: 30.565 } }),
];

function windowOf(view: LatestWindowView) {
  assert.equal(view.status, "window");
  return view as Extract<LatestWindowView, { status: "window" }>;
}

describe("presentLatestWindow", () => {
  test("reads the newest window of the current property, whatever the input order", () => {
    const view = windowOf(presentLatestWindow(PRODUCTION, PROPERTY));
    assert.equal(view.endDate, "2026-09-24");
    assert.equal(view.startDate, "2026-08-26");
    assert.deepEqual(view.totals, { clicks: 1, impressions: 144, ctr: 1 / 144, position: 30.5 });
    assert.equal(view.storedWindows, 3);
    assert.equal(view.oldestEndDate, "2026-09-21");
  });

  test("the tiles show Google's four figures, the position labelled not rank, and no delta", () => {
    const tiles = latestWindowTiles(windowOf(presentLatestWindow(PRODUCTION, PROPERTY)));
    assert.ok(tiles);
    assert.deepEqual(
      tiles.map((t) => [t.id, t.value]),
      [
        ["clicks", "1"],
        ["impressions", "144"],
        ["ctr", "0.69%"],
        ["position", "30.5"],
      ],
    );
    assert.equal(tiles[3].detail, POSITION_NOT_RANK);
    assert.equal(POSITION_NOT_RANK, "Search Console average position, not rank");
    for (const tile of tiles) assert.equal("trend" in tile, false);
  });

  test("the window line states the window, the capture and the stored count", () => {
    const line = latestWindowLine(windowOf(presentLatestWindow(PRODUCTION, PROPERTY)));
    assert.equal(line, "Latest stored window 26 Aug 2026 – 24 Sep 2026 · captured 27 Sep 2026 · 3 stored windows");
    assert.match(LATEST_WINDOW_FOOTER, /latest window only/);
  });

  test("history is insufficient until two windows are 7 days apart, and it says when the first could be", () => {
    const view = windowOf(presentLatestWindow(PRODUCTION, PROPERTY));
    assert.equal(view.comparable, false);
    assert.equal(view.firstComparableEndDate, "2026-09-28");
    const line = comparisonReadiness(view);
    assert.match(line, /^Stored history is insufficient to compare/);
    assert.match(line, /oldest stored window ends 21 Sep 2026 and the latest 24 Sep 2026/);
    assert.match(line, /at least 7 days apart — the first possible is a window ending 28 Sep 2026 or later/);
  });

  test("a window ending 7 days after the oldest makes history sufficient", () => {
    const view = windowOf(presentLatestWindow([...PRODUCTION, snapshot("2026-09-28")], PROPERTY));
    assert.equal(view.comparable, true);
    assert.equal(view.endDate, "2026-09-28");
    assert.match(comparisonReadiness(view), /^Stored history is sufficient/);
    // 6 days is not enough.
    assert.equal(windowOf(presentLatestWindow([...PRODUCTION, snapshot("2026-09-27")], PROPERTY)).comparable, false);
  });

  test("another property's windows are set aside, never shown as current", () => {
    const other = snapshot("2026-09-30", { property: "sc-domain:old.example", totals: { clicks: 99, impressions: 9_999, ctr: 0.01, position: 3 } });
    const view = windowOf(presentLatestWindow([...PRODUCTION, other], PROPERTY));
    assert.equal(view.endDate, "2026-09-24");
    assert.equal(view.storedWindows, 3);
    assert.deepEqual(presentLatestWindow([other], PROPERTY), { status: "no-history-for-property" });
  });

  test("a no-data window has no tiles rather than zeros", () => {
    const view = windowOf(presentLatestWindow([snapshot("2026-09-24", { state: "no-data", totals: null })], PROPERTY));
    assert.equal(view.totals, null);
    assert.equal(latestWindowTiles(view), null);
    assert.match(latestWindowLine(view), /Google reported no impressions/);
  });

  test("a partial window says which list was unavailable", () => {
    const view = windowOf(presentLatestWindow([snapshot("2026-09-24", { partial: ["queries-unavailable"] })], PROPERTY));
    assert.match(latestWindowLine(view), /partial: queries unavailable/);
  });

  test("no snapshots, and the view never carries the property or a snapshot id", () => {
    assert.deepEqual(presentLatestWindow([], PROPERTY), { status: "no-snapshots" });
    const json = JSON.stringify(presentLatestWindow(PRODUCTION, PROPERTY));
    assert.doesNotMatch(json, /sc-domain|snap-|"property"|"id"/);
  });

  test("empty states and read failures are worded apart", () => {
    assert.equal(describeLatestWindow({ status: "no-snapshots" }).title, "No stored window yet");
    assert.equal(describeLatestWindow({ status: "not-kept" }).title, "No stored snapshots on this deployment");
    assert.match(describeLatestWindow({ status: "no-history-for-property" }).description, /set aside/);
    assert.match(latestWindowReadFailure(503), /read failure, not an empty window/);
    assert.equal(latestWindowUrl("nexra-agency"), "/api/search-console/latest-window?project=nexra-agency");
  });
});
