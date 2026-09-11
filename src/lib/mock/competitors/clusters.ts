import { clamp, round } from "@/lib/mock/dashboard/core";
import { getKeywordClusters, getKeywordRecords } from "@/lib/mock/keywords";
import { getContentRecords } from "@/lib/mock/content";
import {
  clusterStrength,
  dominanceStateFor,
} from "@/lib/mock/competitors/scoring";
import {
  getClusterPresence,
  getOverlapRows,
} from "@/lib/mock/competitors/registry";
import type {
  AgentId,
  ClusterBattleground,
  ClusterRival,
  DominanceState,
} from "@/types/competitor";

/**
 * Topic clusters, read as contested ground.
 *
 * Our side of every row is canonical: the cluster's keyword count, its volume,
 * and its coverage come from the cluster record the Keyword Intelligence
 * module owns, and the pages come from the content inventory. Their side comes
 * from the cluster presence the registry already measured, using the same
 * strength function for both — so the two numbers on a row are comparable
 * rather than two different measurements printed next to each other.
 *
 * A cluster nobody has entered is `uncontested` rather than a win. Calling it
 * a win would flatter a topic where we may have published nothing either, and
 * the openings this view exists to find are exactly those.
 */

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((carry, value) => carry + value, 0) / values.length;
}

function actionFor(input: {
  readonly state: DominanceState;
  readonly clusterName: string;
  readonly dominant: ClusterRival | null;
  readonly coverage: number;
  readonly hasPillar: boolean;
  readonly ourPages: number;
  readonly rivalPages: number;
}): string {
  if (!input.hasPillar) {
    return `Publish the pillar for ${input.clusterName} — the supporting pages have nothing to point at while ${input.dominant?.name ?? "a rival"} has a hub.`;
  }

  switch (input.state) {
    case "they-lead":
      return `${input.dominant?.name ?? "A rival"} holds this topic with ${input.rivalPages} pages against our ${input.ourPages}. Match the depth before chasing individual terms.`;
    case "contested":
      return input.coverage < 85
        ? `Neither side holds it and our coverage is ${input.coverage}%. Close the missing pages first — that decides the topic.`
        : "Neither side holds it. On-page work and internal links across the cluster will settle it.";
    case "we-lead":
      return "We are ahead here. Keep the pages current and watch the pillar's position.";
    case "uncontested":
      return input.coverage < 85
        ? `No rival has entered this topic and our coverage is only ${input.coverage}%. Take it before somebody else does.`
        : "No rival is contesting this. Hold it cheaply and spend the effort elsewhere.";
  }
}

function ownerFor(state: DominanceState, hasPillar: boolean): AgentId {
  if (!hasPillar) return "content-strategist";
  switch (state) {
    case "they-lead":
      return "content-strategist";
    case "contested":
      return "on-page-seo";
    case "we-lead":
      return "analytics-learning";
    case "uncontested":
      return "keyword-intent";
  }
}

let cache: readonly ClusterBattleground[] | null = null;

/** Every cluster as a contested topic, most at risk first. */
export function getClusterBattlegrounds(): readonly ClusterBattleground[] {
  cache ??= build();
  return cache;
}

function build(): readonly ClusterBattleground[] {
  const clusters = getKeywordClusters();
  const keywords = getKeywordRecords();
  const content = getContentRecords();
  const presence = getClusterPresence();
  const rows = getOverlapRows();

  const presenceByCluster = new Map<string, typeof presence>();
  for (const entry of presence) {
    const bucket = presenceByCluster.get(entry.clusterId);
    if (bucket) (bucket as (typeof presence)[number][]).push(entry);
    else presenceByCluster.set(entry.clusterId, [entry]);
  }

  /** Keywords in a cluster that both sides rank for. */
  const sharedByCluster = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.overlap !== "shared") continue;
    const bucket = sharedByCluster.get(row.clusterId);
    if (bucket) bucket.add(row.keywordId);
    else sharedByCluster.set(row.clusterId, new Set([row.keywordId]));
  }

  /** Mean opportunity across the terms a rival holds in a cluster. */
  const opportunityByCluster = new Map<string, number[]>();
  for (const row of rows) {
    if (row.theirPosition === null) continue;
    const bucket = opportunityByCluster.get(row.clusterId);
    if (bucket) bucket.push(row.opportunity);
    else opportunityByCluster.set(row.clusterId, [row.opportunity]);
  }

  const battlegrounds: ClusterBattleground[] = [];

  for (const cluster of clusters) {
    const members = keywords.filter(
      (record) => record.clusterId === cluster.id,
    );
    const ourPositions = members
      .map((record) => record.position)
      .filter((value): value is number => value !== null);

    const pages = content.filter(
      (record) => record.clusterId === cluster.id && record.url !== null,
    );
    const hasPillar = pages.some((record) => record.role === "pillar");

    const ourStrength = clusterStrength({
      ranking: ourPositions.length,
      total: cluster.keywordCount,
      topTen: ourPositions.filter((position) => position <= 10).length,
      averagePosition: mean(ourPositions),
      pages: pages.length,
    });

    const rivals: readonly ClusterRival[] = (
      presenceByCluster.get(cluster.id) ?? []
    ).map((entry) => ({
      competitorId: entry.competitorId,
      name: entry.competitorName,
      domain: entry.competitorDomain,
      keywords: entry.keywords,
      topTen: entry.topTen,
      averagePosition: entry.averagePosition,
      pages: entry.pages,
      strength: entry.strength,
    }));

    const dominant =
      [...rivals].sort((a, b) => b.strength - a.strength)[0] ?? null;
    const state = dominanceStateFor(
      ourStrength,
      dominant?.strength ?? 0,
      rivals.length,
    );

    const opportunities = opportunityByCluster.get(cluster.id) ?? [];

    battlegrounds.push({
      clusterId: cluster.id,
      clusterName: cluster.name,
      projectId: cluster.projectId,
      projectName: cluster.projectName,
      intent: cluster.primaryIntent,

      keywordCount: cluster.keywordCount,
      totalVolume: cluster.totalVolume,

      ourKeywords: ourPositions.length,
      ourTopTen: ourPositions.filter((position) => position <= 10).length,
      ourAveragePosition:
        ourPositions.length === 0 ? null : round(mean(ourPositions) ?? 0, 1),
      coverage: cluster.coverage,
      ourPages: pages.length,
      hasPillar,
      supportingPages: pages.filter((record) => record.role === "supporting")
        .length,
      ourStrength,

      rivals,
      dominant: dominant && dominant.strength >= 15 ? dominant : null,
      sharedKeywords: sharedByCluster.get(cluster.id)?.size ?? 0,
      state,
      dominanceGap: (dominant?.strength ?? 0) - ourStrength,
      opportunity: Math.round(clamp(mean(opportunities) ?? 0, 0, 100)),

      action: actionFor({
        state,
        clusterName: cluster.name,
        dominant,
        coverage: cluster.coverage,
        hasPillar,
        ourPages: pages.length,
        rivalPages: dominant?.pages ?? 0,
      }),
      owner: ownerFor(state, hasPillar),
    });
  }

  return battlegrounds.sort(
    (a, b) => b.dominanceGap - a.dominanceGap || b.totalVolume - a.totalVolume,
  );
}

/** The clusters one competitor appears in, where it is strongest first. */
export function battlegroundsForCompetitor(
  competitorId: string,
): readonly ClusterBattleground[] {
  return getClusterBattlegrounds()
    .filter((entry) =>
      entry.rivals.some((rival) => rival.competitorId === competitorId),
    )
    .sort((a, b) => {
      const left =
        a.rivals.find((rival) => rival.competitorId === competitorId)
          ?.strength ?? 0;
      const right =
        b.rivals.find((rival) => rival.competitorId === competitorId)
          ?.strength ?? 0;
      return right - left;
    });
}
