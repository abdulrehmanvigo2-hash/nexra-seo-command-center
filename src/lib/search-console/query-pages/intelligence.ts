import { analyseQueryPages, type QueryPageAnalysis } from "@/lib/search-console/query-pages/analyse";
import { compareQueryPageWindows, type QueryPageComparison } from "@/lib/search-console/query-pages/compare";
import { QUERY_PAGE_RANGE_ID, type StoredQueryPage } from "@/lib/search-console/query-pages/contract";
import { groupQueryPageWindows, selectQueryPageWindows } from "@/lib/search-console/query-pages/select";

/**
 * Everything a reader learns from a project's stored query × page rows, in
 * one pure step (M1 P4c): the windows, the latest window's overlap analysis
 * and, when an eligible earlier window exists, the change between the two.
 * Unavailable states are named, never filled: no rows, rows only under a
 * previous property, or (from the server wiring) a deployment that keeps
 * none, or a read that failed.
 */

export type QueryPageWindowSummary = {
  readonly startDate: string;
  readonly endDate: string;
  readonly fetchedAt: string;
  readonly analysis: QueryPageAnalysis;
};

export type QueryPageIntelligence =
  | {
      readonly available: true;
      readonly property: string;
      readonly rangeId: typeof QUERY_PAGE_RANGE_ID;
      readonly latest: QueryPageWindowSummary;
      /** The newest eligible earlier window, or null when there is none yet. */
      readonly previous: QueryPageWindowSummary | null;
      readonly comparison: QueryPageComparison | null;
      /** Windows of the current property, in total. */
      readonly windows: number;
      /** Windows under another property, set aside. */
      readonly otherProperty: number;
    }
  | { readonly available: false; readonly reason: "no-pairs" | "no-pairs-for-property"; readonly otherProperty: number };

/** The reader's full input, including the two states only the server wiring can produce. */
export type QueryPageInput =
  | QueryPageIntelligence
  /** This deployment keeps no query × page rows (fixture data source). */
  | { readonly available: false; readonly reason: "not-kept" }
  /** The stored rows could not be read. */
  | { readonly available: false; readonly reason: "read-failed" };

export function buildQueryPageIntelligence(rows: readonly StoredQueryPage[], currentProperty: string, readLimit: number): QueryPageIntelligence {
  const selection = selectQueryPageWindows(groupQueryPageWindows(rows, readLimit), currentProperty);
  if (!selection.ok) return { available: false, reason: selection.reason, otherProperty: selection.otherProperty };
  const latest: QueryPageWindowSummary = {
    startDate: selection.latest.startDate,
    endDate: selection.latest.endDate,
    fetchedAt: selection.latest.fetchedAt,
    analysis: analyseQueryPages(selection.latest.rows),
  };
  const previous: QueryPageWindowSummary | null = selection.previous
    ? {
        startDate: selection.previous.startDate,
        endDate: selection.previous.endDate,
        fetchedAt: selection.previous.fetchedAt,
        analysis: analyseQueryPages(selection.previous.rows),
      }
    : null;
  return {
    available: true,
    property: currentProperty,
    rangeId: QUERY_PAGE_RANGE_ID,
    latest,
    previous,
    comparison: previous && selection.gapDays !== null ? compareQueryPageWindows(latest.analysis, previous.analysis, selection.gapDays) : null,
    windows: selection.eligible,
    otherProperty: selection.otherProperty,
  };
}
