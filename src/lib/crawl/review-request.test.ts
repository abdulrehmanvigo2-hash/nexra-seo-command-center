import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import type { AgentRun, AgentRunStatus } from "../../types/agent-run.ts";
import type { Crawl } from "../../types/crawl.ts";
import type { SearchConsoleReport } from "../../types/search-console.ts";
import {
  CRAWL_REVIEWS,
  PERFORMANCE_REVIEW,
  PRIORITY_REVIEW,
  REVIEW_AGENT_ID,
  REVIEW_TASK_TYPE,
  SEARCH_QUERY_REVIEW,
  searchQueryReviewRequest,
  RUN_STATUS,
  SEARCH_CONSOLE_REVIEWS,
  evidenceDescription,
  executability,
  executeOutcome,
  handoffRequest,
  hasResult,
  latestReviewRun,
  restoreReviewRun,
  reviewRunsUrl,
  RESTORE_LIST_LIMIT,
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
      ["nexra-agency", { ...COMPLETED, taskType: "project-review" }, /crawl reviews, on-page reviews, answer-readiness reviews, search query reviews and performance reviews only/],
      ["nexra-agency", { ...COMPLETED, taskType: "priority-review" }, /crawl reviews, on-page reviews, answer-readiness reviews, search query reviews and performance reviews only/],
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

describe("the performance review request", () => {
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

  test("names the Analytics & Learning agent, the performance task, and the window — nothing else", () => {
    const result = searchQueryReviewRequest("nexra-agency", REPORT, "30d", PERFORMANCE_REVIEW);
    assert.deepEqual(result, {
      ok: true,
      payload: {
        projectId: "nexra-agency",
        agentId: "analytics-learning",
        taskType: "performance-review",
        input: { range: "30d" },
      },
    });
  });

  test("without a review named, the request is still the Keyword agent's search query review", () => {
    const result = searchQueryReviewRequest("nexra-agency", REPORT, "30d");
    assert.equal(result.ok && result.payload.agentId, "keyword-intent");
    assert.equal(result.ok && result.payload.taskType, "search-query-review");
  });

  test("the two Search Console reviews name different agents and tasks, and the same input shape", () => {
    assert.equal(SEARCH_CONSOLE_REVIEWS["search-query-review"], SEARCH_QUERY_REVIEW);
    assert.equal(SEARCH_CONSOLE_REVIEWS["performance-review"], PERFORMANCE_REVIEW);
    assert.notEqual(PERFORMANCE_REVIEW.agentId, SEARCH_QUERY_REVIEW.agentId);
    assert.notEqual(PERFORMANCE_REVIEW.taskType, SEARCH_QUERY_REVIEW.taskType);
    const a = searchQueryReviewRequest("nexra-agency", REPORT, "7d", PERFORMANCE_REVIEW);
    const b = searchQueryReviewRequest("nexra-agency", REPORT, "7d", SEARCH_QUERY_REVIEW);
    assert.deepEqual(a.ok && a.payload.input, b.ok && b.payload.input);
  });

  test("the spec matches what the server allows, and promises a measurement and no changes", () => {
    assert.equal(PERFORMANCE_REVIEW.agentId, "analytics-learning");
    assert.equal(PERFORMANCE_REVIEW.taskType, "performance-review");
    assert.ok(PERFORMANCE_REVIEW.action.startsWith("Analyze with "));
    assert.match(PERFORMANCE_REVIEW.summary, /^Queues a read-only performance review/);
    assert.match(PERFORMANCE_REVIEW.summary, /as a measurement/);
    assert.match(PERFORMANCE_REVIEW.summary, /changes nothing/);
    assert.equal(PERFORMANCE_REVIEW.groundedIn, SEARCH_QUERY_REVIEW.groundedIn);
  });

  test("is refused, with a reason, for everything the server would refuse", () => {
    const base = { projectId: "nexra-agency", source: "search-console" } as const;
    const refusals: [string | null, SearchConsoleReport | null, RegExp][] = [
      [null, REPORT, /Choose a single project/],
      ["nexra-agency", null, /has not loaded yet/],
      ["nexra-agency", { ...base, state: "not-connected", reason: "no-property" }, /not connected/],
      ["nexra-agency", { ...REPORT, queries: [], partial: ["queries-unavailable"] }, /did not return the top queries/],
      ["nexra-agency", { ...REPORT, queries: [] }, /reported no queries/],
    ];
    for (const [projectId, report, why] of refusals) {
      const result = searchQueryReviewRequest(projectId, report, "30d", PERFORMANCE_REVIEW);
      assert.equal(result.ok, false);
      assert.match(result.ok ? "" : result.why, why);
    }
  });

  test("a server refusal names this agent and task", () => {
    assert.match(queueRefusal(422, { error: "task-not-allowed" }, PERFORMANCE_REVIEW), /The Analytics & Learning agent is not allowed/);
    assert.match(queueRefusal(422, { error: "unknown-task-type" }, PERFORMANCE_REVIEW), /does not know the performance-review task/);
  });

  test("a completed grounded performance review can be handed to the Director, and is refused for the same reasons as any other", () => {
    const completed: AgentRun = {
      ...RUN,
      agentId: "analytics-learning",
      taskType: "performance-review",
      input: { range: "30d" },
      status: "completed",
      executor: "ai",
      resultSummary: "OBSERVED: clicks 10.",
      resultMetadata: {
        simulated: false,
        grounded: true,
        evidence: { source: "search-console", property: "sc-domain:nexraagency.com", startDate: "2026-08-19", endDate: "2026-09-17", queriesIncluded: 1 },
      },
      finishedAt: "2026-09-20T11:05:00.000Z",
    };
    assert.equal(offersHandoff(completed), true);
    const accepted = handoffRequest("nexra-agency", completed);
    assert.deepEqual(accepted, {
      ok: true,
      payload: { projectId: "nexra-agency", agentId: "seo-director", taskType: "priority-review", input: { sourceRunId: completed.id } },
    });

    const refusals: [AgentRun, RegExp][] = [
      [{ ...completed, projectId: "other-client" }, /belongs to a different project/],
      [{ ...completed, status: "queued", resultSummary: null }, /has not finished/],
      [{ ...completed, status: "failed", resultSummary: null }, /did not complete/],
      [{ ...completed, executor: "mock", resultMetadata: { simulated: true, grounded: false } }, /Simulated output cannot be handed off/],
      [{ ...completed, resultMetadata: { simulated: false, grounded: false } }, /not grounded in recorded evidence/],
    ];
    for (const [source, why] of refusals) {
      const result = handoffRequest("nexra-agency", source);
      assert.equal(result.ok, false, why.source);
      assert.match(result.ok ? "" : result.why, why);
    }
    // The wording that lists the allowed sources now names this one.
    const disallowed = handoffRequest("nexra-agency", { ...completed, taskType: "project-review" });
    assert.match(disallowed.ok ? "" : disallowed.why, /search query reviews and performance reviews only/);
  });

  test("provenance for a performance review names the report, and a Director run over it names the agent", () => {
    const performance: AgentRun = {
      ...RUN,
      agentId: "analytics-learning",
      taskType: "performance-review",
      status: "completed",
      executor: "ai",
      resultSummary: "x",
      resultMetadata: {
        simulated: false,
        grounded: true,
        evidence: { source: "search-console", property: "sc-domain:nexraagency.com", startDate: "2026-08-19", endDate: "2026-09-17" },
      },
    };
    assert.match(outputProvenance(performance, PERFORMANCE_REVIEW.groundedIn)?.text ?? "", /grounded in this project's Search Console report\. Advice, not measurement\./);
    assert.match(outputProvenance(performance)?.text ?? "", /grounded in this project's Search Console report for sc-domain:nexraagency.com, 2026-08-19 to 2026-09-17\./);

    const director: AgentRun = {
      ...performance,
      agentId: "seo-director",
      taskType: "priority-review",
      resultMetadata: {
        simulated: false,
        grounded: true,
        evidence: {
          source: "agent-run",
          runId: performance.id,
          agentId: "analytics-learning",
          taskType: "performance-review",
          upstreamEvidence: performance.resultMetadata?.evidence ?? null,
        },
      },
    };
    const provenance = outputProvenance(director, PRIORITY_REVIEW.groundedIn);
    assert.match(provenance?.text ?? "", /prioritising the Analytics & Learning agent's completed review/);
    assert.match(provenance?.text ?? "", /a Google Search Console report this product read for property "sc-domain:nexraagency.com"/);
    assert.match(provenance?.text ?? "", /Two layers of advice, not measurement\.$/);
  });
});

describe("the answer-readiness review request", () => {
  const spec = CRAWL_REVIEWS["answer-readiness-review"];

  test("names the AI Visibility agent and the answer-readiness task, over the same crawl", () => {
    const result = reviewRequest("nexra-agency", CRAWL, spec);
    assert.deepEqual(result, {
      ok: true,
      payload: {
        projectId: "nexra-agency",
        agentId: "ai-visibility",
        taskType: "answer-readiness-review",
        input: { crawlId: CRAWL.id },
      },
    });
  });

  test("the three crawl reviews name different agents and tasks, and the same input shape", () => {
    const kinds = ["crawl-review", "on-page-review", "answer-readiness-review"] as const;
    assert.equal(new Set(kinds.map((kind) => CRAWL_REVIEWS[kind].agentId)).size, 3);
    assert.equal(new Set(kinds.map((kind) => CRAWL_REVIEWS[kind].taskType)).size, 3);
    const inputs = kinds.map((kind) => {
      const result = reviewRequest("nexra-agency", CRAWL, CRAWL_REVIEWS[kind]);
      return result.ok ? result.payload.input : null;
    });
    assert.deepEqual(inputs, [{ crawlId: CRAWL.id }, { crawlId: CRAWL.id }, { crawlId: CRAWL.id }]);
  });

  test("the spec matches what the server allows, says what it will not claim, and promises no changes", () => {
    assert.equal(spec.agentId, "ai-visibility");
    assert.equal(spec.taskType, "answer-readiness-review");
    assert.equal(spec.agentName, "AI Visibility / AEO");
    assert.ok(spec.action.startsWith("Analyze with "));
    assert.match(spec.summary, /^Queues a read-only answer-readiness review/);
    assert.match(spec.summary, /not AI crawler access, citations or visibility, which no crawl can observe/);
    assert.match(spec.summary, /changes nothing/);
    assert.equal(spec.groundedIn, CRAWL_REVIEWS["crawl-review"].groundedIn);
  });

  test("it is refused for the same crawls the other two are refused for", () => {
    for (const crawl of [
      null,
      { ...CRAWL, status: "running" as const, finishedAt: null },
      { ...CRAWL, status: "failed" as const },
      { ...CRAWL, status: "cancelled" as const },
    ]) {
      const result = reviewRequest("nexra-agency", crawl, spec);
      assert.equal(result.ok, false);
    }
    assert.equal(reviewRequest("", CRAWL, spec).ok, false);
  });

  test("a server refusal names this agent and task", () => {
    assert.match(queueRefusal(422, { error: "task-not-allowed" }, spec), /The AI Visibility \/ AEO agent is not allowed/);
    assert.match(queueRefusal(422, { error: "unknown-task-type" }, spec), /does not know the answer-readiness-review task/);
  });

  test("a completed grounded answer-readiness review can be handed to the Director, and is refused for the same reasons as any other", () => {
    const completed: AgentRun = {
      ...RUN,
      agentId: "ai-visibility",
      taskType: "answer-readiness-review",
      status: "completed",
      executor: "ai",
      resultSummary: "OBSERVED: one JSON-LD block.",
      resultMetadata: {
        simulated: false,
        grounded: true,
        evidence: { crawlId: CRAWL.id, hostScope: "nexraagency.com", pagesFetched: 5, pagesIncluded: 5, pagesNotReached: 2 },
      },
      finishedAt: "2026-09-20T11:05:00.000Z",
    };
    assert.equal(offersHandoff(completed), true);
    assert.deepEqual(handoffRequest("nexra-agency", completed), {
      ok: true,
      payload: { projectId: "nexra-agency", agentId: "seo-director", taskType: "priority-review", input: { sourceRunId: completed.id } },
    });

    const refusals: [AgentRun, RegExp][] = [
      [{ ...completed, projectId: "other-client" }, /belongs to a different project/],
      [{ ...completed, status: "queued", resultSummary: null }, /has not finished/],
      [{ ...completed, status: "running", resultSummary: null }, /has not finished/],
      [{ ...completed, status: "failed", resultSummary: null }, /did not complete/],
      [{ ...completed, status: "cancelled", resultSummary: null }, /did not complete/],
      [{ ...completed, executor: "mock", resultMetadata: { simulated: true, grounded: false } }, /Simulated output cannot be handed off/],
      [{ ...completed, resultMetadata: { simulated: false, grounded: false } }, /not grounded in recorded evidence/],
    ];
    for (const [source, why] of refusals) {
      const result = handoffRequest("nexra-agency", source);
      assert.equal(result.ok, false, why.source);
      assert.match(result.ok ? "" : result.why, why);
    }
    assert.equal(offersHandoff({ ...completed, status: "queued" }), false);
  });

  test("provenance keeps the layers apart: crawl is recorded, the review is advice, the Director's queue is advice on advice", () => {
    const review: AgentRun = {
      ...RUN,
      agentId: "ai-visibility",
      taskType: "answer-readiness-review",
      status: "completed",
      executor: "ai",
      resultSummary: "x",
      resultMetadata: { simulated: false, grounded: true, evidence: { crawlId: CRAWL.id, hostScope: "nexraagency.com" } },
    };
    assert.match(outputProvenance(review, spec.groundedIn)?.text ?? "", /grounded in this crawl's recorded pages\. Advice, not measurement\./);
    assert.match(outputProvenance(review)?.text ?? "", /grounded in this product's recorded crawl\. Advice, not measurement\./);

    const director: AgentRun = {
      ...review,
      agentId: "seo-director",
      taskType: "priority-review",
      resultMetadata: {
        simulated: false,
        grounded: true,
        evidence: {
          source: "agent-run",
          runId: review.id,
          agentId: "ai-visibility",
          taskType: "answer-readiness-review",
          upstreamEvidence: review.resultMetadata?.evidence ?? null,
        },
      },
    };
    const provenance = outputProvenance(director, PRIORITY_REVIEW.groundedIn);
    assert.match(provenance?.text ?? "", /prioritising the AI Visibility agent's completed review/);
    assert.match(provenance?.text ?? "", /model-generated over a crawl this product recorded/);
    assert.match(provenance?.text ?? "", /Two layers of advice, not measurement\.$/);
  });
});

describe("restoring a review's run after the page loads", () => {
  const at = (minute: number) => `2026-09-21T10:${String(minute).padStart(2, "0")}:00.000Z`;
  const completedCrawlReview = (id: string, minute: number, overrides: Partial<AgentRun> = {}): AgentRun => ({
    ...RUN,
    id,
    status: "completed",
    executor: "ai",
    attemptCount: 1,
    resultSummary: "OBSERVED: https://nexraagency.com/ returned 200.",
    resultMetadata: { simulated: false, grounded: true, evidence: { crawlId: CRAWL.id, hostScope: "nexraagency.com" } },
    createdAt: at(minute),
    updatedAt: at(minute + 1),
    startedAt: at(minute),
    finishedAt: at(minute + 1),
    ...overrides,
  });
  const OTHER_CRAWL = "8f1c0d2e-0000-4000-8000-000000000002";

  describe("the pure pick", () => {
    test("returns the newest run of this agent and task over this crawl, whatever order the list arrived in", () => {
      const older = completedCrawlReview("11111111-0000-4000-8000-000000000010", 1);
      const newest = completedCrawlReview("11111111-0000-4000-8000-000000000011", 9);
      const middle = completedCrawlReview("11111111-0000-4000-8000-000000000012", 5);
      assert.equal(latestReviewRun([older, newest, middle], CRAWL_REVIEWS["crawl-review"], { crawlId: CRAWL.id })?.id, newest.id);
      assert.equal(latestReviewRun([middle, older, newest], CRAWL_REVIEWS["crawl-review"], { crawlId: CRAWL.id })?.id, newest.id);
    });

    test("ignores another agent's run over the same crawl", () => {
      const onPage = completedCrawlReview("11111111-0000-4000-8000-000000000013", 9, { agentId: "on-page-seo", taskType: "on-page-review" });
      assert.equal(latestReviewRun([onPage], CRAWL_REVIEWS["crawl-review"], { crawlId: CRAWL.id }), null);
      assert.equal(latestReviewRun([onPage], CRAWL_REVIEWS["on-page-review"], { crawlId: CRAWL.id })?.id, onPage.id);
    });

    test("ignores the same agent's run of another task", () => {
      const generic = completedCrawlReview("11111111-0000-4000-8000-000000000014", 9, { taskType: "project-review", input: {} });
      assert.equal(latestReviewRun([generic], CRAWL_REVIEWS["crawl-review"], { crawlId: CRAWL.id }), null);
    });

    test("ignores a review of another crawl, and an input with anything extra", () => {
      const other = completedCrawlReview("11111111-0000-4000-8000-000000000015", 9, { input: { crawlId: OTHER_CRAWL } });
      const extra = completedCrawlReview("11111111-0000-4000-8000-000000000016", 9, { input: { crawlId: CRAWL.id, focus: "x" } });
      assert.equal(latestReviewRun([other, extra], CRAWL_REVIEWS["crawl-review"], { crawlId: CRAWL.id }), null);
    });

    test("ignores a Search Console review of another window, and finds the right one", () => {
      const thirty = completedCrawlReview("11111111-0000-4000-8000-000000000017", 3, { agentId: "keyword-intent", taskType: "search-query-review", input: { range: "30d" } });
      const seven = completedCrawlReview("11111111-0000-4000-8000-000000000018", 9, { agentId: "keyword-intent", taskType: "search-query-review", input: { range: "7d" } });
      const performance = completedCrawlReview("11111111-0000-4000-8000-000000000019", 9, { agentId: "analytics-learning", taskType: "performance-review", input: { range: "30d" } });
      assert.equal(latestReviewRun([thirty, seven, performance], SEARCH_QUERY_REVIEW, { range: "30d" })?.id, thirty.id);
      assert.equal(latestReviewRun([thirty, seven, performance], SEARCH_QUERY_REVIEW, { range: "3m" }), null);
      assert.equal(latestReviewRun([thirty, seven, performance], PERFORMANCE_REVIEW, { range: "30d" })?.id, performance.id);
    });

    test("returns null when nothing matches or the list is empty", () => {
      assert.equal(latestReviewRun([], CRAWL_REVIEWS["crawl-review"], { crawlId: CRAWL.id }), null);
      assert.equal(latestReviewRun([RUN], CRAWL_REVIEWS["on-page-review"], { crawlId: CRAWL.id }), null);
    });

    test("a queued or failed run is restored too — the state is shown, and a fresh queue stays possible", () => {
      const failed = completedCrawlReview("11111111-0000-4000-8000-000000000020", 9, {
        status: "failed",
        resultSummary: null,
        resultMetadata: null,
        error: { code: "rejected-output", message: "refused" },
      });
      const picked = latestReviewRun([failed], CRAWL_REVIEWS["crawl-review"], { crawlId: CRAWL.id });
      assert.equal(picked?.id, failed.id);
      assert.equal(hasResult(failed), false);
      // The queue control is decided by the crawl, not by the restored run: a
      // failed run leaves the button enabled, as it always has.
      assert.equal(reviewRequest("nexra-agency", CRAWL).ok, true);
      assert.equal(executability(failed).ok, false);
      assert.equal(executability({ ...failed, status: "queued", error: null }).ok, true);
    });
  });

  describe("the read", () => {
    /** A fetch that records every call and answers as told. */
    function listFetch(answer: { ok?: boolean; body?: unknown; throws?: boolean }) {
      const calls: { url: string; init: { cache: "no-store"; signal?: AbortSignal } }[] = [];
      const fetchList = async (url: string, init: { cache: "no-store"; signal?: AbortSignal }) => {
        calls.push({ url, init });
        if (answer.throws) throw new TypeError("network down");
        return { ok: answer.ok ?? true, json: async () => answer.body };
      };
      return { calls, fetchList };
    }

    test("asks the existing list endpoint for this project and agent, and nothing else — one GET, no POST", async () => {
      const url = reviewRunsUrl("nexra-agency", CRAWL_REVIEWS["answer-readiness-review"]);
      assert.equal(url, `/api/agent-runs?project=nexra-agency&agent=ai-visibility&limit=${RESTORE_LIST_LIMIT}`);
      assert.equal(RESTORE_LIST_LIMIT, 25);

      const { calls, fetchList } = listFetch({ body: { runs: [] } });
      await restoreReviewRun("nexra-agency", CRAWL_REVIEWS["answer-readiness-review"], { crawlId: CRAWL.id }, fetchList);
      assert.equal(calls.length, 1);
      assert.equal(calls[0]?.url, url);
      assert.equal(calls[0]?.init.cache, "no-store");
      // A read has no method and no body: nothing here can queue or execute.
      assert.equal("method" in (calls[0]?.init ?? {}), false);
      assert.equal("body" in (calls[0]?.init ?? {}), false);
    });

    test("a completed crawl review is restored, and it carries everything the control and the hand-off need", async () => {
      const completed = completedCrawlReview("11111111-0000-4000-8000-000000000021", 9, { agentId: "ai-visibility", taskType: "answer-readiness-review" });
      const { fetchList } = listFetch({ body: { runs: [RUN, completed] } });
      const run = await restoreReviewRun("nexra-agency", CRAWL_REVIEWS["answer-readiness-review"], { crawlId: CRAWL.id }, fetchList);

      assert.equal(run?.id, completed.id);
      assert.ok(run && hasResult(run));
      assert.match(outputProvenance(run!, CRAWL_REVIEWS["answer-readiness-review"].groundedIn)?.text ?? "", /grounded in this crawl's recorded pages/);
      // The restored run is the same persisted record, so the Director hand-off
      // is decided exactly as it was in the page that ran it.
      assert.equal(offersHandoff(run!), true);
      assert.deepEqual(handoffRequest("nexra-agency", run!), {
        ok: true,
        payload: { projectId: "nexra-agency", agentId: "seo-director", taskType: "priority-review", input: { sourceRunId: completed.id } },
      });
    });

    test("a completed Search Console review is restored for its window only", async () => {
      const performance = completedCrawlReview("11111111-0000-4000-8000-000000000022", 9, {
        agentId: "analytics-learning",
        taskType: "performance-review",
        input: { range: "30d" },
        resultMetadata: { simulated: false, grounded: true, evidence: { source: "search-console", property: "sc-domain:nexraagency.com", startDate: "2026-08-19", endDate: "2026-09-17" } },
      });
      const { fetchList } = listFetch({ body: { runs: [performance] } });
      assert.equal((await restoreReviewRun("nexra-agency", PERFORMANCE_REVIEW, { range: "30d" }, fetchList))?.id, performance.id);
      assert.equal(await restoreReviewRun("nexra-agency", PERFORMANCE_REVIEW, { range: "7d" }, fetchList), null);
    });

    test("a restored mock run is shown as simulated and still cannot be handed off", async () => {
      const mock = completedCrawlReview("11111111-0000-4000-8000-000000000023", 9, {
        executor: "mock",
        resultMetadata: { simulated: true, grounded: false },
      });
      const { fetchList } = listFetch({ body: { runs: [mock] } });
      const run = await restoreReviewRun("nexra-agency", CRAWL_REVIEWS["crawl-review"], { crawlId: CRAWL.id }, fetchList);
      assert.equal(run?.id, mock.id);
      assert.match(outputProvenance(run!)?.text ?? "", /^Simulated/);
      assert.equal(handoffRequest("nexra-agency", run!).ok, false);
    });

    test("an empty list, a refused request, a malformed body, a network failure, and an abort all leave the control idle", async () => {
      const review = CRAWL_REVIEWS["crawl-review"];
      const input = { crawlId: CRAWL.id };
      assert.equal(await restoreReviewRun("nexra-agency", review, input, listFetch({ body: { runs: [] } }).fetchList), null);
      assert.equal(await restoreReviewRun("nexra-agency", review, input, listFetch({ ok: false, body: { error: "unauthorized" } }).fetchList), null);
      assert.equal(await restoreReviewRun("nexra-agency", review, input, listFetch({ body: { error: "unavailable" } }).fetchList), null);
      assert.equal(await restoreReviewRun("nexra-agency", review, input, listFetch({ body: null }).fetchList), null);
      assert.equal(await restoreReviewRun("nexra-agency", review, input, listFetch({ throws: true }).fetchList), null);

      const controller = new AbortController();
      controller.abort();
      const aborted = async (_url: string, init: { signal?: AbortSignal }) => {
        if (init.signal?.aborted) throw new DOMException("aborted", "AbortError");
        return { ok: true, json: async () => ({ runs: [] }) };
      };
      assert.equal(await restoreReviewRun("nexra-agency", review, input, aborted, controller.signal), null);
    });

    test("each evidence key is its own lookup: the same list answers differently for two crawls", async () => {
      const mine = completedCrawlReview("11111111-0000-4000-8000-000000000024", 9);
      const theirs = completedCrawlReview("11111111-0000-4000-8000-000000000025", 9, { input: { crawlId: OTHER_CRAWL } });
      const { calls, fetchList } = listFetch({ body: { runs: [mine, theirs] } });
      assert.equal((await restoreReviewRun("nexra-agency", CRAWL_REVIEWS["crawl-review"], { crawlId: CRAWL.id }, fetchList))?.id, mine.id);
      assert.equal((await restoreReviewRun("nexra-agency", CRAWL_REVIEWS["crawl-review"], { crawlId: OTHER_CRAWL }, fetchList))?.id, theirs.id);
      assert.equal(calls.length, 2);
    });

    test("the restored note says where the run came from, and the queued and duplicate notes are unchanged", () => {
      const completed = completedCrawlReview("11111111-0000-4000-8000-000000000026", 9);
      assert.equal(queuedNote({ run: completed, duplicate: false, restored: true }), "Restored from run history.");
      assert.match(queuedNote({ run: { ...completed, status: "queued" }, duplicate: false, restored: true }), /^Restored from run history\. Waiting to be claimed; nothing has been analysed yet\.$/);
      assert.match(queuedNote({ run: RUN, duplicate: false }), /^Queued\. The scheduled worker picks runs up; nothing has been analysed yet\.$/);
      assert.match(queuedNote({ run: RUN, duplicate: true }), /already queued; showing that run/);
    });
  });
});
