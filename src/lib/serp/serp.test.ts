import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ProviderRequest, ProviderRun } from "@/lib/keyword-snapshots/contract";
import type { FinishInput, RecordRequestInput } from "@/lib/keyword-snapshots/store-contract";
import type { ClientResult, DataForSeoClient } from "@/lib/providers/dataforseo/client";
import type { DataForSeoConfig } from "@/lib/providers/dataforseo/config";
import { ENDPOINTS, SERP_PRICE_PER_CALL_USD } from "@/lib/providers/dataforseo/constants";
import { parseSerpRequest, resultsOfType, serpUrl, type SerpResult, type SerpRun } from "@/lib/serp/contract";
import { parseSerpAnswer, serpTask, type SerpRow } from "@/lib/serp/parse";
import { createSerpService, type SerpRunResult } from "@/lib/serp/service";
import { SerpStoreNotSetUpError, type SerpReserveInput, type SerpStore } from "@/lib/serp/store-contract";

/** M4, PR 3: the SERP parser, request shape and service over an in-memory store and a recorded client. */

const OPP = "11111111-1111-4111-8111-111111111111";

function answer(items: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    status_code: 20000,
    tasks: [{ id: "task-serp-1", status_code: 20000, cost: 0.002, result: [{ keyword: "ai sdr", items }], ...overrides }],
  };
}
const ITEMS = [
  { type: "paid", url: "https://ads.example/x", title: "Ad" },
  { type: "organic", rank_group: 1, url: "https://alpha.example/guide", domain: "alpha.example", title: "  The   Alpha guide ", description: "Alpha snippet" },
  { type: "people_also_ask", items: [
    { type: "people_also_ask_element", title: "What is an AI SDR?", expanded_element: [{ type: "people_also_ask_expanded_element", url: "https://beta.example/what" }] },
    { type: "people_also_ask_element", title: "what is an ai sdr?" },
    { type: "people_also_ask_element", title: "Is an AI SDR worth it?", expanded_element: [{ url: "javascript:alert(1)" }] },
  ] },
  { type: "organic", url: "https://gamma.example/", title: "Gamma" },
  { type: "organic", url: "https://alpha.example/guide", domain: "alpha.example", title: "Duplicate URL" },
  { type: "organic", url: "ftp://bad.example/", domain: "bad.example", title: "Not http" },
  { type: "related_searches", items: ["ai sdr tools", "AI SDR tools", "  ai sdr pricing "] },
];

describe("parseSerpAnswer", () => {
  test("keeps organic, questions and related searches, ranked within type; drops ads, duplicates and non-http URLs", () => {
    const parsed = parseSerpAnswer(answer(ITEMS));
    assert.ok(parsed.ok);
    if (!parsed.ok) return;
    assert.equal(parsed.costUsd, 0.002);
    assert.equal(parsed.taskId, "task-serp-1");
    assert.equal(parsed.items, 7);
    assert.deepEqual(parsed.rows, [
      { type: "organic", rank: 1, url: "https://alpha.example/guide", domain: "alpha.example", title: "The Alpha guide", snippet: "Alpha snippet" },
      { type: "organic", rank: 2, url: "https://gamma.example/", domain: "gamma.example", title: "Gamma", snippet: null },
      { type: "people-also-ask", rank: 1, title: "What is an AI SDR?", url: "https://beta.example/what" },
      { type: "people-also-ask", rank: 2, title: "Is an AI SDR worth it?", url: null },
      { type: "related-search", rank: 1, title: "ai sdr tools" },
      { type: "related-search", rank: 2, title: "ai sdr pricing" },
    ] satisfies SerpRow[]);
  });

  test("keeps the top 10 organic results only", () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ type: "organic", url: `https://site${i}.example/`, domain: `site${i}.example`, title: `Site ${i}` }));
    const parsed = parseSerpAnswer(answer(many));
    assert.ok(parsed.ok && parsed.rows.length === 10 && parsed.rows.at(-1)?.rank === 10);
  });

  test("refusals and malformed bodies fail closed", () => {
    assert.deepEqual(parseSerpAnswer({ status_code: 40100 }), { ok: false, reason: "provider-refused", providerStatusCode: 40100, taskId: null });
    assert.deepEqual(parseSerpAnswer(answer([], { status_code: 40501 })), { ok: false, reason: "provider-refused", providerStatusCode: 40501, taskId: "task-serp-1" });
    assert.equal((parseSerpAnswer("text") as { reason: string }).reason, "malformed");
    assert.equal((parseSerpAnswer(answer([], { cost: -1 })) as { reason: string }).reason, "malformed");
    assert.equal((parseSerpAnswer(answer([], { result: null })) as { reason: string }).reason, "malformed");
    assert.equal((parseSerpAnswer(answer(["not an object"])) as { reason: string }).reason, "malformed");
  });

  test("the task sends the keyword, location, language and depth 10 — no credential", () => {
    assert.deepEqual(serpTask("ai sdr"), { keyword: "ai sdr", location_code: 2840, language_code: "en", depth: 10 });
  });
});

describe("parseSerpRequest", () => {
  test("project and opportunity only; never a keyword", () => {
    assert.deepEqual(parseSerpRequest({ project: "nexra-agency", opportunity: OPP.toUpperCase() }), { ok: true, projectId: "nexra-agency", opportunityId: OPP });
    assert.equal(parseSerpRequest({ project: "nexra-agency", opportunity: OPP, keyword: "x" }).ok, false);
    assert.equal(parseSerpRequest({ project: "nexra-agency" }).ok, false);
    assert.equal(parseSerpRequest({ project: "Bad Id", opportunity: OPP }).ok, false);
    assert.equal(serpUrl("nexra-agency", OPP), `/api/serp?project=nexra-agency&opportunity=${OPP}`);
  });
});

// ---------------------------------------------------------------------------
// The service over an in-memory store.

function memoryStore(options: { reserve?: (input: SerpReserveInput) => ReturnType<SerpStore["reserve"]>; open?: ProviderRun | null; notSetUp?: boolean } = {}) {
  const runs = new Map<string, SerpRun | ProviderRun>();
  const requests: ProviderRequest[] = [];
  const results: SerpResult[] = [];
  const finishes: FinishInput[] = [];
  const recorded: RecordRequestInput[] = [];
  let n = 0;
  if (options.open) runs.set(options.open.id, options.open);
  const store: SerpStore = {
    storesSerp: true,
    async reserve(input) {
      if (options.notSetUp) throw new SerpStoreNotSetUpError("reserve");
      if (options.reserve) return options.reserve(input);
      const run: SerpRun = {
        id: `run-${++n}`, projectId: input.projectId, provider: "dataforseo", kind: "serp", opportunityId: input.opportunityId, mode: input.mode, apiHost: input.apiHost,
        seeds: ["ai sdr"], locationCode: input.locationCode, languageCode: input.languageCode, status: "reserved", estimateUsd: input.estimateUsd, costUsd: null,
        unknownCostUsd: 0, errorCode: null, requestedBy: input.operatorId, createdAt: new Date().toISOString(), finishedAt: null,
      };
      runs.set(run.id, run);
      return { status: "reserved", run, spentUsd: 0 };
    },
    async recordRequest(input) {
      recorded.push(input);
      const request: ProviderRequest = { id: `req-${requests.length + 1}`, runId: input.runId, seq: input.seq, endpoint: input.endpoint, params: input.params, outcome: input.outcome,
        providerStatusCode: input.providerStatusCode, providerTaskId: input.providerTaskId, costUsd: input.costUsd, items: input.items, responseSha256: input.responseSha256, sentAt: input.sentAt, receivedAt: input.receivedAt };
      requests.push(request);
      return { status: "recorded", request };
    },
    async recordResults(runId, requestId, rows) {
      const run = runs.get(runId) as SerpRun;
      for (const row of rows) results.push({ id: `res-${results.length}`, runId, opportunityId: run.opportunityId, keyword: run.seeds[0] ?? "", type: row.type, rank: row.rank,
        url: "url" in row ? row.url : null, domain: row.type === "organic" ? row.domain : null, title: row.title, snippet: row.type === "organic" ? row.snippet : null, mode: run.mode, fetchedAt: "2026-10-03T12:00:00.000Z" });
      return { status: "recorded", rows: rows.length };
    },
    async finish(input) {
      finishes.push(input);
      const run = runs.get(input.runId);
      if (!run) return { status: "run-not-found" };
      const done = { ...run, status: input.status, costUsd: input.costUsd, unknownCostUsd: input.unknownCostUsd, errorCode: input.errorCode, finishedAt: new Date().toISOString() };
      runs.set(run.id, done);
      return { status: "finished", run: done };
    },
    async listRuns(projectId, opportunityId) {
      if (options.notSetUp) throw new SerpStoreNotSetUpError("list");
      return [...runs.values()].filter((run): run is SerpRun => run.kind === "serp" && run.projectId === projectId && (opportunityId === null || (run as SerpRun).opportunityId === opportunityId));
    },
    async listRequests(runId) {
      return requests.filter((request) => request.runId === runId);
    },
    async listResults(runId) {
      return results.filter((result) => result.runId === runId);
    },
    async openRun(projectId) {
      return [...runs.values()].find((run) => run.projectId === projectId && run.status === "reserved") ?? null;
    },
    async liveSpendToday() {
      return 0.5;
    },
  };
  return { store, runs, requests, results, finishes, recorded };
}

const live: DataForSeoConfig = { status: "configured", mode: "live", credentials: { login: "l", password: "p" }, dailyCap: { ok: true, usd: 1 } };
function client(result: ClientResult, calls: unknown[] = []): () => DataForSeoClient {
  return () => ({ mode: "live", host: "api.dataforseo.com", async post(endpoint, tasks) { calls.push({ endpoint, tasks }); return result; } });
}
const ok = (body: unknown): ClientResult => ({ outcome: "succeeded", httpStatus: 200, body, sha256: "a".repeat(64), sentAt: "2026-10-03T12:00:00.000Z", receivedAt: "2026-10-03T12:00:01.000Z", durationMs: 1000 });

describe("the SERP service", () => {
  test("one call: reserved at the SERP price, recorded, results written, completed at the provider's cost", async () => {
    const memory = memoryStore();
    const calls: unknown[] = [];
    const service = createSerpService(memory.store, { config: () => live, client: client(ok(answer(ITEMS)), calls) });
    const result = await service.run("nexra-agency", OPP, "op-1");
    assert.equal(result.status, "finished");
    if (result.status !== "finished") return;
    assert.equal(result.run.status, "completed");
    assert.equal(result.run.costUsd, 0.002);
    assert.equal(result.results, 6);
    assert.deepEqual(calls, [{ endpoint: ENDPOINTS.serpOrganic, tasks: [serpTask("ai sdr")] }]);
    assert.equal(memory.recorded[0]?.seq, 0);
    assert.equal(memory.recorded[0]?.endpoint, ENDPOINTS.serpOrganic);
    assert.deepEqual(memory.finishes, [{ runId: "run-1", status: "completed", costUsd: 0.002, unknownCostUsd: 0, errorCode: null }]);
    assert.equal(SERP_PRICE_PER_CALL_USD, 0.0024);
    assert.equal((memory.runs.get("run-1") as SerpRun).estimateUsd, 0.0024);
  });

  test("a timeout is unknown, counted at its estimate, and the run fails — never retried in live mode", async () => {
    const memory = memoryStore();
    const calls: unknown[] = [];
    const service = createSerpService(memory.store, { config: () => live, client: client({ outcome: "unknown", kind: "timeout", sentAt: "2026-10-03T12:00:00.000Z" }, calls) });
    const result = await service.run("nexra-agency", OPP, "op-1");
    assert.equal(calls.length, 1);
    assert.deepEqual(memory.finishes, [{ runId: "run-1", status: "failed", costUsd: 0, unknownCostUsd: 0.0024, errorCode: "provider-timeout" }]);
    assert.ok(result.status === "finished" && result.results === 0);
  });

  test("a refused credential and a provider refusal fail the run at no cost, with no results", async () => {
    for (const [answerOf, code] of [
      [{ outcome: "failed", httpStatus: 401, kind: "credentials-rejected", sentAt: "s", receivedAt: "r" } as ClientResult, "provider-refused"],
      [ok({ status_code: 40501 }), "provider-error"],
    ] as const) {
      const memory = memoryStore();
      await createSerpService(memory.store, { config: () => live, client: client(answerOf) }).run("nexra-agency", OPP, "op-1");
      assert.deepEqual(memory.finishes.map((f) => [f.status, f.costUsd, f.errorCode]), [["failed", 0, code]]);
      assert.equal(memory.results.length, 0);
    }
  });

  test("the database's refusals pass through; nothing is called", async () => {
    for (const outcome of ["opportunity-not-found", "run-active", "project-not-found"] as const) {
      const calls: unknown[] = [];
      const memory = memoryStore({ reserve: async (): ReturnType<SerpStore["reserve"]> => ({ status: outcome }) });
      const result: SerpRunResult = await createSerpService(memory.store, { config: () => live, client: client(ok(answer([])), calls) }).run("nexra-agency", OPP, "op-1");
      assert.equal(result.status, outcome);
      assert.equal(calls.length, 0);
    }
  });

  test("not configured, an invalid cap and not set up answer before any call", async () => {
    const calls: unknown[] = [];
    const memory = memoryStore();
    assert.equal((await createSerpService(memory.store, { config: () => ({ status: "unconfigured", mode: "sandbox" }), client: client(ok(answer([])), calls) }).run("p1", OPP, "o")).status, "not-configured");
    const invalid: DataForSeoConfig = { ...live, dailyCap: { ok: false, reason: "above-ceiling" } };
    assert.equal((await createSerpService(memory.store, { config: () => invalid, client: client(ok(answer([])), calls) }).run("p1", OPP, "o")).status, "cap-invalid");
    const absent = memoryStore({ notSetUp: true });
    assert.equal((await createSerpService(absent.store, { config: () => live, client: client(ok(answer([])), calls) }).run("p1", OPP, "o")).status, "not-set-up");
    assert.equal((await createSerpService(absent.store, { config: () => live, client: client(ok(answer([])), calls) }).read("p1", null)).status, "not-set-up");
    assert.equal(calls.length, 0);
  });

  test("an open run older than ten minutes is finished abandoned first", async () => {
    const open: ProviderRun = { id: "old", projectId: "nexra-agency", provider: "dataforseo", kind: "keyword-snapshot", mode: "live", apiHost: "api.dataforseo.com", seeds: ["a"], locationCode: 2840,
      languageCode: "en", status: "reserved", estimateUsd: 0.1, costUsd: null, unknownCostUsd: 0, errorCode: null, requestedBy: "o", createdAt: "2026-10-03T10:00:00.000Z", finishedAt: null };
    const memory = memoryStore({ open });
    await createSerpService(memory.store, { config: () => live, client: client(ok(answer(ITEMS))), now: () => new Date("2026-10-03T12:00:00.000Z") }).run("nexra-agency", OPP, "op-1");
    assert.deepEqual(memory.finishes[0], { runId: "old", status: "failed", costUsd: 0, unknownCostUsd: 0, errorCode: "abandoned" });
  });

  test("read lists one project's SERP runs, newest first, with requests and results by type", async () => {
    const memory = memoryStore();
    const service = createSerpService(memory.store, { config: () => live, client: client(ok(answer(ITEMS))) });
    await service.run("nexra-agency", OPP, "op-1");
    const read = await service.read("nexra-agency", OPP);
    assert.equal(read.status, "read");
    if (read.status !== "read") return;
    assert.equal(read.view.provider.status, "ready");
    assert.equal(read.view.runs.length, 1);
    const view = read.view.runs[0]!;
    assert.equal(view.requests.length, 1);
    assert.deepEqual(resultsOfType(view.results, "organic").map((r) => r.rank), [1, 2]);
    assert.deepEqual(resultsOfType(view.results, "related-search").map((r) => r.title), ["ai sdr tools", "ai sdr pricing"]);
    const other = await service.read("another-project", null);
    assert.ok(other.status === "read" && other.view.runs.length === 0);
  });
});
