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
 * The row shapes of `public.crawls`, `public.crawl_pages`, and
 * `public.crawl_links`, and the translation between them and the product's
 * types.
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
};

export type CrawlLinkRow = {
  crawl_id: string;
  from_url: string;
  to_url: string;
  rel: string | null;
  is_internal: boolean;
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
      crawls: {
        Row: CrawlRow;
        Insert: CrawlInsert;
        Update: CrawlUpdate;
        Relationships: [];
      };
      crawl_pages: {
        Row: CrawlPageRow;
        Insert: CrawlPageInsert;
        // Pages are written once, when the crawl that observed them finishes.
        Update: { [_ in never]: never };
        Relationships: [];
      };
      crawl_links: {
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

export const CRAWL_PAGE_READ_COLUMNS =
  "id, crawl_id, url, final_url, fetch_state, http_status, redirect_hops, redirect_chain, content_type, content_bytes, robots_meta, robots_txt_allowed, canonical_href, canonical_resolved, canonical_is_self, title, title_length, meta_description, meta_description_length, h1_count, first_h1, schema_types, schema_blocks, schema_parse_failed, in_sitemap, depth, internal_links_in, internal_links_out, fetched_at, error_code";

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
    url: page.url,
    final_url: page.finalUrl,
    fetch_state: page.fetchState,
    http_status: page.httpStatus,
    redirect_hops: page.redirectHops,
    redirect_chain: [...page.redirectChain],
    content_type: page.contentType,
    content_bytes: page.contentBytes,
    robots_meta: page.robotsMeta,
    robots_txt_allowed: page.robotsTxtAllowed,
    canonical_href: page.canonicalHref,
    canonical_resolved: page.canonicalResolved,
    canonical_is_self: page.canonicalIsSelf,
    title: page.title,
    title_length: page.titleLength,
    meta_description: page.metaDescription,
    meta_description_length: page.metaDescriptionLength,
    h1_count: page.h1Count,
    first_h1: page.firstH1,
    schema_types: [...page.schemaTypes],
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

export function linkToInsert(
  crawlId: string,
  link: Omit<CrawlLink, "crawlId">,
): CrawlLinkInsert {
  return {
    crawl_id: crawlId,
    from_url: link.fromUrl,
    to_url: link.toUrl,
    rel: link.rel,
    is_internal: link.isInternal,
  };
}
