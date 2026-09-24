import type { LogFields, LogLevel } from "@/lib/observability/log";
import { searchConsoleWindows } from "@/lib/search-console/date-windows";
import type { ProviderResult, SearchConsoleProvider } from "@/lib/search-console/provider";
import {
  SNAPSHOT_DAYS,
  SNAPSHOT_MAX_KEY_LENGTH,
  SNAPSHOT_MAX_ROWS,
  SNAPSHOT_RANGE_ID,
  type RecordSnapshotInput,
  type SearchConsoleSnapshot,
  type SearchConsoleSnapshotStore,
  type SnapshotPartial,
} from "@/lib/search-console/snapshots/contract";
import type {
  SearchConsoleNotConnectedReason,
  SearchConsoleUnavailableReason,
  SearchConsoleWindow,
  SearchPerformance,
  SearchPerformanceRow,
} from "@/types/search-console";

/**
 * Search Console snapshot capture (milestone M1, checkpoint 1b).
 *
 * Reads the 30-day window for each stored project that the server's own
 * configuration maps to a Search Console property, and records what Google
 * reported as one immutable snapshot. Sequential across projects, bounded by
 * a project limit and a time budget, and every project answers with an
 * outcome that says what happened. Nothing here is reachable from a request:
 * no route, worker step or screen calls it yet (that is checkpoint 1c).
 *
 * WHAT IS VERIFIED BEFORE A ROW IS WRITTEN.
 *
 *  - The project is stored: it came from the project repository's own list,
 *    it is read again just before Google is asked, and the database function
 *    checks once more inside the write (`not-found`).
 *  - The project has a property, taken from the server's private
 *    `SEARCH_CONSOLE_PROPERTIES` mapping and nowhere else. No caller names a
 *    property; a browser or request cannot reach this module at all.
 *  - Google's answer was for that exact property: every provider result
 *    carries the property it answered for, and a result for any other
 *    property is refused (`property-mismatch`) and never stored. The
 *    database does not check this mapping; it is the server's.
 *  - The answer is fresh. The provider serves an old cached value, marked
 *    stale, when Google cannot be reached; a stale totals read is skipped
 *    (`stale-skipped`), and a stale queries or pages read is recorded as
 *    unavailable, never as today's observation.
 *  - The window is the product's own 30-day window, exactly 30 days ending
 *    before today, computed here from the clock and passed to the provider,
 *    whose cache keys by property and exact dates; the provider does not
 *    echo the dates back, so the window is bound by construction of the
 *    call, not by the response.
 *
 * WHAT IS NEVER DONE. A failed read is never turned into a no-data snapshot:
 * `no-data` is recorded only when Google answered and reported no
 * impressions. Rows are Google's, at most 25 with keys at most 2,048
 * characters as the table requires; a row outside those limits is left out,
 * never truncated or repaired. Logs carry ids, outcomes and durations:
 * never a query, a page, a property, a token or a response body.
 */

export type SnapshotCaptureOutcome =
  /** A connected snapshot was written. */
  | { readonly status: "created"; readonly snapshot: SearchConsoleSnapshot }
  /** A no-data snapshot was written: Google answered with no impressions. */
  | { readonly status: "no-data-created"; readonly snapshot: SearchConsoleSnapshot }
  /** This window was already recorded for the project and property; nothing written. */
  | { readonly status: "exists"; readonly snapshot: SearchConsoleSnapshot }
  /** No credentials on the server, or no property mapped to this project. */
  | { readonly status: "not-connected"; readonly reason: SearchConsoleNotConnectedReason }
  /** The service account cannot read the project's property. */
  | { readonly status: "access-denied" }
  /** Google could not be read (or the capture ran out of time waiting); a later capture may succeed. */
  | { readonly status: "unavailable"; readonly reason: SearchConsoleUnavailableReason }
  /** The provider served an old cached answer; not an observation of today. */
  | { readonly status: "stale-skipped" }
  /** The provider answered for a property other than the project's mapped one. */
  | { readonly status: "property-mismatch" }
  /** The project is no longer stored (deleted since it was listed). */
  | { readonly status: "project-not-found" }
  /** Projects are not persisted, so there is nowhere to keep a snapshot. */
  | { readonly status: "store-unavailable" }
  /** The store threw; nothing is known to have been written. */
  | { readonly status: "store-failed" };

export type SnapshotCaptureEntry = {
  readonly projectId: string;
  readonly outcome: SnapshotCaptureOutcome;
  readonly durationMs: number;
};

export type SnapshotCaptureBatch = {
  readonly rangeId: typeof SNAPSHOT_RANGE_ID;
  readonly window: SearchConsoleWindow;
  /** Every stored project considered, in repository order. */
  readonly entries: readonly SnapshotCaptureEntry[];
  /** How many projects were attempted (counted against `maxProjects`). */
  readonly attempted: number;
  readonly stoppedBy: "complete" | "project-limit" | "time-budget";
  readonly durationMs: number;
};

export type SnapshotCaptureOptions = {
  /** The most projects to attempt in this batch (1 to MAX_CAPTURE_PROJECTS). */
  readonly maxProjects: number;
  /** The batch's wall-clock budget; no project starts once it could not finish within it. */
  readonly budgetMs: number;
};

export type SnapshotCaptureLog = (level: LogLevel, event: string, fields: LogFields) => void;

export type SnapshotCaptureDependencies = {
  readonly provider: SearchConsoleProvider;
  /** Project id → property: the server's private mapping. */
  readonly properties: ReadonlyMap<string, string>;
  readonly projects: {
    listProjectIds(): Promise<readonly string[]>;
    /** Null when the id matches no stored project. */
    getProjectById(id: string): Promise<unknown | null>;
  };
  readonly store: SearchConsoleSnapshotStore;
  readonly now?: () => Date;
  readonly log?: SnapshotCaptureLog;
};

export const MAX_CAPTURE_PROJECTS = 50;
/** The least budget a project may start with: a Google read is not worth starting into less. */
export const MIN_PROJECT_BUDGET_MS = 3_000;

/**
 * The product's 30-day Search Console window for `now`: exactly 30 days,
 * ending before today (Pacific), as `searchConsoleWindows` computes it.
 * Checked rather than assumed, because the database refuses anything else.
 */
export function snapshotWindow(now: Date): SearchConsoleWindow {
  const window = searchConsoleWindows(SNAPSHOT_RANGE_ID, now).current;
  const start = Date.parse(`${window.startDate}T00:00:00Z`);
  const end = Date.parse(`${window.endDate}T00:00:00Z`);
  const length = Math.round((end - start) / 86_400_000) + 1;
  if (window.rangeId !== SNAPSHOT_RANGE_ID || window.days !== SNAPSHOT_DAYS || length !== SNAPSHOT_DAYS) {
    throw new Error(`Search Console snapshot: the window is not ${SNAPSHOT_DAYS} days.`);
  }
  if (end >= Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`)) {
    throw new Error("Search Console snapshot: the window must end before today.");
  }
  return window;
}

const integer = (value: number) => Number.isInteger(value) && value >= 0;

/** Totals as the table accepts them: whole counts, impressions above zero, a rate in 0–1. */
export function isRecordableTotals(totals: SearchPerformance): boolean {
  return (
    integer(totals.clicks) &&
    integer(totals.impressions) &&
    totals.impressions > 0 &&
    totals.clicks <= totals.impressions &&
    Number.isFinite(totals.ctr) &&
    totals.ctr >= 0 &&
    totals.ctr <= 1 &&
    Number.isFinite(totals.position) &&
    totals.position >= 0
  );
}

/**
 * Google's rows, kept in Google's order, within what the table stores: at
 * most 25, each with a distinct non-empty key of at most 2,048 characters
 * and recordable metrics. A row outside that is left out, not altered.
 */
export function snapshotRows(rows: readonly SearchPerformanceRow[]): readonly SearchPerformanceRow[] {
  const kept: SearchPerformanceRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (kept.length >= SNAPSHOT_MAX_ROWS) break;
    if (typeof row.key !== "string" || row.key === "" || row.key.length > SNAPSHOT_MAX_KEY_LENGTH) continue;
    if (seen.has(row.key) || !isRecordableTotals(row)) continue;
    seen.add(row.key);
    kept.push({ key: row.key, clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position });
  }
  return kept;
}

const TIMED_OUT = Symbol("timed-out");

/** Resolves with the value, or with TIMED_OUT once `ms` have passed. The work itself is not cancelled. */
function withDeadline<T>(work: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), Math.max(0, ms));
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

function failureOutcome(result: Extract<ProviderResult<unknown>, { ok: false }>): SnapshotCaptureOutcome {
  const { failure } = result;
  switch (failure.state) {
    case "not-connected":
      return { status: "not-connected", reason: failure.reason };
    case "access-denied":
      return { status: "access-denied" };
    case "unavailable":
      return { status: "unavailable", reason: failure.reason };
  }
}

/** A secondary read (queries or pages): its rows when fresh and for the right property, else unavailable. */
function secondaryRows(
  result: ProviderResult<readonly SearchPerformanceRow[]>,
  property: string,
): { readonly rows: readonly SearchPerformanceRow[]; readonly unavailable: boolean } {
  if (!result.ok || result.stale || result.property !== property) return { rows: [], unavailable: true };
  return { rows: snapshotRows(result.value), unavailable: false };
}

export function createSnapshotCapture(deps: SnapshotCaptureDependencies) {
  const { provider, properties, projects, store, now = () => new Date(), log = () => {} } = deps;

  /** One project: read Google for its mapped property and record the answer. Never throws. */
  async function captureProject(
    projectId: string,
    window: SearchConsoleWindow,
    remainingMs: number,
  ): Promise<SnapshotCaptureOutcome> {
    const property = properties.get(projectId);
    if (!property) return { status: "not-connected", reason: "no-property" };
    if (!provider.configured) return { status: "not-connected", reason: "not-configured" };
    if (!store.storesSnapshots) return { status: "store-unavailable" };

    if ((await projects.getProjectById(projectId)) === null) return { status: "project-not-found" };

    const reads = await withDeadline(
      Promise.all([
        provider.getSearchPerformance(projectId, window),
        provider.getQueryPerformance(projectId, window),
        provider.getPagePerformance(projectId, window),
      ]),
      remainingMs,
    );
    if (reads === TIMED_OUT) return { status: "unavailable", reason: "timeout" };
    const [totals, queries, pages] = reads;

    if (!totals.ok) return failureOutcome(totals);
    if (totals.property !== property) return { status: "property-mismatch" };
    if (totals.stale) return { status: "stale-skipped" };

    let input: RecordSnapshotInput;
    if (totals.value === null) {
      input = {
        projectId,
        property,
        window,
        state: "no-data",
        totals: null,
        queries: [],
        pages: [],
        partial: [],
        fetchedAt: totals.fetchedAt,
      };
    } else {
      if (!isRecordableTotals(totals.value)) {
        log("warn", "search_console.snapshot_totals_invalid", { projectId });
        return { status: "unavailable", reason: "error" };
      }
      const q = secondaryRows(queries, property);
      const p = secondaryRows(pages, property);
      const partial: SnapshotPartial[] = [];
      if (q.unavailable) partial.push("queries-unavailable");
      if (p.unavailable) partial.push("pages-unavailable");
      input = {
        projectId,
        property,
        window,
        state: "connected",
        totals: totals.value,
        queries: q.rows,
        pages: p.rows,
        partial,
        fetchedAt: totals.fetchedAt,
      };
    }

    try {
      const recorded = await store.record(input);
      switch (recorded.status) {
        case "created":
          return input.state === "no-data"
            ? { status: "no-data-created", snapshot: recorded.snapshot }
            : { status: "created", snapshot: recorded.snapshot };
        case "exists":
          return { status: "exists", snapshot: recorded.snapshot };
        case "not-found":
          return { status: "project-not-found" };
      }
    } catch (error) {
      log("error", "search_console.snapshot_store_failed", {
        projectId,
        errorCode:
          typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
            ? error.code
            : error instanceof Error
              ? error.name
              : "unknown",
      });
      return { status: "store-failed" };
    }
  }

  return {
    /** Every stored project, in repository order, at most `maxProjects` attempted within `budgetMs`. */
    async capture(options: SnapshotCaptureOptions): Promise<SnapshotCaptureBatch> {
      const { maxProjects, budgetMs } = options;
      if (!Number.isInteger(maxProjects) || maxProjects < 1 || maxProjects > MAX_CAPTURE_PROJECTS) {
        throw new Error(`Search Console snapshot capture: a batch attempts 1 to ${MAX_CAPTURE_PROJECTS} projects.`);
      }
      if (!Number.isInteger(budgetMs) || budgetMs < 1) {
        throw new Error("Search Console snapshot capture: the time budget must be a positive whole number of milliseconds.");
      }

      const startedAt = performance.now();
      const elapsed = () => Math.round(performance.now() - startedAt);
      const window = snapshotWindow(now());
      const entries: SnapshotCaptureEntry[] = [];
      let attempted = 0;
      let stoppedBy: SnapshotCaptureBatch["stoppedBy"] = "complete";

      for (const projectId of await projects.listProjectIds()) {
        // An unmapped project costs nothing and is reported, not counted.
        if (!properties.has(projectId)) {
          entries.push({ projectId, outcome: { status: "not-connected", reason: "no-property" }, durationMs: 0 });
          continue;
        }
        if (attempted >= maxProjects) {
          stoppedBy = "project-limit";
          break;
        }
        const remainingMs = budgetMs - elapsed();
        if (remainingMs < MIN_PROJECT_BUDGET_MS) {
          stoppedBy = "time-budget";
          break;
        }

        attempted += 1;
        const began = performance.now();
        const outcome = await captureProject(projectId, window, remainingMs);
        const durationMs = Math.round(performance.now() - began);
        entries.push({ projectId, outcome, durationMs });
        log(outcome.status === "store-failed" ? "error" : "info", "search_console.snapshot", {
          projectId,
          outcome: outcome.status,
          reason: "reason" in outcome ? outcome.reason : null,
          durationMs,
        });
      }

      const durationMs = elapsed();
      log("info", "search_console.snapshot_batch", { count: attempted, stoppedBy, durationMs });
      return { rangeId: SNAPSHOT_RANGE_ID, window, entries, attempted, stoppedBy, durationMs };
    },
  };
}

export type SnapshotCapture = ReturnType<typeof createSnapshotCapture>;
