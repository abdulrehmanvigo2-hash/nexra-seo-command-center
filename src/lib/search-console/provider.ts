import "server-only";

import type { RangeId } from "@/types/dashboard";
import type {
  SearchConsoleNotConnectedReason,
  SearchConsolePartial,
  SearchConsoleReport,
  SearchConsoleSite,
  SearchConsoleUnavailableReason,
  SearchConsoleWindow,
  SearchPerformance,
  SearchPerformanceRow,
  SearchQueryPageRow,
} from "@/types/search-console";
import { createProviderCache, type ProviderCache } from "@/lib/search-console/cache";
import type { SearchConsoleConfig } from "@/lib/search-console/config";
import { searchConsoleWindows } from "@/lib/search-console/date-windows";
import {
  SearchConsoleProviderError,
  type SearchConsoleClient,
} from "@/lib/search-console/google-client";
import {
  canReadProperty,
  mapDimensionRows,
  mapQueryPageRows,
  mapSites,
  mapTotals,
} from "@/lib/search-console/mappers";

/**
 * The Search Console provider: the one boundary product code talks to.
 *
 * It resolves a project to its mapped property, confirms the service account
 * can read that property, and answers in product types. Every answer says
 * what happened — connected, not connected, access denied, unavailable — and
 * none of them substitutes a number for a failure.
 *
 * Results are cached (see `createProviderCache`): the property list for ten
 * minutes, performance for an hour, and either may be served stale for up to
 * a day when Google cannot be reached, marked as such. Search Console
 * finalises data days after the fact, so an hour-old answer is as current as
 * a new one for all practical purposes.
 */

export type ProviderFailure =
  | { readonly state: "not-connected"; readonly reason: SearchConsoleNotConnectedReason }
  | { readonly state: "access-denied"; readonly property: string }
  | { readonly state: "unavailable"; readonly reason: SearchConsoleUnavailableReason };

export type ProviderResult<T> =
  | {
      readonly ok: true;
      readonly value: T;
      /** The property answered for; null for the property list itself. */
      readonly property: string | null;
      readonly fetchedAt: string;
      readonly stale: boolean;
    }
  | { readonly ok: false; readonly failure: ProviderFailure };

export type SearchConsoleProvider = {
  /** False when no credentials are configured: every project is not connected. */
  readonly configured: boolean;
  listSites(): Promise<ProviderResult<readonly SearchConsoleSite[]>>;
  /** Totals for a window; null value when the property had no impressions. */
  getSearchPerformance(
    projectId: string,
    window: SearchConsoleWindow,
  ): Promise<ProviderResult<SearchPerformance | null>>;
  getQueryPerformance(
    projectId: string,
    window: SearchConsoleWindow,
  ): Promise<ProviderResult<readonly SearchPerformanceRow[]>>;
  getPagePerformance(
    projectId: string,
    window: SearchConsoleWindow,
  ): Promise<ProviderResult<readonly SearchPerformanceRow[]>>;
  /**
   * Google's query × page rows for the window (dimensions query and page, in
   * that order), at most QUERY_PAGE_ROW_LIMIT of them by clicks (M1, P4c).
   * One request, cached like the others; the same property, credentials,
   * window and failure semantics as every other read.
   */
  getQueryPagePerformance(
    projectId: string,
    window: SearchConsoleWindow,
  ): Promise<ProviderResult<readonly SearchQueryPageRow[]>>;
};

export const SITES_FRESH_MS = 10 * 60 * 1000;
export const PERFORMANCE_FRESH_MS = 60 * 60 * 1000;
export const STALE_LIMIT_MS = 24 * 60 * 60 * 1000;
export const TOP_ROWS = 25;
/**
 * The most query × page rows one request asks for and one capture stores:
 * the `rowLimit` sent to Google and the cap the database function enforces
 * (migration 20260930120000). Google returns the rows with the most clicks
 * first, so the set is a top cut, never the property's complete demand.
 */
export const QUERY_PAGE_ROW_LIMIT = 250;

function failureFrom(error: unknown, property: string | null): ProviderFailure {
  const kind = error instanceof SearchConsoleProviderError ? error.kind : "error";
  if ((kind === "access-denied" || kind === "not-found") && property) {
    return { state: "access-denied", property };
  }
  if (kind === "timeout" || kind === "rate-limited" || kind === "credentials-rejected") {
    return { state: "unavailable", reason: kind };
  }
  return { state: "unavailable", reason: "error" };
}

type Timed<T> = { readonly value: T; readonly fetchedAt: string };

/** A provider for a configuration that could not be read. */
export function createMisconfiguredProvider(): SearchConsoleProvider {
  const failure: ProviderFailure = { state: "unavailable", reason: "misconfigured" };
  const fail = async () => ({ ok: false, failure }) as const;
  return {
    configured: true,
    listSites: fail,
    getSearchPerformance: fail,
    getQueryPerformance: fail,
    getPagePerformance: fail,
    getQueryPagePerformance: fail,
  };
}

export function createSearchConsoleProvider(options: {
  readonly config: SearchConsoleConfig;
  readonly client: SearchConsoleClient | null;
  readonly sitesCache?: ProviderCache;
  readonly performanceCache?: ProviderCache;
  readonly now?: () => number;
  readonly log?: (message: string) => void;
}): SearchConsoleProvider {
  const {
    config,
    client,
    now = Date.now,
    log = (message) => console.error(message),
    sitesCache = createProviderCache({ freshMs: SITES_FRESH_MS, staleMs: STALE_LIMIT_MS, now }),
    performanceCache = createProviderCache({
      freshMs: PERFORMANCE_FRESH_MS,
      staleMs: STALE_LIMIT_MS,
      now,
    }),
  } = options;

  const stamp = () => new Date(now()).toISOString();

  const report = (error: unknown, read?: string) => {
    // Kind and status only: never a Google response body, never a token. A report read names its window and
    // dimensions, so a failed earlier-window read can be told from the current one (fix F7, A6-04).
    log(
      `search-console: ${error instanceof SearchConsoleProviderError ? error.message : error instanceof Error ? error.name : "unknown error"}${read ? ` (${read})` : ""}`,
    );
  };

  async function sites(): Promise<ProviderResult<readonly SearchConsoleSite[]>> {
    if (config.status !== "configured" || !client) {
      return { ok: false, failure: { state: "not-connected", reason: "not-configured" } };
    }
    try {
      const read = await sitesCache.read<Timed<readonly SearchConsoleSite[]>>("sites", async () => ({
        value: mapSites(await client.listSites()),
        fetchedAt: stamp(),
      }));
      return { ok: true, ...read.value, property: null, stale: read.stale };
    } catch (error) {
      report(error);
      return { ok: false, failure: failureFrom(error, null) };
    }
  }

  /** The project's property, if it is mapped and readable by this account. */
  async function propertyFor(
    projectId: string,
  ): Promise<{ ok: true; property: string } | { ok: false; failure: ProviderFailure }> {
    if (config.status !== "configured" || !client) {
      return { ok: false, failure: { state: "not-connected", reason: "not-configured" } };
    }
    const property = config.properties.get(projectId);
    if (!property) return { ok: false, failure: { state: "not-connected", reason: "no-property" } };

    const listed = await sites();
    if (!listed.ok) return listed;
    if (!canReadProperty(listed.value, property)) {
      return { ok: false, failure: { state: "access-denied", property } };
    }
    return { ok: true, property };
  }

  /** A dimensioned read: one dimension's top rows, the query × page pairs, or (no dimension) the totals. */
  async function analytics<T>(
    projectId: string,
    window: SearchConsoleWindow,
    dimensions: readonly ("query" | "page")[],
    rowLimit: number,
    map: (response: unknown) => T,
  ): Promise<ProviderResult<T>> {
    const resolved = await propertyFor(projectId);
    if (!resolved.ok) return resolved;
    const { property } = resolved;
    // The cache key names every dimension, so the pair read never shares a cached single-dimension answer.
    const key = JSON.stringify([property, window.startDate, window.endDate, dimensions.length === 0 ? null : dimensions.length === 1 ? dimensions[0] : dimensions]);

    try {
      const read = await performanceCache.read<Timed<T>>(key, async () => ({
        value: map(
          await client!.querySearchAnalytics(property, {
            startDate: window.startDate,
            endDate: window.endDate,
            dimensions,
            rowLimit,
          }),
        ),
        fetchedAt: stamp(),
      }));
      return { ok: true, ...read.value, property, stale: read.stale };
    } catch (error) {
      report(error, `window ${window.startDate}..${window.endDate}, ${dimensions.length === 0 ? "totals" : dimensions.join(" x ")}`);
      return { ok: false, failure: failureFrom(error, property) };
    }
  }

  return {
    configured: config.status === "configured",
    listSites: sites,
    getSearchPerformance: (projectId, window) => analytics(projectId, window, [], 1, mapTotals),
    getQueryPerformance: (projectId, window) => analytics(projectId, window, ["query"], TOP_ROWS, mapDimensionRows),
    getPagePerformance: (projectId, window) => analytics(projectId, window, ["page"], TOP_ROWS, mapDimensionRows),
    getQueryPagePerformance: (projectId, window) => analytics(projectId, window, ["query", "page"], QUERY_PAGE_ROW_LIMIT, mapQueryPageRows),
  };
}

/**
 * Everything the product shows for one project and range, in one answer.
 *
 * The current window's totals decide the state: without them there is nothing
 * honest to show, so their failure is the report's failure. The comparison,
 * top queries and top pages are secondary — if one of them fails, the report
 * is still connected, lists what is missing in `partial`, and leaves that part
 * empty rather than filled.
 */
export async function getSearchConsoleReport(
  provider: SearchConsoleProvider,
  projectId: string,
  rangeId: RangeId,
  now: Date = new Date(),
): Promise<SearchConsoleReport> {
  const base = { projectId, source: "search-console" } as const;
  const windows = searchConsoleWindows(rangeId, now);

  const [totals, previous, queries, pages] = await Promise.all([
    provider.getSearchPerformance(projectId, windows.current),
    windows.previous ? provider.getSearchPerformance(projectId, windows.previous) : null,
    provider.getQueryPerformance(projectId, windows.current),
    provider.getPagePerformance(projectId, windows.current),
  ]);

  if (!totals.ok) return { ...base, ...totals.failure };

  const property = totals.property ?? "";
  const fetched = [totals, previous, queries, pages].filter(
    (result): result is Extract<typeof totals, { ok: true }> => result !== null && result.ok,
  );
  const fetchedAt = fetched.map((result) => result.fetchedAt).sort()[0];
  const stale = fetched.some((result) => result.stale);

  if (totals.value === null) {
    return {
      ...base,
      state: "no-data",
      property,
      window: windows.current,
      fetchedAt,
      stale,
    };
  }

  const partial: SearchConsolePartial[] = [];
  let previousTotals: SearchPerformance | null = null;
  if (!windows.previous) partial.push("comparison-beyond-retention");
  else if (!previous?.ok) partial.push("comparison-unavailable");
  else if (previous.value === null) partial.push("comparison-no-data");
  else previousTotals = previous.value;
  if (!queries.ok) partial.push("queries-unavailable");
  if (!pages.ok) partial.push("pages-unavailable");

  return {
    ...base,
    state: "connected",
    property,
    window: windows.current,
    previousWindow: previousTotals ? windows.previous : null,
    totals: totals.value,
    previousTotals,
    queries: queries.ok ? queries.value : [],
    pages: pages.ok ? pages.value : [],
    partial,
    fetchedAt,
    stale,
  };
}
