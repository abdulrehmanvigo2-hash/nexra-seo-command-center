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
      runs: { getById: notHere("a run") },
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
      runs: { getById: notHere("a run") },
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
