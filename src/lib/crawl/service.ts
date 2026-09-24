import "server-only";

import type { CrawlStore } from "@/lib/crawl/contract";
import type { CrawlConfig } from "@/lib/crawl/config";
import { isHostAllowed } from "@/lib/crawl/config";
import { resolveCompetitorTarget } from "@/lib/crawl/competitor-target";
import { runCrawl, type CrawlResult, type EngineOptions } from "@/lib/crawl/engine";
import { computeCrawlFindings } from "@/lib/crawl/findings/compute";
import { FINDINGS_LINK_LIMIT } from "@/lib/crawl/findings/grounding";
import { unavailableCrawlFindingsStore, type CrawlFindingsStore, type StoredCrawlFindingsReport } from "@/lib/crawl/findings/store-contract";
import { hostScopeFromDomain, startUrlForDomain } from "@/lib/crawl/url-policy";
import { logEvent } from "@/lib/observability/log";
import type { ProjectRepository } from "@/lib/projects/contract";
import type { Crawl, CrawlFailureReason, CrawlLink, CrawlPage, CrawlStatus } from "@/types/crawl";

/**
 * The rules around a crawl: who may start one, against what, and what is
 * recorded when it ends.
 *
 * The target is never taken from the request. A caller names a project, and
 * the host comes from that project's stored `domain` — so no input to this
 * service can point the crawler at a site the operator did not register. The
 * server's allow-list then has to name that host as well.
 *
 * A competitor crawl bends that rule only as far as it must: the caller may
 * name a domain, but the host is accepted only when it matches one the
 * agency recorded for the project at intake, read here from the stored
 * record — never from the request — and the same allow-list then has to name
 * it too. Every other gate, budget and guard is the one the project's own
 * crawl runs under.
 */

export type CrawlFailure = { readonly reason: CrawlFailureReason };

export type StartCrawlResult =
  | { readonly ok: true; readonly crawl: Crawl }
  | { readonly ok: false; readonly failure: CrawlFailure };

export type CrawlDetail = {
  readonly crawl: Crawl;
  readonly pages: readonly CrawlPage[];
};

/** A crawl of one of the project's recorded competitor domains, rather than its own site. */
export type CompetitorCrawlTarget = {
  readonly competitorDomain: string;
};

export type CompetitorCrawlsResult =
  | { readonly ok: true; readonly host: string; readonly crawls: readonly Crawl[] }
  | { readonly ok: false; readonly failure: CrawlFailure };

export type CrawlService = {
  /**
   * Crawls the project's own site, or — with a target — one competitor domain
   * the project recorded at intake. Both run through the same gates, budgets
   * and guards; the target changes only which recorded host is fetched.
   */
  startCrawl(projectId: string, operatorId: string, target?: CompetitorCrawlTarget): Promise<StartCrawlResult>;
  getCrawl(id: string, pageLimit?: number): Promise<CrawlDetail | null>;
  /**
   * The edges one crawl recorded, bounded, external edges first. A read of
   * stored rows only: no target is fetched, and a crawl no store holds reads
   * as an empty list, never as a site with no links.
   */
  listCrawlLinks(id: string, limit?: number): Promise<readonly CrawlLink[]>;
  /** The project's own-site crawls only, newest first. A competitor crawl is never among them. */
  listCrawls(projectId: string, limit?: number): Promise<readonly Crawl[]>;
  /** The crawls of one recorded competitor domain, newest first, or why the domain is refused. */
  listCompetitorCrawls(projectId: string, competitorDomain: string, limit?: number): Promise<CompetitorCrawlsResult>;
  /**
   * The deterministic findings recorded for one of the project's own crawls
   * when it finished, or null when none were recorded (a crawl made before
   * findings were kept, a competitor crawl, or a store that keeps none).
   * A read of stored rows only, scoped to the project: another project's
   * crawl reads as null.
   */
  getCrawlFindings(projectId: string, crawlId: string): Promise<StoredCrawlFindingsReport | null>;
};

export type CrawlServiceOptions = {
  readonly store: CrawlStore;
  readonly projects: ProjectRepository;
  readonly config: CrawlConfig;
  /** Where recorded findings are kept; absent, none are recorded and none read. */
  readonly findings?: CrawlFindingsStore;
  /** Injected so a test can drive the engine without a network. */
  readonly engine?: typeof runCrawl;
  readonly engineOverrides?: Partial<EngineOptions>;
};

const DEFAULT_PAGE_LIMIT = 500;
const DEFAULT_CRAWL_LIST_LIMIT = 25;
/** Enough for every edge a full-budget crawl can record (pages × links per page), and no more. */
const DEFAULT_LINK_LIMIT = 5_000;
const MAX_LINK_LIMIT = 10_000;

/** How a start failure is recorded on the crawl row. */
const START_FAILURE_MESSAGE: Readonly<Record<string, string>> = {
  "blocked-by-robots": "robots.txt disallows this crawler from the start URL.",
  "start-unreachable": "The start URL did not answer.",
  "start-unsafe": "The start URL resolved to an address this crawler refuses to connect to.",
};

/**
 * What a crawl that threw is recorded as.
 *
 * A fixed code and a fixed message, like every other stored failure: an
 * exception's text can carry an internal hostname, a connection string, or a
 * fragment of someone's page, and none of that belongs in a durable record.
 * The server log gets the real error; the row gets this.
 */
const UNEXPECTED_FAILURE = {
  code: "crawl-failed",
  message: "The crawl stopped unexpectedly. The server log names the failure.",
} as const;

export function createCrawlService(options: CrawlServiceOptions): CrawlService {
  const { store, projects, config, findings = unavailableCrawlFindingsStore, engine = runCrawl, engineOverrides = {} } = options;

  /**
   * The fixed rules over what the crawl just recorded, kept beside it. Only
   * for the project's own site (a competitor's pages are never "findings"
   * of the project), only for a finished, reviewable crawl, and never in
   * the way of the crawl itself: a store that keeps no findings skips this,
   * and a failure here is logged and leaves the crawl result untouched.
   */
  async function recordFindings(crawl: Crawl, result: { readonly pages: CrawlResult["pages"]; readonly links: CrawlResult["links"] }): Promise<void> {
    if (!findings.storesFindings) return;
    if (crawl.status !== "completed" && crawl.status !== "partial") return;
    try {
      const pages = result.pages.map((page, index) => ({ ...page, id: String(index), crawlId: crawl.id }));
      const links = result.links.slice(0, FINDINGS_LINK_LIMIT).map((link) => ({ ...link, crawlId: crawl.id }));
      const report = computeCrawlFindings({ crawl, pages, links });
      const outcome = await findings.record({
        projectId: crawl.projectId,
        crawlId: crawl.id,
        report,
        links: { read: links.length, cut: result.links.length > FINDINGS_LINK_LIMIT },
      });
      logEvent(outcome.status === "created" || outcome.status === "exists" ? "info" : "warn", "crawl.findings_recorded", {
        crawlId: crawl.id,
        projectId: crawl.projectId,
        outcome: outcome.status,
        count: outcome.status === "created" ? outcome.findings : outcome.status === "exists" ? outcome.header.findingsTotal : null,
      });
    } catch (error) {
      logEvent("error", "crawl.findings_failed", {
        crawlId: crawl.id,
        projectId: crawl.projectId,
        reason: error instanceof Error ? error.name : "unknown",
      });
    }
  }

  /**
   * The host a competitor crawl of this project may fetch, or a refusal.
   *
   * The recorded list is read from the stored project, by the project id the
   * caller was already authorised for; nothing the caller sends is trusted
   * beyond the domain it names, and that only as a lookup key.
   */
  async function competitorHost(
    projectId: string,
    competitorDomain: string,
  ): Promise<{ ok: true; host: string } | { ok: false; failure: CrawlFailure }> {
    const project = await projects.getProjectById(projectId);
    if (project === null) return { ok: false, failure: { reason: "unknown-project" } };

    const intake = await projects.getProjectIntake(projectId);
    const target = resolveCompetitorTarget({
      competitorDomain,
      projectDomain: project.domain,
      recordedCompetitorDomains: intake?.competitorDomains ?? [],
    });
    if (!target.ok) return { ok: false, failure: { reason: target.reason } };
    return { ok: true, host: target.host };
  }

  return {
    async startCrawl(projectId, operatorId, target) {
      if (!store.storesCrawls) return { ok: false, failure: { reason: "unavailable" } };
      if (!config.enabled) return { ok: false, failure: { reason: "disabled" } };

      let hostScope: string;
      if (target === undefined) {
        const project = await projects.getProjectById(projectId);
        if (project === null) return { ok: false, failure: { reason: "unknown-project" } };

        const projectHost = hostScopeFromDomain(project.domain);
        if (projectHost === null) return { ok: false, failure: { reason: "no-domain" } };
        hostScope = projectHost;
      } else {
        // A competitor crawl: the host must be one the project recorded, and
        // it is checked against the allow-list exactly as the project's own
        // host is. The same engine, budget, guard and user agent follow.
        const resolved = await competitorHost(projectId, target.competitorDomain);
        if (!resolved.ok) return { ok: false, failure: resolved.failure };
        hostScope = resolved.host;
      }

      const startUrl = startUrlForDomain(hostScope);
      if (startUrl === null) return { ok: false, failure: { reason: "no-domain" } };
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
      // The host says whose site it is; the log's field set is fixed.
      logEvent("info", "crawl.started", { crawlId: crawl.id, projectId, host: hostScope });

      let result;
      try {
        result = await engine({
          startUrl,
          hostScope,
          userAgent: config.userAgent,
          budget: config.budget,
          concurrency: config.concurrency,
          ...engineOverrides,
        });

        // Pages first: a crawl row that says "completed, 40 pages" with no
        // pages behind it would be a lie the reader cannot detect.
        await store.savePages(crawl.id, result.pages);
        await store.saveLinks(crawl.id, result.links);
      } catch (error) {
        // The row was written before any of this ran, so an exception here
        // would otherwise leave it `running` for ever — a crawl that never
        // finishes and that nothing will ever come back to close, because
        // there is no scheduler and no recovery sweep. Close it now, while we
        // still know it failed.
        logEvent("error", "crawl.failed", {
          crawlId: crawl.id,
          projectId,
          errorCode: UNEXPECTED_FAILURE.code,
          reason: error instanceof Error ? error.name : "unknown",
        });
        await store.finish(crawl.id, {
          status: "failed",
          stopReason: "error",
          robotsState: "unavailable",
          sitemapState: "unavailable",
          pagesDiscovered: 0,
          pagesFetched: 0,
          pagesFailed: 0,
          error: { ...UNEXPECTED_FAILURE },
        });
        return { ok: false, failure: { reason: "unavailable" } };
      }

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
      // `finish` is conditional on the crawl still running, so a null means
      // something else closed it first. Re-read rather than handing back the
      // `running` row we opened with, which would report a finished crawl as
      // still in flight.
      const closed = finished ?? (await store.getById(crawl.id)) ?? crawl;
      // The project's own site only: the findings describe "the project's
      // pages", which a competitor crawl's are not.
      if (target === undefined) await recordFindings(closed, result);
      return { ok: true, crawl: closed };
    },

    async getCrawlFindings(projectId, crawlId) {
      if (!findings.storesFindings) return null;
      return findings.getReport(projectId, crawlId);
    },

    async getCrawl(id, pageLimit = DEFAULT_PAGE_LIMIT) {
      const crawl = await store.getById(id);
      if (crawl === null) return null;
      return { crawl, pages: await store.listPages(id, pageLimit) };
    },

    async listCrawlLinks(id, limit = DEFAULT_LINK_LIMIT) {
      const bounded = Number.isInteger(limit) && limit > 0 ? Math.min(limit, MAX_LINK_LIMIT) : DEFAULT_LINK_LIMIT;
      return store.listLinks(id, bounded);
    },

    async listCrawls(projectId, limit = DEFAULT_CRAWL_LIST_LIMIT) {
      // Own-site crawls are the ones confined to the project's own host, which
      // is exactly the host `startCrawl` records for them. A project with no
      // usable domain has never had one.
      const project = await projects.getProjectById(projectId);
      if (project === null) return [];
      const projectHost = hostScopeFromDomain(project.domain);
      if (projectHost === null) return [];
      return store.listByProject(projectId, limit, projectHost);
    },

    async listCompetitorCrawls(projectId, competitorDomain, limit = DEFAULT_CRAWL_LIST_LIMIT) {
      const resolved = await competitorHost(projectId, competitorDomain);
      if (!resolved.ok) return { ok: false, failure: resolved.failure };
      return { ok: true, host: resolved.host, crawls: await store.listByProject(projectId, limit, resolved.host) };
    },
  };
}
