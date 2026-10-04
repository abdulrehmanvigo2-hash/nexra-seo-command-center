import "server-only";

import type { CrawlStore } from "@/lib/crawl/contract";
import type { CrawlConfig } from "@/lib/crawl/config";
import { isHostAllowed } from "@/lib/crawl/config";
import { resolveCompetitorTarget } from "@/lib/crawl/competitor-target";
import { runCrawl, type CrawlResult, type EngineOptions } from "@/lib/crawl/engine";
import { computeCrawlFindings } from "@/lib/crawl/findings/compute";
import { FINDINGS_LINK_LIMIT } from "@/lib/crawl/findings/grounding";
import { unavailableCrawlFindingsStore, type CrawlFindingsStore, type StoredCrawlFindingsReport } from "@/lib/crawl/findings/store-contract";
import { OVERVIEW_LINK_LIMIT, OVERVIEW_PAGE_LIMIT, overviewReport, summarizeLinks, type CrawlOverview, type OverviewReport } from "@/lib/crawl/overview/contract";
import { FINDINGS_RULE_VERSION } from "@/lib/crawl/findings/contract";
import { deriveFindingHistory, type FindingHistory, type HistoryEntry } from "@/lib/crawl/findings/history";
import type { StoredCrawlFinding } from "@/lib/crawl/findings/store-contract";
import type { FindingTriage, FindingTriageStatus, SetFindingTriageOutcome } from "@/lib/crawl/findings/triage/contract";
import { TRIAGE_READ_LIMIT, unavailableCrawlFindingTriageStore, type CrawlFindingTriageStore } from "@/lib/crawl/findings/triage/store-contract";
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
   * when it finished. A read of stored rows only, scoped to the project:
   * a crawl that is not the project's answers `not-found`, a crawl with
   * nothing recorded (made before findings were kept, still running, failed,
   * or a competitor's) answers `not-recorded`, and a deployment whose store
   * keeps no findings answers `unavailable` rather than an empty report.
   */
  getCrawlFindings(projectId: string, crawlId: string): Promise<CrawlFindingsRead>;
  /**
   * The most recently recorded findings across the project's own crawls,
   * with every decision recorded for the project (M3). A read of stored rows
   * only: `unavailable` when the store keeps no findings, `none` when no crawl
   * of the project ever recorded any, otherwise the crawl, its newest report
   * and the project's decisions. Never another project's rows.
   */
  getLatestCrawlFindings(projectId: string): Promise<LatestCrawlFindingsRead>;
  /**
   * Records an operator's decision about one recorded finding of one of the
   * project's own crawls, by finding key (M3). The crawl is checked against
   * the project here and again by the database function; a crawl that is not
   * the project's answers `not-found`, a key not recorded for it
   * `not-recorded`. Nothing about the finding itself changes.
   */
  setFindingTriage(input: SetFindingTriageRequest): Promise<SetFindingTriageResult>;
  /**
   * The project's latest own-site crawl as the live Technical SEO screen
   * reads it (Phase 3, checkpoint 3.2): the crawl, its pages (bounded), a
   * summary of its recorded edges, and its findings at the current rule
   * version. Read only. `unavailable` when crawls are not stored, `none`
   * when the project has no own-site crawl; a competitor crawl is never it.
   */
  getLatestCrawlOverview(projectId: string): Promise<CrawlOverview>;
  /**
   * One recorded page of one of a stored project's own crawls, by the page's
   * own id (checkpoint 3.3): the page, the recorded edges into and out of it,
   * the findings of its crawl's report that name it, and the decisions
   * recorded against them. The page → crawl → project chain is checked here:
   * an unknown page, a page of a competitor crawl or of a crawl whose project
   * is gone answers `not-found`. Read only.
   */
  getCrawlPageDetail(pageId: string): Promise<CrawlPageDetail>;
  /**
   * Cross-crawl finding history for the project's own crawls, derived on
   * read from the recorded reports (checkpoint 3.3, decision Q4). Nothing is
   * stored and nothing is recomputed.
   */
  getFindingHistory(projectId: string): Promise<FindingHistoryRead>;
};

/** How many of the project's newest own-site crawls finding history looks back over. */
export const HISTORY_CRAWL_LIMIT = 10;

export type CrawlPageDetail =
  | { readonly status: "unavailable" }
  | { readonly status: "not-found" }
  | {
      readonly status: "found";
      readonly crawl: Crawl;
      readonly page: CrawlPage;
      /** Recorded edges whose target is this page. */
      readonly inbound: readonly CrawlLink[];
      /** Recorded edges found on this page. */
      readonly outbound: readonly CrawlLink[];
      /** Whether the crawl's edge read reached its bound, so edges may be missing. */
      readonly linksCut: boolean;
      readonly report: OverviewReport;
      /** Findings of the report at the current rules that name this page's URL. */
      readonly findings: readonly StoredCrawlFinding[];
      readonly triage: readonly FindingTriage[];
    };

export type FindingHistoryRead =
  | { readonly status: "unavailable" }
  | { readonly status: "none" }
  | { readonly status: "derived"; readonly history: FindingHistory };

export type LatestCrawlFindingsRead =
  /** The findings store is not configured on this deployment. */
  | { readonly status: "unavailable" }
  /** No crawl of the project has a recorded report. */
  | { readonly status: "none" }
  | { readonly status: "recorded"; readonly crawl: Crawl; readonly report: StoredCrawlFindingsReport; readonly triage: readonly FindingTriage[] };

export type SetFindingTriageRequest = {
  readonly projectId: string;
  readonly crawlId: string;
  readonly findingKey: string;
  readonly status: FindingTriageStatus;
  readonly note: string | null;
  readonly operatorId: string;
};

export type SetFindingTriageResult = SetFindingTriageOutcome | { readonly status: "unavailable" };

export type CrawlFindingsRead =
  /** The findings store is not configured on this deployment. */
  | { readonly status: "unavailable" }
  /** No such crawl, or not this project's. */
  | { readonly status: "not-found" }
  /** The crawl is the project's, and nothing was recorded for it. */
  | { readonly status: "not-recorded"; readonly crawl: Crawl }
  | { readonly status: "recorded"; readonly crawl: Crawl; readonly report: StoredCrawlFindingsReport };

export type CrawlServiceOptions = {
  readonly store: CrawlStore;
  readonly projects: ProjectRepository;
  readonly config: CrawlConfig;
  /** Where recorded findings are kept; absent, none are recorded and none read. */
  readonly findings?: CrawlFindingsStore;
  /** Where operators' decisions about findings are kept; absent, none are read or written. */
  readonly triage?: CrawlFindingTriageStore;
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
  const { store, projects, config, findings = unavailableCrawlFindingsStore, triage = unavailableCrawlFindingTriageStore, engine = runCrawl, engineOverrides = {} } = options;

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
          // M8: an own-site crawl starts from the sitemap as well as the home page; a competitor's follows links only.
          seedFromSitemap: target === undefined,
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

      // M8: an own-site crawl keeps its fetched pages' visible text, after the pages they belong to. Never fatal: a
      // store without the table (the migration not applied yet) keeps none, and the crawl is recorded as before.
      if (target === undefined && store.savePageTexts) {
        const texts = result.pages
          .filter((page) => page.fetchState === "fetched" && page.visibleText !== null && page.visibleText !== "")
          .map((page) => ({ url: page.url, text: page.visibleText! }));
        try {
          if (texts.length > 0) await store.savePageTexts(crawl.id, texts);
        } catch (error) {
          logEvent("warn", "crawl.texts_not_kept", { crawlId: crawl.id, projectId, reason: error instanceof Error ? error.name : "unknown" });
        }
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
      if (!findings.storesFindings) return { status: "unavailable" };
      // The crawl row is the project check: the report is read by project and
      // crawl, so another project's crawl could never answer with a report,
      // but it must answer `not-found`, not "nothing recorded".
      const crawl = await store.getById(crawlId);
      if (crawl === null || crawl.projectId !== projectId) return { status: "not-found" };
      const report = await findings.getReport(projectId, crawlId);
      return report === null ? { status: "not-recorded", crawl } : { status: "recorded", crawl, report };
    },

    async getLatestCrawlFindings(projectId) {
      if (!findings.storesFindings) return { status: "unavailable" };
      const latest = await findings.getLatestReportHeader(projectId);
      if (latest === null) return { status: "none" };
      // The header names the crawl; the crawl row is the project check, as in
      // getCrawlFindings, so a header that somehow names another project's
      // crawl reads as nothing rather than as that project's findings.
      const crawl = await store.getById(latest.crawlId);
      if (crawl === null || crawl.projectId !== projectId) return { status: "none" };
      const report = await findings.getReport(projectId, crawl.id);
      if (report === null) return { status: "none" };
      const decisions = triage.storesTriage ? await triage.listForProject(projectId, TRIAGE_READ_LIMIT) : [];
      return { status: "recorded", crawl, report, triage: decisions };
    },

    async setFindingTriage(input) {
      if (!findings.storesFindings || !triage.storesTriage) return { status: "unavailable" };
      const crawl = await store.getById(input.crawlId);
      if (crawl === null || crawl.projectId !== input.projectId) return { status: "not-found" };
      const outcome = await triage.set({
        projectId: input.projectId,
        crawlId: crawl.id,
        findingKey: input.findingKey,
        status: input.status,
        note: input.note,
        operatorId: input.operatorId,
      });
      // Ids, the outcome and the statuses only: never the note, which is an operator's free text.
      logEvent(outcome.status === "set" ? "info" : "warn", "crawl.finding_triage_set", {
        crawlId: crawl.id,
        projectId: input.projectId,
        outcome: outcome.status,
        status: outcome.status === "set" ? outcome.triage.status : null,
        from: outcome.status === "set" ? outcome.previous : null,
      });
      return outcome;
    },

    async getLatestCrawlOverview(projectId) {
      if (!store.storesCrawls) return { status: "unavailable" };
      const project = await projects.getProjectById(projectId);
      if (project === null) return { status: "none" };
      const projectHost = hostScopeFromDomain(project.domain);
      if (projectHost === null) return { status: "none" };
      // The newest crawl confined to exactly the project's own host: the same
      // rule listCrawls applies, so a competitor crawl is never the latest.
      const [crawl] = await store.listByProject(projectId, 1, projectHost);
      if (crawl === undefined || crawl.projectId !== projectId) return { status: "none" };
      const [pages, links, report] = await Promise.all([
        store.listPages(crawl.id, OVERVIEW_PAGE_LIMIT),
        store.listLinks(crawl.id, OVERVIEW_LINK_LIMIT),
        findings.storesFindings ? findings.getReport(projectId, crawl.id) : Promise.resolve(null),
      ]);
      return {
        status: "crawled",
        crawl,
        pages,
        pagesCut: pages.length >= OVERVIEW_PAGE_LIMIT,
        links: summarizeLinks(links, OVERVIEW_LINK_LIMIT),
        report: overviewReport(report),
      };
    },

    async getCrawlPageDetail(pageId) {
      if (!store.storesCrawls) return { status: "unavailable" };
      const page = await store.getPage(pageId);
      if (page === null) return { status: "not-found" };
      // The chain: the page's crawl, that crawl's project, and the crawl must
      // be confined to that project's own host — so a competitor crawl's page
      // and a page whose project is gone are never shown.
      const crawl = await store.getById(page.crawlId);
      if (crawl === null) return { status: "not-found" };
      const project = await projects.getProjectById(crawl.projectId);
      if (project === null) return { status: "not-found" };
      const projectHost = hostScopeFromDomain(project.domain);
      if (projectHost === null || crawl.hostScope !== projectHost) return { status: "not-found" };

      const [links, report, decisions] = await Promise.all([
        store.listLinks(crawl.id, OVERVIEW_LINK_LIMIT),
        findings.storesFindings ? findings.getReport(project.id, crawl.id) : Promise.resolve(null),
        triage.storesTriage ? triage.listForProject(project.id, TRIAGE_READ_LIMIT) : Promise.resolve([] as readonly FindingTriage[]),
      ]);
      const presented = overviewReport(report);
      const naming = presented.status === "recorded" ? presented.report.findings.filter((f) => f.urls.includes(page.url)) : [];
      const keys = new Set(naming.map((f) => f.id));
      return {
        status: "found",
        crawl,
        page,
        inbound: links.filter((link) => link.toUrl === page.url),
        outbound: links.filter((link) => link.fromUrl === page.url),
        linksCut: links.length >= OVERVIEW_LINK_LIMIT,
        report: presented,
        findings: naming,
        triage: decisions.filter((d) => keys.has(d.findingKey)),
      };
    },

    async getFindingHistory(projectId) {
      if (!store.storesCrawls || !findings.storesFindings) return { status: "unavailable" };
      const project = await projects.getProjectById(projectId);
      if (project === null) return { status: "none" };
      const projectHost = hostScopeFromDomain(project.domain);
      if (projectHost === null) return { status: "none" };
      const crawls = await store.listByProject(projectId, HISTORY_CRAWL_LIMIT, projectHost);
      if (crawls.length === 0) return { status: "none" };
      const headers = await findings.listReportHeaders(projectId, HISTORY_CRAWL_LIMIT * 4);
      const reported = new Set(headers.map((h) => h.crawlId));

      const entries: HistoryEntry[] = [];
      for (const crawl of crawls) {
        const ref = { id: crawl.id, startedAt: crawl.startedAt };
        if (!reported.has(crawl.id)) {
          entries.push({ kind: "not-recorded", crawl: ref });
          continue;
        }
        const report = await findings.getReport(projectId, crawl.id);
        if (report === null) {
          entries.push({ kind: "not-recorded", crawl: ref });
          continue;
        }
        // Pages are read only for reports that will be compared: the resolved rule needs what was fetched.
        const pages = report.header.ruleVersion === FINDINGS_RULE_VERSION ? await store.listPages(crawl.id, OVERVIEW_PAGE_LIMIT) : [];
        entries.push({
          kind: "recorded",
          crawl: ref,
          ruleVersion: report.header.ruleVersion,
          findings: new Map(report.findings.map((f) => [f.id, { rule: f.rule, urls: f.urls, urlCount: f.urlCount }])),
          fetchedUrls: new Set(pages.filter((p) => p.fetchState === "fetched").map((p) => p.url)),
        });
      }
      return { status: "derived", history: deriveFindingHistory(entries, FINDINGS_RULE_VERSION) };
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
