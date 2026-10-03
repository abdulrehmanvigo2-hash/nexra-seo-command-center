import type { KeywordMetric, ProviderRequest, ProviderRun } from "@/lib/keyword-snapshots/contract";
import type { FinishOutcome, RecordMetricsOutcome, RecordRequestOutcome, ReserveOutcome, ResumeOutcome } from "@/lib/keyword-snapshots/store-contract";
import { ENDPOINTS } from "@/lib/providers/dataforseo/constants";

/**
 * The shape of the three provider tables, what the five functions answer,
 * and the translation into the application's types (migration
 * 20261016120000). The tables grant no INSERT, UPDATE or DELETE: the
 * functions are the only way in. A row that does not match what the
 * migration declares is refused at read time rather than passed on.
 */

export class SnapshotRowError extends Error {
  constructor(message: string) {
    super(`Provider snapshot row: ${message}`);
    this.name = "SnapshotRowError";
  }
}

export type ProviderRunRow = {
  id: string;
  project_id: string;
  provider: string;
  kind: string;
  mode: string;
  api_host: string;
  seeds: string[];
  location_code: number;
  language_code: string;
  status: string;
  estimate_usd: number | string;
  cost_usd: number | string | null;
  unknown_cost_usd: number | string;
  error_code: string | null;
  requested_by: string;
  created_at: string;
  finished_at: string | null;
};

export type ProviderRequestRow = {
  id: string;
  run_id: string;
  seq: number;
  endpoint: string;
  params: unknown;
  outcome: string;
  provider_status_code: number | null;
  provider_task_id: string | null;
  cost_usd: number | string | null;
  items: number | null;
  response_sha256: string | null;
  sent_at: string;
  received_at: string | null;
};

export type KeywordMetricRow = {
  id: string;
  run_id: string;
  request_id: string;
  project_id: string;
  seed: string;
  keyword: string;
  relation: string;
  search_volume: number | null;
  cpc: number | string | null;
  competition: number | string | null;
  keyword_difficulty: number | null;
  intent: string | null;
  monthly_searches: unknown;
  provider_updated_at: string | null;
  provider: string;
  mode: string;
  location_code: number;
  language_code: string;
  fetched_at: string;
};

type ReadOnly<Row> = { Row: Row; Insert: never; Update: never; Relationships: [] };

export type SnapshotsDatabase = {
  public: {
    Tables: {
      nexra_provider_runs: ReadOnly<ProviderRunRow>;
      nexra_provider_requests: ReadOnly<ProviderRequestRow>;
      nexra_keyword_metrics: ReadOnly<KeywordMetricRow>;
    };
    Views: { [_ in never]: never };
    Functions: {
      nexra_provider_run_reserve: {
        Args: { p_project_id: string; p_seeds: string[]; p_location_code: number; p_language_code: string; p_mode: string; p_api_host: string; p_estimate_usd: number; p_cap_usd: number; p_requested_by: string };
        Returns: unknown;
      };
      nexra_provider_request_record: {
        Args: {
          p_run_id: string; p_seq: number; p_endpoint: string; p_params: unknown; p_outcome: string; p_provider_status_code: number | null; p_provider_task_id: string | null;
          p_cost_usd: number | null; p_items: number | null; p_response_sha256: string | null; p_sent_at: string; p_received_at: string | null;
        };
        Returns: unknown;
      };
      nexra_provider_metrics_record: { Args: { p_run_id: string; p_request_id: string; p_rows: unknown }; Returns: unknown };
      nexra_provider_run_finish: { Args: { p_run_id: string; p_status: string; p_cost_usd: number; p_unknown_cost_usd: number; p_error_code: string | null }; Returns: unknown };
      nexra_provider_run_resume: { Args: { p_run_id: string; p_estimate_usd: number; p_cap_usd: number; p_requested_by: string }; Returns: unknown };
    };
  };
};

export const RUN_READ_COLUMNS = "id, project_id, provider, kind, mode, api_host, seeds, location_code, language_code, status, estimate_usd, cost_usd, unknown_cost_usd, error_code, requested_by, created_at, finished_at";
export const REQUEST_READ_COLUMNS = "id, run_id, seq, endpoint, params, outcome, provider_status_code, provider_task_id, cost_usd, items, response_sha256, sent_at, received_at";
export const METRIC_READ_COLUMNS =
  "id, run_id, request_id, project_id, seed, keyword, relation, search_volume, cpc, competition, keyword_difficulty, intent, monthly_searches, provider_updated_at, provider, mode, location_code, language_code, fetched_at";

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new SnapshotRowError(`${what} is not an object.`);
  return value as Record<string, unknown>;
}
function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new SnapshotRowError(`${key} is not text.`);
  return value;
}
function optionalText(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new SnapshotRowError(`${key} is not text.`);
  return value;
}
function integer(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isInteger(value)) throw new SnapshotRowError(`${key} is not a whole number.`);
  return value;
}
function optionalInteger(row: Record<string, unknown>, key: string): number | null {
  if (row[key] === null || row[key] === undefined) return null;
  return integer(row, key);
}
/** numeric columns arrive as strings from PostgREST; a figure that will not parse is refused. */
function money(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) throw new SnapshotRowError(`${key} is not a number.`);
  return parsed;
}
function optionalMoney(row: Record<string, unknown>, key: string): number | null {
  if (row[key] === null || row[key] === undefined) return null;
  return money(row, key);
}
function oneOf<T extends string>(row: Record<string, unknown>, key: string, values: readonly T[]): T {
  const value = row[key];
  if (typeof value !== "string" || !(values as readonly string[]).includes(value)) throw new SnapshotRowError(`${key} "${String(value)}" is not one of ${values.join(", ")}.`);
  return value as T;
}

export function runRowToRun(value: unknown): ProviderRun {
  const row = record(value, "a run row");
  const seeds = row.seeds;
  if (!Array.isArray(seeds) || seeds.some((seed) => typeof seed !== "string")) throw new SnapshotRowError("seeds is not a list of text.");
  return {
    id: text(row, "id"),
    projectId: text(row, "project_id"),
    provider: oneOf(row, "provider", ["dataforseo"]),
    kind: oneOf(row, "kind", ["keyword-snapshot", "serp"]),
    mode: oneOf(row, "mode", ["sandbox", "live"]),
    apiHost: text(row, "api_host"),
    seeds: seeds as string[],
    locationCode: integer(row, "location_code"),
    languageCode: text(row, "language_code"),
    status: oneOf(row, "status", ["reserved", "completed", "partial", "failed"]),
    estimateUsd: money(row, "estimate_usd"),
    costUsd: optionalMoney(row, "cost_usd"),
    unknownCostUsd: money(row, "unknown_cost_usd"),
    errorCode: optionalText(row, "error_code"),
    requestedBy: text(row, "requested_by"),
    createdAt: text(row, "created_at"),
    finishedAt: optionalText(row, "finished_at"),
  };
}

export function requestRowToRequest(value: unknown): ProviderRequest {
  const row = record(value, "a request row");
  const params = row.params;
  if (typeof params !== "object" || params === null || Array.isArray(params)) throw new SnapshotRowError("params is not an object.");
  return {
    id: text(row, "id"),
    runId: text(row, "run_id"),
    seq: integer(row, "seq"),
    endpoint: oneOf(row, "endpoint", [ENDPOINTS.keywordOverview, ENDPOINTS.relatedKeywords, ENDPOINTS.serpOrganic]),
    params: params as Record<string, unknown>,
    outcome: oneOf(row, "outcome", ["succeeded", "failed", "unknown"]),
    providerStatusCode: optionalInteger(row, "provider_status_code"),
    providerTaskId: optionalText(row, "provider_task_id"),
    costUsd: optionalMoney(row, "cost_usd"),
    items: optionalInteger(row, "items"),
    responseSha256: optionalText(row, "response_sha256"),
    sentAt: text(row, "sent_at"),
    receivedAt: optionalText(row, "received_at"),
  };
}

export function metricRowToMetric(value: unknown): KeywordMetric {
  const row = record(value, "a metric row");
  const monthly = row.monthly_searches;
  let monthlySearches: KeywordMetric["monthlySearches"] = null;
  if (Array.isArray(monthly)) {
    monthlySearches = monthly.map((entry) => {
      const month = record(entry, "a monthly entry");
      return { year: integer(month, "year"), month: integer(month, "month"), search_volume: integer(month, "search_volume") };
    });
  } else if (monthly !== null && monthly !== undefined) {
    throw new SnapshotRowError("monthly_searches is not a list.");
  }
  return {
    id: text(row, "id"),
    runId: text(row, "run_id"),
    requestId: text(row, "request_id"),
    projectId: text(row, "project_id"),
    seed: text(row, "seed"),
    keyword: text(row, "keyword"),
    relation: oneOf(row, "relation", ["seed", "related"]),
    searchVolume: optionalInteger(row, "search_volume"),
    cpc: optionalMoney(row, "cpc"),
    competition: optionalMoney(row, "competition"),
    keywordDifficulty: optionalInteger(row, "keyword_difficulty"),
    intent: optionalText(row, "intent"),
    monthlySearches,
    providerUpdatedAt: optionalText(row, "provider_updated_at"),
    provider: oneOf(row, "provider", ["dataforseo"]),
    mode: oneOf(row, "mode", ["sandbox", "live"]),
    locationCode: integer(row, "location_code"),
    languageCode: text(row, "language_code"),
    fetchedAt: text(row, "fetched_at"),
  };
}

const capReached = (result: Record<string, unknown>) =>
  ({ status: "cap-reached", spentUsd: money(result, "spent_usd"), capUsd: money(result, "cap_usd"), estimateUsd: money(result, "estimate_usd") }) as const;

export function reserveResultToOutcome(data: unknown): ReserveOutcome {
  const result = record(data, "the reserve answer");
  switch (result.outcome) {
    case "reserved":
      return { status: "reserved", run: runRowToRun(result.run), spentUsd: money(result, "spent_usd") };
    case "cap-reached":
      return capReached(result);
    case "run-active":
    case "project-not-found":
      return { status: result.outcome };
    default:
      throw new SnapshotRowError(`the reserve function answered "${String(result.outcome)}", which this product does not recognise.`);
  }
}

export function resumeResultToOutcome(data: unknown): ResumeOutcome {
  const result = record(data, "the resume answer");
  switch (result.outcome) {
    case "reserved":
      return { status: "reserved", run: runRowToRun(result.run), spentUsd: money(result, "spent_usd") };
    case "cap-reached":
      return capReached(result);
    case "run-active":
    case "run-not-partial":
    case "run-not-found":
      return { status: result.outcome };
    default:
      throw new SnapshotRowError(`the resume function answered "${String(result.outcome)}", which this product does not recognise.`);
  }
}

export function requestResultToOutcome(data: unknown): RecordRequestOutcome {
  const result = record(data, "the request answer");
  switch (result.outcome) {
    case "recorded":
    case "exists":
      return { status: result.outcome, request: requestRowToRequest(result.request) };
    case "run-not-found":
    case "run-not-open":
      return { status: result.outcome };
    default:
      throw new SnapshotRowError(`the request function answered "${String(result.outcome)}", which this product does not recognise.`);
  }
}

export function metricsResultToOutcome(data: unknown): RecordMetricsOutcome {
  const result = record(data, "the metrics answer");
  switch (result.outcome) {
    case "recorded":
      return { status: "recorded", rows: integer(result, "rows") };
    case "exists":
    case "run-not-found":
    case "run-not-open":
    case "request-not-found":
    case "invalid-row":
      return { status: result.outcome };
    default:
      throw new SnapshotRowError(`the metrics function answered "${String(result.outcome)}", which this product does not recognise.`);
  }
}

export function finishResultToOutcome(data: unknown): FinishOutcome {
  const result = record(data, "the finish answer");
  switch (result.outcome) {
    case "finished":
      return { status: "finished", run: runRowToRun(result.run) };
    case "run-not-found":
    case "run-not-open":
    case "cost-mismatch":
    case "status-not-consistent":
      return { status: result.outcome };
    default:
      throw new SnapshotRowError(`the finish function answered "${String(result.outcome)}", which this product does not recognise.`);
  }
}

/** PostgREST and Postgres codes that mean the migration's objects are absent on this database. */
export const NOT_SET_UP_CODES: readonly string[] = ["PGRST202", "PGRST205", "42P01", "42883"];
