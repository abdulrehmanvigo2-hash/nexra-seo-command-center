import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AgentRun, AgentRunAttempt } from "../../types/agent-run.ts";
import type { ProjectRecord } from "../../types/project.ts";
import type { AgentRunStore, AttemptLease, AttemptResult, ClaimRequest, HeartbeatOutcome } from "./contract.ts";
import { ExecutorError, type AgentExecutor } from "./executor.ts";
import { retryDelaySeconds, willRetryAutomatically } from "./retry-policy.ts";
import { createAgentRunWorker, MAX_QUEUE_BATCH, MAX_RECOVERY_LIMIT } from "./worker.ts";

/**
 * The worker's lease handling, driven through the real worker against a
 * store that answers as the test directs.
 *
 * Timers are the worker's own (`setInterval`, `performance.now`), so the
 * cases that need a heartbeat use a short lease and heartbeat and an executor
 * that only ends when told to. Every case asserts on what was written, since
 * "nothing written" is the point of a lost lease.
 */

const PROJECT: ProjectRecord = {
  id: "nexra-agency",
  name: "Nexra Agency",
  client: "Nexra",
  domain: "nexraagency.com",
  initials: "NA",
  industry: "Marketing",
  type: "lead-gen",
  status: "active",
  goal: "leads",
  market: "United States",
  language: "English (US)",
  targetLocation: "United States",
  startedAt: "2026-09-01",
  updatedAt: "2026-09-01T00:00:00.000Z",
  summary: "The agency's own site.",
};

const RUN_ID = "22222222-0000-4000-8000-000000000001";

function queuedRun(): AgentRun {
  return {
    id: RUN_ID,
    projectId: PROJECT.id,
    agentId: "project-manager",
    taskType: "intake-review",
    input: {},
    status: "queued",
    source: "operator",
    executor: null,
    attemptCount: 0,
    maxAttempts: 3,
    resultSummary: null,
    resultMetadata: null,
    error: null,
    createdBy: "00000000-0000-4000-8000-00000000000a",
    cancelledBy: null,
    createdAt: "2026-09-26T10:00:00.000Z",
    updatedAt: "2026-09-26T10:00:00.000Z",
    startedAt: null,
    finishedAt: null,
    nextAttemptAt: null,
    autoRetryCount: 0,
  };
}

type StoreOptions = {
  /** Answers for successive heartbeats; the last one repeats. */
  readonly heartbeats?: readonly HeartbeatOutcome[];
  /** Whether `finish` accepts the result. */
  readonly finishLost?: boolean;
};

function memoryStore(options: StoreOptions = {}) {
  let run = queuedRun();
  const finishes: AttemptResult[] = [];
  const heartbeats: { lease: AttemptLease; leaseSeconds: number }[] = [];
  const claims: ClaimRequest[] = [];
  const recoveries: number[] = [];
  const notHere = (what: string) => () => Promise.reject(new Error(`${what} is not part of this test`));

  const store: AgentRunStore = {
    storesRuns: true,
    async getById(id) {
      return id === run.id ? run : null;
    },
    async claim(request) {
      claims.push(request);
      if (request.runId !== null && request.runId !== run.id) return { status: "not-found" };
      if (run.status !== "queued") return request.runId === null ? { status: "empty" } : { status: "not-queued", run };
      run = { ...run, status: "running", executor: request.executor, attemptCount: run.attemptCount + 1, startedAt: "2026-09-26T10:01:00.000Z" };
      const lease: AttemptLease = { runId: run.id, attemptId: "attempt-1", attemptNumber: run.attemptCount, token: "lease-token", expiresAt: "2999-01-01T00:00:00.000Z" };
      return { status: "claimed", run, lease };
    },
    async heartbeat(lease, leaseSeconds) {
      heartbeats.push({ lease, leaseSeconds });
      const answers = options.heartbeats ?? [{ status: "renewed", expiresAt: "2999-01-01T00:00:00.000Z" }];
      return answers[Math.min(heartbeats.length - 1, answers.length - 1)];
    },
    async finish(_lease, result) {
      if (options.finishLost) return { status: "lost", run: { ...run, status: "cancelled" } };
      finishes.push(result);
      run =
        result.outcome === "completed"
          ? { ...run, status: "completed", resultSummary: result.summary, resultMetadata: result.metadata, error: null, finishedAt: "2026-09-26T10:02:00.000Z" }
          : { ...run, status: "failed", error: result.error, finishedAt: "2026-09-26T10:02:00.000Z" };
      return { status: "finished", run };
    },
    async recoverExpired(limit) {
      recoveries.push(limit);
      return [{ runId: RUN_ID, attemptNumber: 1 }];
    },
    async scheduleRetries(limit) {
      recoveries.push(limit);
      return [{ runId: RUN_ID, attemptCount: 1, errorCode: "timeout", nextAttemptAt: "2026-09-26T10:04:00.000Z" }];
    },
    insert: notHere("insert"),
    findActiveDuplicate: notHere("findActiveDuplicate"),
    listRuns: notHere("listRuns"),
    transition: notHere("transition"),
    listAttempts: async () => [] as readonly AgentRunAttempt[],
    runtimeStatus: notHere("runtimeStatus"),
  };
  return { store, finishes, heartbeats, claims, recoveries, current: () => run };
}

/** An executor that never answers by itself; it records whether it was told to stop. */
function hanging() {
  let aborted = false;
  const executor: AgentExecutor = {
    id: "ai",
    execute: (_task, signal) =>
      new Promise(() => {
        signal.addEventListener("abort", () => {
          aborted = true;
        });
      }),
  };
  return { executor, aborted: () => aborted };
}

function throwing(error: unknown): AgentExecutor {
  return { id: "ai", execute: async () => Promise.reject(error) };
}

const projects = { getProjectById: async (id: string) => (id === PROJECT.id ? PROJECT : null) };

describe("a lease that is lost stops the attempt and writes nothing", () => {
  test("a heartbeat answered `lost` aborts the executor, and the result is not recorded", async () => {
    const memory = memoryStore({ heartbeats: [{ status: "lost" }] });
    const stub = hanging();
    const worker = createAgentRunWorker({ store: memory.store, executor: stub.executor, projects, leaseSeconds: 1, heartbeatMs: 10, timeoutMs: 5_000 });

    const outcome = await worker.executeRun(RUN_ID);
    assert.equal(outcome.status, "executed");
    if (outcome.status === "executed") {
      assert.equal(outcome.recorded, false);
      assert.equal(outcome.attemptNumber, 1);
      // The run as the store now holds it: still running, for recovery to close.
      assert.equal(outcome.run.status, "running");
    }
    assert.equal(stub.aborted(), true, "the executor was not told to stop");
    assert.deepEqual(memory.finishes, [], "a result was written after the lease was lost");
    assert.ok(memory.heartbeats.length >= 1);
    assert.equal(memory.heartbeats[0].leaseSeconds, 1);
    assert.equal(memory.heartbeats[0].lease.token, "lease-token");
  });

  test("a result the store refuses (`finish` answers lost) is not claimed as recorded", async () => {
    const memory = memoryStore({ finishLost: true });
    const worker = createAgentRunWorker({
      store: memory.store,
      executor: { id: "ai", execute: async () => ({ summary: "A short, safe answer." }) },
      projects,
      timeoutMs: 5_000,
    });
    const outcome = await worker.executeRun(RUN_ID);
    assert.equal(outcome.status, "executed");
    if (outcome.status === "executed") {
      assert.equal(outcome.recorded, false);
      assert.equal(outcome.run.status, "cancelled");
    }
  });

  test("a held lease is renewed on the heartbeat interval while the executor works", async () => {
    const memory = memoryStore();
    let finish: (() => void) | undefined;
    const executor: AgentExecutor = {
      id: "ai",
      execute: () =>
        new Promise((resolve) => {
          finish = () => resolve({ summary: "Done after two heartbeats." });
        }),
    };
    const worker = createAgentRunWorker({ store: memory.store, executor, projects, leaseSeconds: 1, heartbeatMs: 10, timeoutMs: 5_000 });
    const running = worker.executeRun(RUN_ID);
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.ok(finish, "the executor was not started");
    finish!();
    const outcome = await running;
    assert.equal(outcome.status, "executed");
    if (outcome.status === "executed") assert.equal(outcome.recorded, true);
    assert.ok(memory.heartbeats.length >= 2, `only ${memory.heartbeats.length} heartbeat(s) were sent in 60 ms at 10 ms intervals`);
    assert.equal(memory.current().status, "completed");
  });
});

describe("how an attempt ends when the executor does not answer well", () => {
  test("an executor that outlives the timeout fails the run with `timeout`, once, and is aborted", async () => {
    const memory = memoryStore();
    const stub = hanging();
    const worker = createAgentRunWorker({ store: memory.store, executor: stub.executor, projects, timeoutMs: 20 });
    const outcome = await worker.executeRun(RUN_ID);
    assert.equal(outcome.status, "executed");
    if (outcome.status === "executed") {
      assert.equal(outcome.recorded, true);
      assert.equal(outcome.run.status, "failed");
      assert.equal(outcome.run.error?.code, "timeout");
    }
    assert.equal(stub.aborted(), true);
    assert.equal(memory.finishes.length, 1);
  });

  test("an executor's own classification is kept; anything else is `execution-failed`, and its text is dropped", async () => {
    for (const [error, code] of [
      [new ExecutorError("provider-unavailable"), "provider-unavailable"],
      [new ExecutorError("provider-rejected"), "provider-rejected"],
      [new ExecutorError("provider-not-configured"), "provider-not-configured"],
      [new Error("HTTP 500 from https://api.example/?key=sk-should-never-be-stored-000000"), "execution-failed"],
      ["a string, not an error", "execution-failed"],
    ] as const) {
      const memory = memoryStore();
      const worker = createAgentRunWorker({ store: memory.store, executor: throwing(error), projects, timeoutMs: 5_000 });
      const outcome = await worker.executeRun(RUN_ID);
      assert.equal(outcome.status, "executed");
      if (outcome.status === "executed") {
        assert.equal(outcome.run.status, "failed");
        assert.equal(outcome.run.error?.code, code);
        assert.ok(!(outcome.run.error?.message ?? "").includes("sk-should"), "the executor's error text reached the run");
      }
    }
  });

  test("a run whose project is gone fails as `project-missing` before the executor is asked", async () => {
    const memory = memoryStore();
    let executed = 0;
    const worker = createAgentRunWorker({
      store: memory.store,
      executor: { id: "ai", execute: async () => (executed += 1, { summary: "never" }) },
      projects: { getProjectById: async () => null },
      timeoutMs: 5_000,
    });
    const outcome = await worker.executeRun(RUN_ID);
    assert.equal(outcome.status, "executed");
    if (outcome.status === "executed") assert.equal(outcome.run.error?.code, "project-missing");
    assert.equal(executed, 0);
  });
});

describe("recovery, retry scheduling and the queue batch", () => {
  test("recoverExpired and scheduleRetries pass a bounded limit to the store and refuse others", async () => {
    const memory = memoryStore();
    const worker = createAgentRunWorker({ store: memory.store, executor: hanging().executor, projects, timeoutMs: 5_000 });
    assert.deepEqual(await worker.recoverExpired(), [{ runId: RUN_ID, attemptNumber: 1 }]);
    assert.equal(memory.recoveries.at(-1), 25);
    await worker.recoverExpired(MAX_RECOVERY_LIMIT);
    assert.equal(memory.recoveries.at(-1), MAX_RECOVERY_LIMIT);
    for (const limit of [0, -1, 1.5, MAX_RECOVERY_LIMIT + 1]) {
      await assert.rejects(() => worker.recoverExpired(limit), /1 to 100/);
      await assert.rejects(() => worker.scheduleRetries(limit), /1 to 100/);
    }
    const scheduled = await worker.scheduleRetries(5);
    assert.equal(scheduled[0].errorCode, "timeout");
    assert.equal(memory.recoveries.at(-1), 5);
  });

  test("a batch never claims when one attempt could not finish inside the budget", async () => {
    const memory = memoryStore();
    const worker = createAgentRunWorker({ store: memory.store, executor: hanging().executor, projects, timeoutMs: 1_000 });
    const batch = await worker.processQueue({ maxRuns: 3, budgetMs: 500 });
    assert.deepEqual(batch, { executed: [], stoppedBy: "time-budget" });
    assert.equal(memory.claims.length, 0, "the queue was claimed although the budget could not hold an attempt");
    assert.equal(memory.current().status, "queued");
  });

  test("a batch runs the due run, then stops on an empty queue", async () => {
    const memory = memoryStore();
    const worker = createAgentRunWorker({
      store: memory.store,
      executor: { id: "ai", execute: async () => ({ summary: "A short, safe answer." }) },
      projects,
      timeoutMs: 10,
    });
    const batch = await worker.processQueue({ maxRuns: 3, budgetMs: 10_000 });
    assert.equal(batch.stoppedBy, "empty");
    assert.deepEqual(batch.executed, [{ runId: RUN_ID, attemptNumber: 1, status: "completed", recorded: true }]);
  });

  test("batch bounds are enforced", async () => {
    const worker = createAgentRunWorker({ store: memoryStore().store, executor: hanging().executor, projects, timeoutMs: 5_000 });
    for (const maxRuns of [0, MAX_QUEUE_BATCH + 1, 1.5]) {
      await assert.rejects(() => worker.processQueue({ maxRuns, budgetMs: 1_000 }), /1 to 10/);
    }
    await assert.rejects(() => worker.processQueue({ maxRuns: 1, budgetMs: 0 }), /time budget/);
  });
});

describe("the worker refuses a configuration that could not keep a lease", () => {
  const deps = { store: memoryStore().store, executor: hanging().executor, projects };

  test("heartbeats must come at least twice per lease", () => {
    assert.throws(() => createAgentRunWorker({ ...deps, leaseSeconds: 10, heartbeatMs: 5_001 }), /twice per lease/);
    assert.doesNotThrow(() => createAgentRunWorker({ ...deps, leaseSeconds: 10, heartbeatMs: 5_000 }));
  });

  test("the lease is 1 to 900 whole seconds and the timeout a positive whole number", () => {
    assert.throws(() => createAgentRunWorker({ ...deps, leaseSeconds: 0 }), /1 to 900/);
    assert.throws(() => createAgentRunWorker({ ...deps, leaseSeconds: 901 }), /1 to 900/);
    assert.throws(() => createAgentRunWorker({ ...deps, leaseSeconds: 2.5 }), /1 to 900/);
    assert.throws(() => createAgentRunWorker({ ...deps, timeoutMs: 0 }), /timeout/);
  });

  test("the worker id is a bounded label", () => {
    assert.throws(() => createAgentRunWorker({ ...deps, workerId: "Not A Label" }), /worker id/);
    assert.throws(() => createAgentRunWorker({ ...deps, workerId: "x".repeat(65) }), /worker id/);
    assert.equal(createAgentRunWorker({ ...deps, workerId: "worker-abc123" }).id, "worker-abc123");
  });
});

describe("retry policy edges beside the existing coverage", () => {
  const base = { status: "failed" as const, error: { code: "timeout" as const, message: "" }, attemptCount: 1, maxAttempts: 3, autoRetryCount: 0 };

  test("a terminal code is never retried even with attempts to spare", () => {
    assert.equal(willRetryAutomatically({ ...base, error: { code: "rejected-output", message: "" } }), false);
    assert.equal(willRetryAutomatically({ ...base, error: { code: "policy-blocked", message: "" } }), false);
  });

  test("a run that is not failed, or has no error, is not retried whatever its counts", () => {
    assert.equal(willRetryAutomatically({ ...base, status: "completed", error: null }), false);
    assert.equal(willRetryAutomatically({ ...base, status: "queued" }), false);
    assert.equal(willRetryAutomatically({ ...base, error: null }), false);
  });

  test("the automatic retry count stops one short of the attempt cap", () => {
    assert.equal(willRetryAutomatically({ ...base, autoRetryCount: 1 }), true);
    assert.equal(willRetryAutomatically({ ...base, autoRetryCount: 2 }), false);
    assert.equal(retryDelaySeconds(0), retryDelaySeconds(1), "attempt 0 is treated as the first");
  });
});
