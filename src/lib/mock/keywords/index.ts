import {
  formatCompact,
  formatCurrencyCompact,
  formatNumber,
  formatPercent,
} from "@/lib/format";
import { round } from "@/lib/mock/dashboard/core";
import { PROJECTS } from "@/lib/mock/projects/roster";
import {
  KEYWORDS_AS_OF,
  KEYWORD_RANGE,
  getKeywordRecords,
  targetPositionFor,
} from "@/lib/mock/keywords/builders";
import {
  clustersForProject,
  getClusterRecord,
  getKeywordClusters,
} from "@/lib/mock/keywords/clusters";
import { cannibalizationForKeyword } from "@/lib/mock/keywords/cannibalization";
import { contentGapForKeyword, getContentGaps } from "@/lib/mock/keywords/gaps";
import { getRankingHistory } from "@/lib/mock/keywords/history";
import {
  INTENT_ORDER,
  RANKING_STATUS_META,
  RANKING_STATUS_ORDER,
} from "@/lib/mock/keywords/meta";
import {
  getKeywordOpportunities,
  opportunitiesForKeyword,
} from "@/lib/mock/keywords/opportunities";
import { registrySize } from "@/lib/mock/keywords/registry";
import type { KeywordSnapshotRow, RangeId } from "@/types/dashboard";
import type {
  AgentId,
  ClusterDetail,
  IntentBreakdownRow,
  KeywordDetail,
  KeywordIntent,
  KeywordMetric,
  KeywordRecord,
  Priority,
  RankingBandCount,
} from "@/types/keyword";

/**
 * Single entry point for the Keyword Intelligence module's mock data.
 *
 * Import from `@/lib/mock/keywords` and the shapes from `@/types/keyword`; the
 * files behind this one are implementation detail. Everything returned is a
 * fixture — there is no keyword API, rank tracker, search-console connection,
 * or third-party SEO provider in this milestone (CLAUDE.md §4).
 *
 * Nothing in this module invents a keyword. The registry says what a keyword
 * is; the builders say what follows from that; clusters, opportunities,
 * movement, cannibalisation, and gaps are readings of those records. That is
 * why a keyword's position on the Command Center, on its project, and in this
 * module agree — they are one dataset read three times, not three datasets
 * that happen to look alike.
 */

export {
  KEYWORD_REGISTRY,
  registrySize,
  seedsForProject,
} from "@/lib/mock/keywords/registry";

export {
  AI_COVERAGE_META,
  AI_FILTER_META,
  AI_FILTER_ORDER,
  CANNIBALIZATION_RISK_META,
  CANNIBALIZATION_RISK_ORDER,
  CANNIBALIZATION_STATE_META,
  CLUSTER_STATUS_META,
  CLUSTER_STATUS_ORDER,
  CONTENT_GAP_META,
  CONTENT_GAP_ORDER,
  DIFFICULTY_BAND_META,
  DIFFICULTY_BAND_ORDER,
  INTENT_META,
  INTENT_ORDER,
  INTENT_VALUE,
  KEYWORD_STATUS_META,
  MOVEMENT_KIND_META,
  MOVEMENT_KIND_ORDER,
  OPPORTUNITY_BAND_META,
  OPPORTUNITY_BAND_ORDER,
  OPPORTUNITY_CATEGORY_META,
  OPPORTUNITY_CATEGORY_ORDER,
  OPPORTUNITY_STATE_META,
  RANKING_STATUS_META,
  RANKING_STATUS_ORDER,
  SERP_FEATURE_META,
  SERP_FEATURE_ORDER,
  SERP_OWNERSHIP_META,
  SERP_TYPE_META,
  SUGGESTED_CONTENT_TYPE,
  VOLUME_BAND_META,
  VOLUME_BAND_ORDER,
  ctrAt,
  difficultyBandOf,
  opportunityBandOf,
  rankingStatusOf,
  volumeBandOf,
} from "@/lib/mock/keywords/meta";

export {
  getKeywordRecords,
  targetPositionFor,
} from "@/lib/mock/keywords/builders";

export {
  clusterOptions,
  clusterSummaryLine,
  clustersForProject,
  getClusterRecord,
  getKeywordClusters,
} from "@/lib/mock/keywords/clusters";

export {
  getKeywordOpportunities,
  getStrikingDistance,
  opportunitiesForKeyword,
  opportunitiesInCategory,
  upliftOf,
} from "@/lib/mock/keywords/opportunities";

export {
  getKeywordMovement,
  getMovementSummary,
  movementOfKind,
} from "@/lib/mock/keywords/movement";

export {
  cannibalizationForKeyword,
  cannibalizationRiskIndex,
  getCannibalization,
} from "@/lib/mock/keywords/cannibalization";

export {
  competitorGapsForProject,
  contentGapForKeyword,
  getCompetitorGaps,
  getContentGaps,
  getRivalRankings,
  rivalRankFor,
} from "@/lib/mock/keywords/gaps";
export type { RivalRanking } from "@/lib/mock/keywords/gaps";

export { getRankingHistory } from "@/lib/mock/keywords/history";
export { getSeededLists } from "@/lib/mock/keywords/lists";
export { getSerpFeatureSummary } from "@/lib/mock/keywords/serp";
export type { SerpFeatureSummary } from "@/lib/mock/keywords/serp";
export {
  IMPORT_INTENTS,
  hashString,
  parseImport,
  runDiscovery,
} from "@/lib/mock/keywords/discovery";
export {
  aiOpportunityOf,
  entityGapOf,
  getAiSummary,
  matchesAiFilter,
} from "@/lib/mock/keywords/ai-signals";

/** The instant every keyword fixture is written against. */
export { KEYWORDS_AS_OF } from "@/lib/mock/keywords/builders";

/** Window the module's positions and movement are measured over by default. */
export const KEYWORDS_RANGE_CAPTION = KEYWORD_RANGE.caption;

// ---------------------------------------------------------------------------
// Selection helpers
// ---------------------------------------------------------------------------

/** Every keyword, highest opportunity first. */
let sortedCache: readonly KeywordRecord[] | null = null;

export function getKeywordList(): readonly KeywordRecord[] {
  sortedCache ??= [...getKeywordRecords()].sort(
    (a, b) =>
      b.opportunity.score - a.opportunity.score ||
      a.keyword.localeCompare(b.keyword),
  );
  return sortedCache;
}

/** One keyword by id. */
export function getKeywordRecord(id: string): KeywordRecord | undefined {
  return getKeywordRecords().find((record) => record.id === id);
}

/** Ids of every keyword with a detail page — used to prerender their routes. */
export function getKeywordIds(): readonly string[] {
  return getKeywordRecords().map((record) => record.id);
}

/** Ids of every cluster with a workspace. */
export function getClusterIds(): readonly string[] {
  return getKeywordClusters().map((cluster) => cluster.id);
}

/** Keywords belonging to one project. */
export function keywordsForProject(
  projectId: string,
): readonly KeywordRecord[] {
  return getKeywordList().filter((record) => record.projectId === projectId);
}

/** Projects that have keywords, for the project filter. */
export function getKeywordProjectOptions(): readonly {
  readonly id: string;
  readonly name: string;
}[] {
  const active = new Set(
    getKeywordRecords().map((record) => record.projectId),
  );
  return PROJECTS.filter((project) => active.has(project.id)).map(
    (project) => ({ id: project.id, name: project.name }),
  );
}

// ---------------------------------------------------------------------------
// Portfolio summary
// ---------------------------------------------------------------------------

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((carry, value) => carry + value, 0) / values.length;
}

/**
 * The headline numbers above the keyword table.
 *
 * Derived from whichever selection is passed in, so filtering the table
 * changes them — and the caption on the panel says which set they describe,
 * rather than leaving it ambiguous.
 */
export function getKeywordMetrics(
  records: readonly KeywordRecord[],
): readonly KeywordMetric[] {
  const ranking = records.filter((record) => record.position !== null);
  const notRanking = records.length - ranking.length;

  const averagePosition =
    ranking.length === 0
      ? 0
      : round(mean(ranking.map((record) => record.position as number)), 1);

  const trafficPotential = records.reduce(
    (carry, record) => carry + record.trafficPotential,
    0,
  );
  const currentTraffic = records.reduce(
    (carry, record) => carry + record.currentTraffic,
    0,
  );

  const opportunityValue = records.reduce(
    (carry, record) =>
      carry +
      Math.max(0, record.trafficPotential - record.currentTraffic) * record.cpc,
    0,
  );

  const highIntent = records.filter(
    (record) =>
      record.intent === "transactional" ||
      record.intent === "commercial" ||
      record.intent === "local",
  );

  const aiEligible = records.filter((record) => record.ai.aiOverviewPresent);

  return [
    {
      id: "total-keywords",
      label: "Keywords analysed",
      value: formatNumber(records.length),
      detail: `${getKeywordProjectOptions().length} projects, full intelligence records`,
      icon: "keywords",
    },
    {
      id: "ranking-keywords",
      label: "Ranking in the top 100",
      value: formatNumber(ranking.length),
      unit: records.length > 0
        ? formatPercent(round((ranking.length / records.length) * 100, 0), 0)
        : undefined,
      detail: `${notRanking} not ranking at all`,
      icon: "target",
      health: notRanking > records.length * 0.2 ? "warning" : "positive",
    },
    {
      id: "average-position",
      label: "Average position",
      value: averagePosition === 0 ? "—" : averagePosition.toFixed(1),
      detail: "Across every keyword that ranks",
      icon: "gauge",
    },
    {
      id: "estimated-traffic",
      label: "Estimated traffic",
      value: formatCompact(currentTraffic),
      unit: "sessions / mo",
      detail: "What these positions earn at modelled click-through rates",
      icon: "analytics",
    },
    {
      id: "traffic-potential",
      label: "Traffic potential",
      value: formatCompact(trafficPotential),
      unit: "sessions / mo",
      detail: `+${formatCompact(Math.max(0, trafficPotential - currentTraffic))} above today, at target positions`,
      icon: "trend-up",
      health: "positive",
    },
    {
      id: "opportunity-value",
      label: "Opportunity value",
      value: formatCurrencyCompact(opportunityValue),
      unit: "/ mo",
      detail: "The traffic gap priced at each keyword's listed CPC",
      icon: "value",
    },
    {
      id: "high-intent",
      label: "High-intent keywords",
      value: formatNumber(highIntent.length),
      detail: "Commercial, transactional, and local queries",
      icon: "flag",
    },
    {
      id: "ai-eligible",
      label: "AI search eligible",
      value: formatNumber(aiEligible.length),
      detail: `${aiEligible.filter((record) => record.ai.coverage === "cited").length} of them cite the brand today`,
      icon: "sparkles",
      health: "neutral",
    },
  ];
}

/** Count and share of the selection in each position band. */
export function getRankingBands(
  records: readonly KeywordRecord[],
): readonly RankingBandCount[] {
  return RANKING_STATUS_ORDER.map((band) => {
    const count = records.filter(
      (record) => record.rankingStatus === band,
    ).length;

    return {
      id: band,
      label: RANKING_STATUS_META[band].label,
      count,
      share:
        records.length === 0 ? 0 : round((count / records.length) * 100, 1),
    };
  });
}

/** Count, volume, and performance per intent. */
export function getIntentBreakdown(
  records: readonly KeywordRecord[],
): readonly IntentBreakdownRow[] {
  return INTENT_ORDER.map((intent) => {
    const matches = records.filter((record) => record.intent === intent);
    const ranking = matches.filter((record) => record.position !== null);

    return {
      intent,
      count: matches.length,
      share:
        records.length === 0
          ? 0
          : round((matches.length / records.length) * 100, 1),
      volume: matches.reduce((carry, record) => carry + record.volume, 0),
      averagePosition:
        ranking.length === 0
          ? null
          : round(mean(ranking.map((record) => record.position as number)), 1),
      opportunityScore: Math.round(
        mean(matches.map((record) => record.opportunity.score)),
      ),
    };
  }).filter((row) => row.count > 0);
}

// ---------------------------------------------------------------------------
// Keyword detail
// ---------------------------------------------------------------------------

/**
 * The single next move on a keyword.
 *
 * Chosen from what is actually wrong with it, in the order a practitioner
 * would: a split has to be resolved before a page is optimised, a page has to
 * exist before it can rank, and a keyword that is already first is defended
 * rather than pushed.
 */
function recommendedActionFor(
  record: KeywordRecord,
  cannibalized: boolean,
): KeywordDetail["recommendedAction"] {
  const urgency: Priority =
    record.opportunity.score >= 78
      ? "high"
      : record.opportunity.score >= 60
        ? "medium"
        : "low";

  const owner: AgentId = record.owner;

  if (cannibalized) {
    return {
      title: "Resolve the competing pages",
      detail:
        "Two of our own pages are ranking for this term. Decide which one owns it, consolidate the other, and re-point the internal links before any on-page work.",
      owner: "on-page-seo",
      urgency: "high",
    };
  }

  if (record.targetUrl === null) {
    return {
      title: "Brief and publish a page",
      detail: `Nothing on the site targets this query. It needs its own page before it can rank — ${formatCompact(record.volume)} searches a month are going somewhere else.`,
      owner: "content-strategist",
      urgency,
    };
  }

  if (record.position === null) {
    return {
      title: "Diagnose why the page is not ranking",
      detail:
        "A page exists and the keyword is outside the top 100. Check indexation and internal linking before rewriting anything.",
      owner: "technical-seo",
      urgency: "high",
    };
  }

  if (record.position <= 3) {
    return {
      title: "Hold the position",
      detail:
        "This term is already in the places that earn. Monitor for a rival taking the SERP features and keep the page current.",
      owner: "keyword-intent",
      urgency: "low",
    };
  }

  if (record.change <= -4) {
    return {
      title: "Refresh the page",
      detail: `Down ${Math.abs(record.change)} places this window. Refresh the content against what now ranks above it, then re-measure.`,
      owner: "on-page-seo",
      urgency: "high",
    };
  }

  if (record.ai.aiOverviewPresent && record.ai.coverage !== "cited") {
    return {
      title: "Make the page citable",
      detail:
        "A generated answer runs on this query and cites somebody else. Add a sourced, self-contained passage that answers it directly.",
      owner: "ai-visibility",
      urgency,
    };
  }

  if (record.position <= 20) {
    return {
      title: `Push from position ${record.position} to ${targetPositionFor(record.position)}`,
      detail:
        "Close enough that on-page work pays: tighten the title, match the query in the opening, and add internal links from the strongest related pages.",
      owner,
      urgency,
    };
  }

  return {
    title: "Build authority on the topic",
    detail:
      "Too far back for on-page work alone. Strengthen the surrounding cluster and the internal links into this page first.",
    owner: "content-strategist",
    urgency,
  };
}

/**
 * Everything one keyword's workspace renders, over one window.
 *
 * Returns null for an unknown id so the route can render a not-found page
 * rather than inventing a keyword.
 */
export function getKeywordDetail(
  keywordId: string,
  rangeId: RangeId = "30d",
): KeywordDetail | null {
  const record = getKeywordRecord(keywordId);
  if (!record) return null;

  const cannibalization = cannibalizationForKeyword(record.id);

  return {
    keyword: record,
    cluster: getClusterRecord(record.clusterId) ?? null,
    history: getRankingHistory(record, rangeId),
    cannibalization,
    gap: contentGapForKeyword(record.id),
    opportunities: opportunitiesForKeyword(record.id),
    related: getKeywordRecords()
      .filter(
        (entry) =>
          entry.clusterId === record.clusterId && entry.id !== record.id,
      )
      .sort((a, b) => b.opportunity.score - a.opportunity.score)
      .slice(0, 6),
    recommendedAction: recommendedActionFor(record, cannibalization !== null),
    generatedAt: KEYWORDS_AS_OF,
  };
}

// ---------------------------------------------------------------------------
// Cluster detail
// ---------------------------------------------------------------------------

/** Everything one cluster's workspace renders. */
export function getClusterDetail(clusterId: string): ClusterDetail | null {
  const cluster = getClusterRecord(clusterId);
  if (!cluster) return null;

  const members = new Set(cluster.keywordIds);
  const keywords = getKeywordList().filter((record) => members.has(record.id));

  return {
    cluster,
    keywords,
    intentBreakdown: getIntentBreakdown(keywords),
    distribution: getRankingBands(keywords),
    gaps: getContentGaps().filter((gap) => members.has(gap.keywordId)),
    opportunities: keywords.flatMap((record) =>
      opportunitiesForKeyword(record.id),
    ),
    metrics: getKeywordMetrics(keywords),
    siblings: clustersForProject(cluster.projectId).filter(
      (entry) => entry.id !== cluster.id,
    ),
    generatedAt: KEYWORDS_AS_OF,
  };
}

// ---------------------------------------------------------------------------
// What the other modules read
// ---------------------------------------------------------------------------

/**
 * Rows for the Command Center's keyword snapshot and a project's keyword tab.
 *
 * The same records this module renders, narrowed to the ones that can fill a
 * snapshot row: a snapshot shows position against previous position, so a
 * keyword that does not rank has nothing to show there. Nothing is re-derived
 * — a term's volume, difficulty, and position on the dashboard are the values
 * this module holds for it.
 */
export function getSnapshotRows(
  projectId: string,
): readonly KeywordSnapshotRow[] {
  const pool =
    projectId === "portfolio"
      ? getKeywordRecords()
      : getKeywordRecords().filter((record) => record.projectId === projectId);

  const rows = pool.filter(
    (record) => record.position !== null && record.previousPosition !== null,
  );

  const chosen =
    projectId === "portfolio"
      ? [...rows].sort((a, b) => b.volume - a.volume).slice(0, 12)
      : [...rows]
          .sort((a, b) => b.opportunity.score - a.opportunity.score)
          .slice(0, 8);

  return chosen.map((record) => ({
    id: record.id,
    keyword: record.keyword,
    intent: record.intent,
    position: record.position as number,
    previousPosition: record.previousPosition as number,
    volume: record.volume,
    difficulty: record.difficulty,
    url: record.targetUrl ?? "—",
    project: record.projectName,
  }));
}

/**
 * Movement as shares of the analysed set, for one project.
 *
 * The Command Center counts movement across its whole ranking universe, which
 * is larger than the set analysed in detail here. Handing it shares rather
 * than counts lets it scale these findings to that universe, so the two views
 * describe the same behaviour at two different sizes instead of disagreeing.
 */
export function getSnapshotRates(projectId: string): {
  readonly winners: number;
  readonly losers: number;
  readonly newRankings: number;
  readonly lostRankings: number;
  readonly averagePosition: number;
} {
  const pool =
    projectId === "portfolio"
      ? getKeywordRecords()
      : getKeywordRecords().filter((record) => record.projectId === projectId);

  const total = Math.max(pool.length, 1);
  const share = (predicate: (record: KeywordRecord) => boolean) =>
    pool.filter(predicate).length / total;

  const ranking = pool.filter((record) => record.position !== null);

  return {
    winners: share((record) => record.change >= 3),
    losers: share((record) => record.change <= -3),
    newRankings: share((record) => record.status === "new"),
    lostRankings: share((record) => record.status === "lost"),
    averagePosition:
      ranking.length === 0
        ? 0
        : round(mean(ranking.map((record) => record.position as number)), 1),
  };
}

/**
 * Share of the ranking keywords in each of the Command Center's position
 * bands, for one project.
 *
 * The dashboard counts across a ranking universe far larger than the set
 * analysed in detail here, so it is handed shares rather than counts and
 * scales them to that universe. The bands are the dashboard's own five, split
 * out of this module's four by counting the actual positions — no heuristic,
 * and no second definition of where a band starts.
 */
export function getSnapshotBands(
  projectId: string,
): Readonly<Record<"top-3" | "4-10" | "11-20" | "21-50" | "51-100", number>> {
  const pool = (
    projectId === "portfolio"
      ? getKeywordRecords()
      : getKeywordRecords().filter((record) => record.projectId === projectId)
  ).filter((record) => record.position !== null);

  const total = Math.max(pool.length, 1);
  const within = (low: number, high: number) =>
    pool.filter((record) => {
      const position = record.position as number;
      return position >= low && position <= high;
    }).length / total;

  return {
    "top-3": within(1, 3),
    "4-10": within(4, 10),
    "11-20": within(11, 20),
    "21-50": within(21, 50),
    "51-100": within(51, 100),
  };
}

/** Opportunities found on one project, for the dashboard's counter. */
export function getSnapshotOpportunityCount(projectId: string): number {
  const opportunities = getKeywordOpportunities();
  return projectId === "portfolio"
    ? opportunities.length
    : opportunities.filter((entry) => entry.projectId === projectId).length;
}

/** How many keywords the registry holds, for the header's dataset line. */
export function getDatasetSize(): number {
  return registrySize();
}

/** Every cluster grouped by project, for the cluster view's grouping. */
export function getClustersByProject(): readonly {
  readonly projectId: string;
  readonly projectName: string;
  readonly clusters: readonly ReturnType<typeof getKeywordClusters>[number][];
}[] {
  return getKeywordProjectOptions().map((project) => ({
    projectId: project.id,
    projectName: project.name,
    clusters: clustersForProject(project.id),
  }));
}

/** Intent labels in display order, for anywhere that needs the list. */
export const KEYWORD_INTENTS: readonly KeywordIntent[] = INTENT_ORDER;
