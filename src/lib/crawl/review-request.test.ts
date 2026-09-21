import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import type { AgentRun, AgentRunStatus } from "../../types/agent-run.ts";
import type { Crawl } from "../../types/crawl.ts";
import type { SearchConsoleReport } from "../../types/search-console.ts";
import {
  CRAWL_REVIEWS,
  PRIORITY_REVIEW,
  REVIEW_AGENT_ID,
  REVIEW_TASK_TYPE,
  SEARCH_QUERY_REVIEW,
  searchQueryReviewRequest,
  RUN_STATUS,
  evidenceDescription,
  executability,
  executeOutcome,
  handoffRequest,
  hasResult,
  offersHandoff,
  outputProvenance,
  queueRefusal,
  queuedNote,
  reconciledNote,
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
    assert.deepEqual(result.ok && result.payload.input, { crawlId: other.id });
  });

  test("a completed crawl is reviewable, as is one that stopped on its budget", () => {
    for (const status of ["completed", "partial"] as const) {
      assert.equal(reviewRequest("nexra-agency", { ...CRAWL, status }).ok, true);
    }
  });
});

describe("the on-page review request", () => {
  const onPage = CRAWL_REVIEWS["on-page-review"];

  test("names the On-Page SEO agent and the on-page task, over the same crawl", () => {
    const result = reviewRequest("nexra-agency", CRAWL, onPage);
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.payload, {
      projectId: "nexra-agency",
      agentId: "on-page-seo",
      taskType: "on-page-review",
      input: { crawlId: CRAWL.id },
    });
  });

  test("without a review named, the request is still the Technical SEO crawl review", () => {
    const result = reviewRequest("nexra-agency", CRAWL);
    assert.equal(result.ok && result.payload.agentId, REVIEW_AGENT_ID);
    assert.equal(result.ok && result.payload.taskType, REVIEW_TASK_TYPE);
  });

  test("the two reviews name different agents and tasks, and the same input shape", () => {
    const technical = CRAWL_REVIEWS["crawl-review"];
    assert.notEqual(onPage.agentId, technical.agentId);
    assert.notEqual(onPage.taskType, technical.taskType);
    assert.equal(onPage.taskType, "on-page-review");
    assert.equal(onPage.agentId, "on-page-seo");
    for (const spec of [technical, onPage]) {
      assert.ok(spec.action.startsWith("Analyze with "), spec.action);
      assert.match(spec.summary, /^Queues a read-only review/);
    }
  });

  test("it is refused for the same crawls the crawl review is refused for", () => {
    assert.equal(reviewRequest("nexra-agency", null, onPage).ok, false);
    assert.equal(reviewRequest("nexra-agency", { ...CRAWL, status: "running", finishedAt: null }, onPage).ok, false);
    assert.equal(reviewRequest("nexra-agency", { ...CRAWL, status: "failed" }, onPage).ok, false);
    assert.equal(reviewRequest("", CRAWL, onPage).ok, false);
  });

  test("the on-page control promises no edits", () => {
    assert.match(onPage.summary, /edits and publishes nothing/);
  });

  test("a server refusal names the agent and task that were asked for", () => {
    assert.match(queueRefusal(422, { error: "task-not-allowed" }, onPage), /The On-Page SEO agent is not allowed/);
    assert.match(queueRefusal(422, { error: "unknown-task-type" }, onPage), /does not know the on-page-review task/);
    // And the default still names the Technical SEO crawl review.
    assert.match(queueRefusal(422, { error: "task-not-allowed" }), /The Technical SEO agent is not allowed/);
    assert.match(queueRefusal(422, { error: "unknown-task-type" }), /does not know the crawl-review task/);
  });
});

describe("the search query review request", () => {
  const REPORT: Extract<SearchConsoleReport, { state: "connected" }> = {
    projectId: "nexra-agency",
    source: "search-console",
    state: "connected",
    property: "sc-domain:nexraagency.com",
    window: { rangeId: "30d", startDate: "2026-08-19", endDate: "2026-09-17", days: 30 },
    previousWindow: null,
    totals: { clicks: 10, impressions: 100, ctr: 0.1, position: 5 },
    previousTotals: null,
    queries: [{ key: "nexra agency", clicks: 10, impressions: 100, ctr: 0.1, position: 5 }],
    pages: [],
    partial: ["comparison-beyond-retention"],
    fetchedAt: "2026-09-20T12:00:00.000Z",
    stale: false,
  };

  test("names the Keyword & Search Intent agent, the search-query task, and the window — nothing else", () => {
    const result = searchQueryReviewRequest("nexra-agency", REPORT, "30d");
    assert.deepEqual(result, {
      ok: true,
      payload: {
        projectId: "nexra-agency",
        agentId: "keyword-intent",
        taskType: "search-query-review",
        input: { range: "30d" },
      },
    });
  });

  test("the spec matches what the server allows, and promises no changes", () => {
    assert.equal(SEARCH_QUERY_REVIEW.agentId, "keyword-intent");
    assert.equal(SEARCH_QUERY_REVIEW.taskType, "search-query-review");
    assert.ok(SEARCH_QUERY_REVIEW.action.startsWith("Analyze with "));
    assert.match(SEARCH_QUERY_REVIEW.summary, /^Queues a read-only review/);
    assert.match(SEARCH_QUERY_REVIEW.summary, /changes nothing/);
  });

  test("is refused, with a reason, for everything the server would refuse", () => {
    const base = { projectId: "nexra-agency", source: "search-console" } as const;
    const refusals: [string | null, SearchConsoleReport | null, RegExp][] = [
      [null, REPORT, /Choose a single project/],
      ["nexra-agency", null, /has not loaded yet/],
      ["nexra-agency", { ...base, state: "not-connected", reason: "no-property" }, /not connected/],
      ["nexra-agency", { ...base, state: "unavailable", reason: "timeout" }, /not connected/],
      ["nexra-agency", { ...REPORT, queries: [], partial: ["queries-unavailable"] }, /did not return the top queries/],
      ["nexra-agency", { ...REPORT, queries: [] }, /reported no queries/],
    ];
    for (const [projectId, report, why] of refusals) {
      const result = searchQueryReviewRequest(projectId, report, "30d");
      assert.equal(result.ok, false);
      assert.match(result.ok ? "" : result.why, why);
    }
  });

  test("a server refusal names this agent and task", () => {
    assert.match(queueRefusal(422, { error: "task-not-allowed" }, SEARCH_QUERY_REVIEW), /The Keyword & Search Intent agent is not allowed/);
    assert.match(queueRefusal(422, { error: "unknown-task-type" }, SEARCH_QUERY_REVIEW), /does not know the search-query-review task/);
  });

  test("a grounded result says what it was grounded in", () => {
    const grounded: AgentRun = {
      ...RUN,
      status: "completed",
      resultSummary: "x",
      resultMetadata: { simulated: false, grounded: true },
    };
    assert.match(outputProvenance(grounded, SEARCH_QUERY_REVIEW.groundedIn)?.text ?? "", /grounded in this project's Search Console report/);
    assert.match(outputProvenance(grounded)?.text ?? "", /grounded in this crawl's recorded pages/);
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
    assert.match(provenance?.text ?? "", /not grounded in any recorded evidence/i);
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

describe("Run Now availability", () => {
  test("there is nothing to run before a run exists", () => {
    const verdict = executability(null);
    assert.equal(verdict.ok, false);
    assert.match(verdict.why ?? "", /Queue a review first/);
  });

  test("only a queued run can be started", () => {
    assert.equal(executability(RUN).ok, true);
    for (const status of ["running", "completed", "failed", "cancelled"] as const) {
      const verdict = executability({ ...RUN, status });
      assert.equal(verdict.ok, false);
      assert.ok((verdict.why ?? "").length > 0);
    }
  });

  test("an in-progress attempt is reported as in progress, not as an error", () => {
    assert.match(executability({ ...RUN, status: "running" }).why ?? "", /already in progress/i);
  });

  test("no unavailability reason reads as a completed analysis", () => {
    for (const status of ["running", "failed", "cancelled"] as const) {
      assert.doesNotMatch(executability({ ...RUN, status }).why ?? "", /analys|succe/i);
    }
  });
});

describe("what the execute request came back as", () => {
  test("a 2xx is accepted — which is not the same as analysed", () => {
    assert.deepEqual(executeOutcome(200, { run: RUN }), { kind: "accepted" });
    assert.deepEqual(executeOutcome(201, null), { kind: "accepted" });
  });

  test("a 409 is a conflict, never a refusal", () => {
    assert.deepEqual(executeOutcome(409, { error: "conflict", status: "running" }), {
      kind: "conflict",
    });
  });

  test("other statuses are refusals with their own wording", () => {
    assert.equal(executeOutcome(404, { error: "not-found" }).kind, "refused");

    const expired = executeOutcome(401, null);
    assert.match(expired.kind === "refused" ? expired.message : "", /session has ended/i);

    const limited = executeOutcome(429, null);
    assert.match(limited.kind === "refused" ? limited.message : "", /Wait a moment/i);

    assert.equal(executeOutcome(503, { error: "unavailable" }).kind, "refused");
  });

  test("no outcome message claims the analysis succeeded", () => {
    for (const status of [401, 403, 404, 429, 500, 503]) {
      const outcome = executeOutcome(status, null);
      if (outcome.kind !== "refused") continue;
      assert.doesNotMatch(outcome.message, /succe|analys|complete/i);
    }
  });
});

describe("reconciling against the run that was read back", () => {
  test("an accepted attempt says nothing extra — the badge carries the state", () => {
    assert.equal(reconciledNote({ kind: "accepted" }, { ...RUN, status: "completed" }), null);
  });

  test("a conflict whose run is running or completed is not reported as a failure", () => {
    for (const status of ["running", "completed"] as const) {
      const note = reconciledNote({ kind: "conflict" }, { ...RUN, status });
      assert.equal(note?.tone, "neutral");
      assert.equal(note?.text, "Already started elsewhere. Refreshing its current status.");
      assert.doesNotMatch(note?.text ?? "", /fail|error/i);
    }
  });

  test("a conflict that could not be read back says the status is unknown", () => {
    const note = reconciledNote({ kind: "conflict" }, null);
    assert.equal(note?.tone, "warning");
    assert.match(note?.text ?? "", /could not be read/i);
  });

  test("an accepted attempt that could not be read back does not claim a result", () => {
    const note = reconciledNote({ kind: "accepted" }, null);
    assert.match(note?.text ?? "", /could not be read back/i);
    assert.doesNotMatch(note?.text ?? "", /succe|analys/i);
  });

  test("a refusal carries its message at a non-positive tone", () => {
    const note = reconciledNote({ kind: "refused", message: "nope" }, null);
    assert.equal(note?.text, "nope");
    assert.equal(note?.tone, "warning");
  });
});

describe("no secret reaches the browser", () => {
  test("nothing in this module names a worker credential", async () => {
    const source = await readFile(new URL("./review-request.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /CRON_SECRET|SERVICE_ROLE|ANTHROPIC_API_KEY|Bearer/);
    // The deployment-wide worker endpoint is deliberately not used here: it
    // claims the oldest queued run anywhere, not the one on screen.
    assert.doesNotMatch(source, /run-next|agent-runs\/worker/);
  });
});

describe("the SEO Director hand-off request", () => {
  /** A completed, grounded, model-executed crawl review: the one thing the Director may read. */
  const COMPLETED: AgentRun = {
    ...RUN,
    status: "completed",
    executor: "ai",
    attemptCount: 1,
    resultSummary: "OBSERVED: /services declares no meta description.",
    resultMetadata: {
      simulated: false,
      grounded: true,
      evidence: { crawlId: CRAWL.id, hostScope: "nexraagency.com", pagesFetched: 5, pagesIncluded: 5, pagesNotReached: 2 },
      taskType: "crawl-review",
      attempt: 1,
      provider: "anthropic",
      model: "claude-opus-5",
    },
    startedAt: "2026-09-20T11:04:00.000Z",
    finishedAt: "2026-09-20T11:05:00.000Z",
  };

  test("names the SEO Director, the priority task, and the source run — nothing else", () => {
    const result = handoffRequest("nexra-agency", COMPLETED);
    assert.deepEqual(result, {
      ok: true,
      payload: {
        projectId: "nexra-agency",
        agentId: "seo-director",
        taskType: "priority-review",
        input: { sourceRunId: COMPLETED.id },
      },
    });
  });

  test("the spec matches what the server allows, and promises no assignment and no change", () => {
    assert.equal(PRIORITY_REVIEW.agentId, "seo-director");
    assert.equal(PRIORITY_REVIEW.taskType, "priority-review");
    assert.equal(PRIORITY_REVIEW.action, "Hand off to SEO Director");
    assert.match(PRIORITY_REVIEW.summary, /^Queues a read-only priority review/);
    assert.match(PRIORITY_REVIEW.summary, /not the crawl or report behind it/);
    assert.match(PRIORITY_REVIEW.summary, /assigns nothing and changes nothing/);
  });

  test("is accepted for every hand-off task type, on the same project", () => {
    for (const taskType of ["crawl-review", "on-page-review", "search-query-review"] as const) {
      assert.equal(handoffRequest("nexra-agency", { ...COMPLETED, taskType }).ok, true, taskType);
    }
  });

  test("is refused, with the runtime's own reason in the operator's words, for everything the server would refuse", () => {
    const refusals: [string | null, AgentRun | null, RegExp][] = [
      [null, COMPLETED, /No project is selected/],
      ["nexra-agency", null, /Complete a review first/],
      ["other-client", COMPLETED, /belongs to a different project/],
      ["nexra-agency", { ...COMPLETED, taskType: "project-review" }, /crawl reviews, on-page reviews and search query reviews only/],
      ["nexra-agency", { ...COMPLETED, taskType: "priority-review" }, /crawl reviews, on-page reviews and search query reviews only/],
      ["nexra-agency", { ...COMPLETED, status: "queued", resultSummary: null }, /has not finished/],
      ["nexra-agency", { ...COMPLETED, status: "running", resultSummary: null }, /has not finished/],
      ["nexra-agency", { ...COMPLETED, status: "failed", resultSummary: null }, /did not complete/],
      ["nexra-agency", { ...COMPLETED, status: "cancelled", resultSummary: null }, /did not complete/],
      ["nexra-agency", { ...COMPLETED, resultSummary: null }, /stored no result/],
      ["nexra-agency", { ...COMPLETED, executor: "mock", resultMetadata: { simulated: true, grounded: false } }, /Simulated output cannot be handed off/],
      ["nexra-agency", { ...COMPLETED, resultMetadata: { simulated: false, grounded: false } }, /not grounded in recorded evidence/],
      ["nexra-agency", { ...COMPLETED, resultMetadata: null }, /not grounded in recorded evidence/],
    ];
    for (const [projectId, source, why] of refusals) {
      const result = handoffRequest(projectId, source);
      assert.equal(result.ok, false, why.source);
      assert.match(result.ok ? "" : result.why, why);
    }
  });

  test("no refusal is phrased as a fault, and none quotes the review", () => {
    for (const source of [
      { ...COMPLETED, executor: "mock" as const },
      { ...COMPLETED, resultMetadata: { simulated: false, grounded: false } },
      { ...COMPLETED, taskType: "keyword-research" as const },
    ]) {
      const result = handoffRequest("nexra-agency", source);
      assert.equal(result.ok, false);
      const why = result.ok ? "" : result.why;
      assert.doesNotMatch(why, /error|failed to|try again/i);
      assert.doesNotMatch(why, /meta description/);
    }
  });

  test("the control is offered under a completed specialist review only", () => {
    assert.equal(offersHandoff(COMPLETED), true);
    assert.equal(offersHandoff({ ...COMPLETED, taskType: "search-query-review" }), true);
    // Offered — and then refused with a reason — for a simulated one, so the
    // operator is told why rather than shown nothing.
    assert.equal(offersHandoff({ ...COMPLETED, executor: "mock" }), true);
    assert.equal(offersHandoff({ ...COMPLETED, status: "queued" }), false);
    assert.equal(offersHandoff({ ...COMPLETED, status: "failed" }), false);
    assert.equal(offersHandoff({ ...COMPLETED, taskType: "priority-review", agentId: "seo-director" }), false);
    assert.equal(offersHandoff({ ...COMPLETED, taskType: "project-review" }), false);
  });

  test("a server refusal names the Director and the task", () => {
    assert.match(queueRefusal(422, { error: "task-not-allowed" }, PRIORITY_REVIEW), /The SEO Director agent is not allowed/);
    assert.match(queueRefusal(422, { error: "unknown-task-type" }, PRIORITY_REVIEW), /does not know the priority-review task/);
  });
});

describe("provenance keeps the three layers apart", () => {
  const completed = (metadata: AgentRun["resultMetadata"]): AgentRun => ({
    ...RUN,
    status: "completed",
    executor: "ai",
    resultSummary: "output",
    resultMetadata: metadata,
  });

  test("a Director result names the upstream agent and run, what that agent read, and calls both layers advice", () => {
    const director = completed({
      simulated: false,
      grounded: true,
      evidence: {
        source: "agent-run",
        runId: "11111111-0000-4000-8000-000000000001",
        agentId: "technical-seo",
        taskType: "crawl-review",
        upstreamEvidence: { crawlId: CRAWL.id, hostScope: "nexraagency.com", pagesFetched: 5, pagesIncluded: 5, pagesNotReached: 2 },
      },
    });
    const provenance = outputProvenance(director, PRIORITY_REVIEW.groundedIn);
    assert.match(provenance?.text ?? "", /^Model output by the SEO Director, prioritising the Technical SEO agent's completed review \(run 11111111-0000-4000-8000-000000000001\)/);
    assert.match(provenance?.text ?? "", /That review was itself model-generated over a crawl this product recorded/);
    assert.match(provenance?.text ?? "", /which the Director did not see/);
    assert.match(provenance?.text ?? "", /Two layers of advice, not measurement\.$/);
    assert.doesNotMatch(provenance?.text ?? "", /simulated/i);
    // The generic wording the caller passed is not what is shown: the evidence decides.
    assert.doesNotMatch(provenance?.text ?? "", /one upstream agent's completed review/);
  });

  test("a Director result over a Search Console review says so", () => {
    const director = completed({
      simulated: false,
      grounded: true,
      evidence: {
        source: "agent-run",
        runId: "11111111-0000-4000-8000-000000000002",
        agentId: "keyword-intent",
        taskType: "search-query-review",
        upstreamEvidence: { source: "search-console", property: "sc-domain:nexraagency.com", startDate: "2026-08-19", endDate: "2026-09-17", queriesIncluded: 25 },
      },
    });
    const provenance = outputProvenance(director);
    assert.match(provenance?.text ?? "", /prioritising the Keyword & Search Intent agent's completed review/);
    assert.match(provenance?.text ?? "", /a Google Search Console report this product read for property "sc-domain:nexraagency.com"/);
  });

  test("a simulated Director result is still labelled simulated, before anything else", () => {
    const provenance = outputProvenance(completed({ simulated: true, grounded: false, sourceRunId: "x" }), PRIORITY_REVIEW.groundedIn);
    assert.match(provenance?.text ?? "", /^Simulated/);
    assert.equal(provenance?.tone, "warning");
  });

  test("without an explicit description, a grounded run is described by the evidence it recorded", () => {
    const crawl = completed({ simulated: false, grounded: true, evidence: { crawlId: CRAWL.id, hostScope: "nexraagency.com" } });
    assert.match(outputProvenance(crawl)?.text ?? "", /grounded in this product's recorded crawl\. Advice, not measurement\./);

    const search = completed({
      simulated: false,
      grounded: true,
      evidence: { source: "search-console", property: "sc-domain:nexraagency.com", startDate: "2026-08-19", endDate: "2026-09-17" },
    });
    assert.match(outputProvenance(search)?.text ?? "", /grounded in this project's Search Console report for sc-domain:nexraagency.com, 2026-08-19 to 2026-09-17\./);
    assert.equal(evidenceDescription({ evidence: { source: "search-console" } }), "this project's Search Console report");
    assert.equal(evidenceDescription({ evidence: { source: "agent-run" } }), null);
    assert.equal(evidenceDescription({}), null);
    // And no run with recorded evidence is ever described as having none.
    assert.doesNotMatch(outputProvenance(search)?.text ?? "", /without live site data|not grounded/);
  });
});
