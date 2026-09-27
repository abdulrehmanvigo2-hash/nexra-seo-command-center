import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import type { AgentRun, AgentRunStatus } from "../../types/agent-run.ts";
import type { Crawl } from "../../types/crawl.ts";
import type { SearchConsoleReport } from "../../types/search-console.ts";
import {
  COMPETITOR_COMPARISON_REVIEW,
  CONTENT_PLAN_REVIEW,
  CRAWL_REVIEWS,
  EVIDENCE_PACK_REVIEW,
  INTAKE_REVIEW,
  OUTBOUND_LINK_REVIEW,
  competitorComparisonRequest,
  contentPlanRequest,
  evidencePackRequest,
  PERFORMANCE_REVIEW,
  PRIORITY_REVIEW,
  PROJECT_PRIORITY_REVIEW,
  projectDirectorRequest,
  REVIEW_AGENT_ID,
  SECTION_DRAFT,
  draftRequest,
  offersDraft,
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
  intakeReviewRequest,
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

    describe("a handoff's sourceTaskId is provenance, not evidence", () => {
      const TASK_ID = "30e79092-6258-4fff-8d1f-c1e2921764b8";
      const queuedRun = (id: string, minute: number, overrides: Partial<AgentRun> = {}): AgentRun => ({
        ...RUN,
        id,
        status: "queued",
        createdAt: at(minute),
        updatedAt: at(minute),
        ...overrides,
      });

      test("an intake review expecting {} restores a queued handoff run whose only stored key is sourceTaskId", () => {
        const handoff = queuedRun("11111111-0000-4000-8000-000000000030", 9, {
          agentId: INTAKE_REVIEW.agentId,
          taskType: INTAKE_REVIEW.taskType,
          input: { sourceTaskId: TASK_ID },
        });
        const picked = latestReviewRun([handoff], INTAKE_REVIEW, {});
        assert.equal(picked?.id, handoff.id);
        // The run is handed back as stored: its provenance is not stripped.
        assert.deepEqual(picked?.input, { sourceTaskId: TASK_ID });
        assert.equal(executability(picked).ok, true);
      });

      test("a review with real evidence fields still matches when sourceTaskId is the only extra stored key", () => {
        const handoff = queuedRun("11111111-0000-4000-8000-000000000031", 9, {
          agentId: "keyword-intent",
          taskType: "search-query-review",
          input: { range: "30d", sourceTaskId: TASK_ID },
        });
        assert.equal(latestReviewRun([handoff], SEARCH_QUERY_REVIEW, { range: "30d" })?.id, handoff.id);
        const crawlHandoff = queuedRun("11111111-0000-4000-8000-000000000032", 9, { input: { crawlId: CRAWL.id, sourceTaskId: TASK_ID } });
        assert.equal(latestReviewRun([crawlHandoff], CRAWL_REVIEWS["crawl-review"], { crawlId: CRAWL.id })?.id, crawlHandoff.id);
      });

      test("any other extra key still fails to match, with or without sourceTaskId beside it", () => {
        const focus = queuedRun("11111111-0000-4000-8000-000000000033", 9, { input: { crawlId: CRAWL.id, focus: "x" } });
        const both = queuedRun("11111111-0000-4000-8000-000000000034", 9, { input: { crawlId: CRAWL.id, sourceTaskId: TASK_ID, focus: "x" } });
        const intakeExtra = queuedRun("11111111-0000-4000-8000-000000000035", 9, {
          agentId: INTAKE_REVIEW.agentId,
          taskType: INTAKE_REVIEW.taskType,
          input: { sourceTaskId: TASK_ID, notes: "x" },
        });
        assert.equal(latestReviewRun([focus, both], CRAWL_REVIEWS["crawl-review"], { crawlId: CRAWL.id }), null);
        assert.equal(latestReviewRun([intakeExtra], INTAKE_REVIEW, {}), null);
      });

      test("a mismatched evidence field still fails to match even when sourceTaskId is present", () => {
        const otherCrawl = queuedRun("11111111-0000-4000-8000-000000000036", 9, { input: { crawlId: OTHER_CRAWL, sourceTaskId: TASK_ID } });
        const otherRange = queuedRun("11111111-0000-4000-8000-000000000037", 9, {
          agentId: "keyword-intent",
          taskType: "search-query-review",
          input: { range: "7d", sourceTaskId: TASK_ID },
        });
        const missingField = queuedRun("11111111-0000-4000-8000-000000000038", 9, { input: { sourceTaskId: TASK_ID } });
        assert.equal(latestReviewRun([otherCrawl, missingField], CRAWL_REVIEWS["crawl-review"], { crawlId: CRAWL.id }), null);
        assert.equal(latestReviewRun([otherRange], SEARCH_QUERY_REVIEW, { range: "30d" }), null);
      });
    });

    describe("an active run is shown before a finished one", () => {
      const TASK_ID = "30e79092-6258-4fff-8d1f-c1e2921764b8";
      const intake = (id: string, minute: number, overrides: Partial<AgentRun> = {}): AgentRun => ({
        ...RUN,
        id,
        agentId: INTAKE_REVIEW.agentId,
        taskType: INTAKE_REVIEW.taskType,
        input: {},
        status: "queued",
        createdAt: at(minute),
        updatedAt: at(minute),
        ...overrides,
      });
      const finished = (id: string, minute: number, overrides: Partial<AgentRun> = {}): AgentRun =>
        intake(id, minute, {
          status: "completed",
          executor: "ai",
          attemptCount: 1,
          resultSummary: "RECORDED GOAL\nleads.",
          resultMetadata: { simulated: false, grounded: true, evidence: { source: "project" } },
          startedAt: at(minute),
          finishedAt: at(minute + 1),
          ...overrides,
        });

      test("a queued handoff run wins over a newer completed plain run — the production shape", () => {
        const handoff = intake("11111111-0000-4000-8000-000000000040", 3, { input: { sourceTaskId: TASK_ID } });
        const plain = finished("11111111-0000-4000-8000-000000000041", 9);
        assert.equal(latestReviewRun([plain, handoff], INTAKE_REVIEW, {})?.id, handoff.id);
        assert.equal(latestReviewRun([handoff, plain], INTAKE_REVIEW, {})?.id, handoff.id);
      });

      test("a running run wins over a queued one, whatever their ages", () => {
        const running = intake("11111111-0000-4000-8000-000000000042", 2, { status: "running", attemptCount: 1, startedAt: at(2) });
        const queued = intake("11111111-0000-4000-8000-000000000043", 9);
        assert.equal(latestReviewRun([queued, running], INTAKE_REVIEW, {})?.id, running.id);
        assert.equal(latestReviewRun([running, queued], INTAKE_REVIEW, {})?.id, running.id);
      });

      test("the newest queued run wins among queued runs, and equal times fall back to the smaller id", () => {
        const older = intake("11111111-0000-4000-8000-000000000044", 3);
        const newest = intake("11111111-0000-4000-8000-000000000045", 9);
        const middle = intake("11111111-0000-4000-8000-000000000046", 5);
        assert.equal(latestReviewRun([older, newest, middle], INTAKE_REVIEW, {})?.id, newest.id);
        const twinB = intake("11111111-0000-4000-8000-000000000048", 9);
        const twinA = intake("11111111-0000-4000-8000-000000000047", 9);
        assert.equal(latestReviewRun([twinB, twinA], INTAKE_REVIEW, {})?.id, twinA.id);
        assert.equal(latestReviewRun([twinA, twinB], INTAKE_REVIEW, {})?.id, twinA.id);
      });

      test("with no active run, the finished runs are still ordered newest first, failed and cancelled alike", () => {
        const older = finished("11111111-0000-4000-8000-000000000049", 1);
        const newest = finished("11111111-0000-4000-8000-000000000050", 9, {
          status: "failed",
          resultSummary: null,
          resultMetadata: null,
          error: { code: "rejected-output", message: "refused" },
        });
        const middle = finished("11111111-0000-4000-8000-000000000051", 5, { status: "cancelled" });
        assert.equal(latestReviewRun([older, newest, middle], INTAKE_REVIEW, {})?.id, newest.id);
        assert.equal(latestReviewRun([middle, older, newest], INTAKE_REVIEW, {})?.id, newest.id);
      });
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

describe("the intake review request", () => {
  const completedIntake = (overrides: Partial<AgentRun> = {}): AgentRun => ({
    ...RUN,
    id: "11111111-0000-4000-8000-000000000030",
    agentId: "project-manager",
    taskType: "intake-review",
    input: {},
    status: "completed",
    executor: "ai",
    attemptCount: 1,
    resultSummary: "RECORDED GOAL\nLeads, as recorded.",
    resultMetadata: {
      simulated: false,
      grounded: true,
      evidence: { source: "project", projectId: "nexra-agency", intakeNotes: "included", crawls: 1, searchConsoleState: "connected" },
    },
    createdAt: "2026-09-21T10:05:00.000Z",
    updatedAt: "2026-09-21T10:06:00.000Z",
    startedAt: "2026-09-21T10:05:00.000Z",
    finishedAt: "2026-09-21T10:06:00.000Z",
    ...overrides,
  });

  test("names the Project Manager and the intake task, with an empty input and nothing else", () => {
    assert.deepEqual(intakeReviewRequest("nexra-agency"), {
      ok: true,
      payload: { projectId: "nexra-agency", agentId: "project-manager", taskType: "intake-review", input: {} },
    });
  });

  test("is refused only when no project is selected — the record itself is the evidence", () => {
    assert.deepEqual(intakeReviewRequest(null), { ok: false, why: "No project is selected." });
    assert.equal(intakeReviewRequest("").ok, false);
  });

  test("the spec matches what the server allows, calls the notes unverified, and promises no changes", () => {
    assert.equal(INTAKE_REVIEW.agentId, "project-manager");
    assert.equal(INTAKE_REVIEW.taskType, "intake-review");
    assert.equal(INTAKE_REVIEW.agentName, "Project Manager");
    assert.equal(INTAKE_REVIEW.action, "Review intake with Project Manager Agent");
    assert.match(INTAKE_REVIEW.summary, /^Queues a read-only intake review/);
    assert.match(INTAKE_REVIEW.summary, /intake notes and competitor domains \(unverified\)/);
    assert.match(INTAKE_REVIEW.summary, /assigns nothing, schedules nothing, and changes nothing/);
    assert.equal(INTAKE_REVIEW.groundedIn, "this project's stored record and evidence inventory");
    assert.doesNotMatch(INTAKE_REVIEW.summary, /succe|analysed|complete/i);
  });

  test("a server refusal names this agent and task", () => {
    assert.match(queueRefusal(422, { error: "task-not-allowed" }, INTAKE_REVIEW), /The Project Manager agent is not allowed/);
    assert.match(queueRefusal(422, { error: "unknown-task-type" }, INTAKE_REVIEW), /does not know the intake-review task/);
  });

  test("a grounded intake result is described by the record it read, and is still advice", () => {
    const provenance = outputProvenance(completedIntake(), INTAKE_REVIEW.groundedIn);
    assert.equal(provenance?.text, "Model output, grounded in this project's stored record and evidence inventory. Advice, not measurement.");
    assert.equal(provenance?.tone, "neutral");
    // And Run History, which passes no description, reads the same from the evidence alone.
    assert.equal(outputProvenance(completedIntake())?.text, provenance?.text);
    assert.equal(evidenceDescription({ evidence: { source: "project" } }), INTAKE_REVIEW.groundedIn);
    // Never the crawl wording a source-less summary would fall back to.
    assert.doesNotMatch(outputProvenance(completedIntake())?.text ?? "", /crawl/);
  });

  test("a simulated intake result is labelled simulated, before anything else", () => {
    const mock = completedIntake({ executor: "mock", resultMetadata: { simulated: true, grounded: false } });
    assert.match(outputProvenance(mock, INTAKE_REVIEW.groundedIn)?.text ?? "", /^Simulated/);
    assert.equal(outputProvenance(mock)?.tone, "warning");
  });

  test("a completed intake review never offers the Director hand-off, and the server's reader would refuse it", () => {
    const completed = completedIntake();
    assert.equal(offersHandoff(completed), false);
    const refusal = handoffRequest("nexra-agency", completed);
    assert.equal(refusal.ok, false);
    assert.match(refusal.ok ? "" : refusal.why, /takes hand-offs from crawl reviews, on-page reviews, answer-readiness reviews, search query reviews and performance reviews only/);
    // The runtime's own rule, not a panel rule: the same refusal for a grounded, completed run.
    for (const status of ["queued", "running", "failed", "cancelled"] as AgentRunStatus[]) {
      assert.equal(offersHandoff(completedIntake({ status })), false);
    }
  });

  test("is restored from run history by project alone: the newest Project Manager intake run, whatever its state", async () => {
    const older = completedIntake({ id: "11111111-0000-4000-8000-000000000031", createdAt: "2026-09-21T09:00:00.000Z" });
    const newest = completedIntake({ id: "11111111-0000-4000-8000-000000000032", createdAt: "2026-09-21T11:00:00.000Z", status: "queued", executor: null, resultSummary: null, resultMetadata: null });
    const otherAgent = completedIntake({ id: "11111111-0000-4000-8000-000000000033", agentId: "seo-director", taskType: "priority-review", input: { sourceRunId: older.id }, createdAt: "2026-09-21T12:00:00.000Z" });
    const generic = completedIntake({ id: "11111111-0000-4000-8000-000000000034", taskType: "project-review", createdAt: "2026-09-21T12:00:00.000Z" });
    const withInput = completedIntake({ id: "11111111-0000-4000-8000-000000000035", input: { focus: "x" }, createdAt: "2026-09-21T12:00:00.000Z" });

    assert.equal(latestReviewRun([older, otherAgent, newest, generic, withInput], INTAKE_REVIEW, {})?.id, newest.id);
    assert.equal(latestReviewRun([otherAgent, generic, withInput], INTAKE_REVIEW, {}), null);

    const calls: string[] = [];
    const fetchList = async (url: string, init: { cache: "no-store"; signal?: AbortSignal }) => {
      calls.push(url);
      assert.equal(init.cache, "no-store");
      return { ok: true, json: async () => ({ runs: [older, otherAgent, newest] }) };
    };
    const restored = await restoreReviewRun("nexra-agency", INTAKE_REVIEW, {}, fetchList);
    assert.equal(restored?.id, newest.id);
    assert.deepEqual(calls, [`/api/agent-runs?project=nexra-agency&agent=project-manager&limit=${RESTORE_LIST_LIMIT}`]);
    // A completed one carries what the control shows: result, provenance, and no hand-off.
    const completed = await restoreReviewRun("nexra-agency", INTAKE_REVIEW, {}, async () => ({ ok: true, json: async () => ({ runs: [older] }) }));
    assert.ok(completed && hasResult(completed));
    assert.match(outputProvenance(completed!, INTAKE_REVIEW.groundedIn)?.text ?? "", /grounded in this project's stored record and evidence inventory/);
    assert.equal(offersHandoff(completed!), false);
  });

  test("the six existing reviews are untouched by the intake review's presence", () => {
    assert.equal(reviewRequest("nexra-agency", CRAWL).ok, true);
    assert.equal(latestReviewRun([completedIntake()], CRAWL_REVIEWS["crawl-review"], { crawlId: CRAWL.id }), null);
    assert.equal(latestReviewRun([completedIntake()], PERFORMANCE_REVIEW, { range: "30d" }), null);
    assert.equal(latestReviewRun([completedIntake()], PRIORITY_REVIEW, { sourceRunId: RUN.id }), null);
    assert.equal(outputProvenance({ ...RUN, status: "completed", resultSummary: "x", resultMetadata: { simulated: false, grounded: true } })?.text, "Model output, grounded in this crawl's recorded pages. Advice, not measurement.");
  });
});

describe("the competitor comparison request", () => {
  const RIVAL_CRAWL: Crawl = {
    ...CRAWL,
    id: "8f1c0d2e-0000-4000-8000-000000000009",
    startUrl: "https://rival.example/",
    hostScope: "rival.example",
  };
  const RECORDED = ["rival.example", "https://Other.Example/"];
  const base = {
    projectId: "nexra-agency",
    projectDomain: "nexraagency.com",
    competitorDomain: "rival.example",
    recorded: RECORDED,
    projectCrawl: CRAWL as Crawl | null | undefined,
    competitorCrawl: RIVAL_CRAWL as Crawl | null | undefined,
  };

  const completedComparison = (overrides: Partial<AgentRun> = {}): AgentRun => ({
    ...RUN,
    id: "11111111-0000-4000-8000-000000000040",
    agentId: "market-intelligence",
    taskType: "competitor-comparison-review",
    input: { competitorDomain: "rival.example" },
    status: "completed",
    executor: "ai",
    attemptCount: 1,
    resultSummary: "PROJECT SITE OBSERVATIONS\nhttps://nexraagency.com/services declares one h1.",
    resultMetadata: {
      simulated: false,
      grounded: true,
      evidence: {
        source: "competitor-comparison",
        projectId: "nexra-agency",
        projectHost: "nexraagency.com",
        projectCrawlId: CRAWL.id,
        competitorHost: "rival.example",
        competitorCrawlId: RIVAL_CRAWL.id,
      },
    },
    createdAt: "2026-09-21T10:05:00.000Z",
    updatedAt: "2026-09-21T10:06:00.000Z",
    startedAt: "2026-09-21T10:05:00.000Z",
    finishedAt: "2026-09-21T10:06:00.000Z",
    ...overrides,
  });

  test("names the Market & Competitor Intelligence agent and the comparison task, with the canonical host and nothing else", () => {
    assert.deepEqual(competitorComparisonRequest(base), {
      ok: true,
      payload: {
        projectId: "nexra-agency",
        agentId: "market-intelligence",
        taskType: "competitor-comparison-review",
        input: { competitorDomain: "rival.example" },
      },
    });
    // A recorded entry with a scheme still resolves to its host; the request never carries the scheme.
    const other = competitorComparisonRequest({ ...base, competitorDomain: "other.example", competitorCrawl: { ...RIVAL_CRAWL, hostScope: "other.example" } });
    assert.ok(other.ok);
    assert.deepEqual(other.ok ? other.payload.input : null, { competitorDomain: "other.example" });
  });

  test("is refused, with the crawler's own wording, for no project, an unrecorded domain, the project's own site, a URL, or an address", () => {
    assert.deepEqual(competitorComparisonRequest({ ...base, projectId: null }), { ok: false, why: "No project is selected." });
    const cases: [string, RegExp][] = [
      ["unrecorded.example", /not one of the competitor domains recorded for this project/i],
      ["nexraagency.com", /project's own site/i],
      ["www.nexraagency.com", /project's own site/i],
      ["https://rival.example/", /not a plain hostname/],
      ["10.0.0.5", /not a plain hostname/],
    ];
    for (const [competitorDomain, why] of cases) {
      const result = competitorComparisonRequest({ ...base, competitorDomain });
      assert.equal(result.ok, false, competitorDomain);
      assert.match(result.ok ? "" : result.why, why, competitorDomain);
    }
  });

  test("is refused while either side's crawl is unknown, missing, running, failed or cancelled — each with a reason that names the side", () => {
    const sides: [keyof typeof base, string][] = [
      ["competitorCrawl", "competitor"],
      ["projectCrawl", "project"],
    ];
    for (const [side, name] of sides) {
      const crawl = side === "competitorCrawl" ? RIVAL_CRAWL : CRAWL;
      const unknown = competitorComparisonRequest({ ...base, [side]: undefined });
      assert.equal(unknown.ok, false);
      assert.match(unknown.ok ? "" : unknown.why, /has not loaded yet/);
      assert.match(unknown.ok ? "" : unknown.why, new RegExp(name, "i"));

      const missing = competitorComparisonRequest({ ...base, [side]: null });
      assert.equal(missing.ok, false);
      assert.match(missing.ok ? "" : missing.why, /Crawl this (competitor's|project's own) site first/);
      assert.match(missing.ok ? "" : missing.why, new RegExp(name, "i"));

      const running = competitorComparisonRequest({ ...base, [side]: { ...crawl, status: "running", finishedAt: null } });
      assert.equal(running.ok, false);
      assert.match(running.ok ? "" : running.why, /still running/);

      const failed = competitorComparisonRequest({ ...base, [side]: { ...crawl, status: "failed" } });
      assert.equal(failed.ok, false);
      assert.match(failed.ok ? "" : failed.why, /failed/);

      const cancelled = competitorComparisonRequest({ ...base, [side]: { ...crawl, status: "cancelled" } });
      assert.equal(cancelled.ok, false);
      assert.match(cancelled.ok ? "" : cancelled.why, /cancelled/);
    }
    // Partial is a real result on either side.
    assert.equal(competitorComparisonRequest({ ...base, competitorCrawl: { ...RIVAL_CRAWL, status: "partial" }, projectCrawl: { ...CRAWL, status: "completed" } }).ok, true);
    assert.equal(competitorComparisonRequest({ ...base, competitorCrawl: { ...RIVAL_CRAWL, status: "completed" }, projectCrawl: { ...CRAWL, status: "partial" } }).ok, true);
  });

  test("the spec matches what the server allows, calls the competitor side declarations only, and promises no changes", () => {
    assert.equal(COMPETITOR_COMPARISON_REVIEW.agentId, "market-intelligence");
    assert.equal(COMPETITOR_COMPARISON_REVIEW.taskType, "competitor-comparison-review");
    assert.equal(COMPETITOR_COMPARISON_REVIEW.agentName, "Market & Competitor Intelligence");
    assert.equal(COMPETITOR_COMPARISON_REVIEW.action, "Analyze competitor with Market Intelligence Agent");
    assert.match(COMPETITOR_COMPARISON_REVIEW.summary, /^Queues a read-only comparison/);
    assert.match(COMPETITOR_COMPARISON_REVIEW.summary, /page declarations both crawls recorded/);
    assert.match(COMPETITOR_COMPARISON_REVIEW.summary, /nothing about either site's traffic, rankings, links or performance/);
    assert.match(COMPETITOR_COMPARISON_REVIEW.summary, /fetches nothing and changes nothing/);
    assert.match(COMPETITOR_COMPARISON_REVIEW.groundedIn, /page declarations only/);
    assert.doesNotMatch(COMPETITOR_COMPARISON_REVIEW.summary, /succe|analysed|complete|market share|share of voice/i);
  });

  test("a server refusal names this agent and task", () => {
    assert.match(queueRefusal(422, { error: "task-not-allowed" }, COMPETITOR_COMPARISON_REVIEW), /The Market & Competitor Intelligence agent is not allowed/);
    assert.match(queueRefusal(422, { error: "unknown-task-type" }, COMPETITOR_COMPARISON_REVIEW), /does not know the competitor-comparison-review task/);
  });

  test("a grounded comparison result is described by the two crawls it read, names the competitor, and is still advice", () => {
    const provenance = outputProvenance(completedComparison(), COMPETITOR_COMPARISON_REVIEW.groundedIn);
    assert.equal(
      provenance?.text,
      "Model output, grounded in this project's recorded site crawl and this competitor's recorded crawl (page declarations only). Advice, not measurement.",
    );
    assert.equal(provenance?.tone, "neutral");
    // Run History, which passes no description, reads the competitor's host from the evidence.
    assert.equal(
      outputProvenance(completedComparison())?.text,
      "Model output, grounded in this project's recorded site crawl and the recorded crawl of rival.example (page declarations only). Advice, not measurement.",
    );
    assert.equal(
      evidenceDescription({ evidence: { source: "competitor-comparison", competitorHost: "rival.example" } }),
      "this project's recorded site crawl and the recorded crawl of rival.example (page declarations only)",
    );
    assert.equal(evidenceDescription({ evidence: { source: "competitor-comparison" } }), COMPETITOR_COMPARISON_REVIEW.groundedIn);
    // Never the single-crawl wording: two crawls were read, and one of them is a rival's.
    assert.doesNotMatch(outputProvenance(completedComparison())?.text ?? "", /this crawl's recorded pages|this product's recorded crawl\./);
  });

  test("a simulated comparison result is labelled simulated, before anything else", () => {
    const mock = completedComparison({ executor: "mock", resultMetadata: { simulated: true, grounded: false } });
    assert.match(outputProvenance(mock, COMPETITOR_COMPARISON_REVIEW.groundedIn)?.text ?? "", /^Simulated/);
    assert.equal(outputProvenance(mock)?.tone, "warning");
  });

  test("a completed comparison never offers the Director hand-off, and the server's reader would refuse it", () => {
    const completed = completedComparison();
    assert.equal(offersHandoff(completed), false);
    const refusal = handoffRequest("nexra-agency", completed);
    assert.equal(refusal.ok, false);
    assert.match(refusal.ok ? "" : refusal.why, /takes hand-offs from crawl reviews, on-page reviews, answer-readiness reviews, search query reviews and performance reviews only/);
    for (const status of ["queued", "running", "failed", "cancelled"] as AgentRunStatus[]) {
      assert.equal(offersHandoff(completedComparison({ status })), false);
    }
  });

  test("is restored from run history by project and competitor host: the newest comparison of this competitor, never another's", async () => {
    const older = completedComparison({ id: "11111111-0000-4000-8000-000000000041", createdAt: "2026-09-21T09:00:00.000Z" });
    const newest = completedComparison({ id: "11111111-0000-4000-8000-000000000042", createdAt: "2026-09-21T11:00:00.000Z", status: "queued", executor: null, resultSummary: null, resultMetadata: null });
    const otherCompetitor = completedComparison({ id: "11111111-0000-4000-8000-000000000043", input: { competitorDomain: "other.example" }, createdAt: "2026-09-21T12:00:00.000Z" });
    const otherAgent = completedComparison({ id: "11111111-0000-4000-8000-000000000044", agentId: "project-manager", taskType: "intake-review", input: {}, createdAt: "2026-09-21T12:00:00.000Z" });
    const extraField = completedComparison({ id: "11111111-0000-4000-8000-000000000045", input: { competitorDomain: "rival.example", crawlId: CRAWL.id }, createdAt: "2026-09-21T12:00:00.000Z" });

    const input = { competitorDomain: "rival.example" };
    assert.equal(latestReviewRun([older, otherCompetitor, newest, otherAgent, extraField], COMPETITOR_COMPARISON_REVIEW, input)?.id, newest.id);
    assert.equal(latestReviewRun([otherCompetitor, otherAgent, extraField], COMPETITOR_COMPARISON_REVIEW, input), null);
    assert.equal(latestReviewRun([older, otherCompetitor], COMPETITOR_COMPARISON_REVIEW, { competitorDomain: "other.example" })?.id, otherCompetitor.id);

    const calls: string[] = [];
    const fetchList = async (url: string, init: { cache: "no-store"; signal?: AbortSignal }) => {
      calls.push(url);
      assert.equal(init.cache, "no-store");
      return { ok: true, json: async () => ({ runs: [older, otherCompetitor, newest] }) };
    };
    const restored = await restoreReviewRun("nexra-agency", COMPETITOR_COMPARISON_REVIEW, input, fetchList);
    assert.equal(restored?.id, newest.id);
    assert.deepEqual(calls, [`/api/agent-runs?project=nexra-agency&agent=market-intelligence&limit=${RESTORE_LIST_LIMIT}`]);
    const completed = await restoreReviewRun("nexra-agency", COMPETITOR_COMPARISON_REVIEW, input, async () => ({ ok: true, json: async () => ({ runs: [older] }) }));
    assert.ok(completed && hasResult(completed));
    assert.equal(offersHandoff(completed!), false);
  });

  test("the seven existing reviews are untouched by the comparison's presence", () => {
    assert.equal(reviewRequest("nexra-agency", CRAWL).ok, true);
    assert.equal(latestReviewRun([completedComparison()], CRAWL_REVIEWS["crawl-review"], { crawlId: CRAWL.id }), null);
    assert.equal(latestReviewRun([completedComparison()], INTAKE_REVIEW, {}), null);
    assert.equal(latestReviewRun([completedComparison()], PERFORMANCE_REVIEW, { range: "30d" }), null);
    assert.equal(latestReviewRun([completedComparison()], PRIORITY_REVIEW, { sourceRunId: RUN.id }), null);
    assert.equal(outputProvenance({ ...RUN, status: "completed", resultSummary: "x", resultMetadata: { simulated: false, grounded: true } })?.text, "Model output, grounded in this crawl's recorded pages. Advice, not measurement.");
  });
});

describe("the evidence pack request", () => {
  const completedPack = (overrides: Partial<AgentRun> = {}): AgentRun => ({
    ...RUN,
    id: "11111111-0000-4000-8000-000000000050",
    agentId: "research-evidence",
    taskType: "evidence-pack-review",
    input: {},
    status: "completed",
    executor: "ai",
    attemptCount: 1,
    resultSummary: "RECORDED PAGE EVIDENCE\n/services title \"Services\", one h1.",
    resultMetadata: {
      simulated: false,
      grounded: true,
      evidence: {
        source: "evidence-pack",
        projectId: "nexra-agency",
        projectHost: "nexraagency.com",
        crawlId: CRAWL.id,
        searchConsole: "included",
        property: "sc-domain:nexraagency.com",
        windowStart: "2026-08-19",
        windowEnd: "2026-09-17",
      },
    },
    createdAt: "2026-09-21T10:05:00.000Z",
    updatedAt: "2026-09-21T10:06:00.000Z",
    startedAt: "2026-09-21T10:05:00.000Z",
    finishedAt: "2026-09-21T10:06:00.000Z",
    ...overrides,
  });

  test("names the Research & Evidence agent and the pack task, with an empty input and nothing else", () => {
    assert.deepEqual(evidencePackRequest("nexra-agency", CRAWL), {
      ok: true,
      payload: { projectId: "nexra-agency", agentId: "research-evidence", taskType: "evidence-pack-review", input: {} },
    });
    assert.equal(evidencePackRequest("nexra-agency", { ...CRAWL, status: "completed" }).ok, true);
  });

  test("is refused, with a reason, for no project and while the own-site crawl is unknown, missing, running, failed or cancelled", () => {
    assert.deepEqual(evidencePackRequest(null, CRAWL), { ok: false, why: "No project is selected." });
    const cases: [Crawl | null | undefined, RegExp][] = [
      [undefined, /has not loaded yet/],
      [null, /Run a crawl of this project's own site first/],
      [{ ...CRAWL, status: "running", finishedAt: null }, /still running/],
      [{ ...CRAWL, status: "failed" }, /failed, so there is no recorded page evidence to pack/],
      [{ ...CRAWL, status: "cancelled" }, /cancelled, so there is no recorded page evidence to pack/],
    ];
    for (const [crawl, why] of cases) {
      const result = evidencePackRequest("nexra-agency", crawl);
      assert.equal(result.ok, false);
      assert.match(result.ok ? "" : result.why, why);
    }
  });

  test("the spec matches what the server allows, calls the result organisation of evidence, and promises no outside source", () => {
    assert.equal(EVIDENCE_PACK_REVIEW.agentId, "research-evidence");
    assert.equal(EVIDENCE_PACK_REVIEW.taskType, "evidence-pack-review");
    assert.equal(EVIDENCE_PACK_REVIEW.agentName, "Research & Evidence");
    assert.equal(EVIDENCE_PACK_REVIEW.action, "Compile evidence pack with Research & Evidence Agent");
    assert.match(EVIDENCE_PACK_REVIEW.summary, /^Queues a read-only evidence pack/);
    assert.match(EVIDENCE_PACK_REVIEW.summary, /each claim tagged with the record it rests on/);
    assert.match(EVIDENCE_PACK_REVIEW.summary, /consults no outside source, invents no citation, and changes nothing/);
    assert.match(EVIDENCE_PACK_REVIEW.groundedIn, /advice organising that evidence, not a new measurement/);
    assert.doesNotMatch(EVIDENCE_PACK_REVIEW.summary, /succe|analysed|complete|verified|primary source/i);
  });

  test("a server refusal names this agent and task", () => {
    assert.match(queueRefusal(422, { error: "task-not-allowed" }, EVIDENCE_PACK_REVIEW), /The Research & Evidence agent is not allowed/);
    assert.match(queueRefusal(422, { error: "unknown-task-type" }, EVIDENCE_PACK_REVIEW), /does not know the evidence-pack-review task/);
  });

  test("a grounded pack is described by the records it read, names the crawl and the window, and is still advice", () => {
    const provenance = outputProvenance(completedPack(), EVIDENCE_PACK_REVIEW.groundedIn);
    assert.equal(provenance?.text, "Model output, grounded in records this product holds for this project (advice organising that evidence, not a new measurement). Advice, not measurement.");
    assert.equal(provenance?.tone, "neutral");
    assert.equal(
      outputProvenance(completedPack())?.text,
      `Model output, grounded in records this product holds for this project: crawl ${CRAWL.id} and Search Console for sc-domain:nexraagency.com, 2026-08-19 to 2026-09-17 (advice organising that evidence, not a new measurement). Advice, not measurement.`,
    );
    assert.equal(
      evidenceDescription({ evidence: { source: "evidence-pack", crawlId: CRAWL.id, searchConsole: "not-connected" } }),
      `records this product holds for this project: crawl ${CRAWL.id} (advice organising that evidence, not a new measurement)`,
    );
    assert.equal(evidenceDescription({ evidence: { source: "evidence-pack" } }), EVIDENCE_PACK_REVIEW.groundedIn);
    assert.doesNotMatch(outputProvenance(completedPack())?.text ?? "", /this crawl's recorded pages|this product's recorded crawl\./);
  });

  test("a simulated pack is labelled simulated, before anything else", () => {
    const mock = completedPack({ executor: "mock", resultMetadata: { simulated: true, grounded: false } });
    assert.match(outputProvenance(mock, EVIDENCE_PACK_REVIEW.groundedIn)?.text ?? "", /^Simulated/);
    assert.equal(outputProvenance(mock)?.tone, "warning");
  });

  test("a completed pack never offers the Director hand-off, and the server's reader would refuse it", () => {
    const completed = completedPack();
    assert.equal(offersHandoff(completed), false);
    const refusal = handoffRequest("nexra-agency", completed);
    assert.equal(refusal.ok, false);
    assert.match(refusal.ok ? "" : refusal.why, /takes hand-offs from crawl reviews, on-page reviews, answer-readiness reviews, search query reviews and performance reviews only/);
    for (const status of ["queued", "running", "failed", "cancelled"] as AgentRunStatus[]) {
      assert.equal(offersHandoff(completedPack({ status })), false);
    }
  });

  test("is restored from run history by project alone: the newest Research & Evidence pack, whatever its state", async () => {
    const older = completedPack({ id: "11111111-0000-4000-8000-000000000051", createdAt: "2026-09-21T09:00:00.000Z" });
    const newest = completedPack({ id: "11111111-0000-4000-8000-000000000052", createdAt: "2026-09-21T11:00:00.000Z", status: "queued", executor: null, resultSummary: null, resultMetadata: null });
    const otherAgent = completedPack({ id: "11111111-0000-4000-8000-000000000053", agentId: "project-manager", taskType: "intake-review", createdAt: "2026-09-21T12:00:00.000Z" });
    const withInput = completedPack({ id: "11111111-0000-4000-8000-000000000054", input: { focus: "x" }, createdAt: "2026-09-21T12:00:00.000Z" });

    assert.equal(latestReviewRun([older, otherAgent, newest, withInput], EVIDENCE_PACK_REVIEW, {})?.id, newest.id);
    assert.equal(latestReviewRun([otherAgent, withInput], EVIDENCE_PACK_REVIEW, {}), null);
    // And the intake review, which shares the empty input, never picks up a pack.
    assert.equal(latestReviewRun([older, newest], INTAKE_REVIEW, {}), null);

    const calls: string[] = [];
    const fetchList = async (url: string, init: { cache: "no-store"; signal?: AbortSignal }) => {
      calls.push(url);
      assert.equal(init.cache, "no-store");
      return { ok: true, json: async () => ({ runs: [older, otherAgent, newest] }) };
    };
    const restored = await restoreReviewRun("nexra-agency", EVIDENCE_PACK_REVIEW, {}, fetchList);
    assert.equal(restored?.id, newest.id);
    assert.deepEqual(calls, [`/api/agent-runs?project=nexra-agency&agent=research-evidence&limit=${RESTORE_LIST_LIMIT}`]);
    const completed = await restoreReviewRun("nexra-agency", EVIDENCE_PACK_REVIEW, {}, async () => ({ ok: true, json: async () => ({ runs: [older] }) }));
    assert.ok(completed && hasResult(completed));
    assert.equal(offersHandoff(completed!), false);
  });

  test("the eight existing reviews are untouched by the pack's presence", () => {
    assert.equal(reviewRequest("nexra-agency", CRAWL).ok, true);
    assert.equal(latestReviewRun([completedPack()], CRAWL_REVIEWS["crawl-review"], { crawlId: CRAWL.id }), null);
    assert.equal(latestReviewRun([completedPack()], INTAKE_REVIEW, {}), null);
    assert.equal(latestReviewRun([completedPack()], COMPETITOR_COMPARISON_REVIEW, { competitorDomain: "rival.example" }), null);
    assert.equal(latestReviewRun([completedPack()], PERFORMANCE_REVIEW, { range: "30d" }), null);
    assert.equal(latestReviewRun([completedPack()], PRIORITY_REVIEW, { sourceRunId: RUN.id }), null);
    assert.equal(outputProvenance({ ...RUN, status: "completed", resultSummary: "x", resultMetadata: { simulated: false, grounded: true } })?.text, "Model output, grounded in this crawl's recorded pages. Advice, not measurement.");
  });
});

describe("the content plan request", () => {
  const completedPlan = (overrides: Partial<AgentRun> = {}): AgentRun => ({
    ...RUN,
    id: "11111111-0000-4000-8000-000000000060",
    agentId: "content-strategist",
    taskType: "content-plan-review",
    input: {},
    status: "completed",
    executor: "ai",
    attemptCount: 1,
    resultSummary: "PAGE AND GOAL\n/services, explain what the agency does.",
    resultMetadata: {
      simulated: false,
      grounded: true,
      taskType: "content-plan-review",
      evidence: {
        source: "evidence-pack",
        projectId: "nexra-agency",
        projectHost: "nexraagency.com",
        crawlId: CRAWL.id,
        searchConsole: "included",
        property: "sc-domain:nexraagency.com",
        windowStart: "2026-08-19",
        windowEnd: "2026-09-17",
      },
    },
    createdAt: "2026-09-21T10:05:00.000Z",
    updatedAt: "2026-09-21T10:06:00.000Z",
    startedAt: "2026-09-21T10:05:00.000Z",
    finishedAt: "2026-09-21T10:06:00.000Z",
    ...overrides,
  });

  test("names the Content Strategist and the plan task, with an empty input and nothing else", () => {
    assert.deepEqual(contentPlanRequest("nexra-agency", CRAWL), {
      ok: true,
      payload: { projectId: "nexra-agency", agentId: "content-strategist", taskType: "content-plan-review", input: {} },
    });
  });

  test("is gated on the own-site crawl exactly as the pack is, with plan wording", () => {
    assert.deepEqual(contentPlanRequest(null, CRAWL), { ok: false, why: "No project is selected." });
    const cases: [Crawl | null | undefined, RegExp][] = [
      [undefined, /has not loaded yet/],
      [null, /Run a crawl of this project's own site first: a plan has nothing to rest on/],
      [{ ...CRAWL, status: "running", finishedAt: null }, /still running/],
      [{ ...CRAWL, status: "failed" }, /failed, so there is no recorded page evidence to plan over/],
      [{ ...CRAWL, status: "cancelled" }, /cancelled, so there is no recorded page evidence to plan over/],
    ];
    for (const [crawl, why] of cases) {
      const result = contentPlanRequest("nexra-agency", crawl);
      assert.equal(result.ok, false);
      assert.match(result.ok ? "" : result.why, why);
      assert.equal(evidencePackRequest("nexra-agency", crawl).ok, false, "the pack and the plan gate alike");
    }
  });

  test("the spec matches what the server allows, calls the result a proposal, and reads no earlier output", () => {
    assert.equal(CONTENT_PLAN_REVIEW.agentId, "content-strategist");
    assert.equal(CONTENT_PLAN_REVIEW.taskType, "content-plan-review");
    assert.equal(CONTENT_PLAN_REVIEW.agentName, "Content Strategist");
    assert.equal(CONTENT_PLAN_REVIEW.action, "Create grounded content plan with Content Strategist Agent");
    assert.match(CONTENT_PLAN_REVIEW.summary, /^Queues a read-only plan for one page/);
    assert.match(CONTENT_PLAN_REVIEW.summary, /every unsupported section is marked as needing evidence/);
    assert.match(CONTENT_PLAN_REVIEW.summary, /names no volume, difficulty, ranking or competitor figure, reads no earlier agent's output, and changes nothing/);
    assert.equal(CONTENT_PLAN_REVIEW.groundedIn, "records this product holds for this project — a proposed content plan over that evidence, not a measurement");
    assert.doesNotMatch(CONTENT_PLAN_REVIEW.summary, /succe|analysed|complete|cluster|topical|verified/i);
  });

  test("a server refusal names this agent and task", () => {
    assert.match(queueRefusal(422, { error: "task-not-allowed" }, CONTENT_PLAN_REVIEW), /The Content Strategist agent is not allowed/);
    assert.match(queueRefusal(422, { error: "unknown-task-type" }, CONTENT_PLAN_REVIEW), /does not know the content-plan-review task/);
  });

  test("a grounded plan is described as a proposal over the records it read, naming the crawl and the window, and the pack keeps its own wording", () => {
    const provenance = outputProvenance(completedPlan(), CONTENT_PLAN_REVIEW.groundedIn);
    assert.equal(provenance?.text, "Model output, grounded in records this product holds for this project — a proposed content plan over that evidence, not a measurement. Advice, not measurement.");
    assert.equal(provenance?.tone, "neutral");
    assert.equal(
      outputProvenance(completedPlan())?.text,
      `Model output, grounded in records this product holds for this project: crawl ${CRAWL.id} and Search Console for sc-domain:nexraagency.com, 2026-08-19 to 2026-09-17 (a proposed content plan over that evidence, not a measurement). Advice, not measurement.`,
    );
    assert.equal(
      evidenceDescription({ taskType: "content-plan-review", evidence: { source: "evidence-pack" } }),
      CONTENT_PLAN_REVIEW.groundedIn,
    );
    // The pack's own reading is unchanged.
    assert.equal(
      evidenceDescription({ taskType: "evidence-pack-review", evidence: { source: "evidence-pack", crawlId: CRAWL.id, searchConsole: "not-connected" } }),
      `records this product holds for this project: crawl ${CRAWL.id} (advice organising that evidence, not a new measurement)`,
    );
    assert.equal(evidenceDescription({ evidence: { source: "evidence-pack" } }), EVIDENCE_PACK_REVIEW.groundedIn);
  });

  test("a simulated plan is labelled simulated, before anything else", () => {
    const mock = completedPlan({ executor: "mock", resultMetadata: { simulated: true, grounded: false } });
    assert.match(outputProvenance(mock, CONTENT_PLAN_REVIEW.groundedIn)?.text ?? "", /^Simulated/);
    assert.equal(outputProvenance(mock)?.tone, "warning");
  });

  test("a completed plan never offers the Director hand-off, and the server's reader would refuse it", () => {
    const completed = completedPlan();
    assert.equal(offersHandoff(completed), false);
    const refusal = handoffRequest("nexra-agency", completed);
    assert.equal(refusal.ok, false);
    assert.match(refusal.ok ? "" : refusal.why, /takes hand-offs from crawl reviews, on-page reviews, answer-readiness reviews, search query reviews and performance reviews only/);
    for (const status of ["queued", "running", "failed", "cancelled"] as AgentRunStatus[]) {
      assert.equal(offersHandoff(completedPlan({ status })), false);
    }
  });

  test("is restored by project and agent alone, and the pack, the intake review and the plan never pick up each other's runs", async () => {
    const older = completedPlan({ id: "11111111-0000-4000-8000-000000000061", createdAt: "2026-09-21T09:00:00.000Z" });
    const newest = completedPlan({ id: "11111111-0000-4000-8000-000000000062", createdAt: "2026-09-21T11:00:00.000Z", status: "queued", executor: null, resultSummary: null, resultMetadata: null });
    const pack = completedPlan({ id: "11111111-0000-4000-8000-000000000063", agentId: "research-evidence", taskType: "evidence-pack-review", createdAt: "2026-09-21T12:00:00.000Z" });
    const intake = completedPlan({ id: "11111111-0000-4000-8000-000000000064", agentId: "project-manager", taskType: "intake-review", createdAt: "2026-09-21T12:00:00.000Z" });

    assert.equal(latestReviewRun([older, pack, newest, intake], CONTENT_PLAN_REVIEW, {})?.id, newest.id);
    assert.equal(latestReviewRun([pack, intake], CONTENT_PLAN_REVIEW, {}), null);
    assert.equal(latestReviewRun([older, newest, intake], EVIDENCE_PACK_REVIEW, {}), null);
    assert.equal(latestReviewRun([older, newest, pack], INTAKE_REVIEW, {}), null);

    const calls: string[] = [];
    const fetchList = async (url: string, init: { cache: "no-store"; signal?: AbortSignal }) => {
      calls.push(url);
      assert.equal(init.cache, "no-store");
      return { ok: true, json: async () => ({ runs: [older, pack, newest] }) };
    };
    const restored = await restoreReviewRun("nexra-agency", CONTENT_PLAN_REVIEW, {}, fetchList);
    assert.equal(restored?.id, newest.id);
    assert.deepEqual(calls, [`/api/agent-runs?project=nexra-agency&agent=content-strategist&limit=${RESTORE_LIST_LIMIT}`]);
    const completed = await restoreReviewRun("nexra-agency", CONTENT_PLAN_REVIEW, {}, async () => ({ ok: true, json: async () => ({ runs: [older] }) }));
    assert.ok(completed && hasResult(completed));
    assert.equal(offersHandoff(completed!), false);
  });

  test("the nine existing reviews are untouched by the plan's presence", () => {
    assert.equal(reviewRequest("nexra-agency", CRAWL).ok, true);
    assert.equal(evidencePackRequest("nexra-agency", CRAWL).ok, true);
    assert.equal(latestReviewRun([completedPlan()], CRAWL_REVIEWS["crawl-review"], { crawlId: CRAWL.id }), null);
    assert.equal(latestReviewRun([completedPlan()], EVIDENCE_PACK_REVIEW, {}), null);
    assert.equal(latestReviewRun([completedPlan()], INTAKE_REVIEW, {}), null);
    assert.equal(latestReviewRun([completedPlan()], COMPETITOR_COMPARISON_REVIEW, { competitorDomain: "rival.example" }), null);
    assert.equal(latestReviewRun([completedPlan()], PRIORITY_REVIEW, { sourceRunId: RUN.id }), null);
    assert.equal(outputProvenance({ ...RUN, status: "completed", resultSummary: "x", resultMetadata: { simulated: false, grounded: true } })?.text, "Model output, grounded in this crawl's recorded pages. Advice, not measurement.");
  });
});

describe("the section draft request", () => {
  const plan = (overrides: Partial<AgentRun> = {}): AgentRun => ({
    ...RUN,
    id: "11111111-0000-4000-8000-000000000060",
    agentId: "content-strategist",
    taskType: "content-plan-review",
    input: {},
    status: "completed",
    executor: "ai",
    attemptCount: 1,
    resultSummary: "PAGE AND GOAL\n/services.\n\nOUTLINE\nWhat the agency does [crawl /services]",
    resultMetadata: {
      simulated: false,
      grounded: true,
      taskType: "content-plan-review",
      evidence: { source: "evidence-pack", projectId: "nexra-agency", crawlId: CRAWL.id },
    },
    createdAt: "2026-09-21T10:05:00.000Z",
    finishedAt: "2026-09-21T10:06:00.000Z",
    ...overrides,
  });

  const completedDraft = (overrides: Partial<AgentRun> = {}): AgentRun => ({
    ...RUN,
    id: "11111111-0000-4000-8000-000000000070",
    agentId: "writer",
    taskType: "section-draft",
    input: { planRunId: plan().id, sectionIndex: 0 },
    status: "completed",
    executor: "ai",
    attemptCount: 1,
    resultSummary: "SECTION\nWhat the agency does [crawl /services]\n\nDRAFT\nThe services page states what the agency does.",
    resultMetadata: {
      simulated: false,
      grounded: true,
      taskType: "section-draft",
      evidence: { source: "content-draft", planRunId: plan().id, crawlId: CRAWL.id, section: "What the agency does [crawl /services]" },
    },
    createdAt: "2026-09-21T11:05:00.000Z",
    finishedAt: "2026-09-21T11:06:00.000Z",
    ...overrides,
  });

  test("names the Writer and the draft task, with the plan's id and the chosen section, and nothing else", () => {
    assert.deepEqual(draftRequest("nexra-agency", plan(), 0), {
      ok: true,
      payload: { projectId: "nexra-agency", agentId: "writer", taskType: "section-draft", input: { planRunId: plan().id, sectionIndex: 0 } },
    });
  });

  test("with no section chosen, or one the plan does not support, nothing is chosen for the operator", () => {
    assert.deepEqual(draftRequest("nexra-agency", plan(), null), { ok: false, why: "Choose the outline section of the plan to draft." });
    assert.deepEqual(draftRequest("nexra-agency", plan(), 1), { ok: false, why: "This plan has no outline section at that position." });
    assert.deepEqual(draftRequest("nexra-agency", plan(), -1), { ok: false, why: "That section choice is not a valid outline position." });
    const mixed = plan({ resultSummary: "OUTLINE\nWho the agency has worked with [needs evidence]\nWhat the agency does [crawl /services]" });
    assert.match(draftRequest("nexra-agency", mixed, 0).ok ? "" : (draftRequest("nexra-agency", mixed, 0) as { why: string }).why, /names no record/);
    assert.deepEqual(draftRequest("nexra-agency", mixed, 1).ok, true);
    assert.deepEqual(draftRequest("nexra-agency", plan({ resultSummary: "PAGE AND GOAL\n/services." }), 0), { ok: false, why: "This plan has no outline sections to choose from." });
  });

  test("is refused, with the reader's own reason worded for the operator, for every plan the Writer may not draft from", () => {
    assert.deepEqual(draftRequest(null, plan(), 0), { ok: false, why: "No project is selected." });
    assert.deepEqual(draftRequest("nexra-agency", null, 0), { ok: false, why: "Complete a content plan first: there is nothing to draft from." });
    const cases: [Partial<AgentRun>, RegExp][] = [
      [{ projectId: "halcyon-fintech" }, /belongs to a different project/],
      [{ taskType: "evidence-pack-review", agentId: "research-evidence" }, /drafts from a completed content plan only/],
      [{ status: "queued", resultSummary: null, resultMetadata: null }, /has not finished/],
      [{ status: "running" }, /has not finished/],
      [{ status: "failed" }, /did not complete/],
      [{ status: "cancelled" }, /did not complete/],
      [{ resultSummary: "" }, /stored no result/],
      [{ executor: "mock", resultMetadata: { simulated: true, grounded: false } }, /Simulated output cannot be drafted from/],
      [{ resultMetadata: { simulated: false, grounded: false } }, /not grounded in recorded evidence/],
      [{ resultMetadata: { simulated: false, grounded: true } }, /recorded no crawl it was written over/],
    ];
    for (const [overrides, why] of cases) {
      const result = draftRequest("nexra-agency", plan(overrides), 0);
      assert.equal(result.ok, false, JSON.stringify(overrides));
      assert.match(result.ok ? "" : result.why, why, JSON.stringify(overrides));
    }
  });

  test("the control belongs under a completed plan and nowhere else", () => {
    assert.equal(offersDraft(plan()), true);
    for (const status of ["queued", "running", "failed", "cancelled"] as AgentRunStatus[]) assert.equal(offersDraft(plan({ status })), false);
    assert.equal(offersDraft(completedDraft()), false, "a draft never offers a further draft");
    assert.equal(offersDraft({ ...RUN, status: "completed" }), false);
    assert.equal(offersDraft(plan({ taskType: "evidence-pack-review", agentId: "research-evidence" })), false);
    // A completed plan offers the Writer, never the Director; a simulated plan still shows the control, which then refuses with the reason.
    assert.equal(offersHandoff(plan()), false);
    assert.equal(draftRequest("nexra-agency", plan({ executor: "mock", resultMetadata: { simulated: true, grounded: false } }), 0).ok, false);
  });

  test("the spec matches what the server allows, calls the plan a proposal, and promises no publishing", () => {
    assert.equal(SECTION_DRAFT.agentId, "writer");
    assert.equal(SECTION_DRAFT.taskType, "section-draft");
    assert.equal(SECTION_DRAFT.agentName, "Writer");
    assert.equal(SECTION_DRAFT.action, "Draft one section with Writer Agent");
    assert.match(SECTION_DRAFT.summary, /^Queues a draft of the one outline section you choose/);
    assert.match(SECTION_DRAFT.summary, /drafts that section only/);
    assert.doesNotMatch(SECTION_DRAFT.summary, /first outline section/);
    assert.match(SECTION_DRAFT.summary, /as a proposal — never as evidence/);
    assert.match(SECTION_DRAFT.summary, /it is not published, not approved, and changes nothing/);
    assert.match(SECTION_DRAFT.groundedIn, /a draft for operator review, not a measurement and not published/);
    assert.doesNotMatch(SECTION_DRAFT.summary, /succe|analysed|complete\b|publish it|approved draft|final/i);
  });

  test("a server refusal names this agent and task", () => {
    assert.match(queueRefusal(422, { error: "task-not-allowed" }, SECTION_DRAFT), /The Writer agent is not allowed/);
    assert.match(queueRefusal(422, { error: "unknown-task-type" }, SECTION_DRAFT), /does not know the section-draft task/);
  });

  test("a grounded draft is described by the plan and the records it rests on, and is still a draft", () => {
    const provenance = outputProvenance(completedDraft(), SECTION_DRAFT.groundedIn);
    assert.equal(provenance?.text, "Model output, grounded in a completed content plan (a proposal) and the records it was written over — a draft for operator review, not a measurement and not published. Advice, not measurement.");
    assert.equal(provenance?.tone, "neutral");
    assert.equal(
      outputProvenance(completedDraft())?.text,
      `Model output, grounded in the Content Strategist's completed plan (run ${plan().id}, a proposal) and the records it was written over, re-read: crawl ${CRAWL.id} (a draft for operator review, not a measurement and not published). Advice, not measurement.`,
    );
    assert.equal(evidenceDescription({ evidence: { source: "content-draft" } }), SECTION_DRAFT.groundedIn);
    const mock = completedDraft({ executor: "mock", resultMetadata: { simulated: true, grounded: false } });
    assert.match(outputProvenance(mock, SECTION_DRAFT.groundedIn)?.text ?? "", /^Simulated/);
  });

  test("a completed draft never offers the Director hand-off, and the server's reader would refuse it", () => {
    const completed = completedDraft();
    assert.equal(offersHandoff(completed), false);
    const refusal = handoffRequest("nexra-agency", completed);
    assert.equal(refusal.ok, false);
    assert.match(refusal.ok ? "" : refusal.why, /takes hand-offs from crawl reviews, on-page reviews, answer-readiness reviews, search query reviews and performance reviews only/);
  });

  test("is restored by project, agent, plan id and section: the newest draft of this plan's section, never another section's, another plan's, the plan itself, or the pack", async () => {
    const older = completedDraft({ id: "11111111-0000-4000-8000-000000000071", createdAt: "2026-09-21T09:00:00.000Z" });
    const newest = completedDraft({ id: "11111111-0000-4000-8000-000000000072", createdAt: "2026-09-21T12:00:00.000Z", status: "queued", executor: null, resultSummary: null, resultMetadata: null });
    const otherPlan = completedDraft({ id: "11111111-0000-4000-8000-000000000073", input: { planRunId: "11111111-0000-4000-8000-000000000061", sectionIndex: 0 }, createdAt: "2026-09-21T13:00:00.000Z" });
    const otherSection = completedDraft({ id: "11111111-0000-4000-8000-000000000074", input: { planRunId: plan().id, sectionIndex: 2 }, createdAt: "2026-09-21T14:00:00.000Z" });
    const input = { planRunId: plan().id, sectionIndex: 0 };
    assert.equal(latestReviewRun([older, otherPlan, otherSection, newest, plan()], SECTION_DRAFT, input)?.id, newest.id);
    assert.equal(latestReviewRun([otherSection], SECTION_DRAFT, input), null, "another section's draft is never restored for this one");
    assert.equal(latestReviewRun([otherPlan, plan()], SECTION_DRAFT, input), null);
    assert.equal(latestReviewRun([older, newest], PRIORITY_REVIEW, { sourceRunId: plan().id }), null);
    assert.equal(latestReviewRun([older, newest], EVIDENCE_PACK_REVIEW, {}), null);

    const calls: string[] = [];
    const restored = await restoreReviewRun("nexra-agency", SECTION_DRAFT, input, async (url, init) => {
      calls.push(url);
      assert.equal(init.cache, "no-store");
      return { ok: true, json: async () => ({ runs: [older, otherPlan, newest] }) };
    });
    assert.equal(restored?.id, newest.id);
    assert.deepEqual(calls, [`/api/agent-runs?project=nexra-agency&agent=writer&limit=${RESTORE_LIST_LIMIT}`]);
  });

  test("the ten existing reviews are untouched by the draft's presence", () => {
    assert.equal(reviewRequest("nexra-agency", CRAWL).ok, true);
    assert.equal(evidencePackRequest("nexra-agency", CRAWL).ok, true);
    assert.equal(latestReviewRun([completedDraft()], CRAWL_REVIEWS["crawl-review"], { crawlId: CRAWL.id }), null);
    assert.equal(latestReviewRun([completedDraft()], PRIORITY_REVIEW, { sourceRunId: RUN.id }), null);
    assert.equal(latestReviewRun([completedDraft()], INTAKE_REVIEW, {}), null);
    assert.equal(outputProvenance({ ...RUN, status: "completed", resultSummary: "x", resultMetadata: { simulated: false, grounded: true } })?.text, "Model output, grounded in this crawl's recorded pages. Advice, not measurement.");
  });
});

// ---------------------------------------------------------------------------
// The Authority & Backlink agent's outbound link review: the same crawl, the
// same request, its own agent, and wording that never calls an outbound link
// a backlink.
// ---------------------------------------------------------------------------

describe("the outbound link review — the Authority & Backlink agent", () => {
  const spec = OUTBOUND_LINK_REVIEW;
  const LINK_RUN_ID = "11111111-0000-4000-8000-000000000080";

  function completedLinkReview(overrides: Partial<AgentRun> = {}): AgentRun {
    return {
      ...RUN,
      id: LINK_RUN_ID,
      agentId: "authority-backlink",
      taskType: "outbound-link-review",
      input: { crawlId: CRAWL.id },
      status: "completed",
      executor: "ai",
      attemptCount: 1,
      resultSummary: "LINK RECORD\nCrawl of nexraagency.com, five pages fetched.\n\nOUTBOUND HOSTS\nnone recorded",
      resultMetadata: {
        simulated: false,
        grounded: true,
        taskType: "outbound-link-review",
        evidence: { source: "crawl-links", crawlId: CRAWL.id, hostScope: "nexraagency.com", externalEdges: 3, externalHosts: 2 },
      },
      startedAt: "2026-09-21T10:05:00.000Z",
      finishedAt: "2026-09-21T10:06:00.000Z",
      createdAt: "2026-09-21T10:04:00.000Z",
      ...overrides,
    };
  }

  test("asks for the Authority agent's task over the crawl on screen, and nothing else", () => {
    assert.deepEqual(reviewRequest("nexra-agency", CRAWL, spec), {
      ok: true,
      payload: {
        projectId: "nexra-agency",
        agentId: "authority-backlink",
        taskType: "outbound-link-review",
        input: { crawlId: CRAWL.id },
      },
    });
  });

  test("the spec matches what the server allows, says what it reads, and says what does not exist", () => {
    assert.equal(spec.agentId, "authority-backlink");
    assert.equal(spec.taskType, "outbound-link-review");
    assert.equal(spec.agentName, "Authority & Backlink");
    assert.equal(spec.action, "Review outbound links with Authority Agent");
    assert.match(spec.summary, /^Queues a read-only review of the outbound links this crawl recorded on the project's own pages/);
    assert.match(spec.summary, /fetches no host, contacts no one/);
    assert.match(spec.summary, /no inbound backlink, referring domain or authority record to read, because this product holds none/);
    assert.match(spec.summary, /changes nothing\.$/);
    assert.match(spec.groundedIn, /what the project's own pages link to, never who links to them; no inbound backlink record exists$/);
    assert.doesNotMatch(spec.summary, /backlink profile|referring domains found|authority score|outreach|prospect/i);
  });

  test("is refused for the same crawls the crawl reviews are refused for", () => {
    assert.deepEqual(reviewRequest("", CRAWL, spec), { ok: false, why: "No project is selected." });
    assert.deepEqual(reviewRequest("nexra-agency", null, spec), { ok: false, why: "Run a crawl first: there is nothing to review." });
    assert.equal(reviewRequest("nexra-agency", { ...CRAWL, status: "running" }, spec).ok, false);
    assert.equal(reviewRequest("nexra-agency", { ...CRAWL, status: "failed" }, spec).ok, false);
    assert.equal(reviewRequest("nexra-agency", { ...CRAWL, status: "cancelled" }, spec).ok, false);
    for (const status of ["completed", "partial"] as const) {
      assert.equal(reviewRequest("nexra-agency", { ...CRAWL, status }, spec).ok, true);
    }
  });

  test("a server refusal is explained with this agent's name and task", () => {
    assert.match(queueRefusal(422, { error: "task-not-allowed" }, spec), /The Authority & Backlink agent is not allowed/);
    assert.match(queueRefusal(422, { error: "unknown-task-type" }, spec), /does not know the outbound-link-review task/);
  });

  test("a grounded review is described by what it read, outbound and never inbound", () => {
    assert.equal(
      outputProvenance(completedLinkReview(), spec.groundedIn)?.text,
      `Model output, grounded in ${spec.groundedIn}. Advice, not measurement.`,
    );
    assert.equal(
      outputProvenance(completedLinkReview())?.text,
      `Model output, grounded in this crawl's recorded outbound links (crawl ${CRAWL.id}: 3 external edges to 2 hosts, observed on the project's own pages and never fetched; no inbound backlink record exists). Advice, not measurement.`,
    );
    assert.equal(outputProvenance(completedLinkReview())?.tone, "neutral");
    assert.equal(
      evidenceDescription({ evidence: { source: "crawl-links", crawlId: CRAWL.id, externalEdges: 1, externalHosts: 1 } }),
      `this crawl's recorded outbound links (crawl ${CRAWL.id}: 1 external edge to 1 host, observed on the project's own pages and never fetched; no inbound backlink record exists)`,
    );
    assert.equal(evidenceDescription({ evidence: { source: "crawl-links" } }), spec.groundedIn);
    assert.equal(evidenceDescription({ evidence: { source: "crawl-links", crawlId: CRAWL.id } }), spec.groundedIn);
    const mock = completedLinkReview({ executor: "mock", resultMetadata: { simulated: true, grounded: false } });
    assert.match(outputProvenance(mock, spec.groundedIn)?.text ?? "", /^Simulated/);
  });

  test("a completed outbound link review offers no Director hand-off and no Writer draft", () => {
    const completed = completedLinkReview();
    assert.equal(offersHandoff(completed), false);
    assert.equal(offersDraft(completed), false);
    const refusal = handoffRequest("nexra-agency", completed);
    assert.equal(refusal.ok, false);
    assert.match(refusal.ok ? "" : refusal.why, /takes hand-offs from crawl reviews, on-page reviews, answer-readiness reviews, search query reviews and performance reviews only/);
  });

  test("is restored by project, the Authority agent and this crawl's id, and by nothing else", async () => {
    assert.equal(reviewRunsUrl("nexra-agency", spec), `/api/agent-runs?project=nexra-agency&agent=authority-backlink&limit=${RESTORE_LIST_LIMIT}`);
    const older = completedLinkReview({ id: "11111111-0000-4000-8000-000000000081", createdAt: "2026-09-21T09:00:00.000Z" });
    const newest = completedLinkReview({ id: "11111111-0000-4000-8000-000000000082", createdAt: "2026-09-21T12:00:00.000Z" });
    const otherCrawl = completedLinkReview({ id: "11111111-0000-4000-8000-000000000083", input: { crawlId: "8f1c0d2e-0000-4000-8000-000000000002" }, createdAt: "2026-09-21T13:00:00.000Z" });
    const technical: AgentRun = { ...RUN, status: "completed", createdAt: "2026-09-21T14:00:00.000Z" };
    const input = { crawlId: CRAWL.id };
    assert.equal(latestReviewRun([older, otherCrawl, technical, newest], spec, input)?.id, newest.id);
    assert.equal(latestReviewRun([otherCrawl, technical], spec, input), null);
    assert.equal(latestReviewRun([older, newest], CRAWL_REVIEWS["crawl-review"], input), null);
    assert.equal(latestReviewRun([older, newest], CRAWL_REVIEWS["on-page-review"], input), null);

    const calls: string[] = [];
    const restored = await restoreReviewRun("nexra-agency", spec, input, async (url, init) => {
      calls.push(url);
      assert.equal(init.cache, "no-store");
      return { ok: true, json: async () => ({ runs: [older, technical, newest] }) };
    });
    assert.equal(restored?.id, newest.id);
    assert.deepEqual(calls, [`/api/agent-runs?project=nexra-agency&agent=authority-backlink&limit=${RESTORE_LIST_LIMIT}`]);
  });

  test("the three crawl reviews are untouched by it", () => {
    const kinds = ["crawl-review", "on-page-review", "answer-readiness-review"] as const;
    assert.equal(new Set(kinds.map((kind) => CRAWL_REVIEWS[kind].agentId)).size, 3);
    assert.ok(!Object.values(CRAWL_REVIEWS).some((review) => review.taskType === spec.taskType));
    assert.equal(reviewRequest("nexra-agency", CRAWL).ok, true);
    assert.equal(latestReviewRun([completedLinkReview()], CRAWL_REVIEWS["crawl-review"], { crawlId: CRAWL.id }), null);
    assert.equal(latestReviewRun([completedLinkReview()], PRIORITY_REVIEW, { sourceRunId: LINK_RUN_ID }), null);
    assert.equal(outputProvenance({ ...RUN, status: "completed", resultSummary: "x", resultMetadata: { simulated: false, grounded: true } })?.text, "Model output, grounded in this crawl's recorded pages. Advice, not measurement.");
  });
});

import * as factCheck from "./review-request.ts";

/**
 * Stage 3: the fact-check review of one saved draft version, queued through
 * the same control as every other review.
 */
describe("the draft fact-check review", () => {
  const DRAFT = { id: "00000000-0000-4000-8000-0000000000d1", status: "drafting", currentVersion: 2 };
  const V2 = { version: 2, factCheck: null };

  test("names the Research & Evidence agent's draft-fact-check task and says what the check is and is not", () => {
    const spec = factCheck.DRAFT_FACT_CHECK;
    assert.equal(spec.taskType, "draft-fact-check");
    assert.equal(spec.agentId, "research-evidence");
    assert.equal(spec.agentName, "Research & Evidence");
    assert.equal(spec.action, "Run fact-check with Research & Evidence Agent");
    assert.match(spec.summary, /this exact version/);
    assert.match(spec.summary, /never as evidence/);
    assert.match(spec.summary, /Absence from the records is reported as absence, never as falsehood/);
    assert.match(spec.summary, /approves nothing and publishes nothing; recording its result on the version is a separate click/);
    assert.match(spec.groundedIn, /not a measurement, and not an approval/);
  });

  test("is offered for the current version of a live, unchecked draft, and refuses with a reason otherwise", () => {
    assert.deepEqual(factCheck.factCheckRequest("nexra-agency", DRAFT, V2), {
      ok: true,
      payload: { projectId: "nexra-agency", agentId: "research-evidence", taskType: "draft-fact-check", input: { draftId: DRAFT.id, version: 2 } },
    });
    const refused = (request: ReturnType<typeof factCheck.factCheckRequest>) => (request.ok ? null : request.why);
    assert.equal(refused(factCheck.factCheckRequest(null, DRAFT, V2)), "No project is selected.");
    assert.equal(refused(factCheck.factCheckRequest("nexra-agency", null, V2)), "Save a draft first: there is nothing to check.");
    assert.equal(refused(factCheck.factCheckRequest("nexra-agency", { ...DRAFT, status: "archived" }, V2)), "This draft is archived, so it is not checked.");
    assert.equal(refused(factCheck.factCheckRequest("nexra-agency", DRAFT, { version: 2, factCheck: { status: "passed" } })), "This version already carries a fact-check; a version is checked once.");
    assert.equal(refused(factCheck.factCheckRequest("nexra-agency", DRAFT, { version: 1, factCheck: null })), "Only the current version can be checked; version 2 is current.");
  });

  test("a stored fact-check run is restored for exactly its draft and version, and its provenance line names the version checked", () => {
    const run = {
      ...RUN,
      agentId: "research-evidence",
      taskType: "draft-fact-check",
      input: { draftId: DRAFT.id, version: 2 },
      status: "completed",
      resultSummary: "SUPPORTED\nnone",
      resultMetadata: { simulated: false, grounded: true, evidence: { source: "draft-version", draftId: DRAFT.id, version: 2, crawlId: "8f1c0d2e-0000-4000-8000-000000000001" } },
    } as unknown as AgentRun;
    assert.equal(factCheck.latestReviewRun([run], factCheck.DRAFT_FACT_CHECK, { draftId: DRAFT.id, version: 2 }), run);
    assert.equal(factCheck.latestReviewRun([run], factCheck.DRAFT_FACT_CHECK, { draftId: DRAFT.id, version: 1 }), null, "a check of version 2 was restored for version 1");
    assert.equal(factCheck.latestReviewRun([run], factCheck.DRAFT_FACT_CHECK, { draftId: "00000000-0000-4000-8000-0000000000d2", version: 2 }), null);
    assert.equal(
      factCheck.evidenceDescription(run.resultMetadata!),
      `one saved draft version (draft ${DRAFT.id}, version 2, the thing under check) and the records this product holds, re-read: crawl 8f1c0d2e-0000-4000-8000-000000000001 (a check for operator review, not a measurement, and not an approval)`,
    );
    const provenance = factCheck.outputProvenance(run, factCheck.DRAFT_FACT_CHECK.groundedIn);
    assert.match(provenance?.text ?? "", /^Model output, grounded in one saved draft version \(the thing under check\)/);
    assert.match(provenance?.text ?? "", /Advice, not measurement\.$/);
    // A completed fact-check is never itself a hand-off or draft source.
    assert.equal(factCheck.offersHandoff(run), false);
    assert.equal(factCheck.offersDraft(run), false);
  });
});

describe("the SEO Director's project review request (M5)", () => {
  const selected = { slot: { taskType: "crawl-review" as const, agentId: "technical-seo" as const }, status: "selected" as const, run: RUN, newerIneligible: 0, scanned: 1 };
  const missing = { slot: { taskType: "on-page-review" as const, agentId: "on-page-seo" as const }, status: "missing" as const, reason: "no-run" as const, scanned: 0 };

  test("names the SEO Director, the project task, and no input at all", () => {
    assert.deepEqual(projectDirectorRequest("nexra-agency", [selected, missing]), {
      ok: true,
      payload: { projectId: "nexra-agency", agentId: "seo-director", taskType: "project-priority-review", input: {} },
    });
    assert.equal(PROJECT_PRIORITY_REVIEW.agentId, "seo-director");
    assert.equal(PROJECT_PRIORITY_REVIEW.taskType, "project-priority-review");
    assert.equal(PROJECT_PRIORITY_REVIEW.action, "Run project Director review");
    assert.match(PROJECT_PRIORITY_REVIEW.summary, /chosen by fixed rules on the server/);
    assert.match(PROJECT_PRIORITY_REVIEW.summary, /not the crawls or reports themselves/);
    assert.match(PROJECT_PRIORITY_REVIEW.summary, /It assigns nothing and changes nothing\./);
  });

  test("is not offered without a project, before the listing loads, or when no supported review is eligible", () => {
    assert.deepEqual(projectDirectorRequest(null, [selected]), { ok: false, why: "No project is selected." });
    assert.deepEqual(projectDirectorRequest("nexra-agency", undefined), { ok: false, why: "The project's run history has not loaded yet." });
    const none = projectDirectorRequest("nexra-agency", [missing, { ...missing, slot: { taskType: "search-query-review", agentId: "keyword-intent" }, reason: "no-eligible-run", scanned: 3 }]);
    assert.equal(none.ok, false);
    if (none.ok) return;
    assert.match(none.why, /No completed, grounded specialist review exists for this project yet\. Run a Technical SEO, On-Page SEO or Keyword & Search Intent review first/);
  });

  test("its completed result is never a hand-off source and offers no further Director control", () => {
    const completed: AgentRun = { ...RUN, agentId: "seo-director", taskType: "project-priority-review", input: {}, status: "completed", executor: "ai", resultSummary: "PRIORITY 1 …" };
    assert.equal(offersHandoff(completed), false);
    assert.equal(handoffRequest("nexra-agency", completed).ok, false);
  });

  test("the provenance line names how many supported reviews it read, which runs, which are missing, and calls both layers advice", () => {
    const completed: AgentRun = {
      ...RUN,
      agentId: "seo-director",
      taskType: "project-priority-review",
      input: {},
      status: "completed",
      executor: "ai",
      resultSummary: "PRIORITY 1 …",
      resultMetadata: {
        simulated: false,
        grounded: true,
        evidence: {
          source: "agent-runs",
          slots: 3,
          selected: 2,
          missing: 1,
          sources: [
            { taskType: "crawl-review", agentId: "technical-seo", status: "selected", runId: "11111111-0000-4000-8000-000000000001" },
            { taskType: "on-page-review", agentId: "on-page-seo", status: "missing", runId: null },
            { taskType: "search-query-review", agentId: "keyword-intent", status: "selected", runId: "11111111-0000-4000-8000-000000000003" },
          ],
          recordedFindings: [{ crawlId: CRAWL.id, status: "recorded" }],
        },
      },
    };
    const provenance = outputProvenance(completed, PROJECT_PRIORITY_REVIEW.groundedIn);
    assert.equal(provenance?.tone, "neutral");
    assert.equal(
      provenance?.text,
      "Model output by the SEO Director over 2 of 5 supported specialist reviews: Technical SEO (run 11111111-0000-4000-8000-000000000001), Keyword & Search Intent (run 11111111-0000-4000-8000-000000000003). Missing: On-Page SEO. Each review was itself model-generated over evidence the Director did not see; recorded crawl findings were read for 1 crawl(s). Two layers of advice, not measurement.",
    );
    // A stored summary of another shape falls through to the ordinary grounded wording, never to the bundle's.
    assert.match(outputProvenance({ ...completed, resultMetadata: { simulated: false, grounded: true, evidence: { source: "agent-runs" } } })?.text ?? "", /over 0 of 5 supported specialist reviews\./);
  });
});
