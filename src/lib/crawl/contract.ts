/**
 * What the crawl service needs from wherever crawls are kept.
 *
 * Storage-agnostic, like the Projects and agent-run contracts: the service
 * holds the rules, a store holds rows. Every method is asynchronous because
 * any real store answers over I/O.
 */

import type { Crawl, CrawlBudget, CrawlLink, CrawlPage, CrawlStatus, CrawlStopReason } from "@/types/crawl";
import type { CrawlDocumentState, CrawlError } from "@/types/crawl";

export type NewCrawl = {
  readonly projectId: string;
  readonly startUrl: string;
  readonly hostScope: string;
  readonly budget: CrawlBudget;
  readonly userAgent: string;
  readonly createdBy: string;
};

/** What finishing a crawl records. */
export type CrawlCompletion = {
  readonly status: Exclude<CrawlStatus, "running">;
  readonly stopReason: CrawlStopReason;
  readonly robotsState: CrawlDocumentState;
  readonly sitemapState: CrawlDocumentState;
  readonly pagesDiscovered: number;
  readonly pagesFetched: number;
  readonly pagesFailed: number;
  readonly error: CrawlError | null;
};

export type InsertCrawlOutcome =
  | { readonly status: "inserted"; readonly crawl: Crawl }
  /** The project no longer exists. */
  | { readonly status: "missing-project" };

export type CrawlStore = {
  /**
   * Whether this store keeps crawls. The fixture data source does not, and the
   * service answers `unavailable` rather than running a crawl it cannot record.
   */
  readonly storesCrawls: boolean;

  insert(crawl: NewCrawl): Promise<InsertCrawlOutcome>;
  finish(id: string, completion: CrawlCompletion): Promise<Crawl | null>;
  getById(id: string): Promise<Crawl | null>;
  /**
   * Newest first. With `hostScope`, only crawls confined to exactly that host —
   * which is how the project's own crawls and a competitor's are kept apart,
   * since the service records each with its exact host.
   */
  listByProject(projectId: string, limit: number, hostScope?: string): Promise<readonly Crawl[]>;

  /** Pages and links are written in bounded batches, never one row per call. */
  savePages(crawlId: string, pages: readonly Omit<CrawlPage, "id" | "crawlId">[]): Promise<void>;
  saveLinks(crawlId: string, links: readonly Omit<CrawlLink, "crawlId">[]): Promise<void>;
  listPages(crawlId: string, limit: number): Promise<readonly CrawlPage[]>;
  /** One recorded page by its own id, or null (checkpoint 3.3). The caller checks whose crawl it is. */
  getPage(pageId: string): Promise<CrawlPage | null>;
  /**
   * The edges one crawl recorded, external edges first, then by target and
   * source URL, so a bounded read holds what the site links out to before
   * what it links to within itself. Read-only: nothing here fetches a target.
   */
  listLinks(crawlId: string, limit: number): Promise<readonly CrawlLink[]>;
  /**
   * M8: keeps the visible text of an own-site crawl's fetched pages (migration 20261027120000). Optional: a store
   * without it keeps none. It may throw (the table not there yet); the service then notes "text not kept".
   */
  savePageTexts?(crawlId: string, texts: readonly PageText[]): Promise<void>;
  /** M8: the kept texts of one crawl, by URL, at most `limit`; empty when none were kept. */
  listPageTexts?(crawlId: string, limit: number): Promise<readonly PageText[]>;
};

/** One fetched page's visible text, as kept (M8). */
export type PageText = { readonly url: string; readonly text: string };

/**
 * The store used when crawls are not persisted anywhere.
 *
 * It refuses rather than pretends. Nothing here returns an empty list that
 * could be read as "this site has no pages" — an insert simply reports that
 * the project is not there to crawl against.
 */
export const unavailableCrawlStore: CrawlStore = {
  storesCrawls: false,
  async insert() {
    return { status: "missing-project" };
  },
  async finish() {
    return null;
  },
  async getById() {
    return null;
  },
  async listByProject() {
    return [];
  },
  async savePages() {
    /* nothing is stored */
  },
  async saveLinks() {
    /* nothing is stored */
  },
  async listPages() {
    return [];
  },
  async getPage() {
    return null;
  },
  async listLinks() {
    return [];
  },
};
