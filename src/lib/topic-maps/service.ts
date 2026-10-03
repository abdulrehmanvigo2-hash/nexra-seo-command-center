import type { LiveArticle } from "@/lib/content/articles/proposals/live-slugs";
import type { KeywordMetric, ProviderRun } from "@/lib/keyword-snapshots/contract";
import { buildTopicMap, recordPayload, type CrawlPageInput } from "@/lib/topic-maps/cluster";
import type { TopicMap, TopicMapsView, TopicMapView } from "@/lib/topic-maps/contract";
import { TopicMapStoreNotSetUpError, type TopicMapStore } from "@/lib/topic-maps/store-contract";

/**
 * The topic-map service (M1, PR 4). One build: read the project's newest
 * completed live provider run and its rows, the live articles and the
 * newest own-site crawl's fetched pages; derive the clusters by the fixed
 * rules (`cluster.ts`); record the map as one set through the database
 * function, which supersedes the earlier proposed map. Approve is the one
 * status change. Nothing here runs an agent, calls a provider or pays for
 * anything; a build on a database without the migration answers "not set
 * up", never a crash. The live list must be readable: coverage computed
 * without it would call every live page a gap (the F9 rule).
 */

export type TopicMapSource = {
  readonly run: ProviderRun;
  readonly metrics: readonly KeywordMetric[];
};

export type TopicMapReaders = {
  /** The project's newest completed live provider run with its metric rows, or null when none exists. */
  readonly source: (projectId: string) => Promise<TopicMapSource | null>;
  /** The live articles as the records answer them; null when the read failed. */
  readonly liveArticles: (projectId: string) => Promise<readonly LiveArticle[] | null>;
  /** The newest own-site crawl's fetched pages; null when the project has none or the store keeps none. */
  readonly crawl: (projectId: string) => Promise<{ readonly crawlId: string; readonly pages: readonly CrawlPageInput[] } | null>;
  readonly now?: () => Date;
};

export type BuildResult =
  | { readonly status: "not-set-up" }
  | { readonly status: "no-run" }
  | { readonly status: "live-articles-unread" }
  | { readonly status: "project-not-found" }
  | { readonly status: "invalid-map"; readonly reason: string }
  | { readonly status: "built"; readonly view: TopicMapView };

export type ApproveResult = { readonly status: "not-set-up" | "map-not-found" | "not-proposed" } | { readonly status: "approved"; readonly map: TopicMap };
export type ReadResult = { readonly status: "not-set-up" } | { readonly status: "read"; readonly view: TopicMapsView };

export type TopicMapService = {
  build(projectId: string, operatorId: string): Promise<BuildResult>;
  approve(projectId: string, mapId: string, operatorId: string): Promise<ApproveResult>;
  read(projectId: string): Promise<ReadResult>;
};

export function createTopicMapService(store: TopicMapStore, readers: TopicMapReaders): TopicMapService {
  const now = readers.now ?? (() => new Date());

  async function notSetUp<T>(work: () => Promise<T>): Promise<T | { readonly status: "not-set-up" }> {
    if (!store.storesTopicMaps) return { status: "not-set-up" };
    try {
      return await work();
    } catch (error) {
      if (error instanceof TopicMapStoreNotSetUpError) return { status: "not-set-up" };
      throw error;
    }
  }

  async function viewOf(map: TopicMap | null): Promise<TopicMapView | null> {
    if (map === null) return null;
    return { map, clusters: await store.listClusters(map.id) };
  }

  return {
    async build(projectId, operatorId) {
      return (await notSetUp(async (): Promise<BuildResult> => {
        const source = await readers.source(projectId);
        if (source === null) return { status: "no-run" };
        const liveArticles = await readers.liveArticles(projectId);
        if (liveArticles === null) return { status: "live-articles-unread" };
        const crawl = await readers.crawl(projectId);
        const draft = buildTopicMap({ seeds: source.run.seeds, metrics: source.metrics, liveArticles, crawlPages: crawl?.pages ?? [] });
        const payload = recordPayload(draft, { runIds: [source.run.id], crawlId: crawl?.crawlId ?? null, liveArticlesReadAt: now().toISOString() });
        const recorded = await store.record(projectId, payload, operatorId);
        if (recorded.status !== "recorded") return recorded;
        return { status: "built", view: { map: recorded.map, clusters: await store.listClusters(recorded.map.id) } };
      })) as BuildResult;
    },

    async approve(projectId, mapId, operatorId) {
      return (await notSetUp(async (): Promise<ApproveResult> => store.approve(projectId, mapId, operatorId))) as ApproveResult;
    },

    async read(projectId) {
      return (await notSetUp(async (): Promise<ReadResult> => {
        const [approved, proposed, source] = await Promise.all([store.getMap(projectId, "approved"), store.getMap(projectId, "proposed"), readers.source(projectId)]);
        return {
          status: "read",
          view: {
            projectId,
            approved: await viewOf(approved),
            proposed: await viewOf(proposed),
            source: source === null ? { status: "no-run" } : { status: "ready", runId: source.run.id, fetchedAt: source.run.finishedAt ?? source.run.createdAt, seeds: source.run.seeds.length, rows: source.metrics.length },
          },
        };
      })) as ReadResult;
    },
  };
}
