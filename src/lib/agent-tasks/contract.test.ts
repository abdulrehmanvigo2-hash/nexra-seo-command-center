import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AGENT_REGISTRY } from "../mock/agents/registry.ts";
import {
  TASK_OWNING_AGENTS,
  TASK_PRIORITIES,
  TASK_READ_DEFAULT_LIMIT,
  TASK_READ_LIMIT,
  TASK_SOURCE_KINDS,
  TASK_STATUSES,
  TASK_TITLE_MAX_LENGTH,
  agentTasksUrl,
  normaliseTaskTitle,
  parseCreateTaskRequest,
  parseListTasksRequest,
} from "./contract.ts";
import { createResultToOutcome, taskRowToTask } from "./supabase/schema.ts";

/**
 * The failure this file exists to prevent is a task that names something the
 * product does not have — an agent outside the registry, a status or
 * priority outside the fixed sets, a source of a kind nobody checks — or a
 * request that reaches the database with a field it never asked for.
 */

const RUN_ID = "d0000000-0000-4000-8000-000000000001";
const good = { project: "nexra-agency", title: "Write the missing /services meta description", sourceKind: "director-run", sourceRef: RUN_ID, owningAgent: "on-page-seo", priority: "high" };

describe("the fixed sets", () => {
  test("statuses, priorities and source kinds are exactly the ones the table checks", () => {
    assert.deepEqual([...TASK_STATUSES], ["backlog", "ready", "in-progress", "blocked", "review", "completed", "cancelled"]);
    assert.deepEqual([...TASK_PRIORITIES], ["low", "medium", "high", "critical"]);
    assert.deepEqual([...TASK_SOURCE_KINDS], ["director-run", "keyword"]);
    assert.equal(TASK_TITLE_MAX_LENGTH, 200);
    assert.equal(TASK_READ_LIMIT, 100);
    assert.equal(TASK_READ_DEFAULT_LIMIT, 50);
  });

  test("the owning agents are the twelve registry agents, in registry order — the SQL restatement cannot drift", () => {
    assert.deepEqual([...TASK_OWNING_AGENTS], AGENT_REGISTRY.map((agent) => agent.id));
    assert.equal(TASK_OWNING_AGENTS.length, 12);
  });
});

describe("the title", () => {
  test("is trimmed and bounded, refuses blank, over-long, control characters and non-text", () => {
    assert.deepEqual(normaliseTaskTitle("  Fix the H1  "), { ok: true, title: "Fix the H1" });
    assert.deepEqual(normaliseTaskTitle("   "), { ok: false, reason: "blank" });
    assert.deepEqual(normaliseTaskTitle("x".repeat(201)), { ok: false, reason: "too-long" });
    assert.deepEqual(normaliseTaskTitle("x".repeat(200)), { ok: true, title: "x".repeat(200) });
    assert.deepEqual(normaliseTaskTitle("line\nbreak"), { ok: false, reason: "control-characters" });
    assert.deepEqual(normaliseTaskTitle(42), { ok: false, reason: "not-text" });
    assert.deepEqual(normaliseTaskTitle(undefined), { ok: false, reason: "not-text" });
  });
});

describe("the create request", () => {
  test("accepts exactly the six fields, lower-cases a run id, defaults the priority to medium", () => {
    assert.deepEqual(parseCreateTaskRequest({ ...good, sourceRef: RUN_ID.toUpperCase() }), {
      ok: true,
      projectId: "nexra-agency",
      title: good.title,
      sourceKind: "director-run",
      sourceRef: RUN_ID,
      owningAgent: "on-page-seo",
      priority: "high",
    });
    const { priority: _omitted, ...withoutPriority } = good;
    void _omitted;
    const parsed = parseCreateTaskRequest(withoutPriority);
    assert.equal(parsed.ok && parsed.priority, "medium");
  });

  test("a keyword source ref is the query text verbatim: never trimmed, re-cased or otherwise touched", () => {
    const parsed = parseCreateTaskRequest({ ...good, sourceKind: "keyword", sourceRef: "  Business Banking  ", owningAgent: "keyword-intent" });
    assert.equal(parsed.ok && parsed.sourceRef, "  Business Banking  ");
  });

  test("refuses an unknown field, a bad project id, an invalid title, an unknown source kind, agent or priority, and a malformed run id", () => {
    const bad: unknown[] = [
      null,
      [],
      { ...good, status: "ready" },
      { ...good, extra: 1 },
      { ...good, project: "Nexra Agency" },
      { ...good, project: "x".repeat(65) },
      { ...good, title: "" },
      { ...good, title: "x".repeat(201) },
      { ...good, sourceKind: "crawl" },
      { ...good, sourceRef: "not-a-run" },
      { ...good, sourceRef: "" },
      { ...good, sourceKind: "keyword", sourceRef: "" },
      { ...good, sourceKind: "keyword", sourceRef: "x".repeat(2049) },
      { ...good, sourceKind: "keyword", sourceRef: "bad\u0000query" },
      { ...good, owningAgent: "ghost-agent" },
      { ...good, owningAgent: "" },
      { ...good, priority: "urgent" },
      { ...good, priority: null },
    ];
    for (const body of bad) assert.deepEqual(parseCreateTaskRequest(body), { ok: false, error: "invalid" }, JSON.stringify(body));
  });

  test("never lets a caller choose the status: a task is created in backlog by the database", () => {
    assert.deepEqual(parseCreateTaskRequest({ ...good, status: "completed" }), { ok: false, error: "invalid" });
  });
});

describe("the list request", () => {
  test("needs a project, takes an optional status and a bounded limit, and defaults the limit", () => {
    assert.deepEqual(parseListTasksRequest({ project: "nexra-agency", status: null, limit: null }), { ok: true, filter: { projectId: "nexra-agency", limit: 50 } });
    assert.deepEqual(parseListTasksRequest({ project: "nexra-agency", status: "blocked", limit: "10" }), { ok: true, filter: { projectId: "nexra-agency", status: "blocked", limit: 10 } });
    assert.deepEqual(parseListTasksRequest({ project: "nexra-agency", status: null, limit: "100" }).ok, true);
    for (const params of [
      { project: null, status: null, limit: null },
      { project: "Bad Project", status: null, limit: null },
      { project: "nexra-agency", status: "done", limit: null },
      { project: "nexra-agency", status: null, limit: "0" },
      { project: "nexra-agency", status: null, limit: "101" },
      { project: "nexra-agency", status: null, limit: "ten" },
    ]) assert.deepEqual(parseListTasksRequest(params), { ok: false, error: "invalid" }, JSON.stringify(params));
  });

  test("the url names the project, and optionally a status and limit", () => {
    assert.equal(agentTasksUrl("nexra-agency"), "/api/agent-tasks?project=nexra-agency");
    assert.equal(agentTasksUrl("nexra-agency", { status: "backlog", limit: 20 }), "/api/agent-tasks?project=nexra-agency&status=backlog&limit=20");
  });
});

describe("the stored row and the function's answer", () => {
  const row = { id: "t0000000-0000-4000-8000-000000000001", project_id: "nexra-agency", title: "T", source_kind: "keyword", source_ref: "business banking", owning_agent: "writer", status: "backlog", priority: "low", created_by: "00000000-0000-4000-8000-0000000000aa", created_at: "2026-09-26T03:00:00.000Z", updated_at: "2026-09-26T03:00:00.000Z" };

  test("a row is translated field by field, and a value outside the fixed sets is refused, never guessed", () => {
    assert.deepEqual(taskRowToTask(row), { id: row.id, projectId: "nexra-agency", title: "T", sourceKind: "keyword", sourceRef: "business banking", owningAgent: "writer", status: "backlog", priority: "low", createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at });
    assert.throws(() => taskRowToTask({ ...row, status: "done" }), /status "done"/);
    assert.throws(() => taskRowToTask({ ...row, owning_agent: "ghost" }), /owning_agent "ghost"/);
    assert.throws(() => taskRowToTask({ ...row, priority: "urgent" }), /priority "urgent"/);
    assert.throws(() => taskRowToTask({ ...row, source_kind: "crawl" }), /source_kind "crawl"/);
    assert.throws(() => taskRowToTask({ ...row, title: 3 }), /title is not a string/);
  });

  test("every outcome the function promises is recognised, and nothing else", () => {
    assert.deepEqual(createResultToOutcome({ outcome: "created", task: row }), { status: "created", task: taskRowToTask(row) });
    for (const outcome of ["project-not-found", "run-not-found", "run-not-completed", "run-not-director", "keyword-not-found"]) {
      assert.deepEqual(createResultToOutcome({ outcome }), { status: outcome });
    }
    assert.throws(() => createResultToOutcome({ outcome: "assigned" }), /"assigned"/);
    assert.throws(() => createResultToOutcome(null), /not an object/);
  });
});
