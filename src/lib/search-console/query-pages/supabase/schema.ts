import {
  QUERY_PAGE_DAYS,
  QUERY_PAGE_MAX_KEY_LENGTH,
  QUERY_PAGE_RANGE_ID,
  type RecordQueryPagesOutcome,
  type StoredQueryPage,
} from "@/lib/search-console/query-pages/contract";

/**
 * The shape of `nexra_search_console_query_pages` and of what
 * `nexra_search_console_query_pages_record` answers, and the translation into
 * the application's types. The table grants no INSERT, UPDATE or DELETE: the
 * function is the only way in, so no write type exists here. A row that does
 * not match what the migration declares is refused at read time rather than
 * passed on.
 */

export class QueryPageRowError extends Error {
  constructor(message: string) {
    super(`Search Console query × page row: ${message}`);
    this.name = "QueryPageRowError";
  }
}

export type SearchConsoleQueryPageRow = {
  id: string;
  project_id: string;
  property: string;
  range_id: string;
  days: number;
  start_date: string;
  end_date: string;
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  source: string;
  fetched_at: string;
  captured_at: string;
};

type ReadOnly<Row> = { Row: Row; Insert: never; Update: never; Relationships: [] };

export type SearchConsoleQueryPagesDatabase = {
  public: {
    Tables: {
      nexra_search_console_query_pages: ReadOnly<SearchConsoleQueryPageRow>;
    };
    Views: { [_ in never]: never };
    Functions: {
      nexra_search_console_query_pages_record: {
        Args: {
          p_project_id: string;
          p_property: string;
          p_range_id: string;
          p_start_date: string;
          p_end_date: string;
          p_pairs: unknown;
          p_fetched_at: string;
        };
        Returns: unknown;
      };
    };
  };
};

export const QUERY_PAGE_READ_COLUMNS =
  "id, project_id, property, range_id, days, start_date, end_date, query, page, clicks, impressions, ctr, position, source, fetched_at, captured_at";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new QueryPageRowError(`${what} is not an object.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string") throw new QueryPageRowError(`${field} is not a string.`);
  return value;
}

function date(value: unknown, field: string): string {
  const s = text(value, field);
  if (!ISO_DATE.test(s)) throw new QueryPageRowError(`${field} is not an ISO date.`);
  return s;
}

function number(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new QueryPageRowError(`${field} is not a number.`);
  return value;
}

export function queryPageRowToStored(row: unknown): StoredQueryPage {
  const r = record(row, "the row");
  const rangeId = text(r.range_id, "range_id");
  if (rangeId !== QUERY_PAGE_RANGE_ID) throw new QueryPageRowError(`range_id is "${rangeId}", not "${QUERY_PAGE_RANGE_ID}".`);
  const days = number(r.days, "days");
  if (days !== QUERY_PAGE_DAYS) throw new QueryPageRowError(`days is ${days}, not ${QUERY_PAGE_DAYS}.`);
  const source = text(r.source, "source");
  if (source !== "scheduled") throw new QueryPageRowError(`source is "${source}".`);
  const query = text(r.query, "query");
  const page = text(r.page, "page");
  if (query === "" || query.length > QUERY_PAGE_MAX_KEY_LENGTH) throw new QueryPageRowError("query is out of range.");
  if (page === "" || page.length > QUERY_PAGE_MAX_KEY_LENGTH) throw new QueryPageRowError("page is out of range.");
  return {
    id: text(r.id, "id"),
    projectId: text(r.project_id, "project_id"),
    property: text(r.property, "property"),
    rangeId: QUERY_PAGE_RANGE_ID,
    days: QUERY_PAGE_DAYS,
    startDate: date(r.start_date, "start_date"),
    endDate: date(r.end_date, "end_date"),
    query,
    page,
    clicks: number(r.clicks, "clicks"),
    impressions: number(r.impressions, "impressions"),
    ctr: number(r.ctr, "ctr"),
    position: number(r.position, "position"),
    source: "scheduled",
    fetchedAt: text(r.fetched_at, "fetched_at"),
    capturedAt: text(r.captured_at, "captured_at"),
  };
}

/** What the function answers, checked field by field: a shape it did not promise is an error, not a guess. */
export function recordResultToOutcome(data: unknown): RecordQueryPagesOutcome {
  const result = record(data, "the function's answer");
  switch (result.outcome) {
    case "created":
    case "exists": {
      const count = number(result.count, "count");
      if (!Number.isInteger(count) || count < 0) throw new QueryPageRowError("count is not a whole number.");
      return { status: result.outcome, count };
    }
    case "not-found":
      return { status: "not-found" };
    default:
      throw new QueryPageRowError(`the function answered "${String(result.outcome)}", which this product does not recognise.`);
  }
}
