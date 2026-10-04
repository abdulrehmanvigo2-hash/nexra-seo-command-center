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
    assert.deepEqual([...TASK_SOURCE_KINDS], ["director-run", "keyword", "opportunity", "internal-link"], "M2 adds opportunity, M8 internal-link; the table checks the same four (migration 20261027120000)");
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

// ---------------------------------------------------------------------------
// The workflow (20261004120000).

import { readFile } from "node:fs/promises";
import {
  TASK_ACTIONS,
  TASK_EVENT_META,
  TASK_EVENT_TYPES,
  TASK_TERMINAL_STATUSES,
  TASK_TRANSITIONS,
  agentTaskUrl,
  canTransitionTask,
  isTaskId,
  isTerminalTaskStatus,
  parseTaskActionRequest,
} from "./contract.ts";
import { eventRowToEvent, handoffLinkResultToOutcome, handoffRequestResultToOutcome, ownerResultToOutcome, priorityResultToOutcome, statusResultToOutcome } from "./supabase/schema.ts";

describe("the transition map", () => {
  test("is the one the user fixed, fifteen moves, terminal states allow nothing", () => {
    assert.deepEqual(TASK_TRANSITIONS, {
      backlog: ["ready", "blocked", "cancelled"],
      ready: ["in-progress", "blocked", "cancelled"],
      "in-progress": ["review", "blocked", "cancelled"],
      blocked: ["ready", "in-progress", "cancelled"],
      review: ["in-progress", "completed", "blocked"],
      completed: [],
      cancelled: [],
    });
    assert.equal(Object.values(TASK_TRANSITIONS).flat().length, 15);
    assert.deepEqual([...TASK_TERMINAL_STATUSES], ["completed", "cancelled"]);
    assert.ok(isTerminalTaskStatus("completed") && isTerminalTaskStatus("cancelled") && !isTerminalTaskStatus("review"));
    assert.ok(canTransitionTask("backlog", "ready") && !canTransitionTask("backlog", "completed") && !canTransitionTask("review", "cancelled"));
    for (const status of TASK_STATUSES) assert.ok(!canTransitionTask(status, status), `${status} → ${status} is never a transition`);
  });

  test("restates the SQL function exactly, so the panel offers only moves the database allows", async () => {
    const sql = await readFile(new URL("../../../supabase/migrations/20261004120000_agent_task_workflow.sql", import.meta.url), "utf8");
    const body = sql.slice(sql.indexOf("nexra_agent_task_transition_allowed(p_from text, p_to text)"), sql.indexOf("$$;", sql.indexOf("nexra_agent_task_transition_allowed(p_from text, p_to text)")));
    for (const [from, targets] of Object.entries(TASK_TRANSITIONS)) {
      if (targets.length === 0) {
        assert.doesNotMatch(body, new RegExp(`when '${from}'`), `${from} has no clause: else false`);
        continue;
      }
      const quoted = targets.map((target) => `'${target}'`).join(", ");
      assert.ok(body.includes(`when '${from}' then p_to in (${quoted})`), `${from} → ${quoted}`);
    }
    assert.match(body, /else false/);
  });
});

describe("the action request", () => {
  test("accepts exactly one of the three shapes and nothing more", () => {
    assert.deepEqual(parseTaskActionRequest({ project: "nexra-agency", action: "status", status: "ready" }), { ok: true, projectId: "nexra-agency", action: "status", status: "ready" });
    assert.deepEqual(parseTaskActionRequest({ project: "nexra-agency", action: "owner", owningAgent: "writer" }), { ok: true, projectId: "nexra-agency", action: "owner", owningAgent: "writer" });
    assert.deepEqual(parseTaskActionRequest({ project: "nexra-agency", action: "handoff" }), { ok: true, projectId: "nexra-agency", action: "handoff", record: null });
    const invalid: unknown[] = [
      null,
      [],
      "status",
      { action: "status", status: "ready" },
      { project: "Nexra Agency", action: "status", status: "ready" },
      { project: "nexra-agency", action: "status", status: "done" },
      { project: "nexra-agency", action: "status" },
      { project: "nexra-agency", action: "status", status: "ready", owningAgent: "writer" },
      { project: "nexra-agency", action: "owner", owningAgent: "ghost" },
      { project: "nexra-agency", action: "owner", owningAgent: "writer", status: "ready" },
      { project: "nexra-agency", action: "handoff", agentId: "writer" },
      { project: "nexra-agency", action: "handoff", taskType: "crawl-review" },
      { project: "nexra-agency", action: "handoff", input: {} },
      { project: "nexra-agency", action: "execute" },
      { project: "nexra-agency", action: "delete" },
    ];
    for (const body of invalid) assert.deepEqual(parseTaskActionRequest(body), { ok: false, error: "invalid" }, JSON.stringify(body));
  });

  test("a handoff carries at most one operator-chosen record: a crawl id or a non-empty competitor domain (cp 2.3)", () => {
    const CRAWL = "c0000000-0000-4000-8000-00000000000A";
    assert.deepEqual(parseTaskActionRequest({ project: "nexra-agency", action: "handoff", crawlId: CRAWL }), { ok: true, projectId: "nexra-agency", action: "handoff", record: { crawlId: CRAWL.toLowerCase() } });
    assert.deepEqual(parseTaskActionRequest({ project: "nexra-agency", action: "handoff", competitorDomain: " rival.example " }), { ok: true, projectId: "nexra-agency", action: "handoff", record: { competitorDomain: "rival.example" } });
    const invalid: unknown[] = [
      { project: "nexra-agency", action: "handoff", crawlId: "not-a-uuid" },
      { project: "nexra-agency", action: "handoff", crawlId: 7 },
      { project: "nexra-agency", action: "handoff", competitorDomain: "" },
      { project: "nexra-agency", action: "handoff", competitorDomain: "   " },
      { project: "nexra-agency", action: "handoff", competitorDomain: 3 },
      { project: "nexra-agency", action: "handoff", competitorDomain: `${"a".repeat(250)}.example` },
      { project: "nexra-agency", action: "handoff", crawlId: CRAWL, competitorDomain: "rival.example" },
      { project: "nexra-agency", action: "status", status: "ready", crawlId: CRAWL },
      { project: "nexra-agency", action: "owner", owningAgent: "writer", competitorDomain: "rival.example" },
    ];
    for (const body of invalid) assert.deepEqual(parseTaskActionRequest(body), { ok: false, error: "invalid" }, JSON.stringify(body));
  });

  test("a task id is a uuid; the task url names the task and its project", () => {
    assert.ok(isTaskId("30e79092-6258-4fff-8d1f-c1e2921764b8") && isTaskId("30E79092-6258-4FFF-8D1F-C1E2921764B8"));
    assert.ok(!isTaskId("30e79092") && !isTaskId(42) && !isTaskId(""));
    assert.equal(agentTaskUrl("30e79092-6258-4fff-8d1f-c1e2921764b8", "nexra-agency"), "/api/agent-tasks/30e79092-6258-4fff-8d1f-c1e2921764b8?project=nexra-agency");
  });
});

describe("the event rows and the function answers", () => {
  const taskRow = { id: "30e79092-6258-4fff-8d1f-c1e2921764b8", project_id: "nexra-agency", title: "T", source_kind: "director-run", source_ref: RUN_ID, owning_agent: "project-manager", status: "ready", priority: "medium", created_by: "00000000-0000-4000-8000-0000000000aa", created_at: "2026-09-26T03:00:00+00:00", updated_at: "2026-09-26T04:00:00+00:00" };
  const eventRow = { id: "e0000000-0000-4000-8000-000000000001", seq: 2, task_id: taskRow.id, project_id: "nexra-agency", event_type: "status-changed", from_status: "backlog", to_status: "ready", from_agent: null, to_agent: null, run_id: null, actor: taskRow.created_by, created_at: "2026-09-26T04:00:00+00:00" };

  test("the eight event types (M3 adds two); a row is translated field by field and a row that names the unknown is refused", () => {
    assert.deepEqual([...TASK_EVENT_TYPES], ["created", "status-changed", "owner-changed", "handoff-requested", "handoff-run-linked", "priority-changed", "plan-date-changed", "article-linked"]);
    const event = eventRowToEvent(eventRow);
    assert.deepEqual(event, { id: eventRow.id, seq: 2, taskId: taskRow.id, projectId: "nexra-agency", type: "status-changed", fromStatus: "backlog", toStatus: "ready", fromAgent: null, toAgent: null, runId: null, fromPriority: null, toPriority: null, fromDate: null, toDate: null, articleId: null, actor: taskRow.created_by, createdAt: eventRow.created_at });
    assert.equal(eventRowToEvent({ ...eventRow, seq: "17" }).seq, 17, "a bigint that arrives as text");
    assert.throws(() => eventRowToEvent({ ...eventRow, event_type: "deleted" }), /event_type "deleted"/);
    assert.throws(() => eventRowToEvent({ ...eventRow, to_status: "done" }), /to_status "done"/);
    assert.throws(() => eventRowToEvent({ ...eventRow, to_agent: "ghost" }), /to_agent "ghost"/);
    assert.throws(() => eventRowToEvent({ ...eventRow, seq: "x" }), /seq/);
  });

  test("a priority-changed row carries its two priorities; a row read before migration 20261005120000 has none (cp 2.3b)", () => {
    const priority = eventRowToEvent({ ...eventRow, event_type: "priority-changed", from_status: null, to_status: null, from_priority: "medium", to_priority: "high" });
    assert.equal(priority.type, "priority-changed");
    assert.equal(priority.fromPriority, "medium");
    assert.equal(priority.toPriority, "high");
    // The columns are absent on a database the migration has not reached: the read still works.
    const before: Record<string, unknown> = { ...eventRow };
    delete before.from_priority;
    delete before.to_priority;
    const old = eventRowToEvent(before);
    assert.equal(old.fromPriority, null);
    assert.equal(old.toPriority, null);
    assert.throws(() => eventRowToEvent({ ...eventRow, to_priority: "urgent" }), /to_priority "urgent"/);
    assert.equal(TASK_EVENT_META["priority-changed"], "Priority changed");
  });

  test("the priority function's answers are checked (cp 2.3b)", () => {
    assert.equal(priorityResultToOutcome({ outcome: "priority-changed", task: taskRow, event: { ...eventRow, event_type: "priority-changed", from_status: null, to_status: null, from_priority: "medium", to_priority: "high" } }).status, "priority-changed");
    assert.deepEqual(priorityResultToOutcome({ outcome: "task-not-found" }), { status: "task-not-found" });
    for (const outcome of ["same-priority", "terminal", "run-not-accepted"]) assert.equal(priorityResultToOutcome({ outcome, task: taskRow }).status, outcome);
    assert.throws(() => priorityResultToOutcome({ outcome: "transitioned" }), /"transitioned"/);
  });

  test("a priority action names one of the four priorities and nothing else (cp 2.3b)", () => {
    assert.deepEqual(parseTaskActionRequest({ project: "nexra-agency", action: "priority", priority: "critical" }), { ok: true, projectId: "nexra-agency", action: "priority", priority: "critical", directorRunId: null });
    // cp 6.7: one Director run may be cited, by id; the database decides whether it is a completed project review of this project.
    const run = "288639F4-0000-4000-8000-000000000001";
    assert.deepEqual(parseTaskActionRequest({ project: "nexra-agency", action: "priority", priority: "high", directorRunId: run }), { ok: true, projectId: "nexra-agency", action: "priority", priority: "high", directorRunId: run.toLowerCase() });
    for (const body of [
      { project: "nexra-agency", action: "priority" },
      { project: "nexra-agency", action: "priority", priority: "urgent" },
      { project: "nexra-agency", action: "priority", priority: "High" },
      { project: "nexra-agency", action: "priority", priority: "high", status: "ready" },
      { project: "nexra-agency", action: "priority", priority: "high", directorRunId: "288639f4" },
      { project: "nexra-agency", action: "priority", priority: "high", directorRunId: null },
      { project: "nexra-agency", action: "priority", priority: "high", runId: "288639f4-0000-4000-8000-000000000001" },
      { project: "nexra-agency", action: "priority", directorRunId: "288639f4-0000-4000-8000-000000000001" },
      { project: "Nexra", action: "priority", priority: "high" },
    ]) assert.deepEqual(parseTaskActionRequest(body), { ok: false, error: "invalid" }, JSON.stringify(body));
    assert.deepEqual([...TASK_ACTIONS], ["status", "owner", "priority", "handoff"]);
  });

  test("each function answer is checked, and an answer the function never promised is an error", () => {
    assert.equal(statusResultToOutcome({ outcome: "transitioned", task: taskRow, event: eventRow }).status, "transitioned");
    assert.deepEqual(statusResultToOutcome({ outcome: "task-not-found" }), { status: "task-not-found" });
    for (const outcome of ["same-status", "terminal", "transition-not-allowed"]) assert.equal(statusResultToOutcome({ outcome, task: taskRow }).status, outcome);
    assert.throws(() => statusResultToOutcome({ outcome: "moved" }), /"moved"/);
    assert.equal(ownerResultToOutcome({ outcome: "owner-changed", task: taskRow, event: { ...eventRow, event_type: "owner-changed", from_status: null, to_status: null, from_agent: "project-manager", to_agent: "writer" } }).status, "owner-changed");
    assert.throws(() => ownerResultToOutcome({ outcome: "transitioned", task: taskRow }), /"transitioned"/);
    const request = handoffRequestResultToOutcome({ outcome: "handoff-active", task: taskRow, run_id: RUN_ID });
    assert.deepEqual(request.status === "handoff-active" ? request.runId : null, RUN_ID);
    assert.equal(handoffRequestResultToOutcome({ outcome: "requested", task: taskRow, event: { ...eventRow, event_type: "handoff-requested", from_status: null, to_status: null, to_agent: "project-manager" } }).status, "requested");
    assert.equal(handoffLinkResultToOutcome({ outcome: "linked", task: taskRow, run_id: RUN_ID, event: { ...eventRow, event_type: "handoff-run-linked", from_status: null, to_status: null, to_agent: "project-manager", run_id: RUN_ID } }).status, "linked");
    assert.deepEqual(handoffLinkResultToOutcome({ outcome: "run-not-found" }), { status: "run-not-found" });
    assert.throws(() => handoffLinkResultToOutcome({ outcome: "requested" }), /"requested"/);
  });
});
