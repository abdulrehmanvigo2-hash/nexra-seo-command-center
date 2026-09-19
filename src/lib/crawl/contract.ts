import type {
  Crawl,
  CrawlFailureCode,
  CrawlSource,
  DiscoveredUrl,
  SitemapDiscovery,
} from "@/types/crawl";

/**
 * What the crawl runtime needs from wherever crawls are kept.
 *
 * Storage-agnostic on purpose, the same way the Projects repository and the
 * agent run store are: the rules live above this, the table's constraints and
 * trigger enforce the same rules again below it, and a test can exercise the
 * rules against an in-memory implementation without a database.
 *
 * The methods are the lifecycle, in the order a pass walks it: `create` a
 * queued crawl, `start` it, `recordDiscovery` when the sitemaps have been read,
 * or `fail` when they could not be. Each transition returns the updated record,
 * or null when the crawl has already moved on — the table refuses an illegal
 * transition, so a null here means somebody else got there first, not that the
 * caller should retry.
 */

export type CreateCrawlInput = {
  readonly projectId: string;
  /** The host to visit, lower case, no scheme. */
  readonly site: string;
  readonly source: CrawlSource;
  /** Supabase Auth user id, for an operator-initiated crawl. */
  readonly createdBy: string | null;
};

export type CreateCrawlResult =
  | { readonly ok: true; readonly crawl: Crawl }
  /** A crawl of this project is already queued or running; that one is returned. */
  | { readonly ok: false; readonly reason: "already-running"; readonly crawl: Crawl }
  /** No such project. */
  | { readonly ok: false; readonly reason: "unknown-project" };

export type CrawlStore = {
  create(input: CreateCrawlInput): Promise<CreateCrawlResult>;

  get(id: string): Promise<Crawl | null>;

  /** A project's crawls, newest first. */
  listForProject(projectId: string, limit?: number): Promise<readonly Crawl[]>;

  /** queued → discovering. Null if it is no longer queued. */
  start(id: string): Promise<Crawl | null>;

  /**
   * Writes what a discovery pass found and completes the crawl.
   *
   * The URLs and the counters are one outcome, so a store must not leave a
   * crawl completed with rows missing: if the URLs cannot be written, the
   * crawl fails instead.
   */
  recordDiscovery(id: string, discovery: SitemapDiscovery): Promise<Crawl | null>;

  fail(id: string, code: CrawlFailureCode): Promise<Crawl | null>;

  cancel(id: string): Promise<Crawl | null>;

  /** The URLs one crawl discovered, in the order they were found. */
  listUrls(crawlId: string, limit?: number): Promise<readonly DiscoveredUrl[]>;
};
