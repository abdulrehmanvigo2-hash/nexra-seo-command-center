import { SNAPSHOT_DAYS, SNAPSHOT_MAX_KEY_LENGTH, SNAPSHOT_RANGE_ID } from "@/lib/search-console/snapshots/contract";
import type { SearchConsoleWindow, SearchQueryPageRow } from "@/types/search-console";

/**
 * Search Console query × page rows (milestone M1, phase 4, checkpoint P4c):
 * what the capture needs from wherever the rows are kept, and what one
 * recording answers.
 *
 * A stored row is one (query, page) pair Google reported for one project's
 * property over one 30-day window, with the four metrics for that pair, as
 * `nexra_search_console_query_pages` (migration 20260930120000) stores it.
 * The store has one write, the database's own
 * `nexra_search_console_query_pages_record` function, which writes a whole
 * window's set in one statement and answers `created` with the count,
 * `exists` (that window already holds rows for the project and property;
 * nothing written) or `not-found` (the project is no longer stored). The
 * capture holds every other rule — which property a project reads, that
 * Google's answer was for that property and fresh, that the rows are within
 * the limits — and the function re-checks the shape for any caller.
 *
 * What a set is not: Search Console leaves anonymised queries out of
 * dimensioned rows, and the request asks for at most QUERY_PAGE_ROW_LIMIT
 * rows by clicks, so a window's set is an observed cut, never the property's
 * complete demand, never a ranking and never a claim that a page "owns" a
 * query.
 */

export const QUERY_PAGE_RANGE_ID = SNAPSHOT_RANGE_ID;
export const QUERY_PAGE_DAYS = SNAPSHOT_DAYS;
/** The most pairs one capture asks Google for and records (the request's `rowLimit`; the function's cap). */
export const QUERY_PAGE_ROW_LIMIT = 250;
/** The longest query text or page URL a row may carry (the table's CHECK). */
export const QUERY_PAGE_MAX_KEY_LENGTH = SNAPSHOT_MAX_KEY_LENGTH;

/** One stored pair, as the table holds it. */
export type StoredQueryPage = SearchQueryPageRow & {
  readonly id: string;
  readonly projectId: string;
  readonly property: string;
  readonly rangeId: typeof QUERY_PAGE_RANGE_ID;
  readonly days: typeof QUERY_PAGE_DAYS;
  /** Inclusive ISO dates, YYYY-MM-DD. */
  readonly startDate: string;
  readonly endDate: string;
  readonly source: "scheduled";
  /** When Google answered, ISO timestamp. */
  readonly fetchedAt: string;
  /** When the row was written, ISO timestamp. */
  readonly capturedAt: string;
};

export type RecordQueryPagesInput = {
  readonly projectId: string;
  /** The property the server read for the project, from its own configuration. */
  readonly property: string;
  readonly window: SearchConsoleWindow;
  /** 1 to QUERY_PAGE_ROW_LIMIT pairs, each within the limits above. */
  readonly pairs: readonly SearchQueryPageRow[];
  readonly fetchedAt: string;
};

export type RecordQueryPagesOutcome =
  /** Every pair written, in one statement. */
  | { readonly status: "created"; readonly count: number }
  /** That project, property and window end already hold rows; nothing written. */
  | { readonly status: "exists"; readonly count: number }
  /** The project is not stored (deleted since it was listed). */
  | { readonly status: "not-found" };

/**
 * The most stored rows one read returns: three windows' worth at the
 * per-capture limit, so the reader always sees two complete windows when
 * two exist, and can tell when the third was cut.
 */
export const QUERY_PAGE_LIST_LIMIT = 3 * QUERY_PAGE_ROW_LIMIT;

export type SearchConsoleQueryPageStore = {
  /** Whether this store keeps query × page rows. The fixture data source does not. */
  readonly storesQueryPages: boolean;
  /** One window's set, in one database transaction, through the one database function. */
  record(input: RecordQueryPagesInput): Promise<RecordQueryPagesOutcome>;
  /**
   * One project's rows for one range, newest window first, then by property,
   * then by impressions descending, at most `limit` (1 to
   * QUERY_PAGE_LIST_LIMIT). Every property the project was ever captured
   * under is returned; the reader decides which property is current. Never
   * another project's rows.
   */
  listQueryPages(projectId: string, rangeId: typeof QUERY_PAGE_RANGE_ID, limit: number): Promise<readonly StoredQueryPage[]>;
};

/** The store used when projects are not persisted anywhere. It refuses rather than pretends. */
export const unavailableSearchConsoleQueryPageStore: SearchConsoleQueryPageStore = {
  storesQueryPages: false,
  async record() {
    return { status: "not-found" };
  },
  async listQueryPages() {
    return [];
  },
};
