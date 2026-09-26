import type { SearchConsoleWindow, SearchPerformance, SearchPerformanceRow } from "@/types/search-console";

/**
 * Search Console snapshots (milestone M1, checkpoint 1b): what the capture
 * needs from wherever snapshots are kept, and what one capture answers.
 *
 * A snapshot is one immutable observation of one project's property over
 * one 30-day window, as `nexra_search_console_snapshots` (migration
 * 20260927120000) stores it. The store has one write, the database's own
 * `nexra_search_console_snapshot_record` function, which answers `created`,
 * `exists` (that window is already recorded; nothing written) or `not-found`
 * (the project is no longer stored). The capture holds every other rule —
 * which property a project reads, that Google's answer was for that property,
 * that it was fresh — and the table's constraints re-check the row's shape
 * for any caller. Snapshots are read back by the history comparison, the
 * query × page view and the keyword inventory, for screens and for the two
 * Search Console agent tasks.
 */

export const SNAPSHOT_RANGE_ID = "30d" as const;
export const SNAPSHOT_DAYS = 30;
/** The most rows a snapshot keeps for queries and for pages (the table's CHECK). */
export const SNAPSHOT_MAX_ROWS = 25;
/** The longest query text or page URL a row may carry (the table's CHECK). */
export const SNAPSHOT_MAX_KEY_LENGTH = 2048;

export type SnapshotState = "connected" | "no-data";

/** Which secondary reads were unavailable for a connected snapshot. */
export type SnapshotPartial = "queries-unavailable" | "pages-unavailable";

/** One stored snapshot, as the database function returned it. */
export type SearchConsoleSnapshot = {
  readonly id: string;
  readonly projectId: string;
  readonly property: string;
  readonly rangeId: typeof SNAPSHOT_RANGE_ID;
  readonly days: typeof SNAPSHOT_DAYS;
  /** Inclusive ISO dates, YYYY-MM-DD. */
  readonly startDate: string;
  readonly endDate: string;
  readonly state: SnapshotState;
  /** Set when connected; null for a no-data snapshot. */
  readonly totals: SearchPerformance | null;
  readonly queries: readonly SearchPerformanceRow[];
  readonly pages: readonly SearchPerformanceRow[];
  readonly partial: readonly SnapshotPartial[];
  readonly source: "scheduled";
  /** When Google answered, ISO timestamp. */
  readonly fetchedAt: string;
  /** When the row was written, ISO timestamp. */
  readonly capturedAt: string;
};

export type RecordSnapshotInput = {
  readonly projectId: string;
  /** The property the server read for the project, from its own configuration. */
  readonly property: string;
  readonly window: SearchConsoleWindow;
  readonly state: SnapshotState;
  /** Required when connected; null for no-data. */
  readonly totals: SearchPerformance | null;
  readonly queries: readonly SearchPerformanceRow[];
  readonly pages: readonly SearchPerformanceRow[];
  readonly partial: readonly SnapshotPartial[];
  readonly fetchedAt: string;
};

export type RecordSnapshotOutcome =
  /** Written. */
  | { readonly status: "created"; readonly snapshot: SearchConsoleSnapshot }
  /** That project, property and window end were already recorded; nothing written. */
  | { readonly status: "exists"; readonly snapshot: SearchConsoleSnapshot }
  /** The project is not stored (deleted since it was listed). */
  | { readonly status: "not-found" };

/** The most snapshots one read returns; a year of daily captures fits well under it. */
export const SNAPSHOT_LIST_LIMIT = 400;

export type SearchConsoleSnapshotStore = {
  /** Whether this store keeps snapshots. The fixture data source does not. */
  readonly storesSnapshots: boolean;
  /** One snapshot, in one database transaction, through the one database function. */
  record(input: RecordSnapshotInput): Promise<RecordSnapshotOutcome>;
  /**
   * One project's snapshots for one range, newest window first, at most
   * `limit` (1 to SNAPSHOT_LIST_LIMIT). Every property the project was ever
   * captured under is returned; the reader decides which property is current.
   * Never another project's rows.
   */
  listSnapshots(projectId: string, rangeId: typeof SNAPSHOT_RANGE_ID, limit: number): Promise<readonly SearchConsoleSnapshot[]>;
};

/** The store used when projects are not persisted anywhere. It refuses rather than pretends. */
export const unavailableSearchConsoleSnapshotStore: SearchConsoleSnapshotStore = {
  storesSnapshots: false,
  async record() {
    return { status: "not-found" };
  },
  async listSnapshots() {
    return [];
  },
};
