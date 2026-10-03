import { PREVIEW_CHARS, type EvidenceSource } from "@/lib/evidence/contract";
import type { SourceFetchState } from "@/lib/evidence/fetch";
import type { RecordSourceOutcome } from "@/lib/evidence/store-contract";

/** The evidence tables' shapes (migration 20261025120000) and their translation; a row that does not match is refused. */

export class EvidenceRowError extends Error {
  constructor(message: string) {
    super(`Evidence row: ${message}`);
    this.name = "EvidenceRowError";
  }
}

export type EvidenceSourceRow = {
  id: string;
  project_id: string;
  opportunity_id: string;
  serp_result_id: string | null;
  requested_url: string;
  final_url: string | null;
  fetch_state: string;
  http_status: number | null;
  robots: string;
  title: string | null;
  page_text: string | null;
  text_sha256: string | null;
  text_chars: number | null;
  fetched_by: string;
  fetched_at: string;
};

export type EvidenceUnitRow = {
  id: string;
  project_id: string;
  opportunity_id: string;
  source_id: string;
  run_id: string;
  position: number;
  claim: string;
  quote: string;
  run_verdict: string;
  quote_found: boolean;
  status: string;
  decision: string;
  decided_by: string | null;
  decided_at: string | null;
  recorded_by: string;
  recorded_at: string;
};

type ReadOnly<Row> = { Row: Row; Insert: never; Update: never; Relationships: [] };

export type EvidenceDatabase = {
  public: {
    Tables: {
      nexra_evidence_sources: ReadOnly<EvidenceSourceRow>;
      nexra_evidence_units: ReadOnly<EvidenceUnitRow>;
      nexra_serp_results: ReadOnly<{ id: string; project_id: string; opportunity_id: string; result_type: string; url: string | null }>;
    };
    Views: { [_ in never]: never };
    Functions: {
      nexra_evidence_source_record: {
        Args: { p_project_id: string; p_opportunity_id: string; p_serp_result_id: string | null; p_requested_url: string; p_final_url: string | null; p_fetch_state: string; p_http_status: number | null; p_robots: string; p_title: string | null; p_page_text: string | null; p_operator: string };
        Returns: unknown;
      };
      nexra_evidence_units_record: { Args: { p_project_id: string; p_source_id: string; p_run_id: string; p_units: unknown; p_operator: string }; Returns: unknown };
      nexra_evidence_unit_decide: { Args: { p_project_id: string; p_unit_id: string; p_decision: string; p_operator: string }; Returns: unknown };
    };
  };
};

export const SOURCE_READ_COLUMNS = "id, project_id, opportunity_id, serp_result_id, requested_url, final_url, fetch_state, http_status, robots, title, page_text, text_sha256, text_chars, fetched_by, fetched_at";
export const EVIDENCE_NOT_SET_UP_CODES: readonly string[] = ["PGRST202", "PGRST204", "PGRST205", "42P01", "42703", "42883"];

const STATES: readonly SourceFetchState[] = ["fetched", "http-error", "non-html", "robots-disallowed", "robots-unreachable", "timeout", "dns-error", "connection-error", "too-large", "redirect-loop", "too-many-redirects", "refused-unsafe", "off-site", "no-text"];

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new EvidenceRowError(`${what} is not an object.`);
  return value as Record<string, unknown>;
}
export function text(row: Record<string, unknown>, key: string): string {
  if (typeof row[key] !== "string") throw new EvidenceRowError(`${key} is not text.`);
  return row[key] as string;
}
export function optionalText(row: Record<string, unknown>, key: string): string | null {
  return row[key] === null || row[key] === undefined ? null : text(row, key);
}
function optionalInteger(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) throw new EvidenceRowError(`${key} is not a whole number.`);
  return value;
}

/** A source row; the stored text becomes a preview here and goes no further. */
export function sourceRowToSource(value: unknown): EvidenceSource {
  const row = record(value, "a source row");
  const state = text(row, "fetch_state") as SourceFetchState;
  if (!STATES.includes(state)) throw new EvidenceRowError(`fetch_state "${state}" is not recognised.`);
  const robots = text(row, "robots");
  if (robots !== "allowed" && robots !== "disallowed" && robots !== "unreachable") throw new EvidenceRowError("robots is not recognised.");
  const pageText = optionalText(row, "page_text");
  return {
    id: text(row, "id"),
    projectId: text(row, "project_id"),
    opportunityId: text(row, "opportunity_id"),
    serpResultId: optionalText(row, "serp_result_id"),
    requestedUrl: text(row, "requested_url"),
    finalUrl: optionalText(row, "final_url"),
    fetchState: state,
    httpStatus: optionalInteger(row, "http_status"),
    robots,
    title: optionalText(row, "title"),
    textSha256: optionalText(row, "text_sha256"),
    textChars: optionalInteger(row, "text_chars"),
    preview: pageText === null ? null : pageText.slice(0, PREVIEW_CHARS),
    fetchedAt: text(row, "fetched_at"),
  };
}

export function recordSourceResultToOutcome(data: unknown): RecordSourceOutcome {
  const result = record(data, "the source record answer");
  switch (result.outcome) {
    case "recorded":
      return { status: "recorded", source: sourceRowToSource({ ...record(result.source, "the recorded source"), page_text: null }) };
    case "project-not-found":
    case "opportunity-not-found":
    case "serp-result-not-found":
    case "source-limit":
      return { status: result.outcome };
    default:
      throw new EvidenceRowError(`the source record function answered "${String(result.outcome)}", which this product does not recognise.`);
  }
}
