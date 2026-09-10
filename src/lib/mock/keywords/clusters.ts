import { formatCompact } from "@/lib/format";
import { round } from "@/lib/mock/dashboard/core";
import { PROJECTS } from "@/lib/mock/projects/roster";
import { KEYWORD_REGISTRY } from "@/lib/mock/keywords/registry";
import { getKeywordRecords } from "@/lib/mock/keywords/builders";
import {
  INTENT_ORDER,
  RANKING_STATUS_ORDER,
  SUGGESTED_CONTENT_TYPE,
} from "@/lib/mock/keywords/meta";
import type {
  AgentId,
  ClusterPage,
  ClusterStatus,
  KeywordCluster,
  KeywordIntent,
  KeywordRecord,
  RankingStatus,
} from "@/types/keyword";

/**
 * Topic clusters, derived from the keywords in them.
 *
 * A cluster holds no keyword data of its own: its volume is the sum of its
 * keywords' volumes, its difficulty is their mean, its coverage is the share
 * of them with a page behind it. Change a keyword in the registry and the
 * cluster changes with it, because the cluster is a reading of the keywords
 * rather than a second record that has to be kept in step.
 *
 * The pages a cluster needs are worked out the same way. Distinct target URLs
 * across the cluster become the supporting pages that exist; keywords with no
 * target become the pages that do not, complete with the format the intent
 * calls for. That is what makes the content-gap count on a cluster the same
 * number the gap view lists.
 */

/** A readable page title from a URL path. */
function titleFromUrl(url: string): string {
  const last = url.split("/").filter(Boolean).pop() ?? "home";
  const words = last.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((carry, value) => carry + value, 0) / values.length;
}

/**
 * How a cluster reads, tested in the order a practitioner would ask.
 *
 * Missing pages come first, because nothing else matters until the pages
 * exist. A cluster with no pillar is planned rather than partial — the
 * supporting pages have nothing to point at. Only then does performance
 * decide, and a covered cluster that is losing places is at risk rather than
 * covered.
 */
function statusFor(
  coverage: number,
  rankingCoverage: number,
  averageChange: number,
  hasPillar: boolean,
): ClusterStatus {
  if (coverage < 70) return "gap";
  if (!hasPillar) return "planned";
  if (averageChange <= -1.5) return "at-risk";
  if (coverage >= 95 && rankingCoverage >= 55) return "covered";
  return "partial";
}

/** Who owns the next move on a cluster. Canonical agent ids only. */
function ownerFor(status: ClusterStatus, intent: KeywordIntent): AgentId {
  if (status === "gap" || status === "planned") return "content-strategist";
  if (status === "at-risk") return "on-page-seo";
  if (intent === "informational" || intent === "mixed") return "ai-visibility";
  return "keyword-intent";
}

function nextActionFor(
  status: ClusterStatus,
  gaps: number,
  name: string,
): string {
  switch (status) {
    case "gap":
      return `Brief the ${gaps} missing pages before anything else in ${name} is optimised.`;
    case "planned":
      return `Publish the pillar page — the supporting pages have nothing to point at.`;
    case "at-risk":
      return `Audit the pages that are slipping and refresh the weakest first.`;
    case "partial":
      return gaps > 0
        ? `Close the last ${gaps} gaps, then push the page-two keywords onto page one.`
        : `Push the page-two keywords onto page one with on-page work.`;
    case "covered":
      return `Hold the coverage and defend the answer-engine citations.`;
  }
}

/** The pages a cluster needs, existing and missing. */
function pagesFor(
  keywords: readonly KeywordRecord[],
  pillarUrl: string | null,
  pillarTitle: string,
  clusterId: string,
): readonly ClusterPage[] {
  const pages: ClusterPage[] = [
    {
      id: `${clusterId}--pillar`,
      title: pillarTitle,
      role: "pillar",
      url: pillarUrl,
      keywordCount: keywords.filter((entry) => entry.targetUrl === pillarUrl)
        .length,
      exists: pillarUrl !== null,
      contentType: "Pillar page",
    },
  ];

  const supporting = new Map<string, number>();
  for (const keyword of keywords) {
    if (keyword.targetUrl === null || keyword.targetUrl === pillarUrl) continue;
    supporting.set(
      keyword.targetUrl,
      (supporting.get(keyword.targetUrl) ?? 0) + 1,
    );
  }

  for (const [url, count] of supporting) {
    pages.push({
      id: `${clusterId}--${url}`,
      title: titleFromUrl(url),
      role: "supporting",
      url,
      keywordCount: count,
      exists: true,
      contentType: "Supporting page",
    });
  }

  for (const keyword of keywords) {
    if (keyword.targetUrl !== null) continue;
    pages.push({
      id: `${clusterId}--missing-${keyword.id}`,
      title: `Coverage for "${keyword.keyword}"`,
      role: "supporting",
      url: null,
      keywordCount: 1,
      exists: false,
      contentType: SUGGESTED_CONTENT_TYPE[keyword.intent],
    });
  }

  return pages;
}

let cache: readonly KeywordCluster[] | null = null;

/** Every cluster in the product, highest opportunity first within a project. */
export function getKeywordClusters(): readonly KeywordCluster[] {
  cache ??= build();
  return cache;
}

function build(): readonly KeywordCluster[] {
  const records = getKeywordRecords();
  const clusters: KeywordCluster[] = [];

  for (const entry of KEYWORD_REGISTRY) {
    const project = PROJECTS.find((item) => item.id === entry.projectId);
    if (!project) continue;

    for (const seed of entry.clusters) {
      const id = `${project.id}--${seed.key}`;
      const keywords = records.filter((record) => record.clusterId === id);
      if (keywords.length === 0) continue;

      const withPage = keywords.filter((record) => record.targetUrl !== null);
      const ranking = keywords.filter(
        (record) => record.position !== null && record.position <= 20,
      );

      const coverage = round((withPage.length / keywords.length) * 100, 0);
      const rankingCoverage = round(
        (ranking.length / keywords.length) * 100,
        0,
      );
      const contentGaps = keywords.length - withPage.length;
      const averageChange = mean(keywords.map((record) => record.change));

      const intentMix = new Map<KeywordIntent, number>();
      for (const intent of INTENT_ORDER) {
        const count = keywords.filter(
          (record) => record.intent === intent,
        ).length;
        if (count > 0) intentMix.set(intent, count);
      }

      const primaryIntent =
        [...intentMix.entries()].sort(
          (a, b) =>
            b[1] - a[1] ||
            INTENT_ORDER.indexOf(a[0]) - INTENT_ORDER.indexOf(b[0]),
        )[0]?.[0] ?? "informational";

      const distribution = new Map<RankingStatus, number>();
      for (const band of RANKING_STATUS_ORDER) {
        distribution.set(
          band,
          keywords.filter((record) => record.rankingStatus === band).length,
        );
      }

      const status = statusFor(
        coverage,
        rankingCoverage,
        averageChange,
        seed.pillarUrl !== null,
      );

      clusters.push({
        id,
        name: seed.name,
        parentTopic: seed.parentTopic,
        projectId: project.id,
        projectName: project.name,
        keywordIds: keywords.map((record) => record.id),
        keywordCount: keywords.length,
        totalVolume: keywords.reduce((carry, record) => carry + record.volume, 0),
        averageDifficulty: Math.round(
          mean(keywords.map((record) => record.difficulty)),
        ),
        opportunityScore: Math.round(
          mean(keywords.map((record) => record.opportunity.score)),
        ),
        coverage,
        rankingCoverage,
        contentGaps,
        primaryIntent,
        intentMix,
        targetUrl: seed.pillarUrl,
        owner: ownerFor(status, primaryIntent),
        status,
        pages: pagesFor(keywords, seed.pillarUrl, seed.pillarTitle, id),
        distribution,
        nextAction: nextActionFor(status, contentGaps, seed.name),
        trafficPotential: keywords.reduce(
          (carry, record) => carry + record.trafficPotential,
          0,
        ),
      });
    }
  }

  return clusters.sort(
    (a, b) =>
      a.projectName.localeCompare(b.projectName) ||
      b.opportunityScore - a.opportunityScore,
  );
}

/** One cluster by id. */
export function getClusterRecord(id: string): KeywordCluster | undefined {
  return getKeywordClusters().find((cluster) => cluster.id === id);
}

/** Clusters belonging to one project. */
export function clustersForProject(
  projectId: string,
): readonly KeywordCluster[] {
  return getKeywordClusters().filter(
    (cluster) => cluster.projectId === projectId,
  );
}

/** Options for the cluster filter, grouped by project name. */
export function clusterOptions(): readonly {
  readonly id: string;
  readonly label: string;
}[] {
  return getKeywordClusters().map((cluster) => ({
    id: cluster.id,
    label: `${cluster.name} · ${cluster.projectName}`,
  }));
}

/** Pre-formatted volume, used where a cluster is summarised in one line. */
export function clusterSummaryLine(cluster: KeywordCluster): string {
  return `${cluster.keywordCount} keywords · ${formatCompact(cluster.totalVolume)} searches / mo · difficulty ${cluster.averageDifficulty}`;
}
