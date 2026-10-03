import type { TopicCluster, TopicMap, TopicMapStatus } from "@/lib/topic-maps/contract";

/**
 * What the topic-map service needs from wherever the records are kept
 * (migration 20261019120000). Every write is one of the database's two
 * functions, which validate the set and hold the guards for any caller;
 * every read is bounded and scoped to one project.
 */

export type RecordMapOutcome = { readonly status: "recorded"; readonly map: TopicMap } | { readonly status: "project-not-found" } | { readonly status: "invalid-map"; readonly reason: string };
export type ApproveMapOutcome = { readonly status: "approved"; readonly map: TopicMap } | { readonly status: "map-not-found" | "not-proposed" };

/** The store cannot reach the migration's objects: the tables or functions do not exist on this database yet. */
export class TopicMapStoreNotSetUpError extends Error {
  constructor(operation: string) {
    super(`Topic map store: ${operation} found no topic-map schema (migration 20261019120000 not applied).`);
    this.name = "TopicMapStoreNotSetUpError";
  }
}

export type TopicMapStore = {
  /** Whether this deployment keeps topic maps at all. The fixture data source does not. */
  readonly storesTopicMaps: boolean;
  record(projectId: string, payload: Readonly<Record<string, unknown>>, operatorId: string): Promise<RecordMapOutcome>;
  approve(projectId: string, mapId: string, operatorId: string): Promise<ApproveMapOutcome>;
  /** The project's one map in the given state, if any (at most one proposed and one approved exist). */
  getMap(projectId: string, status: Exclude<TopicMapStatus, "superseded">): Promise<TopicMap | null>;
  /** A map's clusters with their keywords, by position, bounded. */
  listClusters(mapId: string): Promise<readonly TopicCluster[]>;
};

export const unavailableTopicMapStore: TopicMapStore = {
  storesTopicMaps: false,
  async record() {
    return { status: "project-not-found" };
  },
  async approve() {
    return { status: "map-not-found" };
  },
  async getMap() {
    return null;
  },
  async listClusters() {
    return [];
  },
};
