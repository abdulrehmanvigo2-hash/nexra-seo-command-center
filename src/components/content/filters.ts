import { ATTENTION_HEALTH } from "@/lib/mock/content";
import type {
  AgentId,
  ContentFormat,
  ContentHealth,
  ContentRecord,
  ContentRole,
  ContentScoreBand,
  ContentStage,
  IntentAlignment,
  KeywordIntent,
} from "@/types/content";

/**
 * Filtering for the content inventory.
 *
 * One predicate, used by every view that narrows the set, so the table, the
 * summary numbers above it, the workflow board, and the selection count can
 * never describe different pieces. Everything is frontend state over the
 * derived records — nothing here queries anything.
 *
 * `flag` is deliberately a single filter rather than five checkboxes. The
 * questions it answers — what needs attention, what is orphaned, what is
 * competing with itself, what nobody targeted, what an answer engine is
 * ignoring — are asked one at a time, and a stack of independent toggles would
 * mostly produce empty intersections.
 */

export type ContentFlag =
  | "all"
  | "attention"
  | "orphan"
  | "cannibalised"
  | "unmapped"
  | "ai-gap"
  | "refresh-due";

export type ContentFilters = {
  /** Matched against the title, the URL, the cluster, and the project. */
  readonly query: string;
  readonly stage: ContentStage | "all" | "in-progress";
  readonly health: ContentHealth | "all";
  readonly format: ContentFormat | "all";
  readonly role: ContentRole | "all";
  readonly alignment: IntentAlignment | "all";
  readonly score: ContentScoreBand | "all";
  readonly intent: KeywordIntent | "all";
  /** Project id, or "all". */
  readonly project: string;
  /** Cluster id, or "all". */
  readonly cluster: string;
  /** Owning agent id, or "all". */
  readonly owner: AgentId | "all";
  readonly flag: ContentFlag;
};

export const EMPTY_CONTENT_FILTERS: ContentFilters = {
  query: "",
  stage: "all",
  health: "all",
  format: "all",
  role: "all",
  alignment: "all",
  score: "all",
  intent: "all",
  project: "all",
  cluster: "all",
  owner: "all",
  flag: "all",
};

function matchesFlag(record: ContentRecord, flag: ContentFlag): boolean {
  switch (flag) {
    case "all":
      return true;
    case "attention":
      return record.url !== null && ATTENTION_HEALTH.includes(record.health);
    case "orphan":
      return record.url !== null && record.internalLinksIn === 0;
    case "cannibalised":
      return record.cannibalised;
    case "unmapped":
      return record.primaryKeywordId === null;
    case "ai-gap":
      return record.aeo.aiKeywords > 0 && record.aeo.likelySourceKeywords === 0;
    case "refresh-due":
      return record.refresh !== null;
  }
}

export function matchesContentFilters(
  record: ContentRecord,
  filters: ContentFilters,
): boolean {
  const query = filters.query.trim().toLowerCase();
  if (query.length > 0) {
    const haystack =
      `${record.title} ${record.url ?? ""} ${record.primaryKeyword ?? ""} ${record.clusterName} ${record.projectName}`.toLowerCase();
    if (!haystack.includes(query)) return false;
  }

  if (filters.stage === "in-progress") {
    if (record.stage === "published" && record.refresh === null) return false;
  } else if (filters.stage !== "all") {
    // A live page carries two stages at once: it is published, and the rework
    // queued against it sits somewhere in the pipeline. Both have to match, or
    // clicking a column on the production board would open an empty inventory.
    const matchesStage =
      record.stage === filters.stage ||
      record.refresh?.stage === filters.stage;
    if (!matchesStage) return false;
  }

  if (filters.health !== "all") {
    if (record.url === null || record.health !== filters.health) return false;
  }

  if (filters.format !== "all" && record.format !== filters.format) return false;
  if (filters.role !== "all" && record.role !== filters.role) return false;

  if (
    filters.alignment !== "all" &&
    record.intentAlignment !== filters.alignment
  ) {
    return false;
  }

  if (filters.score !== "all" && record.score.band !== filters.score) {
    return false;
  }

  if (filters.intent !== "all" && record.primaryIntent !== filters.intent) {
    return false;
  }

  if (filters.project !== "all" && record.projectId !== filters.project) {
    return false;
  }

  if (filters.cluster !== "all" && record.clusterId !== filters.cluster) {
    return false;
  }

  if (filters.owner !== "all" && record.owner !== filters.owner) return false;

  return matchesFlag(record, filters.flag);
}

/** True where anything other than the default selection is applied. */
export function hasActiveContentFilters(filters: ContentFilters): boolean {
  return activeContentFilterCount(filters) > 0;
}

/** How many filters are narrowing the set, for the filter button's label. */
export function activeContentFilterCount(filters: ContentFilters): number {
  const values = [
    filters.stage,
    filters.health,
    filters.format,
    filters.role,
    filters.alignment,
    filters.score,
    filters.intent,
    filters.project,
    filters.cluster,
    filters.owner,
    filters.flag,
  ];

  return (
    values.filter((value) => value !== "all").length +
    (filters.query.trim().length > 0 ? 1 : 0)
  );
}
