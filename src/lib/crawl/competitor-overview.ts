/**
 * The Competitor Intelligence screen over stored crawls (Phase 4, checkpoint
 * 4.4, decision Q3).
 *
 * For one stored project and one competitor domain the project recorded at
 * intake: the newest own-site crawl and the newest crawl of that competitor,
 * each reduced to what its fetched pages declared — title, first h1, meta
 * description, canonical and structured-data types — or "not crawled". The
 * rules are the comparison reader's (`comparison-grounding.ts`), reused, not
 * restated: the competitor is resolved against the project's stored record by
 * `resolveCompetitorTarget`, each side's newest crawl is found by the server
 * by exact host and read back checked against the project and host, and the
 * same injected readers answer. Unlike the reader, a side with no crawl is an
 * answer ("not crawled"), not a refusal, because the screen shows it.
 *
 * Nothing here ranks, scores or measures either site. A crawl is a bounded
 * sample of a few pages at one time; what a rival's pages declared says
 * nothing about its traffic, rankings, links or standing. Pure; the route
 * hands in the readers.
 */

import { isProjectSiteCrawl, recordedCompetitorHost, resolveCompetitorTarget, type CompetitorTargetRefusal } from "@/lib/crawl/competitor-target";
import type { ComparisonGroundingReaders } from "@/lib/crawl/comparison-grounding";
import { STATUS_LABEL, STOP_REASON } from "@/lib/crawl/panel-state";
import { groupPages, pathOf } from "@/lib/crawl/pages-view";
import { hostScopeFromDomain } from "@/lib/crawl/url-policy";
import type { AgentRun } from "@/types/agent-run";
import type { Crawl, CrawlPage } from "@/types/crawl";

/** The reads this needs: the comparison reader's own. */
export type CompetitorOverviewReaders = ComparisonGroundingReaders;

/** How many pages of one crawl are read back; a production crawl fetches five. */
export const OVERVIEW_PAGE_LIMIT = 200;
/** The longest declaration shown, in characters; the stored text is never altered. */
export const DECLARATION_MAX = 300;

export const DECLARATIONS_LABEL = "What each site's pages declared, as crawled";
export const DECLARATIONS_NOTE =
  "Each side is a bounded sample of a few pages, crawled at a different time. What a page declared says nothing about the site's traffic, rankings, links or standing, and nothing here compares or scores the two.";
export const RECORDED_NOTE = "Recorded at intake by the agency; not verified as a competitor.";

export type DeclaredPage = {
  readonly url: string;
  readonly path: string;
  readonly title: string | null;
  readonly firstH1: string | null;
  readonly metaDescription: string | null;
  readonly canonical: string | null;
  readonly schemaTypes: readonly string[];
};

export type SiteSide =
  | { readonly status: "not-crawled"; readonly host: string }
  | {
      readonly status: "crawled";
      readonly host: string;
      /** The crawl row, so the review control can decide what it would compare. */
      readonly crawl: Crawl;
      readonly banner: string;
      /** Only a completed or partial crawl's fetched pages; a failed, cancelled or running crawl shows none. */
      readonly pages: readonly DeclaredPage[];
    };

export type CompetitorOverview = {
  readonly status: "overview";
  readonly projectHost: string;
  readonly competitorHost: string;
  readonly project: SiteSide;
  readonly competitor: SiteSide;
};

export type CompetitorSummary = {
  readonly host: string;
  /** The newest crawl of this competitor, or null when none is recorded. */
  readonly latest: Crawl | null;
  readonly banner: string | null;
};

export type CompetitorList = {
  readonly status: "list";
  readonly projectHost: string;
  readonly competitors: readonly CompetitorSummary[];
};

export type OverviewRefusal = "project-not-found" | CompetitorTargetRefusal;

const REVIEWABLE: readonly Crawl["status"][] = ["completed", "partial"];

function cut(value: string | null): string | null {
  if (value === null) return null;
  return value.length > DECLARATION_MAX ? `${value.slice(0, DECLARATION_MAX - 1)}…` : value;
}

/** "Crawl f4f5fda7 · Partial — stopped on the page budget · 5 of 50 discovered pages fetched, 45 not reached" */
export function competitorBanner(crawl: Crawl): string {
  const status = STATUS_LABEL[crawl.status].label;
  const reason = crawl.stopReason === null ? "still running" : STOP_REASON[crawl.stopReason].replace(/^./, (c) => c.toLowerCase());
  const notReached = Math.max(0, crawl.pagesDiscovered - crawl.pagesFetched - crawl.pagesFailed);
  const failed = crawl.pagesFailed > 0 ? `, ${crawl.pagesFailed} tried but not read` : "";
  return `Crawl ${crawl.id.slice(0, 8)} · ${status} — ${reason} · ${crawl.pagesFetched} of ${crawl.pagesDiscovered} discovered pages fetched, ${notReached} not reached${failed}`;
}

export function declaredPages(pages: readonly CrawlPage[]): readonly DeclaredPage[] {
  return groupPages(pages)
    .fetched.map((page) => ({
      url: page.url,
      path: pathOf(page.url),
      title: cut(page.title),
      firstH1: cut(page.firstH1),
      metaDescription: cut(page.metaDescription),
      canonical: page.canonicalResolved,
      schemaTypes: [...page.schemaTypes],
    }))
    .sort((a, b) => a.url.localeCompare(b.url));
}

function newestCrawl(crawls: readonly Crawl[]): Crawl | null {
  let newest: Crawl | null = null;
  for (const crawl of crawls) if (newest === null || crawl.startedAt > newest.startedAt) newest = crawl;
  return newest;
}

async function readSide(
  readers: CompetitorOverviewReaders,
  host: string,
  projectId: string,
  list: () => Promise<readonly Crawl[]>,
  isExpectedHost: (crawl: Crawl) => boolean,
): Promise<SiteSide> {
  const newest = newestCrawl(await list());
  if (newest === null) return { status: "not-crawled", host };
  if (!REVIEWABLE.includes(newest.status)) return { status: "crawled", host, crawl: newest, banner: competitorBanner(newest), pages: [] };
  const detail = await readers.crawls.getCrawl(newest.id, OVERVIEW_PAGE_LIMIT);
  // A row that cannot be read back, or that belongs elsewhere, is never shown under this side's heading.
  if (detail === null || detail.crawl.projectId !== projectId || !isExpectedHost(detail.crawl)) {
    return { status: "crawled", host, crawl: newest, banner: competitorBanner(newest), pages: [] };
  }
  const pages = REVIEWABLE.includes(detail.crawl.status) ? declaredPages(detail.pages) : [];
  return { status: "crawled", host, crawl: detail.crawl, banner: competitorBanner(detail.crawl), pages };
}

type Resolved = { readonly ok: true; readonly projectId: string; readonly projectDomain: string; readonly projectHost: string; readonly recorded: readonly string[] } | { readonly ok: false; readonly reason: OverviewRefusal };

async function resolveProject(readers: CompetitorOverviewReaders, projectId: string): Promise<Resolved> {
  const project = await readers.getProjectById(projectId);
  if (project === null) return { ok: false, reason: "project-not-found" };
  const projectHost = hostScopeFromDomain(project.domain);
  if (projectHost === null) return { ok: false, reason: "no-domain" };
  const intake = await readers.getProjectIntake(project.id);
  return { ok: true, projectId: project.id, projectDomain: project.domain, projectHost, recorded: intake?.competitorDomains ?? [] };
}

/** The project's recorded competitors, each with its newest crawl (no pages). */
export async function readCompetitorList(
  readers: CompetitorOverviewReaders,
  projectId: string,
): Promise<{ readonly ok: true; readonly view: CompetitorList } | { readonly ok: false; readonly reason: OverviewRefusal }> {
  const project = await resolveProject(readers, projectId);
  if (!project.ok) return project;
  const hosts: string[] = [];
  for (const entry of project.recorded) {
    const target = resolveCompetitorTarget({ competitorDomain: recordedCompetitorHost(entry), projectDomain: project.projectDomain, recordedCompetitorDomains: project.recorded });
    if (target.ok && !hosts.includes(target.host)) hosts.push(target.host);
  }
  const competitors: CompetitorSummary[] = [];
  for (const host of hosts) {
    const latest = newestCrawl((await readers.listCompetitorCrawls(project.projectId, host)).filter((crawl) => crawl.hostScope === host));
    competitors.push({ host, latest, banner: latest === null ? null : competitorBanner(latest) });
  }
  return { ok: true, view: { status: "list", projectHost: project.projectHost, competitors } };
}

/** The project's newest own-site crawl beside the newest crawl of one recorded competitor. */
export async function readCompetitorOverview(
  readers: CompetitorOverviewReaders,
  request: { readonly projectId: string; readonly competitorDomain: unknown },
): Promise<{ readonly ok: true; readonly view: CompetitorOverview } | { readonly ok: false; readonly reason: OverviewRefusal }> {
  const project = await resolveProject(readers, request.projectId);
  if (!project.ok) return project;
  const target = resolveCompetitorTarget({ competitorDomain: request.competitorDomain, projectDomain: project.projectDomain, recordedCompetitorDomains: project.recorded });
  if (!target.ok) return { ok: false, reason: target.reason };

  const projectSide = await readSide(
    readers,
    project.projectHost,
    project.projectId,
    () => readers.listProjectCrawls(project.projectId),
    (crawl) => isProjectSiteCrawl(crawl, project.projectDomain),
  );
  const competitorSide = await readSide(
    readers,
    target.host,
    project.projectId,
    () => readers.listCompetitorCrawls(project.projectId, target.host),
    (crawl) => crawl.hostScope === target.host,
  );
  return { ok: true, view: { status: "overview", projectHost: project.projectHost, competitorHost: target.host, project: projectSide, competitor: competitorSide } };
}

// ---------------------------------------------------------------------------
// Client helpers
// ---------------------------------------------------------------------------

export function competitorListUrl(projectId: string): string {
  return `/api/crawls/competitor-overview?${new URLSearchParams({ project: projectId }).toString()}`;
}

export function competitorOverviewUrl(projectId: string, host: string): string {
  return `/api/crawls/competitor-overview?${new URLSearchParams({ project: projectId, competitor: host }).toString()}`;
}

/** The detail route for one competitor, keyed by its host (Q3). */
export function competitorHref(host: string, projectId: string): string {
  return `/competitors/${encodeURIComponent(host)}?${new URLSearchParams({ project: projectId }).toString()}`;
}

/** Why the read failed — never worded as "no competitors" or "not crawled". */
export function competitorReadFailure(status: number, error?: string): string {
  if (status === 401) return "Sign in again to read the recorded crawls.";
  if (status === 404) return "This project is not stored on this server.";
  if (status === 422 && error === "competitor-not-recorded") return "That domain is not one of the competitor domains recorded for this project.";
  if (status === 422 && error === "competitor-is-project-site") return "That domain is this project's own site, not a competitor's.";
  if (status === 422) return "That is not a competitor domain this project can be compared with.";
  if (status === 429) return "Too many reads in a short time. Wait a moment and reload.";
  if (status === 503) return "Crawls are not stored on this deployment, so there is nothing to show.";
  return "The recorded crawls could not be read. This is a read failure, not an empty result.";
}

// ---------------------------------------------------------------------------
// Comparison runs for one competitor
// ---------------------------------------------------------------------------

export const COMPARISON_AGENT_ID = "market-intelligence" as const;
export const COMPARISON_TASK_TYPE = "competitor-comparison-review" as const;
/** How many of the agent's newest runs on the project are read back (the list endpoint's maximum). */
export const COMPARISON_RUNS_READ_LIMIT = 100;

export type ComparisonRunRow = {
  readonly id: string;
  readonly status: AgentRun["status"];
  readonly createdAt: string;
  readonly finishedAt: string | null;
  /** The stored summary of a completed run; null otherwise. */
  readonly summary: string | null;
  /** The fixed error code of a failed run; null otherwise. */
  readonly errorCode: string | null;
  readonly simulated: boolean;
};

/** The comparison reviews of this one competitor, newest first; another competitor's never appear. */
export function comparisonRunsFor(runs: readonly AgentRun[], host: string): readonly ComparisonRunRow[] {
  return runs
    .filter((run) => run.agentId === COMPARISON_AGENT_ID && run.taskType === COMPARISON_TASK_TYPE && run.input.competitorDomain === host)
    .map((run) => ({
      id: run.id,
      status: run.status,
      createdAt: run.createdAt,
      finishedAt: run.finishedAt,
      summary: run.status === "completed" ? run.resultSummary : null,
      errorCode: run.status === "failed" ? (run.error?.code ?? null) : null,
      simulated: run.executor === "mock" || run.resultMetadata?.simulated === true,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}

export function comparisonRunsUrl(projectId: string): string {
  return `/api/agent-runs?${new URLSearchParams({ project: projectId, agent: COMPARISON_AGENT_ID, limit: String(COMPARISON_RUNS_READ_LIMIT) }).toString()}`;
}
