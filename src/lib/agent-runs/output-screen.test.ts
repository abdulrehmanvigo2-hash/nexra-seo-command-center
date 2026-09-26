import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AgentRun, AgentRunAttempt, JsonObject } from "../../types/agent-run.ts";
import type { ProjectRecord } from "../../types/project.ts";
import type { AgentRunStore, AttemptLease, AttemptResult, ClaimRequest } from "./contract.ts";
import { createAiExecutor } from "./ai-executor.ts";
import type { AgentExecutor, ExecutionOutput } from "./executor.ts";
import { createTaskGrounding, type TaskGroundingReaders } from "./task-grounding.ts";
import { createAgentRunWorker } from "./worker.ts";

/**
 * What the worker keeps of an executor's answer, and what it refuses.
 *
 * A live answer-readiness review was refused as `rejected-output`. The refused
 * text is never stored or logged, by design, so the failure has to be
 * reproduced here through the real worker against an in-memory store: an
 * executor that answers with a given output, a store that records what the
 * worker decided, and an assertion on the run that comes back. Every case
 * runs the real `screenOutput`, the real lease handling, and the real task
 * and agent lookups; only the provider is replaced.
 *
 * The screen itself is deliberately not exported for testing. Driving the
 * worker is the honest test, because it proves that a refusal reaches the
 * run record as a failure and that the executor was asked exactly once.
 */

const PROJECT: ProjectRecord = {
  id: "nexra-agency",
  name: "Nexra Agency",
  client: "Nexra",
  domain: "nexraagency.com",
  initials: "NA",
  industry: "Marketing",
  type: "lead-gen",
  status: "active",
  goal: "leads",
  market: "United States",
  language: "English (US)",
  targetLocation: "United States",
  startedAt: "2026-09-01",
  updatedAt: "2026-09-01T00:00:00.000Z",
  summary: "The agency's own site.",
};

const CRAWL_ID = "8f1c0d2e-0000-4000-8000-000000000001";
const RUN_ID = "11111111-0000-4000-8000-000000000007";

function queuedRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: RUN_ID,
    projectId: PROJECT.id,
    agentId: "ai-visibility",
    taskType: "answer-readiness-review",
    input: { crawlId: CRAWL_ID },
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
    createdAt: "2026-09-21T10:00:00.000Z",
    updatedAt: "2026-09-21T10:00:00.000Z",
    startedAt: null,
    finishedAt: null,
    nextAttemptAt: null,
    autoRetryCount: 0,
    ...overrides,
  };
}

/**
 * Enough of the store for one attempt: claim, heartbeat, finish. It records
 * what the worker asked it to write, and everything else rejects loudly.
 */
function memoryStore(initial: AgentRun) {
  let run = initial;
  const finishes: AttemptResult[] = [];
  const notHere = (what: string) => () => Promise.reject(new Error(`${what} is not part of one attempt`));

  const store: AgentRunStore = {
    storesRuns: true,
    async getById(id) {
      return id === run.id ? run : null;
    },
    async claim(request: ClaimRequest) {
      if (request.runId !== run.id) return { status: "not-found" };
      if (run.status !== "queued") return { status: "not-queued", run };
      run = { ...run, status: "running", executor: request.executor, attemptCount: run.attemptCount + 1, startedAt: "2026-09-21T10:01:00.000Z" };
      const lease: AttemptLease = {
        runId: run.id,
        attemptId: "attempt-1",
        attemptNumber: run.attemptCount,
        token: "lease-token",
        expiresAt: "2999-01-01T00:00:00.000Z",
      };
      return { status: "claimed", run, lease };
    },
    async heartbeat() {
      return { status: "renewed", expiresAt: "2999-01-01T00:00:00.000Z" };
    },
    async finish(_lease, result) {
      finishes.push(result);
      run =
        result.outcome === "completed"
          ? { ...run, status: "completed", resultSummary: result.summary, resultMetadata: result.metadata, error: null, finishedAt: "2026-09-21T10:02:00.000Z" }
          : { ...run, status: "failed", error: result.error, finishedAt: "2026-09-21T10:02:00.000Z" };
      return { status: "finished", run };
    },
    insert: notHere("insert"),
    findActiveDuplicate: notHere("findActiveDuplicate"),
    listRuns: notHere("listRuns"),
    transition: notHere("transition"),
    recoverExpired: notHere("recoverExpired"),
    listAttempts: async () => [] as readonly AgentRunAttempt[],
    scheduleRetries: notHere("scheduleRetries"),
    runtimeStatus: notHere("runtimeStatus"),
  };
  return { store, finishes, current: () => run };
}

/** An executor standing in for the model: answers once with whatever it is given. */
function answering(output: ExecutionOutput): { executor: AgentExecutor; calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    executor: {
      id: "ai",
      async execute() {
        calls += 1;
        return output;
      },
    },
  };
}

const GROUNDED_METADATA: JsonObject = {
  simulated: false,
  grounded: true,
  evidence: { crawlId: CRAWL_ID, hostScope: "nexraagency.com", pagesFetched: 5, pagesIncluded: 5, pagesNotReached: 2 },
  taskType: "answer-readiness-review",
  attempt: 1,
  provider: "anthropic",
  model: "test-model",
  inputTokens: 3_000,
  outputTokens: 600,
};

async function runOnce(output: ExecutionOutput) {
  const { store, finishes, current } = memoryStore(queuedRun());
  const stub = answering(output);
  const worker = createAgentRunWorker({
    store,
    executor: stub.executor,
    projects: { getProjectById: async (id) => (id === PROJECT.id ? PROJECT : null) },
    timeoutMs: 5_000,
  });
  const outcome = await worker.executeRun(RUN_ID);
  return { outcome, finishes, run: current(), executorCalls: stub.calls() };
}

/** An answer of the shape the answer-readiness instructions demand, at their bounds. */
const READINESS_ANSWER = [
  'OBSERVED: https://nexraagency.com/services declares one JSON-LD block of type Organization, one h1 "Services", title "Services", a 21-character meta description, a self-pointing canonical, and no robots meta directive.',
  "INFERENCE: the page is typed as an organisation rather than as the service it describes, so an engine has no declared answer type to retrieve; medium confidence.",
  "RECOMMENDATION: add a Service type alongside Organization and widen the description to state the answer.",
  "",
  "One further fetched page was not covered in this answer.",
  "https://nexraagency.com/services most limits its readiness: its only type is Organization.",
  "Not established by this crawl: AI crawler access, citations, mention share, answer-engine visibility, body text, entity coverage.",
].join("\n");

describe("the worker's output screen, driven through a real attempt", () => {
  test("a valid answer-readiness review is kept: the run completes with the summary and its grounded metadata", async () => {
    const { outcome, finishes, run, executorCalls } = await runOnce({ summary: READINESS_ANSWER, metadata: GROUNDED_METADATA });

    assert.equal(outcome.status, "executed");
    assert.equal(executorCalls, 1);
    assert.equal(finishes.length, 1);
    assert.equal(finishes[0]?.outcome, "completed");
    assert.equal(run.status, "completed");
    assert.equal(run.resultSummary, READINESS_ANSWER);
    assert.deepEqual(run.resultMetadata, GROUNDED_METADATA);
    assert.equal(run.error, null);
  });

  test("the failure class seen live: an answer over 2,000 characters is refused as rejected-output after one executor call", async () => {
    // Seven findings in the old, unbounded shape — what an eight-page crawl
    // invited before the instructions were bounded.
    const finding = (n: number) =>
      [
        `OBSERVED: https://nexraagency.com/page-${n} declares no structured data, one h1, a title of 40 characters, a meta description of 150 characters, a self-pointing canonical, and no robots meta directive.`,
        "INFERENCE: without a declared type an answer engine has nothing to retrieve the page as, and AI crawler access is not in the evidence, so whether any engine could fetch it at all is unknown; low confidence.",
        "RECOMMENDATION: add JSON-LD of the type that matches the page and have a person check the robots.txt rules for AI crawlers, which this crawl did not read.",
      ].join("\n");
    const overlong = Array.from({ length: 7 }, (_, index) => finding(index + 1)).join("\n\n");
    assert.ok(overlong.length > 2_000, `fixture is only ${overlong.length} characters`);

    const { finishes, run, executorCalls } = await runOnce({ summary: overlong, metadata: GROUNDED_METADATA });

    assert.equal(executorCalls, 1, "the worker asked the executor more than once");
    assert.equal(finishes.length, 1);
    assert.equal(finishes[0]?.outcome, "failed");
    assert.equal(run.status, "failed");
    assert.equal(run.error?.code, "rejected-output");
    assert.match(run.error?.message ?? "", /too large or looked like it contained a credential/);
    // Nothing of the refused text reaches the record.
    assert.equal(run.resultSummary, null);
    assert.equal(run.resultMetadata, null);
  });

  test("exactly 2,000 characters is kept and 2,001 is refused: the ceiling is the one documented", async () => {
    const base = "OBSERVED: https://nexraagency.com/services declares one h1. INFERENCE: fine. RECOMMENDATION: none. ";
    const atCeiling = base.repeat(Math.ceil(2_000 / base.length)).slice(0, 2_000);
    const overCeiling = `${atCeiling}x`;
    assert.equal(atCeiling.length, 2_000);
    assert.equal(overCeiling.length, 2_001);

    const kept = await runOnce({ summary: atCeiling, metadata: GROUNDED_METADATA });
    assert.equal(kept.run.status, "completed");

    const refused = await runOnce({ summary: overCeiling, metadata: GROUNDED_METADATA });
    assert.equal(refused.run.status, "failed");
    assert.equal(refused.run.error?.code, "rejected-output");
  });

  test("credential-like content is still refused, whatever the task", async () => {
    const leaks = [
      `${READINESS_ANSWER}\nAlso seen: sk-abcdefghijklmnopqrstuvwxyz0123456789`,
      `${READINESS_ANSWER}\nToken: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U`,
      `${READINESS_ANSWER}\napi_key: 0123456789abcdef`,
    ];
    for (const summary of leaks) {
      const { run, executorCalls } = await runOnce({ summary, metadata: GROUNDED_METADATA });
      assert.equal(executorCalls, 1);
      assert.equal(run.status, "failed");
      assert.equal(run.error?.code, "rejected-output");
      assert.equal(run.resultSummary, null);
    }
  });

  test("the screen is the same for every task: a crawl review over the ceiling is refused too, and a short one is kept", async () => {
    const technical = async (summary: string) => {
      const { store, current } = memoryStore(queuedRun({ agentId: "technical-seo", taskType: "crawl-review" }));
      const stub = answering({ summary, metadata: { ...GROUNDED_METADATA, taskType: "crawl-review" } });
      const worker = createAgentRunWorker({
        store,
        executor: stub.executor,
        projects: { getProjectById: async (id) => (id === PROJECT.id ? PROJECT : null) },
        timeoutMs: 5_000,
      });
      await worker.executeRun(RUN_ID);
      return current();
    };
    assert.equal((await technical("OBSERVED: https://nexraagency.com/ returned 200. INFERENCE: reachable. RECOMMENDATION: none.")).status, "completed");
    const refused = await technical("x".repeat(2_001));
    assert.equal(refused.status, "failed");
    assert.equal(refused.error?.code, "rejected-output");
  });

  test("metadata that cannot be stored is refused as rejected-output as well, with the summary dropped", async () => {
    const tooLarge: JsonObject = { ...GROUNDED_METADATA, padding: "p".repeat(9_000) };
    const { run } = await runOnce({ summary: READINESS_ANSWER, metadata: tooLarge });
    assert.equal(run.status, "failed");
    assert.equal(run.error?.code, "rejected-output");
    assert.equal(run.resultSummary, null);
  });

  test("a control character in the answer is refused, a newline or tab is not", async () => {
    const withTab = READINESS_ANSWER.replace("INFERENCE:", "\tINFERENCE:");
    assert.equal((await runOnce({ summary: withTab, metadata: GROUNDED_METADATA })).run.status, "completed");
    const withBell = `${READINESS_ANSWER}\u0007`;
    const refused = await runOnce({ summary: withBell, metadata: GROUNDED_METADATA });
    assert.equal(refused.run.error?.code, "rejected-output");
  });
});

// ---------------------------------------------------------------------------
// The competitor comparison review, through the same screen
// ---------------------------------------------------------------------------

/**
 * The first live competitor comparison was refused as `rejected-output`. As
 * with the answer-readiness review before it, the refused text is never
 * stored, so the failure class is reproduced here: an answer in the
 * pre-bound shape — five pages per side, each cited by full URL, three
 * sections of comparison — through the real worker, beside an answer at
 * every bound the corrected instructions set. The screen itself is
 * untouched: the same ceiling, the same credential patterns, the same
 * metadata rules, for every task.
 */

const COMPARISON_METADATA: JsonObject = {
  simulated: false,
  grounded: true,
  evidence: {
    source: "competitor-comparison",
    projectId: PROJECT.id,
    projectHost: "nexraagency.com",
    projectCrawlId: CRAWL_ID,
    projectCrawlStatus: "partial",
    projectPagesFetched: 5,
    projectPagesIncluded: 5,
    projectTruncated: false,
    competitorHost: "2vautomation.example",
    competitorCrawlId: "8f1c0d2e-0000-4000-8000-000000000009",
    competitorCrawlStatus: "partial",
    competitorPagesFetched: 5,
    competitorPagesIncluded: 5,
    competitorTruncated: false,
    bytes: 14_200,
  },
  taskType: "competitor-comparison-review",
  attempt: 1,
  provider: "anthropic",
  model: "test-model",
  inputTokens: 6_000,
  outputTokens: 900,
};

const CLOSING =
  "Not established by these crawls: traffic, rankings, keyword positions, backlinks, authority, revenue, conversions, share of voice, market share, citations, AI visibility, brand strength, page body quality, content depth.";

/** An answer of the shape the bounded comparison instructions demand. */
const COMPARISON_ANSWER = [
  "PROJECT SITE OBSERVATIONS\n/ title \"Nexra Agency\", one h1, self canonical, Organization JSON-LD.\n/services title \"Services\", one h1, no description, no JSON-LD.\n/contact title \"Contact\", one h1, self canonical, no JSON-LD.",
  "COMPETITOR SITE OBSERVATIONS\n/ title 62 chars, one h1, self canonical, Organization and WebSite JSON-LD.\n/pricing title \"Pricing\", one h1, description 140 chars, Product JSON-LD.\n/blog title \"Blog\", two h1s, no description, no JSON-LD.",
  "DIFFERENCES OBSERVED\nBoth sides are partial samples of a few pages; a difference here is between the samples, never between the sites.\n/services declares no description or JSON-LD; /pricing declares both.\n/ declares Organization only; competitor / adds WebSite.\n/contact pairing with a competitor page is not established.",
  "INFERENCES\nINFERENCE: the competitor's sampled pages declare more structured data; medium confidence.\nINFERENCE: the project's services page states less about itself; medium confidence.\nINFERENCE: two h1s on /blog is the competitor's issue, not the project's; high confidence.",
  "RECOMMENDED NEXT OPERATOR ACTION\nConsider a meta description and a Service JSON-LD type for /services, then re-crawl.",
  CLOSING,
].join("\n\n");

async function runComparison(output: ExecutionOutput) {
  const { store, finishes, current } = memoryStore(
    queuedRun({ agentId: "market-intelligence", taskType: "competitor-comparison-review", input: { competitorDomain: "2vautomation.example" } }),
  );
  const stub = answering(output);
  const worker = createAgentRunWorker({
    store,
    executor: stub.executor,
    projects: { getProjectById: async (id) => (id === PROJECT.id ? PROJECT : null) },
    timeoutMs: 5_000,
  });
  const outcome = await worker.executeRun(RUN_ID);
  return { outcome, finishes, run: current(), executorCalls: stub.calls() };
}

describe("the competitor comparison review through the worker's output screen", () => {
  test("a bounded five-section comparison is kept, with its two-crawl metadata, and sits under 1,500 characters", async () => {
    assert.ok(COMPARISON_ANSWER.length < 1_500, `${COMPARISON_ANSWER.length} characters`);
    const { outcome, finishes, run, executorCalls } = await runComparison({ summary: COMPARISON_ANSWER, metadata: COMPARISON_METADATA });

    assert.equal(outcome.status, "executed");
    assert.equal(executorCalls, 1);
    assert.equal(finishes[0]?.outcome, "completed");
    assert.equal(run.status, "completed");
    assert.equal(run.resultSummary, COMPARISON_ANSWER);
    assert.deepEqual(run.resultMetadata, COMPARISON_METADATA);
    for (const heading of ["PROJECT SITE OBSERVATIONS", "COMPETITOR SITE OBSERVATIONS", "DIFFERENCES OBSERVED", "INFERENCES", "RECOMMENDED NEXT OPERATOR ACTION"]) {
      assert.ok(run.resultSummary?.includes(`${heading}\n`), heading);
    }
    assert.ok(run.resultSummary?.endsWith(CLOSING));
  });

  test("the failure class seen live: a comparison in the pre-bound shape runs over 2,000 characters and is refused after one executor call", async () => {
    // Five fetched pages per side, each cited by full URL with its
    // declarations, then three sections of comparison — what the first
    // instructions invited over two five-page crawls.
    const page = (host: string, path: string) =>
      `https://${host}${path}: title 48 characters, one h1, meta description 150 characters, canonical points at this page, no robots directive, 1 JSON-LD block (Organization), allowed by robots.txt, sitemap not established.`;
    const paths = ["/", "/services", "/about", "/contact", "/blog"];
    const overlong = [
      `PROJECT SITE OBSERVATIONS\n${paths.map((path) => page("nexraagency.com", path)).join("\n")}`,
      `COMPETITOR SITE OBSERVATIONS\n${paths.map((path) => page("2vautomation.example", path)).join("\n")}`,
      "DIFFERENCES OBSERVED\nhttps://nexraagency.com/services declares Organization; https://2vautomation.example/services declares Organization and Service. Both sides are partial samples of a few pages under a fixed budget.",
      "INFERENCES\nINFERENCE: the competitor's sampled service page declares a more specific type; medium confidence.",
      "RECOMMENDED NEXT OPERATOR ACTION\nConsider a Service type on /services.",
      CLOSING,
    ].join("\n\n");
    assert.ok(overlong.length > 2_000, `fixture is only ${overlong.length} characters`);

    const { finishes, run, executorCalls } = await runComparison({ summary: overlong, metadata: COMPARISON_METADATA });

    assert.equal(executorCalls, 1, "the worker asked the executor more than once");
    assert.equal(finishes.length, 1);
    assert.equal(finishes[0]?.outcome, "failed");
    assert.equal(run.status, "failed");
    assert.equal(run.error?.code, "rejected-output");
    assert.match(run.error?.message ?? "", /too large or looked like it contained a credential/);
    assert.equal(run.resultSummary, null);
    assert.equal(run.resultMetadata, null);
  });

  test("the ceiling is unchanged for this task: 2,000 characters is kept and 2,001 is refused", async () => {
    const padded = `${COMPARISON_ANSWER}\n${"x".repeat(2_000 - COMPARISON_ANSWER.length - 1)}`;
    assert.equal(padded.length, 2_000);
    assert.equal((await runComparison({ summary: padded, metadata: COMPARISON_METADATA })).run.status, "completed");
    const refused = await runComparison({ summary: `${padded}x`, metadata: COMPARISON_METADATA });
    assert.equal(refused.run.status, "failed");
    assert.equal(refused.run.error?.code, "rejected-output");
  });

  test("credential-shaped comparison output is still refused", async () => {
    const leaks = [
      `${COMPARISON_ANSWER}\nAlso seen on /pricing: sk-abcdefghijklmnopqrstuvwxyz0123456789`,
      `${COMPARISON_ANSWER}\nToken: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U`,
      `${COMPARISON_ANSWER}\napi_key: 0123456789abcdef`,
    ];
    for (const summary of leaks) {
      const { run, executorCalls } = await runComparison({ summary, metadata: COMPARISON_METADATA });
      assert.equal(executorCalls, 1);
      assert.equal(run.status, "failed");
      assert.equal(run.error?.code, "rejected-output");
      assert.equal(run.resultSummary, null);
    }
  });

  test("the comparison's own evidence summary is storable metadata: no key or value trips the screen", async () => {
    // Fifteen evidence keys, two hosts, two crawl ids, counts and flags —
    // what the AI executor records for this task — pass the metadata check
    // unchanged, so metadata was not what refused the live run.
    const { run } = await runComparison({ summary: COMPARISON_ANSWER, metadata: COMPARISON_METADATA });
    assert.equal(run.status, "completed");
    assert.deepEqual(run.resultMetadata, COMPARISON_METADATA);
  });

  test("when the comparison's grounding is refused, the real AI executor reaches no provider and the run fails before any output exists", async () => {
    let providerCalls = 0;
    const provider = {
      id: "anthropic" as const,
      model: "test-model",
      async generate() {
        providerCalls += 1;
        return { text: COMPARISON_ANSWER, model: "test-model", inputTokens: 1, outputTokens: 1 };
      },
    };
    const notHere = (what: string) => () => Promise.reject(new Error(`${what} must not be read`));
    const readers: TaskGroundingReaders = {
      crawls: { getCrawl: notHere("a crawl") },
      searchConsole: notHere("Search Console"),
      searchConsoleHistory: notHere("stored Search Console history"),
      runs: { getById: notHere("a run") },
      sourceRuns: { listRuns: notHere("the Director's source runs") },
      crawlFindings: notHere("recorded findings"),
      projects: {
        getProjectById: notHere("the project record"),
        getProjectIntake: notHere("the intake"),
        listCrawls: notHere("crawls"),
        searchConsole: notHere("Search Console"),
        listRuns: notHere("runs"),
      },
      comparison: {
        getProjectById: async (id) => (id === PROJECT.id ? PROJECT : null),
        // The stored record lists no competitor: the domain is refused.
        getProjectIntake: async () => ({ competitorDomains: [], intakeNotes: "" }),
        listProjectCrawls: notHere("own-site crawls"),
        listCompetitorCrawls: notHere("competitor crawls"),
        crawls: { getCrawl: notHere("a crawl") },
      },
      evidencePack: {
        getProjectById: notHere("the project record"),
        getProjectIntake: notHere("the intake"),
        listProjectCrawls: notHere("own-site crawls"),
        listCompetitorCrawls: notHere("competitor crawls"),
        crawls: { getCrawl: notHere("a crawl") },
        searchConsole: notHere("Search Console"),
      },
      links: {
        crawls: { getCrawl: notHere("a crawl") },
        links: { listLinks: notHere("link edges") },
      },
      articleCheck: {
        checks: { getArticle: notHere("an article"), getVersion: notHere("an article version"), listUnitRecords: notHere("article check units") },
        evidencePack: {
          getProjectById: notHere("the project record"),
          getProjectIntake: notHere("the intake"),
          listProjectCrawls: notHere("own-site crawls"),
          listCompetitorCrawls: notHere("competitor crawls"),
          crawls: { getCrawl: notHere("a crawl") },
          searchConsole: notHere("Search Console"),
        },
      },
      factCheck: {
        drafts: { getByProjectAndId: notHere("a draft"), getVersion: notHere("a draft version") },
        evidencePack: {
          getProjectById: notHere("the project record"),
          getProjectIntake: notHere("the intake"),
          listProjectCrawls: notHere("own-site crawls"),
          listCompetitorCrawls: notHere("competitor crawls"),
          crawls: { getCrawl: notHere("a crawl") },
          searchConsole: notHere("Search Console"),
        },
      },
      draft: {
        runs: { getById: notHere("a run") },
        evidencePack: {
          getProjectById: notHere("the project record"),
          getProjectIntake: notHere("the intake"),
          listProjectCrawls: notHere("own-site crawls"),
          listCompetitorCrawls: notHere("competitor crawls"),
          crawls: { getCrawl: notHere("a crawl") },
          searchConsole: notHere("Search Console"),
        },
      },
    };
    const { store, finishes, current } = memoryStore(
      queuedRun({ agentId: "market-intelligence", taskType: "competitor-comparison-review", input: { competitorDomain: "2vautomation.example" } }),
    );
    const worker = createAgentRunWorker({
      store,
      executor: createAiExecutor(provider, createTaskGrounding(readers)),
      projects: { getProjectById: async (id) => (id === PROJECT.id ? PROJECT : null) },
      timeoutMs: 5_000,
    });
    await worker.executeRun(RUN_ID);

    assert.equal(providerCalls, 0, "the provider was called for a refused grounding");
    assert.equal(finishes[0]?.outcome, "failed");
    assert.equal(current().status, "failed");
    assert.equal(current().error?.code, "execution-failed");
    assert.notEqual(current().error?.code, "rejected-output");
    assert.equal(current().resultSummary, null);
  });

  test("the other reviews' behaviour is unchanged by the comparison: the same screen keeps a short answer and refuses an overlong one for each", async () => {
    const cases: [AgentRun["agentId"], AgentRun["taskType"], JsonObject][] = [
      ["technical-seo", "crawl-review", { crawlId: CRAWL_ID }],
      ["on-page-seo", "on-page-review", { crawlId: CRAWL_ID }],
      ["ai-visibility", "answer-readiness-review", { crawlId: CRAWL_ID }],
      ["analytics-learning", "performance-review", { range: "30d" }],
      ["project-manager", "intake-review", {}],
      ["seo-director", "priority-review", { sourceRunId: "11111111-0000-4000-8000-000000000001" }],
    ];
    for (const [agentId, taskType, input] of cases) {
      const drive = async (summary: string) => {
        const { store, current } = memoryStore(queuedRun({ agentId, taskType, input }));
        const stub = answering({ summary, metadata: { ...GROUNDED_METADATA, taskType } });
        const worker = createAgentRunWorker({
          store,
          executor: stub.executor,
          projects: { getProjectById: async (id) => (id === PROJECT.id ? PROJECT : null) },
          timeoutMs: 5_000,
        });
        await worker.executeRun(RUN_ID);
        return current();
      };
      assert.equal((await drive("OBSERVED: fine. INFERENCE: fine. RECOMMENDATION: none.")).status, "completed", taskType);
      const refused = await drive("x".repeat(2_001));
      assert.equal(refused.status, "failed", taskType);
      assert.equal(refused.error?.code, "rejected-output", taskType);
    }
  });
});

// ---------------------------------------------------------------------------
// The Research & Evidence pack, through the same screen
// ---------------------------------------------------------------------------

const PACK_METADATA: JsonObject = {
  simulated: false,
  grounded: true,
  evidence: {
    source: "evidence-pack",
    projectId: PROJECT.id,
    projectHost: "nexraagency.com",
    crawlId: CRAWL_ID,
    crawlStatus: "partial",
    pagesFetched: 5,
    pagesIncluded: 5,
    truncated: false,
    searchConsole: "included",
    property: "sc-domain:nexraagency.com",
    windowStart: "2026-08-19",
    windowEnd: "2026-09-17",
    competitorDomains: 1,
    competitorCrawls: 1,
    bytes: 18_400,
  },
  taskType: "evidence-pack-review",
  attempt: 1,
  provider: "anthropic",
  model: "test-model",
  inputTokens: 7_000,
  outputTokens: 700,
};

const PACK_CLOSING =
  "No external source was consulted; every citation above names a record this product holds, and nothing here establishes traffic beyond the Search Console window, rankings beyond average position, backlinks, authority, revenue, conversions, market share, citations, AI visibility or brand strength.";

/** An answer of the shape the evidence pack instructions demand. */
const PACK_ANSWER = [
  "RECORDED PAGE EVIDENCE\n/ title \"Nexra Agency\", one h1, Organization JSON-LD.\n/services title \"Services\", one h1, no description.\n/contact title \"Contact\", self canonical, no JSON-LD.\n/privacy discovered, not reached, not audited.",
  "RECORDED SEARCH EVIDENCE\n120 clicks, 4,000 impressions, average position 14.2 for the window.\nTop query \"nexra agency\": 40 clicks, average position 2.1.",
  "COMPETITOR EVIDENCE ON RECORD\nOne competitor crawl exists: 2vautomation.example, partial, 5 pages.",
  "CLAIMS THIS EVIDENCE SUPPORTS\nThe services page declares no meta description. [crawl /services]\nThe home page declares Organization structured data. [crawl /]\nThe brand query earned 40 clicks this window. [search console 2026-08-19 to 2026-09-17]",
  "CLAIMS THIS EVIDENCE CANNOT SUPPORT\nThat the site ranks for non-brand terms; a Search Console query list beyond the top rows would show it.\nThat the services page is indexed; Search Console page data would establish it.",
  "RECOMMENDED NEXT EVIDENCE TO COLLECT\nQueue the on-page review of the newest crawl.",
  PACK_CLOSING,
].join("\n\n");

async function runPack(output: ExecutionOutput) {
  const { store, finishes, current } = memoryStore(queuedRun({ agentId: "research-evidence", taskType: "evidence-pack-review", input: {} }));
  const stub = answering(output);
  const worker = createAgentRunWorker({
    store,
    executor: stub.executor,
    projects: { getProjectById: async (id) => (id === PROJECT.id ? PROJECT : null) },
    timeoutMs: 5_000,
  });
  const outcome = await worker.executeRun(RUN_ID);
  return { outcome, finishes, run: current(), executorCalls: stub.calls() };
}

describe("the Research & Evidence pack through the worker's output screen", () => {
  test("a bounded six-section pack is kept, with its record metadata, and sits under 1,500 characters", async () => {
    assert.ok(PACK_ANSWER.length < 1_500, `${PACK_ANSWER.length} characters`);
    const { outcome, finishes, run, executorCalls } = await runPack({ summary: PACK_ANSWER, metadata: PACK_METADATA });
    assert.equal(outcome.status, "executed");
    assert.equal(executorCalls, 1);
    assert.equal(finishes[0]?.outcome, "completed");
    assert.equal(run.status, "completed");
    assert.equal(run.resultSummary, PACK_ANSWER);
    assert.deepEqual(run.resultMetadata, PACK_METADATA);
    for (const heading of ["RECORDED PAGE EVIDENCE", "RECORDED SEARCH EVIDENCE", "COMPETITOR EVIDENCE ON RECORD", "CLAIMS THIS EVIDENCE SUPPORTS", "CLAIMS THIS EVIDENCE CANNOT SUPPORT", "RECOMMENDED NEXT EVIDENCE TO COLLECT"]) {
      assert.ok(run.resultSummary?.includes(`${heading}\n`), heading);
    }
    assert.ok(run.resultSummary?.endsWith(PACK_CLOSING));
    // Every supporting claim carries a record tag.
    const supports = run.resultSummary?.split("CLAIMS THIS EVIDENCE SUPPORTS\n")[1]?.split("\n\n")[0]?.split("\n") ?? [];
    assert.equal(supports.length, 3);
    for (const claim of supports) assert.match(claim, /\[(crawl \/\S*|search console [^\]]+)\]$/);
  });

  test("an unbounded pack — every fetched page by full URL with every declaration — runs over 2,000 characters and is refused after one executor call", async () => {
    const page = (path: string) =>
      `https://nexraagency.com${path}: title 48 characters, one h1, meta description 150 characters, canonical points at this page, no robots directive, 1 JSON-LD block (Organization), allowed by robots.txt, sitemap not established, 9 internal links out.`;
    const overlong = [
      `RECORDED PAGE EVIDENCE\n${["/", "/services", "/about", "/contact", "/blog", "/pricing"].map(page).join("\n")}`,
      "RECORDED SEARCH EVIDENCE\n120 clicks, 4,000 impressions, CTR 3.00%, average position 14.2; previous window 100 clicks, 3,500 impressions.\nTop queries: \"nexra agency\" 40 clicks; \"nexra seo\" 12 clicks; \"seo agency austin\" 9 clicks.",
      "COMPETITOR EVIDENCE ON RECORD\nOne competitor crawl exists: 2vautomation.example, partial, 5 pages fetched.",
      "CLAIMS THIS EVIDENCE SUPPORTS\nThe services page declares no meta description. [crawl /services]\nThe home page declares Organization structured data. [crawl /]",
      "CLAIMS THIS EVIDENCE CANNOT SUPPORT\nThat the site ranks for non-brand terms; a fuller query list would show it.",
      "RECOMMENDED NEXT EVIDENCE TO COLLECT\nQueue the on-page review of the newest crawl.",
      PACK_CLOSING,
    ].join("\n\n");
    assert.ok(overlong.length > 2_000, `fixture is only ${overlong.length} characters`);
    const { finishes, run, executorCalls } = await runPack({ summary: overlong, metadata: PACK_METADATA });
    assert.equal(executorCalls, 1);
    assert.equal(finishes[0]?.outcome, "failed");
    assert.equal(run.status, "failed");
    assert.equal(run.error?.code, "rejected-output");
    assert.equal(run.resultSummary, null);
    assert.equal(run.resultMetadata, null);
  });

  test("the ceiling is unchanged for this task: 2,000 characters is kept and 2,001 is refused", async () => {
    const padded = `${PACK_ANSWER}\n${"x".repeat(2_000 - PACK_ANSWER.length - 1)}`;
    assert.equal(padded.length, 2_000);
    assert.equal((await runPack({ summary: padded, metadata: PACK_METADATA })).run.status, "completed");
    const refused = await runPack({ summary: `${padded}x`, metadata: PACK_METADATA });
    assert.equal(refused.run.status, "failed");
    assert.equal(refused.run.error?.code, "rejected-output");
  });

  test("credential-shaped pack output is still refused", async () => {
    for (const summary of [
      `${PACK_ANSWER}\nAlso recorded on /contact: sk-abcdefghijklmnopqrstuvwxyz0123456789`,
      `${PACK_ANSWER}\nToken: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U`,
      `${PACK_ANSWER}\napi_key: 0123456789abcdef`,
    ]) {
      const { run, executorCalls } = await runPack({ summary, metadata: PACK_METADATA });
      assert.equal(executorCalls, 1);
      assert.equal(run.status, "failed");
      assert.equal(run.error?.code, "rejected-output");
      assert.equal(run.resultSummary, null);
    }
  });

  test("the pack's own evidence summary is storable metadata: no key or value trips the screen", async () => {
    const { run } = await runPack({ summary: PACK_ANSWER, metadata: PACK_METADATA });
    assert.equal(run.status, "completed");
    assert.deepEqual(run.resultMetadata, PACK_METADATA);
  });

  test("when the pack's grounding is refused, the real AI executor reaches no provider and the run fails before any output exists", async () => {
    let providerCalls = 0;
    const provider = {
      id: "anthropic" as const,
      model: "test-model",
      async generate() {
        providerCalls += 1;
        return { text: PACK_ANSWER, model: "test-model", inputTokens: 1, outputTokens: 1 };
      },
    };
    const notHere = (what: string) => () => Promise.reject(new Error(`${what} must not be read`));
    const readers: TaskGroundingReaders = {
      crawls: { getCrawl: notHere("a crawl") },
      searchConsole: notHere("Search Console"),
      searchConsoleHistory: notHere("stored Search Console history"),
      runs: { getById: notHere("a run") },
      sourceRuns: { listRuns: notHere("the Director's source runs") },
      crawlFindings: notHere("recorded findings"),
      projects: {
        getProjectById: notHere("the project record"),
        getProjectIntake: notHere("the intake"),
        listCrawls: notHere("crawls"),
        searchConsole: notHere("Search Console"),
        listRuns: notHere("runs"),
      },
      comparison: {
        getProjectById: notHere("the project record"),
        getProjectIntake: notHere("the intake"),
        listProjectCrawls: notHere("own-site crawls"),
        listCompetitorCrawls: notHere("competitor crawls"),
        crawls: { getCrawl: notHere("a crawl") },
      },
      evidencePack: {
        getProjectById: async (id) => (id === PROJECT.id ? PROJECT : null),
        getProjectIntake: notHere("the intake"),
        // No own-site crawl has ever been recorded: the pack is refused.
        listProjectCrawls: async () => [],
        listCompetitorCrawls: notHere("competitor crawls"),
        crawls: { getCrawl: notHere("a crawl") },
        searchConsole: notHere("Search Console"),
      },
      links: {
        crawls: { getCrawl: notHere("a crawl") },
        links: { listLinks: notHere("link edges") },
      },
      articleCheck: {
        checks: { getArticle: notHere("an article"), getVersion: notHere("an article version"), listUnitRecords: notHere("article check units") },
        evidencePack: {
          getProjectById: notHere("the project record"),
          getProjectIntake: notHere("the intake"),
          listProjectCrawls: notHere("own-site crawls"),
          listCompetitorCrawls: notHere("competitor crawls"),
          crawls: { getCrawl: notHere("a crawl") },
          searchConsole: notHere("Search Console"),
        },
      },
      factCheck: {
        drafts: { getByProjectAndId: notHere("a draft"), getVersion: notHere("a draft version") },
        evidencePack: {
          getProjectById: notHere("the project record"),
          getProjectIntake: notHere("the intake"),
          listProjectCrawls: notHere("own-site crawls"),
          listCompetitorCrawls: notHere("competitor crawls"),
          crawls: { getCrawl: notHere("a crawl") },
          searchConsole: notHere("Search Console"),
        },
      },
      draft: {
        runs: { getById: notHere("a run") },
        evidencePack: {
          getProjectById: notHere("the project record"),
          getProjectIntake: notHere("the intake"),
          listProjectCrawls: notHere("own-site crawls"),
          listCompetitorCrawls: notHere("competitor crawls"),
          crawls: { getCrawl: notHere("a crawl") },
          searchConsole: notHere("Search Console"),
        },
      },
    };
    const { store, finishes, current } = memoryStore(queuedRun({ agentId: "research-evidence", taskType: "evidence-pack-review", input: {} }));
    const worker = createAgentRunWorker({
      store,
      executor: createAiExecutor(provider, createTaskGrounding(readers)),
      projects: { getProjectById: async (id) => (id === PROJECT.id ? PROJECT : null) },
      timeoutMs: 5_000,
    });
    await worker.executeRun(RUN_ID);
    assert.equal(providerCalls, 0, "the provider was called for a refused grounding");
    assert.equal(finishes[0]?.outcome, "failed");
    assert.equal(current().error?.code, "execution-failed");
    assert.equal(current().resultSummary, null);
  });
});

// ---------------------------------------------------------------------------
// The Content Strategist plan, through the same screen
// ---------------------------------------------------------------------------

const PLAN_METADATA: JsonObject = { ...PACK_METADATA, taskType: "content-plan-review" };

const PLAN_CLOSING =
  "This plan is a proposal over records this product holds; it names no volume, difficulty, ranking, traffic, backlink, authority, conversion or market figure, and every draft claim must carry a record tag.";

/** An answer of the shape the content plan instructions demand. */
const PLAN_ANSWER = [
  "PAGE AND GOAL\n/services, to state what the agency does for a first-time visitor.",
  "INTENT AND QUERY\nINFERENCE: navigational, from the brand query \"nexra agency\" [search console 2026-08-19 to 2026-09-17]",
  "TITLE AND H1 DIRECTION\nThe page title is \"Services\" with one h1. [crawl /services]\nINFERENCE: name the service and the client outcome in the title.",
  "OUTLINE\nWhat the agency does, in one paragraph [crawl /services]\nThe brand query this page should answer [search console 2026-08-19 to 2026-09-17]\nHow an engagement runs [needs evidence]\nWho the agency has worked with [needs evidence]",
  "INTERNAL LINKS AND SCHEMA\nLink from / and /contact to /services. [crawl /]\nDeclare a Service type beside Organization. [crawl /]",
  "CLAIMS NOT PERMITTED\nAny client result, figure or comparison; no record holds one.\nAny ranking beyond the recorded average position.\nFactual claims in the draft come only from the Research & Evidence pack's supported list.",
  "NEXT OPERATOR ACTION\nCompile or refresh the evidence pack.",
  PLAN_CLOSING,
].join("\n\n");

async function runPlan(output: ExecutionOutput) {
  const { store, finishes, current } = memoryStore(queuedRun({ agentId: "content-strategist", taskType: "content-plan-review", input: {} }));
  const stub = answering(output);
  const worker = createAgentRunWorker({
    store,
    executor: stub.executor,
    projects: { getProjectById: async (id) => (id === PROJECT.id ? PROJECT : null) },
    timeoutMs: 5_000,
  });
  const outcome = await worker.executeRun(RUN_ID);
  return { outcome, finishes, run: current(), executorCalls: stub.calls() };
}

describe("the Content Strategist plan through the worker's output screen", () => {
  test("a bounded seven-section plan is kept, with the pack's record metadata, and sits under 1,500 characters", async () => {
    assert.ok(PLAN_ANSWER.length < 1_500, `${PLAN_ANSWER.length} characters`);
    const { outcome, finishes, run, executorCalls } = await runPlan({ summary: PLAN_ANSWER, metadata: PLAN_METADATA });
    assert.equal(outcome.status, "executed");
    assert.equal(executorCalls, 1);
    assert.equal(finishes[0]?.outcome, "completed");
    assert.equal(run.status, "completed");
    assert.equal(run.resultSummary, PLAN_ANSWER);
    assert.deepEqual(run.resultMetadata, PLAN_METADATA);
    for (const heading of ["PAGE AND GOAL", "INTENT AND QUERY", "TITLE AND H1 DIRECTION", "OUTLINE", "INTERNAL LINKS AND SCHEMA", "CLAIMS NOT PERMITTED", "NEXT OPERATOR ACTION"]) {
      assert.ok(run.resultSummary?.includes(`${heading}\n`), heading);
    }
    assert.ok(run.resultSummary?.endsWith(PLAN_CLOSING));
    assert.match(run.resultSummary ?? "", /INTENT AND QUERY\nINFERENCE: /);
    const outline = run.resultSummary?.split("OUTLINE\n")[1]?.split("\n\n")[0]?.split("\n") ?? [];
    assert.equal(outline.length, 4);
    for (const line of outline) assert.match(line, /\[(crawl \/\S*|search console [^\]]+|needs evidence)\]$/);
    assert.ok(run.resultSummary?.includes("Factual claims in the draft come only from the Research & Evidence pack's supported list."));
  });

  test("an unbounded plan — a full brief with entities, questions and secondary keywords — runs over 2,000 characters and is refused after one executor call", async () => {
    const overlong = [
      "PAGE AND GOAL\n/services, a complete guide to the agency's services, positioned against the comparison hub and the resource library, for a first-time visitor evaluating agencies.",
      "INTENT AND QUERY\nINFERENCE: commercial investigation, from \"nexra agency\" and the wider cluster of agency-selection queries [search console 2026-08-19 to 2026-09-17]",
      "TITLE AND H1 DIRECTION\nSEO Services for Lead Generation: Strategy, Content and Technical, by Nexra Agency [crawl /services]\nINFERENCE: lead with the outcome, then the service list, then the proof.",
      `OUTLINE\n${Array.from({ length: 12 }, (_, i) => `Section ${i + 1}: a detailed treatment of one service line, its process, deliverables and timeline [needs evidence]`).join("\n")}`,
      "INTERNAL LINKS AND SCHEMA\nLink from every resource page to /services with descriptive anchors [crawl /]\nDeclare Service, Organization, FAQPage and BreadcrumbList types [crawl /]",
      "CLAIMS NOT PERMITTED\nAny client result, figure or comparison; no record holds one.\nFactual claims in the draft come only from the Research & Evidence pack's supported list.",
      "NEXT OPERATOR ACTION\nCompile or refresh the evidence pack.",
      PLAN_CLOSING,
    ].join("\n\n");
    assert.ok(overlong.length > 2_000, `fixture is only ${overlong.length} characters`);
    const { finishes, run, executorCalls } = await runPlan({ summary: overlong, metadata: PLAN_METADATA });
    assert.equal(executorCalls, 1);
    assert.equal(finishes[0]?.outcome, "failed");
    assert.equal(run.status, "failed");
    assert.equal(run.error?.code, "rejected-output");
    assert.equal(run.resultSummary, null);
  });

  test("the ceiling is unchanged for this task: 2,000 characters is kept and 2,001 is refused", async () => {
    const padded = `${PLAN_ANSWER}\n${"x".repeat(2_000 - PLAN_ANSWER.length - 1)}`;
    assert.equal(padded.length, 2_000);
    assert.equal((await runPlan({ summary: padded, metadata: PLAN_METADATA })).run.status, "completed");
    const refused = await runPlan({ summary: `${padded}x`, metadata: PLAN_METADATA });
    assert.equal(refused.run.status, "failed");
    assert.equal(refused.run.error?.code, "rejected-output");
  });

  test("credential-shaped plan output is still refused", async () => {
    for (const summary of [
      `${PLAN_ANSWER}\nAlso recorded on /contact: sk-abcdefghijklmnopqrstuvwxyz0123456789`,
      `${PLAN_ANSWER}\nToken: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U`,
      `${PLAN_ANSWER}\napi_key: 0123456789abcdef`,
    ]) {
      const { run, executorCalls } = await runPlan({ summary, metadata: PLAN_METADATA });
      assert.equal(executorCalls, 1);
      assert.equal(run.status, "failed");
      assert.equal(run.error?.code, "rejected-output");
      assert.equal(run.resultSummary, null);
    }
  });
});

// ---------------------------------------------------------------------------
// The Writer's section draft, through the same screen
// ---------------------------------------------------------------------------

const PLAN_ID = "11111111-0000-4000-8000-000000000060";

const DRAFT_METADATA: JsonObject = {
  simulated: false,
  grounded: true,
  evidence: {
    source: "content-draft",
    projectId: PROJECT.id,
    projectHost: "nexraagency.com",
    planRunId: PLAN_ID,
    planCompletedAt: "2026-09-21T10:06:00.000Z",
    planCrawlId: CRAWL_ID,
    crawlId: CRAWL_ID,
    section: "What the agency does, in one paragraph [crawl /services]",
    sectionIndex: 2,
    outlineTagged: 2,
    outlineNeedingEvidence: 2,
    planTruncated: false,
    records: (PACK_METADATA.evidence as JsonObject),
    bytes: 21_000,
  },
  taskType: "section-draft",
  attempt: 1,
  provider: "anthropic",
  model: "test-model",
  inputTokens: 8_000,
  outputTokens: 500,
};

const DRAFT_STATUS = "Draft for operator review. Not published, not approved, not final.";
const DRAFT_CLOSING = "Every claim in this draft is listed above with the record it rests on; nothing here was published or sent anywhere.";

/** An answer of the shape the section draft instructions demand. */
const DRAFT_ANSWER = [
  "SECTION\nWhat the agency does, in one paragraph [crawl /services]",
  "DRAFT\nNexra Agency's services page introduces the agency in a single section. Its title and its one heading both read Services, and the page declares itself as the canonical address for that description. The page also describes the agency as an organisation in its structured data, which is how a search engine is told what kind of entity stands behind the page.",
  "CLAIMS USED\nThe page title is Services. [crawl /services]\nThe page has one h1. [crawl /services]\nThe canonical points at itself. [crawl /services]\nOrganization structured data is declared. [crawl /services]",
  "PLACEHOLDERS\n[NEEDS EVIDENCE: how an engagement runs]\n[NEEDS EVIDENCE: who the agency has worked with]",
  `STATUS\n${DRAFT_STATUS}`,
  DRAFT_CLOSING,
].join("\n\n");

async function runDraft(output: ExecutionOutput) {
  const { store, finishes, current } = memoryStore(queuedRun({ agentId: "writer", taskType: "section-draft", input: { planRunId: PLAN_ID } }));
  const stub = answering(output);
  const worker = createAgentRunWorker({
    store,
    executor: stub.executor,
    projects: { getProjectById: async (id) => (id === PROJECT.id ? PROJECT : null) },
    timeoutMs: 5_000,
  });
  const outcome = await worker.executeRun(RUN_ID);
  return { outcome, finishes, run: current(), executorCalls: stub.calls() };
}

describe("the Writer's section draft through the worker's output screen", () => {
  test("a draft-policy task runs through the worker: a bounded five-section draft is kept, with its plan and record metadata, under 1,500 characters", async () => {
    assert.ok(DRAFT_ANSWER.length < 1_500, `${DRAFT_ANSWER.length} characters`);
    const { outcome, finishes, run, executorCalls } = await runDraft({ summary: DRAFT_ANSWER, metadata: DRAFT_METADATA });
    assert.equal(outcome.status, "executed");
    assert.equal(executorCalls, 1);
    assert.equal(finishes[0]?.outcome, "completed");
    assert.equal(run.status, "completed", "the draft policy was not allowed to run");
    assert.equal(run.resultSummary, DRAFT_ANSWER);
    assert.deepEqual(run.resultMetadata, DRAFT_METADATA);
    for (const heading of ["SECTION", "DRAFT", "CLAIMS USED", "PLACEHOLDERS", "STATUS"]) {
      assert.ok(run.resultSummary?.includes(`${heading}\n`), heading);
    }
    const body = run.resultSummary?.split("DRAFT\n")[1]?.split("\n\n")[0] ?? "";
    assert.ok(body.split(/\s+/).length <= 90, "the draft body is over 90 words");
    assert.doesNotMatch(body, /\[(crawl|search console|NEEDS EVIDENCE)/, "an inline tag reached the prose");
    const claims = run.resultSummary?.split("CLAIMS USED\n")[1]?.split("\n\n")[0]?.split("\n") ?? [];
    assert.ok(claims.length >= 1 && claims.length <= 5);
    for (const claim of claims) assert.match(claim, /\[(crawl \/\S*|search console [^\]]+)\]$/);
    const placeholders = run.resultSummary?.split("PLACEHOLDERS\n")[1]?.split("\n\n")[0]?.split("\n") ?? [];
    for (const placeholder of placeholders) assert.match(placeholder, /^\[NEEDS EVIDENCE: .+\]$/);
    assert.ok(run.resultSummary?.includes(`STATUS\n${DRAFT_STATUS}`));
    assert.ok(run.resultSummary?.endsWith(DRAFT_CLOSING));
  });

  test("an unbounded draft — a full page rather than a section — runs over 2,000 characters and is refused after one executor call", async () => {
    const paragraph = "Nexra Agency helps growing companies win qualified demand through search, combining technical foundations, content built on evidence, and measurement that shows what moved and why, so that every page earns its place and every claim can be traced to a record. ";
    const overlong = [
      "SECTION\nWhat the agency does, in one paragraph [crawl /services]",
      `DRAFT\n${paragraph.repeat(9)}`,
      "CLAIMS USED\nThe page title is Services. [crawl /services]",
      "PLACEHOLDERS\nnone",
      `STATUS\n${DRAFT_STATUS}`,
      DRAFT_CLOSING,
    ].join("\n\n");
    assert.ok(overlong.length > 2_000, `fixture is only ${overlong.length} characters`);
    const { finishes, run, executorCalls } = await runDraft({ summary: overlong, metadata: DRAFT_METADATA });
    assert.equal(executorCalls, 1);
    assert.equal(finishes[0]?.outcome, "failed");
    assert.equal(run.status, "failed");
    assert.equal(run.error?.code, "rejected-output");
    assert.equal(run.resultSummary, null);
  });

  test("the ceiling is unchanged for this task: 2,000 characters is kept and 2,001 is refused", async () => {
    const padded = `${DRAFT_ANSWER}\n${"x".repeat(2_000 - DRAFT_ANSWER.length - 1)}`;
    assert.equal(padded.length, 2_000);
    assert.equal((await runDraft({ summary: padded, metadata: DRAFT_METADATA })).run.status, "completed");
    const refused = await runDraft({ summary: `${padded}x`, metadata: DRAFT_METADATA });
    assert.equal(refused.run.status, "failed");
    assert.equal(refused.run.error?.code, "rejected-output");
  });

  test("credential-shaped draft output is still refused", async () => {
    for (const summary of [
      `${DRAFT_ANSWER}\nAlso on /contact: sk-abcdefghijklmnopqrstuvwxyz0123456789`,
      `${DRAFT_ANSWER}\nToken: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U`,
      `${DRAFT_ANSWER}\napi_key: 0123456789abcdef`,
    ]) {
      const { run, executorCalls } = await runDraft({ summary, metadata: DRAFT_METADATA });
      assert.equal(executorCalls, 1);
      assert.equal(run.status, "failed");
      assert.equal(run.error?.code, "rejected-output");
      assert.equal(run.resultSummary, null);
    }
  });

  test("the draft's own evidence summary is storable metadata: nested records, ids and counts pass the screen, and no plan text is in it", async () => {
    const { run } = await runDraft({ summary: DRAFT_ANSWER, metadata: DRAFT_METADATA });
    assert.equal(run.status, "completed");
    assert.deepEqual(run.resultMetadata, DRAFT_METADATA);
    assert.ok(!JSON.stringify(run.resultMetadata).includes("PAGE AND GOAL"));
  });
});

// ---------------------------------------------------------------------------
// The Authority & Backlink agent's outbound link review: the same screen, the
// same ceiling, and metadata that holds counts and never a host.
// ---------------------------------------------------------------------------

const LINK_METADATA: JsonObject = {
  simulated: false,
  grounded: true,
  evidence: {
    source: "crawl-links",
    crawlId: CRAWL_ID,
    hostScope: "nexraagency.com",
    pagesFetched: 5,
    linksRecorded: 15,
    internalEdges: 8,
    externalEdges: 7,
    externalHosts: 3,
    hostsIncluded: 3,
    truncated: false,
    bytes: 2_100,
  },
  taskType: "outbound-link-review",
  attempt: 1,
  provider: "anthropic",
  model: "test-model",
  inputTokens: 1_100,
  outputTokens: 240,
};

const LINK_NOT_ESTABLISHED =
  "No inbound backlink, referring domain, authority, anchor-text or placement record exists for this project; nothing above is a backlink.";
const LINK_CLOSING =
  "The only evidence here is this project's own recorded site crawl and the outbound edges it observed; no inbound link to this site was measured by anything.";

const LINK_ANSWER = [
  "LINK RECORD\nCrawl of nexraagency.com, five pages fetched, partial.\nEdges recorded: 15 in all, 8 internal, 7 external.",
  "OUTBOUND HOSTS\nwww.linkedin.com: 4 edges, rel (none) and nofollow noopener [crawl /about]\npartner.example: 1 edge, rel sponsored [crawl /services]\ncdn.example: 1 edge, rel (none) [crawl /services]",
  "DECLARATIONS TO CHECK\nOBSERVED: three edges to www.linkedin.com carry no rel [crawl /]\nOBSERVED: the partner.example link is declared sponsored [crawl /services]\nINFERENCE: confirm the cdn.example script link is intended [crawl /services]",
  `NOT ESTABLISHED\n${LINK_NOT_ESTABLISHED}`,
  "EVIDENCE NEEDED\nA connected backlink data source.",
  "NEXT OPERATOR ACTION\nCheck the rel declarations on the named paths.",
  LINK_CLOSING,
].join("\n\n");

async function runLinkReview(output: ExecutionOutput) {
  const { store, finishes, current } = memoryStore(
    queuedRun({ agentId: "authority-backlink", taskType: "outbound-link-review", input: { crawlId: CRAWL_ID } }),
  );
  const stub = answering(output);
  const worker = createAgentRunWorker({
    store,
    executor: stub.executor,
    projects: { getProjectById: async (id) => (id === PROJECT.id ? PROJECT : null) },
    timeoutMs: 5_000,
  });
  const outcome = await worker.executeRun(RUN_ID);
  return { outcome, finishes, run: current(), executorCalls: stub.calls() };
}

describe("an outbound link review on the screen — the Authority & Backlink agent", () => {
  test("a bounded review with six sections, the fixed line and the closing sentence completes and is stored as returned", async () => {
    assert.ok(LINK_ANSWER.length < 1_500, `${LINK_ANSWER.length} characters`);
    const { outcome, finishes, run, executorCalls } = await runLinkReview({ summary: LINK_ANSWER, metadata: LINK_METADATA });
    assert.equal(outcome.status, "executed");
    assert.equal(executorCalls, 1);
    assert.equal(finishes[0]?.outcome, "completed");
    assert.equal(run.status, "completed");
    assert.equal(run.resultSummary, LINK_ANSWER);
    assert.deepEqual(run.resultMetadata, LINK_METADATA);
    for (const heading of ["LINK RECORD", "OUTBOUND HOSTS", "DECLARATIONS TO CHECK", "NOT ESTABLISHED", "EVIDENCE NEEDED", "NEXT OPERATOR ACTION"]) {
      assert.ok(run.resultSummary?.includes(`${heading}\n`), heading);
    }
    const hosts = run.resultSummary?.split("OUTBOUND HOSTS\n")[1]?.split("\n\n")[0]?.split("\n") ?? [];
    assert.ok(hosts.length >= 1 && hosts.length <= 6);
    for (const line of hosts) assert.match(line, /\[crawl \/\S*\]$/);
    const declarations = run.resultSummary?.split("DECLARATIONS TO CHECK\n")[1]?.split("\n\n")[0]?.split("\n") ?? [];
    assert.ok(declarations.length <= 3);
    for (const line of declarations) assert.match(line, /^(OBSERVED|INFERENCE): /);
    assert.ok(run.resultSummary?.includes(`NOT ESTABLISHED\n${LINK_NOT_ESTABLISHED}`));
    assert.ok(run.resultSummary?.endsWith(LINK_CLOSING));
    assert.doesNotMatch(run.resultSummary ?? "", /backlinks? (count|profile)|referring domains: \d|authority score|domain rating/i);
  });

  test("the metadata is counts and identifiers only: no host, path or URL is stored", async () => {
    const { run } = await runLinkReview({ summary: LINK_ANSWER, metadata: LINK_METADATA });
    const stored = JSON.stringify(run.resultMetadata);
    for (const leak of ["linkedin", "partner.example", "cdn.example", "/services", "https://"]) {
      assert.ok(!stored.includes(leak), `${leak} reached the metadata`);
    }
  });

  test("an overlong review is refused, and nothing of it is stored", async () => {
    const overlong = `${LINK_ANSWER}\n${"x".repeat(2_000)}`;
    const { finishes, run, executorCalls } = await runLinkReview({ summary: overlong, metadata: LINK_METADATA });
    assert.equal(executorCalls, 1);
    assert.equal(finishes[0]?.outcome, "failed");
    assert.equal(run.status, "failed");
    assert.equal(run.error?.code, "rejected-output");
    assert.equal(run.resultSummary, null);
  });

  test("the ceiling is unchanged for this task: 2,000 characters is kept and 2,001 is refused", async () => {
    const padded = `${LINK_ANSWER}\n${"x".repeat(2_000 - LINK_ANSWER.length - 1)}`;
    assert.equal(padded.length, 2_000);
    assert.equal((await runLinkReview({ summary: padded, metadata: LINK_METADATA })).run.status, "completed");
    const over = `${padded}x`;
    assert.equal(over.length, 2_001);
    assert.equal((await runLinkReview({ summary: over, metadata: LINK_METADATA })).run.error?.code, "rejected-output");
  });

  test("a review that carries something credential-shaped is refused like any other output", async () => {
    const { run } = await runLinkReview({
      summary: `${LINK_ANSWER}\nToken: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U`,
      metadata: LINK_METADATA,
    });
    assert.equal(run.status, "failed");
    assert.equal(run.error?.code, "rejected-output");
    assert.equal(run.resultSummary, null);
  });
});

// ---------------------------------------------------------------------------
// The On-Page SEO review, through the same screen
// ---------------------------------------------------------------------------

/**
 * The first live on-page review over an M2 crawl (run 874e5384, crawl
 * 3398ff1a) was refused as `rejected-output` twelve seconds after the same
 * evidence had been reviewed and kept by the Technical SEO agent. The refused
 * text is never stored, so the failure class is reproduced here: an answer in
 * the pre-bound shape — every fetched page by full URL with every element the
 * instructions name, M2 signals included — through the real worker, beside an
 * answer at the bound the corrected instructions set. The screen is
 * untouched: the same 2,000-character ceiling, the same credential patterns,
 * the same metadata rules.
 */

/** The metadata the executor stores for an on-page run over an M2 crawl, in production's shape. */
const ON_PAGE_METADATA: JsonObject = {
  simulated: false,
  grounded: true,
  evidence: {
    bytes: 7_629,
    crawlId: CRAWL_ID,
    hostScope: "nexraagency.com",
    truncated: false,
    truncatedByBytes: false,
    pagesFetched: 5,
    pagesIncluded: 5,
    pagesNotReached: 2,
    findings: { status: "available", ruleVersion: 3, findings: 5, described: 5, rules: 4, rulesCut: [], cutByBytes: 0, linksRead: 46, linksCut: false, bytes: 4_459 },
  },
  taskType: "on-page-review",
  attempt: 1,
  provider: "anthropic",
  model: "test-model",
  inputTokens: 6_000,
  outputTokens: 500,
};

/** An answer of the shape the bounded on-page instructions demand. */
const ON_PAGE_ANSWER = [
  "Coverage: 5 of 7 pages fetched and read, 46 link edges read, nothing cut; partial crawl, stopped on page budget. Covers only the pages listed.",
  "1. [h1-missing] OBSERVED: https://nexraagency.com/contact has h1Count=0. INFERENCE: the served HTML carries no h1; high confidence. RECOMMENDATION: add one h1 stating what the page is for.",
  "2. [meta-description-long] OBSERVED: https://nexraagency.com/ meta description is 169 characters. INFERENCE: likely cut short in results; medium confidence. RECOMMENDATION: trim it to 160 or fewer.",
  "3. [title-duplicate] OBSERVED: https://nexraagency.com/ and https://www.nexraagency.com/ share one title. INFERENCE: the redirect source and target were recorded separately; high confidence. RECOMMENDATION: keep one canonical host and one title.",
  "4. OBSERVED: https://nexraagency.com/services declares og:title, a summary_large_image Twitter card and 454 visible words as served. INFERENCE: social metadata is present; the count says nothing about quality; high confidence. RECOMMENDATION: no change proposed.",
  "/privacy and /terms were discovered but not reached and were not examined.",
  "Most needs attention: https://nexraagency.com/contact, because it has no h1.",
].join("\n\n");

async function runOnPage(output: ExecutionOutput) {
  const { store, finishes, current } = memoryStore(queuedRun({ agentId: "on-page-seo", taskType: "on-page-review" }));
  const stub = answering(output);
  const worker = createAgentRunWorker({
    store,
    executor: stub.executor,
    projects: { getProjectById: async (id) => (id === PROJECT.id ? PROJECT : null) },
    timeoutMs: 5_000,
  });
  const outcome = await worker.executeRun(RUN_ID);
  return { outcome, finishes, run: current(), executorCalls: stub.calls() };
}

describe("the On-Page SEO review through the worker's output screen", () => {
  test("a bounded four-finding review is kept, with its M2 and rule-version-3 evidence metadata, and sits under 1,500 characters", async () => {
    assert.ok(ON_PAGE_ANSWER.length < 1_500, `${ON_PAGE_ANSWER.length} characters`);
    const { outcome, finishes, run, executorCalls } = await runOnPage({ summary: ON_PAGE_ANSWER, metadata: ON_PAGE_METADATA });

    assert.equal(outcome.status, "executed");
    assert.equal(executorCalls, 1);
    assert.equal(finishes[0]?.outcome, "completed");
    assert.equal(run.status, "completed");
    assert.equal(run.resultSummary, ON_PAGE_ANSWER);
    assert.deepEqual(run.resultMetadata, ON_PAGE_METADATA);
    assert.equal(run.error, null);
  });

  test("the failure class seen live: a review in the pre-bound shape, every page with every element, runs over 2,000 characters and is refused after one executor call", async () => {
    const finding = (path: string) =>
      [
        `OBSERVED: https://www.nexraagency.com/${path} — title 48 characters, meta description 158 characters, h1Count=1, first h1 "${path}", canonical self, structured data ProfessionalService, 9 internal links in and 11 out within this crawl, depth 1, in sitemap, html lang "en", 0 hreflang alternates, 7 og: meta tags with og:title and og:image, Twitter card summary_large_image, 454 visible words as served.`,
        "INFERENCE: the declarations are complete and consistent; the word count is a count of the HTML as served and says nothing about quality; high confidence.",
        "RECOMMENDATION: no change is proposed for this page; an operator may still review the description against the page's purpose.",
      ].join("\n");
    const overlong = ["", "about", "blog", "contact", "services"].map(finding).join("\n\n");
    assert.ok(overlong.length > 2_000, `fixture is only ${overlong.length} characters`);

    const { finishes, run, executorCalls } = await runOnPage({ summary: overlong, metadata: ON_PAGE_METADATA });

    assert.equal(executorCalls, 1, "the worker asked the executor more than once");
    assert.equal(finishes.length, 1);
    assert.equal(finishes[0]?.outcome, "failed");
    assert.equal(run.status, "failed");
    assert.equal(run.error?.code, "rejected-output");
    assert.match(run.error?.message ?? "", /too large or looked like it contained a credential/);
    assert.equal(run.resultSummary, null);
    assert.equal(run.resultMetadata, null);
  });

  test("the ceiling is unchanged for this task: 2,000 characters is kept and 2,001 is refused", async () => {
    const base = "OBSERVED: https://nexraagency.com/contact has h1Count=0. INFERENCE: no h1 served. RECOMMENDATION: add one. ";
    const atCeiling = base.repeat(Math.ceil(2_000 / base.length)).slice(0, 2_000);
    assert.equal((await runOnPage({ summary: atCeiling, metadata: ON_PAGE_METADATA })).run.status, "completed");
    const refused = await runOnPage({ summary: `${atCeiling}x`, metadata: ON_PAGE_METADATA });
    assert.equal(refused.run.status, "failed");
    assert.equal(refused.run.error?.code, "rejected-output");
  });

  test("credential-shaped on-page output is still refused", async () => {
    for (const summary of [
      `${ON_PAGE_ANSWER}\nAlso seen: sk-abcdefghijklmnopqrstuvwxyz0123456789`,
      `${ON_PAGE_ANSWER}\napi_key: 0123456789abcdef`,
    ]) {
      const { run, executorCalls } = await runOnPage({ summary, metadata: ON_PAGE_METADATA });
      assert.equal(executorCalls, 1);
      assert.equal(run.status, "failed");
      assert.equal(run.error?.code, "rejected-output");
      assert.equal(run.resultSummary, null);
    }
  });

  test("the on-page evidence summary, findings block included, is storable metadata: no key, depth or size trips the screen", async () => {
    const { run } = await runOnPage({ summary: ON_PAGE_ANSWER, metadata: ON_PAGE_METADATA });
    assert.equal(run.status, "completed");
    assert.deepEqual(run.resultMetadata, ON_PAGE_METADATA);
  });
});
