import {
  METRIC_READ_LIMIT,
  RUN_READ_LIMIT,
  utcDayOf,
  type ProviderReadiness,
  type ProviderRequest,
  type ProviderRun,
  type SnapshotRunView,
  type SnapshotUsage,
  type SnapshotView,
} from "@/lib/keyword-snapshots/contract";
import { SnapshotStoreNotSetUpError, type RecordRequestInput, type SnapshotStore } from "@/lib/keyword-snapshots/store-contract";
import type { ClientResult, DataForSeoClient } from "@/lib/providers/dataforseo/client";
import type { DataForSeoConfig } from "@/lib/providers/dataforseo/config";
import { API_HOSTS, DAILY_CAP_CEILING_USD, ENDPOINTS, LANGUAGE_CODE, LOCATION_CODE, SEED_TOPICS, type ProviderMode } from "@/lib/providers/dataforseo/constants";
import { estimateCalls, estimateRun } from "@/lib/providers/dataforseo/estimate";
import { overviewTask, parseAnswer, relatedTask } from "@/lib/providers/dataforseo/parse";

/**
 * The keyword snapshot service (F0, §4–§6). One run: the server recomputes
 * the estimate, reserves against the cap through the database, makes the
 * calls one after another under a deadline, records each as it returns, and
 * finishes the run. Nothing is retried in live mode: a timeout is recorded
 * `unknown` and counted at its estimate. A partial run resumes only through
 * an explicit request (decision Q4), never on its own. Every failure is a
 * fixed code; the provider's text never leaves the client.
 */

export type SnapshotServiceOptions = {
  /** The server environment's provider settings, read at call time. */
  readonly config: () => DataForSeoConfig;
  readonly client: (config: Extract<DataForSeoConfig, { status: "configured" }>) => DataForSeoClient;
  readonly now?: () => Date;
  /** No call starts after this many milliseconds; the run ends partial (§6). */
  readonly deadlineMs?: number;
  /** A run left in `reserved` for longer than this is finished `abandoned` by the next attempt (§6). */
  readonly abandonAfterMs?: number;
};

export const RUN_DEADLINE_MS = 240_000;
export const ABANDON_AFTER_MS = 10 * 60_000;

export type RunFailure =
  | { readonly status: "not-set-up" }
  | { readonly status: "not-configured" }
  | { readonly status: "cap-invalid"; readonly reason: "not-a-number" | "negative" | "above-ceiling" }
  | { readonly status: "cap-reached"; readonly spentUsd: number; readonly capUsd: number; readonly estimateUsd: number }
  | { readonly status: "run-active" }
  | { readonly status: "project-not-found" }
  | { readonly status: "run-not-found" }
  | { readonly status: "run-not-partial" };

export type RunResult = RunFailure | { readonly status: "finished"; readonly run: ProviderRun; readonly requests: readonly ProviderRequest[] };
export type ReadResult = { readonly status: "not-set-up" } | { readonly status: "read"; readonly view: SnapshotView };
export type UsageResult = { readonly status: "not-set-up" } | { readonly status: "read"; readonly usage: SnapshotUsage };

export type KeywordSnapshotService = {
  run(projectId: string, operatorId: string): Promise<RunResult>;
  resume(runId: string, operatorId: string): Promise<RunResult>;
  read(projectId: string): Promise<ReadResult>;
  usage(projectId: string): Promise<UsageResult>;
};

/** Seq 0 is the overview; seq i (1-based) the related call for seed i − 1. */
export function seedForSeq(seq: number, seeds: readonly string[]): string | null {
  return seq === 0 ? null : (seeds[seq - 1] ?? null);
}

/** The seeds a run still lacks: every seed when the overview has not succeeded, plus each seed whose related call has not. */
export function missingSeeds(run: ProviderRun, requests: readonly ProviderRequest[]): readonly string[] {
  const succeeded = new Set<number>();
  for (const request of requests) {
    if (request.outcome !== "succeeded") continue;
    const original = typeof request.params.retry_of === "number" ? request.params.retry_of : request.seq;
    succeeded.add(original);
  }
  if (!succeeded.has(0)) return run.seeds;
  return run.seeds.filter((_, index) => !succeeded.has(index + 1));
}

/** The original seqs a run still lacks (0 for the overview, i for seed i − 1). */
export function missingSeqs(run: ProviderRun, requests: readonly ProviderRequest[]): readonly number[] {
  const succeeded = new Set<number>();
  for (const request of requests) {
    if (request.outcome !== "succeeded") continue;
    succeeded.add(typeof request.params.retry_of === "number" ? request.params.retry_of : request.seq);
  }
  const seqs: number[] = [];
  for (let seq = 0; seq <= run.seeds.length; seq += 1) if (!succeeded.has(seq)) seqs.push(seq);
  return seqs;
}

function readiness(config: DataForSeoConfig): ProviderReadiness {
  if (config.status === "unconfigured") return { status: "not-configured", mode: config.mode };
  if (!config.dailyCap.ok) return { status: "cap-invalid", mode: config.mode, message: "The daily cap variable is not a usable dollar amount; every run is refused until it is corrected." };
  return { status: "ready", mode: config.mode, capUsd: config.dailyCap.usd };
}

export function createKeywordSnapshotService(store: SnapshotStore, options: SnapshotServiceOptions): KeywordSnapshotService {
  const { config: readConfig, client: makeClient, now = () => new Date(), deadlineMs = RUN_DEADLINE_MS, abandonAfterMs = ABANDON_AFTER_MS } = options;

  async function notSetUp<T>(work: () => Promise<T>): Promise<T | { readonly status: "not-set-up" }> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof SnapshotStoreNotSetUpError) return { status: "not-set-up" };
      throw error;
    }
  }

  /** One provider call, recorded whatever it answers. Returns the recorded request and whether it succeeded. */
  async function call(client: DataForSeoClient, run: ProviderRun, seq: number, originalSeq: number, mode: ProviderMode): Promise<{ readonly request: ProviderRequest | null; readonly stop: "credentials" | null }> {
    const seed = seedForSeq(originalSeq, run.seeds);
    const endpoint = originalSeq === 0 ? ENDPOINTS.keywordOverview : ENDPOINTS.relatedKeywords;
    const task = originalSeq === 0 ? overviewTask(run.seeds) : relatedTask(seed ?? "");
    const params: Record<string, unknown> = seq === originalSeq ? { ...task } : { ...task, retry_of: originalSeq };
    const result: ClientResult = await client.post(endpoint, [task]);

    let record: RecordRequestInput;
    let stop: "credentials" | null = null;
    let parsedRows: ReturnType<typeof parseAnswer> | null = null;
    if (result.outcome === "unknown") {
      record = { runId: run.id, seq, endpoint, params, outcome: "unknown", providerStatusCode: null, providerTaskId: null, costUsd: null, items: null, responseSha256: null, sentAt: result.sentAt, receivedAt: null };
    } else if (result.outcome === "failed") {
      stop = result.kind === "credentials-rejected" ? "credentials" : null;
      record = { runId: run.id, seq, endpoint, params, outcome: "failed", providerStatusCode: result.httpStatus, providerTaskId: null, costUsd: 0, items: null, responseSha256: null, sentAt: result.sentAt, receivedAt: result.receivedAt };
    } else {
      const parsed = parseAnswer(endpoint, result.body, run.seeds, seed);
      if (parsed.ok) {
        parsedRows = parsed;
        record = {
          runId: run.id, seq, endpoint, params, outcome: "succeeded", providerStatusCode: parsed.providerStatusCode, providerTaskId: parsed.taskId,
          costUsd: mode === "sandbox" ? 0 : parsed.costUsd, items: parsed.items, responseSha256: result.sha256, sentAt: result.sentAt, receivedAt: result.receivedAt,
        };
      } else {
        // A provider refusal is not charged; a malformed body is treated the same (nothing usable arrived).
        stop = parsed.reason === "provider-refused" && parsed.providerStatusCode >= 40100 && parsed.providerStatusCode < 40200 ? "credentials" : null;
        record = { runId: run.id, seq, endpoint, params, outcome: "failed", providerStatusCode: parsed.providerStatusCode, providerTaskId: parsed.taskId, costUsd: 0, items: null, responseSha256: result.sha256, sentAt: result.sentAt, receivedAt: result.receivedAt };
      }
    }

    const recorded = await store.recordRequest(record);
    if (recorded.status !== "recorded" && recorded.status !== "exists") return { request: null, stop };
    if (parsedRows?.ok && recorded.status === "recorded") {
      await store.recordMetrics(run.id, recorded.request.id, parsedRows.rows);
    }
    return { request: recorded.request, stop };
  }

  /** Makes the calls for the given original seqs under new seqs, then finishes the run. */
  async function execute(client: DataForSeoClient, run: ProviderRun, originalSeqs: readonly number[], nextSeq: number, earlier: readonly ProviderRequest[]): Promise<RunResult> {
    const started = now().getTime();
    const requests: ProviderRequest[] = [...earlier];
    const unknownSeqs: number[] = [];
    let stopped: "credentials" | "deadline" | null = null;
    let seq = nextSeq;
    for (const original of originalSeqs) {
      if (now().getTime() - started > deadlineMs) {
        stopped = "deadline";
        break;
      }
      const { request, stop } = await call(client, run, seq, original, run.mode);
      if (request !== null) requests.push(request);
      if (request?.outcome === "unknown") unknownSeqs.push(original);
      seq += 1;
      if (stop !== null) {
        stopped = stop;
        break;
      }
    }

    const succeeded = requests.filter((request) => request.outcome === "succeeded");
    const costUsd = run.mode === "sandbox" ? 0 : Math.round(succeeded.reduce((sum, request) => sum + (request.costUsd ?? 0), 0) * 10_000) / 10_000;
    const unknownCostUsd = run.mode === "sandbox" ? 0 : Math.round((run.unknownCostUsd + estimateCalls(unknownSeqs, run.seeds.length)) * 10_000) / 10_000;
    const remaining = missingSeqs(run, requests);
    // The database's `completed` needs every recorded call succeeded; a resumed run keeps its earlier failed or
    // unknown rows, so it closes as `partial` with no error code and no missing seed (the screen reads that as complete).
    const everyCallSucceeded = requests.every((request) => request.outcome === "succeeded");
    const status = remaining.length === 0 ? (everyCallSucceeded ? "completed" : "partial") : succeeded.length > 0 ? "partial" : "failed";
    const errorCode = stopped === "credentials" ? "provider-refused" : stopped === "deadline" ? "deadline" : status === "failed" ? "provider-error" : remaining.length > 0 ? "incomplete" : null;
    const finished = await store.finish({ runId: run.id, status, costUsd, unknownCostUsd, errorCode });
    if (finished.status !== "finished") {
      // The database refused the figures: record the run as failed with the recorded sum so nothing is left open.
      const retried = await store.finish({ runId: run.id, status: "failed", costUsd, unknownCostUsd, errorCode: `finish-${finished.status}` });
      if (retried.status !== "finished") return { status: "run-not-found" };
      return { status: "finished", run: retried.run, requests };
    }
    return { status: "finished", run: finished.run, requests };
  }

  async function prepare(): Promise<RunFailure | { readonly status: "ok"; readonly config: Extract<DataForSeoConfig, { status: "configured" }>; readonly capUsd: number }> {
    if (!store.storesSnapshots) return { status: "not-set-up" };
    const config = readConfig();
    if (config.status === "unconfigured") return { status: "not-configured" };
    if (!config.dailyCap.ok) return { status: "cap-invalid", reason: config.dailyCap.reason };
    return { status: "ok", config, capUsd: Math.min(config.dailyCap.usd, DAILY_CAP_CEILING_USD) };
  }

  return {
    async run(projectId, operatorId) {
      const prepared = await prepare();
      if (prepared.status !== "ok") return prepared;
      const { config, capUsd } = prepared;
      return (await notSetUp(async (): Promise<RunResult> => {
        // A run abandoned by a crashed process is closed before a new one is reserved (§6).
        const open = await store.openRun(projectId);
        if (open !== null && now().getTime() - Date.parse(open.createdAt) > abandonAfterMs) {
          const earlier = await store.listRequests(open.id);
          const cost = open.mode === "sandbox" ? 0 : Math.round(earlier.filter((r) => r.outcome === "succeeded").reduce((sum, r) => sum + (r.costUsd ?? 0), 0) * 10_000) / 10_000;
          await store.finish({ runId: open.id, status: "failed", costUsd: cost, unknownCostUsd: open.unknownCostUsd, errorCode: "abandoned" });
        }
        const seeds = SEED_TOPICS;
        const estimate = config.mode === "live" ? estimateRun(seeds.length).usd : 0;
        // The database raises on an estimate above the cap; answer the same refusal without the raise.
        if (estimate > capUsd) return { status: "cap-reached", spentUsd: await store.liveSpendToday(now()), capUsd, estimateUsd: estimate };
        const reserved = await store.reserve({ projectId, seeds, locationCode: LOCATION_CODE, languageCode: LANGUAGE_CODE, mode: config.mode, apiHost: API_HOSTS[config.mode], estimateUsd: estimate, capUsd, operatorId });
        if (reserved.status !== "reserved") return reserved;
        const originalSeqs = Array.from({ length: seeds.length + 1 }, (_, index) => index);
        return execute(makeClient(config), reserved.run, originalSeqs, 0, []);
      })) as RunResult;
    },

    async resume(runId, operatorId) {
      const prepared = await prepare();
      if (prepared.status !== "ok") return prepared;
      const { config, capUsd } = prepared;
      return (await notSetUp(async (): Promise<RunResult> => {
        const run = await store.getRun(runId);
        if (run === null) return { status: "run-not-found" };
        if (run.status !== "partial") return { status: "run-not-partial" };
        const earlier = await store.listRequests(run.id);
        const missing = missingSeqs(run, earlier);
        if (missing.length === 0) return { status: "run-not-partial" };
        // Retries take the free seqs after the originals; a partial run has at most 10 missing calls, which fit in 11–20.
        const nextSeq = Math.max(run.seeds.length, ...earlier.map((request) => request.seq)) + 1;
        const estimate = run.mode === "live" ? estimateCalls(missing, run.seeds.length) : 0;
        if (estimate > capUsd) return { status: "cap-reached", spentUsd: await store.liveSpendToday(now()), capUsd, estimateUsd: estimate };
        const resumed = await store.resume(run.id, estimate, capUsd, operatorId);
        if (resumed.status !== "reserved") return resumed;
        return execute(makeClient(config), resumed.run, missing, nextSeq, earlier);
      })) as RunResult;
    },

    async read(projectId) {
      const provider = readiness(readConfig());
      if (!store.storesSnapshots) return { status: "not-set-up" };
      return (await notSetUp(async (): Promise<ReadResult> => {
        const runs = await store.listRuns(projectId, RUN_READ_LIMIT);
        const views: SnapshotRunView[] = [];
        for (const run of runs.filter((candidate) => candidate.projectId === projectId)) {
          const [requests, metrics] = await Promise.all([store.listRequests(run.id), store.listMetrics(run.id, METRIC_READ_LIMIT)]);
          views.push({ run, requests, metrics: metrics.filter((metric) => metric.projectId === projectId), missingSeeds: missingSeeds(run, requests) });
        }
        return { status: "read", view: { projectId, provider, runs: views } };
      })) as ReadResult;
    },

    async usage() {
      if (!store.storesSnapshots) return { status: "not-set-up" };
      const config = readConfig();
      const at = now();
      return (await notSetUp(async (): Promise<UsageResult> => {
        const spentUsd = await store.liveSpendToday(at);
        return {
          status: "read",
          usage: { day: utcDayOf(at), mode: config.mode, capUsd: config.status === "configured" && config.dailyCap.ok ? config.dailyCap.usd : null, spentUsd, ceilingUsd: DAILY_CAP_CEILING_USD },
        };
      })) as UsageResult;
    },
  };
}
