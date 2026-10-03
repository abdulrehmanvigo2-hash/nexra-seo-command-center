import "server-only";

import { crawlService } from "@/lib/crawl";
import { createOpportunityService, type OpportunityService } from "@/lib/opportunities/service";
import { unavailableOpportunityStore } from "@/lib/opportunities/store-contract";
import type { OpportunitiesDatabase } from "@/lib/opportunities/supabase/schema";
import { createSupabaseOpportunityStore } from "@/lib/opportunities/supabase/store";
import { selectProjectDataSource } from "@/lib/projects/data-source";
import { readLatestPagePairs } from "@/lib/search-console/query-pages";
import { appRateLimiter } from "@/lib/security/app-rate-limit";
import type { AsyncRateLimiter } from "@/lib/security/shared-rate-limit";
import { createSupabaseServerClient, readSupabaseServerConfig } from "@/lib/supabase/server";
import { unavailableTopicMapStore } from "@/lib/topic-maps/store-contract";
import type { TopicMapsDatabase } from "@/lib/topic-maps/supabase/schema";
import { createSupabaseTopicMapStore } from "@/lib/topic-maps/supabase/store";

/**
 * The server's opportunity service — the one place that wires it. With `PROJECTS_DATA_SOURCE=supabase` the accepted
 * opportunities live in `nexra_opportunities` (migration 20261021120000; a database without it answers "not set up"),
 * the approved map comes from the topic-map tables (M1), the latest query × page window from the stored Search Console
 * rows and the findings from the crawl store; with the fixture roster there is nowhere to keep one. No agent reads
 * these records in M2.
 */

/** A stored read that failed: the section says the read failed rather than scoring as if nothing were stored. */
export class OpportunityReadError extends Error {
  constructor(what: string) {
    super(`Opportunities: the ${what} could not be read.`);
    this.name = "OpportunityReadError";
  }
}

let service: OpportunityService | null = null;

export function opportunityService(): OpportunityService {
  if (service !== null) return service;
  const inSupabase = selectProjectDataSource(process.env) === "supabase";
  const config = inSupabase ? readSupabaseServerConfig(process.env) : null;
  const store = config ? createSupabaseOpportunityStore(createSupabaseServerClient<OpportunitiesDatabase>(config)) : unavailableOpportunityStore;
  const maps = config ? createSupabaseTopicMapStore(createSupabaseServerClient<TopicMapsDatabase>(config)) : unavailableTopicMapStore;

  service = createOpportunityService(store, {
    async approvedMap(projectId) {
      const map = await maps.getMap(projectId, "approved");
      if (map === null) return null;
      return { map, clusters: await maps.listClusters(map.id) };
    },
    async pairs(projectId) {
      const latest = await readLatestPagePairs(projectId);
      if (latest === null || !latest.available) {
        if (latest !== null && !latest.available && latest.reason === "read-failed") throw new OpportunityReadError("Search Console window");
        return null;
      }
      return { endDate: latest.endDate, rows: latest.rows.map((row) => ({ query: row.query, page: row.page, clicks: row.clicks, impressions: row.impressions, position: row.position })) };
    },
    async findings(projectId) {
      const read = await crawlService().getLatestCrawlFindings(projectId);
      if (read.status !== "recorded") return null;
      return { crawlId: read.crawl.id, rows: read.report.findings.map((finding) => ({ key: finding.id, rule: finding.rule, severity: finding.severity, urls: finding.urls })) };
    },
  });
  return service;
}

type LimitName = "read" | "write";

/** Accepting is a deliberate act: thirty per operator per ten minutes; reads as the other operator reads. */
const LIMITS: Record<LimitName, { readonly limit: number; readonly windowSeconds: number }> = {
  read: { limit: 120, windowSeconds: 600 },
  write: { limit: 30, windowSeconds: 600 },
};

export function opportunityLimiter(name: LimitName): AsyncRateLimiter {
  return appRateLimiter(`opportunities.${name}`, LIMITS[name]);
}
