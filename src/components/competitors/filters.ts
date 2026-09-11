import { difficultyBandOf, opportunityBandOf, volumeBandOf } from "@/lib/mock/keywords";
import type {
  BattleState,
  CompetitorRecord,
  CompetitorType,
  KeywordIntent,
  OverlapRow,
  OverlapType,
  ThreatLevel,
} from "@/types/competitor";
import type { DifficultyBand, OpportunityBand, VolumeBand } from "@/types/keyword";

/**
 * Filtering for Competitor Intelligence.
 *
 * One filter object over two record shapes. A competitor and a keyword overlap
 * row are different things, but a user narrowing to one project, one rival, or
 * one intent expects both to narrow together — so the predicates below share a
 * state object and are applied in a fixed order by the workspace: competitors
 * first, then rows belonging to the competitors that survived.
 *
 * That order is what keeps the two consistent. Filtering rows independently
 * would let a row survive whose competitor did not, and the tab counts would
 * then disagree with the tables they label.
 *
 * The volume, difficulty, and opportunity bands are the Keyword Intelligence
 * module's own. There is no second set of bands in this module — a "hard"
 * keyword here is hard on the keyword workspace too.
 *
 * Search is the exception to the ordering above, and has to be. A competitor
 * record holds no keywords, so testing the query against competitors alone
 * would empty the whole workspace the moment somebody typed a keyword into a
 * box that offers to search keywords. A competitor therefore survives the
 * search if its own text matches *or* one of its rows does, which is what
 * `queryMatchedIds` carries.
 */

export type CompetitorFilters = {
  /** Matched against the rival, its domain, the keyword, cluster, and project. */
  readonly query: string;
  /** Project id, or "all". */
  readonly project: string;
  /** Competitor id, or "all". */
  readonly competitor: string;
  readonly threat: ThreatLevel | "all";
  readonly type: CompetitorType | "all";
  readonly battle: BattleState | "all";
  readonly overlap: OverlapType | "all";
  readonly intent: KeywordIntent | "all";
  /** Cluster id, or "all". */
  readonly cluster: string;
  readonly difficulty: DifficultyBand | "all";
  readonly volume: VolumeBand | "all";
  readonly opportunity: OpportunityBand | "all";
};

export const EMPTY_COMPETITOR_FILTERS: CompetitorFilters = {
  query: "",
  project: "all",
  competitor: "all",
  threat: "all",
  type: "all",
  battle: "all",
  overlap: "all",
  intent: "all",
  cluster: "all",
  difficulty: "all",
  volume: "all",
  opportunity: "all",
};

/** Whether a competitor's own text matches the search. */
export function competitorMatchesQuery(
  record: CompetitorRecord,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  return `${record.name} ${record.domain} ${record.projectName} ${record.category}`
    .toLowerCase()
    .includes(needle);
}

/** Whether a keyword row's text matches the search. */
export function rowMatchesQuery(row: OverlapRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  return `${row.keyword} ${row.clusterName} ${row.competitorName} ${row.competitorDomain} ${row.projectName}`
    .toLowerCase()
    .includes(needle);
}

/** Whether a competitor survives the filters that describe a competitor. */
export function matchesCompetitor(
  record: CompetitorRecord,
  filters: CompetitorFilters,
  /**
   * Competitors with at least one row matching the search.
   *
   * Omitted where the caller has no rows to hand, in which case the search is
   * tested against the competitor alone.
   */
  queryMatchedIds?: ReadonlySet<string>,
): boolean {
  if (
    !competitorMatchesQuery(record, filters.query) &&
    !(queryMatchedIds?.has(record.id) ?? false)
  ) {
    return false;
  }

  if (filters.project !== "all" && record.projectId !== filters.project) {
    return false;
  }
  if (filters.competitor !== "all" && record.id !== filters.competitor) {
    return false;
  }
  if (filters.threat !== "all" && record.threatLevel !== filters.threat) {
    return false;
  }
  if (filters.type !== "all" && record.type !== filters.type) return false;

  if (
    filters.opportunity !== "all" &&
    opportunityBandOf(record.opportunity.score) !== filters.opportunity
  ) {
    return false;
  }

  return true;
}

/**
 * Whether an overlap row survives the filters that describe a keyword.
 *
 * The competitor-level filters are deliberately not re-tested here: the
 * workspace has already narrowed the competitor set, and re-testing would let
 * the two lists drift apart the moment one predicate changed.
 */
export function matchesRow(
  row: OverlapRow,
  filters: CompetitorFilters,
): boolean {
  if (!rowMatchesQuery(row, filters.query)) return false;

  if (filters.battle !== "all") {
    if (row.battle !== filters.battle) return false;
  }
  if (filters.overlap !== "all" && row.overlap !== filters.overlap) return false;
  if (filters.intent !== "all" && row.intent !== filters.intent) return false;
  if (filters.cluster !== "all" && row.clusterId !== filters.cluster) {
    return false;
  }
  if (
    filters.difficulty !== "all" &&
    difficultyBandOf(row.difficulty) !== filters.difficulty
  ) {
    return false;
  }
  if (filters.volume !== "all" && volumeBandOf(row.volume) !== filters.volume) {
    return false;
  }
  if (
    filters.opportunity !== "all" &&
    opportunityBandOf(row.opportunity) !== filters.opportunity
  ) {
    return false;
  }

  return true;
}

/** True where anything other than the default selection is applied. */
export function hasActiveCompetitorFilters(
  filters: CompetitorFilters,
): boolean {
  return activeCompetitorFilterCount(filters) > 0;
}

/** How many filters are narrowing the set, for the filter button's label. */
export function activeCompetitorFilterCount(
  filters: CompetitorFilters,
): number {
  const values = [
    filters.project,
    filters.competitor,
    filters.threat,
    filters.type,
    filters.battle,
    filters.overlap,
    filters.intent,
    filters.cluster,
    filters.difficulty,
    filters.volume,
    filters.opportunity,
  ];

  return (
    values.filter((value) => value !== "all").length +
    (filters.query.trim().length > 0 ? 1 : 0)
  );
}
