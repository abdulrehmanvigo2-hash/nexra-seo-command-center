import type {
  Crawl,
  CrawlDocumentState,
  CrawlFetchState,
  CrawlLink,
  CrawlPage,
  CrawlStatus,
  CrawlStopReason,
} from "@/types/crawl";
import type { CrawlCompletion, NewCrawl } from "@/lib/crawl/contract";

/**
 * The row shapes of `public.nexra_crawls`, `public.nexra_crawl_pages`, and
 * `public.nexra_crawl_links`, and the translation between them and the
 * product's types.
 *
 * The `nexra_` prefix separates these from a different crawl subsystem that
 * already owns the unprefixed names in this database. Because the Supabase
 * client is typed by the keys below, a query against the wrong table does not
 * compile.
 *
 * Every mapper is total: a row with a value the product does not recognise is
 * a failure, not a silently-coerced default. A crawl record is evidence of
 * what a site returned, and a mapper that quietly turned an unknown fetch
 * state into `fetched` would manufacture an observation.
 */

export class CrawlRowError extends Error {
  constructor(message: string) {
    super(`Crawl row: ${message}`);
    this.name = "CrawlRowError";
  }
}

export type CrawlRow = {
  id: string;
  project_id: string;
  start_url: string;
  host_scope: string;
  status: string;
  stop_reason: string | null;
  max_pages: number;
  max_depth: number;
  max_duration_ms: number;
  user_agent: string;
  robots_state: string;
  sitemap_state: string;
  pages_discovered: number;
  pages_fetched: number;
  pages_failed: number;
  error_code: string | null;
  error_message: string | null;
  created_by: string;
  started_at: string;
  finished_at: string | null;
};

export type CrawlPageRow = {
  id: string;
  crawl_id: string;
  url: string;
  final_url: string | null;
  fetch_state: string;
  http_status: number | null;
  redirect_hops: number;
  redirect_chain: string[];
  content_type: string | null;
  content_bytes: number | null;
  robots_meta: string | null;
  robots_txt_allowed: boolean | null;
  canonical_href: string | null;
  canonical_resolved: string | null;
  canonical_is_self: boolean | null;
  title: string | null;
  title_length: number | null;
  meta_description: string | null;
  meta_description_length: number | null;
  h1_count: number | null;
  first_h1: string | null;
  schema_types: string[];
  schema_blocks: number;
  schema_parse_failed: boolean;
  in_sitemap: boolean | null;
  depth: number | null;
  internal_links_in: number;
  internal_links_out: number;
  fetched_at: string | null;
  error_code: string | null;
  // Since T5 (migration 20260929120000). Null on a row written before it.
  x_robots_tag: string | null;
  robots_noindex: boolean | null;
  robots_nofollow: boolean | null;
  h2_count: number | null;
  h3_count: number | null;
  image_count: number | null;
  images_without_alt: number | null;
};

export type CrawlLinkRow = {
  crawl_id: string;
  from_url: string;
  to_url: string;
  rel: string | null;
  is_internal: boolean;
  /** Since T5. Null on an edge written before it; empty when the anchor had no text. */
  anchor_text: string | null;
};

/** What creating a crawl sets. Every other column has a default or is set on finish. */
export type CrawlInsert = Pick<
  CrawlRow,
  | "project_id"
  | "start_url"
  | "host_scope"
  | "status"
  | "max_pages"
  | "max_depth"
  | "max_duration_ms"
  | "user_agent"
  | "created_by"
>;

/** What finishing a crawl sets. A crawl's request fields are never updated. */
export type CrawlUpdate = Partial<
  Pick<
    CrawlRow,
    | "status"
    | "stop_reason"
    | "robots_state"
    | "sitemap_state"
    | "pages_discovered"
    | "pages_fetched"
    | "pages_failed"
    | "error_code"
    | "error_message"
    | "finished_at"
  >
>;

export type CrawlPageInsert = Omit<CrawlPageRow, "id">;
export type CrawlLinkInsert = CrawlLinkRow;

export type CrawlsDatabase = {
  public: {
    Tables: {
      nexra_crawls: {
        Row: CrawlRow;
        Insert: CrawlInsert;
        Update: CrawlUpdate;
        Relationships: [];
      };
      nexra_crawl_pages: {
        Row: CrawlPageRow;
        Insert: CrawlPageInsert;
        // Pages are written once, when the crawl that observed them finishes.
        Update: { [_ in never]: never };
        Relationships: [];
      };
      nexra_crawl_links: {
        Row: CrawlLinkRow;
        Insert: CrawlLinkInsert;
        Update: { [_ in never]: never };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
  };
};

export const CRAWL_READ_COLUMNS =
  "id, project_id, start_url, host_scope, status, stop_reason, max_pages, max_depth, max_duration_ms, user_agent, robots_state, sitemap_state, pages_discovered, pages_fetched, pages_failed, error_code, error_message, created_by, started_at, finished_at";

export const CRAWL_LINK_READ_COLUMNS = "crawl_id, from_url, to_url, rel, is_internal, anchor_text";

export const CRAWL_PAGE_READ_COLUMNS =
  "id, crawl_id, url, final_url, fetch_state, http_status, redirect_hops, redirect_chain, content_type, content_bytes, robots_meta, robots_txt_allowed, canonical_href, canonical_resolved, canonical_is_self, title, title_length, meta_description, meta_description_length, h1_count, first_h1, schema_types, schema_blocks, schema_parse_failed, in_sitemap, depth, internal_links_in, internal_links_out, fetched_at, error_code, x_robots_tag, robots_noindex, robots_nofollow, h2_count, h3_count, image_count, images_without_alt";

const STATUSES: readonly CrawlStatus[] = ["running", "completed", "partial", "failed", "cancelled"];
const STOP_REASONS: readonly CrawlStopReason[] = [
  "completed",
  "page-budget",
  "time-budget",
  "error",
  "cancelled",
];
const DOCUMENT_STATES: readonly CrawlDocumentState[] = ["fetched", "absent", "unavailable"];
const FETCH_STATES: readonly CrawlFetchState[] = [
  "fetched",
  "http-error",
  "redirect-loop",
  "too-many-redirects",
  "timeout",
  "dns-error",
  "connection-error",
  "too-large",
  "non-html",
  "blocked-by-robots",
  "refused-unsafe",
  "off-site",
  "budget-skipped",
];

/**
 * Trims a value to the column's declared width.
 *
 * Defence in depth, not the primary bound: the extractor already clamps what
 * it reads, and the URL policy already refuses an over-long URL. This is the
 * last gate before the insert, and its job is that no row this module emits
 * can be rejected by the table — because a single over-long attribute on a
 * single page would otherwise fail the whole crawl's batch insert, losing
 * every other page with it.
 */
function bounded(value: string | null, limit: number): string | null {
  if (value === null) return null;
  return value.length > limit ? value.slice(0, limit) : value;
}

function oneOf<T extends string>(allowed: readonly T[], value: string, field: string): T {
  const found = allowed.find((entry) => entry === value);
  if (found === undefined) {
    throw new CrawlRowError(`${field} is "${value}", which this product does not recognise.`);
  }
  return found;
}

export function crawlRowToCrawl(row: CrawlRow): Crawl {
  return {
    id: row.id,
    projectId: row.project_id,
    startUrl: row.start_url,
    hostScope: row.host_scope,
    status: oneOf(STATUSES, row.status, "status"),
    stopReason: row.stop_reason === null ? null : oneOf(STOP_REASONS, row.stop_reason, "stop_reason"),
    budget: {
      maxPages: row.max_pages,
      maxDepth: row.max_depth,
      maxDurationMs: row.max_duration_ms,
    },
    userAgent: row.user_agent,
    robotsState: oneOf(DOCUMENT_STATES, row.robots_state, "robots_state"),
    sitemapState: oneOf(DOCUMENT_STATES, row.sitemap_state, "sitemap_state"),
    pagesDiscovered: row.pages_discovered,
    pagesFetched: row.pages_fetched,
    pagesFailed: row.pages_failed,
    error:
      row.error_code === null || row.error_message === null
        ? null
        : { code: row.error_code, message: row.error_message },
    createdBy: row.created_by,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export function newCrawlInsert(crawl: NewCrawl): CrawlInsert {
  return {
    project_id: crawl.projectId,
    start_url: crawl.startUrl,
    host_scope: crawl.hostScope,
    status: "running",
    max_pages: crawl.budget.maxPages,
    max_depth: crawl.budget.maxDepth,
    max_duration_ms: crawl.budget.maxDurationMs,
    user_agent: crawl.userAgent,
    created_by: crawl.createdBy,
  };
}

export function completionToUpdate(completion: CrawlCompletion): CrawlUpdate {
  return {
    status: completion.status,
    stop_reason: completion.stopReason,
    robots_state: completion.robotsState,
    sitemap_state: completion.sitemapState,
    pages_discovered: completion.pagesDiscovered,
    pages_fetched: completion.pagesFetched,
    pages_failed: completion.pagesFailed,
    error_code: completion.error?.code ?? null,
    error_message: completion.error?.message ?? null,
    finished_at: new Date().toISOString(),
  };
}

export function crawlPageRowToPage(row: CrawlPageRow): CrawlPage {
  return {
    id: row.id,
    crawlId: row.crawl_id,
    url: row.url,
    finalUrl: row.final_url,
    fetchState: oneOf(FETCH_STATES, row.fetch_state, "fetch_state"),
    httpStatus: row.http_status,
    redirectHops: row.redirect_hops,
    redirectChain: row.redirect_chain,
    contentType: row.content_type,
    contentBytes: row.content_bytes,
    robotsMeta: row.robots_meta,
    robotsTxtAllowed: row.robots_txt_allowed,
    canonicalHref: row.canonical_href,
    canonicalResolved: row.canonical_resolved,
    canonicalIsSelf: row.canonical_is_self,
    title: row.title,
    titleLength: row.title_length,
    metaDescription: row.meta_description,
    metaDescriptionLength: row.meta_description_length,
    h1Count: row.h1_count,
    firstH1: row.first_h1,
    h2Count: row.h2_count,
    h3Count: row.h3_count,
    imageCount: row.image_count,
    imagesWithoutAlt: row.images_without_alt,
    xRobotsTag: row.x_robots_tag,
    robotsNoindex: row.robots_noindex,
    robotsNofollow: row.robots_nofollow,
    schemaTypes: row.schema_types,
    schemaBlocks: row.schema_blocks,
    schemaParseFailed: row.schema_parse_failed,
    inSitemap: row.in_sitemap,
    depth: row.depth,
    internalLinksIn: row.internal_links_in,
    internalLinksOut: row.internal_links_out,
    fetchedAt: row.fetched_at,
    errorCode: row.error_code,
  };
}

export function pageToInsert(
  crawlId: string,
  page: Omit<CrawlPage, "id" | "crawlId">,
): CrawlPageInsert {
  return {
    crawl_id: crawlId,
    url: bounded(page.url, 2048) ?? page.url,
    final_url: bounded(page.finalUrl, 2048),
    fetch_state: page.fetchState,
    http_status: page.httpStatus,
    redirect_hops: page.redirectHops,
    redirect_chain: [...page.redirectChain].slice(0, 10),
    content_type: bounded(page.contentType, 200),
    content_bytes: page.contentBytes,
    robots_meta: bounded(page.robotsMeta, 200),
    robots_txt_allowed: page.robotsTxtAllowed,
    canonical_href: bounded(page.canonicalHref, 2048),
    canonical_resolved: bounded(page.canonicalResolved, 2048),
    canonical_is_self: page.canonicalIsSelf,
    title: bounded(page.title, 1000),
    title_length: page.titleLength,
    meta_description: bounded(page.metaDescription, 2000),
    meta_description_length: page.metaDescriptionLength,
    h1_count: page.h1Count,
    first_h1: bounded(page.firstH1, 1000),
    x_robots_tag: bounded(page.xRobotsTag, 200),
    robots_noindex: page.robotsNoindex,
    robots_nofollow: page.robotsNofollow,
    h2_count: page.h2Count,
    h3_count: page.h3Count,
    image_count: page.imageCount,
    images_without_alt: page.imagesWithoutAlt,
    schema_types: [...page.schemaTypes].slice(0, 50),
    schema_blocks: page.schemaBlocks,
    schema_parse_failed: page.schemaParseFailed,
    in_sitemap: page.inSitemap,
    depth: page.depth,
    internal_links_in: page.internalLinksIn,
    internal_links_out: page.internalLinksOut,
    fetched_at: page.fetchedAt,
    error_code: page.errorCode,
  };
}

/** A link row, read back exactly as it was written: the `rel` is the page's own text. */
export function crawlLinkRowToLink(row: CrawlLinkRow): CrawlLink {
  return {
    crawlId: row.crawl_id,
    fromUrl: row.from_url,
    toUrl: row.to_url,
    rel: row.rel,
    isInternal: row.is_internal,
    anchorText: row.anchor_text,
  };
}

export function linkToInsert(
  crawlId: string,
  link: Omit<CrawlLink, "crawlId">,
): CrawlLinkInsert {
  return {
    crawl_id: crawlId,
    from_url: bounded(link.fromUrl, 2048) ?? link.fromUrl,
    to_url: bounded(link.toUrl, 2048) ?? link.toUrl,
    rel: bounded(link.rel, 200),
    is_internal: link.isInternal,
    anchor_text: bounded(link.anchorText, 200),
  };
}
