import { NOT_SET_UP_CODES, runRowToRun, SnapshotRowError, type SnapshotsDatabase } from "@/lib/keyword-snapshots/supabase/schema";
import type { SerpResult, SerpRun } from "@/lib/serp/contract";
import type { RecordSerpOutcome, SerpReserveOutcome } from "@/lib/serp/store-contract";

/**
 * The SERP records' shapes (migration 20261024120000) and their translation: a run is F0's row plus its opportunity; a
 * result row is checked against what the migration declares and refused at read time rather than passed on.
 */

export type SerpResultRow = {
  id: string;
  run_id: string;
  request_id: string;
  project_id: string;
  opportunity_id: string;
  keyword: string;
  result_type: string;
  rank: number;
  url: string | null;
  domain: string | null;
  title: string;
  snippet: string | null;
  provider: string;
  mode: string;
  location_code: number;
  language_code: string;
  fetched_at: string;
};

type Base = SnapshotsDatabase["public"];
type ReadOnly<Row> = { Row: Row; Insert: never; Update: never; Relationships: [] };

export type SerpDatabase = {
  public: {
    Tables: Base["Tables"] & {
      nexra_provider_runs: ReadOnly<Base["Tables"]["nexra_provider_runs"]["Row"] & { opportunity_id: string | null }>;
      nexra_serp_results: ReadOnly<SerpResultRow>;
    };
    Views: Base["Views"];
    Functions: Base["Functions"] & {
      nexra_provider_serp_reserve: {
        Args: { p_project_id: string; p_opportunity_id: string; p_location_code: number; p_language_code: string; p_mode: string; p_api_host: string; p_estimate_usd: number; p_cap_usd: number; p_requested_by: string };
        Returns: unknown;
      };
      nexra_provider_serp_record: { Args: { p_run_id: string; p_request_id: string; p_rows: unknown }; Returns: unknown };
    };
  };
};

export const SERP_RUN_READ_COLUMNS =
  "id, project_id, provider, kind, opportunity_id, mode, api_host, seeds, location_code, language_code, status, estimate_usd, cost_usd, unknown_cost_usd, error_code, requested_by, created_at, finished_at";
export const SERP_RESULT_READ_COLUMNS = "id, run_id, request_id, project_id, opportunity_id, keyword, result_type, rank, url, domain, title, snippet, provider, mode, location_code, language_code, fetched_at";

/** PostgREST also answers 42703 when a column (opportunity_id) does not exist yet. */
export const SERP_NOT_SET_UP_CODES: readonly string[] = [...NOT_SET_UP_CODES, "PGRST204", "42703"];

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new SnapshotRowError(`${what} is not an object.`);
  return value as Record<string, unknown>;
}
function text(row: Record<string, unknown>, key: string): string {
  if (typeof row[key] !== "string") throw new SnapshotRowError(`${key} is not text.`);
  return row[key] as string;
}
function optionalText(row: Record<string, unknown>, key: string): string | null {
  if (row[key] === null || row[key] === undefined) return null;
  return text(row, key);
}
function money(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) throw new SnapshotRowError(`${key} is not a number.`);
  return parsed;
}

export function serpRunRowToRun(value: unknown): SerpRun {
  const row = record(value, "a SERP run row");
  const run = runRowToRun(row);
  if (run.kind !== "serp") throw new SnapshotRowError("the run is not a SERP run.");
  return { ...run, kind: "serp", opportunityId: text(row, "opportunity_id") };
}

export function resultRowToResult(value: unknown): SerpResult {
  const row = record(value, "a SERP result row");
  const type = row.result_type;
  if (type !== "organic" && type !== "people-also-ask" && type !== "related-search") throw new SnapshotRowError(`result_type "${String(type)}" is not recognised.`);
  const mode = row.mode;
  if (mode !== "sandbox" && mode !== "live") throw new SnapshotRowError("mode is not sandbox or live.");
  if (typeof row.rank !== "number" || !Number.isInteger(row.rank) || row.rank < 1) throw new SnapshotRowError("rank is not a positive whole number.");
  return {
    id: text(row, "id"),
    runId: text(row, "run_id"),
    opportunityId: text(row, "opportunity_id"),
    keyword: text(row, "keyword"),
    type,
    rank: row.rank,
    url: optionalText(row, "url"),
    domain: optionalText(row, "domain"),
    title: text(row, "title"),
    snippet: optionalText(row, "snippet"),
    mode,
    fetchedAt: text(row, "fetched_at"),
  };
}

export function serpReserveResultToOutcome(data: unknown): SerpReserveOutcome {
  const result = record(data, "the SERP reserve answer");
  switch (result.outcome) {
    case "reserved":
      return { status: "reserved", run: serpRunRowToRun(result.run), spentUsd: money(result, "spent_usd") };
    case "cap-reached":
      return { status: "cap-reached", spentUsd: money(result, "spent_usd"), capUsd: money(result, "cap_usd"), estimateUsd: money(result, "estimate_usd") };
    case "run-active":
    case "project-not-found":
    case "opportunity-not-found":
      return { status: result.outcome };
    default:
      throw new SnapshotRowError(`the SERP reserve function answered "${String(result.outcome)}", which this product does not recognise.`);
  }
}

export function serpRecordResultToOutcome(data: unknown): RecordSerpOutcome {
  const result = record(data, "the SERP record answer");
  switch (result.outcome) {
    case "recorded":
      if (typeof result.rows !== "number" || !Number.isInteger(result.rows)) throw new SnapshotRowError("rows is not a whole number.");
      return { status: "recorded", rows: result.rows };
    case "exists":
    case "run-not-found":
    case "run-not-open":
    case "request-not-found":
    case "invalid-row":
      return { status: result.outcome };
    default:
      throw new SnapshotRowError(`the SERP record function answered "${String(result.outcome)}", which this product does not recognise.`);
  }
}
