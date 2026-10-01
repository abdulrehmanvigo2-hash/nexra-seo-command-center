import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { ClientResult, DataForSeoClient } from "../providers/dataforseo/client.ts";
import type { DataForSeoConfig } from "../providers/dataforseo/config.ts";
import { ENDPOINTS, SEED_TOPICS, type Endpoint } from "../providers/dataforseo/constants.ts";
import { estimateRun } from "../providers/dataforseo/estimate.ts";
import { isRunId, keywordSnapshotsUrl, parseRunRequest, secondsUntilMidnightUtc } from "./contract.ts";
import type { KeywordMetric, ProviderRequest, ProviderRun } from "./contract.ts";
import { createKeywordSnapshotService, missingSeeds, missingSeqs } from "./service.ts";
import { SnapshotStoreNotSetUpError, type SnapshotStore } from "./store-contract.ts";
import { metricRowToMetric, reserveResultToOutcome, runRowToRun } from "./supabase/schema.ts";

/**
 * F0, PR 4: the snapshot service over an in-memory store that enforces the
 * database's rules (the cap, one open run, one row per seq, the finish
 * consistency) and a fake client. Every case is a way money could move
 * without the operator's say or a figure could be invented: the cap refused
 * before any call, a timeout never retried, a sandbox run uncounted, a
 * partial run resumed only when asked.
 */

const root = new URL("../../../", import.meta.url);
const OPERATOR = "00000000-0000-4000-8000-0000000000aa";

type Answer = ClientResult | ((endpoint: Endpoint, task: Record<string, unknown>) => ClientResult);

function fakeClient(answers: Answer[], mode: "sandbox" | "live" = "live") {
  const calls: { endpoint: Endpoint; task: Record<string, unknown> }[] = [];
  const client: DataForSeoClient = {
    mode,
    host: mode === "live" ? "api.dataforseo.com" : "sandbox.dataforseo.com",
    async post(endpoint, tasks) {
      const task = tasks[0] as Record<string, unknown>;
      calls.push({ endpoint, task });
      // The last prepared answer is reused for every later call.
      const answer = answers.length > 1 ? answers.shift() : answers[0];
      if (answer === undefined) throw new Error("no answer prepared");
      return typeof answer === "function" ? answer(endpoint, task) : answer;
    },
  };
  return { client, calls };
}

const T0 = "2026-10-01T10:00:00.000Z";
const usd = (value: number) => Math.round(value * 10_000) / 10_000;
const succeeded = (body: unknown, sha = "c".repeat(64)): ClientResult => ({ outcome: "succeeded", httpStatus: 200, body, sha256: sha, sentAt: T0, receivedAt: T0, durationMs: 10 });
const overviewBody = (seeds: readonly string[], cost = 0.0132) => ({
  status_code: 20000,
  tasks: [{ id: "t-overview", status_code: 20000, cost, result: [{ items: seeds.map((keyword, i) => ({ keyword, keyword_info: { search_volume: 100 * (i + 1), cpc: 1, competition: 0.5 }, keyword_properties: { keyword_difficulty: 40 } })) }] }],
});
const relatedBody = (seed: string, cost = 0.0144) => ({
  status_code: 20000,
  tasks: [{ id: `t-${seed}`, status_code: 20000, cost, result: [{ items: [{ keyword_data: { keyword: `${seed} related`, keyword_info: { search_volume: 10 } } }] }] }],
});
const timeout: ClientResult = { outcome: "unknown", kind: "timeout", sentAt: T0 };
const refused401: ClientResult = { outcome: "failed", httpStatus: 401, kind: "credentials-rejected", sentAt: T0, receivedAt: T0 };

/** An in-memory store holding the database's rules. */
function memoryStore(options: { setUp?: boolean; today?: () => Date } = {}) {
  const runs = new Map<string, ProviderRun>();
  const requests = new Map<string, ProviderRequest[]>();
  const metrics = new Map<string, KeywordMetric[]>();
  let ids = 0;
  const id = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`;
  const today = options.today ?? (() => new Date(T0));
  const guard = () => {
    if (options.setUp === false) throw new SnapshotStoreNotSetUpError("test");
  };
  const spend = (except: string | null) => {
    let total = 0;
    for (const run of runs.values()) {
      if (run.mode !== "live" || run.id === except || run.createdAt.slice(0, 10) !== today().toISOString().slice(0, 10)) continue;
      total += (run.costUsd ?? run.estimateUsd) + run.unknownCostUsd;
    }
    return Math.round(total * 10_000) / 10_000;
  };
  const store: SnapshotStore = {
    storesSnapshots: true,
    async reserve(input) {
      guard();
      if (input.capUsd > 5 || input.estimateUsd > input.capUsd) throw new Error("22023");
      if (input.projectId === "no-such-project") return { status: "project-not-found" };
      if ([...runs.values()].some((run) => run.projectId === input.projectId && run.status === "reserved")) return { status: "run-active" };
      const estimate = input.mode === "live" ? input.estimateUsd : 0;
      const spent = spend(null);
      if (input.mode === "live" && spent + estimate > input.capUsd) return { status: "cap-reached", spentUsd: spent, capUsd: input.capUsd, estimateUsd: estimate };
      const run: ProviderRun = {
        id: id(), projectId: input.projectId, provider: "dataforseo", kind: "keyword-snapshot", mode: input.mode, apiHost: input.apiHost, seeds: input.seeds, locationCode: input.locationCode,
        languageCode: input.languageCode, status: "reserved", estimateUsd: estimate, costUsd: null, unknownCostUsd: 0, errorCode: null, requestedBy: input.operatorId, createdAt: today().toISOString(), finishedAt: null,
      };
      runs.set(run.id, run);
      requests.set(run.id, []);
      metrics.set(run.id, []);
      return { status: "reserved", run, spentUsd: spent };
    },
    async recordRequest(input) {
      guard();
      const run = runs.get(input.runId);
      if (!run) return { status: "run-not-found" };
      if (run.status !== "reserved") return { status: "run-not-open" };
      if (input.seq < 0 || input.seq > 20) throw new Error("23514");
      const existing = requests.get(run.id)!.find((r) => r.seq === input.seq);
      if (existing) return { status: "exists", request: existing };
      if (JSON.stringify(input.params).toLowerCase().includes("password")) throw new Error("22023");
      const request: ProviderRequest = { id: id(), ...input, costUsd: run.mode === "sandbox" && input.costUsd !== null ? 0 : input.costUsd };
      requests.get(run.id)!.push(request);
      return { status: "recorded", request };
    },
    async recordMetrics(runId, requestId, rows) {
      guard();
      const run = runs.get(runId);
      if (!run) return { status: "run-not-found" };
      if (run.status !== "reserved") return { status: "run-not-open" };
      const request = requests.get(runId)!.find((r) => r.id === requestId);
      if (!request) return { status: "request-not-found" };
      if (metrics.get(runId)!.some((m) => m.requestId === requestId)) return { status: "exists" };
      const have = new Set(metrics.get(runId)!.map((m) => `${m.seed}\u0000${m.keyword}`));
      if (rows.some((row) => !run.seeds.includes(row.seed) || have.has(`${row.seed}\u0000${row.keyword}`))) return { status: "invalid-row" };
      for (const row of rows) {
        metrics.get(runId)!.push({
          id: id(), runId, requestId, projectId: run.projectId, seed: row.seed, keyword: row.keyword, relation: row.relation, searchVolume: row.search_volume, cpc: row.cpc, competition: row.competition,
          keywordDifficulty: row.keyword_difficulty, intent: row.intent, monthlySearches: row.monthly_searches, providerUpdatedAt: row.provider_updated_at, provider: "dataforseo", mode: run.mode,
          locationCode: run.locationCode, languageCode: run.languageCode, fetchedAt: request.receivedAt ?? request.sentAt,
        });
      }
      return { status: "recorded", rows: rows.length };
    },
    async finish(input) {
      guard();
      const run = runs.get(input.runId);
      if (!run) return { status: "run-not-found" };
      if (run.status !== "reserved") return { status: "run-not-open" };
      const rows = requests.get(run.id)!;
      const sum = Math.round(rows.filter((r) => r.outcome === "succeeded").reduce((s, r) => s + (r.costUsd ?? 0), 0) * 10_000) / 10_000;
      if (run.mode === "sandbox" && (input.costUsd !== 0 || input.unknownCostUsd !== 0)) return { status: "cost-mismatch" };
      if (input.costUsd !== sum) return { status: "cost-mismatch" };
      if (input.status === "completed" && (rows.length === 0 || rows.some((r) => r.outcome !== "succeeded"))) return { status: "status-not-consistent" };
      const next: ProviderRun = { ...run, status: input.status, costUsd: sum, unknownCostUsd: run.mode === "live" ? input.unknownCostUsd : 0, errorCode: input.errorCode, finishedAt: today().toISOString() };
      runs.set(run.id, next);
      return { status: "finished", run: next };
    },
    async resume(runId, estimateUsd, capUsd, operatorId) {
      guard();
      const run = runs.get(runId);
      if (!run) return { status: "run-not-found" };
      if (run.status !== "partial") return { status: "run-not-partial" };
      if ([...runs.values()].some((r) => r.projectId === run.projectId && r.status === "reserved")) return { status: "run-active" };
      const estimate = run.mode === "live" ? estimateUsd : 0;
      const spent = Math.round((spend(run.id) + (run.costUsd ?? 0) + run.unknownCostUsd) * 10_000) / 10_000;
      if (run.mode === "live" && spent + estimate > capUsd) return { status: "cap-reached", spentUsd: spent, capUsd, estimateUsd: estimate };
      const next: ProviderRun = { ...run, status: "reserved", estimateUsd: Math.round(((run.costUsd ?? 0) + estimate) * 10_000) / 10_000, costUsd: null, errorCode: null, finishedAt: null, requestedBy: operatorId };
      runs.set(run.id, next);
      return { status: "reserved", run: next, spentUsd: spent };
    },
    async getRun(runId) {
      guard();
      return runs.get(runId) ?? null;
    },
    async listRuns(projectId, limit) {
      guard();
      return [...runs.values()].filter((r) => r.projectId === projectId).reverse().slice(0, limit);
    },
    async listRequests(runId) {
      guard();
      return [...(requests.get(runId) ?? [])].sort((a, b) => a.seq - b.seq);
    },
    async listMetrics(runId) {
      guard();
      return metrics.get(runId) ?? [];
    },
    async openRun(projectId) {
      guard();
      return [...runs.values()].find((r) => r.projectId === projectId && r.status === "reserved") ?? null;
    },
    async liveSpendToday() {
      guard();
      return spend(null);
    },
  };
  return { store, runs, requests, metrics };
}

const configured = (mode: "sandbox" | "live", cap = "1.00"): DataForSeoConfig => ({
  status: "configured",
  mode,
  credentials: { login: "fixture-login", password: "fixture-password" },
  dailyCap: cap === "bad" ? { ok: false, reason: "not-a-number" } : { ok: true, usd: Number(cap) },
});

function service(store: SnapshotStore, client: DataForSeoClient, config: DataForSeoConfig, extra: Partial<Parameters<typeof createKeywordSnapshotService>[1]> = {}) {
  return createKeywordSnapshotService(store, { config: () => config, client: () => client, now: () => new Date(T0), ...extra });
}

function fullAnswers(): Answer[] {
  return [(_, task) => succeeded(overviewBody(task.keywords as string[])), (_, task) => succeeded(relatedBody(task.keyword as string))];
}

describe("the contract", () => {
  test("the run request is the project only; ids are checked by shape; the cap's Retry-After reaches midnight UTC", () => {
    assert.deepEqual(parseRunRequest({ project: "nexra-agency" }), { ok: true, projectId: "nexra-agency" });
    for (const body of [null, [], {}, { project: "" }, { project: "Bad Id" }, { project: "nexra-agency", seeds: ["x"] }, { project: "nexra-agency", estimate: 0 }]) assert.equal(parseRunRequest(body).ok, false, JSON.stringify(body));
    assert.ok(isRunId("8d70dbb9-9237-4622-996e-82a65e8f1089") && !isRunId("8d70dbb9") && !isRunId(5));
    assert.equal(keywordSnapshotsUrl("nexra-agency"), "/api/keyword-snapshots?project=nexra-agency");
    assert.equal(secondsUntilMidnightUtc(new Date("2026-10-01T23:59:30Z")), 30);
    assert.equal(secondsUntilMidnightUtc(new Date("2026-10-01T00:00:00Z")), 86_400);
  });
});

describe("a full run", () => {
  test("live: estimate recomputed, reserved, 11 calls in order, every request and row recorded, finished completed with the recorded cost", async () => {
    const { store, requests, metrics } = memoryStore();
    const { client, calls } = fakeClient(fullAnswers());
    const result = await service(store, client, configured("live")).run("nexra-agency", OPERATOR);
    assert.equal(result.status, "finished");
    if (result.status !== "finished") return;
    assert.equal(calls.length, 11);
    assert.equal(calls[0].endpoint, ENDPOINTS.keywordOverview);
    assert.deepEqual(calls[0].task.keywords, SEED_TOPICS);
    assert.deepEqual(calls.slice(1).map((c) => c.task.keyword), SEED_TOPICS);
    assert.ok(calls.slice(1).every((c) => c.task.limit === 20 && c.task.depth === 1));
    assert.equal(result.run.status, "completed");
    assert.equal(result.run.estimateUsd, estimateRun(10).usd);
    assert.equal(result.run.costUsd, usd(0.0132 + 10 * 0.0144));
    assert.equal(result.run.unknownCostUsd, 0);
    assert.equal(result.run.errorCode, null);
    assert.equal(requests.get(result.run.id)!.length, 11);
    assert.deepEqual(requests.get(result.run.id)!.map((r) => r.seq), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.ok(requests.get(result.run.id)!.every((r) => r.outcome === "succeeded" && r.responseSha256 !== null && !JSON.stringify(r.params).includes("password")));
    assert.equal(metrics.get(result.run.id)!.length, 20, "10 seed rows + 10 related rows");
    assert.ok(metrics.get(result.run.id)!.every((m) => m.mode === "live" && m.projectId === "nexra-agency" && m.locationCode === 2840 && m.languageCode === "en"));
  });

  test("sandbox: estimate 0, every cost 0, the live spend untouched; a sandbox run while the cap is reached still runs", async () => {
    const { store } = memoryStore();
    const { client } = fakeClient(fullAnswers(), "sandbox");
    const result = await service(store, client, configured("sandbox")).run("nexra-agency", OPERATOR);
    assert.equal(result.status, "finished");
    if (result.status !== "finished") return;
    assert.deepEqual([result.run.mode, result.run.apiHost, result.run.estimateUsd, result.run.costUsd, result.run.status], ["sandbox", "sandbox.dataforseo.com", 0, 0, "completed"]);
    assert.equal(await store.liveSpendToday(new Date(T0)), 0);
  });

  test("the cap refuses before any call; the ceiling bounds the cap the server passes", async () => {
    const { store } = memoryStore();
    const { client, calls } = fakeClient(fullAnswers());
    const svc = service(store, client, configured("live", "0.10"));
    const result = await svc.run("nexra-agency", OPERATOR);
    assert.equal(result.status, "cap-reached");
    if (result.status === "cap-reached") assert.deepEqual([result.spentUsd, result.capUsd, result.estimateUsd], [0, 0.1, estimateRun(10).usd]);
    assert.equal(calls.length, 0, "nothing was sent");
    const ok = await service(store, client, configured("live", "1.00")).run("nexra-agency", OPERATOR);
    assert.equal(ok.status, "finished");
    const second = await service(store, fakeClient(fullAnswers()).client, configured("live", "0.20")).run("verdant-home", OPERATOR);
    assert.equal(second.status, "cap-reached", "today's recorded spend counts");
  });

  test("not configured, cap invalid, store not kept and the migration not applied are calm answers, never a call", async () => {
    const { client, calls } = fakeClient(fullAnswers());
    const unconfigured: DataForSeoConfig = { status: "unconfigured", mode: "sandbox" };
    assert.deepEqual(await service(memoryStore().store, client, unconfigured).run("nexra-agency", OPERATOR), { status: "not-configured" });
    assert.deepEqual(await service(memoryStore().store, client, configured("live", "bad")).run("nexra-agency", OPERATOR), { status: "cap-invalid", reason: "not-a-number" });
    const notSetUp = memoryStore({ setUp: false }).store;
    assert.deepEqual(await service(notSetUp, client, configured("sandbox")).run("nexra-agency", OPERATOR), { status: "not-set-up" });
    assert.deepEqual(await service(notSetUp, client, configured("sandbox")).read("nexra-agency"), { status: "not-set-up" });
    assert.deepEqual(await service(notSetUp, client, configured("sandbox")).usage("nexra-agency"), { status: "not-set-up" });
    const unavailable: SnapshotStore = { ...memoryStore().store, storesSnapshots: false };
    assert.deepEqual(await service(unavailable, client, configured("sandbox")).run("nexra-agency", OPERATOR), { status: "not-set-up" });
    assert.deepEqual(await service(unavailable, client, configured("sandbox")).read("nexra-agency"), { status: "not-set-up" });
    assert.equal(calls.length, 0);
    const read = await service(memoryStore().store, client, unconfigured).read("nexra-agency");
    assert.deepEqual(read, { status: "read", view: { projectId: "nexra-agency", provider: { status: "not-configured", mode: "sandbox" }, runs: [] } });
  });
});

describe("failures (§6)", () => {
  test("a timeout is recorded unknown at its estimate and never retried; the run ends partial with the missing seed", async () => {
    const { store, requests } = memoryStore();
    const answers: Answer[] = [(_, task) => succeeded(overviewBody(task.keywords as string[]))];
    for (let i = 0; i < 10; i += 1) answers.push(i === 2 ? timeout : (_, task) => succeeded(relatedBody(task.keyword as string)));
    const { client, calls } = fakeClient(answers);
    const result = await service(store, client, configured("live")).run("nexra-agency", OPERATOR);
    assert.equal(result.status, "finished");
    if (result.status !== "finished") return;
    assert.equal(calls.length, 11, "the timed-out call was not retried");
    assert.equal(result.run.status, "partial");
    assert.equal(result.run.errorCode, "incomplete");
    assert.equal(result.run.unknownCostUsd, 0.0144);
    assert.equal(result.run.costUsd, usd(0.0132 + 9 * 0.0144));
    const unknown = requests.get(result.run.id)!.find((r) => r.outcome === "unknown")!;
    assert.deepEqual([unknown.seq, unknown.costUsd, unknown.receivedAt], [3, null, null]);
    const view = await service(store, client, configured("live")).read("nexra-agency");
    assert.equal(view.status === "read" && view.view.runs[0].missingSeeds.join("|"), SEED_TOPICS[2]);
  });

  test("a credentials refusal stops the run at once: failed, nothing charged, no more calls", async () => {
    const { store } = memoryStore();
    const { client, calls } = fakeClient([refused401]);
    const result = await service(store, client, configured("live")).run("nexra-agency", OPERATOR);
    assert.equal(result.status, "finished");
    if (result.status !== "finished") return;
    assert.equal(calls.length, 1);
    assert.deepEqual([result.run.status, result.run.errorCode, result.run.costUsd], ["failed", "provider-refused", 0]);
    const provider = await service(store, fakeClient([succeeded({ status_code: 40101, status_message: "Auth error." })]).client, configured("live")).run("verdant-home", OPERATOR);
    assert.equal(provider.status === "finished" && provider.run.errorCode, "provider-refused");
    assert.ok(!JSON.stringify(provider).includes("Auth error"));
  });

  test("a provider refusal of one related call costs nothing and leaves that seed missing; a malformed body likewise", async () => {
    const { store, requests } = memoryStore();
    const answers: Answer[] = [(_, task) => succeeded(overviewBody(task.keywords as string[]))];
    for (let i = 0; i < 10; i += 1) {
      answers.push(i === 0 ? succeeded({ status_code: 20000, tasks: [{ id: "t", status_code: 40501, cost: 0, result: null }] }) : i === 1 ? succeeded("garbage") : (_, task) => succeeded(relatedBody(task.keyword as string)));
    }
    const result = await service(store, fakeClient(answers).client, configured("live")).run("nexra-agency", OPERATOR);
    assert.equal(result.status, "finished");
    if (result.status !== "finished") return;
    const failed = requests.get(result.run.id)!.filter((r) => r.outcome === "failed");
    assert.deepEqual(failed.map((r) => [r.seq, r.costUsd, r.providerStatusCode]), [[1, 0, 40501], [2, 0, null]]);
    assert.equal(result.run.status, "partial");
    assert.equal(result.run.costUsd, usd(0.0132 + 8 * 0.0144));
    assert.deepEqual(missingSeeds(result.run, requests.get(result.run.id)!), [SEED_TOPICS[0], SEED_TOPICS[1]]);
  });

  test("the deadline: no call starts after it; the run ends partial with code deadline", async () => {
    const { store } = memoryStore();
    let tick = 0;
    const clock = () => new Date(Date.parse(T0) + 100_000 * tick++);
    const result = await createKeywordSnapshotService(store, { config: () => configured("live"), client: () => fakeClient(fullAnswers()).client, now: clock, deadlineMs: 240_000 }).run("nexra-agency", OPERATOR);
    assert.equal(result.status, "finished");
    if (result.status !== "finished") return;
    assert.equal(result.run.status, "partial");
    assert.equal(result.run.errorCode, "deadline");
    assert.ok(result.requests.length < 11 && result.requests.length >= 1);
  });

  test("an open run older than ten minutes is finished abandoned before a new one is reserved; a fresh one answers run-active", async () => {
    const { store, runs } = memoryStore();
    const stale = await store.reserve({ projectId: "nexra-agency", seeds: SEED_TOPICS, locationCode: 2840, languageCode: "en", mode: "live", apiHost: "api.dataforseo.com", estimateUsd: 0.1, capUsd: 1, operatorId: OPERATOR });
    assert.equal(stale.status, "reserved");
    const fresh = service(store, fakeClient(fullAnswers()).client, configured("live"));
    assert.deepEqual(await fresh.run("nexra-agency", OPERATOR), { status: "run-active" });
    const later = createKeywordSnapshotService(store, { config: () => configured("live"), client: () => fakeClient(fullAnswers()).client, now: () => new Date(Date.parse(T0) + 11 * 60_000) });
    const result = await later.run("nexra-agency", OPERATOR);
    assert.equal(result.status, "finished");
    const abandoned = [...runs.values()].find((r) => r.errorCode === "abandoned");
    assert.ok(abandoned && abandoned.status === "failed");
  });
});

describe("resume (decision Q4)", () => {
  test("only an explicit request resumes a partial run, for the missing calls only, under new seqs and a fresh reservation", async () => {
    const { store, requests } = memoryStore();
    const answers: Answer[] = [(_, task) => succeeded(overviewBody(task.keywords as string[]))];
    for (let i = 0; i < 10; i += 1) answers.push(i === 4 || i === 7 ? timeout : (_, task) => succeeded(relatedBody(task.keyword as string)));
    const first = await service(store, fakeClient(answers).client, configured("live")).run("nexra-agency", OPERATOR);
    assert.equal(first.status, "finished");
    if (first.status !== "finished") return;
    assert.equal(first.run.status, "partial");
    assert.deepEqual(missingSeqs(first.run, requests.get(first.run.id)!), [5, 8]);

    const { client, calls } = fakeClient([(_, task) => succeeded(relatedBody(task.keyword as string))]);
    const svc = service(store, client, configured("live", "0.17"));
    const capped = await svc.resume(first.run.id, OPERATOR);
    assert.equal(capped.status, "cap-reached", "today's spend (the run's recorded 0.1284 and its 0.0288 unknown) plus the two calls, 0.0288, exceeds 0.17");
    if (capped.status === "cap-reached") assert.deepEqual([capped.spentUsd, capped.estimateUsd], [usd(0.0132 + 8 * 0.0144 + 2 * 0.0144), usd(2 * 0.0144)]);
    assert.equal(calls.length, 0);
    assert.deepEqual(await service(store, client, configured("live")).resume("00000000-0000-4000-8000-ffffffffffff", OPERATOR), { status: "run-not-found" });

    const resumed = await service(store, client, configured("live", "1.00")).resume(first.run.id, OPERATOR);
    assert.equal(resumed.status, "finished");
    if (resumed.status !== "finished") return;
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map((c) => c.task.keyword), [SEED_TOPICS[4], SEED_TOPICS[7]]);
    const rows = requests.get(first.run.id)!;
    assert.deepEqual(rows.filter((r) => r.seq > 10).map((r) => [r.seq, r.params.retry_of, r.outcome]), [[11, 5, "succeeded"], [12, 8, "succeeded"]]);
    assert.deepEqual(missingSeqs(resumed.run, rows), []);
    assert.equal(resumed.run.status, "partial", "the earlier timed-out rows stand, so the database's completed is not available; nothing is missing");
    assert.equal(resumed.run.errorCode, null);
    assert.equal(resumed.run.costUsd, usd(0.0132 + 10 * 0.0144));
    assert.equal(resumed.run.unknownCostUsd, usd(2 * 0.0144), "the two timeouts stay counted: the provider may have charged them");
    assert.deepEqual(await svc.resume(first.run.id, OPERATOR), { status: "run-not-partial" }, "nothing is missing any more");
    const view = await service(store, client, configured("live")).read("nexra-agency");
    assert.equal(view.status === "read" && view.view.runs[0].missingSeeds.length, 0);
  });

  test("a completed run and a failed run cannot be resumed; the usage read sums today's live runs", async () => {
    const { store } = memoryStore();
    const done = await service(store, fakeClient(fullAnswers()).client, configured("live")).run("nexra-agency", OPERATOR);
    assert.equal(done.status, "finished");
    if (done.status !== "finished") return;
    assert.deepEqual(await service(store, fakeClient([]).client, configured("live")).resume(done.run.id, OPERATOR), { status: "run-not-partial" });
    const usage = await service(store, fakeClient([]).client, configured("live", "2.00")).usage("nexra-agency");
    assert.deepEqual(usage, { status: "read", usage: { day: "2026-10-01", mode: "live", capUsd: 2, spentUsd: 0.1572, ceilingUsd: 5 } });
  });
});

describe("the row schema", () => {
  test("numeric columns arrive as text and are read as numbers; unknown outcomes are refused", () => {
    const row = {
      id: "r", project_id: "p", provider: "dataforseo", kind: "keyword-snapshot", mode: "live", api_host: "api.dataforseo.com", seeds: ["a"], location_code: 2840, language_code: "en", status: "completed",
      estimate_usd: "0.1572", cost_usd: "0.1500", unknown_cost_usd: "0.0000", error_code: null, requested_by: OPERATOR, created_at: T0, finished_at: T0,
    };
    const run = runRowToRun(row);
    assert.deepEqual([run.estimateUsd, run.costUsd, run.unknownCostUsd], [0.1572, 0.15, 0]);
    assert.throws(() => runRowToRun({ ...row, status: "done" }), /status "done"/);
    assert.throws(() => reserveResultToOutcome({ outcome: "maybe" }), /does not recognise/);
    const metric = metricRowToMetric({
      id: "m", run_id: "r", request_id: "q", project_id: "p", seed: "a", keyword: "a", relation: "seed", search_volume: null, cpc: "1.50", competition: "0.4200", keyword_difficulty: null, intent: null,
      monthly_searches: [{ year: 2026, month: 8, search_volume: 90 }], provider_updated_at: null, provider: "dataforseo", mode: "sandbox", location_code: 2840, language_code: "en", fetched_at: T0,
    });
    assert.deepEqual([metric.searchVolume, metric.cpc, metric.competition, metric.monthlySearches?.[0].search_volume], [null, 1.5, 0.42, 90]);
  });
});

describe("the boundaries", () => {
  const read = (path: string) => readFileSync(new URL(path, root), "utf8");
  test("every route checks the operator; writes are same-origin; no agent grounding reads the store", () => {
    for (const route of ["route.ts", "[runId]/resume/route.ts", "daily-usage/route.ts"]) {
      const text = read(`src/app/api/keyword-snapshots/${route}`);
      assert.match(text, /await getOperator\(\)/, route);
      assert.doesNotMatch(text, /error\.message|String\(error\)/, route);
      if (text.includes("export async function POST")) assert.match(text, /isSameOrigin\(request\)/, route);
    }
    assert.match(read("src/app/api/keyword-snapshots/route.ts"), /export const maxDuration = 300/);
    for (const file of ["src/lib/agent-runs/task-grounding.ts", "src/lib/agent-runs/index.ts"]) assert.doesNotMatch(read(file), /keyword-snapshots/, file);
    assert.match(read("src/lib/keyword-snapshots/index.ts"), /^import "server-only";/);
    assert.match(read("src/lib/keyword-snapshots/supabase/store.ts"), /^import "server-only";/);
    assert.doesNotMatch(read("src/lib/keyword-snapshots/service.ts"), /console\.|\.status_message|fetch\(/);
  });
});
