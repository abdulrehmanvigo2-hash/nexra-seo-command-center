import type { CrawlPageStore, CrawlStore } from "@/lib/crawl/contract";
import { findingsFor, type CrawlFinding } from "@/lib/crawl/findings";
import { runPageFetchPass, type PageFetchOptions } from "@/lib/crawl/page-fetcher";
import { DEFAULT_CRAWL_DELAY_MS } from "@/lib/crawl/politeness";
import { crawlDelayMs } from "@/lib/crawl/robots";
import { checkUrl } from "@/lib/crawl/url-policy";
import { isStorableProjectId } from "@/lib/projects/intake-rules";
import type {
  Crawl,
  CrawlLimit,
  CrawlPage,
  CrawlSource,
  FetchPassResult,
  RobotsPolicy,
  SitemapDiscovery,
  StoredPageSignals,
} from "@/types/crawl";
import type { ProjectRecord } from "@/types/project";

/**
 * The rules for running a discovery pass: who may ask, over which site, and
 * what happens to the record when the pass ends.
 *
 * Pure in the way that matters, the same as the agent run service: the store,
 * the project roster, the discovery function and the clock are all handed in,
 * so the same rules run against Supabase in the application and against
 * in-memory doubles in a test. It holds no credentials and reads no
 * environment, and it never reaches the network itself.
 *
 * The site is derived, never supplied. A caller names a project and nothing
 * else; the host comes from that project's stored domain and then through the
 * same URL policy as any other URL. Letting a caller pass a URL would turn an
 * operator-only button into a way to make this server fetch anywhere.
 *
 * Authorization is the caller's job: every method here assumes an operator has
 * already been confirmed, and records who asked.
 */

export type CrawlFailureReason =
  /** The project id is not one a project could have. */
  | "invalid"
  | "unknown-project"
  /** The project's stored domain does not pass the URL policy. */
  | "site-refused"
  /** Crawls are not stored in this deployment. */
  | "unavailable";

export type CrawlFailure = {
  readonly ok: false;
  readonly reason: CrawlFailureReason;
};

export type StartCrawlResult =
  | {
      readonly ok: true;
      readonly crawl: Crawl;
      /**
       * False when a pass was already in flight and this request joined it
       * rather than starting a second one.
       */
      readonly started: boolean;
    }
  | CrawlFailure;

/**
 * The most pages one crawl will fetch.
 *
 * Deliberately small for a first version. A site with more listed pages is
 * crawled as a sample and says so: the crawl carries the `pages` limit, and
 * every screen reading it must present the result as part of the site.
 */
export const MAX_PAGES_PER_CRAWL = 500;

/**
 * The most signal rows one read returns.
 *
 * A crawl holds at most `MAX_PAGES_PER_CRAWL` of them, so this reads a whole
 * crawl and is a ceiling rather than a page size. It stays a ceiling: a caller
 * asking for more gets this.
 */
export const MAX_SIGNALS_READ = MAX_PAGES_PER_CRAWL;

/** What a slice reports when the crawl has no queue to work. */
const IDLE_PASS: FetchPassResult = {
  claimed: 0,
  fetched: 0,
  failed: 0,
  skipped: 0,
  recovered: 0,
  stoppedBy: "empty",
  remaining: 0,
};

export type CrawlServiceDependencies = {
  readonly store: CrawlStore;
  readonly pages: CrawlPageStore;
  /**
   * Reads the site's robots.txt for a fetch slice. A slice spends one request
   * on this rather than storing the rules, so a site that changes its mind
   * between slices is obeyed rather than a stale copy.
   */
  readonly readRobots: (site: string) => Promise<RobotsPolicy>;
  /** Everything the fetch pass needs beyond the crawl itself. */
  readonly fetchPass?: Partial<
    Pick<
      PageFetchOptions,
      | "concurrency"
      | "batchSize"
      | "leaseSeconds"
      | "maxBytes"
      | "requestTimeoutMs"
      | "clock"
      | "gate"
      | "fetchOptions"
      | "fetchPage"
      | "crawlDelayMs"
    >
  >;
  readonly projects: {
    getProjectById(id: string): Promise<ProjectRecord | null>;
  };
  /** Reads a site's sitemaps. Injected so a test never reaches the network. */
  readonly discover: (site: string) => Promise<SitemapDiscovery>;
};

/**
 * The host to crawl, from a project's stored domain.
 *
 * The domain column is canonical — lower case, no scheme, no trailing slash —
 * but it may carry a path, because a project can be scoped to a section of a
 * site. A crawl is scoped to a host, so the path is dropped here and the result
 * goes through the URL policy before anything uses it.
 */
export function siteForProject(project: ProjectRecord): string | null {
  const host = project.domain.split("/")[0].trim().toLowerCase();
  const checked = checkUrl(`https://${host}`);
  return checked.ok ? new URL(checked.url).hostname : null;
}

export type CrawlService = {
  startDiscovery(
    operatorId: string | null,
    projectId: unknown,
    source?: CrawlSource,
  ): Promise<StartCrawlResult>;
  latestForProject(projectId: unknown): Promise<{ ok: true; crawl: Crawl | null } | CrawlFailure>;
  /**
   * The on-page signals of a project's most recent crawl.
   *
   * Read-only, and read by project rather than by crawl id: the caller names
   * the project it is already looking at, and which crawl that is stays this
   * side of the boundary.
   */
  signalsForProject(
    projectId: unknown,
    limit?: number,
  ): Promise<
    | {
        ok: true;
        crawl: Crawl | null;
        signals: readonly StoredPageSignals[];
        /**
         * The pages of that crawl that produced no signals, and why.
         *
         * A crawl that fetched six of eight pages has two whose reason is
         * already in the page row — a timeout, a refused address, a type this
         * crawler does not read. The counters alone cannot say which, so an
         * operator would have to read the database to find out. These are the
         * rows that already exist, nothing computed.
         */
        unread: readonly CrawlPage[];
        /**
         * Deterministic findings over that crawl's own evidence.
         *
         * Empty until the pass completes: a rule counted over half a crawl
         * would describe the half, and "no duplicate titles" across three of
         * seven pages is not a fact about the site.
         */
        findings: readonly CrawlFinding[];
      }
    | CrawlFailure
  >;
  /**
   * Runs one bounded slice of the fetch stage and reports what is left.
   *
   * Safe to call repeatedly and from more than one caller at once: the queue
   * hands out disjoint batches, and a slice that finds nothing left completes
   * the crawl.
   */
  runFetchSlice(
    crawlId: string,
    budget: { readonly budgetMs: number; readonly maxPages: number },
  ): Promise<{ ok: true; crawl: Crawl; pass: FetchPassResult } | CrawlFailure>;
};

export function createCrawlService(dependencies: CrawlServiceDependencies): CrawlService {
  const { store, pages, projects, discover, readRobots, fetchPass = {} } = dependencies;

  const resolve = async (
    projectId: unknown,
  ): Promise<{ ok: true; project: ProjectRecord } | CrawlFailure> => {
    if (typeof projectId !== "string" || !isStorableProjectId(projectId)) {
      return { ok: false, reason: "invalid" };
    }
    const project = await projects.getProjectById(projectId);
    if (!project) return { ok: false, reason: "unknown-project" };
    return { ok: true, project };
  };

  return {
    async startDiscovery(operatorId, projectId, source = "operator") {
      const resolved = await resolve(projectId);
      if (!resolved.ok) return resolved;

      const site = siteForProject(resolved.project);
      if (site === null) return { ok: false, reason: "site-refused" };

      const created = await store.create({
        projectId: resolved.project.id,
        site,
        source,
        createdBy: operatorId,
      });

      if (!created.ok) {
        if (created.reason === "already-running") {
          // The storage layer's own protection. The caller wanted this project
          // crawled and it is being crawled; that is a success, not an error.
          return { ok: true, crawl: created.crawl, started: false };
        }
        return { ok: false, reason: "unknown-project" };
      }

      const started = await store.start(created.crawl.id);
      if (!started) {
        // Something else moved it out of queued between the insert and here.
        const current = await store.get(created.crawl.id);
        return current
          ? { ok: true, crawl: current, started: false }
          : { ok: false, reason: "unavailable" };
      }

      let discovery: SitemapDiscovery;
      try {
        discovery = await discover(site);
      } catch {
        // The reason stays in the server log; the record keeps a fixed code.
        const failed = await store.fail(started.id, "store-error");
        return { ok: true, crawl: failed ?? started, started: true };
      }

      // A site that could not serve robots.txt has not consented to a crawl,
      // and the discovery pass will have read nothing from it. That is a
      // failed pass with a reason, not an empty success.
      if (discovery.robots === "unavailable") {
        const failed = await store.fail(started.id, "robots-unavailable");
        return { ok: true, crawl: failed ?? started, started: true };
      }

      // The page cap is applied here, where the crawl can record that it was
      // applied. Queueing everything and stopping partway would leave a crawl
      // that looks complete and is not.
      const capped = discovery.urls.slice(0, MAX_PAGES_PER_CRAWL);
      const limits: CrawlLimit[] =
        discovery.urls.length > MAX_PAGES_PER_CRAWL
          ? [...discovery.limits, "pages"]
          : [...discovery.limits];
      const recorded = { ...discovery, urls: capped, limits };

      if (capped.length === 0) {
        const completed = await store.recordDiscovery(started.id, recorded);
        return { ok: true, crawl: completed ?? started, started: true };
      }

      // Pages are queued before the crawl moves on, so a crawl in `fetching`
      // always has a queue behind it.
      await pages.enqueuePages(started.id, capped);
      const handed = await store.beginFetching(started.id, recorded);
      return { ok: true, crawl: handed ?? started, started: true };
    },

    async runFetchSlice(crawlId, budget) {
      const crawl = await store.get(crawlId);
      if (!crawl) return { ok: false, reason: "unknown-project" };
      // Only a crawl in the fetch stage has a queue to work; anything else is
      // either not there yet or already finished.
      if (crawl.status !== "fetching") return { ok: true, crawl, pass: IDLE_PASS };

      const robots = await readRobots(crawl.site);
      if (!fetchPass.fetchPage) return { ok: false, reason: "unavailable" };
      const pass = await runPageFetchPass({
        ...fetchPass,
        fetchPage: fetchPass.fetchPage,
        crawlId: crawl.id,
        site: crawl.site,
        robots,
        store: pages,
        budgetMs: budget.budgetMs,
        maxPages: budget.maxPages,
        crawlDelayMs: Math.max(
          crawlDelayMs(robots) ?? 0,
          fetchPass.crawlDelayMs ?? DEFAULT_CRAWL_DELAY_MS,
        ),
      });

      // Nothing left in the queue ends the crawl. Done here rather than in the
      // pass so a slice stays a slice and the lifecycle stays in one place.
      const finished = pass.remaining === 0 ? await store.completeFetch(crawl.id, crawl.limits) : null;
      return { ok: true, crawl: finished ?? (await store.get(crawl.id)) ?? crawl, pass };
    },

    async latestForProject(projectId) {
      const resolved = await resolve(projectId);
      if (!resolved.ok) return resolved;
      const [latest] = await store.listForProject(resolved.project.id, 1);
      return { ok: true, crawl: latest ?? null };
    },

    async signalsForProject(projectId, limit = MAX_SIGNALS_READ) {
      const resolved = await resolve(projectId);
      if (!resolved.ok) return resolved;
      const [latest] = await store.listForProject(resolved.project.id, 1);
      if (!latest) return { ok: true, crawl: null, signals: [], unread: [], findings: [] };
      const capped = Math.min(limit, MAX_SIGNALS_READ);
      const [signals, all] = await Promise.all([
        pages.listSignals(latest.id, capped),
        pages.listPages(latest.id, MAX_PAGES_PER_CRAWL),
      ]);
      return {
        ok: true,
        crawl: latest,
        signals,
        // Anything the crawl did not read: failed, refused, skipped, or still
        // queued. `fetched` is the only state that produces signals.
        unread: all.filter((page) => page.state !== "fetched").slice(0, capped),
        findings: latest.status === "completed" ? findingsFor(signals, all) : [],
      };
    },
  };
}
