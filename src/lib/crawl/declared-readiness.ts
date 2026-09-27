/**
 * The AI Visibility screen over stored crawls (Phase 4, checkpoint 4.5,
 * decision Q5).
 *
 * One row per page the project's latest own-site crawl fetched, holding the
 * fields the answer-readiness review already reads (`formatCrawlGrounding`):
 * the h1 count and first h1, the title, the meta description, whether the
 * canonical points at the page itself, whether the page or its headers say
 * noindex, the structured-data types and whether a block failed to parse,
 * and the word count as served. Every value is what the page declared to
 * this product's crawler; nothing here says whether any AI engine reads,
 * cites or mentions the page, and AI crawler access is not shown at all
 * (Q5: the crawler records only its own user agent). A null is unknown,
 * never a pass or a no. Pure and client-safe; it reads the latest-overview
 * route's answer.
 */

import { coverageBanner } from "@/lib/crawl/overview/present";
import type { CrawlOverview } from "@/lib/crawl/overview/contract";
import { groupPages, pathOf } from "@/lib/crawl/pages-view";

export const READINESS_LABEL = "What each page declared, as crawled — not whether any AI engine cites it";
export const WORD_COUNT_NOTE = "Word count as served: the words in the HTML the crawler received, before any script ran.";

export type ReadinessRow = {
  readonly url: string;
  readonly path: string;
  /** Null when the crawler did not establish it. */
  readonly h1Count: number | null;
  readonly firstH1: string | null;
  readonly title: string | null;
  readonly metaDescription: string | null;
  /** Null when the page declares no canonical at all. */
  readonly canonicalIsSelf: boolean | null;
  readonly robotsNoindex: boolean | null;
  readonly schemaTypes: readonly string[];
  readonly schemaParseFailed: boolean;
  readonly wordCount: number | null;
};

export type ReadinessView =
  | { readonly status: "none" | "unavailable" }
  | {
      readonly status: "crawled";
      readonly banner: string;
      /** Fetched pages only; a page not reached or not read declared nothing. */
      readonly rows: readonly ReadinessRow[];
      /** Pages discovered but not fetched, counted, never shown as rows. */
      readonly notFetched: number;
    };

export function presentReadiness(overview: CrawlOverview): ReadinessView {
  if (overview.status !== "crawled") return { status: overview.status };
  const groups = groupPages(overview.pages);
  const rows = groups.fetched
    .map((page) => ({
      url: page.url,
      path: pathOf(page.url),
      h1Count: page.h1Count,
      firstH1: page.firstH1,
      title: page.title,
      metaDescription: page.metaDescription,
      canonicalIsSelf: page.canonicalIsSelf,
      robotsNoindex: page.robotsNoindex,
      schemaTypes: [...page.schemaTypes],
      schemaParseFailed: page.schemaParseFailed,
      wordCount: page.wordCount,
    }))
    .sort((a, b) => a.url.localeCompare(b.url));
  return {
    status: "crawled",
    banner: coverageBanner(overview.crawl, overview.pages, overview.links),
    rows,
    notFetched: groups.notReached.length + groups.notFetched.length,
  };
}

/** A three-way reading as the table shows it: a null is "not established", never a no. */
export function yesNoUnknown(value: boolean | null, yes: string, no: string): string {
  return value === null ? "not established" : value ? yes : no;
}
