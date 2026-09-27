import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AgentRun } from "../../types/agent-run.ts";
import type { AgentTask, AgentTaskEvent } from "./contract.ts";
import { describeTaskRunOutcome, latestLinkedRunId, outcomeMismatch, presentTaskRunOutcome } from "./outcome.ts";

/**
 * The task → run outcome (checkpoint 2.2), computed at read time: which run
 * is the task's, when it may be shown, and what each run state reads as.
 */

const TASK_ID = "a0000000-0000-4000-8000-000000000001";
const RUN_1 = "b0000000-0000-4000-8000-000000000001";
const RUN_2 = "b0000000-0000-4000-8000-000000000002";

const task: AgentTask = {
  id: TASK_ID,
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
};

const event = (seq: number, over: Partial<AgentTaskEvent> = {}): AgentTaskEvent => ({
  id: `e0000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
  seq,
  taskId: TASK_ID,
  projectId: "nexra-agency",
  type: "handoff-run-linked",
  fromStatus: null,
  toStatus: null,
  fromAgent: null,
  toAgent: "project-manager",
  runId: RUN_1,
  fromPriority: null,
  toPriority: null,
  actor: "00000000-0000-4000-8000-0000000000aa",
  createdAt: "2026-09-26T04:00:00.000Z",
  ...over,
});

const run = (over: Partial<AgentRun> = {}): AgentRun => ({
  id: RUN_1,
  projectId: "nexra-agency",
  agentId: "project-manager",
  taskType: "intake-review",
  input: { sourceTaskId: TASK_ID },
  status: "completed",
  source: "operator",
  executor: "ai",
  attemptCount: 1,
  maxAttempts: 3,
  resultSummary: "RECORDED GOAL: grow.",
  resultMetadata: { model: "claude-opus-5", inputTokens: 10 },
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
});

describe("latestLinkedRunId", () => {
  test("no handoff means no run", () => {
    assert.equal(latestLinkedRunId([]), null);
    assert.equal(latestLinkedRunId([event(1, { type: "created", runId: null, toAgent: null }), event(2, { type: "handoff-requested", runId: null })]), null);
  });

  test("the newest link by seq wins, whatever order the events arrive in", () => {
    assert.equal(latestLinkedRunId([event(7, { runId: RUN_2 }), event(3, { runId: RUN_1 })]), RUN_2);
    assert.equal(latestLinkedRunId([event(3, { runId: RUN_1 }), event(9, { type: "status-changed", runId: null, fromStatus: "backlog", toStatus: "ready", toAgent: null }), event(8, { runId: RUN_2 })]), RUN_2);
  });
});

describe("outcomeMismatch: shown only when the run is provably this task's", () => {
  test("the same run, the same project and this task as sourceTaskId", () => {
    assert.equal(outcomeMismatch(task, RUN_1, run()), null);
    assert.equal(outcomeMismatch(task, RUN_1.toUpperCase(), run({ input: { sourceTaskId: TASK_ID.toUpperCase() } })), null);
  });

  test("another run, another project, another task or no provenance is refused", () => {
    assert.equal(outcomeMismatch(task, RUN_2, run()), "run-not-found");
    assert.equal(outcomeMismatch(task, RUN_1, run({ projectId: "other-client" })), "other-project");
    assert.equal(outcomeMismatch(task, RUN_1, run({ input: { sourceTaskId: "a0000000-0000-4000-8000-000000000999" } })), "not-this-task");
    assert.equal(outcomeMismatch(task, RUN_1, run({ input: {} })), "not-this-task");
    assert.equal(outcomeMismatch(task, RUN_1, run({ input: { sourceTaskId: 7 } })), "not-this-task");
  });
});

describe("presentTaskRunOutcome: the A4 state table", () => {
  test("queued and running carry no result, no error and no finish time", () => {
    for (const status of ["queued", "running"] as const) {
      const outcome = presentTaskRunOutcome(run({ status, resultSummary: null, resultMetadata: null, finishedAt: null }));
      assert.equal(outcome.status, status);
      if (outcome.status !== status) continue;
      assert.equal(outcome.resultSummary, null);
      assert.equal(outcome.error, null);
      assert.equal(outcome.finishedAt, null);
      assert.equal(outcome.model, null);
    }
  });

  test("completed shows the screened summary, the model, the attempts and the finish time", () => {
    const outcome = presentTaskRunOutcome(run({ attemptCount: 2 }));
    assert.deepEqual(outcome, {
      status: "completed",
      runId: RUN_1,
      taskType: "intake-review",
      attemptCount: 2,
      autoRetryCount: 0,
      nextAttemptAt: null,
      finishedAt: "2026-09-26T04:05:00.000Z",
      model: "claude-opus-5",
      resultSummary: "RECORDED GOAL: grow.",
      error: null,
    });
  });

  test("failed rejected-output has no summary and the fixed code and message", () => {
    const outcome = presentTaskRunOutcome(run({ status: "failed", resultSummary: null, error: { code: "rejected-output", message: "The output was refused." } }));
    assert.equal(outcome.status, "failed");
    if (outcome.status !== "failed") return;
    assert.equal(outcome.resultSummary, null);
    assert.deepEqual(outcome.error, { code: "rejected-output", message: "The output was refused." });
    assert.match(describeTaskRunOutcome(outcome), /rejected-output\), so no answer was stored\./);
  });

  test("a failure queued again reads as retrying, with the failure and the next attempt time", () => {
    const outcome = presentTaskRunOutcome(
      run({ status: "queued", resultSummary: null, finishedAt: null, autoRetryCount: 1, nextAttemptAt: "2026-09-26T05:00:00.000Z", error: { code: "provider-unavailable", message: "The provider could not be reached." } }),
    );
    assert.equal(outcome.status, "retrying");
    if (outcome.status !== "retrying") return;
    assert.equal(outcome.nextAttemptAt, "2026-09-26T05:00:00.000Z");
    assert.equal(outcome.error?.code, "provider-unavailable");
    assert.match(describeTaskRunOutcome(outcome), /\(provider-unavailable\) and is queued again \(automatic retry 1\); it has not run again yet\./);
  });

  test("cancelled stores nothing; a completed run keeps no stale error", () => {
    const cancelled = presentTaskRunOutcome(run({ status: "cancelled", resultSummary: null }));
    assert.equal(cancelled.status, "cancelled");
    assert.match(describeTaskRunOutcome(cancelled), /was cancelled\. Nothing was stored\./);
    const recovered = presentTaskRunOutcome(run({ error: { code: "timeout", message: "Timed out." }, autoRetryCount: 1 }));
    assert.equal(recovered.status, "completed");
    if (recovered.status === "completed") assert.equal(recovered.error, null);
  });

  test("never carries the run's input, creator or metadata beyond the model", () => {
    const text = JSON.stringify(presentTaskRunOutcome(run({ input: { sourceTaskId: TASK_ID, secretish: "x" } })));
    assert.doesNotMatch(text, /sourceTaskId|secretish|createdBy|inputTokens|00000000-0000-4000-8000-0000000000aa/);
  });
});

describe("describeTaskRunOutcome", () => {
  test("none and unavailable say so and infer nothing", () => {
    assert.equal(describeTaskRunOutcome({ status: "none" }), "Not handed off yet. No run is linked to this task.");
    assert.match(describeTaskRunOutcome({ status: "unavailable", runId: RUN_1 }), /^Outcome unavailable: the linked run b0000000… cannot be read as this task's run\. Nothing is inferred\.$/);
  });

  test("queued and running never claim a result", () => {
    assert.match(describeTaskRunOutcome(presentTaskRunOutcome(run({ status: "queued", resultSummary: null }))), /is queued and has not run yet\./);
    assert.match(describeTaskRunOutcome(presentTaskRunOutcome(run({ status: "running", resultSummary: null }))), /is running\./);
  });

  test("completed names attempts and model", () => {
    assert.equal(describeTaskRunOutcome(presentTaskRunOutcome(run())), "Run b0000000… completed after 1 attempt, answered by claude-opus-5.");
  });
});
