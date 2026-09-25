import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ProviderResult, SearchConsoleProvider } from "../provider.ts";
import type { SearchConsoleWindow, SearchPerformance, SearchPerformanceRow, SearchQueryPageRow } from "../../../types/search-console.ts";
import { QUERY_PAGE_ROW_LIMIT, type RecordQueryPagesInput, type RecordQueryPagesOutcome, type SearchConsoleQueryPageStore } from "../query-pages/contract.ts";
import {
  MAX_CAPTURE_PROJECTS,
  MIN_PAIR_BUDGET_MS,
  MIN_PROJECT_BUDGET_MS,
  createSnapshotCapture,
  isRecordableTotals,
  queryPageRows,
  snapshotRows,
  snapshotWindow,
  type SnapshotCaptureDependencies,
  type SnapshotCaptureLog,
} from "./capture.ts";
import {
  SNAPSHOT_MAX_KEY_LENGTH,
  SNAPSHOT_MAX_ROWS,
  unavailableSearchConsoleSnapshotStore,
  type RecordSnapshotInput,
  type RecordSnapshotOutcome,
  type SearchConsoleSnapshot,
  type SearchConsoleSnapshotStore,
} from "./contract.ts";

/**
 * Milestone M1, checkpoint 1b. On trial: that a snapshot is written only
 * for a stored project's own mapped property, from a fresh answer Google
 * gave for that property over the 30-day window; that every failure keeps
 * its name and none becomes a no-data row; that the capture stays within
 * its project and time limits; and that nothing Google returned reaches a
 * log line.
 */

const NOW = new Date("2026-09-24T12:00:00Z");
const HALCYON = "halcyon-fintech";
const VERDANT = "verdant-home";
const PROPERTIES = new Map([
  [HALCYON, "sc-domain:halcyon.example"],
  [VERDANT, "https://www.verdanthome.example/"],
]);
const TOTALS: SearchPerformance = { clicks: 120, impressions: 4000, ctr: 0.03, position: 12.4 };
const FETCHED = "2026-09-24T11:59:00.000Z";

const row = (key: string, clicks = 1, impressions = 10): SearchPerformanceRow => ({ key, clicks, impressions, ctr: clicks / impressions, position: 4.2 });
const rows = (n: number, prefix = "q") => Array.from({ length: n }, (_, i) => row(`${prefix}${i + 1}`, i + 1, (i + 1) * 10));
const pair = (query: string, page: string, clicks = 1, impressions = 10, position = 4.2): SearchQueryPageRow => ({ query, page, clicks, impressions, ctr: clicks / impressions, position });
const PAIRS: readonly SearchQueryPageRow[] = [pair("secret pair query", "https://halcyon.example/a", 3, 60), pair("secret pair query", "https://halcyon.example/b", 1, 30, 6.1), pair("other", "https://halcyon.example/a")];

type Answer<T> = ProviderResult<T> | "never" | Error;
type Answers = {
  totals?: (projectId: string) => Answer<SearchPerformance | null>;
  queries?: (projectId: string) => Answer<readonly SearchPerformanceRow[]>;
  pages?: (projectId: string) => Answer<readonly SearchPerformanceRow[]>;
  pairs?: (projectId: string) => Answer<readonly SearchQueryPageRow[]>;
};

function ok<T>(value: T, projectId: string, extra: { stale?: boolean; property?: string; fetchedAt?: string } = {}): ProviderResult<T> {
  return { ok: true, value, property: extra.property ?? PROPERTIES.get(projectId) ?? null, fetchedAt: extra.fetchedAt ?? FETCHED, stale: extra.stale ?? false };
}

function fakeProvider(answers: Answers = {}, configured = true) {
  const calls: { method: string; projectId: string; window: SearchConsoleWindow }[] = [];
  const answer = <T,>(method: string, projectId: string, window: SearchConsoleWindow, get: ((id: string) => Answer<T>) | undefined, fallback: Answer<T>): Promise<ProviderResult<T>> => {
    calls.push({ method, projectId, window });
    const a = get ? get(projectId) : fallback;
    if (a === "never") return new Promise(() => {});
    if (a instanceof Error) return Promise.reject(a);
    return Promise.resolve(a);
  };
  const provider: SearchConsoleProvider = {
    configured,
    listSites: async () => ({ ok: true, value: [], property: null, fetchedAt: FETCHED, stale: false }),
    getSearchPerformance: (id, w) => answer("totals", id, w, answers.totals, ok<SearchPerformance | null>(TOTALS, id)),
    getQueryPerformance: (id, w) => answer("queries", id, w, answers.queries, ok<readonly SearchPerformanceRow[]>(rows(3, "q"), id)),
    getPagePerformance: (id, w) => answer("pages", id, w, answers.pages, ok<readonly SearchPerformanceRow[]>(rows(2, "https://p.example/"), id)),
    getQueryPagePerformance: (id, w) => answer("pairs", id, w, answers.pairs, ok<readonly SearchQueryPageRow[]>(PAIRS, id)),
  };
  return { provider, calls };
}

/** A pair store that applies the P4c function's rules: one set per project, property and window end. */
function memoryPairStore(options: { fail?: Error | null; missing?: Set<string>; stores?: boolean } = {}) {
  const sets = new Map<string, readonly SearchQueryPageRow[]>();
  const inputs: RecordQueryPagesInput[] = [];
  const store: SearchConsoleQueryPageStore = {
    storesQueryPages: options.stores ?? true,
    async record(input): Promise<RecordQueryPagesOutcome> {
      inputs.push(input);
      if (options.fail) throw options.fail;
      if (options.missing?.has(input.projectId)) return { status: "not-found" };
      const key = [input.projectId, input.property, input.window.rangeId, input.window.endDate].join("|");
      const existing = sets.get(key);
      if (existing) return { status: "exists", count: existing.length };
      sets.set(key, input.pairs);
      return { status: "created", count: input.pairs.length };
    },
    async listQueryPages() {
      return [];
    },
  };
  return { store, sets, inputs };
}

/** A store that applies the database function's rules: one row per project, property and window end. */
function memoryStore(options: { fail?: (input: RecordSnapshotInput) => Error | null; missing?: Set<string> } = {}) {
  const rows = new Map<string, SearchConsoleSnapshot>();
  const inputs: RecordSnapshotInput[] = [];
  const store: SearchConsoleSnapshotStore = {
    storesSnapshots: true,
    async record(input): Promise<RecordSnapshotOutcome> {
      inputs.push(input);
      const failure = options.fail?.(input);
      if (failure) throw failure;
      if (options.missing?.has(input.projectId)) return { status: "not-found" };
      const key = [input.projectId, input.property, input.window.rangeId, input.window.endDate].join("|");
      const existing = rows.get(key);
      if (existing) return { status: "exists", snapshot: existing };
      const snapshot: SearchConsoleSnapshot = {
        id: `snap-${rows.size + 1}`,
        projectId: input.projectId,
        property: input.property,
        rangeId: "30d",
        days: 30,
        startDate: input.window.startDate,
        endDate: input.window.endDate,
        state: input.state,
        totals: input.totals,
        queries: input.queries,
        pages: input.pages,
        partial: input.partial,
        source: "scheduled",
        fetchedAt: input.fetchedAt,
        capturedAt: NOW.toISOString(),
      };
      rows.set(key, snapshot);
      return { status: "created", snapshot };
    },
    async listSnapshots(projectId) {
      return [...rows.values()].filter((s) => s.projectId === projectId);
    },
  };
  return { store, rows, inputs };
}

function fakeProjects(ids: readonly string[], options: { deletedBeforeRead?: Set<string> } = {}) {
  const reads: string[] = [];
  return {
    reads,
    projects: {
      listProjectIds: async () => ids,
      getProjectById: async (id: string) => {
        reads.push(id);
        return options.deletedBeforeRead?.has(id) || !ids.includes(id) ? null : { id };
      },
    },
  };
}

function logs() {
  const lines: { level: string; event: string; fields: Record<string, unknown> }[] = [];
  const log: SnapshotCaptureLog = (level, event, fields) => lines.push({ level, event, fields: { ...fields } });
  return { lines, log };
}

function setup(overrides: Partial<SnapshotCaptureDependencies> & { ids?: readonly string[]; answers?: Answers; configured?: boolean; noPairStore?: boolean } = {}) {
  const { provider, calls } = fakeProvider(overrides.answers, overrides.configured ?? true);
  const memory = memoryStore();
  const pairs = memoryPairStore();
  const repo = fakeProjects(overrides.ids ?? [HALCYON, VERDANT]);
  const { lines, log } = logs();
  const capture = createSnapshotCapture({
    provider: overrides.provider ?? provider,
    properties: overrides.properties ?? PROPERTIES,
    projects: overrides.projects ?? repo.projects,
    store: overrides.store ?? memory.store,
    queryPages: overrides.noPairStore ? undefined : (overrides.queryPages ?? pairs.store),
    now: () => NOW,
    log,
  });
  return { capture, calls, memory, pairs, repo, lines };
}

const run = (s: ReturnType<typeof setup>, options = { maxProjects: 10, budgetMs: 45_000 }) => s.capture.capture(options);
const statuses = (batch: Awaited<ReturnType<typeof run>>) => batch.entries.map((e) => `${e.projectId}:${e.outcome.status}`);

describe("the 30-day window", () => {
  test("is exactly 30 days ending three days before Pacific today, and is what the provider is asked for", async () => {
    const window = snapshotWindow(NOW);
    assert.deepEqual(window, { rangeId: "30d", startDate: "2026-08-23", endDate: "2026-09-21", days: 30 });
    const s = setup({ ids: [HALCYON] });
    const batch = await run(s);
    assert.deepEqual(batch.window, window);
    // Three snapshot reads, then the one P4c pair read, all for the same window.
    assert.deepEqual(s.calls.map((c) => c.method), ["totals", "queries", "pages", "pairs"]);
    assert.ok(s.calls.every((c) => c.projectId === HALCYON && c.window.startDate === "2026-08-23" && c.window.endDate === "2026-09-21"));
    assert.equal(s.memory.inputs[0].window.endDate, "2026-09-21");
    assert.equal(s.pairs.inputs[0].window.endDate, "2026-09-21");
  });

  test("late in the UTC day the window still follows the Pacific date", () => {
    assert.equal(snapshotWindow(new Date("2026-09-24T03:00:00Z")).endDate, "2026-09-20");
  });
});

describe("a connected capture", () => {
  test("records totals, Google's top queries and pages, the property from the server's mapping, and answers created", async () => {
    const s = setup({ ids: [HALCYON] });
    const batch = await run(s);
    assert.deepEqual(statuses(batch), [`${HALCYON}:created`]);
    const [input] = s.memory.inputs;
    assert.equal(input.property, "sc-domain:halcyon.example");
    assert.equal(input.state, "connected");
    assert.deepEqual(input.totals, TOTALS);
    assert.deepEqual(input.queries.map((r) => r.key), ["q1", "q2", "q3"]);
    assert.deepEqual(input.pages.map((r) => r.key), ["https://p.example/1", "https://p.example/2"]);
    assert.deepEqual(input.partial, []);
    assert.equal(input.fetchedAt, FETCHED);
    assert.deepEqual([batch.attempted, batch.stoppedBy], [1, "complete"]);
    const entry = batch.entries[0];
    assert.ok(entry.outcome.status === "created" && entry.outcome.snapshot.id === "snap-1");
  });

  test("the project is read again before Google is asked, and the store is the one write", async () => {
    const s = setup({ ids: [HALCYON] });
    await run(s);
    assert.deepEqual(s.repo.reads, [HALCYON]);
    assert.equal(s.memory.inputs.length, 1);
  });

  test("every project in repository order, each for its own property", async () => {
    const s = setup();
    const batch = await run(s);
    assert.deepEqual(statuses(batch), [`${HALCYON}:created`, `${VERDANT}:created`]);
    assert.deepEqual(s.memory.inputs.map((i) => i.property), ["sc-domain:halcyon.example", "https://www.verdanthome.example/"]);
  });
});

describe("no data", () => {
  test("Google answered with no impressions: a no-data row with nulls and empty lists", async () => {
    const s = setup({ ids: [HALCYON], answers: { totals: (id) => ok(null, id) } });
    const batch = await run(s);
    assert.deepEqual(statuses(batch), [`${HALCYON}:no-data-created`]);
    const [input] = s.memory.inputs;
    assert.deepEqual([input.state, input.totals, input.queries, input.pages, input.partial], ["no-data", null, [], [], []]);
  });

  test("a failed totals read is never a no-data row", async () => {
    const s = setup({ ids: [HALCYON], answers: { totals: () => ({ ok: false, failure: { state: "unavailable", reason: "error" } }) } });
    const batch = await run(s);
    assert.deepEqual(statuses(batch), [`${HALCYON}:unavailable`]);
    assert.equal(s.memory.inputs.length, 0);
  });
});

describe("partial reads", () => {
  test("a failed queries read is recorded as queries-unavailable with an empty list; pages stay", async () => {
    const s = setup({ ids: [HALCYON], answers: { queries: () => ({ ok: false, failure: { state: "unavailable", reason: "timeout" } }) } });
    const batch = await run(s);
    assert.deepEqual(statuses(batch), [`${HALCYON}:created`]);
    const [input] = s.memory.inputs;
    assert.deepEqual([input.queries, input.partial, input.pages.length], [[], ["queries-unavailable"], 2]);
  });

  test("both secondary reads failed: both markers, totals still recorded", async () => {
    const fail = () => ({ ok: false, failure: { state: "unavailable", reason: "rate-limited" } }) as const;
    const s = setup({ ids: [HALCYON], answers: { queries: fail, pages: fail } });
    await run(s);
    assert.deepEqual(s.memory.inputs[0].partial, ["queries-unavailable", "pages-unavailable"]);
  });

  test("a stale secondary read is unavailable, not stored as today's rows", async () => {
    const s = setup({ ids: [HALCYON], answers: { pages: (id) => ok(rows(2, "https://old.example/"), id, { stale: true }) } });
    await run(s);
    assert.deepEqual([s.memory.inputs[0].pages, s.memory.inputs[0].partial], [[], ["pages-unavailable"]]);
  });
});

describe("stale and mismatched answers", () => {
  test("stale totals: stale-skipped, nothing written", async () => {
    const s = setup({ ids: [HALCYON], answers: { totals: (id) => ok(TOTALS, id, { stale: true }) } });
    const batch = await run(s);
    assert.deepEqual(statuses(batch), [`${HALCYON}:stale-skipped`]);
    assert.equal(s.memory.inputs.length, 0);
  });

  test("totals answered for another property: property-mismatch, nothing written", async () => {
    const s = setup({ ids: [HALCYON], answers: { totals: (id) => ok(TOTALS, id, { property: "sc-domain:other.example" }) } });
    const batch = await run(s);
    assert.deepEqual(statuses(batch), [`${HALCYON}:property-mismatch`]);
    assert.equal(s.memory.inputs.length, 0);
  });

  test("queries answered for another property are left out of the snapshot", async () => {
    const s = setup({ ids: [HALCYON], answers: { queries: (id) => ok(rows(3), id, { property: "sc-domain:other.example" }) } });
    await run(s);
    assert.deepEqual([s.memory.inputs[0].queries, s.memory.inputs[0].partial], [[], ["queries-unavailable"]]);
  });

  test("totals the table would refuse (clicks above impressions) are unavailable, not stored", async () => {
    const s = setup({ ids: [HALCYON], answers: { totals: (id) => ok({ clicks: 5000, impressions: 4000, ctr: 1, position: 1 }, id) } });
    const batch = await run(s);
    assert.deepEqual(statuses(batch), [`${HALCYON}:unavailable`]);
    assert.equal(s.memory.inputs.length, 0);
  });
});

describe("not connected, access denied, unavailable", () => {
  test("an unmapped project is not-connected and Google is never asked", async () => {
    const s = setup({ ids: ["unmapped-site", HALCYON] });
    const batch = await run(s);
    assert.deepEqual(statuses(batch), ["unmapped-site:not-connected", `${HALCYON}:created`]);
    assert.ok(s.calls.every((c) => c.projectId === HALCYON));
    assert.equal(batch.attempted, 1);
  });

  test("no credentials on the server: every mapped project is not-connected without a Google call", async () => {
    const s = setup({ configured: false });
    const batch = await run(s);
    assert.deepEqual(statuses(batch), [`${HALCYON}:not-connected`, `${VERDANT}:not-connected`]);
    assert.equal(s.calls.length, 0);
  });

  test("a property is never taken from anywhere but the server's mapping", async () => {
    const s = setup({ ids: [HALCYON], properties: new Map() });
    const batch = await run(s);
    assert.deepEqual(statuses(batch), [`${HALCYON}:not-connected`]);
    assert.equal(s.calls.length, 0);
  });

  test("access denied, timeout and rate limiting keep their names and write nothing", async () => {
    const cases = [
      { failure: { state: "access-denied", property: "sc-domain:halcyon.example" }, expect: "access-denied" },
      { failure: { state: "unavailable", reason: "timeout" }, expect: "unavailable" },
      { failure: { state: "unavailable", reason: "rate-limited" }, expect: "unavailable" },
      { failure: { state: "unavailable", reason: "credentials-rejected" }, expect: "unavailable" },
    ] as const;
    for (const c of cases) {
      const s = setup({ ids: [HALCYON], answers: { totals: () => ({ ok: false, failure: c.failure }) } });
      const batch = await run(s);
      assert.deepEqual(statuses(batch), [`${HALCYON}:${c.expect}`]);
      const [entry] = batch.entries;
      if ("reason" in c.failure) assert.ok(entry.outcome.status === "unavailable" && entry.outcome.reason === c.failure.reason);
      assert.equal(s.memory.inputs.length, 0);
    }
  });

  test("one project's failure does not stop the next", async () => {
    const s = setup({ answers: { totals: (id) => (id === HALCYON ? { ok: false, failure: { state: "unavailable", reason: "timeout" } } : ok(TOTALS, id)) } });
    const batch = await run(s);
    assert.deepEqual(statuses(batch), [`${HALCYON}:unavailable`, `${VERDANT}:created`]);
  });
});

describe("duplicates and deleted projects", () => {
  test("a second capture of the same window answers exists with the stored snapshot", async () => {
    const s = setup({ ids: [HALCYON] });
    const first = await run(s);
    const again = await run(s);
    assert.deepEqual(statuses(again), [`${HALCYON}:exists`]);
    assert.equal(s.memory.rows.size, 1);
    const a = first.entries[0].outcome;
    const b = again.entries[0].outcome;
    assert.ok(a.status === "created" && b.status === "exists" && a.snapshot.id === b.snapshot.id);
  });

  test("a project deleted after it was listed: project-not-found, Google never asked", async () => {
    const repo = fakeProjects([HALCYON, VERDANT], { deletedBeforeRead: new Set([HALCYON]) });
    const s = setup({ projects: repo.projects });
    const batch = await run(s);
    assert.deepEqual(statuses(batch), [`${HALCYON}:project-not-found`, `${VERDANT}:created`]);
    assert.ok(s.calls.every((c) => c.projectId === VERDANT));
  });

  test("a project deleted while Google was being asked: the function answers not-found, reported as project-not-found", async () => {
    const memory = memoryStore({ missing: new Set([HALCYON]) });
    const s = setup({ ids: [HALCYON], store: memory.store });
    const batch = await run(s);
    assert.deepEqual(statuses(batch), [`${HALCYON}:project-not-found`]);
  });
});

describe("the store", () => {
  test("unavailable (fixture roster): store-unavailable for each mapped project, Google never asked", async () => {
    const s = setup({ store: unavailableSearchConsoleSnapshotStore });
    const batch = await run(s);
    assert.deepEqual(statuses(batch), [`${HALCYON}:store-unavailable`, `${VERDANT}:store-unavailable`]);
    assert.equal(s.calls.length, 0);
  });

  test("a throwing store: store-failed for that project, the next still captured, the error's code logged and nothing else", async () => {
    const failure = Object.assign(new Error("record snapshot failed (23514): violates check constraint"), { code: "23514" });
    const memory = memoryStore({ fail: (input) => (input.projectId === HALCYON ? failure : null) });
    const s = setup({ store: memory.store });
    const batch = await run(s);
    assert.deepEqual(statuses(batch), [`${HALCYON}:store-failed`, `${VERDANT}:created`]);
    const line = s.lines.find((l) => l.event === "search_console.snapshot_store_failed");
    assert.deepEqual(line?.fields, { projectId: HALCYON, errorCode: "23514" });
  });
});

describe("limits", () => {
  test("maxProjects bounds attempted captures; unmapped projects are reported but not counted", async () => {
    const s = setup({ ids: ["unmapped-a", HALCYON, VERDANT] });
    const batch = await run(s, { maxProjects: 1, budgetMs: 45_000 });
    assert.deepEqual(statuses(batch), ["unmapped-a:not-connected", `${HALCYON}:created`]);
    assert.deepEqual([batch.attempted, batch.stoppedBy], [1, "project-limit"]);
    assert.ok(s.calls.every((c) => c.projectId === HALCYON));
  });

  test("a project is not started with less than the minimum budget left", async () => {
    const s = setup();
    const batch = await run(s, { maxProjects: 10, budgetMs: MIN_PROJECT_BUDGET_MS - 1 });
    assert.deepEqual([batch.entries, batch.attempted, batch.stoppedBy], [[], 0, "time-budget"]);
    assert.equal(s.calls.length, 0);
  });

  test("a Google read that outlives the budget is unavailable/timeout; nothing is written and the batch ends", async () => {
    const s = setup({ answers: { totals: () => "never" } });
    const began = performance.now();
    // A little above the minimum: at exactly the minimum, the milliseconds spent listing projects would skip the capture.
    const batch = await run(s, { maxProjects: 10, budgetMs: MIN_PROJECT_BUDGET_MS + 200 });
    assert.ok(performance.now() - began < MIN_PROJECT_BUDGET_MS + 1700, "the deadline ended the wait");
    assert.deepEqual(statuses(batch), [`${HALCYON}:unavailable`]);
    const [entry] = batch.entries;
    assert.ok(entry.outcome.status === "unavailable" && entry.outcome.reason === "timeout");
    assert.deepEqual([s.memory.inputs.length, batch.stoppedBy], [0, "time-budget"]);
  });

  test("options are checked", async () => {
    const s = setup();
    await assert.rejects(() => run(s, { maxProjects: 0, budgetMs: 1000 }), /1 to 50/);
    await assert.rejects(() => run(s, { maxProjects: MAX_CAPTURE_PROJECTS + 1, budgetMs: 1000 }), /1 to 50/);
    await assert.rejects(() => run(s, { maxProjects: 1, budgetMs: 0 }), /positive whole number/);
    await assert.rejects(() => run(s, { maxProjects: 1, budgetMs: 1.5 }), /positive whole number/);
    assert.equal(s.calls.length, 0);
  });
});

describe("rows within the table's limits", () => {
  test("at most 25 rows, in Google's order", () => {
    const kept = snapshotRows(rows(40));
    assert.equal(kept.length, SNAPSHOT_MAX_ROWS);
    assert.deepEqual([kept[0].key, kept[24].key], ["q1", "q25"]);
  });

  test("a key of 2,048 characters is kept as typed; a longer one is left out, never truncated", () => {
    const exact = "x".repeat(SNAPSHOT_MAX_KEY_LENGTH);
    const long = "y".repeat(SNAPSHOT_MAX_KEY_LENGTH + 1);
    const kept = snapshotRows([row(long), row(exact), row("short")]);
    assert.deepEqual(kept.map((r) => r.key), [exact, "short"]);
  });

  test("duplicate keys, empty keys and unrecordable metrics are left out", () => {
    const kept = snapshotRows([
      row("a"),
      row("a", 2, 20),
      row(""),
      { key: "zero", clicks: 0, impressions: 0, ctr: 0, position: 0 },
      { key: "over", clicks: 11, impressions: 10, ctr: 1, position: 1 },
      { key: "fraction", clicks: 1.5, impressions: 10, ctr: 0.15, position: 1 },
      { key: "ctr", clicks: 1, impressions: 10, ctr: 1.1, position: 1 },
      row("b"),
    ]);
    assert.deepEqual(kept.map((r) => r.key), ["a", "b"]);
  });

  test("query text is data: quotes, SQL and secret-shaped strings are kept verbatim", async () => {
    const odd = [`'; drop table projects; --`, `api-key-shaped-text-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789`, `how to "quote" a query`];
    const s = setup({ ids: [HALCYON], answers: { queries: (id) => ok(odd.map((k) => row(k)), id) } });
    await run(s);
    assert.deepEqual(s.memory.inputs[0].queries.map((r) => r.key), odd);
  });

  test("recordable totals", () => {
    assert.equal(isRecordableTotals(TOTALS), true);
    assert.equal(isRecordableTotals({ clicks: 0, impressions: 1, ctr: 0, position: 0 }), true);
    assert.equal(isRecordableTotals({ clicks: 0, impressions: 0, ctr: 0, position: 0 }), false);
    assert.equal(isRecordableTotals({ clicks: -1, impressions: 1, ctr: 0, position: 0 }), false);
    assert.equal(isRecordableTotals({ clicks: 1, impressions: 1, ctr: 1, position: -0.1 }), false);
    assert.equal(isRecordableTotals({ clicks: 1, impressions: 1, ctr: Number.NaN, position: 1 }), false);
  });
});

describe("logging", () => {
  test("carries project ids, outcomes, reasons and durations — never a query, page, property, token or response", async () => {
    const secret = "access-token-shaped-text-a0AfH6SMB-that-must-not-appear";
    const s = setup({
      answers: {
        queries: (id) => ok([row(secret), row("https://p.example/?token=abc")], id),
        totals: (id) => (id === VERDANT ? { ok: false, failure: { state: "unavailable", reason: "rate-limited" } } : ok(TOTALS, id)),
      },
    });
    await run(s);
    const text = JSON.stringify(s.lines);
    for (const forbidden of [secret, "p.example", "halcyon.example", "verdanthome", "clicks", "4000"]) {
      assert.ok(!text.includes(forbidden), `log lines must not contain ${forbidden}`);
    }
    const events = s.lines.map((l) => l.event);
    assert.deepEqual(events, ["search_console.snapshot", "search_console.query_pages", "search_console.snapshot", "search_console.snapshot_batch"]);
    assert.deepEqual(s.lines[0].fields, { projectId: HALCYON, outcome: "created", reason: null, durationMs: s.lines[0].fields.durationMs });
    assert.deepEqual(s.lines[1].fields, { projectId: HALCYON, outcome: "recorded", reason: null, count: 3, durationMs: s.lines[1].fields.durationMs });
    assert.deepEqual(s.lines[2].fields, { projectId: VERDANT, outcome: "unavailable", reason: "rate-limited", durationMs: s.lines[2].fields.durationMs });
    assert.deepEqual(s.lines[3].fields, { count: 2, stoppedBy: "complete", durationMs: s.lines[3].fields.durationMs });
    for (const line of s.lines) {
      for (const value of Object.values(line.fields)) assert.ok(value === null || typeof value !== "object", "scalar fields only");
    }
  });
});

describe("query × page pairs after the snapshot (P4c)", () => {
  const pairsOf = (batch: Awaited<ReturnType<typeof run>>) => batch.entries.map((e) => `${e.projectId}:${e.pairs.status}${"reason" in e.pairs ? `/${e.pairs.reason}` : ""}${"count" in e.pairs ? `/${e.pairs.count}` : ""}`);

  test("after a connected snapshot is written, one pair read for the same property and window is recorded as one set", async () => {
    const s = setup({ ids: [HALCYON] });
    const batch = await run(s);
    assert.deepEqual(statuses(batch), [`${HALCYON}:created`]);
    assert.deepEqual(pairsOf(batch), [`${HALCYON}:recorded/3`]);
    assert.deepEqual(s.calls.map((c) => c.method), ["totals", "queries", "pages", "pairs"]);
    const [input] = s.pairs.inputs;
    assert.equal(input.property, "sc-domain:halcyon.example");
    assert.deepEqual(input.window, batch.window);
    assert.deepEqual(input.pairs, PAIRS);
    assert.equal(input.fetchedAt, FETCHED);
  });

  test("the pair read starts only after the snapshot write has settled", async () => {
    const order: string[] = [];
    const s = setup({ ids: [HALCYON] });
    const memory = s.memory.store;
    const capture = createSnapshotCapture({
      provider: {
        ...fakeProvider().provider,
        getQueryPagePerformance: async (id) => {
          order.push("pairs-read");
          return ok<readonly SearchQueryPageRow[]>(PAIRS, id);
        },
      },
      properties: PROPERTIES,
      projects: s.repo.projects,
      store: {
        storesSnapshots: true,
        record: async (input) => {
          order.push("snapshot-write");
          return memory.record(input);
        },
        listSnapshots: memory.listSnapshots,
      },
      queryPages: s.pairs.store,
      now: () => NOW,
    });
    await capture.capture({ maxProjects: 10, budgetMs: 45_000 });
    assert.deepEqual(order, ["snapshot-write", "pairs-read"]);
  });

  test("a window whose snapshot already exists still records its pairs when they are missing, and answers exists when they are not", async () => {
    const s = setup({ ids: [HALCYON] });
    const first = await run(s);
    assert.deepEqual(pairsOf(first), [`${HALCYON}:recorded/3`]);
    const second = await run(s);
    assert.deepEqual(statuses(second), [`${HALCYON}:exists`]);
    assert.deepEqual(pairsOf(second), [`${HALCYON}:exists/3`]);
    assert.equal(s.pairs.sets.size, 1);
  });

  test("a no-data snapshot skips the pair read entirely", async () => {
    const s = setup({ ids: [HALCYON], answers: { totals: (id) => ok<SearchPerformance | null>(null, id) } });
    const batch = await run(s);
    assert.deepEqual(statuses(batch), [`${HALCYON}:no-data-created`]);
    assert.deepEqual(pairsOf(batch), [`${HALCYON}:skipped/snapshot-not-connected`]);
    assert.ok(!s.calls.some((c) => c.method === "pairs"));
  });

  test("a snapshot that was not written (failed, stale, mismatched, missing project, unmapped) never triggers a pair read", async () => {
    const cases: { answers?: Answers; ids?: string[]; properties?: ReadonlyMap<string, string>; expect: string }[] = [
      { answers: { totals: () => ({ ok: false, failure: { state: "unavailable", reason: "rate-limited" } }) }, expect: "unavailable" },
      { answers: { totals: (id) => ok(TOTALS, id, { stale: true }) }, expect: "stale-skipped" },
      { answers: { totals: (id) => ok(TOTALS, id, { property: "sc-domain:other.example" }) }, expect: "property-mismatch" },
      { ids: ["unmapped"], expect: "not-connected" },
    ];
    for (const c of cases) {
      const s = setup({ ids: c.ids ?? [HALCYON], answers: c.answers });
      const batch = await run(s);
      assert.equal(batch.entries[0].outcome.status, c.expect);
      assert.deepEqual(batch.entries[0].pairs, { status: "skipped", reason: "snapshot-not-connected" });
      assert.ok(!s.calls.some((call) => call.method === "pairs"), c.expect);
      assert.equal(s.pairs.inputs.length, 0);
    }
  });

  test("a failed, stale or mismatched pair read is unavailable with its reason; the snapshot stands and nothing is written", async () => {
    const cases: { pairs: (id: string) => Answer<readonly SearchQueryPageRow[]>; reason: string }[] = [
      { pairs: () => ({ ok: false, failure: { state: "unavailable", reason: "rate-limited" } }), reason: "rate-limited" },
      { pairs: () => ({ ok: false, failure: { state: "access-denied", property: "sc-domain:halcyon.example" } }), reason: "access-denied" },
      { pairs: () => ({ ok: false, failure: { state: "not-connected", reason: "no-property" } }), reason: "no-property" },
      { pairs: (id) => ok<readonly SearchQueryPageRow[]>(PAIRS, id, { stale: true }), reason: "stale" },
      { pairs: (id) => ok<readonly SearchQueryPageRow[]>(PAIRS, id, { property: "sc-domain:other.example" }), reason: "property-mismatch" },
      { pairs: () => new Error("boom"), reason: "error" },
    ];
    for (const c of cases) {
      const s = setup({ ids: [HALCYON], answers: { pairs: c.pairs } });
      // A provider that throws is outside the provider contract; the capture still must not throw, and the snapshot stands.
      const batch = await run(s);
      assert.deepEqual(statuses(batch), [`${HALCYON}:created`], c.reason);
      assert.equal(batch.entries[0].pairs.status, "unavailable", c.reason);
      assert.equal("reason" in batch.entries[0].pairs ? batch.entries[0].pairs.reason : null, c.reason);
      assert.equal(s.pairs.inputs.length, 0);
    }
  });

  test("Google answered with no readable pair: no-pairs, nothing written, the snapshot stands", async () => {
    const s = setup({ ids: [HALCYON], answers: { pairs: (id) => ok<readonly SearchQueryPageRow[]>([pair("q", "/relative")], id) } });
    const batch = await run(s);
    assert.deepEqual(statuses(batch), [`${HALCYON}:created`]);
    assert.deepEqual(pairsOf(batch), [`${HALCYON}:no-pairs`]);
    assert.equal(s.pairs.inputs.length, 0);
  });

  test("no pair store (fixture roster): skipped as store-unavailable, Google is not asked for pairs", async () => {
    for (const s of [setup({ ids: [HALCYON], noPairStore: true }), setup({ ids: [HALCYON], queryPages: memoryPairStore({ stores: false }).store })]) {
      const batch = await run(s);
      assert.deepEqual(statuses(batch), [`${HALCYON}:created`]);
      assert.deepEqual(pairsOf(batch), [`${HALCYON}:skipped/store-unavailable`]);
      assert.ok(!s.calls.some((c) => c.method === "pairs"));
    }
  });

  test("a throwing pair store: store-failed for the pairs, the snapshot still created, the error's code logged and nothing else", async () => {
    const error = Object.assign(new Error("secret pair query leaked https://halcyon.example/a"), { code: "23514" });
    const s = setup({ ids: [HALCYON, VERDANT], queryPages: memoryPairStore({ fail: error }).store });
    const batch = await run(s);
    assert.deepEqual(statuses(batch), [`${HALCYON}:created`, `${VERDANT}:created`]);
    assert.deepEqual(pairsOf(batch), [`${HALCYON}:store-failed`, `${VERDANT}:store-failed`]);
    const line = s.lines.find((l) => l.event === "search_console.query_pages_store_failed");
    assert.deepEqual(line, { level: "error", event: "search_console.query_pages_store_failed", fields: { projectId: HALCYON, errorCode: "23514" } });
    assert.ok(!JSON.stringify(s.lines).includes("secret pair query"));
  });

  test("the pair store answering not-found is a skip, never a failure of the snapshot", async () => {
    const s = setup({ ids: [HALCYON], queryPages: memoryPairStore({ missing: new Set([HALCYON]) }).store });
    const batch = await run(s);
    assert.deepEqual(statuses(batch), [`${HALCYON}:created`]);
    assert.deepEqual(pairsOf(batch), [`${HALCYON}:skipped/store-unavailable`]);
  });

  test("the pair read is not started with under its minimum budget left, and a hanging pair read ends at the project's deadline", async () => {
    // Budget just above the project minimum: the snapshot reads spend almost nothing, leaving well over MIN_PAIR_BUDGET_MS.
    const hanging = setup({ ids: [HALCYON], answers: { pairs: () => "never" } });
    const began = performance.now();
    const batch = await run(hanging, { maxProjects: 10, budgetMs: MIN_PROJECT_BUDGET_MS + 200 });
    assert.ok(performance.now() - began < MIN_PROJECT_BUDGET_MS + 1700, "the project deadline ended the wait");
    assert.deepEqual(statuses(batch), [`${HALCYON}:created`], "the snapshot was written before the pair read hung");
    assert.deepEqual(pairsOf(batch), [`${HALCYON}:unavailable/timeout`]);
    assert.ok(MIN_PAIR_BUDGET_MS < MIN_PROJECT_BUDGET_MS);

    // A snapshot write that consumes the budget leaves the pairs skipped as time-budget, without a Google call.
    const slow = setup({ ids: [HALCYON] });
    const memory = slow.memory.store;
    const capture = createSnapshotCapture({
      provider: fakeProvider().provider,
      properties: PROPERTIES,
      projects: slow.repo.projects,
      store: { storesSnapshots: true, record: async (input) => { await new Promise((r) => setTimeout(r, 1_300)); return memory.record(input); }, listSnapshots: memory.listSnapshots },
      queryPages: slow.pairs.store,
      now: () => NOW,
    });
    const slowBatch = await capture.capture({ maxProjects: 10, budgetMs: MIN_PROJECT_BUDGET_MS + 100 });
    assert.deepEqual(slowBatch.entries.map((e) => [e.outcome.status, e.pairs]), [["created", { status: "skipped", reason: "time-budget" }]]);
    assert.equal(slow.pairs.inputs.length, 0);
  });

  test("one project's pair failure does not touch the next project's snapshot or pairs", async () => {
    const s = setup({ answers: { pairs: (id) => (id === HALCYON ? { ok: false, failure: { state: "unavailable", reason: "timeout" } } : ok<readonly SearchQueryPageRow[]>(PAIRS, id)) } });
    const batch = await run(s);
    assert.deepEqual(statuses(batch), [`${HALCYON}:created`, `${VERDANT}:created`]);
    assert.deepEqual(pairsOf(batch), [`${HALCYON}:unavailable/timeout`, `${VERDANT}:recorded/3`]);
  });

  test("logs for the pair step carry ids, outcomes, reasons, counts and durations — never a query or a page", async () => {
    const s = setup({ ids: [HALCYON] });
    await run(s);
    const line = s.lines.find((l) => l.event === "search_console.query_pages");
    assert.ok(line);
    assert.deepEqual(Object.keys(line.fields).sort(), ["count", "durationMs", "outcome", "projectId", "reason"]);
    assert.ok(!JSON.stringify(s.lines).includes("secret pair query") && !JSON.stringify(s.lines).includes("halcyon.example"));
  });
});

describe("pair rows within the table's limits", () => {
  const long = "k".repeat(2048);
  test("at most 250 distinct pairs in Google's order; a repeated pair keeps its first row", () => {
    const many = Array.from({ length: 260 }, (_, i) => pair(`q${i}`, "https://h.example/p"));
    assert.equal(queryPageRows(many).length, QUERY_PAGE_ROW_LIMIT);
    assert.equal(queryPageRows(many)[0].query, "q0");
    assert.deepEqual(queryPageRows([pair("a", "https://h.example/", 1, 10), pair("a", "https://h.example/", 2, 20)]), [pair("a", "https://h.example/", 1, 10)]);
  });

  test("a query or page of 2,048 characters is kept as typed; longer, empty, relative or whitespace pages and bad metrics are left out, never truncated", () => {
    assert.equal(queryPageRows([pair(long, `https://h.example/${"p".repeat(2048 - 18)}`)]).length, 1);
    assert.equal(queryPageRows([pair(`${long}k`, "https://h.example/")]).length, 0);
    assert.equal(queryPageRows([pair("q", `https://h.example/${"p".repeat(2049 - 18)}`)]).length, 0);
    for (const bad of [pair("", "https://h.example/"), pair("q", ""), pair("q", "/relative"), pair("q", "https://h.example/a b"), pair("q", "ftp://h.example/"), pair("q", "https://h.example/", 3, 2), pair("q", "https://h.example/", 0, 0)]) {
      assert.equal(queryPageRows([bad]).length, 0, JSON.stringify(bad));
    }
  });
});
