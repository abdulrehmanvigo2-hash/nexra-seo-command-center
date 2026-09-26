import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AgentRun } from "../../types/agent-run.ts";
import { createTaskFailure, directorTaskProposal, keywordTaskProposal, offersDirectorTask, proposeDirectorTaskTitle } from "./proposals.ts";

const RUN: AgentRun = {
  id: "d0000000-0000-4000-8000-000000000001",
  projectId: "nexra-agency",
  agentId: "seo-director",
  taskType: "project-priority-review",
  input: {},
  status: "completed",
  source: "operator",
  executor: "ai",
  attemptCount: 1,
  maxAttempts: 3,
  resultSummary: "PRIORITY 1 … BASIS OBSERVED …\nBLOCKERS: none.\nFirst action: write the missing /services meta description, because it rests on a recorded finding.",
  resultMetadata: { simulated: false, grounded: true },
  error: null,
  createdBy: "00000000-0000-4000-8000-0000000000aa",
  cancelledBy: null,
  createdAt: "2026-09-26T03:00:00.000Z",
  updatedAt: "2026-09-26T03:05:00.000Z",
  startedAt: "2026-09-26T03:04:00.000Z",
  finishedAt: "2026-09-26T03:05:00.000Z",
  nextAttemptAt: null,
  autoRetryCount: 0,
};

describe("the Director task control", () => {
  test("is offered under a completed SEO Director review with a result, and under nothing else", () => {
    assert.equal(offersDirectorTask(RUN), true);
    assert.equal(offersDirectorTask({ ...RUN, taskType: "priority-review" }), true);
    assert.equal(offersDirectorTask({ ...RUN, status: "queued", resultSummary: null }), false);
    assert.equal(offersDirectorTask({ ...RUN, status: "failed" }), false);
    assert.equal(offersDirectorTask({ ...RUN, resultSummary: "   " }), false);
    assert.equal(offersDirectorTask({ ...RUN, agentId: "technical-seo", taskType: "crawl-review" }), false);
    assert.equal(offersDirectorTask({ ...RUN, agentId: "project-manager", taskType: "intake-review" }), false);
  });

  test("proposes the review's closing first-action line as the title, cut to the limit, and falls back to naming the run", () => {
    assert.equal(proposeDirectorTaskTitle(RUN), "write the missing /services meta description, because it rests on a recorded finding.");
    assert.equal(proposeDirectorTaskTitle({ ...RUN, resultSummary: "- item\n1) FIRST ACTION: Fix the H1 on /services" }), "Fix the H1 on /services");
    const long = proposeDirectorTaskTitle({ ...RUN, resultSummary: `First action: ${"word ".repeat(80)}` });
    assert.ok(Array.from(long).length <= 200 && long.endsWith("…"));
    assert.equal(proposeDirectorTaskTitle({ ...RUN, resultSummary: "ok" }), "Follow up on the SEO Director review d0000000");
    assert.equal(proposeDirectorTaskTitle({ ...RUN, resultSummary: null }), "Follow up on the SEO Director review d0000000");
  });

  test("the proposal names the run as the source and prefills the Project Manager; the operator decides the rest", () => {
    assert.deepEqual(directorTaskProposal(RUN), {
      sourceKind: "director-run",
      sourceRef: RUN.id,
      title: proposeDirectorTaskTitle(RUN),
      owningAgent: "project-manager",
      sourceLabel: "SEO Director run d0000000…",
    });
  });
});

describe("the keyword task proposal", () => {
  test("names the exact query as the source, untouched, and prefills the Keyword & Search Intent agent", () => {
    assert.deepEqual(keywordTaskProposal("ai lead follow up"), {
      sourceKind: "keyword",
      sourceRef: "ai lead follow up",
      title: 'Review the observed query "ai lead follow up"',
      owningAgent: "keyword-intent",
      sourceLabel: 'observed query "ai lead follow up"',
    });
    assert.equal(keywordTaskProposal("  Mixed Case  ").sourceRef, "  Mixed Case  ");
  });
});

describe("the failure wording", () => {
  test("names each refusal in the operator's terms and never claims a task or a run", () => {
    for (const [error, fragment] of [
      ["unavailable", /not kept on this deployment/],
      ["project-not-found", /not stored/],
      ["run-not-found", /not this project's, or no longer exists/],
      ["run-not-completed", /has not completed/],
      ["run-not-director", /not an SEO Director review/],
      ["keyword-not-found", /not one this product stored for this project/],
      ["invalid", /1 to 200 characters/],
      ["rate-limited", /Too many tasks/],
      ["unauthorized", /Sign in as an operator/],
    ] as const) {
      const text = createTaskFailure(400, { error });
      assert.match(text, fragment, error);
      assert.doesNotMatch(text, /queued|executed|assigned/);
    }
    assert.match(createTaskFailure(0, null), /did not complete/);
    assert.equal(createTaskFailure(500, {}), "The task was not recorded.");
  });
});
