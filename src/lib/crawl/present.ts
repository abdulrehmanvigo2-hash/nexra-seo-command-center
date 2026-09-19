import { MAX_HTML_BYTES } from "@/lib/crawl/html";
import type {
  Crawl,
  CrawlFailureCode,
  CrawlLimit,
  CrawlPage,
  CrawlPageFailure,
  CrawlPageSkipReason,
  CrawlPageState,
  CrawlStatus,
  SignalState,
  StoredPageSignals,
  UrlRefusal,
} from "@/types/crawl";

/**
 * Wording for a crawl, and the arithmetic for showing one.
 *
 * Pure and browser-safe: it reads the record the server sent and nothing else.
 * Every failure is explained as what it is, and nothing here implies the pass
 * measured more than it did — discovery reads the list of pages a site says it
 * has, which is the start of a crawl and not an SEO audit.
 */

/** Plain statement of what a discovery pass does and does not establish. */
export const DISCOVERY_SCOPE_NOTE =
  "This records what each page answered — its status, where it ended up, its type and size. What was read out of each page is shown below it; nothing is scored, and there is no issue list or health score.";

export type CrawlTone = "neutral" | "accent" | "positive" | "warning" | "critical";

export const CRAWL_STATUS_META: Readonly<
  Record<CrawlStatus, { readonly label: string; readonly tone: CrawlTone }>
> = {
  queued: { label: "Queued", tone: "neutral" },
  discovering: { label: "Discovering pages", tone: "accent" },
  fetching: { label: "Fetching pages", tone: "accent" },
  completed: { label: "Discovery complete", tone: "positive" },
  failed: { label: "Discovery failed", tone: "critical" },
  cancelled: { label: "Cancelled", tone: "warning" },
};

/**
 * Why a crawl failed, in words an operator can act on.
 *
 * Fixed copy keyed by the stored code. The record never holds exception text —
 * an error message can quote a URL or a header — so this is the only place a
 * reason is turned into a sentence.
 */
export const CRAWL_FAILURE_COPY: Readonly<Record<CrawlFailureCode, string>> = {
  "robots-unavailable":
    "The site could not serve its robots.txt, so it has not stated whether it may be crawled. Nothing was read. Check the site is reachable and try again.",
  "site-refused":
    "This project's website is not an address the crawler will visit. Check the domain on the project's settings.",
  "no-sitemap": "No sitemap could be read for this site, so no pages were discovered.",
  "store-error": "The discovery pass could not be completed. Nothing partial was kept.",
  timeout: "The site did not answer in time. No pages were recorded from this pass.",
};

const LIMIT_COPY: Readonly<Record<CrawlLimit, string>> = {
  sitemaps: "more sitemap files than one pass reads",
  urls: "more URLs than one pass keeps",
  depth: "sitemap indexes nested deeper than one pass follows",
  pages: "more pages than one crawl fetches",
};

/**
 * Says that an inventory is a sample, when it is one.
 *
 * A pass that hit a limit read part of the site. Showing its count without
 * saying so would present a sample as a total, which is the same lie as an
 * invented metric.
 */
export function describeLimits(limits: readonly CrawlLimit[]): string | null {
  if (limits.length === 0) return null;
  const reasons = limits.map((limit) => LIMIT_COPY[limit]);
  const listed =
    reasons.length === 1
      ? reasons[0]
      : `${reasons.slice(0, -1).join(", ")} and ${reasons[reasons.length - 1]}`;
  return `This site has ${listed}, so the pages below are part of the site, not all of it.`;
}

/** Whether a crawl is still going, and the page should keep checking. */
export function isCrawlRunning(crawl: Crawl | null): boolean {
  return (
    crawl !== null &&
    (crawl.status === "queued" ||
      crawl.status === "discovering" ||
      crawl.status === "fetching")
  );
}

/** One line summarising where a crawl got to. */
export function describeCrawl(crawl: Crawl | null): string {
  if (crawl === null) {
    return "No crawl has run for this project yet.";
  }
  switch (crawl.status) {
    case "queued":
      return "Waiting to start.";
    case "discovering":
      return "Reading this site's robots.txt and sitemaps.";
    case "fetching":
      return `Fetching the ${crawl.pagesTotal.toLocaleString("en-GB")} pages this site lists. ${(
        crawl.pagesFetched + crawl.pagesFailed + crawl.pagesSkipped
      ).toLocaleString("en-GB")} done so far.`;
    case "completed":
      if (crawl.pagesTotal === 0) {
        return crawl.discoveredCount === 1
          ? "Found 1 page listed by this site."
          : `Found ${crawl.discoveredCount.toLocaleString("en-GB")} pages listed by this site.`;
      }
      return `Fetched ${crawl.pagesFetched.toLocaleString("en-GB")} of ${crawl.pagesTotal.toLocaleString("en-GB")} pages. The responses are recorded and their on-page signals read; nothing is scored.`;
    case "failed":
      return crawl.failureCode === null
        ? "The pass failed."
        : CRAWL_FAILURE_COPY[crawl.failureCode];
    case "cancelled":
      return "This pass was cancelled before it finished.";
  }
}

// ---------------------------------------------------------------------------
// On-page signals
// ---------------------------------------------------------------------------

/** What the signals panel is, and what it deliberately is not. */
export const SIGNALS_SCOPE_NOTE =
  "Read from each page's own HTML. These are observations, not judgements: nothing here is scored, weighted, or turned into a recommendation.";

export const SIGNAL_STATE_META: Readonly<
  Record<SignalState, { readonly label: string; readonly tone: CrawlTone; readonly note: string }>
> = {
  parsed: { label: "Parsed", tone: "positive", note: "HTML that was read." },
  "not-html": {
    label: "Not HTML",
    tone: "neutral",
    note: "A PDF, image or other file. There is nothing on-page to read, which is a fact about the page and not a failure.",
  },
  empty: { label: "Empty", tone: "warning", note: "The response had no body." },
  failed: {
    label: "Unreadable",
    tone: "critical",
    note: "The body could not be read as HTML.",
  },
};

/**
 * Counts over the signals of one crawl. Every field is arithmetic on stored
 * rows — nothing is estimated, and nothing is a score.
 */
export type SignalsSummary = {
  /** Pages that were fetched and read; one row per page. */
  readonly pages: number;
  readonly states: Readonly<Record<SignalState, number>>;
  /** Parsed pages carrying no non-blank `<title>`. */
  readonly missingTitle: number;
  /** Parsed pages whose title is shared with at least one other parsed page. */
  readonly duplicateTitlePages: number;
  /** How many distinct titles those pages share between them. */
  readonly duplicateTitles: number;
};

/** Titles compare trimmed and case-folded; a browser and a SERP show them alike. */
function titleKey(title: string): string {
  return title.trim().toLowerCase();
}

/**
 * Summarises one crawl's signals.
 *
 * Only parsed pages count toward the title observations. A PDF has no
 * `<title>` element to be missing, so counting it as a missing title would
 * report a fact about the file format as if it were a fault on the page.
 */
export function summariseSignals(signals: readonly StoredPageSignals[]): SignalsSummary {
  const states: Record<SignalState, number> = {
    parsed: 0,
    "not-html": 0,
    empty: 0,
    failed: 0,
  };
  let missingTitle = 0;
  const byTitle = new Map<string, number>();

  for (const page of signals) {
    states[page.state] += 1;
    if (page.state !== "parsed") continue;

    const title = page.title === null ? "" : page.title.trim();
    if (title.length === 0) {
      missingTitle += 1;
      continue;
    }
    const key = titleKey(title);
    byTitle.set(key, (byTitle.get(key) ?? 0) + 1);
  }

  let duplicateTitlePages = 0;
  let duplicateTitles = 0;
  for (const count of byTitle.values()) {
    if (count < 2) continue;
    duplicateTitles += 1;
    duplicateTitlePages += count;
  }

  return {
    pages: signals.length,
    states,
    missingTitle,
    duplicateTitlePages,
    duplicateTitles,
  };
}

/** The titles more than one parsed page carries, most-shared first. */
export function duplicateTitleGroups(
  signals: readonly StoredPageSignals[],
): readonly { readonly title: string; readonly pages: number }[] {
  const groups = new Map<string, { title: string; pages: number }>();
  for (const page of signals) {
    if (page.state !== "parsed" || page.title === null) continue;
    const title = page.title.trim();
    if (title.length === 0) continue;
    const existing = groups.get(titleKey(title));
    if (existing) existing.pages += 1;
    else groups.set(titleKey(title), { title, pages: 1 });
  }
  return [...groups.values()]
    .filter((group) => group.pages > 1)
    .sort((a, b) => b.pages - a.pages || a.title.localeCompare(b.title));
}

// ---------------------------------------------------------------------------
// Pages a crawl did not read
// ---------------------------------------------------------------------------

/**
 * Why a page produced no signals, in the words of the row that recorded it.
 *
 * The counters on a crawl say six of eight pages were fetched. They cannot say
 * which two were not, or why, and until this existed the only way to find out
 * was to read the database. Everything below is a label for a stored code —
 * nothing is inferred, scored, or turned into advice.
 */

export const PAGE_STATE_LABEL: Readonly<Record<CrawlPageState, string>> = {
  pending: "Queued",
  fetching: "In flight",
  fetched: "Fetched",
  failed: "Failed",
  refused: "Refused",
  skipped: "Skipped",
};

export const PAGE_STATE_TONE: Readonly<Record<CrawlPageState, CrawlTone>> = {
  pending: "neutral",
  fetching: "accent",
  fetched: "positive",
  failed: "critical",
  refused: "warning",
  skipped: "neutral",
};

const PAGE_FAILURE_COPY: Readonly<Record<CrawlPageFailure, string>> = {
  refused: "The URL policy refused it, so no request was made.",
  timeout: "No answer within the time allowed.",
  network: "The connection failed.",
  "too-many-redirects": "More redirects than the crawler follows.",
  "redirect-refused": "A redirect pointed somewhere the policy refuses.",
  "too-large": `The page is larger than the ${Math.round(MAX_HTML_BYTES / 1_000_000)} MB of HTML the crawler reads.`,
  "unsupported-type": "Not a content type this crawler reads.",
  "robots-disallowed": "robots.txt disallows this URL for our crawler.",
  "lease-expired": "The worker holding this page stopped before recording an answer.",
};

const REFUSAL_COPY: Readonly<Record<UrlRefusal, string>> = {
  scheme: "not http or https",
  credentials: "the URL carries a username or password",
  port: "a port other than the scheme's default",
  "ip-literal": "an IP address rather than a hostname",
  hostname: "not a public hostname",
  "too-long": "longer than the crawler stores",
  "private-address": "resolves to an internal address",
  dns: "the hostname does not resolve",
  "off-site": "not on this site",
};

const SKIP_COPY: Readonly<Record<CrawlPageSkipReason, string>> = {
  "robots-disallowed": "robots.txt disallows this URL for our crawler.",
  "page-limit": "The crawl reached its page limit before this URL.",
};

/**
 * One sentence for why a page was not read, from the codes already stored.
 *
 * A refusal refines a failure rather than replacing it — "refused" alone does
 * not say what was wrong with the URL — so both are shown when both exist.
 */
export function describePageOutcome(page: CrawlPage): string {
  if (page.skipReason !== null) return SKIP_COPY[page.skipReason];
  if (page.failure !== null) {
    const reason = PAGE_FAILURE_COPY[page.failure];
    return page.refusal === null ? reason : `${reason} (${REFUSAL_COPY[page.refusal]})`;
  }
  if (page.refusal !== null) return `Not requested: ${REFUSAL_COPY[page.refusal]}.`;
  if (page.httpStatus !== null) return `The site answered ${page.httpStatus}.`;
  if (page.state === "pending") return "Queued, not yet requested.";
  if (page.state === "fetching") return "Being requested now.";
  return "No reason was recorded.";
}
