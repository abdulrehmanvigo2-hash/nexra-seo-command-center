import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AgentRun, JsonObject } from "../../types/agent-run.ts";
import type { ProjectRecord } from "../../types/project.ts";
import type {
  AgentRunStore,
  InsertRunOutcome,
  NewAgentRun,
  RunListFilter,
} from "./contract.ts";
import type { AgentExecutor } from "./executor.ts";
import { createAgentRunService } from "./service.ts";

/**
 * Queueing an on-page review, end to end through the real service, against
 * an in-memory store.
 *
 * What is proved: the request the panel builds becomes one persisted run
 * with the right project, agent and task; the same request twice returns the
 * first run instead of a second; the run is found by the filter the Run
 * History panel uses; and creating a run never touches the executor — so
 * queueing costs nothing, whatever executor the deployment has selected.
 */

const CRAWL_ID = "8f1c0d2e-0000-4000-8000-000000000001";
const OPERATOR = "00000000-0000-4000-8000-00000000000a";

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

/**
 * Enough of the store contract to create and list runs. Every path an insert
 * cannot reach rejects loudly, so a test that wandered into execution would
 * fail rather than pretend.
 */
function memoryStore() {
  const runs: AgentRun[] = [];
  let inserts = 0;
  let sequence = 0;

  const notHere = (what: string) => () => Promise.reject(new Error(`${what} is not part of queueing`));

  const store: AgentRunStore = {
    storesRuns: true,
    async insert(run: NewAgentRun): Promise<InsertRunOutcome> {
      inserts += 1;
      sequence += 1;
      const now = new Date(Date.UTC(2026, 8, 20, 12, 0, sequence)).toISOString();
      const inserted: AgentRun = {
        id: `11111111-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
        projectId: run.projectId,
        agentId: run.agentId,
        taskType: run.taskType,
        input: run.input,
        status: "queued",
        source: run.source,
        executor: null,
        attemptCount: 0,
        maxAttempts: run.maxAttempts,
        resultSummary: null,
        resultMetadata: null,
        error: null,
        createdBy: run.createdBy,
        cancelledBy: null,
        createdAt: now,
        updatedAt: now,
        startedAt: null,
        finishedAt: null,
        nextAttemptAt: null,
        autoRetryCount: 0,
      };
      runs.push(inserted);
      return { status: "inserted", run: inserted };
    },
    async getById(id) {
      return runs.find((run) => run.id === id) ?? null;
    },
    async findActiveDuplicate(identity) {
      return (
        runs.find(
          (run) =>
            (run.status === "queued" || run.status === "running") &&
            run.projectId === identity.projectId &&
            run.agentId === identity.agentId &&
            run.taskType === identity.taskType &&
            JSON.stringify(run.input) === JSON.stringify(identityInput(identity.inputHash)),
        ) ?? null
      );
    },
    async listRuns(filter: RunListFilter) {
      return runs
        .filter((run) => filter.projectId === undefined || run.projectId === filter.projectId)
        .filter((run) => filter.agentId === undefined || run.agentId === filter.agentId)
        .slice()
        .reverse()
        .slice(filter.offset ?? 0, (filter.offset ?? 0) + filter.limit);
    },
    transition: notHere("transition"),
    claim: notHere("claim"),
    heartbeat: notHere("heartbeat"),
    finish: notHere("finish"),
    recoverExpired: notHere("recoverExpired"),
    listAttempts: notHere("listAttempts"),
    scheduleRetries: notHere("scheduleRetries"),
    runtimeStatus: notHere("runtimeStatus"),
  };

  /** The store matches on the hash; this fake matches on the input the hash was made from. */
  const hashes = new Map<string, JsonObject>();
  const identityInput = (hash: string) => hashes.get(hash) ?? {};
  const original = store.insert;
  store.insert = async (run) => {
    hashes.set(run.inputHash, run.input);
    return original(run);
  };

  return { store, runs, inserts: () => inserts };
}

/** An executor that fails the test the moment it is asked to do anything. */
function forbiddenExecutor(): { executor: AgentExecutor; calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    executor: {
      id: "ai",
      async execute() {
        calls += 1;
        throw new Error("the executor was invoked while queueing");
      },
    },
  };
}

function service(store: AgentRunStore, executor: AgentExecutor) {
  return createAgentRunService({
    store,
    executor,
    projects: { getProjectById: async (id) => (id === PROJECT.id ? PROJECT : null) },
  });
}

const ON_PAGE_REQUEST = {
  projectId: PROJECT.id,
  agentId: "on-page-seo",
  taskType: "on-page-review",
  input: { crawlId: CRAWL_ID },
};

describe("queueing an on-page review", () => {
  test("creates one queued run for the right project, agent and task", async () => {
    const { store, runs } = memoryStore();
    const result = await service(store, forbiddenExecutor().executor).createRun(OPERATOR, ON_PAGE_REQUEST);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.duplicate, false);
    assert.equal(result.run.status, "queued");
    assert.equal(result.run.projectId, "nexra-agency");
    assert.equal(result.run.agentId, "on-page-seo");
    assert.equal(result.run.taskType, "on-page-review");
    assert.deepEqual(result.run.input, { crawlId: CRAWL_ID });
    assert.equal(result.run.createdBy, OPERATOR);
    assert.equal(result.run.source, "operator");
    assert.equal(result.run.attemptCount, 0);
    assert.equal(runs.length, 1);
  });

  test("never touches the executor: queueing is not execution", async () => {
    const { store } = memoryStore();
    const forbidden = forbiddenExecutor();
    const result = await service(store, forbidden.executor).createRun(OPERATOR, ON_PAGE_REQUEST);

    assert.equal(result.ok, true);
    assert.equal(forbidden.calls(), 0);
  });

  test("the same request twice returns the run already queued instead of a second one", async () => {
    const { store, inserts } = memoryStore();
    const runtime = service(store, forbiddenExecutor().executor);

    const first = await runtime.createRun(OPERATOR, ON_PAGE_REQUEST);
    const second = await runtime.createRun(OPERATOR, ON_PAGE_REQUEST);

    assert.ok(first.ok && second.ok);
    if (!first.ok || !second.ok) return;
    assert.equal(second.duplicate, true);
    assert.equal(second.run.id, first.run.id);
    assert.equal(inserts(), 1);
  });

  test("the on-page review and the crawl review of the same crawl are two different runs", async () => {
    // Different agents, different tasks: not duplicates of each other.
    const { store, inserts } = memoryStore();
    const runtime = service(store, forbiddenExecutor().executor);

    const onPage = await runtime.createRun(OPERATOR, ON_PAGE_REQUEST);
    const technical = await runtime.createRun(OPERATOR, {
      ...ON_PAGE_REQUEST,
      agentId: "technical-seo",
      taskType: "crawl-review",
    });

    assert.ok(onPage.ok && technical.ok);
    if (!onPage.ok || !technical.ok) return;
    assert.equal(technical.duplicate, false);
    assert.notEqual(technical.run.id, onPage.run.id);
    assert.equal(inserts(), 2);
  });

  test("is found by the filter the Run History panel uses", async () => {
    const { store } = memoryStore();
    const runtime = service(store, forbiddenExecutor().executor);
    const created = await runtime.createRun(OPERATOR, ON_PAGE_REQUEST);
    assert.ok(created.ok);
    if (!created.ok) return;

    // `/api/agent-runs?project=<id>&agent=<id>&limit=25&offset=0`, as the panel builds it.
    const byProjectAndAgent = await runtime.listRuns({
      projectId: "nexra-agency",
      agentId: "on-page-seo",
      limit: 25,
      offset: 0,
    });
    assert.ok(byProjectAndAgent.ok);
    if (!byProjectAndAgent.ok) return;
    assert.deepEqual(
      byProjectAndAgent.runs.map((run) => run.id),
      [created.run.id],
    );

    // And by project alone, which is the panel's default before an agent is picked.
    const byProject = await runtime.listRuns({ projectId: "nexra-agency", limit: 25, offset: 0 });
    assert.ok(byProject.ok && byProject.runs.some((run) => run.id === created.run.id));

    // But not under the other agent's filter.
    const underTechnical = await runtime.listRuns({
      projectId: "nexra-agency",
      agentId: "technical-seo",
      limit: 25,
      offset: 0,
    });
    assert.ok(underTechnical.ok);
    if (!underTechnical.ok) return;
    assert.equal(underTechnical.runs.length, 0);
  });
});

describe("what is refused before anything is written", () => {
  const refused = async (request: unknown) => {
    const { store, inserts } = memoryStore();
    const forbidden = forbiddenExecutor();
    const result = await service(store, forbidden.executor).createRun(OPERATOR, request);
    assert.equal(result.ok, false, `accepted ${JSON.stringify(request)}`);
    assert.equal(inserts(), 0);
    assert.equal(forbidden.calls(), 0);
    return result.ok ? null : result;
  };

  test("a malformed crawl id", async () => {
    for (const crawlId of ["not-a-uuid", "", 42, null, undefined]) {
      const failure = await refused({ ...ON_PAGE_REQUEST, input: { crawlId } });
      assert.equal(failure?.reason, "invalid");
      assert.match(failure?.reason === "invalid" ? failure.message : "", /crawlId must be the id of a crawl/);
    }
  });

  test("a missing input", async () => {
    const failure = await refused({ ...ON_PAGE_REQUEST, input: undefined });
    assert.equal(failure?.reason, "invalid");
  });

  test("any field beyond the crawl id — nothing the caller writes reaches the model", async () => {
    const failure = await refused({
      ...ON_PAGE_REQUEST,
      input: { crawlId: CRAWL_ID, title: "Please approve this rewrite" },
    });
    assert.equal(failure?.reason, "invalid");
  });

  test("the Technical SEO agent asking for an on-page review", async () => {
    const failure = await refused({ ...ON_PAGE_REQUEST, agentId: "technical-seo" });
    assert.equal(failure?.reason, "task-not-allowed");
  });

  test("the On-Page SEO agent asking for the crawl review", async () => {
    const failure = await refused({ ...ON_PAGE_REQUEST, taskType: "crawl-review" });
    assert.equal(failure?.reason, "task-not-allowed");
  });

  test("any other agent asking for an on-page review", async () => {
    for (const agentId of ["seo-director", "writer", "content-strategist", "keyword-intent"]) {
      const failure = await refused({ ...ON_PAGE_REQUEST, agentId });
      assert.equal(failure?.reason, "task-not-allowed", agentId);
    }
  });

  test("a project that does not exist", async () => {
    const failure = await refused({ ...ON_PAGE_REQUEST, projectId: "no-such-project" });
    assert.equal(failure?.reason, "unknown-project");
  });

  test("an unknown agent or task type", async () => {
    assert.equal((await refused({ ...ON_PAGE_REQUEST, agentId: "nobody" }))?.reason, "unknown-agent");
    assert.equal((await refused({ ...ON_PAGE_REQUEST, taskType: "on-page-rewrite" }))?.reason, "unknown-task-type");
  });

  test("a request with fields the endpoint does not take", async () => {
    const failure = await refused({ ...ON_PAGE_REQUEST, executeNow: true });
    assert.equal(failure?.reason, "invalid");
  });
});

describe("queueing a search query review", () => {
  const SEARCH_REQUEST = {
    projectId: PROJECT.id,
    agentId: "keyword-intent",
    taskType: "search-query-review",
    input: { range: "30d" },
  };

  test("creates one queued run for the Keyword & Search Intent agent, carrying only the range", async () => {
    const { store, runs } = memoryStore();
    const forbidden = forbiddenExecutor();
    const result = await service(store, forbidden.executor).createRun(OPERATOR, SEARCH_REQUEST);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.duplicate, false);
    assert.equal(result.run.status, "queued");
    assert.equal(result.run.agentId, "keyword-intent");
    assert.equal(result.run.taskType, "search-query-review");
    assert.deepEqual(result.run.input, { range: "30d" });
    assert.equal(runs.length, 1);
    assert.equal(forbidden.calls(), 0);
  });

  test("the same window twice returns the first run; a different window is a different run", async () => {
    const { store, inserts } = memoryStore();
    const runtime = service(store, forbiddenExecutor().executor);

    const first = await runtime.createRun(OPERATOR, SEARCH_REQUEST);
    const again = await runtime.createRun(OPERATOR, SEARCH_REQUEST);
    const other = await runtime.createRun(OPERATOR, { ...SEARCH_REQUEST, input: { range: "7d" } });

    assert.ok(first.ok && again.ok && other.ok);
    if (!first.ok || !again.ok || !other.ok) return;
    assert.equal(again.duplicate, true);
    assert.equal(again.run.id, first.run.id);
    assert.equal(other.duplicate, false);
    assert.notEqual(other.run.id, first.run.id);
    assert.equal(inserts(), 2);
  });

  test("is found under the Keyword & Search Intent agent, and not under the crawl agents", async () => {
    const { store } = memoryStore();
    const runtime = service(store, forbiddenExecutor().executor);
    const created = await runtime.createRun(OPERATOR, SEARCH_REQUEST);
    assert.ok(created.ok);
    if (!created.ok) return;

    const mine = await runtime.listRuns({ projectId: PROJECT.id, agentId: "keyword-intent", limit: 25, offset: 0 });
    assert.ok(mine.ok && mine.runs.map((run) => run.id).includes(created.run.id));
    for (const agentId of ["technical-seo", "on-page-seo"] as const) {
      const theirs = await runtime.listRuns({ projectId: PROJECT.id, agentId, limit: 25, offset: 0 });
      assert.ok(theirs.ok && theirs.runs.length === 0, agentId);
    }
  });

  test("is refused before anything is written for a bad range, an extra field, or the wrong agent", async () => {
    const attempts: [unknown, string][] = [
      [{ ...SEARCH_REQUEST, input: { range: "90d" } }, "invalid"],
      [{ ...SEARCH_REQUEST, input: {} }, "invalid"],
      [{ ...SEARCH_REQUEST, input: { range: "30d", seedKeywords: ["seo"] } }, "invalid"],
      [{ ...SEARCH_REQUEST, input: { range: "30d", property: "sc-domain:other.example" } }, "invalid"],
      [{ ...SEARCH_REQUEST, agentId: "technical-seo" }, "task-not-allowed"],
      [{ ...SEARCH_REQUEST, agentId: "on-page-seo" }, "task-not-allowed"],
      [{ ...SEARCH_REQUEST, agentId: "seo-director" }, "task-not-allowed"],
    ];
    for (const [request, reason] of attempts) {
      const { store, inserts } = memoryStore();
      const forbidden = forbiddenExecutor();
      const result = await service(store, forbidden.executor).createRun(OPERATOR, request);
      assert.equal(result.ok, false, `accepted ${JSON.stringify(request)}`);
      assert.equal(result.ok ? null : result.reason, reason);
      assert.equal(inserts(), 0);
      assert.equal(forbidden.calls(), 0);
    }
  });

  test("keyword-research is unchanged: the same agent, seed keywords, still queued", async () => {
    const { store } = memoryStore();
    const result = await service(store, forbiddenExecutor().executor).createRun(OPERATOR, {
      projectId: PROJECT.id,
      agentId: "keyword-intent",
      taskType: "keyword-research",
      input: { seedKeywords: ["seo agency"] },
    });
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.run.taskType, "keyword-research");
  });
});

describe("queueing a priority review — the SEO Director hand-off", () => {
  const SOURCE_RUN_ID = "11111111-0000-4000-8000-000000000001";
  const HANDOFF_REQUEST = {
    projectId: PROJECT.id,
    agentId: "seo-director",
    taskType: "priority-review",
    input: { sourceRunId: SOURCE_RUN_ID },
  };

  test("creates one queued run for the Director, naming the source run and nothing else", async () => {
    const { store, runs } = memoryStore();
    const forbidden = forbiddenExecutor();
    const result = await service(store, forbidden.executor).createRun(OPERATOR, HANDOFF_REQUEST);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.duplicate, false);
    assert.equal(result.run.status, "queued");
    assert.equal(result.run.agentId, "seo-director");
    assert.equal(result.run.taskType, "priority-review");
    assert.deepEqual(result.run.input, { sourceRunId: SOURCE_RUN_ID });
    // Operator-triggered: the only source that exists. Nothing queues it on its own.
    assert.equal(result.run.source, "operator");
    assert.equal(runs.length, 1);
    assert.equal(forbidden.calls(), 0);
  });

  test("the source run id is stored lower-case, so the same hand-off asked twice is one run", async () => {
    const { store, inserts } = memoryStore();
    const runtime = service(store, forbiddenExecutor().executor);
    const first = await runtime.createRun(OPERATOR, HANDOFF_REQUEST);
    const again = await runtime.createRun(OPERATOR, { ...HANDOFF_REQUEST, input: { sourceRunId: SOURCE_RUN_ID.toUpperCase() } });

    assert.ok(first.ok && again.ok);
    if (!first.ok || !again.ok) return;
    assert.equal(again.duplicate, true);
    assert.equal(again.run.id, first.run.id);
    assert.equal(inserts(), 1);
  });

  test("hand-offs from two different runs are two different Director runs", async () => {
    const { store, inserts } = memoryStore();
    const runtime = service(store, forbiddenExecutor().executor);
    const one = await runtime.createRun(OPERATOR, HANDOFF_REQUEST);
    const two = await runtime.createRun(OPERATOR, {
      ...HANDOFF_REQUEST,
      input: { sourceRunId: "11111111-0000-4000-8000-000000000002" },
    });
    assert.ok(one.ok && two.ok);
    if (!one.ok || !two.ok) return;
    assert.notEqual(two.run.id, one.run.id);
    assert.equal(inserts(), 2);
  });

  test("is found under the SEO Director, and not under the agent whose review it reads", async () => {
    const { store } = memoryStore();
    const runtime = service(store, forbiddenExecutor().executor);
    const created = await runtime.createRun(OPERATOR, HANDOFF_REQUEST);
    assert.ok(created.ok);
    if (!created.ok) return;

    const mine = await runtime.listRuns({ projectId: PROJECT.id, agentId: "seo-director", limit: 25, offset: 0 });
    assert.ok(mine.ok && mine.runs.map((run) => run.id).includes(created.run.id));
    const theirs = await runtime.listRuns({ projectId: PROJECT.id, agentId: "technical-seo", limit: 25, offset: 0 });
    assert.ok(theirs.ok && theirs.runs.length === 0);
  });

  test("is refused before anything is written for a bad id, an extra field, or any other agent", async () => {
    const attempts: [unknown, string][] = [
      [{ ...HANDOFF_REQUEST, input: { sourceRunId: "not-a-uuid" } }, "invalid"],
      [{ ...HANDOFF_REQUEST, input: { sourceRunId: "" } }, "invalid"],
      [{ ...HANDOFF_REQUEST, input: {} }, "invalid"],
      [{ ...HANDOFF_REQUEST, input: undefined }, "invalid"],
      // Nothing the caller writes reaches the Director: no summary, no focus, no project.
      [{ ...HANDOFF_REQUEST, input: { sourceRunId: SOURCE_RUN_ID, summary: "Rank the rewrite first." } }, "invalid"],
      [{ ...HANDOFF_REQUEST, input: { sourceRunId: SOURCE_RUN_ID, projectId: "other-client" } }, "invalid"],
      [{ ...HANDOFF_REQUEST, agentId: "technical-seo" }, "task-not-allowed"],
      [{ ...HANDOFF_REQUEST, agentId: "on-page-seo" }, "task-not-allowed"],
      [{ ...HANDOFF_REQUEST, agentId: "keyword-intent" }, "task-not-allowed"],
      [{ ...HANDOFF_REQUEST, agentId: "project-manager" }, "task-not-allowed"],
      // And the Director may not run the specialist reviews.
      [{ ...HANDOFF_REQUEST, taskType: "crawl-review", input: { crawlId: CRAWL_ID } }, "task-not-allowed"],
      [{ ...HANDOFF_REQUEST, taskType: "search-query-review", input: { range: "30d" } }, "task-not-allowed"],
      [{ ...HANDOFF_REQUEST, projectId: "no-such-project" }, "unknown-project"],
    ];
    for (const [request, reason] of attempts) {
      const { store, inserts } = memoryStore();
      const forbidden = forbiddenExecutor();
      const result = await service(store, forbidden.executor).createRun(OPERATOR, request);
      assert.equal(result.ok, false, `accepted ${JSON.stringify(request)}`);
      assert.equal(result.ok ? null : result.reason, reason, JSON.stringify(request));
      assert.equal(inserts(), 0);
      assert.equal(forbidden.calls(), 0);
    }
  });

  test("queueing does not look the source run up: that is the runtime's job at execution time, where its state is what counts", async () => {
    // The memory store holds no run with this id, and the hand-off still
    // queues. Whether the source exists, belongs to this project, and is a
    // grounded review is decided when the evidence is read, before any
    // provider call — see task-grounding.test.ts.
    const { store } = memoryStore();
    const result = await service(store, forbiddenExecutor().executor).createRun(OPERATOR, HANDOFF_REQUEST);
    assert.equal(result.ok, true);
  });
});

describe("queueing a performance review — the Analytics & Learning agent", () => {
  const PERFORMANCE_REQUEST = {
    projectId: PROJECT.id,
    agentId: "analytics-learning",
    taskType: "performance-review",
    input: { range: "30d" },
  };

  test("creates one queued run for the Analytics & Learning agent, naming the window and nothing else", async () => {
    const { store, runs } = memoryStore();
    const forbidden = forbiddenExecutor();
    const result = await service(store, forbidden.executor).createRun(OPERATOR, PERFORMANCE_REQUEST);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.duplicate, false);
    assert.equal(result.run.status, "queued");
    assert.equal(result.run.agentId, "analytics-learning");
    assert.equal(result.run.taskType, "performance-review");
    assert.deepEqual(result.run.input, { range: "30d" });
    assert.equal(result.run.source, "operator");
    assert.equal(runs.length, 1);
    assert.equal(forbidden.calls(), 0);
  });

  test("the performance review and the search query review of the same window are two different runs", async () => {
    const { store, inserts } = memoryStore();
    const runtime = service(store, forbiddenExecutor().executor);
    const performance = await runtime.createRun(OPERATOR, PERFORMANCE_REQUEST);
    const queries = await runtime.createRun(OPERATOR, {
      ...PERFORMANCE_REQUEST,
      agentId: "keyword-intent",
      taskType: "search-query-review",
    });
    assert.ok(performance.ok && queries.ok);
    if (!performance.ok || !queries.ok) return;
    assert.equal(queries.duplicate, false);
    assert.notEqual(queries.run.id, performance.run.id);
    assert.equal(inserts(), 2);
  });

  test("is found under the Analytics & Learning agent, and not under the Keyword agent", async () => {
    const { store } = memoryStore();
    const runtime = service(store, forbiddenExecutor().executor);
    const created = await runtime.createRun(OPERATOR, PERFORMANCE_REQUEST);
    assert.ok(created.ok);
    if (!created.ok) return;

    const mine = await runtime.listRuns({ projectId: PROJECT.id, agentId: "analytics-learning", limit: 25, offset: 0 });
    assert.ok(mine.ok && mine.runs.map((run) => run.id).includes(created.run.id));
    const theirs = await runtime.listRuns({ projectId: PROJECT.id, agentId: "keyword-intent", limit: 25, offset: 0 });
    assert.ok(theirs.ok && theirs.runs.length === 0);
  });

  test("is refused before anything is written for a bad range, an extra field, or any other agent", async () => {
    const attempts: [unknown, string][] = [
      [{ ...PERFORMANCE_REQUEST, input: { range: "90d" } }, "invalid"],
      [{ ...PERFORMANCE_REQUEST, input: {} }, "invalid"],
      [{ ...PERFORMANCE_REQUEST, input: undefined }, "invalid"],
      [{ ...PERFORMANCE_REQUEST, input: { range: "30d", property: "sc-domain:other.example" } }, "invalid"],
      [{ ...PERFORMANCE_REQUEST, input: { range: "30d", projectId: "other-client" } }, "invalid"],
      [{ ...PERFORMANCE_REQUEST, agentId: "keyword-intent" }, "task-not-allowed"],
      [{ ...PERFORMANCE_REQUEST, agentId: "seo-director" }, "task-not-allowed"],
      [{ ...PERFORMANCE_REQUEST, agentId: "technical-seo" }, "task-not-allowed"],
      // And the Analytics agent may not run the Keyword agent's review of the same window.
      [{ ...PERFORMANCE_REQUEST, taskType: "search-query-review" }, "task-not-allowed"],
      [{ ...PERFORMANCE_REQUEST, projectId: "no-such-project" }, "unknown-project"],
    ];
    for (const [request, reason] of attempts) {
      const { store, inserts } = memoryStore();
      const forbidden = forbiddenExecutor();
      const result = await service(store, forbidden.executor).createRun(OPERATOR, request);
      assert.equal(result.ok, false, `accepted ${JSON.stringify(request)}`);
      assert.equal(result.ok ? null : result.reason, reason, JSON.stringify(request));
      assert.equal(inserts(), 0);
      assert.equal(forbidden.calls(), 0);
    }
  });
});
