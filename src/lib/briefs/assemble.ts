import type { AdmittedUnit } from "@/lib/evidence/admitted";
import type { AdmittedClaim, OpportunityBriefInput } from "@/lib/briefs/brief";
import type { AcceptedOpportunity } from "@/lib/opportunities/contract";
import type { SerpRunView } from "@/lib/serp/contract";
import type { TopicCluster } from "@/lib/topic-maps/contract";
import type { SearchQueryPageRow } from "@/types/search-console";

/**
 * Putting one opportunity's records together for the brief (M5). Pure: the runtime reads each record and hands it
 * here; what is missing stays missing. Search Console rows are kept only for the cluster's keywords (exact, case
 * ignored) or the existing page; the SERP is the newest completed run; admitted units are labelled E1 upward in
 * decision order, as checker v4 labels them.
 */

export const MAX_SC_ROWS = 20;
export const MAX_SITE_PATHS = 60;

function pathOf(url: string): string {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
}

export function assembleBriefInput(parts: {
  readonly opportunity: AcceptedOpportunity;
  readonly clusters: readonly TopicCluster[];
  readonly serpRuns: readonly SerpRunView[];
  readonly admitted: readonly AdmittedUnit[];
  readonly pairs: { readonly startDate: string; readonly endDate: string; readonly rows: readonly SearchQueryPageRow[] } | null;
  readonly crawl: { readonly crawlId: string; readonly pages: readonly { readonly url: string; readonly title: string | null; readonly firstH1: string | null }[] } | null;
}): OpportunityBriefInput {
  const { opportunity } = parts;
  const cluster = parts.clusters.find((candidate) => candidate.id === opportunity.clusterId) ?? null;
  const latest = parts.serpRuns.find((view) => view.run.status === "completed" && view.run.opportunityId === opportunity.id) ?? null;
  const ordered = [...parts.admitted].sort((a, b) => a.decidedAt.localeCompare(b.decidedAt) || a.id.localeCompare(b.id));
  const admitted: AdmittedClaim[] = ordered.map((unit, index) => ({ label: `E${index + 1}`, claim: unit.claim, quote: unit.quote, url: unit.url, retrievedAt: unit.fetchedAt, pageTitle: unit.pageTitle ?? null }));
  const keywords = new Set((cluster?.keywords ?? []).filter((k) => k.role !== "excluded").map((k) => k.keyword.toLowerCase()));
  if (cluster !== null) keywords.add(cluster.primaryKeyword.toLowerCase());
  const existing = cluster?.existingPage ?? null;
  const rows = parts.pairs === null ? [] : parts.pairs.rows.filter((row) => keywords.has(row.query.toLowerCase()) || (existing !== null && pathOf(row.page) === existing)).slice(0, MAX_SC_ROWS);
  const site =
    parts.crawl === null
      ? null
      : {
          crawlId: parts.crawl.crawlId,
          paths: [...new Set(parts.crawl.pages.map((page) => pathOf(page.url)))].sort().slice(0, MAX_SITE_PATHS),
          existing: (() => {
            if (existing === null) return null;
            const page = parts.crawl.pages.find((candidate) => pathOf(candidate.url) === existing);
            return page === undefined ? null : { path: existing, title: page.title, firstH1: page.firstH1 };
          })(),
        };
  return {
    opportunity,
    cluster,
    serp: latest === null ? null : { fetchedAt: latest.run.createdAt, mode: latest.run.mode, results: latest.results },
    admitted,
    searchConsole: parts.pairs === null ? null : { startDate: parts.pairs.startDate, endDate: parts.pairs.endDate, rows },
    site,
  };
}
