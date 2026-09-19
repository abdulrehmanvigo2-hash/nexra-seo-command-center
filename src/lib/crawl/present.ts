import type { Crawl, CrawlFailureCode, CrawlLimit, CrawlStatus } from "@/types/crawl";

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
  "This records what each page answered — its status, where it ended up, its type and size. Nothing has been read out of the responses yet, so there is still no title, heading, issue or health score.";

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
      return `Fetched ${crawl.pagesFetched.toLocaleString("en-GB")} of ${crawl.pagesTotal.toLocaleString("en-GB")} pages. The responses are recorded; nothing has been analysed yet.`;
    case "failed":
      return crawl.failureCode === null
        ? "The pass failed."
        : CRAWL_FAILURE_COPY[crawl.failureCode];
    case "cancelled":
      return "This pass was cancelled before it finished.";
  }
}
