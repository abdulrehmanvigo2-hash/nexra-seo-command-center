import { matchesAiFilter } from "@/lib/mock/keywords";
import type {
  AiKeywordFilter,
  CannibalizationRisk,
  DifficultyBand,
  KeywordIntent,
  KeywordRecord,
  KeywordStatus,
  OpportunityBand,
  RankingStatus,
  SerpFeatureId,
  VolumeBand,
} from "@/types/keyword";

/**
 * Filtering for the keyword table.
 *
 * One predicate, used by every view that narrows the set, so the table, the
 * summary numbers above it, and the bulk-selection count can never describe
 * different keywords. Everything is frontend state over the fixture registry —
 * nothing here queries anything.
 *
 * Two filters need data the record does not carry on its own: cannibalisation
 * risk, and membership of a saved list. Both are passed in rather than looked
 * up here, so this file stays a pure function of its arguments and the caller
 * keeps ownership of the session state a list represents.
 */

export type KeywordFilters = {
  /** Matched against the keyword, its URL, its cluster, and its project. */
  readonly query: string;
  readonly intent: KeywordIntent | "all";
  /** Position band — where the keyword currently sits. */
  readonly position: RankingStatus | "all";
  /** How the keyword is behaving, as opposed to where it sits. */
  readonly status: KeywordStatus | "all";
  readonly difficulty: DifficultyBand | "all";
  readonly volume: VolumeBand | "all";
  readonly opportunity: OpportunityBand | "all";
  /** Project id, or "all". */
  readonly project: string;
  /** Cluster id, or "all". */
  readonly cluster: string;
  readonly serpFeature: SerpFeatureId | "all";
  readonly ai: AiKeywordFilter;
  /** "any" matches every cannibalised keyword, whatever the risk. */
  readonly cannibalization: CannibalizationRisk | "any" | "all";
  /** Saved list id, or "all". */
  readonly list: string;
};

export const EMPTY_KEYWORD_FILTERS: KeywordFilters = {
  query: "",
  intent: "all",
  position: "all",
  status: "all",
  difficulty: "all",
  volume: "all",
  opportunity: "all",
  project: "all",
  cluster: "all",
  serpFeature: "all",
  ai: "all",
  cannibalization: "all",
  list: "all",
};

/** Extra context two of the filters need. */
export type FilterContext = {
  readonly risk: ReadonlyMap<string, CannibalizationRisk>;
  /** Keyword ids in the selected list, or null where no list is selected. */
  readonly listMembers: ReadonlySet<string> | null;
};

export function matchesKeywordFilters(
  record: KeywordRecord,
  filters: KeywordFilters,
  context: FilterContext,
): boolean {
  const query = filters.query.trim().toLowerCase();
  if (query.length > 0) {
    const haystack =
      `${record.keyword} ${record.targetUrl ?? ""} ${record.clusterName} ${record.projectName}`.toLowerCase();
    if (!haystack.includes(query)) return false;
  }

  if (filters.intent !== "all" && record.intent !== filters.intent) return false;

  if (filters.position !== "all" && record.rankingStatus !== filters.position) {
    return false;
  }

  if (filters.status !== "all" && record.status !== filters.status) return false;

  if (
    filters.difficulty !== "all" &&
    record.difficultyBand !== filters.difficulty
  ) {
    return false;
  }

  if (filters.volume !== "all" && record.volumeBand !== filters.volume) {
    return false;
  }

  if (
    filters.opportunity !== "all" &&
    record.opportunity.band !== filters.opportunity
  ) {
    return false;
  }

  if (filters.project !== "all" && record.projectId !== filters.project) {
    return false;
  }

  if (filters.cluster !== "all" && record.clusterId !== filters.cluster) {
    return false;
  }

  if (
    filters.serpFeature !== "all" &&
    !record.serpFeatures.some((entry) => entry.feature === filters.serpFeature)
  ) {
    return false;
  }

  if (filters.ai !== "all" && !matchesAiFilter(record, filters.ai)) return false;

  if (filters.cannibalization !== "all") {
    const risk = context.risk.get(record.id);
    if (risk === undefined) return false;
    if (filters.cannibalization !== "any" && risk !== filters.cannibalization) {
      return false;
    }
  }

  if (context.listMembers !== null && !context.listMembers.has(record.id)) {
    return false;
  }

  return true;
}

/** True where anything other than the default selection is applied. */
export function hasActiveKeywordFilters(filters: KeywordFilters): boolean {
  return (
    filters.query.trim().length > 0 ||
    filters.intent !== "all" ||
    filters.position !== "all" ||
    filters.status !== "all" ||
    filters.difficulty !== "all" ||
    filters.volume !== "all" ||
    filters.opportunity !== "all" ||
    filters.project !== "all" ||
    filters.cluster !== "all" ||
    filters.serpFeature !== "all" ||
    filters.ai !== "all" ||
    filters.cannibalization !== "all" ||
    filters.list !== "all"
  );
}

/** How many filters are narrowing the set, for the "clear" control's label. */
export function activeFilterCount(filters: KeywordFilters): number {
  const values = [
    filters.intent,
    filters.position,
    filters.status,
    filters.difficulty,
    filters.volume,
    filters.opportunity,
    filters.project,
    filters.cluster,
    filters.serpFeature,
    filters.ai,
    filters.cannibalization,
    filters.list,
  ];

  return (
    values.filter((value) => value !== "all").length +
    (filters.query.trim().length > 0 ? 1 : 0)
  );
}
