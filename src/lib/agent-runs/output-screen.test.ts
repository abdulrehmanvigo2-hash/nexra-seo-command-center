import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AgentRun, AgentRunAttempt, JsonObject } from "../../types/agent-run.ts";
import type { ProjectRecord } from "../../types/project.ts";
import type { AgentRunStore, AttemptLease, AttemptResult, ClaimRequest } from "./contract.ts";
import type { AgentExecutor, ExecutionOutput } from "./executor.ts";
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
