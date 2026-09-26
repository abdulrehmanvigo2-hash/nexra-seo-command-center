import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AgentTask, CreateAgentTaskInput, ListAgentTasksFilter } from "./contract.ts";
import { createAgentTaskService } from "./service.ts";
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

function fakeStore(rows: readonly AgentTask[] = []) {
  const listed: ListAgentTasksFilter[] = [];
  const created: CreateAgentTaskInput[] = [];
  const store: AgentTaskStore = {
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
    const store: AgentTaskStore = { storesTasks: true, async listForProject() { return [task({ projectId: "other-client" })]; }, async create() { return { status: "project-not-found" }; } };
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
      const store: AgentTaskStore = { storesTasks: true, async listForProject() { return []; }, async create() { return { status }; } };
      assert.deepEqual(await createAgentTaskService(store).createTask(input), { status });
    }
  });

  test("answers unavailable where tasks are not kept, writing nothing", async () => {
    assert.deepEqual(await createAgentTaskService(unavailableAgentTaskStore).createTask(input), { status: "unavailable" });
  });
});
