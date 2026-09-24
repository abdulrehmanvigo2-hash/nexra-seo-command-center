import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordResultToOutcome, snapshotRowToSnapshot, type SearchConsoleSnapshotsDatabase } from "./schema.ts";
import { createSupabaseSearchConsoleSnapshotStore, SearchConsoleSnapshotStoreError } from "./store.ts";
import type { RecordSnapshotInput } from "../contract.ts";

/**
 * Milestone M1, checkpoint 1b. On trial: that the store calls exactly the
 * CP1a database function with exactly its parameters, that what the
 * function answers is read field by field, and that a row the migration
 * would never produce is refused rather than passed on.
 */

const MIGRATION = "supabase/migrations/20260927120000_create_search_console_snapshots.sql";

const ROW = {
  id: "5b8a6b4e-8c0e-4d6f-9d1a-2f7c3b4a5d6e",
  project_id: "halcyon-fintech",
  property: "sc-domain:halcyon.example",
  range_id: "30d",
  days: 30,
  start_date: "2026-08-23",
  end_date: "2026-09-21",
  state: "connected",
  clicks: 120,
  impressions: 4000,
  ctr: 0.03,
  position: 12.4,
  queries: [{ key: "q1", clicks: 1, impressions: 10, ctr: 0.1, position: 4.5 }],
  pages: [],
  partial: ["pages-unavailable"],
  source: "scheduled",
  fetched_at: "2026-09-24T11:59:00+00:00",
  captured_at: "2026-09-24T12:00:00+00:00",
};

const INPUT: RecordSnapshotInput = {
  projectId: "halcyon-fintech",
  property: "sc-domain:halcyon.example",
  window: { rangeId: "30d", startDate: "2026-08-23", endDate: "2026-09-21", days: 30 },
  state: "connected",
  totals: { clicks: 120, impressions: 4000, ctr: 0.03, position: 12.4 },
  queries: [{ key: "q1", clicks: 1, impressions: 10, ctr: 0.1, position: 4.5 }],
  pages: [{ key: "https://halcyon.example/", clicks: 2, impressions: 20, ctr: 0.1, position: 3 }],
  partial: [],
  fetchedAt: "2026-09-24T11:59:00.000Z",
};

function fakeClient(answer: { data?: unknown; error?: { code: string; message: string } }) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return { data: answer.data ?? null, error: answer.error ?? null };
    },
  } as unknown as SupabaseClient<SearchConsoleSnapshotsDatabase>;
  return { client, calls };
}

/** The parameter names of the record function, in order, as the CP1a migration declares them. */
function migrationParameters(): string[] {
  const sql = readFileSync(MIGRATION, "utf8");
  const match = sql.match(/create function public\.nexra_search_console_snapshot_record\(([\s\S]*?)\)\s*returns jsonb/);
  assert.ok(match, "the CP1a migration declares the record function");
  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("p_"))
    .map((line) => line.split(/\s+/)[0]);
}

describe("the store against the CP1a function", () => {
  test("calls nexra_search_console_snapshot_record with exactly the migration's parameters, in its order", async () => {
    const { client, calls } = fakeClient({ data: { outcome: "created", snapshot: ROW } });
    await createSupabaseSearchConsoleSnapshotStore(client).record(INPUT);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].fn, "nexra_search_console_snapshot_record");
    assert.deepEqual(Object.keys(calls[0].args), migrationParameters());
    assert.equal(migrationParameters().length, 14);
  });

  test("passes the window's dates, the totals, the rows with only the five row fields, the markers and the stamp", async () => {
    const { client, calls } = fakeClient({ data: { outcome: "created", snapshot: ROW } });
    await createSupabaseSearchConsoleSnapshotStore(client).record({ ...INPUT, queries: [{ ...INPUT.queries[0], extra: "no" } as never] });
    const args = calls[0].args;
    assert.deepEqual(
      [args.p_project_id, args.p_property, args.p_range_id, args.p_start_date, args.p_end_date, args.p_state],
      ["halcyon-fintech", "sc-domain:halcyon.example", "30d", "2026-08-23", "2026-09-21", "connected"],
    );
    assert.deepEqual([args.p_clicks, args.p_impressions, args.p_ctr, args.p_position], [120, 4000, 0.03, 12.4]);
    assert.deepEqual(args.p_queries, [{ key: "q1", clicks: 1, impressions: 10, ctr: 0.1, position: 4.5 }]);
    assert.deepEqual(args.p_pages, INPUT.pages);
    assert.deepEqual([args.p_partial, args.p_fetched_at], [[], "2026-09-24T11:59:00.000Z"]);
  });

  test("a no-data input sends null totals and empty lists, as the table's constraints require", async () => {
    const { client, calls } = fakeClient({ data: { outcome: "created", snapshot: { ...ROW, state: "no-data", clicks: null, impressions: null, ctr: null, position: null, queries: [], partial: [] } } });
    const outcome = await createSupabaseSearchConsoleSnapshotStore(client).record({ ...INPUT, state: "no-data", totals: null, queries: [], pages: [], partial: [] });
    const args = calls[0].args;
    assert.deepEqual([args.p_state, args.p_clicks, args.p_impressions, args.p_ctr, args.p_position, args.p_queries, args.p_pages, args.p_partial], ["no-data", null, null, null, null, [], [], []]);
    assert.ok(outcome.status === "created" && outcome.snapshot.state === "no-data" && outcome.snapshot.totals === null);
  });

  test("created, exists and not-found are read back; a database error is thrown with its code", async () => {
    const exists = fakeClient({ data: { outcome: "exists", snapshot: ROW } });
    const read = await createSupabaseSearchConsoleSnapshotStore(exists.client).record(INPUT);
    assert.ok(read.status === "exists" && read.snapshot.id === ROW.id);

    const missing = fakeClient({ data: { outcome: "not-found" } });
    assert.deepEqual(await createSupabaseSearchConsoleSnapshotStore(missing.client).record(INPUT), { status: "not-found" });

    const failing = fakeClient({ error: { code: "23514", message: "new row violates check constraint" } });
    await assert.rejects(
      () => createSupabaseSearchConsoleSnapshotStore(failing.client).record(INPUT),
      (error: unknown) => error instanceof SearchConsoleSnapshotStoreError && error.code === "23514" && /23514/.test(error.message),
    );
  });
});

describe("reading a snapshot row", () => {
  test("maps every column", () => {
    const snapshot = snapshotRowToSnapshot(ROW);
    assert.deepEqual(snapshot, {
      id: ROW.id,
      projectId: "halcyon-fintech",
      property: "sc-domain:halcyon.example",
      rangeId: "30d",
      days: 30,
      startDate: "2026-08-23",
      endDate: "2026-09-21",
      state: "connected",
      totals: { clicks: 120, impressions: 4000, ctr: 0.03, position: 12.4 },
      queries: [{ key: "q1", clicks: 1, impressions: 10, ctr: 0.1, position: 4.5 }],
      pages: [],
      partial: ["pages-unavailable"],
      source: "scheduled",
      fetchedAt: "2026-09-24T11:59:00+00:00",
      capturedAt: "2026-09-24T12:00:00+00:00",
    });
  });

  test("refuses a row the migration would never produce", () => {
    const refused: [string, unknown][] = [
      ["range", { ...ROW, range_id: "7d" }],
      ["days", { ...ROW, days: 29 }],
      ["state", { ...ROW, state: "unknown" }],
      ["source", { ...ROW, source: "manual" }],
      ["no-data with totals", { ...ROW, state: "no-data" }],
      ["connected without totals", { ...ROW, clicks: null }],
      ["date", { ...ROW, end_date: "21/09/2026" }],
      ["rows", { ...ROW, queries: "[]" }],
      ["too many rows", { ...ROW, queries: Array.from({ length: 26 }, (_, i) => ({ key: `q${i}`, clicks: 1, impressions: 1, ctr: 1, position: 1 })) }],
      ["row key", { ...ROW, queries: [{ key: "", clicks: 1, impressions: 1, ctr: 1, position: 1 }] }],
      ["row metric", { ...ROW, queries: [{ key: "q", clicks: "1", impressions: 1, ctr: 1, position: 1 }] }],
      ["partial", { ...ROW, partial: ["comparison-unavailable"] }],
      ["not an object", []],
    ];
    for (const [what, row] of refused) {
      assert.throws(() => snapshotRowToSnapshot(row), /Search Console snapshot row/, what);
    }
  });

  test("an answer the function never promised is an error, not a guess", () => {
    assert.throws(() => recordResultToOutcome({ outcome: "updated", snapshot: ROW }), /does not recognise/);
    assert.throws(() => recordResultToOutcome(null), /not an object/);
    assert.throws(() => recordResultToOutcome({ outcome: "created" }), /snapshot row is not an object/);
  });
});
