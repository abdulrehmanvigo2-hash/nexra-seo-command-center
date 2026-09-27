import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AgentRun } from "../../types/agent-run.ts";
import { LEARNING_LABEL, learningsReadFailure, learningsUrl, presentLearnings } from "./learnings.ts";

/**
 * Checkpoint 4.3, decision Q2: learnings are the project's completed
 * performance-review runs, read back — no table. Each case is a way the
 * list could mislead: a failed, queued, simulated or other-task run shown as
 * a learning, an older reading shown first, or a window guessed.
 */

let n = 0;
function run(over: Partial<AgentRun> = {}): AgentRun {
  n += 1;
  return {
    id: `run-${String(n).padStart(4, "0")}-0000-0000-0000-000000000000`,
    projectId: "nexra-agency",
    agentId: "analytics-learning",
    taskType: "performance-review",
    input: { range: "30d" },
    status: "completed",
    source: "operator",
    executor: "ai",
    attemptCount: 1,
    maxAttempts: 3,
    resultSummary: "WINDOWS: 2026-08-26 to 2026-09-24 (30d).",
    resultMetadata: { model: "claude-opus-5", evidence: { startDate: "2026-08-26", endDate: "2026-09-24" } },
    error: null,
    createdBy: "operator",
    cancelledBy: null,
    createdAt: "2026-09-27T11:22:13.000Z",
    updatedAt: "2026-09-27T11:22:33.000Z",
    startedAt: "2026-09-27T11:22:14.000Z",
    finishedAt: "2026-09-27T11:22:33.000Z",
    nextAttemptAt: null,
    autoRetryCount: 0,
    ...over,
  } as AgentRun;
}

describe("presentLearnings", () => {
  test("lists completed performance reviews newest first, with the window and run date", () => {
    const older = run({ id: "7711726c-77c9-4662-987a-94938de56fff", finishedAt: "2026-09-21T05:47:30.000Z", resultMetadata: { model: "claude-opus-5", evidence: { startDate: "2026-08-19", endDate: "2026-09-17" } } });
    const newer = run({ id: "17623686-d956-4eb4-a96e-5563b50e0b4f" });
    const learnings = presentLearnings([older, newer]);
    assert.deepEqual(
      learnings.map((l) => [l.runId.slice(0, 8), l.windowStart, l.windowEnd, l.ranAt, l.model]),
      [
        ["17623686", "2026-08-26", "2026-09-24", "2026-09-27T11:22:33.000Z", "claude-opus-5"],
        ["7711726c", "2026-08-19", "2026-09-17", "2026-09-21T05:47:30.000Z", "claude-opus-5"],
      ],
    );
    assert.equal(learnings[0].summary, "WINDOWS: 2026-08-26 to 2026-09-24 (30d).");
  });

  test("leaves out anything that is not a completed, model-executed performance review", () => {
    const learnings = presentLearnings([
      run({ status: "failed", resultSummary: null }),
      run({ status: "queued", resultSummary: null, finishedAt: null }),
      run({ taskType: "search-query-review", agentId: "keyword-intent" } as Partial<AgentRun>),
      run({ executor: "mock" }),
      run({ resultMetadata: { simulated: true } }),
      run({ resultSummary: "   " }),
    ]);
    assert.deepEqual(learnings, []);
  });

  test("a window the run did not record is null, never guessed", () => {
    const [learning] = presentLearnings([run({ resultMetadata: { model: "claude-opus-5" } })]);
    assert.equal(learning.windowStart, null);
    assert.equal(learning.windowEnd, null);
    const [noFinish] = presentLearnings([run({ finishedAt: null, resultMetadata: { evidence: { startDate: "bad", endDate: 5 } } })]);
    assert.equal(noFinish.ranAt, "2026-09-27T11:22:13.000Z");
    assert.equal(noFinish.windowStart, null);
    assert.equal(noFinish.model, null);
  });

  test("the empty list is empty, the label says it is not a measurement, and a failed read is not an empty list", () => {
    assert.deepEqual(presentLearnings([]), []);
    assert.equal(LEARNING_LABEL, "A model's reading of Google's report, not a measurement");
    assert.match(learningsReadFailure(500), /read failure, not an empty list/);
    assert.equal(learningsUrl("nexra-agency"), "/api/agent-runs?project=nexra-agency&agent=analytics-learning&limit=100");
  });
});
