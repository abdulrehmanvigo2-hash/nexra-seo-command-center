import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import type { ProcessQueueResult } from "./service.ts";
import {
  CAPTURE_GRACE_MS,
  CAPTURE_MAX_MS,
  CAPTURE_MAX_PROJECTS,
  QUEUE_BUDGET_MS,
  QUEUE_MAX_RUNS,
  RESPONSE_MARGIN_MS,
  ROUTE_MAX_DURATION_MS,
  captureBudgetMs,
  runProcessJob,
  type ProcessJobDependencies,
} from "./process-job.ts";
import { MIN_PROJECT_BUDGET_MS, type SnapshotCaptureBatch, type SnapshotCaptureOptions } from "../search-console/snapshots/capture.ts";
import { authenticateWorker, readWorkerSecret } from "../security/worker-auth.ts";

/**
 * Milestone M1, checkpoint 1c. On trial: that the scheduled `process` job
 * runs the agent-run queue first and exactly as before, that the Search
 * Console capture only ever takes what the route has left — at most 45
 * seconds, skipped when too little remains, cut off at a hard deadline
 * otherwise — and that nothing the capture does can change, delay or lose
 * the queue's answer. And that the cron schedule, the CP1a migration and
 * the screens are untouched.
 */

const QUEUE_OK: Extract<ProcessQueueResult, { ok: true }> = {
  ok: true,
  scheduled: [],
  batch: { executed: [{ runId: "run-1", attemptNumber: 1, status: "completed", recorded: true }], stoppedBy: "empty" },
};

const WINDOW = { rangeId: "30d", startDate: "2026-08-23", endDate: "2026-09-21", days: 30 } as const;

type EntryFixture = Omit<SnapshotCaptureBatch["entries"][number], "pairs"> & { pairs?: SnapshotCaptureBatch["entries"][number]["pairs"] };

const batchOf = (fixtures: readonly EntryFixture[], stoppedBy: SnapshotCaptureBatch["stoppedBy"] = "complete"): SnapshotCaptureBatch => ({
  rangeId: "30d",
  window: WINDOW,
  entries: fixtures.map((entry) => ({ ...entry, pairs: entry.pairs ?? { status: "skipped", reason: "snapshot-not-connected" } })),
  attempted: fixtures.filter((e) => e.outcome.status !== "not-connected").length,
  stoppedBy,
  durationMs: 10,
});

const CREATED = batchOf([
  {
    projectId: "halcyon-fintech",
    pairs: { status: "recorded", count: 3 },
    outcome: {
      status: "created",
      snapshot: {
        id: "snap-1",
        projectId: "halcyon-fintech",
        property: "sc-domain:halcyon.example",
        rangeId: "30d",
        days: 30,
        startDate: WINDOW.startDate,
        endDate: WINDOW.endDate,
        state: "connected",
        totals: { clicks: 1, impressions: 10, ctr: 0.1, position: 2 },
        queries: [{ key: "secret query text", clicks: 1, impressions: 10, ctr: 0.1, position: 2 }],
        pages: [],
        partial: [],
        source: "scheduled",
        fetchedAt: "2026-09-24T11:59:00.000Z",
        capturedAt: "2026-09-24T12:00:00.000Z",
      },
    },
    durationMs: 10,
  },
]);

/** A clock that advances by what each step is told to take. */
function clock() {
  let t = 0;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

type Setup = {
  refuse?: unknown;
  queue?: ProcessQueueResult | Error;
  queueTakesMs?: number;
  capture?: SnapshotCaptureBatch | Error | "never";
  captureTakesMs?: number;
  limits?: ProcessJobDependencies<unknown>["limits"];
};

function setup(options: Setup = {}) {
  const c = clock();
  const calls: string[] = [];
  const queueOptions: { maxRuns: number; budgetMs: number }[] = [];
  const captureOptions: SnapshotCaptureOptions[] = [];
  const lines: { level: string; event: string; fields: Record<string, unknown> }[] = [];
  const deps: ProcessJobDependencies<unknown> = {
    admit: async () => {
      calls.push("admit");
      return options.refuse ?? null;
    },
    processQueue: async (o) => {
      calls.push("queue");
      queueOptions.push(o);
      c.advance(options.queueTakesMs ?? 1_000);
      const q = options.queue ?? QUEUE_OK;
      if (q instanceof Error) throw q;
      return q;
    },
    capture: (o) => {
      calls.push("capture");
      captureOptions.push(o);
      const answer = options.capture ?? CREATED;
      if (answer === "never") return new Promise(() => {});
      c.advance(options.captureTakesMs ?? 500);
      if (answer instanceof Error) return Promise.reject(answer);
      return Promise.resolve(answer);
    },
    now: c.now,
    log: (level, event, fields) => lines.push({ level, event, fields: { ...fields } }),
    limits: options.limits,
  };
  return { deps, calls, queueOptions, captureOptions, lines, run: () => runProcessJob(deps) };
}

describe("admission", () => {
  test("a refused request runs neither the queue nor the capture and returns the refusal", async () => {
    const refusal = { status: 401 };
    const s = setup({ refuse: refusal });
    const outcome = await s.run();
    assert.deepEqual(outcome, { kind: "refused", response: refusal });
    assert.deepEqual(s.calls, ["admit"]);
  });

  test("the worker credential check is unchanged: a missing, wrong or malformed bearer is refused", () => {
    const secret = readWorkerSecret({ CRON_SECRET: "x".repeat(40) });
    assert.equal(secret.status, "configured");
    assert.equal(authenticateWorker(null, secret), "missing");
    assert.equal(authenticateWorker("Bearer " + "y".repeat(40), secret), "invalid");
    assert.equal(authenticateWorker("Basic abc", secret), "invalid");
    assert.equal(authenticateWorker("Bearer " + "x".repeat(40), secret), "authorized");
    assert.equal(authenticateWorker("Bearer " + "x".repeat(40), readWorkerSecret({})), "unconfigured");
  });
});

describe("order and the queue's answer", () => {
  test("the queue runs first with its unchanged batch size and budget; the capture runs after it", async () => {
    const s = setup();
    const outcome = await s.run();
    assert.deepEqual(s.calls, ["admit", "queue", "capture"]);
    assert.deepEqual(s.queueOptions, [{ maxRuns: 5, budgetMs: 240_000 }]);
    assert.deepEqual([QUEUE_MAX_RUNS, QUEUE_BUDGET_MS], [5, 240_000]);
    assert.ok(outcome.kind === "ok");
    assert.deepEqual(outcome.queue, QUEUE_OK);
  });

  test("the answer carries the capture as an additive field: ids, outcome names and counts, never a row", async () => {
    const s = setup();
    const outcome = await s.run();
    assert.ok(outcome.kind === "ok" && outcome.snapshots.status === "captured");
    assert.deepEqual(outcome.snapshots, {
      status: "captured",
      window: WINDOW,
      entries: [{ projectId: "halcyon-fintech", outcome: "created", reason: null, pairs: "recorded" }],
      attempted: 1,
      stoppedBy: "complete",
      budgetMs: CAPTURE_MAX_MS,
      durationMs: 500,
    });
    const text = JSON.stringify(outcome.snapshots);
    for (const forbidden of ["secret query text", "halcyon.example", "snap-1", "clicks"]) assert.ok(!text.includes(forbidden), forbidden);
  });

  test("a queue failure is returned as before and the capture never starts", async () => {
    const failure = { ok: false, reason: "store-unavailable" } as unknown as ProcessQueueResult;
    const s = setup({ queue: failure });
    const outcome = await s.run();
    assert.deepEqual(outcome, { kind: "queue-failed", failure });
    assert.deepEqual(s.calls, ["admit", "queue"]);
  });

  test("a queue that throws propagates as before (the route answers 500); the capture never starts", async () => {
    const s = setup({ queue: new Error("database gone") });
    await assert.rejects(() => s.run(), /database gone/);
    assert.deepEqual(s.calls, ["admit", "queue"]);
  });
});

describe("the capture's budget", () => {
  const limits = { routeMaxMs: ROUTE_MAX_DURATION_MS, captureMaxMs: CAPTURE_MAX_MS, responseMarginMs: RESPONSE_MARGIN_MS };

  test("the constants fit the route: queue + capture + grace leave the response margin under 300 s", () => {
    assert.equal(ROUTE_MAX_DURATION_MS, 300_000);
    assert.equal(CAPTURE_MAX_MS, 45_000);
    assert.ok(QUEUE_BUDGET_MS + CAPTURE_MAX_MS + CAPTURE_GRACE_MS <= ROUTE_MAX_DURATION_MS - 10_000);
    assert.ok(CAPTURE_GRACE_MS < RESPONSE_MARGIN_MS);
    assert.ok(CAPTURE_MAX_PROJECTS >= 1 && CAPTURE_MAX_PROJECTS <= 50);
  });

  test("captureBudgetMs: at most 45 s, never into the response margin, never negative", () => {
    assert.equal(captureBudgetMs(0, limits), 45_000);
    assert.equal(captureBudgetMs(240_000, limits), 45_000);
    assert.equal(captureBudgetMs(250_000, limits), 35_000);
    assert.equal(captureBudgetMs(282_000.4, limits), 2_999);
    assert.equal(captureBudgetMs(285_000, limits), 0);
    assert.equal(captureBudgetMs(299_000, limits), 0);
  });

  test("a queue that finished inside its budget leaves the capture the full 45 seconds", async () => {
    const s = setup({ queueTakesMs: 240_000 });
    const outcome = await s.run();
    assert.deepEqual(s.captureOptions, [{ maxProjects: CAPTURE_MAX_PROJECTS, budgetMs: 45_000 }]);
    assert.ok(outcome.kind === "ok" && outcome.snapshots.status === "captured" && outcome.snapshots.budgetMs === 45_000);
  });

  test("a queue that ran long leaves the capture only what remains before the margin", async () => {
    const s = setup({ queueTakesMs: 260_000 });
    await s.run();
    assert.deepEqual(s.captureOptions, [{ maxProjects: CAPTURE_MAX_PROJECTS, budgetMs: 25_000 }]);
  });

  test("too little time left: skipped as time-budget, nothing started, queue answer intact", async () => {
    const s = setup({ queueTakesMs: 283_000 });
    const outcome = await s.run();
    assert.deepEqual(s.calls, ["admit", "queue"]);
    assert.ok(outcome.kind === "ok");
    assert.deepEqual(outcome.snapshots, { status: "skipped", reason: "time-budget", budgetMs: 2_000 });
    assert.ok(2_000 < MIN_PROJECT_BUDGET_MS);
    assert.deepEqual(outcome.queue, QUEUE_OK);
  });

  test("exactly the capture's minimum is enough to start", async () => {
    const s = setup({ queueTakesMs: ROUTE_MAX_DURATION_MS - RESPONSE_MARGIN_MS - MIN_PROJECT_BUDGET_MS });
    await s.run();
    assert.deepEqual(s.captureOptions.map((o) => o.budgetMs), [MIN_PROJECT_BUDGET_MS]);
  });
});

describe("end-to-end deadline", () => {
  test("a capture that never returns is cut off at its budget plus grace; the job answers timed-out with the queue intact", async () => {
    const s = setup({ capture: "never", limits: { captureMaxMs: MIN_PROJECT_BUDGET_MS, captureGraceMs: 200 } });
    const began = performance.now();
    const outcome = await s.run();
    const took = performance.now() - began;
    assert.ok(took >= MIN_PROJECT_BUDGET_MS + 150 && took < MIN_PROJECT_BUDGET_MS + 1_500, `returned after ${Math.round(took)} ms`);
    assert.ok(outcome.kind === "ok");
    assert.deepEqual(outcome.snapshots, { status: "timed-out", budgetMs: MIN_PROJECT_BUDGET_MS, durationMs: 0 });
    assert.deepEqual(outcome.queue, QUEUE_OK);
    const line = s.lines.find((l) => l.event === "worker.snapshots");
    assert.deepEqual(line?.fields, { job: "process", status: "timed-out", limit: MIN_PROJECT_BUDGET_MS, count: 0, stoppedBy: null, durationMs: 0 });
  });

  test("a capture that finishes in time is not cut off", async () => {
    const s = setup({ limits: { captureMaxMs: MIN_PROJECT_BUDGET_MS, captureGraceMs: 200 } });
    const outcome = await s.run();
    assert.ok(outcome.kind === "ok" && outcome.snapshots.status === "captured");
  });
});

describe("capture failures never touch the queue's answer", () => {
  test("provider failures are outcomes in the batch; the queue result is returned as before", async () => {
    const s = setup({
      capture: batchOf([
        { projectId: "a", outcome: { status: "unavailable", reason: "rate-limited" }, durationMs: 1 },
        { projectId: "b", outcome: { status: "access-denied" }, durationMs: 1 },
        { projectId: "c", outcome: { status: "not-connected", reason: "no-property" }, durationMs: 0 },
      ]),
    });
    const outcome = await s.run();
    assert.ok(outcome.kind === "ok" && outcome.snapshots.status === "captured");
    assert.deepEqual(outcome.snapshots.entries, [
      { projectId: "a", outcome: "unavailable", reason: "rate-limited", pairs: "skipped" },
      { projectId: "b", outcome: "access-denied", reason: null, pairs: "skipped" },
      { projectId: "c", outcome: "not-connected", reason: "no-property", pairs: "skipped" },
    ]);
    assert.deepEqual(outcome.queue, QUEUE_OK);
  });

  test("a store failure is an outcome in the batch; the queue result is returned as before", async () => {
    const s = setup({ capture: batchOf([{ projectId: "a", outcome: { status: "store-failed" }, durationMs: 1 }]) });
    const outcome = await s.run();
    assert.ok(outcome.kind === "ok" && outcome.snapshots.status === "captured");
    assert.deepEqual(outcome.snapshots.entries, [{ projectId: "a", outcome: "store-failed", reason: null, pairs: "skipped" }]);
    assert.deepEqual(outcome.queue, QUEUE_OK);
  });

  test("a capture that throws answers failed, logs the error's name only, and the queue result is returned", async () => {
    const error = new Error("token abc123 leaked in message");
    error.name = "SearchConsoleSnapshotStoreError";
    const s = setup({ capture: error });
    const outcome = await s.run();
    assert.ok(outcome.kind === "ok");
    assert.deepEqual(outcome.snapshots, { status: "failed", budgetMs: CAPTURE_MAX_MS, durationMs: 500 });
    assert.deepEqual(outcome.queue, QUEUE_OK);
    const text = JSON.stringify(s.lines);
    assert.ok(!text.includes("abc123") && text.includes("SearchConsoleSnapshotStoreError"));
  });

  test("log lines carry the job, status, budget, counts and durations only", async () => {
    const s = setup();
    await s.run();
    assert.deepEqual(s.lines, [
      { level: "info", event: "worker.snapshots", fields: { job: "process", status: "captured", limit: 45_000, count: 1, stoppedBy: "complete", durationMs: 500 } },
    ]);
  });
});

describe("what this checkpoint leaves alone", () => {
  const root = process.cwd();

  test("the cron schedule is unchanged: recover at 04:00 and process at 05:30 UTC, nothing else", () => {
    const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));
    assert.deepEqual(vercel.crons, [
      { path: "/api/worker/recover", schedule: "0 4 * * *" },
      { path: "/api/worker/process", schedule: "30 5 * * *" },
    ]);
    assert.deepEqual(Object.keys(vercel).sort(), ["$schema", "crons"]);
  });

  test("the CP1a migration is byte-for-byte the approved one (line endings normalised)", () => {
    const sql = readFileSync(join(root, "supabase/migrations/20260927120000_create_search_console_snapshots.sql"), "utf8").replace(/\r\n/g, "\n");
    assert.equal(createHash("sha256").update(sql, "utf8").digest("hex"), "d872aab5b94f53dd7ce31c1681d06fb41e063ac880962b6236ab4d0c494e7f13");
    const migrations = readdirSync(join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
    // The snapshot store has exactly one migration; P4c added the query × page table beside it, and nothing else touches Search Console.
    assert.deepEqual(migrations.filter((f) => f.includes("search_console")), ["20260927120000_create_search_console_snapshots.sql", "20260930120000_create_search_console_query_pages.sql"]);
  });

  test("no screen or component reaches the snapshot capture: only the process route does", () => {
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name) && readFileSync(path, "utf8").includes("search-console/snapshots")) importers.push(path.slice(root.length + 1));
      }
    };
    walk(join(root, "src/app"));
    walk(join(root, "src/components"));
    assert.deepEqual(importers, ["src/app/api/worker/process/route.ts"]);
    const route = readFileSync(join(root, "src/app/api/worker/process/route.ts"), "utf8");
    assert.ok(route.includes("export const maxDuration = 300;"));
    assert.ok(route.includes('admitWorker(request, "process")'));
  });
});
