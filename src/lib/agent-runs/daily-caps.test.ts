import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AgentRun } from "../../types/agent-run.ts";
import type { ProjectRecord } from "../../types/project.ts";
import { createRateLimiter } from "../security/rate-limit.ts";
import { localRateLimiter } from "../security/shared-rate-limit.ts";
import type { AgentRunStore, AttemptLease, ClaimRequest, NewAgentRun } from "./contract.ts";
import {
  DAILY_CAPS,
  DAILY_CAP_HELD_MESSAGE,
  DAILY_CAP_MESSAGE,
  createDailyCaps,
  dailyCapKey,
  msUntilNextUtcDay,
  utcDay,
  type DailyCapLimiters,
} from "./daily-caps.ts";
import type { AgentExecutor } from "./executor.ts";
import { createAgentRunService } from "./service.ts";
import { createAgentRunWorker } from "./worker.ts";
import { executeOutcome, queueRefusal } from "../crawl/review-request.ts";

/**
 * Checkpoint 5.5 (decision Q9): 40 runs a project and 100 in all per UTC day,
 * counted when a run is created and again when an attempt starts. A refused
 * creation queues nothing (429 daily-cap); a capped run is never claimed and
 * stays queued. In-memory limiters stand in for `rate_limit_consume`.
 */

let clock = new Date("2026-09-28T10:00:00.000Z");
const now = () => clock;

function limiters(): DailyCapLimiters {
  const make = (limit: number) => localRateLimiter(createRateLimiter({ limit, windowMs: 86_400_000, now: () => clock.getTime() }));
  return {
    create: { project: make(DAILY_CAPS.perProject), global: make(DAILY_CAPS.global) },
    execute: { project: make(DAILY_CAPS.perProject), global: make(DAILY_CAPS.global) },
  };
}

describe("the caps", () => {
  test("40 a project, then refused for that project only; the day's key and the time to midnight", async () => {
    clock = new Date("2026-09-28T10:00:00.000Z");
    const caps = createDailyCaps(limiters(), now);
    for (let i = 0; i < 40; i += 1) assert.deepEqual(await caps.consume("create", "nexra-agency"), { allowed: true });
    const refused = await caps.consume("create", "nexra-agency");
    assert.equal(refused.allowed, false);
    assert.equal(!refused.allowed && refused.scope, "project");
    assert.ok(!refused.allowed && refused.retryAfterMs <= msUntilNextUtcDay(clock) && refused.retryAfterMs >= 1_000);
    assert.deepEqual(await caps.consume("create", "halcyon-fintech"), { allowed: true }, "another project is not affected");
    assert.deepEqual(await caps.consume("execute", "nexra-agency"), { allowed: true }, "creations and attempts are counted apart");
    assert.equal(dailyCapKey("project", "nexra-agency", clock), "nexra-agency:2026-09-28");
    assert.equal(dailyCapKey("global", "nexra-agency", clock), "all:2026-09-28");
    assert.equal(utcDay(new Date("2026-09-28T23:59:59.999Z")), "2026-09-28");
    assert.equal(msUntilNextUtcDay(new Date("2026-09-28T23:00:00.000Z")), 3_600_000);
  });

  test("100 in all across projects, then refused as global for every project", async () => {
    clock = new Date("2026-09-28T10:00:00.000Z");
    const caps = createDailyCaps(limiters(), now);
    for (let p = 0; p < 3; p += 1) for (let i = 0; i < (p < 2 ? 40 : 20); i += 1) assert.equal((await caps.consume("create", `project-${p}`)).allowed, true);
    const refused = await caps.consume("create", "project-9");
    assert.equal(refused.allowed, false);
    assert.equal(!refused.allowed && refused.scope, "global");
  });

  test("a new UTC day starts every count at zero", async () => {
    clock = new Date("2026-09-28T23:59:00.000Z");
    const caps = createDailyCaps(limiters(), now);
    for (let i = 0; i < 40; i += 1) await caps.consume("create", "nexra-agency");
    assert.equal((await caps.consume("create", "nexra-agency")).allowed, false);
    clock = new Date("2026-09-29T00:00:01.000Z");
    assert.deepEqual(await caps.consume("create", "nexra-agency"), { allowed: true });
  });
});

// ---------------------------------------------------------------------------
// The service and the worker
// ---------------------------------------------------------------------------

const PROJECT = (id: string): ProjectRecord =>
  ({ id, name: id, client: id, domain: `${id}.example`, initials: "XX", industry: "x", type: "lead-gen", status: "active", goal: "leads", market: "US", language: "en", targetLocation: "US", startedAt: "2026-09-01", updatedAt: "2026-09-01T00:00:00.000Z", summary: "" }) as ProjectRecord;

function run(n: number, projectId: string, extra: Partial<AgentRun> = {}): AgentRun {
  const created = new Date(Date.UTC(2026, 8, 28, 9, 0, n)).toISOString();
  return {
    id: `33333333-0000-4000-8000-${String(n).padStart(12, "0")}`, projectId, agentId: "project-manager", taskType: "intake-review", input: {}, status: "queued",
    source: "operator", executor: null, attemptCount: 0, maxAttempts: 3, resultSummary: null, resultMetadata: null, error: null,
    createdBy: "00000000-0000-4000-8000-00000000000a", cancelledBy: null, createdAt: created, updatedAt: created, startedAt: null, finishedAt: null, nextAttemptAt: null, autoRetryCount: 0, ...extra,
  };
}

function store(initial: AgentRun[]) {
  const runs = new Map(initial.map((r) => [r.id, r]));
  const claims: ClaimRequest[] = [];
  let inserts = 0;
  const fail = () => Promise.reject(new Error("not part of this test"));
  const s: AgentRunStore = {
    storesRuns: true,
    async insert(n: NewAgentRun) {
      inserts += 1;
      const r = run(100 + inserts, n.projectId);
      runs.set(r.id, r);
      return { status: "inserted", run: r };
    },
    findActiveDuplicate: async () => null,
    getById: async (id) => runs.get(id) ?? null,
    async listDue(limit) {
      return [...runs.values()].filter((r) => r.status === "queued").sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, limit);
    },
    async claim(request) {
      claims.push(request);
      const r = request.runId === null ? [...runs.values()].find((x) => x.status === "queued") : runs.get(request.runId);
      if (!r) return request.runId === null ? { status: "empty" } : { status: "not-found" };
      if (r.status !== "queued") return { status: "not-queued", run: r };
      const claimed = { ...r, status: "running" as const, attemptCount: r.attemptCount + 1 };
      runs.set(r.id, claimed);
      const lease: AttemptLease = { runId: r.id, attemptId: `a-${r.id}`, attemptNumber: claimed.attemptCount, token: "t", expiresAt: "2999-01-01T00:00:00.000Z" };
      return { status: "claimed", run: claimed, lease };
    },
    heartbeat: async () => ({ status: "renewed", expiresAt: "2999-01-01T00:00:00.000Z" }),
    async finish(lease) {
      const r = { ...runs.get(lease.runId)!, status: "failed" as const };
      runs.set(r.id, r);
      return { status: "finished", run: r };
    },
    listRuns: fail, transition: fail, recoverExpired: fail, listAttempts: async () => [], scheduleRetries: async () => [], runtimeStatus: fail,
  };
  return { s, claims, runs, inserts: () => inserts };
}

const quick: AgentExecutor = { id: "mock", execute: async () => { throw new Error("no answer needed"); } };
const projects = { getProjectById: async (id: string) => PROJECT(id) };

describe("at run creation", () => {
  test("the 41st run of a project today is refused daily-cap and nothing is inserted", async () => {
    clock = new Date("2026-09-28T10:00:00.000Z");
    const st = store([]);
    const service = createAgentRunService({ store: st.s, executor: quick, projects, caps: createDailyCaps(limiters(), now), now });
    for (let i = 0; i < 40; i += 1) assert.equal((await service.createRun("00000000-0000-4000-8000-00000000000a", { projectId: "nexra-agency", agentId: "project-manager", taskType: "intake-review", input: {} })).ok, true);
    const refused = await service.createRun("00000000-0000-4000-8000-00000000000a", { projectId: "nexra-agency", agentId: "project-manager", taskType: "intake-review", input: {} });
    assert.equal(refused.ok, false);
    assert.equal(!refused.ok && refused.reason, "daily-cap");
    assert.equal(st.inserts(), 40, "nothing queued for the refused request");
  });

  test("the controls say so, in words, for a refused creation and a held Run Now", () => {
    assert.equal(queueRefusal(429, { error: "daily-cap" }), DAILY_CAP_MESSAGE);
    assert.deepEqual(executeOutcome(429, { error: "daily-cap" }), { kind: "refused", message: DAILY_CAP_HELD_MESSAGE });
    assert.match(DAILY_CAP_MESSAGE, /40 a day for one project, 100 a day across all projects/);
    assert.match(DAILY_CAP_HELD_MESSAGE, /stays queued/);
  });
});

describe("at worker claim", () => {
  test("a capped project's runs are passed over unclaimed and stay queued; another project's run is claimed", async () => {
    clock = new Date("2026-09-28T10:00:00.000Z");
    const caps = createDailyCaps(limiters(), now);
    for (let i = 0; i < 40; i += 1) await caps.consume("execute", "capped-project");
    const st = store([run(1, "capped-project"), run(2, "capped-project"), run(3, "open-project")]);
    const worker = createAgentRunWorker({ store: st.s, executor: quick, projects, caps, timeoutMs: 1_000 });
    const batch = await worker.processQueue({ maxRuns: 5, budgetMs: 60_000 });
    assert.deepEqual(batch.executed.map((e) => e.runId), [run(3, "open-project").id]);
    assert.deepEqual(batch.heldByCap?.map((h) => [h.runId, h.scope]), [[run(1, "x").id, "project"], [run(2, "x").id, "project"]]);
    assert.equal(batch.stoppedBy, "empty");
    assert.deepEqual(st.claims.map((c) => c.runId), [run(3, "x").id], "only the open project's run was ever claimed");
    assert.equal(st.runs.get(run(1, "x").id)?.status, "queued");
    assert.equal(st.runs.get(run(2, "x").id)?.status, "queued");
    assert.equal(st.runs.get(run(1, "x").id)?.attemptCount, 0, "no attempt was spent on a held run");
  });

  test("the global cap stops the batch at once; Run Now on a capped run answers daily-cap and leaves it queued", async () => {
    clock = new Date("2026-09-28T10:00:00.000Z");
    const caps = createDailyCaps(limiters(), now);
    for (let p = 0; p < 3; p += 1) for (let i = 0; i < (p < 2 ? 40 : 20); i += 1) await caps.consume("execute", `busy-${p}`);
    const st = store([run(4, "fresh-a"), run(5, "fresh-b")]);
    const worker = createAgentRunWorker({ store: st.s, executor: quick, projects, caps, timeoutMs: 1_000 });
    const batch = await worker.processQueue({ maxRuns: 5, budgetMs: 60_000 });
    assert.equal(batch.stoppedBy, "daily-cap");
    assert.deepEqual(batch.executed, []);
    assert.equal(st.claims.length, 0);
    const now1 = await worker.executeRun(run(5, "x").id);
    assert.equal(now1.status, "daily-cap");
    assert.equal(st.runs.get(run(5, "x").id)?.status, "queued");
    assert.equal(st.claims.length, 0, "Run Now claimed nothing");
  });

  test("the next UTC day, the held run is claimed", async () => {
    clock = new Date("2026-09-28T23:59:00.000Z");
    const caps = createDailyCaps(limiters(), now);
    for (let i = 0; i < 40; i += 1) await caps.consume("execute", "capped-project");
    const st = store([run(6, "capped-project")]);
    const worker = createAgentRunWorker({ store: st.s, executor: quick, projects, caps, timeoutMs: 1_000 });
    assert.equal((await worker.executeRun(run(6, "x").id)).status, "daily-cap");
    clock = new Date("2026-09-29T00:00:30.000Z");
    assert.equal((await worker.executeRun(run(6, "x").id)).status, "executed");
    assert.equal(st.claims.length, 1);
  });

  test("without caps the worker claims as before (the next queued run, by the store's own claim)", async () => {
    const st = store([run(7, "p")]);
    const worker = createAgentRunWorker({ store: st.s, executor: quick, projects, timeoutMs: 1_000 });
    const batch = await worker.processQueue({ maxRuns: 1, budgetMs: 60_000 });
    assert.deepEqual(st.claims.map((c) => c.runId), [null]);
    assert.equal(batch.heldByCap, undefined);
  });
});
