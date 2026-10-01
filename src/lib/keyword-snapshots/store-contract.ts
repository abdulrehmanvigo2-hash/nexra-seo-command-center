import type { KeywordMetric, ProviderRequest, ProviderRun, RequestOutcome, RunStatus } from "@/lib/keyword-snapshots/contract";
import type { Endpoint, ProviderMode } from "@/lib/providers/dataforseo/constants";
import type { MetricRow } from "@/lib/providers/dataforseo/parse";

/**
 * What the snapshot service needs from wherever the provider records are
 * kept (migration 20261016120000). Every write is one of the database's five
 * functions, which enforce the cap, the one-open-run rule, the shapes and
 * the guards for any caller; every read is bounded and scoped to one project.
 */

export type ReserveInput = {
  readonly projectId: string;
  readonly seeds: readonly string[];
  readonly locationCode: number;
  readonly languageCode: string;
  readonly mode: ProviderMode;
  readonly apiHost: string;
  readonly estimateUsd: number;
  readonly capUsd: number;
  readonly operatorId: string;
};

export type ReserveOutcome =
  | { readonly status: "reserved"; readonly run: ProviderRun; readonly spentUsd: number }
  | { readonly status: "cap-reached"; readonly spentUsd: number; readonly capUsd: number; readonly estimateUsd: number }
  | { readonly status: "run-active" }
  | { readonly status: "project-not-found" };

export type RecordRequestInput = {
  readonly runId: string;
  readonly seq: number;
  readonly endpoint: Endpoint;
  readonly params: Readonly<Record<string, unknown>>;
  readonly outcome: RequestOutcome;
  readonly providerStatusCode: number | null;
  readonly providerTaskId: string | null;
  readonly costUsd: number | null;
  readonly items: number | null;
  readonly responseSha256: string | null;
  readonly sentAt: string;
  readonly receivedAt: string | null;
};

export type RecordRequestOutcome =
  | { readonly status: "recorded" | "exists"; readonly request: ProviderRequest }
  | { readonly status: "run-not-found" | "run-not-open" };

export type RecordMetricsOutcome = { readonly status: "recorded"; readonly rows: number } | { readonly status: "exists" | "run-not-found" | "run-not-open" | "request-not-found" | "invalid-row" };

export type FinishInput = { readonly runId: string; readonly status: Exclude<RunStatus, "reserved">; readonly costUsd: number; readonly unknownCostUsd: number; readonly errorCode: string | null };
export type FinishOutcome = { readonly status: "finished"; readonly run: ProviderRun } | { readonly status: "run-not-found" | "run-not-open" | "cost-mismatch" | "status-not-consistent" };

export type ResumeOutcome =
  | { readonly status: "reserved"; readonly run: ProviderRun; readonly spentUsd: number }
  | { readonly status: "cap-reached"; readonly spentUsd: number; readonly capUsd: number; readonly estimateUsd: number }
  | { readonly status: "run-active" | "run-not-partial" | "run-not-found" };

/** The store cannot reach the migration's objects: the tables or functions do not exist on this database yet. */
export class SnapshotStoreNotSetUpError extends Error {
  constructor(operation: string) {
    super(`Keyword snapshot store: ${operation} found no provider snapshot schema (migration 20261016120000 not applied).`);
    this.name = "SnapshotStoreNotSetUpError";
  }
}

export type SnapshotStore = {
  /** Whether this deployment keeps provider records at all. The fixture data source does not. */
  readonly storesSnapshots: boolean;
  reserve(input: ReserveInput): Promise<ReserveOutcome>;
  recordRequest(input: RecordRequestInput): Promise<RecordRequestOutcome>;
  recordMetrics(runId: string, requestId: string, rows: readonly MetricRow[]): Promise<RecordMetricsOutcome>;
  finish(input: FinishInput): Promise<FinishOutcome>;
  resume(runId: string, estimateUsd: number, capUsd: number, operatorId: string): Promise<ResumeOutcome>;
  getRun(runId: string): Promise<ProviderRun | null>;
  /** The project's runs, newest first, bounded. Never another project's. */
  listRuns(projectId: string, limit: number): Promise<readonly ProviderRun[]>;
  listRequests(runId: string): Promise<readonly ProviderRequest[]>;
  listMetrics(runId: string, limit: number): Promise<readonly KeywordMetric[]>;
  /** The project's one open run, if any (to finish an abandoned one before reserving). */
  openRun(projectId: string): Promise<ProviderRun | null>;
  /** Today's live spend in US dollars, by the reserve function's rule, read for the confirmation. */
  liveSpendToday(at: Date): Promise<number>;
};

export const unavailableSnapshotStore: SnapshotStore = {
  storesSnapshots: false,
  async reserve() {
    return { status: "project-not-found" };
  },
  async recordRequest() {
    return { status: "run-not-found" };
  },
  async recordMetrics() {
    return { status: "run-not-found" };
  },
  async finish() {
    return { status: "run-not-found" };
  },
  async resume() {
    return { status: "run-not-found" };
  },
  async getRun() {
    return null;
  },
  async listRuns() {
    return [];
  },
  async listRequests() {
    return [];
  },
  async listMetrics() {
    return [];
  },
  async openRun() {
    return null;
  },
  async liveSpendToday() {
    return 0;
  },
};
