import "server-only";

import type { CrawlStore } from "@/lib/crawl/contract";
import type { CrawlConfig } from "@/lib/crawl/config";
import { isHostAllowed } from "@/lib/crawl/config";
import { runCrawl, type EngineOptions } from "@/lib/crawl/engine";
import { hostScopeFromDomain, startUrlForDomain } from "@/lib/crawl/url-policy";
import { logEvent } from "@/lib/observability/log";
import type { ProjectRepository } from "@/lib/projects/contract";
import type { Crawl, CrawlFailureReason, CrawlPage, CrawlStatus } from "@/types/crawl";

/**
 * The rules around a crawl: who may start one, against what, and what is
 * recorded when it ends.
 *
 * The target is never taken from the request. A caller names a project, and
 * the host comes from that project's stored `domain` — so no input to this
 * service can point the crawler at a site the operator did not register. The
 * server's allow-list then has to name that host as well.
 */

export type CrawlFailure = { readonly reason: CrawlFailureReason };

export type StartCrawlResult =
  | { readonly ok: true; readonly crawl: Crawl }
  | { readonly ok: false; readonly failure: CrawlFailure };

export type CrawlDetail = {
  readonly crawl: Crawl;
  readonly pages: readonly CrawlPage[];
};

export type CrawlService = {
  startCrawl(projectId: string, operatorId: string): Promise<StartCrawlResult>;
  getCrawl(id: string, pageLimit?: number): Promise<CrawlDetail | null>;
  listCrawls(projectId: string, limit?: number): Promise<readonly Crawl[]>;
};

export type CrawlServiceOptions = {
  readonly store: CrawlStore;
  readonly projects: ProjectRepository;
  readonly config: CrawlConfig;
  /** Injected so a test can drive the engine without a network. */
  readonly engine?: typeof runCrawl;
  readonly engineOverrides?: Partial<EngineOptions>;
};

const DEFAULT_PAGE_LIMIT = 500;
const DEFAULT_CRAWL_LIST_LIMIT = 25;

/** How a start failure is recorded on the crawl row. */
const START_FAILURE_MESSAGE: Readonly<Record<string, string>> = {
  "blocked-by-robots": "robots.txt disallows this crawler from the start URL.",
  "start-unreachable": "The start URL did not answer.",
  "start-unsafe": "The start URL resolved to an address this crawler refuses to connect to.",
};

export function createCrawlService(options: CrawlServiceOptions): CrawlService {
  const { store, projects, config, engine = runCrawl, engineOverrides = {} } = options;

  return {
    async startCrawl(projectId, operatorId) {
      if (!store.storesCrawls) return { ok: false, failure: { reason: "unavailable" } };
      if (!config.enabled) return { ok: false, failure: { reason: "disabled" } };

      const project = await projects.getProjectById(projectId);
      if (project === null) return { ok: false, failure: { reason: "unknown-project" } };

      const hostScope = hostScopeFromDomain(project.domain);
      const startUrl = startUrlForDomain(project.domain);
      if (hostScope === null || startUrl === null) {
        return { ok: false, failure: { reason: "no-domain" } };
      }
      if (!isHostAllowed(config, hostScope)) {
        return { ok: false, failure: { reason: "host-not-allowed" } };
      }

      const inserted = await store.insert({
        projectId,
        startUrl,
        hostScope,
        budget: config.budget,
        userAgent: config.userAgent,
        createdBy: operatorId,
      });
      if (inserted.status === "missing-project") {
        return { ok: false, failure: { reason: "unknown-project" } };
      }

      const crawl = inserted.crawl;
      logEvent("info", "crawl.started", { crawlId: crawl.id, projectId, host: hostScope });

      const result = await engine({
        startUrl,
        hostScope,
        userAgent: config.userAgent,
        budget: config.budget,
        ...engineOverrides,
      });

      // Pages first: a crawl row that says "completed, 40 pages" with no pages
      // behind it would be a lie the reader cannot detect.
      await store.savePages(crawl.id, result.pages);
      await store.saveLinks(crawl.id, result.links);

      const status: Exclude<CrawlStatus, "running"> =
        result.startFailure !== null
          ? "failed"
          : result.stopReason === "completed"
            ? "completed"
            : "partial";

      const finished = await store.finish(crawl.id, {
        status,
        stopReason: result.stopReason,
        robotsState: result.robotsState,
        sitemapState: result.sitemapState,
        pagesDiscovered: result.pagesDiscovered,
        pagesFetched: result.pagesFetched,
        pagesFailed: result.pagesFailed,
        error:
          result.startFailure === null
            ? null
            : {
                code: result.startFailure,
                message: START_FAILURE_MESSAGE[result.startFailure] ?? "The crawl could not start.",
              },
      });

      logEvent(result.startFailure === null ? "info" : "warn", "crawl.finished", {
        crawlId: crawl.id,
        projectId,
        status,
        stopReason: result.stopReason,
        fetched: result.pagesFetched,
        discovered: result.pagesDiscovered,
        errorCode: result.startFailure,
      });

      if (result.startFailure !== null) {
        return { ok: false, failure: { reason: result.startFailure } };
      }
      return { ok: true, crawl: finished ?? crawl };
    },

    async getCrawl(id, pageLimit = DEFAULT_PAGE_LIMIT) {
      const crawl = await store.getById(id);
      if (crawl === null) return null;
      return { crawl, pages: await store.listPages(id, pageLimit) };
    },

    async listCrawls(projectId, limit = DEFAULT_CRAWL_LIST_LIMIT) {
      return store.listByProject(projectId, limit);
    },
  };
}
