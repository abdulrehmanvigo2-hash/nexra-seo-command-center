import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { QUERY_PAGE_READ_COLUMNS, QueryPageRowError, queryPageRowToStored, recordResultToOutcome } from "./supabase/schema.ts";
import { QUERY_PAGE_LIST_LIMIT, QUERY_PAGE_ROW_LIMIT, unavailableSearchConsoleQueryPageStore } from "./contract.ts";

/** P4c store translation: a row the migration would not have written is refused at read time, never passed on. */

const ROW = {
  id: "0f8d7c1e-0000-4000-8000-000000000001",
  project_id: "nexra-agency",
  property: "sc-domain:nexraagency.com",
  range_id: "30d",
  days: 30,
  start_date: "2026-08-19",
  end_date: "2026-09-17",
  query: "seo agency london",
  page: "https://nexraagency.com/",
  clicks: 12,
  impressions: 300,
  ctr: 0.04,
  position: 4.1,
  source: "scheduled",
  fetched_at: "2026-09-18T12:00:00.000Z",
  captured_at: "2026-09-18T12:00:01.000Z",
};

describe("queryPageRowToStored", () => {
  test("translates a row the migration declares, naming every read column", () => {
    assert.deepEqual(queryPageRowToStored(ROW), {
      id: ROW.id, projectId: "nexra-agency", property: ROW.property, rangeId: "30d", days: 30, startDate: "2026-08-19", endDate: "2026-09-17",
      query: "seo agency london", page: "https://nexraagency.com/", clicks: 12, impressions: 300, ctr: 0.04, position: 4.1, source: "scheduled",
      fetchedAt: ROW.fetched_at, capturedAt: ROW.captured_at,
    });
    assert.deepEqual(QUERY_PAGE_READ_COLUMNS.split(", ").sort(), Object.keys(ROW).sort());
  });

  test("refuses a shape the migration would not have written", () => {
    const bad: Record<string, unknown>[] = [
      { range_id: "7d" }, { days: 7 }, { source: "manual" }, { query: "" }, { page: "" }, { query: "k".repeat(2049) }, { clicks: "12" }, { impressions: Number.NaN }, { start_date: "yesterday" }, { id: 1 },
    ];
    for (const over of bad) assert.throws(() => queryPageRowToStored({ ...ROW, ...over }), QueryPageRowError, JSON.stringify(over));
    assert.throws(() => queryPageRowToStored(null), QueryPageRowError);
    assert.throws(() => queryPageRowToStored([ROW]), QueryPageRowError);
  });
});

describe("recordResultToOutcome", () => {
  test("created and exists carry a whole count; not-found carries nothing; anything else is refused", () => {
    assert.deepEqual(recordResultToOutcome({ outcome: "created", count: 250 }), { status: "created", count: 250 });
    assert.deepEqual(recordResultToOutcome({ outcome: "exists", count: 3 }), { status: "exists", count: 3 });
    assert.deepEqual(recordResultToOutcome({ outcome: "not-found" }), { status: "not-found" });
    for (const answer of [{ outcome: "created" }, { outcome: "created", count: -1 }, { outcome: "created", count: 1.5 }, { outcome: "updated", count: 1 }, null, "created"]) {
      assert.throws(() => recordResultToOutcome(answer), QueryPageRowError, JSON.stringify(answer));
    }
  });

  test("the limits agree with the migration and the read ceiling holds three captures", () => {
    assert.equal(QUERY_PAGE_ROW_LIMIT, 250);
    assert.equal(QUERY_PAGE_LIST_LIMIT, 750);
  });

  test("the unavailable store refuses rather than pretends", async () => {
    assert.equal(unavailableSearchConsoleQueryPageStore.storesQueryPages, false);
    assert.deepEqual(await unavailableSearchConsoleQueryPageStore.record({ projectId: "p", property: "sc-domain:x.example", window: { rangeId: "30d", startDate: "2026-08-19", endDate: "2026-09-17", days: 30 }, pairs: [], fetchedAt: "" }), { status: "not-found" });
    assert.deepEqual(await unavailableSearchConsoleQueryPageStore.listQueryPages("p", "30d", 1), []);
  });
});
