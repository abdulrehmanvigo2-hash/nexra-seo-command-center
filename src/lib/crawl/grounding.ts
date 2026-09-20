/**
 * One crawl, serialised as evidence an agent may reason over.
 *
 * This is the only path by which observed crawl data reaches a language
 * model, and it is deliberately narrow. What goes in is what this product
 * fetched and recorded; what does not go in is everything a crawler cannot
 * establish — Google's index, field vitals, rankings, traffic, or whether the
 * pages seen are all the pages there are.
 *
 * Two rules decide every line below.
 *
 *   * **A null is a question nobody answered.** It is written out as "not
 *     established", never as 0, false, "none", "healthy" or "pass". A model
 *     reading "in sitemap: no" would report a finding; reading "not
 *     established — the sitemap could not be read" it cannot.
 *   * **A page nobody fetched was not audited.** `budget-skipped` URLs are
 *     listed in their own section, by name, so the agent can say they exist
 *     and must not say anything about their contents.
 *
 * Nothing here is trusted as instruction. Page titles, headings and canonical
 * URLs are a client's own text and may say anything at all; they are labelled
 * as observations of a third-party site, and the executor's system prompt
 * tells the model to treat them as data. This module never carries operator
 * free text, because the task input it serves carries none: the only input a
 * crawl review takes is a crawl id.
 */

import { groupPages } from "@/lib/crawl/pages-view";
import type { Crawl, CrawlPage } from "@/types/crawl";

/** The crawl-detail read this module needs. Injected, so tests need no store. */
export type CrawlGroundingReader = {
  getCrawl(id: string, pageLimit?: number): Promise<{ crawl: Crawl; pages: readonly CrawlPage[] } | null>;
};

export type CrawlGrounding = {
  /** The evidence block, as it is given to the model. */
  readonly text: string;
  /** Non-sensitive facts about the evidence, stored on the run. */
  readonly summary: {
    readonly crawlId: string;
    readonly hostScope: string;
    readonly pagesFetched: number;
    readonly pagesNotReached: number;
    readonly pagesIncluded: number;
    readonly truncated: boolean;
  };
};

export type CrawlGroundingResult =
  | { readonly ok: true; readonly grounding: CrawlGrounding }
  | { readonly ok: false; readonly reason: CrawlGroundingRefusal };

export type CrawlGroundingRefusal =
  /** No crawl with that id. */
  | "crawl-not-found"
  /** The crawl belongs to a different project than the run does. */
  | "crawl-not-in-project"
  /** The crawl never finished, so its readings are incomplete. */
  | "crawl-unfinished";

/**
 * How many pages are described in full.
 *
 * A crawl may hold 500. The prompt has to stay bounded, and a truncated
 * listing is stated as truncated so the agent cannot read it as the whole
 * crawl.
 */
export const MAX_DESCRIBED_PAGES = 50;

/** Written wherever a reading was not established. */
const NOT_ESTABLISHED = "not established";

const flag = (value: boolean | null, yes: string, no: string, why: string): string =>
  value === null ? `${NOT_ESTABLISHED} (${why})` : value ? yes : no;

const num = (value: number | null, why: string): string =>
  value === null ? `${NOT_ESTABLISHED} (${why})` : String(value);

/**
 * Reads one crawl for one project, or refuses.
 *
 * Ownership is checked here and nowhere else: the caller supplies the project
 * the run belongs to, and a crawl recorded against any other project is
 * refused rather than described. An operator who names another client's crawl
 * id gets a refusal, not that client's site.
 */
export async function readCrawlGrounding(
  reader: CrawlGroundingReader,
  request: { readonly crawlId: string; readonly projectId: string },
): Promise<CrawlGroundingResult> {
  const detail = await reader.getCrawl(request.crawlId, MAX_DESCRIBED_PAGES * 4);
  if (detail === null) return { ok: false, reason: "crawl-not-found" };
  if (detail.crawl.projectId !== request.projectId) {
    return { ok: false, reason: "crawl-not-in-project" };
  }
  if (detail.crawl.status === "running") return { ok: false, reason: "crawl-unfinished" };

  return { ok: true, grounding: formatCrawlGrounding(detail.crawl, detail.pages) };
}

function crawlHeader(crawl: Crawl): string {
  const documents = {
    fetched: "read",
    absent: "not present (the origin returned 404)",
    unavailable: `${NOT_ESTABLISHED} — could not be read, which is never treated as permission`,
  } as const;

  return [
    "CRAWL (observed by this product)",
    `Start URL: ${crawl.startUrl}`,
    `Host scope: ${crawl.hostScope} — every fetch was confined to this host or a subdomain of it.`,
    `Status: ${crawl.status}${crawl.stopReason ? ` (${crawl.stopReason})` : ""}`,
    `Budget: ${crawl.budget.maxPages} pages, depth ${crawl.budget.maxDepth}, ${Math.round(crawl.budget.maxDurationMs / 1000)} seconds.`,
    `URLs discovered: ${crawl.pagesDiscovered}. Fetched: ${crawl.pagesFetched}. Failed: ${crawl.pagesFailed}.`,
    `robots.txt: ${documents[crawl.robotsState]}`,
    `Sitemap: ${documents[crawl.sitemapState]}`,
    `Started: ${crawl.startedAt}${crawl.finishedAt ? `, finished ${crawl.finishedAt}` : ""}`,
  ].join("\n");
}

function describePage(page: CrawlPage): string {
  return [
    `- URL: ${page.url}`,
    `  HTTP status: ${num(page.httpStatus, "no response was recorded")}`,
    `  Depth from start URL (this crawl): ${num(page.depth, "the page was never reached")}`,
    `  Redirect hops: ${page.redirectHops}${page.finalUrl && page.finalUrl !== page.url ? ` (final URL ${page.finalUrl})` : ""}`,
    `  Title: ${page.title === null ? NOT_ESTABLISHED : JSON.stringify(page.title)} (length ${num(page.titleLength, "no title was read")})`,
    `  Meta description length: ${num(page.metaDescriptionLength, "the page declares none")}`,
    `  H1 count: ${num(page.h1Count, "no h1 was read")}`,
    `  Canonical: ${
      page.canonicalIsSelf === null
        ? "none declared by the page"
        : page.canonicalIsSelf
          ? "points at this page"
          : `points elsewhere (${page.canonicalResolved ?? page.canonicalHref ?? NOT_ESTABLISHED})`
    }`,
    `  Robots meta directive: ${page.robotsMeta === null ? "none on the page — this is not the same as index,follow" : page.robotsMeta}`,
    `  Allowed by robots.txt: ${flag(page.robotsTxtAllowed, "yes", "no", "robots.txt could not be read")}`,
    `  In sitemap: ${flag(page.inSitemap, "yes", "no", "the sitemap could not be read")}`,
    `  Structured data: ${
      page.schemaParseFailed
        ? "a JSON-LD block was present and would not parse"
        : page.schemaBlocks === 0
          ? "no JSON-LD block found"
          : `${page.schemaBlocks} JSON-LD block(s)${page.schemaTypes.length > 0 ? `, types: ${page.schemaTypes.join(", ")}` : ""}`
    }`,
    `  Internal links out seen in THIS CRAWL: ${page.internalLinksOut}`,
    `  Internal links in seen in THIS CRAWL: ${page.internalLinksIn}`,
    `  Content type: ${page.contentType ?? NOT_ESTABLISHED}`,
  ].join("\n");
}

/** Serialises a finished crawl and its pages into the evidence block. */
export function formatCrawlGrounding(crawl: Crawl, pages: readonly CrawlPage[]): CrawlGrounding {
  const groups = groupPages(pages);
  const described = groups.fetched.slice(0, MAX_DESCRIBED_PAGES);
  const truncated = groups.fetched.length > described.length;

  const sections: string[] = [crawlHeader(crawl)];

  sections.push(
    [
      `PAGES FETCHED AND READ (${groups.fetched.length}${truncated ? `, ${described.length} described below` : ""})`,
      described.map(describePage).join("\n"),
    ].join("\n"),
  );

  if (truncated) {
    sections.push(
      `Only the first ${described.length} fetched pages are described. The rest were fetched but are not listed here, so do not describe this listing as the whole crawl.`,
    );
  }

  if (groups.notFetched.length > 0) {
    sections.push(
      [
        `URLS THAT RETURNED SOMETHING OTHER THAN A READ PAGE (${groups.notFetched.length})`,
        groups.notFetched
          .map(
            (page) =>
              `- ${page.url} — outcome: ${page.fetchState}${page.httpStatus === null ? "" : `, HTTP ${page.httpStatus}`}`,
          )
          .join("\n"),
      ].join("\n"),
    );
  }

  if (groups.notReached.length > 0) {
    sections.push(
      [
        `URLS DISCOVERED BUT NOT REACHED — NOT AUDITED (${groups.notReached.length})`,
        "These were found and never fetched, because the crawl ran out of budget. Nothing is known about their contents. Do not describe them as healthy, as having no issues, or as audited.",
        groups.notReached.map((page) => `- ${page.url}`).join("\n"),
      ].join("\n"),
    );
  }

  sections.push(LIMITS_NOTE);

  return {
    text: sections.join("\n\n"),
    summary: {
      crawlId: crawl.id,
      hostScope: crawl.hostScope,
      pagesFetched: groups.fetched.length,
      pagesNotReached: groups.notReached.length,
      pagesIncluded: described.length,
      truncated,
    },
  };
}

/**
 * What the evidence cannot support, stated inside the evidence itself.
 *
 * It sits in the same block as the readings rather than only in the system
 * prompt, so a model that attends to the data still reads the caveat attached
 * to it.
 */
export const LIMITS_NOTE = [
  "LIMITS OF THIS EVIDENCE",
  "- This is a bounded crawl of a few pages, not a full site audit. It cannot establish site-wide counts or completeness.",
  "- Internal link counts above were counted within this crawl only. They are not site-wide, and they cannot show that a page is orphaned.",
  "- Nothing here says whether Google has indexed any URL. An HTTP 200 means the server answered us, not that anyone indexed the page. Indexation is Google Search Console's to report.",
  "- There are no Core Web Vitals here. Field vitals come from real user measurement; no timing in this crawl describes anyone's experience of the page.",
  "- There is no search volume, ranking, traffic or competitor data here.",
].join("\n");

/**
 * What the Technical SEO agent is asked to produce from a crawl.
 *
 * The separation demanded first is the point of the task: an observation is
 * something the evidence states, an inference is the agent's reading of it,
 * and a recommendation is neither. A finding with no URL beside it cannot be
 * checked, so every one must carry the URL it came from.
 */
export const CRAWL_REVIEW_INSTRUCTIONS = [
  "Review the crawl evidence supplied with this task and report what it supports.",
  "Structure every finding as: OBSERVED (what the evidence literally states, with the exact URL or URLs it comes from), then INFERENCE (what you conclude from it, and how confident you are), then RECOMMENDATION (one concrete next step).",
  "Use only the supplied evidence. Every finding must cite at least one crawled URL.",
  "Where a reading is marked 'not established', say it is unknown and say what would establish it. Never treat it as a pass, a failure, a zero, or a no.",
  "URLs listed as discovered but not reached were NOT audited. You may say they exist and were not examined. Do not describe their contents, their health, or their issues.",
  "Do not state or estimate search volume, rankings, traffic, indexation status, or Core Web Vitals; none of it is in the evidence and none of it is knowable from a crawl.",
  "Do not describe the crawl as a full site audit or state site-wide totals. Say plainly that this covers only the pages listed.",
  "End with one line naming the single most useful thing to check or measure next.",
].join(" ");
