import "server-only";

import { assembleBriefInput } from "@/lib/briefs/assemble";
import type { OpportunityBriefInput } from "@/lib/briefs/brief";
import { crawlService } from "@/lib/crawl";
import { evidenceStore } from "@/lib/evidence";
import { unavailableOpportunityStore } from "@/lib/opportunities/store-contract";
import type { OpportunitiesDatabase } from "@/lib/opportunities/supabase/schema";
import { createSupabaseOpportunityStore } from "@/lib/opportunities/supabase/store";
import { selectProjectDataSource } from "@/lib/projects/data-source";
import { readLatestPagePairs } from "@/lib/search-console/query-pages";
import { serpService } from "@/lib/serp";
import { createSupabaseServerClient, readSupabaseServerConfig } from "@/lib/supabase/server";
import { unavailableTopicMapStore } from "@/lib/topic-maps/store-contract";
import type { TopicMapsDatabase } from "@/lib/topic-maps/supabase/schema";
import { createSupabaseTopicMapStore } from "@/lib/topic-maps/supabase/store";

/**
 * The `opportunity` grounding reader (M5): one accepted opportunity of the project and what the product holds for it.
 * The opportunity itself must be read (null otherwise: the attempt is refused); every other record is optional and a
 * failed or absent read is stated in the block as missing, never filled in.
 */

/** An optional record: a read that fails (a schema not set up included) is the record missing, stated as such. */
async function optional<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch {
    return fallback;
  }
}

export async function opportunityForBrief(projectId: string, opportunityId: string): Promise<OpportunityBriefInput | null> {
  const inSupabase = selectProjectDataSource(process.env) === "supabase";
  const config = inSupabase ? readSupabaseServerConfig(process.env) : null;
  const opportunities = config ? createSupabaseOpportunityStore(createSupabaseServerClient<OpportunitiesDatabase>(config)) : unavailableOpportunityStore;
  const maps = config ? createSupabaseTopicMapStore(createSupabaseServerClient<TopicMapsDatabase>(config)) : unavailableTopicMapStore;

  const opportunity = await opportunities.getAccepted(projectId, opportunityId);
  if (opportunity === null || opportunity.projectId !== projectId) return null;

  const [clusters, serp, admitted, pairs, overview] = await Promise.all([
    optional(() => maps.listClusters(opportunity.mapId), []),
    optional(async () => {
      const read = await serpService().read(projectId, opportunity.id);
      return read.status === "read" ? read.view.runs : [];
    }, []),
    optional(() => evidenceStore().admittedForOpportunity(projectId, opportunity.id), []),
    optional(async () => {
      const read = await readLatestPagePairs(projectId);
      return read !== null && read.available ? { startDate: read.startDate, endDate: read.endDate, rows: read.rows } : null;
    }, null),
    optional(async () => {
      const read = await crawlService().getLatestCrawlOverview(projectId);
      if (read.status !== "crawled") return null;
      return {
        crawlId: read.crawl.id,
        pages: read.pages.filter((page) => page.fetchState === "fetched").map((page) => ({ url: page.finalUrl ?? page.url, title: page.title, firstH1: page.firstH1 })),
      };
    }, null),
  ]);

  return assembleBriefInput({ opportunity, clusters, serpRuns: serp, admitted, pairs, crawl: overview });
}
