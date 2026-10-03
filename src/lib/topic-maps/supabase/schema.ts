import type { TopicCluster, TopicClusterKeyword, TopicMap } from "@/lib/topic-maps/contract";
import type { ApproveMapOutcome, RecordMapOutcome } from "@/lib/topic-maps/store-contract";

/**
 * The shape of the three topic-map tables, what the two functions answer,
 * and the translation into the application's types (migration
 * 20261019120000). The tables grant no INSERT, UPDATE or DELETE: the
 * functions are the only way in. A row that does not match what the
 * migration declares is refused at read time rather than passed on.
 */

export class TopicMapRowError extends Error {
  constructor(message: string) {
    super(`Topic map row: ${message}`);
    this.name = "TopicMapRowError";
  }
}

export type TopicMapRow = {
  id: string;
  project_id: string;
  run_ids: string[];
  crawl_id: string | null;
  live_articles_read_at: string;
  status: string;
  approved_by: string | null;
  approved_at: string | null;
  cluster_count: number;
  covered_count: number;
  partial_count: number;
  gap_count: number;
  no_estimate_count: number;
  excluded_count: number;
  created_by: string;
  created_at: string;
};

export type TopicClusterRow = {
  id: string;
  map_id: string;
  position: number;
  topic: string;
  cluster: string;
  primary_keyword: string;
  intent: string | null;
  demand: string;
  coverage: string;
  existing_page: string | null;
  candidate_page: string | null;
  search_volume: number | null;
  keyword_difficulty: number | null;
};

export type TopicClusterKeywordRow = {
  cluster_id: string;
  keyword: string;
  role: string;
  metric_id: string | null;
  exclusion_reason: string | null;
  search_volume: number | null;
  keyword_difficulty: number | null;
};

type ReadOnly<Row> = { Row: Row; Insert: never; Update: never; Relationships: [] };

export type TopicMapsDatabase = {
  public: {
    Tables: {
      nexra_topic_maps: ReadOnly<TopicMapRow>;
      nexra_topic_clusters: ReadOnly<TopicClusterRow>;
      nexra_topic_cluster_keywords: ReadOnly<TopicClusterKeywordRow>;
    };
    Views: { [_ in never]: never };
    Functions: {
      nexra_topic_map_record: { Args: { p_project_id: string; p_map: unknown; p_created_by: string }; Returns: unknown };
      nexra_topic_map_approve: { Args: { p_project_id: string; p_map_id: string; p_approved_by: string }; Returns: unknown };
    };
  };
};

export const MAP_READ_COLUMNS = "id, project_id, run_ids, crawl_id, live_articles_read_at, status, approved_by, approved_at, cluster_count, covered_count, partial_count, gap_count, no_estimate_count, excluded_count, created_by, created_at";
export const CLUSTER_READ_COLUMNS = "id, map_id, position, topic, cluster, primary_keyword, intent, demand, coverage, existing_page, candidate_page, search_volume, keyword_difficulty";
export const KEYWORD_READ_COLUMNS = "cluster_id, keyword, role, metric_id, exclusion_reason, search_volume, keyword_difficulty";

/** The Postgres error codes a database without the migration answers (missing relation or function, or not in PostgREST's schema cache). */
export const NOT_SET_UP_CODES: readonly string[] = ["PGRST202", "PGRST205", "42P01", "42883"];

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TopicMapRowError(`${what} is not an object.`);
  return value as Record<string, unknown>;
}
function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new TopicMapRowError(`${key} is not text.`);
  return value;
}
function optionalText(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new TopicMapRowError(`${key} is not text.`);
  return value;
}
function integer(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isInteger(value)) throw new TopicMapRowError(`${key} is not a whole number.`);
  return value;
}
function optionalInteger(row: Record<string, unknown>, key: string): number | null {
  if (row[key] === null || row[key] === undefined) return null;
  return integer(row, key);
}
function oneOf<T extends string>(row: Record<string, unknown>, key: string, values: readonly T[]): T {
  const value = row[key];
  const found = values.find((candidate) => candidate === value);
  if (found === undefined) throw new TopicMapRowError(`${key} is "${String(value)}", which this product does not recognise.`);
  return found;
}

export function mapRowToMap(data: unknown): TopicMap {
  const row = record(data, "a map row");
  const runIds = row.run_ids;
  if (!Array.isArray(runIds) || runIds.some((id) => typeof id !== "string")) throw new TopicMapRowError("run_ids is not a list of ids.");
  return {
    id: text(row, "id"),
    projectId: text(row, "project_id"),
    runIds: runIds as string[],
    crawlId: optionalText(row, "crawl_id"),
    liveArticlesReadAt: text(row, "live_articles_read_at"),
    status: oneOf(row, "status", ["proposed", "approved", "superseded"] as const),
    approvedBy: optionalText(row, "approved_by"),
    approvedAt: optionalText(row, "approved_at"),
    counts: {
      clusters: integer(row, "cluster_count"),
      covered: integer(row, "covered_count"),
      partial: integer(row, "partial_count"),
      gap: integer(row, "gap_count"),
      noEstimate: integer(row, "no_estimate_count"),
      excluded: integer(row, "excluded_count"),
    },
    createdBy: text(row, "created_by"),
    createdAt: text(row, "created_at"),
  };
}

export function clusterRowToCluster(data: unknown, keywords: readonly TopicClusterKeyword[]): TopicCluster {
  const row = record(data, "a cluster row");
  const intent = optionalText(row, "intent");
  return {
    id: text(row, "id"),
    mapId: text(row, "map_id"),
    position: integer(row, "position"),
    topic: text(row, "topic"),
    cluster: text(row, "cluster"),
    primaryKeyword: text(row, "primary_keyword"),
    intent: intent === null ? null : oneOf(row, "intent", ["informational", "commercial", "transactional", "navigational"] as const),
    demand: oneOf(row, "demand", ["estimated", "no-estimate"] as const),
    coverage: oneOf(row, "coverage", ["covered", "partial", "gap"] as const),
    existingPage: optionalText(row, "existing_page"),
    candidatePage: optionalText(row, "candidate_page"),
    searchVolume: optionalInteger(row, "search_volume"),
    keywordDifficulty: optionalInteger(row, "keyword_difficulty"),
    keywords,
  };
}

export function keywordRowToKeyword(data: unknown): TopicClusterKeyword & { readonly clusterId: string } {
  const row = record(data, "a keyword row");
  return {
    clusterId: text(row, "cluster_id"),
    keyword: text(row, "keyword"),
    role: oneOf(row, "role", ["primary", "supporting", "excluded"] as const),
    metricId: optionalText(row, "metric_id"),
    exclusionReason: optionalText(row, "exclusion_reason"),
    searchVolume: optionalInteger(row, "search_volume"),
    keywordDifficulty: optionalInteger(row, "keyword_difficulty"),
  };
}

export function recordResultToOutcome(data: unknown): RecordMapOutcome {
  const result = record(data, "the record answer");
  switch (result.outcome) {
    case "recorded":
      return { status: "recorded", map: mapRowToMap(result.map) };
    case "project-not-found":
      return { status: "project-not-found" };
    case "invalid-map":
      return { status: "invalid-map", reason: typeof result.reason === "string" ? result.reason : "unknown" };
    default:
      throw new TopicMapRowError(`the record function answered "${String(result.outcome)}", which this product does not recognise.`);
  }
}

export function approveResultToOutcome(data: unknown): ApproveMapOutcome {
  const result = record(data, "the approve answer");
  switch (result.outcome) {
    case "approved":
      return { status: "approved", map: mapRowToMap(result.map) };
    case "map-not-found":
    case "not-proposed":
      return { status: result.outcome };
    default:
      throw new TopicMapRowError(`the approve function answered "${String(result.outcome)}", which this product does not recognise.`);
  }
}
