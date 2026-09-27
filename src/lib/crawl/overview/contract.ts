/**
 * The live Technical SEO screen's one read (Phase 3, checkpoint 3.2): the
 * project's latest own-site crawl, the pages it recorded, a summary of the
 * link edges it recorded, and the findings recorded for it at the current
 * rule version.
 *
 * Everything here is what this product's own crawler observed, recorded
 * when the crawl finished. Nothing is fetched to answer it, nothing is
 * estimated, and a crawl the store does not hold is `none`, never an empty
 * crawl that could read as a clean site.
 */

import { FINDINGS_RULE_VERSION } from "@/lib/crawl/findings/contract";
import type { StoredCrawlFindingsReport } from "@/lib/crawl/findings/store-contract";
import type { Crawl, CrawlLink, CrawlPage } from "@/types/crawl";

/** The most pages one overview carries: the crawler's own page budget ceiling. */
export const OVERVIEW_PAGE_LIMIT = 500;
/** The most link edges read to summarise: enough for a full-budget crawl. */
export const OVERVIEW_LINK_LIMIT = 5_000;
/** The most external hosts listed by name; the rest are counted. */
export const OVERVIEW_EXTERNAL_HOST_LIMIT = 20;

/** What the recorded link edges add up to. Counts only: no edge list leaves the server. */
export type CrawlLinkSummary = {
  /** Edges read, at most `OVERVIEW_LINK_LIMIT`. */
  readonly read: number;
  /** Whether the read reached its bound, so the counts may be short. */
  readonly cut: boolean;
  readonly internal: number;
  readonly external: number;
  /** Edges whose `rel` carries `nofollow`. */
  readonly nofollow: number;
  /** External hosts by edge count, largest first, at most `OVERVIEW_EXTERNAL_HOST_LIMIT`. */
  readonly externalHosts: readonly { readonly host: string; readonly edges: number }[];
  /** External hosts not listed above. */
  readonly moreExternalHosts: number;
};

/** The findings side of the overview. */
export type OverviewReport =
  | { readonly status: "recorded"; readonly report: StoredCrawlFindingsReport }
  /** The crawl is the project's and no report was recorded for it (still running, failed, or older than recorded findings). */
  | { readonly status: "not-recorded" }
  /** A report exists, but under an earlier rule version than the one this screen presents. */
  | { readonly status: "other-rules"; readonly ruleVersion: number };

export type CrawlOverview =
  /** The crawl store is not configured on this deployment. */
  | { readonly status: "unavailable" }
  /** The project has no own-site crawl recorded. */
  | { readonly status: "none" }
  | {
      readonly status: "crawled";
      readonly crawl: Crawl;
      readonly pages: readonly CrawlPage[];
      /** Whether the page read reached `OVERVIEW_PAGE_LIMIT`. */
      readonly pagesCut: boolean;
      readonly links: CrawlLinkSummary;
      readonly report: OverviewReport;
    };

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Summarises recorded edges into counts. Pure. */
export function summarizeLinks(links: readonly CrawlLink[], limit: number = OVERVIEW_LINK_LIMIT): CrawlLinkSummary {
  let internal = 0;
  let external = 0;
  let nofollow = 0;
  const hosts = new Map<string, number>();
  for (const link of links) {
    if (link.isInternal) internal += 1;
    else {
      external += 1;
      const host = hostOf(link.toUrl);
      if (host !== null) hosts.set(host, (hosts.get(host) ?? 0) + 1);
    }
    if (link.rel !== null && /(^|\s)nofollow(\s|$)/i.test(link.rel)) nofollow += 1;
  }
  const ranked = [...hosts.entries()]
    .map(([host, edges]) => ({ host, edges }))
    .sort((a, b) => b.edges - a.edges || (a.host < b.host ? -1 : a.host > b.host ? 1 : 0));
  return {
    read: links.length,
    cut: links.length >= limit,
    internal,
    external,
    nofollow,
    externalHosts: ranked.slice(0, OVERVIEW_EXTERNAL_HOST_LIMIT),
    moreExternalHosts: Math.max(0, ranked.length - OVERVIEW_EXTERNAL_HOST_LIMIT),
  };
}

/** Which report the overview presents: the current rule version only. Pure. */
export function overviewReport(report: StoredCrawlFindingsReport | null): OverviewReport {
  if (report === null) return { status: "not-recorded" };
  if (report.header.ruleVersion !== FINDINGS_RULE_VERSION) return { status: "other-rules", ruleVersion: report.header.ruleVersion };
  return { status: "recorded", report };
}

/** The one query parameter the route accepts: the same project-id shape the findings read checks. */
export { latestFindingsReadRequest as overviewReadRequest } from "@/lib/crawl/findings/triage/request";

export function overviewUrl(projectId: string): string {
  return `/api/crawls/latest-overview?${new URLSearchParams({ project: projectId }).toString()}`;
}

/** A failed read, worded as a failed read — never as a site with no crawl. */
export function overviewReadFailure(status: number): string {
  if (status === 401) return "Your session has ended. Sign in again to read this project's crawl.";
  if (status === 404) return "This project is not stored, so it has no crawl to read.";
  if (status === 429) return "Too many reads in a short time. Wait a moment and reload.";
  return "The crawl records could not be read just now. Nothing is shown in their place; reload to try again.";
}
