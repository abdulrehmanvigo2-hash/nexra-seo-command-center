import type { FinishInput, FinishOutcome, RecordRequestInput, RecordRequestOutcome } from "@/lib/keyword-snapshots/store-contract";
import type { ProviderRequest, ProviderRun } from "@/lib/keyword-snapshots/contract";
import type { SerpResult, SerpRun } from "@/lib/serp/contract";
import type { ProviderMode } from "@/lib/providers/dataforseo/constants";
import type { SerpRow } from "@/lib/serp/parse";

/**
 * What the SERP service needs from the provider records (migrations 20261016120000 and 20261024120000). The writes are
 * the database's functions — the SERP reserve and record, and F0's request record and finish — which enforce the cap,
 * the one-open-run rule, the endpoint by kind and the shapes for any caller; the reads are bounded and project-scoped.
 */

export type SerpReserveInput = {
  readonly projectId: string;
  readonly opportunityId: string;
  readonly locationCode: number;
  readonly languageCode: string;
  readonly mode: ProviderMode;
  readonly apiHost: string;
  readonly estimateUsd: number;
  readonly capUsd: number;
  readonly operatorId: string;
};

export type SerpReserveOutcome =
  | { readonly status: "reserved"; readonly run: SerpRun; readonly spentUsd: number }
  | { readonly status: "cap-reached"; readonly spentUsd: number; readonly capUsd: number; readonly estimateUsd: number }
  | { readonly status: "run-active" | "project-not-found" | "opportunity-not-found" };

export type RecordSerpOutcome = { readonly status: "recorded"; readonly rows: number } | { readonly status: "exists" | "run-not-found" | "run-not-open" | "request-not-found" | "invalid-row" };

/** The store cannot reach 20261024120000's objects. */
export class SerpStoreNotSetUpError extends Error {
  constructor(operation: string) {
    super(`SERP store: ${operation} found no SERP schema (migration 20261024120000 not applied).`);
    this.name = "SerpStoreNotSetUpError";
  }
}

export type SerpStore = {
  readonly storesSerp: boolean;
  reserve(input: SerpReserveInput): Promise<SerpReserveOutcome>;
  recordRequest(input: RecordRequestInput): Promise<RecordRequestOutcome | { readonly status: "endpoint-not-for-kind" }>;
  recordResults(runId: string, requestId: string, rows: readonly SerpRow[]): Promise<RecordSerpOutcome>;
  finish(input: FinishInput): Promise<FinishOutcome>;
  /** The project's SERP runs, newest first, bounded; one opportunity's when given. */
  listRuns(projectId: string, opportunityId: string | null, limit: number): Promise<readonly SerpRun[]>;
  listRequests(runId: string): Promise<readonly ProviderRequest[]>;
  listResults(runId: string, limit: number): Promise<readonly SerpResult[]>;
  /** The project's one open run of either kind (a crashed SERP run is finished `abandoned` before a new one). */
  openRun(projectId: string): Promise<ProviderRun | null>;
  liveSpendToday(at: Date): Promise<number>;
};

export const unavailableSerpStore: SerpStore = {
  storesSerp: false,
  async reserve() {
    return { status: "project-not-found" };
  },
  async recordRequest() {
    return { status: "run-not-found" };
  },
  async recordResults() {
    return { status: "run-not-found" };
  },
  async finish() {
    return { status: "run-not-found" };
  },
  async listRuns() {
    return [];
  },
  async listRequests() {
    return [];
  },
  async listResults() {
    return [];
  },
  async openRun() {
    return null;
  },
  async liveSpendToday() {
    return 0;
  },
};
