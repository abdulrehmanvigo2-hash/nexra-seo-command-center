import { formatCompact, formatNumber, formatPercent } from "@/lib/format";
import { clamp, round } from "@/lib/mock/dashboard/core";
import { PROJECTS } from "@/lib/mock/projects/roster";
import { getKeywordRecords } from "@/lib/mock/keywords";
import {
  ATTACKABLE_BATTLES,
  BATTLE_ORDER,
  DEFENSIVE_BATTLES,
  THREAT_ORDER,
} from "@/lib/mock/competitors/meta";
import {
  COMPETITORS_AS_OF,
  COMPETITOR_RANGE,
  competitorsForProject,
  getClusterPresence,
  getCompetitorPages,
  getCompetitorRecord,
  getCompetitorRecords,
  getOverlapRows,
  overlapForCompetitor,
  pagesForCompetitor,
} from "@/lib/mock/competitors/registry";
import { battlegroundsForCompetitor } from "@/lib/mock/competitors/clusters";
import {
  gapsForCompetitor,
  getCompetitorGapFindings,
} from "@/lib/mock/competitors/gaps";
import {
  getSerpThreats,
  threatsForCompetitor,
} from "@/lib/mock/competitors/threats";
import { opportunitiesForCompetitor } from "@/lib/mock/competitors/opportunities";
import type {
  BattleState,
  CompetitorDetail,
  CompetitorHighlight,
  CompetitorMetric,
  CompetitorRecord,
  OverlapRow,
  ThreatLevel,
} from "@/types/competitor";

/**
 * Single entry point for the Competitor Intelligence mock data.
 *
 * Import from `@/lib/mock/competitors` and the shapes from
 * `@/types/competitor`; the files behind this one are implementation detail.
 *
 * The dependency direction is one-way and deliberate. This module reads
 * projects, keywords, clusters, content, and agents. None of those read this
 * one — a competitor is a lens over data those modules own, not a new owner of
 * it — which is why nothing here can put a number on screen that disagrees
 * with the module it came from.
 *
 * Everything returned is a fixture. There is no rank tracker, no SERP API, no
 * crawler, and no third-party dataset in this milestone (CLAUDE.md §4), and no
 * figure in this module is labelled with a vendor's name.
 */

export {
  COMPETITORS_AS_OF,
  COMPETITOR_RANGE,
  competitorsForProject,
  getClusterPresence,
  getCompetitorIds,
  getCompetitorPage,
  getCompetitorPages,
  getCompetitorRecord,
  getCompetitorRecords,
  getOverlapRows,
  overlapForCompetitor,
  overlapForKeyword,
  pagesForCompetitor,
} from "@/lib/mock/competitors/registry";
export type { ClusterPresence } from "@/lib/mock/competitors/registry";

export {
  ATTACKABLE_BATTLES,
  BATTLE_META,
  BATTLE_ORDER,
  COMPETITOR_TYPE_META,
  COMPETITOR_TYPE_ORDER,
  DEFENSIVE_BATTLES,
  DOMINANCE_META,
  DOMINANCE_ORDER,
  GAP_KIND_META,
  GAP_KIND_ORDER,
  LOSING_BATTLES,
  MODELLED_SOURCE_NOTE,
  OPPORTUNITY_KIND_META,
  OPPORTUNITY_KIND_ORDER,
  OVERLAP_META,
  OVERLAP_ORDER,
  PROVENANCE_META,
  SEVERITY_ORDER,
  THREAT_KIND_META,
  THREAT_KIND_ORDER,
  THREAT_META,
  THREAT_ORDER,
} from "@/lib/mock/competitors/meta";

export {
  battleStateFor,
  clusterStrength,
  confidenceFor,
  dominanceStateFor,
  effortFor,
  levelFor,
  positionScore,
  severityFor,
  shareScore,
  threatLevelOf,
  volumeScore,
  winnabilityScore,
} from "@/lib/mock/competitors/scoring";

export {
  battlegroundsForCompetitor,
  getClusterBattlegrounds,
} from "@/lib/mock/competitors/clusters";

export { getIntentBattlegrounds } from "@/lib/mock/competitors/intent";

export {
  gapsForCompetitor,
  getCompetitorGapFindings,
} from "@/lib/mock/competitors/gaps";

export {
  getSerpThreats,
  threatsForCompetitor,
} from "@/lib/mock/competitors/threats";

export {
  getCompetitorOpportunities,
  opportunitiesForAgent,
  opportunitiesForCompetitor,
} from "@/lib/mock/competitors/opportunities";

export { buildComparison } from "@/lib/mock/competitors/compare";

/** Window the module's figures are measured over. */
export const COMPETITOR_RANGE_CAPTION = COMPETITOR_RANGE.caption;

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((carry, value) => carry + value, 0) / values.length;
}

/**
 * Rows where a rival actually ranks.
 *
 * Every battle reading is taken over these. A term only we rank for has no
 * battle state at all, and counting it as one would report an uncontested
 * ranking as a competitive win.
 */
export function contestedRows(
  rows: readonly OverlapRow[],
): readonly OverlapRow[] {
  return rows.filter((row) => row.theirPosition !== null);
}

/** How many contested rows sit in any of the given battle states. */
export function countBattles(
  rows: readonly OverlapRow[],
  states: readonly BattleState[],
): number {
  return rows.filter((row) => row.battle !== null && states.includes(row.battle))
    .length;
}

// ---------------------------------------------------------------------------
// Selection helpers
// ---------------------------------------------------------------------------

/** Projects with a tracked competitive set, for the project filter. */
export function getCompetitorProjectOptions(): readonly {
  readonly id: string;
  readonly name: string;
}[] {
  const active = new Set(
    getCompetitorRecords().map((record) => record.projectId),
  );
  return PROJECTS.filter((project) => active.has(project.id)).map((project) => ({
    id: project.id,
    name: project.name,
  }));
}

/** Every competitor, labelled with the project it competes in. */
export function getCompetitorOptions(): readonly {
  readonly id: string;
  readonly label: string;
  readonly projectId: string;
}[] {
  return getCompetitorRecords().map((record) => ({
    id: record.id,
    label: `${record.name} · ${record.projectName}`,
    projectId: record.projectId,
  }));
}

/** Clusters where at least one rival appears, for the cluster filter. */
export function getContestedClusterOptions(): readonly {
  readonly id: string;
  readonly label: string;
  readonly projectId: string;
}[] {
  const seen = new Map<string, { label: string; projectId: string }>();

  for (const row of getOverlapRows()) {
    if (row.theirPosition === null || seen.has(row.clusterId)) continue;
    seen.set(row.clusterId, {
      label: `${row.clusterName} · ${row.projectName}`,
      projectId: row.projectId,
    });
  }

  return [...seen.entries()]
    .map(([id, entry]) => ({ id, label: entry.label, projectId: entry.projectId }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** How many competitors the module holds, for the header's dataset line. */
export function getCompetitorCount(): number {
  return getCompetitorRecords().length;
}

// ---------------------------------------------------------------------------
// Summary metrics
// ---------------------------------------------------------------------------

/**
 * The headline numbers above the workspace.
 *
 * Derived from whichever selection is passed in, so narrowing to one project
 * or one rival changes them, and the panel states which set they describe
 * rather than leaving it ambiguous.
 *
 * A keyword appears once per rival in the rows, so anything counting keywords
 * counts distinct ones — otherwise "shared keywords" would multiply by the
 * size of the competitive set.
 */
export function getCompetitorMetrics(
  records: readonly CompetitorRecord[],
  rows: readonly OverlapRow[],
): readonly CompetitorMetric[] {
  const projects = new Set(records.map((record) => record.projectId));
  const universe = getKeywordRecords().filter((record) =>
    projects.has(record.projectId),
  );

  const shared = new Set<string>();
  const theirsOnly = new Set<string>();
  const oursOnly = new Set<string>();
  const outranked = new Set<string>();
  const weLead = new Set<string>();

  for (const row of rows) {
    if (row.overlap === "shared") shared.add(row.keywordId);
    if (row.overlap === "theirs-only") theirsOnly.add(row.keywordId);
    if (row.overlap === "ours-only") oursOnly.add(row.keywordId);
    if (row.theirPosition !== null) {
      if (row.ourPosition === null || row.theirPosition < row.ourPosition) {
        outranked.add(row.keywordId);
      } else {
        weLead.add(row.keywordId);
      }
    }
  }

  // A keyword can be shared with one rival and theirs-only against another;
  // the contested count is the union, which is what "overlap" means here.
  const contested = new Set([...shared, ...theirsOnly]);

  const attackable = countBattles(rows, ATTACKABLE_BATTLES);
  const defensive = countBattles(rows, DEFENSIVE_BATTLES);

  const ourVisibility = mean(records.map((record) => record.ourVisibility));
  const bestRival = [...records].sort(
    (a, b) => b.visibility - a.visibility,
  )[0];

  const domains = new Set(records.map((record) => record.domain));

  return [
    {
      id: "tracked",
      label: "Tracked competitors",
      value: formatNumber(records.length),
      detail: `${domains.size} domain${domains.size === 1 ? "" : "s"} across ${projects.size} project${projects.size === 1 ? "" : "s"}.`,
      icon: "competitors",
    },
    {
      id: "overlap",
      label: "Organic overlap",
      value: formatPercent(
        universe.length === 0
          ? 0
          : round((contested.size / universe.length) * 100, 1),
      ),
      detail: `${formatNumber(contested.size)} of ${formatNumber(universe.length)} tracked terms have a rival on them.`,
      icon: "split",
    },
    {
      id: "shared",
      label: "Shared keywords",
      value: formatNumber(shared.size),
      detail: "Terms both we and at least one rival rank for.",
      icon: "keywords",
    },
    {
      id: "competitor-only",
      label: "Competitor-only",
      value: formatNumber(theirsOnly.size),
      detail: "Terms a rival ranks for and we do not appear on at all.",
      icon: "link-off",
    },
    {
      id: "ours-only",
      label: "Ours only",
      value: formatNumber(oursOnly.size),
      detail: "Terms we hold with no rival on them.",
      icon: "shield",
    },
    {
      id: "outranked",
      label: "They out-rank us",
      value: formatNumber(outranked.size),
      detail: `Against ${formatNumber(weLead.size)} terms where we are ahead of every rival that appears.`,
      icon: "trend-down",
    },
    {
      id: "attackable",
      label: "Attackable rankings",
      value: formatNumber(attackable),
      detail: `Head-to-heads within reach. ${formatNumber(defensive)} more are leads worth defending.`,
      icon: "target",
    },
    {
      id: "share-of-voice",
      label: "Our visibility",
      value: formatPercent(ourVisibility === null ? 0 : round(ourVisibility, 1)),
      detail:
        bestRival === undefined
          ? "No rival measured in this selection."
          : `Against ${bestRival.name} on ${formatPercent(bestRival.visibility)} — the strongest in this selection.`,
      icon: "gauge",
    },
  ];
}

/**
 * How the selection is distributed, for the bars beside the metric tiles.
 *
 * Counted from the same rows the tables show, so the bars and the tables can
 * never describe different sets.
 */
export function getCompetitorPosture(
  records: readonly CompetitorRecord[],
  rows: readonly OverlapRow[],
): {
  readonly threats: readonly {
    readonly level: ThreatLevel;
    readonly count: number;
  }[];
  readonly battles: readonly {
    readonly state: BattleState;
    readonly count: number;
  }[];
  readonly contested: number;
} {
  const contestedRows = rows.filter((row) => row.theirPosition !== null);

  return {
    threats: THREAT_ORDER.map((level) => ({
      level,
      count: records.filter((record) => record.threatLevel === level).length,
    })),
    battles: BATTLE_ORDER.map((state) => ({
      state,
      count: contestedRows.filter((row) => row.battle === state).length,
    })),
    contested: contestedRows.length,
  };
}

// ---------------------------------------------------------------------------
// Prioritised cards
// ---------------------------------------------------------------------------

/**
 * The four things worth saying first.
 *
 * Not vanity numbers: each card names a rival, states what it is doing, prices
 * it, and points at the tab where the work is. Where a selection produces
 * nothing for a card — no rival in scope, no gap found — the card is omitted
 * rather than rendered empty.
 */
export function getCompetitorHighlights(input: {
  readonly records: readonly CompetitorRecord[];
  readonly threats: readonly {
    readonly id: string;
    readonly competitorId: string;
    readonly competitorName: string;
    readonly headline: string;
    readonly rationale: string;
    readonly severity: CompetitorHighlight["severity"];
    readonly valueAtRisk: number;
    readonly owner: CompetitorHighlight["owner"];
  }[];
  readonly opportunities: readonly {
    readonly id: string;
    readonly competitorId: string;
    readonly competitorName: string;
    readonly action: string;
    readonly rationale: string;
    readonly priority: CompetitorHighlight["severity"];
    readonly value: number;
    readonly owner: CompetitorHighlight["owner"];
  }[];
  readonly gaps: readonly {
    readonly id: string;
    readonly competitorId: string;
    readonly competitorName: string;
    readonly finding: string;
    readonly action: string;
    readonly severity: CompetitorHighlight["severity"];
    readonly value: number;
    readonly owner: CompetitorHighlight["owner"];
  }[];
  readonly clusters: readonly {
    readonly clusterId: string;
    readonly clusterName: string;
    readonly projectName: string;
    readonly dominant: { readonly competitorId: string; readonly name: string } | null;
    readonly dominanceGap: number;
    readonly action: string;
    readonly owner: CompetitorHighlight["owner"];
    readonly totalVolume: number;
  }[];
}): readonly CompetitorHighlight[] {
  const highlights: CompetitorHighlight[] = [];

  const topThreat = [...input.records].sort(
    (a, b) => b.threat.score - a.threat.score,
  )[0];

  if (topThreat !== undefined) {
    highlights.push({
      id: `highlight-threat-${topThreat.id}`,
      kind: "threat",
      eyebrow: "Top strategic threat",
      title: topThreat.name,
      detail: topThreat.headline,
      competitorId: topThreat.id,
      competitorName: topThreat.name,
      value: `Threat ${topThreat.threat.score}/100`,
      severity: topThreat.threatLevel === "severe" ? "critical" : "high",
      owner: topThreat.owner,
      tab: "competitors",
    });
  }

  const bestOpening = [...input.records].sort(
    (a, b) => b.opportunity.score - a.opportunity.score,
  )[0];

  if (bestOpening !== undefined) {
    highlights.push({
      id: `highlight-opening-${bestOpening.id}`,
      kind: "opportunity",
      eyebrow: "Strongest opportunity",
      title: bestOpening.name,
      detail: bestOpening.opportunity.summary,
      competitorId: bestOpening.id,
      competitorName: bestOpening.name,
      value: `Opportunity ${bestOpening.opportunity.score}/100`,
      severity: "medium",
      owner: "content-strategist",
      tab: "opportunities",
    });
  }

  const biggestGap = [...input.gaps].sort((a, b) => b.value - a.value)[0];

  if (biggestGap !== undefined) {
    highlights.push({
      id: `highlight-gap-${biggestGap.id}`,
      kind: "gap",
      eyebrow: "Largest content gap",
      title: biggestGap.competitorName,
      detail: biggestGap.finding,
      competitorId: biggestGap.competitorId,
      competitorName: biggestGap.competitorName,
      value: `${formatCompact(biggestGap.value)} sessions / mo`,
      severity: biggestGap.severity,
      owner: biggestGap.owner,
      tab: "gaps",
    });
  }

  const takenCluster = [...input.clusters]
    .filter((entry) => entry.dominant !== null)
    .sort((a, b) => b.dominanceGap - a.dominanceGap)[0];

  if (takenCluster !== undefined && takenCluster.dominant !== null) {
    highlights.push({
      id: `highlight-cluster-${takenCluster.clusterId}`,
      kind: "cluster",
      eyebrow: "Cluster dominance",
      title: takenCluster.clusterName,
      detail: takenCluster.action,
      competitorId: takenCluster.dominant.competitorId,
      competitorName: takenCluster.dominant.name,
      value: `${formatCompact(takenCluster.totalVolume)} searches / mo`,
      severity: takenCluster.dominanceGap >= 25 ? "high" : "medium",
      owner: takenCluster.owner,
      tab: "clusters",
    });
  }

  return highlights;
}

// ---------------------------------------------------------------------------
// Readings for earlier modules
// ---------------------------------------------------------------------------

/** One rival, as the Command Center's competitive panel needs it. */
export type SnapshotRival = {
  readonly domain: string;
  readonly name: string;
  /** The record to open, or null where the domain spans several projects. */
  readonly competitorId: string | null;
  readonly threatLevel: ThreatLevel;
  readonly threatScore: number;
  readonly sharedKeywords: number;
  /** Terms they rank for and we do not. */
  readonly competitorOnly: number;
  /** Contested terms they lead. */
  readonly theirWins: number;
  /** Competitive gap findings raised against them. */
  readonly gaps: number;
};

/**
 * The competitive set for one project, keyed by domain.
 *
 * Exists so the Command Center's competitor panel can show counts that agree
 * with this module rather than inventing its own. The dashboard's fixture
 * layer cannot read this module — the keyword layer it feeds is upstream of
 * here, and importing back would close a cycle — so the integration happens in
 * the component, which is free to read either.
 *
 * The portfolio roll-up has no competitor records of its own: a rival is
 * tracked against a client project. Passing "portfolio" aggregates the same
 * domain across every project it competes in, and leaves `competitorId` null
 * because there is no single record to open.
 */
export function getSnapshotRivals(
  projectId: string,
): readonly SnapshotRival[] {
  const portfolio = projectId === "portfolio";
  const records = portfolio
    ? getCompetitorRecords()
    : competitorsForProject(projectId);

  const gapsByCompetitor = new Map<string, number>();
  for (const gap of getCompetitorGapFindings()) {
    gapsByCompetitor.set(
      gap.competitorId,
      (gapsByCompetitor.get(gap.competitorId) ?? 0) + 1,
    );
  }

  const byDomain = new Map<string, SnapshotRival>();

  for (const record of records) {
    const gaps = gapsByCompetitor.get(record.id) ?? 0;
    const existing = byDomain.get(record.domain);

    if (existing === undefined) {
      byDomain.set(record.domain, {
        domain: record.domain,
        name: record.name,
        competitorId: portfolio ? null : record.id,
        threatLevel: record.threatLevel,
        threatScore: record.threat.score,
        sharedKeywords: record.sharedKeywords,
        competitorOnly: record.competitorOnly,
        theirWins: record.theirWins,
        gaps,
      });
      continue;
    }

    // Aggregating across projects: the counts add up, and the threat shown is
    // the worst this domain poses anywhere.
    byDomain.set(record.domain, {
      ...existing,
      competitorId: null,
      threatScore: Math.max(existing.threatScore, record.threat.score),
      threatLevel:
        record.threat.score > existing.threatScore
          ? record.threatLevel
          : existing.threatLevel,
      sharedKeywords: existing.sharedKeywords + record.sharedKeywords,
      competitorOnly: existing.competitorOnly + record.competitorOnly,
      theirWins: existing.theirWins + record.theirWins,
      gaps: existing.gaps + gaps,
    });
  }

  return [...byDomain.values()].sort((a, b) => b.threatScore - a.threatScore);
}

/** Headline competitive counts for one project, for a summary panel. */
export function getSnapshotCounts(projectId: string): {
  readonly tracked: number;
  readonly sharedKeywords: number;
  readonly competitorOnly: number;
  readonly gaps: number;
  readonly threats: number;
  readonly topThreat: string | null;
} {
  const rivals = getSnapshotRivals(projectId);
  const scope =
    projectId === "portfolio"
      ? getCompetitorRecords()
      : competitorsForProject(projectId);
  const ids = new Set(scope.map((record) => record.id));

  return {
    tracked: rivals.length,
    // Counted over distinct keywords, not over rows: a term contested by three
    // rivals is one contested term.
    sharedKeywords: new Set(
      getOverlapRows()
        .filter((row) => ids.has(row.competitorId) && row.overlap === "shared")
        .map((row) => row.keywordId),
    ).size,
    competitorOnly: new Set(
      getOverlapRows()
        .filter(
          (row) => ids.has(row.competitorId) && row.overlap === "theirs-only",
        )
        .map((row) => row.keywordId),
    ).size,
    gaps: getCompetitorGapFindings().filter((gap) => ids.has(gap.competitorId))
      .length,
    threats: getSerpThreats().filter((threat) => ids.has(threat.competitorId))
      .length,
    topThreat: rivals[0]?.name ?? null,
  };
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

/** Everything one competitor's workspace needs, or null for an unknown id. */
export function getCompetitorDetail(
  competitorId: string,
): CompetitorDetail | null {
  const record = getCompetitorRecord(competitorId);
  if (!record) return null;

  const overlap = overlapForCompetitor(competitorId);
  const pages = pagesForCompetitor(competitorId);

  return {
    record,
    overlap,
    pages,
    clusters: battlegroundsForCompetitor(competitorId),
    gaps: gapsForCompetitor(competitorId),
    threats: threatsForCompetitor(competitorId),
    opportunities: opportunitiesForCompetitor(competitorId),
    metrics: getCompetitorMetrics([record], overlap),
    alsoIn: getCompetitorRecords().filter(
      (entry) => entry.domain === record.domain && entry.id !== record.id,
    ),
    siblings: competitorsForProject(record.projectId)
      .filter((entry) => entry.id !== record.id)
      .sort((a, b) => b.threat.score - a.threat.score),
    generatedAt: COMPETITORS_AS_OF,
  };
}

// ---------------------------------------------------------------------------
// Dataset shape, for the development inspector
// ---------------------------------------------------------------------------

/** Record counts across the module, for `/dev/data`. */
export function getCompetitorDatasetCounts(): readonly {
  readonly label: string;
  readonly count: number;
}[] {
  const rows = getOverlapRows();

  return [
    { label: "Competitor records", count: getCompetitorRecords().length },
    { label: "Modelled competitor pages", count: getCompetitorPages().length },
    { label: "Keyword overlap rows", count: rows.length },
    {
      label: "Cluster presence rows",
      count: getClusterPresence().length,
    },
    {
      label: "Contested rankings",
      count: rows.filter((row) => row.theirPosition !== null).length,
    },
    {
      label: "Attackable rankings",
      count: countBattles(rows, ATTACKABLE_BATTLES),
    },
  ];
}

/** A rough share of a project's keyword set a rival covers, 0-100. */
export function footprintShareOf(record: CompetitorRecord): number {
  const total = getKeywordRecords().filter(
    (entry) => entry.projectId === record.projectId,
  ).length;
  return total === 0
    ? 0
    : Math.round(clamp((record.keywordFootprint / total) * 100, 0, 100));
}
