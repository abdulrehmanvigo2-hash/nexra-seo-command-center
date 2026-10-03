import "server-only";

import { unavailableArticleProposalStore } from "@/lib/content/articles/proposals/contract";
import type { ArticleProposalsDatabase } from "@/lib/content/articles/proposals/supabase/schema";
import { createSupabaseArticleProposalStore } from "@/lib/content/articles/proposals/supabase/store";
import { destinationsForProject } from "@/lib/content/publications/destinations";
import { crawlService } from "@/lib/crawl";
import { METRIC_READ_LIMIT, RUN_READ_LIMIT } from "@/lib/keyword-snapshots/contract";
import { unavailableSnapshotStore } from "@/lib/keyword-snapshots/store-contract";
import type { SnapshotsDatabase } from "@/lib/keyword-snapshots/supabase/schema";
import { createSupabaseSnapshotStore } from "@/lib/keyword-snapshots/supabase/store";
import { selectProjectDataSource } from "@/lib/projects/data-source";
import { appRateLimiter } from "@/lib/security/app-rate-limit";
import type { AsyncRateLimiter } from "@/lib/security/shared-rate-limit";
import { createSupabaseServerClient, readSupabaseServerConfig } from "@/lib/supabase/server";
import { createTopicMapService, type TopicMapService } from "@/lib/topic-maps/service";
import { unavailableTopicMapStore } from "@/lib/topic-maps/store-contract";
import type { TopicMapsDatabase } from "@/lib/topic-maps/supabase/schema";
import { createSupabaseTopicMapStore } from "@/lib/topic-maps/supabase/store";

/**
 * The server's topic-map service — the one place that wires it. With
 * `PROJECTS_DATA_SOURCE=supabase` the maps live in the three topic-map
 * tables (migration 20261019120000; a database without them answers "not
 * set up"), the rows come from the F0 provider tables, the live articles
 * from the records (F9) and the crawl pages from the crawl store; with the
 * fixture roster there is nowhere to keep a map. No agent reads these
 * records in M1.
 */

let service: TopicMapService | null = null;

export function topicMapService(): TopicMapService {
  if (service !== null) return service;
  const inSupabase = selectProjectDataSource(process.env) === "supabase";
  const config = inSupabase ? readSupabaseServerConfig(process.env) : null;
  const snapshots = config ? createSupabaseSnapshotStore(createSupabaseServerClient<SnapshotsDatabase>(config)) : unavailableSnapshotStore;
  const proposals = config ? createSupabaseArticleProposalStore(createSupabaseServerClient<ArticleProposalsDatabase>(config)) : unavailableArticleProposalStore;
  const store = config ? createSupabaseTopicMapStore(createSupabaseServerClient<TopicMapsDatabase>(config)) : unavailableTopicMapStore;

  service = createTopicMapService(store, {
    async source(projectId) {
      if (!snapshots.storesSnapshots) return null;
      const runs = await snapshots.listRuns(projectId, RUN_READ_LIMIT);
      const run = runs.find((candidate) => candidate.projectId === projectId && candidate.status === "completed" && candidate.mode === "live") ?? null;
      if (run === null) return null;
      const metrics = (await snapshots.listMetrics(run.id, METRIC_READ_LIMIT)).filter((metric) => metric.projectId === projectId);
      return { run, metrics };
    },
    async liveArticles(projectId) {
      const destination = destinationsForProject(projectId)[0]?.key;
      if (destination === undefined) return [];
      try {
        return await proposals.listLiveArticles(destination);
      } catch {
        return null;
      }
    },
    async crawl(projectId) {
      const overview = await crawlService().getLatestCrawlOverview(projectId);
      if (overview.status !== "crawled") return null;
      return {
        crawlId: overview.crawl.id,
        pages: overview.pages.filter((page) => page.fetchState === "fetched").map((page) => ({ url: page.finalUrl ?? page.url, title: page.title, firstH1: page.firstH1 })),
      };
    },
  });
  return service;
}

type LimitName = "read" | "write";

/** A build or approval is a deliberate act: thirty per operator per ten minutes; reads as the other operator reads. */
const LIMITS: Record<LimitName, { readonly limit: number; readonly windowSeconds: number }> = {
  read: { limit: 120, windowSeconds: 600 },
  write: { limit: 30, windowSeconds: 600 },
};

export function topicMapLimiter(name: LimitName): AsyncRateLimiter {
  return appRateLimiter(`topic-maps.${name}`, LIMITS[name]);
}
