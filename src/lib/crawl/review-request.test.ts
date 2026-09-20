import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AgentRun, AgentRunStatus } from "../../types/agent-run.ts";
import type { Crawl } from "../../types/crawl.ts";
import {
  REVIEW_AGENT_ID,
  REVIEW_TASK_TYPE,
  RUN_STATUS,
  hasResult,
  outputProvenance,
  queueRefusal,
  queuedNote,
  reviewRequest,
} from "./review-request.ts";

/**
 * The failure this file exists to prevent is a queued run reading as a
 * finished analysis, and a simulated placeholder reading as real work. Most
 * of what is asserted below is wording, because wording is where that
 * particular lie gets told.
 */

const CRAWL: Crawl = {
  id: "8f1c0d2e-0000-4000-8000-000000000001",
  projectId: "nexra-agency",
  startUrl: "https://nexraagency.com/",
  hostScope: "nexraagency.com",
  status: "partial",
  stopReason: "page-budget",
  budget: { maxPages: 5, maxDepth: 1, maxDurationMs: 60_000 },
  userAgent: "NexraBot/0.1",
  robotsState: "fetched",
  sitemapState: "unavailable",
  pagesDiscovered: 7,
  pagesFetched: 5,
  pagesFailed: 0,
  error: null,
  createdBy: "00000000-0000-4000-8000-00000000000a",
  startedAt: "2026-09-20T10:00:00.000Z",
  finishedAt: "2026-09-20T10:00:04.500Z",
};

const RUN: AgentRun = {
  id: "11111111-0000-4000-8000-000000000001",
  projectId: "nexra-agency",
  agentId: "technical-seo",
  taskType: "crawl-review",
  input: { crawlId: CRAWL.id },
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
  createdAt: "2026-09-20T11:00:00.000Z",
  updatedAt: "2026-09-20T11:00:00.000Z",
  startedAt: null,
  finishedAt: null,
  nextAttemptAt: null,
  autoRetryCount: 0,
};

describe("the request payload", () => {
  test("names the project, the crawl, the agent and the task", () => {
    const result = reviewRequest("nexra-agency", CRAWL);
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.payload, {
      projectId: "nexra-agency",
      agentId: "technical-seo",
      taskType: "crawl-review",
      input: { crawlId: CRAWL.id },
    });
  });

  test("the agent and task are the ones the server allows", () => {
    assert.equal(REVIEW_AGENT_ID, "technical-seo");
    assert.equal(REVIEW_TASK_TYPE, "crawl-review");
  });

  test("the crawl id comes from the crawl, never from anywhere else", () => {
    const other: Crawl = { ...CRAWL, id: "22222222-0000-4000-8000-000000000002" };
    const result = reviewRequest("nexra-agency", other);
    assert.equal(result.ok && result.payload.input.crawlId, other.id);
  });

  test("a completed crawl is reviewable, as is one that stopped on its budget", () => {
    for (const status of ["completed", "partial"] as const) {
      assert.equal(reviewRequest("nexra-agency", { ...CRAWL, status }).ok, true);
    }
  });
});

describe("when queueing is refused before any request is made", () => {
  test("there is no crawl at all", () => {
    const result = reviewRequest("nexra-agency", null);
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.why : "", /Run a crawl first/);
  });

  test("the crawl is still running", () => {
    const running: Crawl = { ...CRAWL, status: "running", stopReason: null, finishedAt: null };
    const result = reviewRequest("nexra-agency", running);
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.why : "", /still running/);
  });

  test("the crawl failed or was cancelled, so it recorded nothing worth reading", () => {
    for (const status of ["failed", "cancelled"] as const) {
      const result = reviewRequest("nexra-agency", { ...CRAWL, status });
      assert.equal(result.ok, false);
    }
  });

  test("the project id is missing", () => {
    assert.equal(reviewRequest("", CRAWL).ok, false);
  });
});

describe("queued is not a result", () => {
  test("a queued run is neutral and says nothing has been analysed", () => {
    assert.equal(RUN_STATUS.queued.tone, "neutral");
    assert.match(RUN_STATUS.queued.title, /Nothing has been analysed yet/);
    assert.doesNotMatch(RUN_STATUS.queued.label, /succe|complete|done|finish/i);
  });

  test("a running run is not reported as a result either", () => {
    assert.match(RUN_STATUS.running.title, /no result yet/i);
  });

  test("only a completed run reads as a success", () => {
    const positive = (Object.keys(RUN_STATUS) as AgentRunStatus[]).filter(
      (status) => RUN_STATUS[status].tone === "positive",
    );
    assert.deepEqual(positive, ["completed"]);
    assert.equal(RUN_STATUS.completed.label, "Succeeded");
  });

  test("a queued or running run has nothing to read", () => {
    assert.equal(hasResult(RUN), false);
    assert.equal(hasResult({ ...RUN, status: "running" }), false);
    // Completed with no stored summary is still nothing to read.
    assert.equal(hasResult({ ...RUN, status: "completed" }), false);
    assert.equal(hasResult({ ...RUN, status: "completed", resultSummary: "text" }), true);
  });

  test("the queued note says the work has not started", () => {
    assert.match(queuedNote({ run: RUN, duplicate: false }), /nothing has been analysed yet/i);
  });

  test("asking twice says so instead of implying a second run", () => {
    const note = queuedNote({ run: RUN, duplicate: true });
    assert.match(note, /already queued/i);
    assert.match(note, /rather than starting a second one/i);
  });
});

describe("what produced the output", () => {
  const completed = (metadata: AgentRun["resultMetadata"]): AgentRun => ({
    ...RUN,
    status: "completed",
    resultSummary: "output",
    resultMetadata: metadata,
  });

  test("simulated output is labelled simulated, on the result itself", () => {
    const provenance = outputProvenance(completed({ simulated: true, grounded: false }));
    assert.match(provenance?.text ?? "", /Simulated/);
    assert.match(provenance?.text ?? "", /placeholder output, not analysis/i);
    assert.equal(provenance?.tone, "warning");
  });

  test("a grounded model answer says it is grounded, and still advice", () => {
    const provenance = outputProvenance(completed({ simulated: false, grounded: true }));
    assert.match(provenance?.text ?? "", /grounded in this crawl's recorded pages/i);
    assert.match(provenance?.text ?? "", /Advice, not measurement/);
    assert.doesNotMatch(provenance?.text ?? "", /simulated/i);
  });

  test("an ungrounded model answer is not allowed to look grounded", () => {
    const provenance = outputProvenance(completed({ simulated: false, grounded: false }));
    assert.match(provenance?.text ?? "", /not grounded in any crawl data/i);
    assert.equal(provenance?.tone, "warning");
  });

  test("a run with no metadata claims nothing about its provenance", () => {
    assert.equal(outputProvenance(RUN), null);
  });
});

describe("refusals from the server", () => {
  test("an approval-required task repeats the server's own explanation", () => {
    const message = queueRefusal(422, {
      error: "approval-required",
      message: "This task needs a person to approve each action.",
    });
    assert.equal(message, "This task needs a person to approve each action.");
  });

  test("a task the agent may not run is reported as a rule, not a glitch", () => {
    const message = queueRefusal(422, { error: "task-not-allowed" });
    assert.match(message, /server rule, not a temporary problem/i);
  });

  test("an expired session says to sign in again", () => {
    assert.match(queueRefusal(401, { error: "unauthorized" }), /session has ended/i);
  });

  test("a rate limit says to wait rather than inviting another click", () => {
    assert.match(queueRefusal(429, null), /Wait a moment/i);
  });

  test("an unavailable store says nothing can be queued", () => {
    assert.match(queueRefusal(503, { error: "unavailable" }), /nothing can be queued/i);
  });

  test("an unreadable body still yields a usable message", () => {
    for (const body of [null, undefined, 7, [], {}, "text"]) {
      assert.ok(queueRefusal(500, body).length > 0);
    }
  });

  test("no refusal is phrased as a completed analysis", () => {
    for (const body of [{ error: "task-not-allowed" }, { error: "unavailable" }, null]) {
      assert.doesNotMatch(queueRefusal(422, body), /succe|analysed|complete/i);
    }
  });
});
