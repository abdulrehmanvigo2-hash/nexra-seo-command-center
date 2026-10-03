import type { ProviderReadiness, ProviderRequest } from "@/lib/keyword-snapshots/contract";
import type { RecordRequestInput } from "@/lib/keyword-snapshots/store-contract";
import type { ClientResult, DataForSeoClient } from "@/lib/providers/dataforseo/client";
import type { DataForSeoConfig } from "@/lib/providers/dataforseo/config";
import { API_HOSTS, DAILY_CAP_CEILING_USD, ENDPOINTS, LANGUAGE_CODE, LOCATION_CODE, SERP_PRICE_PER_CALL_USD } from "@/lib/providers/dataforseo/constants";
import { SERP_RESULT_READ_LIMIT, SERP_RUN_READ_LIMIT, type SerpRun, type SerpRunView, type SerpView } from "@/lib/serp/contract";
import { parseSerpAnswer, serpTask } from "@/lib/serp/parse";
import { SerpStoreNotSetUpError, type SerpStore } from "@/lib/serp/store-contract";

/**
 * The SERP service (M4, PR 3). One run is one paid call: the server reserves against the shared daily cap through the
 * database (which chooses the keyword from the accepted opportunity), makes the call once — never retried in live mode;
 * a timeout is recorded `unknown` and counted at its estimate — records the call and the results, and finishes the run.
 * Every failure is a fixed code; the provider's text never leaves the client.
 */

export type SerpServiceOptions = {
  readonly config: () => DataForSeoConfig;
  readonly client: (config: Extract<DataForSeoConfig, { status: "configured" }>) => DataForSeoClient;
  readonly now?: () => Date;
  readonly abandonAfterMs?: number;
};

export const ABANDON_AFTER_MS = 10 * 60_000;

export type SerpRunResult =
  | { readonly status: "not-set-up" | "not-configured" | "run-active" | "project-not-found" | "opportunity-not-found" | "failed-to-record" }
  | { readonly status: "cap-invalid"; readonly reason: "not-a-number" | "negative" | "above-ceiling" }
  | { readonly status: "cap-reached"; readonly spentUsd: number; readonly capUsd: number; readonly estimateUsd: number }
  | { readonly status: "finished"; readonly run: SerpRun; readonly request: ProviderRequest | null; readonly results: number };

export type SerpReadResult = { readonly status: "not-set-up" } | { readonly status: "read"; readonly view: SerpView };

export type SerpService = {
  run(projectId: string, opportunityId: string, operatorId: string): Promise<SerpRunResult>;
  read(projectId: string, opportunityId: string | null): Promise<SerpReadResult>;
};

function readiness(config: DataForSeoConfig): ProviderReadiness {
  if (config.status === "unconfigured") return { status: "not-configured", mode: config.mode };
  if (!config.dailyCap.ok) return { status: "cap-invalid", mode: config.mode, message: "The daily cap variable is not a usable dollar amount; every run is refused until it is corrected." };
  return { status: "ready", mode: config.mode, capUsd: config.dailyCap.usd };
}

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

export function createSerpService(store: SerpStore, options: SerpServiceOptions): SerpService {
  const { config: readConfig, client: makeClient, now = () => new Date(), abandonAfterMs = ABANDON_AFTER_MS } = options;

  async function guarded<T>(work: () => Promise<T>): Promise<T | { readonly status: "not-set-up" }> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof SerpStoreNotSetUpError) return { status: "not-set-up" };
      throw error;
    }
  }

  async function call(client: DataForSeoClient, run: SerpRun): Promise<{ readonly request: ProviderRequest | null; readonly results: number; readonly kind: "succeeded" | "failed" | "unknown" | "refused" }> {
    const keyword = run.seeds[0] ?? "";
    const task = serpTask(keyword);
    const result: ClientResult = await client.post(ENDPOINTS.serpOrganic, [task]);
    const base = { runId: run.id, seq: 0, endpoint: ENDPOINTS.serpOrganic, params: { ...task } } as const;
    let record: RecordRequestInput;
    let parsed: ReturnType<typeof parseSerpAnswer> | null = null;
    let kind: "succeeded" | "failed" | "unknown" | "refused" = "failed";
    if (result.outcome === "unknown") {
      kind = "unknown";
      record = { ...base, outcome: "unknown", providerStatusCode: null, providerTaskId: null, costUsd: null, items: null, responseSha256: null, sentAt: result.sentAt, receivedAt: null };
    } else if (result.outcome === "failed") {
      kind = result.kind === "credentials-rejected" ? "refused" : "failed";
      record = { ...base, outcome: "failed", providerStatusCode: result.httpStatus, providerTaskId: null, costUsd: 0, items: null, responseSha256: null, sentAt: result.sentAt, receivedAt: result.receivedAt };
    } else {
      parsed = parseSerpAnswer(result.body);
      if (parsed.ok) {
        kind = "succeeded";
        record = {
          ...base, outcome: "succeeded", providerStatusCode: parsed.providerStatusCode, providerTaskId: parsed.taskId,
          costUsd: run.mode === "sandbox" ? 0 : parsed.costUsd, items: parsed.items, responseSha256: result.sha256, sentAt: result.sentAt, receivedAt: result.receivedAt,
        };
      } else {
        kind = parsed.reason === "provider-refused" && parsed.providerStatusCode >= 40100 && parsed.providerStatusCode < 40200 ? "refused" : "failed";
        record = { ...base, outcome: "failed", providerStatusCode: parsed.providerStatusCode, providerTaskId: parsed.taskId, costUsd: 0, items: null, responseSha256: result.sha256, sentAt: result.sentAt, receivedAt: result.receivedAt };
      }
    }
    const recorded = await store.recordRequest(record);
    if (recorded.status !== "recorded" && recorded.status !== "exists") return { request: null, results: 0, kind };
    let results = 0;
    if (parsed?.ok && recorded.status === "recorded") {
      const written = await store.recordResults(run.id, recorded.request.id, parsed.rows);
      results = written.status === "recorded" ? written.rows : 0;
    }
    return { request: recorded.request, results, kind };
  }

  return {
    async run(projectId, opportunityId, operatorId) {
      if (!store.storesSerp) return { status: "not-set-up" };
      const config = readConfig();
      if (config.status === "unconfigured") return { status: "not-configured" };
      if (!config.dailyCap.ok) return { status: "cap-invalid", reason: config.dailyCap.reason };
      const capUsd = Math.min(config.dailyCap.usd, DAILY_CAP_CEILING_USD);
      return (await guarded(async (): Promise<SerpRunResult> => {
        // A run of either kind left open by a crashed process is closed before a new one is reserved.
        const open = await store.openRun(projectId);
        if (open !== null && now().getTime() - Date.parse(open.createdAt) > abandonAfterMs) {
          const earlier = await store.listRequests(open.id);
          const cost = open.mode === "sandbox" ? 0 : round4(earlier.filter((r) => r.outcome === "succeeded").reduce((sum, r) => sum + (r.costUsd ?? 0), 0));
          await store.finish({ runId: open.id, status: "failed", costUsd: cost, unknownCostUsd: open.unknownCostUsd, errorCode: "abandoned" });
        }
        const estimate = config.mode === "live" ? SERP_PRICE_PER_CALL_USD : 0;
        if (estimate > capUsd) return { status: "cap-reached", spentUsd: await store.liveSpendToday(now()), capUsd, estimateUsd: estimate };
        const reserved = await store.reserve({ projectId, opportunityId, locationCode: LOCATION_CODE, languageCode: LANGUAGE_CODE, mode: config.mode, apiHost: API_HOSTS[config.mode], estimateUsd: estimate, capUsd, operatorId });
        if (reserved.status !== "reserved") return reserved;
        const run = reserved.run;
        const { request, results, kind } = await call(makeClient(config), run);
        const costUsd = run.mode === "sandbox" || request?.outcome !== "succeeded" ? 0 : round4(request.costUsd ?? 0);
        const unknownCostUsd = run.mode === "live" && kind === "unknown" ? estimate : 0;
        const status = request?.outcome === "succeeded" ? "completed" : "failed";
        const errorCode = status === "completed" ? null : kind === "refused" ? "provider-refused" : kind === "unknown" ? "provider-timeout" : request === null ? "record-failed" : "provider-error";
        const finished = await store.finish({ runId: run.id, status, costUsd, unknownCostUsd, errorCode });
        if (finished.status !== "finished") {
          const retried = await store.finish({ runId: run.id, status: "failed", costUsd, unknownCostUsd, errorCode: `finish-${finished.status}` });
          if (retried.status !== "finished") return { status: "failed-to-record" };
          return { status: "finished", run: { ...run, ...retried.run, kind: "serp", opportunityId: run.opportunityId }, request, results };
        }
        return { status: "finished", run: { ...run, ...finished.run, kind: "serp", opportunityId: run.opportunityId }, request, results };
      })) as SerpRunResult;
    },

    async read(projectId, opportunityId) {
      const provider = readiness(readConfig());
      if (!store.storesSerp) return { status: "not-set-up" };
      return (await guarded(async (): Promise<SerpReadResult> => {
        const runs = (await store.listRuns(projectId, opportunityId, SERP_RUN_READ_LIMIT)).filter(
          (run) => run.projectId === projectId && (opportunityId === null || run.opportunityId === opportunityId),
        );
        const views: SerpRunView[] = [];
        for (const run of runs) {
          const [requests, results] = await Promise.all([store.listRequests(run.id), store.listResults(run.id, SERP_RESULT_READ_LIMIT)]);
          views.push({ run, requests, results: results.filter((result) => result.runId === run.id) });
        }
        return { status: "read", view: { projectId, provider, runs: views } };
      })) as SerpReadResult;
    },
  };
}
