import type {
  ClaimedPage,
  Crawl,
  CrawlFailureCode,
  CrawlLimit,
  CrawlPage,
  CrawlSource,
  DiscoveredUrl,
  PageObservation,
  RecordedDiscovery,
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
  recordDiscovery(id: string, discovery: RecordedDiscovery): Promise<Crawl | null>;

  /**
   * Records what discovery found and hands the crawl to the fetch stage.
   *
   * Used instead of `recordDiscovery` when there are pages to fetch. The crawl
   * moves to `fetching` rather than `completed`, so nothing reads it as
   * finished while its queue is still full.
   */
  beginFetching(id: string, discovery: RecordedDiscovery): Promise<Crawl | null>;

  /** fetching → completed, once the queue is empty. */
  completeFetch(id: string, limits: readonly CrawlLimit[]): Promise<Crawl | null>;

  fail(id: string, code: CrawlFailureCode): Promise<Crawl | null>;

  cancel(id: string): Promise<Crawl | null>;

  /** The URLs one crawl discovered, in the order they were found. */
  listUrls(crawlId: string, limit?: number): Promise<readonly DiscoveredUrl[]>;
};

/**
 * The store for a deployment that does not keep crawls.
 *
 * With the fixture roster there is no `crawls` table and no project row for a
 * crawl to reference, so every call answers as if the project were unknown
 * rather than pretending a pass was recorded. The same choice the agent
 * runtime makes for the same reason.
 */
export const unavailableCrawlStore: CrawlStore = {
  async create() {
    return { ok: false, reason: "unknown-project" };
  },
  async get() {
    return null;
  },
  async listForProject() {
    return [];
  },
  async start() {
    return null;
  },
  async recordDiscovery() {
    return null;
  },
  async beginFetching() {
    return null;
  },
  async completeFetch() {
    return null;
  },
  async fail() {
    return null;
  },
  async cancel() {
    return null;
  },
  async listUrls() {
    return [];
  },
};

/**
 * The queue side of a crawl: the discovered URLs, and what each answered.
 *
 * Separate from `CrawlStore` because a caller needs one or the other. The
 * fetch pass never touches the crawl record, and the operator flow that starts
 * a crawl never claims a page.
 *
 * Every method is safe to call twice. `enqueuePages` ignores URLs already
 * queued, `recordPage` writes only under a live lease, and
 * `recoverExpiredPages` touches only leases that have already lapsed — so a
 * retried worker, an overlapping worker and a crashed worker all converge on
 * the same rows rather than duplicating them.
 */
export type CrawlPageStore = {
  /**
   * Adds discovered URLs to the queue. Returns how many were new; a URL
   * already queued for this crawl is left exactly as it is.
   */
  enqueuePages(crawlId: string, urls: readonly DiscoveredUrl[]): Promise<number>;

  /** Leases up to `limit` pending pages. Concurrent callers get disjoint sets. */
  claimPages(crawlId: string, limit: number, leaseSeconds: number): Promise<readonly ClaimedPage[]>;

  /**
   * Writes one attempt's outcome, if the lease is still this caller's. False
   * when it is not — the page was recovered or claimed by someone else, and
   * this result is stale and must not be written.
   */
  recordPage(
    crawlId: string,
    url: string,
    leaseToken: string,
    observation: PageObservation,
  ): Promise<boolean>;

  /** Returns lapsed leases to the queue, or ends them when no attempt remains. */
  recoverExpiredPages(crawlId: string, limit: number): Promise<number>;

  countPendingPages(crawlId: string): Promise<number>;

  listPages(crawlId: string, limit?: number): Promise<readonly CrawlPage[]>;
};

/** The page queue for a deployment that does not store crawls. */
export const unavailableCrawlPageStore: CrawlPageStore = {
  async enqueuePages() {
    return 0;
  },
  async claimPages() {
    return [];
  },
  async recordPage() {
    return false;
  },
  async recoverExpiredPages() {
    return 0;
  },
  async countPendingPages() {
    return 0;
  },
  async listPages() {
    return [];
  },
};
