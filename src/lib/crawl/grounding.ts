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
 * free text, because the task inputs it serves carry none: the only input a
 * crawl review or an on-page review takes is a crawl id.
 *
 * Two agents read the same block. The Technical SEO agent's `crawl-review`
 * and the On-Page SEO agent's `on-page-review` are given identical evidence
 * and differ only in what they are asked to make of it. One serialisation, one
 * ownership check, one byte ceiling: a second copy would drift from the first
 * exactly where the rules matter.
 */

import { isProjectSiteCrawl } from "@/lib/crawl/competitor-target";
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
    /** Pages left out because only `MAX_DESCRIBED_PAGES` are ever described. */
    readonly truncated: boolean;
    /** Pages left out because the byte ceiling was reached. A different fact. */
    readonly truncatedByBytes: boolean;
    /** Size of the evidence actually produced, in UTF-8 bytes. */
    readonly bytes: number;
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
  /**
   * The crawl is the project's, but of a competitor's site, not its own. The
   * project's own reviews describe "this crawl's recorded pages" as the
   * project's, so a rival's pages are never handed to them.
   */
  | "crawl-not-project-site"
  /** Still running: its readings are still arriving. */
  | "crawl-unfinished"
  /** It finished, but not in a state whose readings are worth reviewing. */
  | "crawl-not-reviewable";

/**
 * The crawl states whose readings may be reviewed.
 *
 * `completed` and `partial` are the two real results — a crawl that stopped on
 * its budget observed everything it reports. A `failed` or `cancelled` crawl
 * holds whatever rows happened to be written before it stopped: a fragment
 * nobody decided to keep, which is not the same as a short crawl.
 *
 * The panel refuses these states too, but the panel is not the gate. A run can
 * be queued by any operator posting to the API directly, and a crawl can fail
 * *after* its review was queued — so the check that matters is this one, made
 * against the persisted status at the moment the evidence is read.
 */
const REVIEWABLE_STATUSES: readonly Crawl["status"][] = ["completed", "partial"];

/**
 * How many pages are described in full.
 *
 * A crawl may hold 500. The prompt has to stay bounded, and a truncated
 * listing is stated as truncated so the agent cannot read it as the whole
 * crawl.
 */
export const MAX_DESCRIBED_PAGES = 50;

/**
 * The hard ceiling on the whole evidence block, in UTF-8 bytes.
 *
 * Characters would be the wrong unit. Every length limit the crawler applies —
 * a 1,000-character title, a 2,048-character URL — counts UTF-16 code units,
 * and a single one of those can weigh three or four bytes once encoded. A
 * page written in a non-Latin script therefore passes every per-field check
 * and still produces several times the payload a Latin page would. Counting
 * encoded bytes is the only measure that bounds what actually leaves this
 * process.
 *
 * 120 KB is roughly 30,000 tokens. A realistic fifty-page block runs about
 * 35 KB, so this leaves real crawls untouched while capping the worst case:
 * fifty pages of maximum-length URLs, titles and canonicals would otherwise
 * reach some 700 KB, and an operator may raise the page budget to 500.
 */
export const MAX_EVIDENCE_BYTES = 120_000;

/**
 * Room set aside for the notice that says what was left out.
 *
 * Reserved before any page is described, so website-controlled text can never
 * occupy the space the disclosure needs. The notice is counts and fixed
 * wording; this is many times its real size.
 */
const TRUNCATION_NOTICE_RESERVE = 1_024;

const encoder = new TextEncoder();

/** UTF-8 length, which is what the ceiling counts. */
export function byteLength(text: string): number {
  return encoder.encode(text).length;
}

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
 * id gets a refusal, not that client's site. The caller also supplies the
 * project's own domain, and a crawl the project made of a competitor's site
 * is refused next: these readers describe the project's own pages, and a
 * rival's pages under that description would be a lie.
 */
export async function readCrawlGrounding(
  reader: CrawlGroundingReader,
  request: { readonly crawlId: string; readonly projectId: string; readonly projectDomain: string },
): Promise<CrawlGroundingResult> {
  const eligible = await readReviewableCrawl(reader, request);
  if (!eligible.ok) return eligible;
  return { ok: true, grounding: formatCrawlGrounding(eligible.crawl, eligible.pages) };
}

export type ReviewableCrawlResult =
  | { readonly ok: true; readonly crawl: Crawl; readonly pages: readonly CrawlPage[] }
  | { readonly ok: false; readonly reason: CrawlGroundingRefusal };

/**
 * The checks every review of the project's own crawl makes, in order, before
 * a page is read: the crawl exists, is the run's project's, is of the
 * project's own site, and finished in a reviewable state. Callers that need
 * the rows themselves (the deterministic findings) read through this, so no
 * second path to a crawl's pages exists.
 */
export async function readReviewableCrawl(
  reader: CrawlGroundingReader,
  request: { readonly crawlId: string; readonly projectId: string; readonly projectDomain: string },
): Promise<ReviewableCrawlResult> {
  const detail = await reader.getCrawl(request.crawlId, MAX_DESCRIBED_PAGES * 4);
  if (detail === null) return { ok: false, reason: "crawl-not-found" };
  if (detail.crawl.projectId !== request.projectId) {
    return { ok: false, reason: "crawl-not-in-project" };
  }
  if (!isProjectSiteCrawl(detail.crawl, request.projectDomain)) {
    return { ok: false, reason: "crawl-not-project-site" };
  }
  // Checked before anything is formatted: a refusal must not carry a line of
  // the site's own text back with it.
  if (detail.crawl.status === "running") return { ok: false, reason: "crawl-unfinished" };
  if (!REVIEWABLE_STATUSES.includes(detail.crawl.status)) {
    return { ok: false, reason: "crawl-not-reviewable" };
  }
  return { ok: true, crawl: detail.crawl, pages: detail.pages };
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
    // The description and first h1 are quoted as JSON strings for the same
    // reason schema types are: they are the site's own words, and a bare line
    // of them could read as prose or instruction. Their lines are added beside
    // the counts that were always here, not folded into them, so what the
    // Technical SEO agent has been reading is unchanged.
    `  Meta description: ${page.metaDescription === null ? `${NOT_ESTABLISHED} (the page declares none)` : JSON.stringify(page.metaDescription)}`,
    `  Meta description length: ${num(page.metaDescriptionLength, "the page declares none")}`,
    `  H1 count: ${num(page.h1Count, "no h1 was read")}`,
    `  First h1: ${page.firstH1 === null ? `${NOT_ESTABLISHED} (no h1 was read)` : JSON.stringify(page.firstH1)}`,
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
          : `${page.schemaBlocks} JSON-LD block(s)${
              // Quoted as a JSON array: the values are written by the crawled
              // site, and a bare list of them could read as prose. The
              // extractor already flattens each one to a single bounded line.
              page.schemaTypes.length > 0 ? `, types: ${JSON.stringify(page.schemaTypes)}` : ""
            }`
    }`,
    `  Internal links out seen in THIS CRAWL: ${page.internalLinksOut}`,
    `  Internal links in seen in THIS CRAWL: ${page.internalLinksIn}`,
    `  Content type: ${page.contentType ?? NOT_ESTABLISHED}`,
    // M2 content signals, each added as its own line beside what was always
    // here. Every one is what the fetched markup carried: a word count over
    // the HTML as served is not a rendered page, and a response time is this
    // server's one fetch, not a user's experience and not a Core Web Vital.
    `  Visible word count (fetched HTML as served, not rendered): ${num(page.wordCount, "not recorded for this page")}`,
    `  Document language (html lang): ${page.htmlLang === null ? (page.wordCount === null ? `${NOT_ESTABLISHED} (not recorded for this page)` : "none declared") : page.htmlLang === "" ? "declared empty" : JSON.stringify(page.htmlLang)}`,
    `  hreflang alternate links: ${page.hreflangCount === null ? `${NOT_ESTABLISHED} (not recorded for this page)` : `${page.hreflangCount}${page.hreflangMalformed ? ` (${page.hreflangMalformed} with an empty or ill-formed hreflang or no href)` : ""}`}`,
    `  Open Graph: ${page.ogTagCount === null ? `${NOT_ESTABLISHED} (not recorded for this page)` : page.ogTagCount === 0 ? "no og: meta tags" : `${page.ogTagCount} og: meta tag(s)${page.ogTitle === null ? ", no og:title" : `, og:title ${JSON.stringify(page.ogTitle)}`}${page.ogImage === null ? ", no og:image" : ", og:image present"}`}`,
    `  Twitter card: ${page.twitterCard === null ? (page.ogTagCount === null ? `${NOT_ESTABLISHED} (not recorded for this page)` : "none declared") : JSON.stringify(page.twitterCard)}`,
    `  Response time of THIS SERVER'S fetch (final hop, one connection; not a user metric, not a Core Web Vital): ${page.responseMs === null ? `${NOT_ESTABLISHED} (no response recorded)` : `${page.responseMs} ms`}`,
  ].join("\n");
}

/**
 * How much of one crawl a block may hold.
 *
 * The defaults are the product's ceilings, and every existing reader uses
 * them unchanged. A reader that puts two crawls side by side in one prompt
 * hands in smaller ones, so each side is bounded on its own and the pair
 * stays within the same order of size as one block — the cap is stated in
 * the block's own omission notice, whatever it is.
 */
export type CrawlGroundingLimits = {
  readonly maxPages: number;
  readonly maxBytes: number;
};

const DEFAULT_LIMITS: CrawlGroundingLimits = { maxPages: MAX_DESCRIBED_PAGES, maxBytes: MAX_EVIDENCE_BYTES };

/** Serialises a finished crawl and its pages into the evidence block. */
export function formatCrawlGrounding(
  crawl: Crawl,
  pages: readonly CrawlPage[],
  limits: CrawlGroundingLimits = DEFAULT_LIMITS,
): CrawlGrounding {
  const groups = groupPages(pages);
  const capped = groups.fetched.slice(0, limits.maxPages);
  const truncated = groups.fetched.length > capped.length;

  /**
   * Fixed costs, taken out of the budget before any page is considered.
   *
   * The header says what the crawl was, the limits note says what it cannot
   * support, and the reserve holds the disclosure. All three are this
   * product's own words. Subtracting them first is what stops a page's own
   * text from crowding out the sentence that says pages were dropped.
   */
  const header = crawlHeader(crawl);
  const fixed = byteLength(header) + byteLength(LIMITS_NOTE) + TRUNCATION_NOTICE_RESERVE;
  let remaining = limits.maxBytes - fixed;

  /** Two newlines join every section; charge for them as sections are added. */
  const SEPARATOR_BYTES = 2;

  /** Adds `text` if its bytes fit, and reports whether it did. */
  const fits = (text: string): boolean => {
    const cost = byteLength(text) + SEPARATOR_BYTES;
    if (cost > remaining) return false;
    remaining -= cost;
    return true;
  };

  const described: CrawlPage[] = [];
  const pageBlocks: string[] = [];
  for (const page of capped) {
    const block = describePage(page);
    if (!fits(block)) break;
    described.push(page);
    pageBlocks.push(block);
  }
  // Pages the byte ceiling removed, as distinct from those the page cap did.
  const droppedForBytes = capped.length - described.length;

  const sections: string[] = [
    header,
    [
      `PAGES FETCHED AND READ (${groups.fetched.length}${
        described.length < groups.fetched.length ? `, ${described.length} described below` : ""
      })`,
      pageBlocks.join("\n"),
    ].join("\n"),
  ];

  /**
   * The other two lists compete for whatever is left, in the order they are
   * worth reading. Each is all-or-nothing: half a list of URLs with no count
   * beside it would be the silent drop this whole function exists to avoid.
   */
  let notFetchedOmitted = groups.notFetched.length;
  if (groups.notFetched.length > 0) {
    const block = [
      `URLS THAT RETURNED SOMETHING OTHER THAN A READ PAGE (${groups.notFetched.length})`,
      groups.notFetched
        .map(
          (page) =>
            `- ${page.url} — outcome: ${page.fetchState}${page.httpStatus === null ? "" : `, HTTP ${page.httpStatus}`}`,
        )
        .join("\n"),
    ].join("\n");
    if (fits(block)) {
      sections.push(block);
      notFetchedOmitted = 0;
    }
  }

  let notReachedOmitted = groups.notReached.length;
  if (groups.notReached.length > 0) {
    const block = [
      `URLS DISCOVERED BUT NOT REACHED — NOT AUDITED (${groups.notReached.length})`,
      "These were found and never fetched, because the crawl ran out of budget. Nothing is known about their contents. Do not describe them as healthy, as having no issues, or as audited.",
      groups.notReached.map((page) => `- ${page.url}`).join("\n"),
    ].join("\n");
    if (fits(block)) {
      sections.push(block);
      notReachedOmitted = 0;
    }
  }

  const notice = omissionNotice({
    pageCap: limits.maxPages,
    pageCapOmitted: groups.fetched.length - capped.length,
    byteOmitted: droppedForBytes,
    notFetchedOmitted,
    notReachedOmitted,
  });
  if (notice !== null) sections.push(notice);

  sections.push(LIMITS_NOTE);

  const text = sections.join("\n\n");
  return {
    text,
    summary: {
      crawlId: crawl.id,
      hostScope: crawl.hostScope,
      pagesFetched: groups.fetched.length,
      pagesNotReached: groups.notReached.length,
      pagesIncluded: described.length,
      truncated,
      truncatedByBytes: droppedForBytes > 0 || notFetchedOmitted > 0 || notReachedOmitted > 0,
      bytes: byteLength(text),
    },
  };
}

/**
 * What was left out, and why — or null when nothing was.
 *
 * Kept as one paragraph so the model reads the omissions together rather than
 * meeting them one section at a time. The two causes are named separately: a
 * page cap is a decision this product made about every crawl, and a byte
 * ceiling is one it made about this one.
 */
function omissionNotice(omitted: {
  /** The page cap this block was formatted under, so the notice states the true one. */
  readonly pageCap: number;
  readonly pageCapOmitted: number;
  readonly byteOmitted: number;
  readonly notFetchedOmitted: number;
  readonly notReachedOmitted: number;
}): string | null {
  const lines: string[] = [];

  if (omitted.pageCapOmitted > 0) {
    lines.push(
      `- ${omitted.pageCapOmitted} fetched page(s) are not described: only the first ${omitted.pageCap} ever are.`,
    );
  }
  if (omitted.byteOmitted > 0) {
    lines.push(
      `- ${omitted.byteOmitted} further fetched page(s) are not described: the evidence reached its size limit.`,
    );
  }
  if (omitted.notFetchedOmitted > 0) {
    lines.push(
      `- The list of ${omitted.notFetchedOmitted} URL(s) that returned something other than a read page was omitted for size. They exist and were not examined here.`,
    );
  }
  if (omitted.notReachedOmitted > 0) {
    lines.push(
      `- The list of ${omitted.notReachedOmitted} URL(s) discovered but never fetched was omitted for size. They exist, were never fetched, and were not audited.`,
    );
  }
  if (lines.length === 0) return null;

  return [
    "OMITTED FROM THIS EVIDENCE",
    ...lines,
    "This listing is therefore incomplete. Do not describe it as the whole crawl, and do not treat anything omitted as absent, healthy, or free of issues.",
  ].join("\n");
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
  "- There are no Core Web Vitals here. Field vitals come from real user measurement; no timing in this crawl describes anyone's experience of the page. A response time above is this server's one fetch of the final hop, from one place at one moment.",
  "- A visible word count is over the HTML as served: it does not describe a rendered page, its quality, or its content depth. Language, hreflang, Open Graph and Twitter card readings are what the page's head declared, nothing more.",
  "- There is no search volume, ranking, traffic or competitor data here.",
].join("\n");

/**
 * What the Technical SEO agent is asked to produce from a crawl.
 *
 * The separation demanded first is the point of the task: an observation is
 * something the evidence states, an inference is the agent's reading of it,
 * and a recommendation is neither. A finding with no URL beside it cannot be
 * checked, so every one must carry the URL it came from.
 *
 * The bound is structural (checkpoint 2.3d). A character cap alone did not
 * hold the model (checkpoint 2.3c, PR #29): bounded answers over crawl
 * `3398ff1a…` ran to 1,926 characters and one, `98e56366…`, was refused as
 * `rejected-output` at the worker's 2,000-character ceiling. The shape copies
 * the fixes that did hold for the Project Director review
 * (`PROJECT_PRIORITY_REVIEW_INSTRUCTIONS`, `director-bundle.ts`: at most three
 * items with a word cap each, the whole under 1,200 characters, what to drop
 * first) and the intake review (`INTAKE_REVIEW_INSTRUCTIONS`,
 * `projects/grounding.ts`: fixed sections in a fixed order, each with its own
 * cap): one COVERAGE line, at most three findings of three capped lines each,
 * one NEXT line. At every cap an answer with ordinary words stays near 1,200
 * characters and one with long URLs under the 2,000 ceiling. The evidence,
 * safety and findings-block sentences are the earlier ones, unchanged.
 */
export const CRAWL_REVIEW_INSTRUCTIONS = [
  "Review the crawl evidence supplied with this task and report what it supports.",
  "Answer in this fixed order and no other: one COVERAGE line, then the findings, then one NEXT line.",
  "COVERAGE: one line, under 25 words, stating the pages fetched and, where a findings block is supplied, the link edges read and anything cut. Never drop it.",
  "Then give at most three findings, fewer where the evidence supports fewer, most severe first and recorded findings before your own observations. Structure every finding as three lines: OBSERVED (under 20 words: what the evidence literally states, with the exact URL or URLs it comes from), then INFERENCE (under 12 words: what you conclude from it, and how confident you are), then RECOMMENDATION (under 15 words: one concrete next step).",
  "Use only the supplied evidence. Every finding must cite at least one crawled URL.",
  "Where a reading is marked 'not established', say it is unknown and say what would establish it. Never treat it as a pass, a failure, a zero, or a no.",
  "URLs listed as discovered but not reached were NOT audited. You may say they exist and were not examined. Do not describe their contents, their health, or their issues.",
  "Do not state or estimate search volume, rankings, traffic, indexation status, or Core Web Vitals; none of it is in the evidence and none of it is knowable from a crawl.",
  "Do not describe the crawl as a full site audit or state site-wide totals. Say plainly that this covers only the pages listed.",
  "Where a DETERMINISTIC CRAWL FINDINGS block follows the crawl evidence, each finding there is an observation by a fixed rule over the pages this crawl recorded: cite it by its rule id in square brackets and the exact URL or URLs it names, treat it as OBSERVED, and keep your own reading and next step as INFERENCE and RECOMMENDATION. State the coverage that block gives (pages fetched, link edges read, anything cut) and never extend a finding to pages it does not name, to indexation, rankings, Core Web Vitals, external links or site-wide totals. If the block says findings are unavailable or no rule fired, say so and infer nothing in their place.",
  "NEXT: end with one line, under 15 words, naming the single most useful thing to check or measure next.",
  "Keep the whole answer under 1,200 characters. If it would exceed that, drop the lowest-severity finding first, entirely, then shorten INFERENCE; never drop the COVERAGE line or a finding's cited URL to fit.",
].join(" ");

/**
 * What the On-Page SEO agent is asked to produce from the same crawl.
 *
 * Same evidence, same OBSERVED / INFERENCE / RECOMMENDATION discipline, a
 * different question: not whether the pages can be crawled, but whether each
 * one says what it is about. The agent is told twice that it cannot change a
 * page — once here and once by the executor — because "rewrite the title" is
 * the natural shape of its advice, and advice is all it may be.
 */
export const ON_PAGE_REVIEW_INSTRUCTIONS = [
  "Review the on-page elements of the crawled pages supplied with this task: title and its length, meta description and its length, h1 count and the first h1, the canonical declaration, structured-data types, internal links in and out as counted within this crawl, crawl depth, sitemap presence, and — where recorded — the document language, hreflang alternates, Open Graph and Twitter card declarations, and the visible word count of the HTML as served (a count, not a judgement of quality or depth).",
  "Structure every finding as: OBSERVED (what the evidence literally states, with the exact URL or URLs it comes from), then INFERENCE (what you conclude from it, and how confident you are), then RECOMMENDATION (one concrete change for a person to make).",
  "Use only the supplied evidence. Every finding must cite at least one crawled URL. Only the pages listed as fetched and read were examined; do not describe any other page.",
  "Where a reading is marked 'not established', say it is unknown and say what would establish it. Never treat it as a pass, a failure, a zero, or a no.",
  "URLs listed as discovered but not reached were NOT audited. You may say they exist and were not examined. Do not describe their titles, headings, or issues.",
  "You cannot edit, publish, or change any page. Every recommendation is a proposed change for an operator to review and apply; do not describe it as done.",
  "Do not state or estimate search volume, rankings, click-through, traffic, indexation status, or Core Web Vitals; none of it is in the evidence.",
  "Do not describe this as a site-wide review or state site-wide totals. Say plainly that this covers only the pages listed. Internal link counts are within this crawl only and cannot show that a page is orphaned.",
  "Where a DETERMINISTIC CRAWL FINDINGS block follows the crawl evidence, each finding there is an observation by a fixed rule over the pages this crawl recorded: cite it by its rule id in square brackets and the exact URL or URLs it names, treat it as OBSERVED, and keep your proposed change as RECOMMENDATION. State the coverage that block gives (pages fetched, link edges read, anything cut) and never extend a finding to pages it does not name, to indexation, rankings, click-through, Core Web Vitals, external links or site-wide totals. If the block says findings are unavailable or no rule fired, say so and infer nothing in their place.",
  "OUTPUT BOUND: give at most 4 findings and keep the whole answer, including the coverage statement and the closing line, under 1,500 characters. Choose the observed issues the evidence supports most strongly, highest confidence first; cite the rule id in square brackets and the exact URL wherever the evidence gives them; keep each finding's OBSERVED, INFERENCE and RECOMMENDATION separate and short; and omit lower-priority findings entirely rather than exceed the bound. Never drop the coverage statement to make room.",
  "End with one line naming the single page whose on-page elements most need attention, and why.",
].join(" ");

/**
 * What the AI Visibility agent is asked to produce from the same crawl.
 *
 * Same evidence, same OBSERVED / INFERENCE / RECOMMENDATION discipline, a
 * third question: whether each page, as recorded, is shaped so that an
 * answer engine could retrieve and cite it. The crawl carries exactly enough
 * to ask that — structured data and its types, the h1, the title, the
 * description, the canonical, the robots directive — and nothing about what
 * any engine actually does with the page. The list of what is *not*
 * established is therefore longer than for the other two reviews, and the
 * instructions name each item, because "readiness" is one careless word
 * away from "visibility", and only the first is in the evidence.
 */
export const ANSWER_READINESS_REVIEW_INSTRUCTIONS = [
  "Review the crawled pages supplied with this task for answer-engine readiness, using only what the crawl recorded per page: whether structured data is present and which JSON-LD types it declares, the h1 count and the first h1, the title, the meta description, the canonical declaration, and the robots meta directive.",
  "Readiness means only: a single clear h1 stating what the page answers; a title and description stating the same; a canonical that points at the page itself; a robots directive that does not forbid indexing; structured data whose types match the page.",
  "Give at most three findings, each about one page, and cover no more than three pages; say in one line that other fetched pages were not covered. Structure each as OBSERVED (what the evidence states, with the exact URL), then INFERENCE (what it means for the page being retrieved and cited, and your confidence), then RECOMMENDATION (one concrete change to the page's declarations for a person to make). Keep each finding under 50 words and the whole answer under 1,500 characters.",
  "Use only the supplied evidence; every finding must cite at least one crawled URL. Only the pages listed as fetched and read were examined. A reading marked 'not established' is unknown. Never treat it as a pass, a failure, a zero, or a no. URLs discovered but not reached were NOT audited: do not describe them.",
  "NOT established by this evidence and must not be claimed, estimated, or implied: AI crawler access rules (the robots.txt reading applies to this product's own crawler, not to any AI crawler); AI citations; mention share; answer-engine visibility; page body text quality; entity coverage; semantic completeness; and how often any model or engine retrieves the page. Do not explain these inside findings; the closing line covers them.",
  "Do not state or estimate search volume, rankings, click-through, traffic, indexation status, or Core Web Vitals. You cannot edit, publish, or change any page; recommendations are proposals for an operator. Do not describe this as a site-wide review.",
  "End with two short lines: the single page whose declarations most limit its readiness, and why; then exactly this sentence: Not established by this crawl: AI crawler access, citations, mention share, answer-engine visibility, body text, entity coverage.",
].join(" ");
