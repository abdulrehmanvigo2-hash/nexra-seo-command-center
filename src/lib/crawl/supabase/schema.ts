import type {
  Crawl,
  CrawlFailureCode,
  CrawlSource,
  CrawlStatus,
  DiscoveredUrl,
  DiscoveryLimit,
  RobotsPolicy,
  SitemapSource,
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
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
  };
};

export const CRAWL_READ_COLUMNS =
  "id,project_id,site,status,robots_state,sitemap_count,discovered_count,limits,failure_code,created_by,source,created_at,started_at,finished_at,updated_at";

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
const LIMITS: readonly DiscoveryLimit[] = ["sitemaps", "urls", "depth"];
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
