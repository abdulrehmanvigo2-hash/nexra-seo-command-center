import { isRunId, isSnapshotProjectId } from "@/lib/keyword-snapshots/contract";
import type { Coverage, Demand, Intent, KeywordRole } from "@/lib/topic-maps/cluster";

/**
 * Topical maps (M1, PR 4): the application's view of the records migration
 * 20261019120000 keeps — a map, its clusters and their keywords — and the
 * shapes the route reads and answers. Pure and client-safe. Every figure is
 * the provider's estimate copied at build time, never observed data; a null
 * is "not given", never 0.
 */

export type TopicMapStatus = "proposed" | "approved" | "superseded";

export type TopicMap = {
  readonly id: string;
  readonly projectId: string;
  readonly runIds: readonly string[];
  readonly crawlId: string | null;
  readonly liveArticlesReadAt: string;
  readonly status: TopicMapStatus;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly counts: {
    readonly clusters: number;
    readonly covered: number;
    readonly partial: number;
    readonly gap: number;
    readonly noEstimate: number;
    readonly excluded: number;
  };
  readonly createdBy: string;
  readonly createdAt: string;
};

export type TopicClusterKeyword = {
  readonly keyword: string;
  readonly role: KeywordRole;
  readonly metricId: string | null;
  readonly exclusionReason: string | null;
  readonly searchVolume: number | null;
  readonly keywordDifficulty: number | null;
};

export type TopicCluster = {
  readonly id: string;
  readonly mapId: string;
  readonly position: number;
  readonly topic: string;
  readonly cluster: string;
  readonly primaryKeyword: string;
  readonly intent: Intent | null;
  readonly demand: Demand;
  readonly coverage: Coverage;
  readonly existingPage: string | null;
  readonly candidatePage: string | null;
  readonly searchVolume: number | null;
  readonly keywordDifficulty: number | null;
  readonly keywords: readonly TopicClusterKeyword[];
};

/** A map with its clusters, as the screen reads it. */
export type TopicMapView = {
  readonly map: TopicMap;
  readonly clusters: readonly TopicCluster[];
};

/** What the GET answers: the approved map and the newest proposed one, each with its clusters, or why there is none. */
export type TopicMapsView = {
  readonly projectId: string;
  readonly approved: TopicMapView | null;
  readonly proposed: TopicMapView | null;
  /** Whether a build is possible now: the project has a completed live provider run to read. */
  readonly source: { readonly status: "ready"; readonly runId: string; readonly fetchedAt: string; readonly seeds: number; readonly rows: number } | { readonly status: "no-run" };
};

export const CLUSTER_READ_LIMIT = 200;
export const KEYWORD_READ_LIMIT = 2_000;

export const isTopicMapProjectId = isSnapshotProjectId;
export const isTopicMapId = isRunId;

export type TopicMapAction = "build" | "approve";

export type ParsedTopicMapRequest =
  | { readonly ok: true; readonly projectId: string; readonly action: "build" }
  | { readonly ok: true; readonly projectId: string; readonly action: "approve"; readonly mapId: string }
  | { readonly ok: false; readonly error: "bad-request" };

/** POST /api/topic-maps { project, action: "build" } or { project, action: "approve", mapId }. Shape only. */
export function parseTopicMapRequest(body: unknown): ParsedTopicMapRequest {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "bad-request" };
  const { project, action, mapId } = body as { project?: unknown; action?: unknown; mapId?: unknown };
  const keys = Object.keys(body);
  if (!isTopicMapProjectId(project)) return { ok: false, error: "bad-request" };
  if (action === "build") {
    if (keys.some((key) => key !== "project" && key !== "action")) return { ok: false, error: "bad-request" };
    return { ok: true, projectId: project, action };
  }
  if (action === "approve") {
    if (!isTopicMapId(mapId) || keys.some((key) => key !== "project" && key !== "action" && key !== "mapId")) return { ok: false, error: "bad-request" };
    return { ok: true, projectId: project, action, mapId: mapId.toLowerCase() };
  }
  return { ok: false, error: "bad-request" };
}

export function topicMapsUrl(projectId: string): string {
  return `/api/topic-maps?${new URLSearchParams({ project: projectId }).toString()}`;
}
