import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { CLUSTER_READ_LIMIT, KEYWORD_READ_LIMIT, type TopicClusterKeyword } from "@/lib/topic-maps/contract";
import { TopicMapStoreNotSetUpError, type TopicMapStore } from "@/lib/topic-maps/store-contract";
import {
  approveResultToOutcome,
  CLUSTER_READ_COLUMNS,
  clusterRowToCluster,
  KEYWORD_READ_COLUMNS,
  keywordRowToKeyword,
  MAP_READ_COLUMNS,
  mapRowToMap,
  NOT_SET_UP_CODES,
  recordResultToOutcome,
  type TopicMapsDatabase,
} from "@/lib/topic-maps/supabase/schema";

/**
 * The topic-map store over the three tables of migration 20261019120000. A
 * thin translation into Supabase calls: the two functions and the tables'
 * guards enforce the set's validity and the immutability for any caller. A
 * database on which the migration is not yet applied answers every call
 * with `TopicMapStoreNotSetUpError`, which the service turns into "not set
 * up", never a crash.
 */

export class TopicMapStoreError extends Error {
  readonly code: string | null;

  constructor(operation: string, cause: PostgrestError | Error) {
    const code = "code" in cause && typeof cause.code === "string" ? cause.code : null;
    super(`Topic map store: ${operation} failed${code ? ` (${code})` : ""}: ${cause.message}`);
    this.name = "TopicMapStoreError";
    this.code = code;
  }
}

function refuse(operation: string, error: PostgrestError): never {
  if (NOT_SET_UP_CODES.includes(error.code) || /schema cache|does not exist/i.test(error.message)) throw new TopicMapStoreNotSetUpError(operation);
  throw new TopicMapStoreError(operation, error);
}

export function createSupabaseTopicMapStore(client: SupabaseClient<TopicMapsDatabase>): TopicMapStore {
  return {
    storesTopicMaps: true,

    async record(projectId, payload, operatorId) {
      const { data, error } = await client.rpc("nexra_topic_map_record", { p_project_id: projectId, p_map: payload, p_created_by: operatorId });
      if (error) refuse("record map", error);
      return recordResultToOutcome(data);
    },

    async approve(projectId, mapId, operatorId) {
      const { data, error } = await client.rpc("nexra_topic_map_approve", { p_project_id: projectId, p_map_id: mapId, p_approved_by: operatorId });
      if (error) refuse("approve map", error);
      return approveResultToOutcome(data);
    },

    async getMap(projectId, status) {
      const { data, error } = await client.from("nexra_topic_maps").select(MAP_READ_COLUMNS).eq("project_id", projectId).eq("status", status).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) refuse("get map", error);
      return data === null ? null : mapRowToMap(data);
    },

    async listClusters(mapId) {
      const { data: clusters, error } = await client.from("nexra_topic_clusters").select(CLUSTER_READ_COLUMNS).eq("map_id", mapId).order("position", { ascending: true }).limit(CLUSTER_READ_LIMIT);
      if (error) refuse("list clusters", error);
      if (!clusters || clusters.length === 0) return [];
      const { data: keywords, error: keywordsError } = await client
        .from("nexra_topic_cluster_keywords")
        .select(KEYWORD_READ_COLUMNS)
        .in(
          "cluster_id",
          clusters.map((row) => row.id),
        )
        .order("keyword", { ascending: true })
        .limit(KEYWORD_READ_LIMIT);
      if (keywordsError) refuse("list cluster keywords", keywordsError);
      const byCluster = new Map<string, TopicClusterKeyword[]>();
      for (const raw of keywords ?? []) {
        const { clusterId, ...keyword } = keywordRowToKeyword(raw);
        const list = byCluster.get(clusterId) ?? [];
        list.push(keyword);
        byCluster.set(clusterId, list);
      }
      return clusters.map((row) => clusterRowToCluster(row, byCluster.get(row.id) ?? []));
    },
  };
}
