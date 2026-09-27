import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AgentRun } from "../../types/agent-run.ts";
import type { AgentTask, AgentTaskEvent, CreateAgentTaskInput, ListAgentTasksFilter } from "./contract.ts";
import { createAgentTaskService, type HandoffRunCreator } from "./service.ts";
import { unavailableAgentTaskStore, type AgentTaskStore } from "./store-contract.ts";

/**
 * The service over an in-memory store: project isolation on the read, the
 * limit bound, the write passed through untouched, and nothing queued,
 * executed or assigned by either.
 */

const task = (over: Partial<AgentTask> = {}): AgentTask => ({
  id: "t0000000-0000-4000-8000-000000000001",
  projectId: "nexra-agency",
  title: "T",
  sourceKind: "director-run",
  sourceRef: "d0000000-0000-4000-8000-000000000001",
  owningAgent: "project-manager",
  status: "backlog",
  priority: "medium",
  createdBy: "00000000-0000-4000-8000-0000000000aa",
  createdAt: "2026-09-26T03:00:00.000Z",
  updatedAt: "2026-09-26T03:00:00.000Z",
  ...over,
});

/** The workflow methods, refusing everything: the read and create tests never reach them. */
const noWorkflow: Pick<AgentTaskStore, "getForProject" | "listEvents" | "setStatus" | "setOwner" | "handoffRequest" | "handoffLink"> = {
  async getForProject() { return null; },
  async listEvents() { return []; },
  async setStatus() { return { status: "task-not-found" }; },
  async setOwner() { return { status: "task-not-found" }; },
  async handoffRequest() { return { status: "task-not-found" }; },
  async handoffLink() { return { status: "task-not-found" }; },
};

function fakeStore(rows: readonly AgentTask[] = []) {
  const listed: ListAgentTasksFilter[] = [];
  const created: CreateAgentTaskInput[] = [];
  const store: AgentTaskStore = {
    ...noWorkflow,
    storesTasks: true,
    async listForProject(filter) {
      listed.push(filter);
      return rows.filter((row) => row.projectId === filter.projectId && (filter.status === undefined || row.status === filter.status)).slice(0, filter.limit);
    },
    async create(input) {
      created.push(input);
      return { status: "created", task: task({ id: `t0000000-0000-4000-8000-${String(created.length).padStart(12, "0")}`, ...input }) };
    },
  };
  return { store, listed, created };
}

const input: CreateAgentTaskInput = { projectId: "nexra-agency", title: "Write the meta description", sourceKind: "director-run", sourceRef: "d0000000-0000-4000-8000-000000000001", owningAgent: "on-page-seo", priority: "high", operatorId: "00000000-0000-4000-8000-0000000000aa" };

describe("listing", () => {
  test("reads one project's tasks with a bounded limit and an optional status, and never another project's", async () => {
    const own = task();
    const other = task({ id: "t0000000-0000-4000-8000-000000000002", projectId: "other-client" });
    const { store, listed } = fakeStore([own, other]);
    const service = createAgentTaskService(store);
    assert.deepEqual(await service.listTasks({ projectId: "nexra-agency" }), { status: "listed", tasks: [own] });
    assert.deepEqual(listed, [{ projectId: "nexra-agency", limit: 50 }]);
    assert.deepEqual(await service.listTasks({ projectId: "nexra-agency", status: "ready", limit: 500 }), { status: "listed", tasks: [] });
    assert.deepEqual(listed[1], { projectId: "nexra-agency", status: "ready", limit: 100 });
    assert.deepEqual(await service.listTasks({ projectId: "nobody" }), { status: "listed", tasks: [] });
  });

  test("a foreign row a store hands back is dropped, never shown", async () => {
    const store: AgentTaskStore = { ...noWorkflow, storesTasks: true, async listForProject() { return [task({ projectId: "other-client" })]; }, async create() { return { status: "project-not-found" }; } };
    assert.deepEqual(await createAgentTaskService(store).listTasks({ projectId: "nexra-agency" }), { status: "listed", tasks: [] });
  });

  test("answers unavailable where tasks are not kept", async () => {
    assert.deepEqual(await createAgentTaskService(unavailableAgentTaskStore).listTasks({ projectId: "nexra-agency" }), { status: "unavailable" });
  });
});

describe("creating", () => {
  test("passes the operator's decision to the store unchanged and hands the outcome back; no run, no execution", async () => {
    const { store, created } = fakeStore();
    const result = await createAgentTaskService(store).createTask(input);
    assert.equal(result.status, "created");
    if (result.status !== "created") return;
    assert.equal(result.task.status, "backlog");
    assert.equal(result.task.owningAgent, "on-page-seo");
    assert.deepEqual(created, [input]);
    assert.equal(Object.keys(store).includes("execute"), false, "the store has no execute path");
  });

  test("every refusal the store answers is handed back as is", async () => {
    for (const status of ["project-not-found", "run-not-found", "run-not-completed", "run-not-director", "keyword-not-found"] as const) {
      const store: AgentTaskStore = { ...noWorkflow, storesTasks: true, async listForProject() { return []; }, async create() { return { status }; } };
      assert.deepEqual(await createAgentTaskService(store).createTask(input), { status });
    }
  });

  test("answers unavailable where tasks are not kept, writing nothing", async () => {
    assert.deepEqual(await createAgentTaskService(unavailableAgentTaskStore).createTask(input), { status: "unavailable" });
  });
});

// ---------------------------------------------------------------------------
// The workflow: status, owner, history and the handoff, over a store that
// keeps the rules the database keeps, and a run path that counts.

const OPERATOR = "00000000-0000-4000-8000-0000000000aa";

function workflowStore(initial: AgentTask) {
  let current = initial;
  const events: AgentTaskEvent[] = [];
  const activeRuns = new Set<string>();
  let seq = 0;
  const event = (over: Partial<AgentTaskEvent>): AgentTaskEvent => {
    seq += 1;
    const row: AgentTaskEvent = { id: `e0000000-0000-4000-8000-${String(seq).padStart(12, "0")}`, seq, taskId: current.id, projectId: current.projectId, type: "created", fromStatus: null, toStatus: null, fromAgent: null, toAgent: null, runId: null, actor: OPERATOR, createdAt: "2026-09-26T04:00:00.000Z", ...over };
    events.push(row);
    return row;
  };
  event({ type: "created" });
  const own = (projectId: string, taskId: string) => projectId === current.projectId && taskId === current.id;
  const store: AgentTaskStore = {
    storesTasks: true,
    async listForProject() { return [current]; },
    async create() { return { status: "project-not-found" }; },
    async getForProject(projectId, taskId) { return own(projectId, taskId) ? current : null; },
    async listEvents(projectId, taskId) { return own(projectId, taskId) ? events : []; },
    async setStatus(input) {
      if (!own(input.projectId, input.taskId)) return { status: "task-not-found" };
      if (current.status === input.status) return { status: "same-status", task: current };
      if (current.status === "completed" || current.status === "cancelled") return { status: "terminal", task: current };
      const from = current.status;
      current = { ...current, status: input.status };
      return { status: "transitioned", task: current, event: event({ type: "status-changed", fromStatus: from, toStatus: input.status }) };
    },
    async setOwner(input) {
      if (!own(input.projectId, input.taskId)) return { status: "task-not-found" };
      if (current.owningAgent === input.owningAgent) return { status: "same-owner", task: current };
      const from = current.owningAgent;
      current = { ...current, owningAgent: input.owningAgent };
      return { status: "owner-changed", task: current, event: event({ type: "owner-changed", fromAgent: from, toAgent: input.owningAgent }) };
    },
    async handoffRequest(input) {
      if (!own(input.projectId, input.taskId)) return { status: "task-not-found" };
      if (current.status === "completed" || current.status === "cancelled") return { status: "terminal", task: current };
      const active = [...activeRuns][0];
      if (active) return { status: "handoff-active", task: current, runId: active };
      return { status: "requested", task: current, event: event({ type: "handoff-requested", toAgent: current.owningAgent }) };
    },
    async handoffLink(input) {
      if (!own(input.projectId, input.taskId)) return { status: "task-not-found" };
      if (events.some((e) => e.type === "handoff-run-linked" && e.runId === input.runId)) return { status: "already-linked", task: current, runId: input.runId };
      activeRuns.add(input.runId);
      return { status: "linked", task: current, runId: input.runId, event: event({ type: "handoff-run-linked", toAgent: current.owningAgent, runId: input.runId }) };
    },
  };
  return { store, events, current: () => current, finishRun: (id: string) => activeRuns.delete(id) };
}

function countingRuns(refuse: string | null = null) {
  const requests: { operatorId: string; request: Parameters<HandoffRunCreator["createRun"]>[1]; options: { sourceTaskId: string } }[] = [];
  const runs = new Map<string, AgentRun>();
  const creator: HandoffRunCreator = {
    async createRun(operatorId, request, options) {
      requests.push({ operatorId, request, options });
      if (refuse) return { ok: false, reason: refuse };
      const key = JSON.stringify([request.projectId, request.agentId, request.taskType, request.input, options.sourceTaskId]);
      const existing = runs.get(key);
      if (existing) return { ok: true, run: existing, duplicate: true };
      const run = {
        id: `11111111-0000-4000-8000-${String(runs.size + 1).padStart(12, "0")}`,
        projectId: request.projectId,
        agentId: request.agentId,
        taskType: request.taskType,
        input: { ...request.input, sourceTaskId: options.sourceTaskId },
        status: "queued",
        source: "operator",
        executor: null,
        attemptCount: 0,
        maxAttempts: 3,
        resultSummary: null,
        resultMetadata: null,
        error: null,
        createdBy: operatorId,
        cancelledBy: null,
        createdAt: "2026-09-26T04:00:00.000Z",
        updatedAt: "2026-09-26T04:00:00.000Z",
        startedAt: null,
        finishedAt: null,
        nextAttemptAt: null,
        autoRetryCount: 0,
      } as AgentRun;
      runs.set(key, run);
      return { ok: true, run, duplicate: false };
    },
  };
  return { creator, requests, runs };
}

const base = { projectId: "nexra-agency", taskId: "t0000000-0000-4000-8000-000000000001", operatorId: OPERATOR };

describe("status and owner", () => {
  test("a transition is passed to the store and its event handed back; a refusal comes back as is", async () => {
    const { store, events } = workflowStore(task());
    const service = createAgentTaskService(store);
    const moved = await service.changeStatus({ ...base, status: "ready" });
    assert.equal(moved.status, "transitioned");
    if (moved.status !== "transitioned") return;
    assert.equal(moved.task.status, "ready");
    assert.deepEqual([moved.event.type, moved.event.fromStatus, moved.event.toStatus], ["status-changed", "backlog", "ready"]);
    assert.deepEqual(await service.changeStatus({ ...base, status: "ready" }), { status: "same-status", task: moved.task });
    assert.deepEqual(await service.changeStatus({ ...base, projectId: "other-client", status: "blocked" }), { status: "task-not-found" });
    assert.equal(events.length, 2);
  });

  test("an owner change names both agents in its event and moves no status", async () => {
    const { store, current } = workflowStore(task());
    const service = createAgentTaskService(store);
    const changed = await service.changeOwner({ ...base, owningAgent: "technical-seo" });
    assert.equal(changed.status, "owner-changed");
    if (changed.status !== "owner-changed") return;
    assert.deepEqual([changed.event.fromAgent, changed.event.toAgent], ["project-manager", "technical-seo"]);
    assert.equal(current().status, "backlog");
    assert.deepEqual(await service.changeOwner({ ...base, owningAgent: "technical-seo" }), { status: "same-owner", task: current() });
    assert.deepEqual(await service.changeOwner({ ...base, taskId: "t0000000-0000-4000-8000-000000000009", owningAgent: "writer" }), { status: "task-not-found" });
  });

  test("a task is read with its history for its own project only; unavailable where tasks are not kept", async () => {
    const { store } = workflowStore(task());
    const service = createAgentTaskService(store);
    const found = await service.readTask("nexra-agency", base.taskId);
    assert.equal(found.status, "found");
    if (found.status !== "found") return;
    assert.equal(found.events.length, 1);
    assert.equal(found.events[0].type, "created");
    assert.deepEqual(await service.readTask("other-client", base.taskId), { status: "task-not-found" });
    assert.deepEqual(await createAgentTaskService(unavailableAgentTaskStore).readTask("nexra-agency", base.taskId), { status: "unavailable" });
    assert.deepEqual(await createAgentTaskService(unavailableAgentTaskStore).changeStatus({ ...base, status: "ready" }), { status: "unavailable" });
    assert.deepEqual(await createAgentTaskService(unavailableAgentTaskStore).changeOwner({ ...base, owningAgent: "writer" }), { status: "unavailable" });
  });
});

describe("the handoff", () => {
  test("a supported owner gets exactly one queued run of the mapped task, same project, with the task id as provenance, and the link recorded", async () => {
    const { store, events } = workflowStore(task({ owningAgent: "seo-director" }));
    const { creator, requests, runs } = countingRuns();
    const result = await createAgentTaskService(store, creator).handoff(base);
    assert.equal(result.status, "handed-off");
    if (result.status !== "handed-off") return;
    assert.equal(result.duplicate, false);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].request, { projectId: "nexra-agency", agentId: "seo-director", taskType: "project-priority-review", input: {} });
    assert.deepEqual(requests[0].options, { sourceTaskId: base.taskId });
    assert.equal(requests[0].operatorId, OPERATOR);
    assert.equal(result.run.status, "queued", "queued, never executed");
    assert.equal(result.run.projectId, "nexra-agency");
    assert.equal(result.run.input.sourceTaskId, base.taskId);
    assert.equal(runs.size, 1);
    assert.deepEqual(events.map((e) => e.type), ["created", "handoff-requested", "handoff-run-linked"]);
    assert.equal(events[2].runId, result.run.id);
  });

  test("a second confirmation while the linked run is active creates nothing: handoff-active names the run", async () => {
    const { store, events, finishRun } = workflowStore(task({ owningAgent: "keyword-intent" }));
    const { creator, requests } = countingRuns();
    const service = createAgentTaskService(store, creator);
    const first = await service.handoff(base);
    assert.equal(first.status, "handed-off");
    if (first.status !== "handed-off") return;
    assert.deepEqual(first.run.input, { range: "30d", sourceTaskId: base.taskId });
    const second = await service.handoff(base);
    assert.deepEqual(second, { status: "handoff-active", task: store.storesTasks ? first.task : first.task, runId: first.run.id });
    assert.equal(requests.length, 1, "the run path was not asked again");
    assert.equal(events.filter((e) => e.type === "handoff-requested").length, 1);
    // Once that run is no longer active, the run path's own duplicate rule may still hand back the same run: recorded once.
    finishRun(first.run.id);
    const third = await service.handoff(base);
    assert.equal(third.status, "handed-off");
    if (third.status !== "handed-off") return;
    assert.equal(third.duplicate, true);
    assert.equal(third.run.id, first.run.id);
    assert.equal(events.filter((e) => e.type === "handoff-run-linked").length, 1, "already-linked writes no second link");
  });

  test("an unsupported owner records nothing and asks the run path for nothing", async () => {
    const { store, events } = workflowStore(task({ owningAgent: "technical-seo" }));
    const { creator, requests } = countingRuns();
    const result = await createAgentTaskService(store, creator).handoff(base);
    assert.equal(result.status, "handoff-unsupported");
    assert.equal(requests.length, 0);
    assert.equal(events.length, 1);
  });

  test("a terminal task, another project's task and a refused run path each create no run", async () => {
    const done = workflowStore(task({ owningAgent: "project-manager", status: "completed" }));
    const runsA = countingRuns();
    assert.equal((await createAgentTaskService(done.store, runsA.creator).handoff(base)).status, "terminal");
    assert.equal(runsA.requests.length, 0);
    const other = workflowStore(task({ owningAgent: "project-manager" }));
    assert.deepEqual(await createAgentTaskService(other.store, runsA.creator).handoff({ ...base, projectId: "other-client" }), { status: "task-not-found" });
    const refused = workflowStore(task({ owningAgent: "content-strategist" }));
    const runsB = countingRuns("unknown-project");
    const result = await createAgentTaskService(refused.store, runsB.creator).handoff(base);
    assert.equal(result.status, "run-refused");
    if (result.status !== "run-refused") return;
    assert.equal(result.reason, "unknown-project");
    assert.deepEqual(refused.events.map((e) => e.type), ["created", "handoff-requested"], "the request stays in the history; no link");
    assert.deepEqual(await createAgentTaskService(refused.store, null).handoff(base), { status: "unavailable" });
  });
});

describe("readOutcome (checkpoint 2.2): computed from the linked run, never written", () => {
  const TASK = task({ id: "a0000000-0000-4000-8000-000000000001" });
  const RUN_ID = "b0000000-0000-4000-8000-000000000001";
  const linked = (seq: number, runId: string, over: Partial<AgentTaskEvent> = {}): AgentTaskEvent => ({
    id: `e0000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    seq,
    taskId: TASK.id,
    projectId: TASK.projectId,
    type: "handoff-run-linked",
    fromStatus: null,
    toStatus: null,
    fromAgent: null,
    toAgent: "project-manager",
    runId,
    actor: "00000000-0000-4000-8000-0000000000aa",
    createdAt: "2026-09-26T04:00:00.000Z",
    ...over,
  });
  const run = (over: Partial<AgentRun> = {}): AgentRun =>
    ({
      id: RUN_ID,
      projectId: TASK.projectId,
      agentId: "project-manager",
      taskType: "intake-review",
      input: { sourceTaskId: TASK.id },
      status: "completed",
      source: "operator",
      executor: "ai",
      attemptCount: 1,
      maxAttempts: 3,
      resultSummary: "Summary.",
      resultMetadata: { model: "claude-opus-5" },
      error: null,
      createdBy: "00000000-0000-4000-8000-0000000000aa",
      cancelledBy: null,
      createdAt: "2026-09-26T04:00:00.000Z",
      updatedAt: "2026-09-26T04:05:00.000Z",
      startedAt: "2026-09-26T04:04:00.000Z",
      finishedAt: "2026-09-26T04:05:00.000Z",
      nextAttemptAt: null,
      autoRetryCount: 0,
      ...over,
    }) as AgentRun;

  /** A store whose every write throws: the outcome read must never reach one. */
  const readOnlyStore: AgentTaskStore = {
    storesTasks: true,
    async listForProject() { return []; },
    async getForProject() { return TASK; },
    async listEvents() { return []; },
    async create() { throw new Error("no write"); },
    async setStatus() { throw new Error("no write"); },
    async setOwner() { throw new Error("no write"); },
    async handoffRequest() { throw new Error("no write"); },
    async handoffLink() { throw new Error("no write"); },
  };
  const reader = (answer: (runId: string) => Promise<{ ok: true; run: AgentRun } | { ok: false; reason: string }>) => {
    const asked: string[] = [];
    return { asked, getRun: async (runId: string) => { asked.push(runId); return answer(runId); } };
  };

  test("no handoff: none, and the run path is never asked", async () => {
    const runs = reader(async () => { throw new Error("not asked"); });
    const service = createAgentTaskService(readOnlyStore, null, runs);
    assert.deepEqual(await service.readOutcome(TASK, []), { status: "none" });
    assert.deepEqual(runs.asked, []);
  });

  test("reads only the newest linked run, and shows it when it is provably the task's", async () => {
    const runs = reader(async () => ({ ok: true, run: run() }));
    const service = createAgentTaskService(readOnlyStore, null, runs);
    const outcome = await service.readOutcome(TASK, [linked(8, RUN_ID), linked(3, "b0000000-0000-4000-8000-000000000009")]);
    assert.deepEqual(runs.asked, [RUN_ID]);
    assert.equal(outcome.status, "completed");
    if (outcome.status === "completed") assert.equal(outcome.resultSummary, "Summary.");
  });

  test("a link event of another task or project is ignored", async () => {
    const runs = reader(async () => ({ ok: true, run: run() }));
    const service = createAgentTaskService(readOnlyStore, null, runs);
    assert.deepEqual(await service.readOutcome(TASK, [linked(8, RUN_ID, { taskId: "a0000000-0000-4000-8000-000000000002" }), linked(9, RUN_ID, { projectId: "other-client" })]), { status: "none" });
    assert.deepEqual(runs.asked, []);
  });

  test("unavailable, never guessed: no reader, not found, a failed read, a throw, another project or another task", async () => {
    const cases: [string, ReturnType<typeof reader> | null][] = [
      ["no reader", null],
      ["not found", reader(async () => ({ ok: false, reason: "not-found" }))],
      ["store unavailable", reader(async () => ({ ok: false, reason: "unavailable" }))],
      ["throws", reader(async () => { throw new Error("boom"); })],
      ["other project", reader(async () => ({ ok: true, run: run({ projectId: "other-client" }) }))],
      ["other task", reader(async () => ({ ok: true, run: run({ input: { sourceTaskId: "a0000000-0000-4000-8000-000000000002" } }) }))],
      ["no provenance", reader(async () => ({ ok: true, run: run({ input: {} }) }))],
    ];
    for (const [label, runs] of cases) {
      const service = createAgentTaskService(readOnlyStore, null, runs);
      assert.deepEqual(await service.readOutcome(TASK, [linked(8, RUN_ID)]), { status: "unavailable", runId: RUN_ID }, label);
    }
  });

  test("a failed rejected-output run shows its fixed code and no summary; the task is not touched", async () => {
    const runs = reader(async () => ({ ok: true, run: run({ status: "failed", resultSummary: null, error: { code: "rejected-output", message: "Refused." } }) }));
    const service = createAgentTaskService(readOnlyStore, null, runs);
    const outcome = await service.readOutcome(TASK, [linked(8, RUN_ID)]);
    assert.equal(outcome.status, "failed");
    if (outcome.status === "failed") {
      assert.equal(outcome.resultSummary, null);
      assert.equal(outcome.error?.code, "rejected-output");
    }
  });
});
