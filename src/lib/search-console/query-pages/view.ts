import { HISTORY_KEY_MAX, HISTORY_RANGE_ID } from "@/lib/search-console/history/view";
import { LOW_CONFIDENCE_GAP_DAYS, MIN_GAP_DAYS } from "@/lib/search-console/history/thresholds";
import type { QueryPageComparison } from "@/lib/search-console/query-pages/compare";
import { QUERY_PAGE_ROW_LIMIT } from "@/lib/search-console/query-pages/contract";
import type { QueryPageInput } from "@/lib/search-console/query-pages/intelligence";
import {
  CANDIDATE_MAX_POSITION_GAP,
  CANDIDATE_MIN_IMPRESSIONS,
  CANDIDATE_MIN_PAGES,
  CHANGE_MIN_IMPRESSIONS,
  MAX_OVERLAPS,
  MAX_PAGES_PER_OVERLAP,
} from "@/lib/search-console/query-pages/thresholds";
import type { SearchPerformance } from "@/types/search-console";

/**
 * Stored query × page overlap, as the operator's screen may see it (M1
 * P4c). A projection of the intelligence to what a panel needs and nothing
 * the browser should hold: no property name, no row id, no full 250-row
 * set. At most MAX_OVERLAPS overlaps of MAX_PAGES_PER_OVERLAP pages, with
 * the true counts beside them; every figure is the analysis's own
 * arithmetic, passed through. The caveats are fixed sentences the section
 * always shows. Pure and client-safe: no store, no server import, so the
 * component can share the URL and the wording with the route.
 */

export const QUERY_PAGE_VIEW_RANGE_ID = HISTORY_RANGE_ID;

export type OverlapPageView = SearchPerformance & {
  readonly page: string;
  readonly share: number;
  readonly leading: boolean;
};

export type OverlapView = {
  readonly query: string;
  readonly pages: readonly OverlapPageView[];
  readonly pageCount: number;
  readonly impressions: number;
  readonly clicks: number;
  readonly candidate: boolean;
  readonly meaningfulPages: number;
  readonly positionGap: number | null;
};

export type ChangeView = {
  readonly previousEndDate: string;
  readonly gapDays: number;
  readonly confidence: "normal" | "low";
  readonly matched: number;
  readonly appeared: readonly { readonly query: string; readonly pageCount: number; readonly impressions: number }[];
  readonly disappeared: readonly { readonly query: string; readonly pageCount: number; readonly impressions: number }[];
  readonly leaderChanged: readonly { readonly query: string; readonly previousLeadingPage: string; readonly latestLeadingPage: string }[];
  readonly impressionsChanged: readonly { readonly query: string; readonly previous: number; readonly latest: number; readonly absolute: number }[];
  readonly counts: { readonly appeared: number; readonly disappeared: number; readonly leaderChanged: number; readonly impressionsChanged: number };
};

export type QueryPageView =
  | {
      /** Pairs are stored and at least one overlap was observed. */
      readonly status: "overlaps";
      readonly startDate: string;
      readonly endDate: string;
      readonly pairs: number;
      readonly queries: number;
      readonly pageTotal: number;
      readonly overlaps: readonly OverlapView[];
      readonly counts: { readonly overlaps: number; readonly candidates: number };
      readonly concentration: readonly { readonly page: string; readonly overlapsLed: number; readonly overlaps: number; readonly impressions: number }[];
      readonly change: ChangeView | null;
      readonly windows: number;
      readonly underOtherProperty: boolean;
      readonly caveats: readonly string[];
    }
  /** Pairs are stored, but no query was reported on two pages: insufficient to name an overlap. */
  | { readonly status: "no-overlap"; readonly startDate: string; readonly endDate: string; readonly pairs: number; readonly queries: number; readonly pageTotal: number; readonly windows: number; readonly caveats: readonly string[] }
  | { readonly status: "no-pairs" | "no-pairs-for-property" }
  /** This deployment keeps no query × page rows. */
  | { readonly status: "not-kept" };

export const QUERY_PAGE_CAVEATS: readonly string[] = [
  `Pairs are Google's top ${QUERY_PAGE_ROW_LIMIT} query × page rows by clicks for the window, and Search Console leaves anonymised queries out. The set is incomplete by design: an overlap absent here is unobserved, not ruled out.`,
  `"Potential query overlap" means one query was reported on two or more of the site's pages. "Cannibalization candidate for review" means at least ${CANDIDATE_MIN_PAGES} of them each had at least ${CANDIDATE_MIN_IMPRESSIONS} impressions with average positions within ${CANDIDATE_MAX_POSITION_GAP} places. Both are fixed labels for review, not findings, and neither confirms cannibalisation or says why Google chose a page.`,
  "The leading page is the page shown most for the query in the set. No page owns a query. Average position is Search Console's impression-weighted average for that query on that page, not a rank tracker's reading, and there is no search volume, difficulty, SERP feature or indexation data here.",
  `Change between two stored windows is arithmetic over two observed cuts, not a trend and not a cause; an impressions change is named only at ${CHANGE_MIN_IMPRESSIONS} or more.`,
];

const cutKey = (key: string) => (key.length > HISTORY_KEY_MAX ? key.slice(0, HISTORY_KEY_MAX) : key);

function changeView(comparison: QueryPageComparison, previousEndDate: string): ChangeView {
  return {
    previousEndDate,
    gapDays: comparison.gapDays,
    confidence: comparison.confidence,
    matched: comparison.matched,
    appeared: comparison.appeared.slice(0, MAX_OVERLAPS).map((r) => ({ query: cutKey(r.query), pageCount: r.pageCount, impressions: r.impressions })),
    disappeared: comparison.disappeared.slice(0, MAX_OVERLAPS).map((r) => ({ query: cutKey(r.query), pageCount: r.pageCount, impressions: r.impressions })),
    leaderChanged: comparison.leaderChanged.slice(0, MAX_OVERLAPS).map((r) => ({ query: cutKey(r.query), previousLeadingPage: cutKey(r.previousLeadingPage), latestLeadingPage: cutKey(r.latestLeadingPage) })),
    impressionsChanged: comparison.impressionsChanged.slice(0, MAX_OVERLAPS).map((r) => ({ query: cutKey(r.query), previous: r.previousImpressions, latest: r.latestImpressions, absolute: r.absolute })),
    counts: {
      appeared: comparison.appeared.length,
      disappeared: comparison.disappeared.length,
      leaderChanged: comparison.leaderChanged.length,
      impressionsChanged: comparison.impressionsChanged.length,
    },
  };
}

export function presentQueryPages(input: QueryPageInput | null): QueryPageView {
  if (input === null) return { status: "not-kept" };
  if (!input.available) {
    if (input.reason === "not-kept" || input.reason === "read-failed") return { status: "not-kept" };
    return { status: input.reason };
  }
  const a = input.latest.analysis;
  const base = { startDate: input.latest.startDate, endDate: input.latest.endDate, pairs: a.pairs, queries: a.queries, pageTotal: a.pages, windows: input.windows, caveats: QUERY_PAGE_CAVEATS };
  if (a.overlapCount === 0) return { status: "no-overlap", ...base };
  return {
    status: "overlaps",
    ...base,
    overlaps: a.overlaps.slice(0, MAX_OVERLAPS).map((o) => ({
      query: cutKey(o.query),
      pages: o.pages.slice(0, MAX_PAGES_PER_OVERLAP).map((p) => ({ page: cutKey(p.page), clicks: p.clicks, impressions: p.impressions, ctr: p.ctr, position: p.position, share: p.share, leading: p.page === o.leadingPage })),
      pageCount: o.pageCount,
      impressions: o.impressions,
      clicks: o.clicks,
      candidate: o.candidate,
      meaningfulPages: o.meaningfulPages,
      positionGap: o.positionGap,
    })),
    counts: { overlaps: a.overlapCount, candidates: a.candidateCount },
    concentration: a.concentration.map((c) => ({ page: cutKey(c.page), overlapsLed: c.overlapsLed, overlaps: c.overlaps, impressions: c.impressions })),
    change: input.previous && input.comparison ? changeView(input.comparison, input.previous.endDate) : null,
    underOtherProperty: input.otherProperty > 0,
  };
}

// ---------------------------------------------------------------------------
// The browser's side: where to ask, and how each answer reads.

export function queryPagesUrl(projectId: string): string {
  const params = new URLSearchParams({ project: projectId, range: QUERY_PAGE_VIEW_RANGE_ID });
  return `/api/search-console/query-pages?${params.toString()}`;
}

/** What a refused or failed read means. None of these says the project has no overlap. */
export function queryPagesReadFailure(httpStatus: number): string {
  if (httpStatus === 401) return "Your session has ended. Reload the page to sign in again.";
  if (httpStatus === 404) return "This project is not stored, so its query × page rows were not read.";
  if (httpStatus === 429) return "Too many requests. Wait a moment and refresh.";
  return "Stored query × page rows could not be read. The live report above is unaffected.";
}

export type QueryPageStatusMessage = { readonly title: string; readonly description: string };

export function describeQueryPageStatus(view: Exclude<QueryPageView, { status: "overlaps" }>): QueryPageStatusMessage {
  switch (view.status) {
    case "not-kept":
      return { title: "No stored query × page rows on this deployment", description: "Query × page rows are not kept here, so overlap cannot be read. The live report above stands alone." };
    case "no-pairs":
      return { title: "No stored query × page rows yet", description: "The scheduled capture has not recorded query × page rows for this project. They are recorded after each connected snapshot." };
    case "no-pairs-for-property":
      return { title: "Stored rows are for a previous property", description: "This project's query × page rows were recorded under another Search Console property. They describe a different site and are not analysed." };
    case "no-overlap":
      return {
        title: "No query overlap observed",
        description: `${view.pairs} stored pairs over ${view.queries} queries and ${view.pageTotal} pages for the window ending ${view.endDate}; no query was reported on two pages. Overlaps outside Google's top ${QUERY_PAGE_ROW_LIMIT} rows are unobserved, not ruled out.`,
      };
  }
}

export const CHANGE_CONFIDENCE_COPY: Readonly<Record<"normal" | "low", string>> = {
  normal: "Normal confidence",
  low: `Low confidence: the two windows end under ${LOW_CONFIDENCE_GAP_DAYS} days apart and overlap.`,
};

export const NO_CHANGE_COPY = `No earlier window to compare: a change needs an earlier window ending at least ${MIN_GAP_DAYS} days before the latest.`;
