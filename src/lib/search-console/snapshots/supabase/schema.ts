import {
  SNAPSHOT_DAYS,
  SNAPSHOT_MAX_KEY_LENGTH,
  SNAPSHOT_MAX_ROWS,
  SNAPSHOT_RANGE_ID,
  type RecordSnapshotOutcome,
  type SearchConsoleSnapshot,
  type SnapshotPartial,
} from "@/lib/search-console/snapshots/contract";
import type { SearchPerformance, SearchPerformanceRow } from "@/types/search-console";

/**
 * The shape of `nexra_search_console_snapshots` and of what
 * `nexra_search_console_snapshot_record` answers, and the translation into
 * the application's types. The table grants no INSERT, UPDATE or DELETE:
 * the function is the only way in, so no write type exists here. A row that
 * does not match what the migration declares is refused at read time rather
 * than passed on.
 */

export class SnapshotRowError extends Error {
  constructor(message: string) {
    super(`Search Console snapshot row: ${message}`);
    this.name = "SnapshotRowError";
  }
}

export type SearchConsoleSnapshotRow = {
  id: string;
  project_id: string;
  property: string;
  range_id: string;
  days: number;
  start_date: string;
  end_date: string;
  state: string;
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  position: number | null;
  queries: unknown;
  pages: unknown;
  partial: string[];
  source: string;
  fetched_at: string;
  captured_at: string;
};

type ReadOnly<Row> = { Row: Row; Insert: never; Update: never; Relationships: [] };

export type SearchConsoleSnapshotsDatabase = {
  public: {
    Tables: {
      nexra_search_console_snapshots: ReadOnly<SearchConsoleSnapshotRow>;
    };
    Views: { [_ in never]: never };
    Functions: {
      nexra_search_console_snapshot_record: {
        Args: {
          p_project_id: string;
          p_property: string;
          p_range_id: string;
          p_start_date: string;
          p_end_date: string;
          p_state: string;
          p_clicks: number | null;
          p_impressions: number | null;
          p_ctr: number | null;
          p_position: number | null;
          p_queries: unknown;
          p_pages: unknown;
          p_partial: string[];
          p_fetched_at: string;
        };
        Returns: unknown;
      };
    };
  };
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PARTIALS: readonly SnapshotPartial[] = ["queries-unavailable", "pages-unavailable"];

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new SnapshotRowError(`${what} is not an object.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string") throw new SnapshotRowError(`${field} is not a string.`);
  return value;
}

function date(value: unknown, field: string): string {
  const s = text(value, field);
  if (!ISO_DATE.test(s)) throw new SnapshotRowError(`${field} is not an ISO date.`);
  return s;
}

function number(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new SnapshotRowError(`${field} is not a number.`);
  return value;
}

function totalsOf(r: Record<string, unknown>, state: SearchConsoleSnapshot["state"]): SearchPerformance | null {
  const values = [r.clicks, r.impressions, r.ctr, r.position];
  if (state === "no-data") {
    if (values.some((v) => v !== null)) throw new SnapshotRowError("a no-data snapshot carries totals.");
    return null;
  }
  return {
    clicks: number(r.clicks, "clicks"),
    impressions: number(r.impressions, "impressions"),
    ctr: number(r.ctr, "ctr"),
    position: number(r.position, "position"),
  };
}

function rowsOf(value: unknown, field: string): readonly SearchPerformanceRow[] {
  if (!Array.isArray(value)) throw new SnapshotRowError(`${field} is not a list.`);
  if (value.length > SNAPSHOT_MAX_ROWS) throw new SnapshotRowError(`${field} holds more than ${SNAPSHOT_MAX_ROWS} rows.`);
  return value.map((entry, index) => {
    const row = record(entry, `${field}[${index}]`);
    const key = text(row.key, `${field}[${index}].key`);
    if (key === "" || key.length > SNAPSHOT_MAX_KEY_LENGTH) throw new SnapshotRowError(`${field}[${index}].key is out of range.`);
    return {
      key,
      clicks: number(row.clicks, `${field}[${index}].clicks`),
      impressions: number(row.impressions, `${field}[${index}].impressions`),
      ctr: number(row.ctr, `${field}[${index}].ctr`),
      position: number(row.position, `${field}[${index}].position`),
    };
  });
}

function partialOf(value: unknown): readonly SnapshotPartial[] {
  if (!Array.isArray(value)) throw new SnapshotRowError("partial is not a list.");
  return value.map((entry) => {
    const found = PARTIALS.find((p) => p === entry);
    if (!found) throw new SnapshotRowError(`partial holds "${String(entry)}", which this product does not recognise.`);
    return found;
  });
}

export function snapshotRowToSnapshot(row: unknown): SearchConsoleSnapshot {
  const r = record(row, "the snapshot row");
  const rangeId = text(r.range_id, "range_id");
  if (rangeId !== SNAPSHOT_RANGE_ID) throw new SnapshotRowError(`range_id is "${rangeId}", not "${SNAPSHOT_RANGE_ID}".`);
  const days = number(r.days, "days");
  if (days !== SNAPSHOT_DAYS) throw new SnapshotRowError(`days is ${days}, not ${SNAPSHOT_DAYS}.`);
  const state = text(r.state, "state");
  if (state !== "connected" && state !== "no-data") throw new SnapshotRowError(`state is "${state}".`);
  const source = text(r.source, "source");
  if (source !== "scheduled") throw new SnapshotRowError(`source is "${source}".`);
  return {
    id: text(r.id, "id"),
    projectId: text(r.project_id, "project_id"),
    property: text(r.property, "property"),
    rangeId: SNAPSHOT_RANGE_ID,
    days: SNAPSHOT_DAYS,
    startDate: date(r.start_date, "start_date"),
    endDate: date(r.end_date, "end_date"),
    state,
    totals: totalsOf(r, state),
    queries: rowsOf(r.queries, "queries"),
    pages: rowsOf(r.pages, "pages"),
    partial: partialOf(r.partial),
    source: "scheduled",
    fetchedAt: text(r.fetched_at, "fetched_at"),
    capturedAt: text(r.captured_at, "captured_at"),
  };
}

/** What the function answers, checked field by field: a shape it did not promise is an error, not a guess. */
export function recordResultToOutcome(data: unknown): RecordSnapshotOutcome {
  const result = record(data, "the function's answer");
  switch (result.outcome) {
    case "created":
    case "exists":
      return { status: result.outcome, snapshot: snapshotRowToSnapshot(result.snapshot) };
    case "not-found":
      return { status: "not-found" };
    default:
      throw new SnapshotRowError(`the function answered "${String(result.outcome)}", which this product does not recognise.`);
  }
}
