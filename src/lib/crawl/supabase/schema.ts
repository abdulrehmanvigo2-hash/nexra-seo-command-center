import type {
  ClaimedPage,
  Crawl,
  CrawlFailureCode,
  CrawlLimit,
  CrawlPage,
  CrawlPageFailure,
  CrawlPageSkipReason,
  CrawlPageState,
  CrawlSource,
  CrawlStatus,
  DiscoveredUrl,
  PageObservation,
  PageSignals,
  RedirectHop,
  SignalState,
  RobotsPolicy,
  SitemapSource,
  UrlRefusal,
} from "@/types/crawl";

/**
 * The `crawls` and `crawl_urls` tables as the application sees them, and the
 * translation to and from the domain shapes.
 *
 * Snake-case rows exist only in this folder. The column list mirrors
 * supabase/migrations/20260919120000_create_crawls.sql, and every value is
 * checked on the way out rather than trusted: a schema that has drifted from
 * the migration fails loudly here instead of producing a crawl with an
 * undefined status.
 */

export type CrawlRow = {
  id: string;
  project_id: string;
  site: string;
  status: CrawlStatus;
  robots_state: string | null;
  sitemap_count: number;
  discovered_count: number;
  limits: string[];
  pages_total: number;
  pages_fetched: number;
  pages_failed: number;
  pages_skipped: number;
  failure_code: string | null;
  created_by: string | null;
  source: CrawlSource;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
};

export type CrawlInsert = Pick<CrawlRow, "project_id" | "site" | "source"> &
  Partial<Omit<CrawlRow, "project_id" | "site" | "source">>;

export type CrawlUrlRow = {
  crawl_id: string;
  url: string;
  source: SitemapSource | "homepage";
  discovered_at: string;
};

export type CrawlUrlInsert = Omit<CrawlUrlRow, "discovered_at"> &
  Partial<Pick<CrawlUrlRow, "discovered_at">>;

/** A row of `public.crawl_pages`: one discovered URL and what it answered. */
export type CrawlPageRow = {
  crawl_id: string;
  url: string;
  state: CrawlPageState;
  attempt_count: number;
  max_attempts: number;
  lease_token: string | null;
  lease_expires_at: string | null;
  http_status: number | null;
  final_url: string | null;
  redirects: RedirectHop[];
  content_type: string | null;
  bytes: number | null;
  duration_ms: number | null;
  failure: string | null;
  refusal: string | null;
  skip_reason: string | null;
  discovered_at: string;
  fetched_at: string | null;
  updated_at: string;
};

export type CrawlPageInsert = Pick<CrawlPageRow, "crawl_id" | "url"> &
  Partial<Omit<CrawlPageRow, "crawl_id" | "url">>;

/** A row of `public.crawl_page_signals`: what one page's HTML declared. */
export type CrawlPageSignalsRow = {
  crawl_id: string;
  url: string;
  state: SignalState;
  title: string | null;
  meta_description: string | null;
  canonical_url: string | null;
  meta_robots: string | null;
  h1: string[];
  h2: string[];
  word_count: number | null;
  internal_links: number | null;
  external_links: number | null;
  other_links: number | null;
  parsed_at: string;
  updated_at: string;
};

export type CrawlPageSignalsInsert = Omit<CrawlPageSignalsRow, "updated_at"> &
  Partial<Pick<CrawlPageSignalsRow, "updated_at">>;

export type CrawlsDatabase = {
  public: {
    Tables: {
      crawls: { Row: CrawlRow; Insert: CrawlInsert; Update: Partial<CrawlInsert>; Relationships: [] };
      crawl_urls: {
        Row: CrawlUrlRow;
        Insert: CrawlUrlInsert;
        Update: Partial<CrawlUrlInsert>;
        Relationships: [];
      };
      crawl_pages: {
        Row: CrawlPageRow;
        Insert: CrawlPageInsert;
        Update: Partial<CrawlPageRow>;
        Relationships: [];
      };
      crawl_page_signals: {
        Row: CrawlPageSignalsRow;
        Insert: CrawlPageSignalsInsert;
        Update: Partial<CrawlPageSignalsRow>;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      crawl_pages_claim: {
        Args: { p_crawl_id: string; p_limit: number; p_lease_seconds: number };
        Returns: unknown;
      };
      crawl_pages_recover_expired: {
        Args: { p_crawl_id: string | null; p_limit: number };
        Returns: unknown;
      };
    };
  };
};

export const CRAWL_READ_COLUMNS =
  "id,project_id,site,status,robots_state,sitemap_count,discovered_count,limits,pages_total,pages_fetched,pages_failed,pages_skipped,failure_code,created_by,source,created_at,started_at,finished_at,updated_at";

export const CRAWL_URL_READ_COLUMNS = "crawl_id,url,source,discovered_at";

/** Raised when a row does not have the shape the migration defines. */
export class CrawlRowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrawlRowError";
  }
}

const STATUSES: readonly CrawlStatus[] = [
  "queued",
  "discovering",
  "fetching",
  "completed",
  "failed",
  "cancelled",
];
const FAILURE_CODES: readonly CrawlFailureCode[] = [
  "robots-unavailable",
  "site-refused",
  "no-sitemap",
  "store-error",
  "timeout",
];
const ROBOTS_STATES: readonly RobotsPolicy["state"][] = ["parsed", "missing", "unavailable"];
const LIMITS: readonly CrawlLimit[] = ["sitemaps", "urls", "depth", "pages"];
const URL_SOURCES: readonly DiscoveredUrl["source"][] = [
  "robots",
  "well-known",
  "index",
  "homepage",
];

function text(row: Record<string, unknown>, column: string): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw new CrawlRowError(
      `crawls.${column} is ${value === null ? "null" : typeof value}, expected text`,
    );
  }
  return value;
}

function nullableText(row: Record<string, unknown>, column: string): string | null {
  const value = row[column];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new CrawlRowError(`crawls.${column} is ${typeof value}, expected text or null`);
  }
  return value;
}

function count(row: Record<string, unknown>, column: string): number {
  const value = row[column];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new CrawlRowError(`crawls.${column} is not a count: ${String(value)}`);
  }
  return value;
}

function oneOf<T extends string>(
  value: string,
  allowed: readonly T[],
  column: string,
): T {
  const match = allowed.find((entry) => entry === value);
  if (match === undefined) {
    throw new CrawlRowError(`crawls.${column} is not a known value: ${value}`);
  }
  return match;
}

/**
 * An ISO 8601 instant in the form the rest of the product writes: UTC, and no
 * fractional seconds when there are none. Postgres serialises `timestamptz` as
 * `2026-09-19T04:00:00+00:00`; every formatter here expects `…Z`.
 */
function instant(value: string, column: string): string {
  const time = Date.parse(value);
  if (Number.isNaN(time)) {
    throw new CrawlRowError(`crawls.${column} is not a timestamp: ${value}`);
  }
  const iso = new Date(time).toISOString();
  return iso.endsWith(".000Z") ? `${iso.slice(0, -5)}Z` : iso;
}

function nullableInstant(value: string | null, column: string): string | null {
  return value === null ? null : instant(value, column);
}

export function crawlRowToCrawl(input: unknown): Crawl {
  if (typeof input !== "object" || input === null) {
    throw new CrawlRowError("crawls row is not an object");
  }
  const row: Record<string, unknown> = { ...input };

  const rawLimits = row.limits;
  if (!Array.isArray(rawLimits)) {
    throw new CrawlRowError("crawls.limits is not an array");
  }
  const limits = rawLimits.map((entry) => {
    if (typeof entry !== "string") throw new CrawlRowError("crawls.limits holds a non-string");
    return oneOf(entry, LIMITS, "limits");
  });

  const robotsState = nullableText(row, "robots_state");
  const failureCode = nullableText(row, "failure_code");

  return {
    id: text(row, "id"),
    projectId: text(row, "project_id"),
    site: text(row, "site"),
    status: oneOf(text(row, "status"), STATUSES, "status"),
    robotsState: robotsState === null ? null : oneOf(robotsState, ROBOTS_STATES, "robots_state"),
    sitemapCount: count(row, "sitemap_count"),
    discoveredCount: count(row, "discovered_count"),
    limits,
    pagesTotal: count(row, "pages_total"),
    pagesFetched: count(row, "pages_fetched"),
    pagesFailed: count(row, "pages_failed"),
    pagesSkipped: count(row, "pages_skipped"),
    failureCode: failureCode === null ? null : oneOf(failureCode, FAILURE_CODES, "failure_code"),
    createdBy: nullableText(row, "created_by"),
    source: oneOf(text(row, "source"), ["operator", "schedule"] as const, "source"),
    createdAt: instant(text(row, "created_at"), "created_at"),
    startedAt: nullableInstant(nullableText(row, "started_at"), "started_at"),
    finishedAt: nullableInstant(nullableText(row, "finished_at"), "finished_at"),
    updatedAt: instant(text(row, "updated_at"), "updated_at"),
  };
}

export function crawlUrlRowToDiscovered(input: unknown): DiscoveredUrl {
  if (typeof input !== "object" || input === null) {
    throw new CrawlRowError("crawl_urls row is not an object");
  }
  const row: Record<string, unknown> = { ...input };
  return {
    url: text(row, "url"),
    source: oneOf(text(row, "source"), URL_SOURCES, "source"),
  };
}

/** The rows one discovery pass writes. */
export function discoveredUrlInserts(
  crawlId: string,
  urls: readonly DiscoveredUrl[],
): readonly CrawlUrlInsert[] {
  return urls.map((entry) => ({ crawl_id: crawlId, url: entry.url, source: entry.source }));
}

// ---------------------------------------------------------------------------
// crawl_pages
// ---------------------------------------------------------------------------

export const CRAWL_PAGE_READ_COLUMNS =
  "crawl_id,url,state,attempt_count,max_attempts,lease_token,lease_expires_at,http_status,final_url,redirects,content_type,bytes,duration_ms,failure,refusal,skip_reason,discovered_at,fetched_at,updated_at";

const PAGE_STATES: readonly CrawlPageState[] = [
  "pending",
  "fetching",
  "fetched",
  "failed",
  "refused",
  "skipped",
];
const PAGE_FAILURES: readonly CrawlPageFailure[] = [
  "refused",
  "timeout",
  "network",
  "too-many-redirects",
  "redirect-refused",
  "too-large",
  "unsupported-type",
  "robots-disallowed",
  "lease-expired",
];
const REFUSALS: readonly UrlRefusal[] = [
  "scheme",
  "credentials",
  "port",
  "ip-literal",
  "hostname",
  "too-long",
  "private-address",
  "dns",
  "off-site",
];
const SKIP_REASONS: readonly CrawlPageSkipReason[] = ["robots-disallowed", "page-limit"];

function nullableCount(row: Record<string, unknown>, column: string): number | null {
  const value = row[column];
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new CrawlRowError(`crawl_pages.${column} is not a count: ${String(value)}`);
  }
  return value;
}

/**
 * The redirect chain, checked rather than trusted.
 *
 * It is `jsonb`, so the database enforces only that it is an array. A hop that
 * is not the shape the fetcher writes is dropped rather than carried into a
 * report as a fact nobody observed.
 */
function redirectsOf(value: unknown): readonly RedirectHop[] {
  if (!Array.isArray(value)) {
    throw new CrawlRowError("crawl_pages.redirects is not an array");
  }
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const hop = entry as Record<string, unknown>;
    return typeof hop.url === "string" &&
      typeof hop.status === "number" &&
      typeof hop.location === "string"
      ? [{ url: hop.url, status: hop.status, location: hop.location }]
      : [];
  });
}

export function crawlPageRowToPage(input: unknown): CrawlPage {
  if (typeof input !== "object" || input === null) {
    throw new CrawlRowError("crawl_pages row is not an object");
  }
  const row: Record<string, unknown> = { ...input };

  const failure = nullableText(row, "failure");
  const refusal = nullableText(row, "refusal");
  const skipReason = nullableText(row, "skip_reason");

  return {
    crawlId: text(row, "crawl_id"),
    url: text(row, "url"),
    state: oneOf(text(row, "state"), PAGE_STATES, "state"),
    attemptCount: count(row, "attempt_count"),
    maxAttempts: count(row, "max_attempts"),
    httpStatus: nullableCount(row, "http_status"),
    finalUrl: nullableText(row, "final_url"),
    redirects: redirectsOf(row.redirects ?? []),
    contentType: nullableText(row, "content_type"),
    bytes: nullableCount(row, "bytes"),
    durationMs: nullableCount(row, "duration_ms"),
    failure: failure === null ? null : oneOf(failure, PAGE_FAILURES, "failure"),
    refusal: refusal === null ? null : oneOf(refusal, REFUSALS, "refusal"),
    skipReason: skipReason === null ? null : oneOf(skipReason, SKIP_REASONS, "skip_reason"),
    discoveredAt: instant(text(row, "discovered_at"), "discovered_at"),
    fetchedAt: nullableInstant(nullableText(row, "fetched_at"), "fetched_at"),
  };
}

/** A claimed row, which must carry the lease token the result is written under. */
export function crawlPageRowToClaimed(input: unknown): ClaimedPage {
  const page = crawlPageRowToPage(input);
  const token = (input as Record<string, unknown>).lease_token;
  if (typeof token !== "string") {
    throw new CrawlRowError("crawl_pages.lease_token is missing on a claimed page");
  }
  return { ...page, leaseToken: token };
}

/**
 * One observation as the columns it sets.
 *
 * Every field the observation does not carry is written as null, so a retried
 * attempt cannot leave a value from a previous one standing beside a
 * contradictory result. The lease is cleared in the same update, which is what
 * takes the row out of the queue.
 */
export function observationToUpdate(observation: PageObservation): Partial<CrawlPageRow> {
  const cleared = {
    lease_token: null,
    lease_expires_at: null,
    fetched_at: new Date().toISOString(),
    http_status: null,
    final_url: null,
    redirects: [] as RedirectHop[],
    content_type: null,
    bytes: null,
    duration_ms: null,
    failure: null,
    refusal: null,
    skip_reason: null,
  } satisfies Partial<CrawlPageRow>;

  switch (observation.state) {
    case "fetched":
      return {
        ...cleared,
        state: "fetched",
        http_status: observation.httpStatus,
        final_url: observation.finalUrl,
        redirects: [...observation.redirects],
        content_type: observation.contentType,
        bytes: observation.bytes,
        duration_ms: observation.durationMs,
      };
    case "failed":
      return {
        ...cleared,
        state: "failed",
        failure: observation.failure,
        refusal: observation.refusal,
        redirects: [...observation.redirects],
        duration_ms: observation.durationMs,
      };
    case "refused":
      return { ...cleared, state: "refused", refusal: observation.refusal };
    case "skipped":
      return { ...cleared, state: "skipped", skip_reason: observation.skipReason };
  }
}

/** The rows a discovery hands to the queue. Defaults do the rest. */
export function pageInserts(
  crawlId: string,
  urls: readonly DiscoveredUrl[],
): readonly CrawlPageInsert[] {
  return urls.map((entry) => ({ crawl_id: crawlId, url: entry.url }));
}

// ---------------------------------------------------------------------------
// crawl_page_signals
// ---------------------------------------------------------------------------

export const CRAWL_PAGE_SIGNALS_READ_COLUMNS =
  "crawl_id,url,state,title,meta_description,canonical_url,meta_robots,h1,h2,word_count,internal_links,external_links,other_links,parsed_at,updated_at";

const SIGNAL_STATES: readonly SignalState[] = ["parsed", "not-html", "empty", "failed"];

/** A stored heading list, checked rather than trusted: it is `jsonb`. */
function headings(value: unknown, column: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw new CrawlRowError(`crawl_page_signals.${column} is not an array`);
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

export function crawlPageSignalsRowToSignals(input: unknown): PageSignals {
  if (typeof input !== "object" || input === null) {
    throw new CrawlRowError("crawl_page_signals row is not an object");
  }
  const row: Record<string, unknown> = { ...input };
  return {
    state: oneOf(text(row, "state"), SIGNAL_STATES, "state"),
    title: nullableText(row, "title"),
    metaDescription: nullableText(row, "meta_description"),
    canonicalUrl: nullableText(row, "canonical_url"),
    metaRobots: nullableText(row, "meta_robots"),
    h1: headings(row.h1 ?? [], "h1"),
    h2: headings(row.h2 ?? [], "h2"),
    wordCount: nullableCount(row, "word_count"),
    internalLinks: nullableCount(row, "internal_links"),
    externalLinks: nullableCount(row, "external_links"),
    otherLinks: nullableCount(row, "other_links"),
    parsedAt: instant(text(row, "parsed_at"), "parsed_at"),
  };
}

/**
 * One page's signals as the row to write.
 *
 * Upserted on `(crawl_id, url)`, so re-reading a page overwrites its previous
 * signals rather than adding a second set: one page, one answer, whichever
 * attempt produced it.
 */
export function signalsToRow(
  crawlId: string,
  url: string,
  signals: PageSignals,
): CrawlPageSignalsInsert {
  return {
    crawl_id: crawlId,
    url,
    state: signals.state,
    title: signals.title,
    meta_description: signals.metaDescription,
    canonical_url: signals.canonicalUrl,
    meta_robots: signals.metaRobots,
    h1: [...signals.h1],
    h2: [...signals.h2],
    word_count: signals.wordCount,
    internal_links: signals.internalLinks,
    external_links: signals.externalLinks,
    other_links: signals.otherLinks,
    parsed_at: signals.parsedAt,
  };
}
