import type { RangeId } from "@/types/dashboard";

/**
 * Search Console data as the product uses it.
 *
 * Deliberately narrower than the Google API: clicks, impressions, CTR and
 * average position for a property over a window, by query or by page. Nothing
 * here carries search volume, difficulty, backlinks, crawl diagnostics,
 * competitors or AI visibility, because Search Console does not measure them.
 *
 * No type in this file mirrors a Google response shape. The provider maps
 * Google's rows into these before anything else sees them.
 */

/** The dates a report actually covers, in Search Console's own time zone. */
export type SearchConsoleWindow = {
  readonly rangeId: RangeId;
  /** Inclusive ISO date, YYYY-MM-DD. */
  readonly startDate: string;
  /** Inclusive ISO date, YYYY-MM-DD. */
  readonly endDate: string;
  readonly days: number;
};

export type SearchPerformance = {
  readonly clicks: number;
  readonly impressions: number;
  /** Click-through rate as a fraction, 0–1. */
  readonly ctr: number;
  /** Impression-weighted average position; 0 when there were no impressions. */
  readonly position: number;
};

/** One query or one page, with its performance over the window. */
export type SearchPerformanceRow = SearchPerformance & {
  readonly key: string;
};

/**
 * One (query, page) pair Google reported over the window, with the pair's own
 * performance (milestone M1, P4c). Search Console omits anonymised queries
 * from dimensioned rows and the request is capped, so a set of these is
 * never the property's complete demand.
 */
export type SearchQueryPageRow = SearchPerformance & {
  readonly query: string;
  readonly page: string;
};

/** Why a connected report is incomplete. */
export type SearchConsolePartial =
  /** The previous window reaches past the 16 months Search Console keeps. */
  | "comparison-beyond-retention"
  /** The previous window could not be read (the request failed), so there is no comparison. */
  | "comparison-unavailable"
  /** The previous window was read and Google reported no data in it yet, so there is no comparison (fix F7, A6-04). */
  | "comparison-no-data"
  /** Top queries could not be read. */
  | "queries-unavailable"
  /** Top pages could not be read. */
  | "pages-unavailable";

export type SearchConsoleNotConnectedReason =
  /** No Google credentials are configured on the server. */
  | "not-configured"
  /** Credentials exist, but this project is not mapped to a property. */
  | "no-property";

export type SearchConsoleUnavailableReason =
  | "timeout"
  | "rate-limited"
  /** Google refused the service account's credentials. */
  | "credentials-rejected"
  /** The server's Search Console settings are malformed. */
  | "misconfigured"
  | "error";

type ReportBase = {
  readonly projectId: string;
  readonly source: "search-console";
};

export type SearchConsoleReport =
  | (ReportBase & {
      readonly state: "connected";
      readonly property: string;
      readonly window: SearchConsoleWindow;
      readonly previousWindow: SearchConsoleWindow | null;
      readonly totals: SearchPerformance;
      readonly previousTotals: SearchPerformance | null;
      readonly queries: readonly SearchPerformanceRow[];
      readonly pages: readonly SearchPerformanceRow[];
      readonly partial: readonly SearchConsolePartial[];
      /** When Google answered, ISO timestamp. */
      readonly fetchedAt: string;
      /** Served from cache after a failed refresh. */
      readonly stale: boolean;
    })
  | (ReportBase & {
      readonly state: "no-data";
      readonly property: string;
      readonly window: SearchConsoleWindow;
      readonly fetchedAt: string;
      readonly stale: boolean;
    })
  | (ReportBase & {
      readonly state: "not-connected";
      readonly reason: SearchConsoleNotConnectedReason;
    })
  | (ReportBase & {
      readonly state: "access-denied";
      readonly property: string;
    })
  | (ReportBase & {
      readonly state: "unavailable";
      readonly reason: SearchConsoleUnavailableReason;
    });

export type SearchConsoleReportState = SearchConsoleReport["state"];

/** A property the service account can see. */
export type SearchConsoleSite = {
  readonly property: string;
  readonly permission: "owner" | "full" | "restricted" | "unverified";
};
