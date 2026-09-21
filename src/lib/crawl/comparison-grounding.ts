/**
 * Two crawls, one of the project's own site and one of a competitor's,
 * serialised side by side as evidence the Market & Competitor Intelligence
 * agent may reason over — the first task that reads a competitor crawl.
 *
 * This is the only path by which a competitor's recorded pages reach a
 * language model, and it is as narrow as the crawl reader it is built on.
 * Each side is the block `formatCrawlGrounding` would produce for that crawl
 * alone, under a smaller per-side budget so the pair stays bounded, wrapped
 * in a header that says whose site it is. Nothing new is observed here, and
 * nothing here ranks, scores or measures either site.
 *
 * Three rules decide every line below.
 *
 *   * **The project is the run's, and the competitor is the project's.** The
 *     task input names one competitor domain and nothing else. It is matched
 *     on the server against the domains the project's own stored record
 *     lists, by the same rule that authorises a competitor crawl, so a caller
 *     cannot name another client's competitor, a URL, an address, an
 *     unrecorded domain, or the project's own site. Both crawls are then
 *     found by the server — the newest recorded on each side — never by id
 *     from the caller, and each is checked against the project and against
 *     the host it is supposed to be of.
 *   * **A competitor crawl is a page's declarations, not a business.** What a
 *     rival's public pages returned to this crawler says what those pages
 *     declared: titles, descriptions, headings, canonicals, structured-data
 *     types. It says nothing about the rival's traffic, rankings, links,
 *     revenue or standing, and the block says so beside the data, not only
 *     in the instructions.
 *   * **Two samples are two samples.** Each crawl is a few pages under a
 *     fixed budget, taken at a different time. A difference between them is
 *     a difference between the samples; the limits note says so, and the
 *     instructions ask the agent to say so too.
 *
 * Nothing here is trusted as instruction. Both sites' text is quoted as the
 * crawl reader quotes it, and the executor's system prompt tells the model to
 * treat it as data. This module carries no operator free text: the only
 * input the task takes is a hostname, and the hostname is checked before it
 * is used.
 */

import type { GroundingSource } from "@/lib/agent-runs/ai-executor";
import { isProjectSiteCrawl, resolveCompetitorTarget, type CompetitorTargetRefusal } from "@/lib/crawl/competitor-target";
import {
  byteLength,
  formatCrawlGrounding,
  type CrawlGrounding,
  type CrawlGroundingLimits,
  type CrawlGroundingReader,
} from "@/lib/crawl/grounding";
import { hostScopeFromDomain } from "@/lib/crawl/url-policy";
import type { Crawl } from "@/types/crawl";
import type { ProjectIntake, ProjectRecord } from "@/types/project";

/**
 * The reads this module needs. Injected, so tests need no store; the runtime
 * hands in the project repository and the crawl service.
 */
export type ComparisonGroundingReaders = {
  /** The stored record, or null when no project has that id. */
  getProjectById(id: string): Promise<ProjectRecord | null>;
  /** The intake-only columns, or null where the store keeps none. */
  getProjectIntake(id: string): Promise<ProjectIntake | null>;
  /** The project's own-site crawls, newest first. */
  listProjectCrawls(projectId: string): Promise<readonly Crawl[]>;
  /** The project's crawls of one competitor host, newest first. */
  listCompetitorCrawls(projectId: string, competitorHost: string): Promise<readonly Crawl[]>;
  /** One crawl with its pages, as the crawl reader reads it. */
  crawls: CrawlGroundingReader;
};

export type ComparisonGroundingRefusal =
  /** No project with that id. The run's own project row is gone. */
  | "project-not-found"
  /** The task input carries no usable competitor domain. */
  | "competitor-domain-missing"
  /** The domain is not one the project's stored record lists, or is not a hostname, or is the project's own site. */
  | CompetitorTargetRefusal
  /** The project has never had an own-site crawl recorded. */
  | "project-crawl-missing"
  /** The project's newest own-site crawl is still running. */
  | "project-crawl-unfinished"
  /** The project's newest own-site crawl failed or was cancelled. */
  | "project-crawl-not-reviewable"
  /** No crawl of this competitor has been recorded for the project. */
  | "competitor-crawl-missing"
  | "competitor-crawl-unfinished"
  | "competitor-crawl-not-reviewable"
  /** A listed crawl could not be read back, or was recorded against another project or another host. */
  | "crawl-not-readable";

export type ComparisonGrounding = {
  /** The evidence block, as it is given to the model. */
  readonly text: string;
  /** Non-sensitive facts about the evidence, stored on the run. */
  readonly summary: {
    readonly source: "competitor-comparison";
    readonly projectId: string;
    readonly projectHost: string;
    readonly projectCrawlId: string;
    readonly projectCrawlStatus: Crawl["status"];
    readonly projectPagesFetched: number;
    readonly projectPagesIncluded: number;
    readonly projectTruncated: boolean;
    readonly competitorHost: string;
    readonly competitorCrawlId: string;
    readonly competitorCrawlStatus: Crawl["status"];
    readonly competitorPagesFetched: number;
    readonly competitorPagesIncluded: number;
    readonly competitorTruncated: boolean;
    /** Size of the evidence actually produced, in UTF-8 bytes. */
    readonly bytes: number;
  };
  readonly source: GroundingSource;
};

export type ComparisonGroundingResult =
  | { readonly ok: true; readonly grounding: ComparisonGrounding }
  | { readonly ok: false; readonly reason: ComparisonGroundingRefusal };

export const COMPARISON_SOURCE: GroundingSource = {
  label: "competitor comparison evidence",
  description:
    "two crawls this product recorded — the readings of the project's own site and the readings of one competitor's public site, each a bounded sample of a few pages, and the competitor's side is what its public pages declared to this crawler, never a measurement of the competitor's performance",
  heading: "Evidence recorded by this product: the project's site and one competitor's site, side by side",
  quotes: "two third-party websites — the project's own and a competitor's — titles, headings, descriptions, canonical URLs",
};

/**
 * What one side may hold.
 *
 * Half the crawl reader's page cap and half its byte ceiling, so the pair
 * together stays within the order of size one block has always had. A
 * production crawl is five pages, so the cap is never reached there; it is
 * enforced anyway, per side, so neither site can crowd out the other.
 */
export const COMPARISON_SIDE_LIMITS: CrawlGroundingLimits = { maxPages: 25, maxBytes: 60_000 };

/** The crawl states whose readings may be compared — the crawl reader's own two. */
const REVIEWABLE_STATUSES: readonly Crawl["status"][] = ["completed", "partial"];

/**
 * Reads the two newest crawls for one project and one of its recorded
 * competitors, or refuses.
 *
 * Refusals are decided in order and before anything is formatted, so a
 * refusal never carries a line of either site's text back with it. The
 * project record first, then the domain against that record's own list, then
 * each side's newest crawl and its state. The newest crawl on each side is
 * the one the panels show; if it is not reviewable the task is refused
 * rather than silently falling back to an older one, so what the operator
 * sees on screen is what the agent was given.
 */
export async function readComparisonGrounding(
  readers: ComparisonGroundingReaders,
  request: { readonly projectId: string; readonly competitorDomain: unknown },
): Promise<ComparisonGroundingResult> {
  const project = await readers.getProjectById(request.projectId);
  if (project === null) return { ok: false, reason: "project-not-found" };
  if (typeof request.competitorDomain !== "string") return { ok: false, reason: "competitor-domain-missing" };

  // The stored record decides which competitors exist. A store that keeps no
  // intake columns lists none, and then no domain can be recorded.
  const intake = await readers.getProjectIntake(project.id);
  const target = resolveCompetitorTarget({
    competitorDomain: request.competitorDomain,
    projectDomain: project.domain,
    recordedCompetitorDomains: intake?.competitorDomains ?? [],
  });
  if (!target.ok) return { ok: false, reason: target.reason };
  const projectHost = hostScopeFromDomain(project.domain);
  if (projectHost === null) return { ok: false, reason: "no-domain" };

  const projectSide = await readSide(readers, {
    list: () => readers.listProjectCrawls(project.id),
    projectId: project.id,
    isExpectedHost: (crawl) => isProjectSiteCrawl(crawl, project.domain),
    missing: "project-crawl-missing",
    unfinished: "project-crawl-unfinished",
    notReviewable: "project-crawl-not-reviewable",
  });
  if (!projectSide.ok) return projectSide;

  const competitorSide = await readSide(readers, {
    list: () => readers.listCompetitorCrawls(project.id, target.host),
    projectId: project.id,
    isExpectedHost: (crawl) => crawl.hostScope === target.host,
    missing: "competitor-crawl-missing",
    unfinished: "competitor-crawl-unfinished",
    notReviewable: "competitor-crawl-not-reviewable",
  });
  if (!competitorSide.ok) return competitorSide;

  return {
    ok: true,
    grounding: formatComparisonGrounding({
      projectId: project.id,
      projectHost,
      competitorHost: target.host,
      project: projectSide.side,
      competitor: competitorSide.side,
    }),
  };
}

type Side = { readonly crawl: Crawl; readonly grounding: CrawlGrounding };

/**
 * One side's newest crawl, read back with its pages and formatted alone.
 *
 * The listing says which crawl is newest; the detail read says what it
 * holds. Both are checked: the detail is the same project's and of the host
 * this side is supposed to be of, whatever the listing said, so a store that
 * answered the wrong row could not put one site's pages under the other's
 * heading.
 */
async function readSide(
  readers: ComparisonGroundingReaders,
  side: {
    readonly list: () => Promise<readonly Crawl[]>;
    readonly projectId: string;
    readonly isExpectedHost: (crawl: Crawl) => boolean;
    readonly missing: ComparisonGroundingRefusal;
    readonly unfinished: ComparisonGroundingRefusal;
    readonly notReviewable: ComparisonGroundingRefusal;
  },
): Promise<{ readonly ok: true; readonly side: Side } | { readonly ok: false; readonly reason: ComparisonGroundingRefusal }> {
  const newest = newestCrawl(await side.list());
  if (newest === null) return { ok: false, reason: side.missing };
  if (newest.status === "running") return { ok: false, reason: side.unfinished };
  if (!REVIEWABLE_STATUSES.includes(newest.status)) return { ok: false, reason: side.notReviewable };

  const detail = await readers.crawls.getCrawl(newest.id, COMPARISON_SIDE_LIMITS.maxPages * 4);
  if (detail === null) return { ok: false, reason: "crawl-not-readable" };
  if (detail.crawl.projectId !== side.projectId || !side.isExpectedHost(detail.crawl)) {
    return { ok: false, reason: "crawl-not-readable" };
  }
  // The state is checked again on the row as read back: a crawl can change
  // state between the listing and the detail read.
  if (detail.crawl.status === "running") return { ok: false, reason: side.unfinished };
  if (!REVIEWABLE_STATUSES.includes(detail.crawl.status)) return { ok: false, reason: side.notReviewable };

  return {
    ok: true,
    side: { crawl: detail.crawl, grounding: formatCrawlGrounding(detail.crawl, detail.pages, COMPARISON_SIDE_LIMITS) },
  };
}

/** The most recently started crawl, whatever order the list arrived in. */
function newestCrawl(crawls: readonly Crawl[]): Crawl | null {
  let newest: Crawl | null = null;
  for (const crawl of crawls) {
    if (newest === null || crawl.startedAt > newest.startedAt) newest = crawl;
  }
  return newest;
}

/** Wraps the two formatted sides into one block, each under the heading that says whose site it is. */
export function formatComparisonGrounding(input: {
  readonly projectId: string;
  readonly projectHost: string;
  readonly competitorHost: string;
  readonly project: Side;
  readonly competitor: Side;
}): ComparisonGrounding {
  const { projectHost, competitorHost, project, competitor } = input;

  const header = [
    "COMPETITOR COMPARISON (two crawls recorded by this product, one of each site)",
    `Project site: ${projectHost} — the project's own site, as its pages were read by this product's crawler.`,
    `Competitor site: ${competitorHost} — a competitor's public site, as its pages were read by this product's crawler. Its evidence is what those public pages declared to this crawler: page-level declarations only. It establishes nothing about the competitor's traffic, rankings, keyword positions, backlinks, authority, revenue, conversions, share of voice, market share, citations, AI visibility, brand strength, or business performance.`,
  ].join("\n");

  const sections = [
    header,
    [
      `=== PROJECT SITE EVIDENCE: ${projectHost} (the project's own site) ===`,
      project.grounding.text,
      "=== END PROJECT SITE EVIDENCE ===",
    ].join("\n\n"),
    [
      `=== COMPETITOR SITE EVIDENCE: ${competitorHost} (a competitor's public site — page declarations only) ===`,
      competitor.grounding.text,
      "=== END COMPETITOR SITE EVIDENCE ===",
    ].join("\n\n"),
    COMPARISON_LIMITS_NOTE,
  ];

  const text = sections.join("\n\n");
  return {
    text,
    summary: {
      source: "competitor-comparison",
      projectId: input.projectId,
      projectHost,
      projectCrawlId: project.crawl.id,
      projectCrawlStatus: project.crawl.status,
      projectPagesFetched: project.grounding.summary.pagesFetched,
      projectPagesIncluded: project.grounding.summary.pagesIncluded,
      projectTruncated: project.grounding.summary.truncated || project.grounding.summary.truncatedByBytes,
      competitorHost,
      competitorCrawlId: competitor.crawl.id,
      competitorCrawlStatus: competitor.crawl.status,
      competitorPagesFetched: competitor.grounding.summary.pagesFetched,
      competitorPagesIncluded: competitor.grounding.summary.pagesIncluded,
      competitorTruncated: competitor.grounding.summary.truncated || competitor.grounding.summary.truncatedByBytes,
      bytes: byteLength(text),
    },
    source: COMPARISON_SOURCE,
  };
}

/**
 * What a pair of bounded crawls cannot support, stated inside the evidence.
 *
 * Each side already carries the crawl reader's own limits note. This one is
 * about the comparison: two samples, taken at different times, under budgets
 * that stop a crawl after a few pages, say nothing about either site as a
 * whole and nothing about how the two sites perform against each other.
 */
export const COMPARISON_LIMITS_NOTE = [
  "LIMITS OF THIS COMPARISON",
  "- Each side is a bounded crawl of a few pages under a fixed page, depth and time budget, taken at its own time. Neither is a full site audit, and the two are not the same pages of two sites: they are the pages each crawl happened to reach.",
  "- A difference between the two sides is a difference between two small samples. It is not established as a difference between the two sites, and a page count is a budget outcome, not a measure of either site's size.",
  "- The competitor side is what a rival's public pages declared to this crawler. It is not the competitor's strategy, performance, standing, or business, and nothing here compares either site's traffic, rankings, keyword positions, backlinks, authority, revenue, conversions, share of voice, market share, citations, AI visibility, brand strength, page body quality, or content depth.",
  "- Nothing here ranks, scores, or measures either site against the other.",
].join("\n");

/**
 * What the Market & Competitor Intelligence agent is asked to produce from
 * the two blocks.
 *
 * Five fixed sections, so the observations of each site stay apart from the
 * differences between them, the differences apart from what is inferred, and
 * all of it apart from the one thing an operator is asked to do. Every
 * inference is marked as one, and the list of what the evidence cannot
 * establish is longer than any other task's, because "competitor" is one
 * careless word away from "market", and only page declarations are in the
 * evidence.
 */
export const COMPETITOR_COMPARISON_INSTRUCTIONS = [
  "Compare the two crawl evidence blocks supplied with this task: PROJECT SITE EVIDENCE (the project's own site) and COMPETITOR SITE EVIDENCE (a competitor's public site, page declarations only).",
  "Answer in exactly five sections, headed PROJECT SITE OBSERVATIONS, COMPETITOR SITE OBSERVATIONS, DIFFERENCES OBSERVED, INFERENCES, and RECOMMENDED NEXT OPERATOR ACTION.",
  "Under the first three, state only what the evidence literally records — titles, descriptions, h1s, canonicals, robots directives, structured-data types, sitemap and robots.txt readings, HTTP statuses, page counts — each with the exact URL it comes from. Under DIFFERENCES OBSERVED, name the project URL and the competitor URL each difference is between, or say the pairing is not established.",
  "Under INFERENCES, give at most three, each beginning with the word INFERENCE: and each tied to one difference above, with your confidence. Under RECOMMENDED NEXT OPERATOR ACTION, give one concrete change to the project's own site for a person to consider, or one thing to check; you change nothing.",
  "Use only the supplied evidence. Both sides are partial samples of a few pages under a fixed budget: say so in one line, and treat a difference between the samples as a difference between the samples, never as a difference between the sites.",
  "A reading marked 'not established' is unknown; never treat it as a pass, a failure, a zero, or a no. URLs discovered but not reached were NOT audited on either side: do not describe them. The competitor evidence is what its public pages declared; it does not describe the competitor's business.",
  "NOT established by this evidence and must not be claimed, estimated, or implied for either site: traffic, rankings, keyword positions, backlinks, authority, revenue, conversions, share of voice, market share, citation share, AI visibility, brand strength, page body quality, content depth. Do not describe either crawl as a full site audit or state site-wide totals.",
  "Keep the whole answer under 1,500 characters. End with exactly this sentence: Not established by these crawls: traffic, rankings, keyword positions, backlinks, authority, revenue, conversions, share of voice, market share, citations, AI visibility, brand strength, page body quality, content depth.",
].join(" ");
