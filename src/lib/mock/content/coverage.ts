import { round } from "@/lib/mock/dashboard/core";
import {
  INTENT_ORDER,
  getContentGaps,
  getKeywordClusters,
  getKeywordRecords,
} from "@/lib/mock/keywords";
import { FORMAT_FOR_INTENT, FORMAT_META } from "@/lib/mock/content/meta";
import { getContentRecords } from "@/lib/mock/content/records";
import type { ContentGapType, KeywordRecord } from "@/types/keyword";
import type {
  ClusterCoverageRow,
  ContentGapKind,
  ContentGapOpportunity,
  ContentRecord,
  IntentAlignmentRow,
  KeywordMappingRow,
  MappingQuality,
} from "@/types/content";

/**
 * Three readings of the same question: is every keyword we care about being
 * served by something, and is that something any good?
 *
 * **Mapping** answers it per keyword. **Coverage** answers it per cluster.
 * **Gaps** answers it as a queue of work. All three are readings of the
 * canonical content records and the canonical keyword records — none of them
 * holds a count of its own, which is why a cluster reporting three gaps here
 * lists exactly three rows in the gap view and three missing pages in the
 * Keyword Intelligence module.
 */

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((carry, value) => carry + value, 0) / values.length;
}

// ---------------------------------------------------------------------------
// Keyword to content mapping
// ---------------------------------------------------------------------------

/**
 * How well one keyword is served.
 *
 * Four readings, and every keyword in the registry lands in one of them:
 * either a live page owns it, a live page carries it alongside something else,
 * several of our pages are fighting over it, or nothing is live for it yet.
 *
 * There is no fifth "unmapped" state, because there is nothing for it to
 * describe: a keyword with no page already produces a planned piece in the
 * content layer, and that piece is what `planned` names. The mirror image —
 * a *page* with no keyword — is a real finding, and `getUnmappedPages` below
 * is where it is reported.
 */
function qualityFor(
  keyword: KeywordRecord,
  serving: ContentRecord | null,
): { readonly quality: MappingQuality; readonly note: string } {
  if (!serving || serving.url === null) {
    const stage = serving?.stage ?? "idea";
    return {
      quality: "planned",
      note:
        stage === "idea"
          ? "Identified as worth writing, but nothing has been committed to it."
          : `A piece is at ${stage} and has not been published yet.`,
    };
  }

  if (keyword.competingUrls.length > 0) {
    return {
      quality: "split",
      note: `${keyword.competingUrls.length + 1} of our pages rank for this term, dividing the clicks between them.`,
    };
  }

  if (serving.primaryKeywordId === keyword.id) {
    return {
      quality: "primary",
      note: "The query this page was built to win.",
    };
  }

  return {
    quality: "secondary",
    note: `Served by a page whose main target is “${serving.primaryKeyword ?? serving.title}”.`,
  };
}

let mappingCache: readonly KeywordMappingRow[] | null = null;

/** Every keyword, and the content serving it. */
export function getKeywordMapping(): readonly KeywordMappingRow[] {
  if (mappingCache) return mappingCache;

  const records = getContentRecords();
  const servingByKeyword = new Map<string, ContentRecord>();
  for (const record of records) {
    for (const keywordId of record.keywordIds) {
      servingByKeyword.set(keywordId, record);
    }
  }

  mappingCache = getKeywordRecords()
    .map((keyword) => {
      const serving = servingByKeyword.get(keyword.id) ?? null;
      const { quality, note } = qualityFor(keyword, serving);

      return {
        keywordId: keyword.id,
        keyword: keyword.keyword,
        intent: keyword.intent,
        volume: keyword.volume,
        position: keyword.position,
        projectId: keyword.projectId,
        projectName: keyword.projectName,
        clusterId: keyword.clusterId,
        clusterName: keyword.clusterName,
        contentId: serving?.id ?? null,
        contentTitle: serving?.title ?? null,
        contentUrl: serving?.url ?? null,
        stage: serving?.stage ?? null,
        quality,
        note,
      } satisfies KeywordMappingRow;
    })
    .sort((a, b) => b.volume - a.volume || a.keyword.localeCompare(b.keyword));

  return mappingCache;
}

/** Pages with no keyword mapped to them — a page nobody targeted. */
export function getUnmappedPages(): readonly ContentRecord[] {
  return getContentRecords()
    .filter((record) => record.url !== null && record.primaryKeywordId === null)
    .sort((a, b) => a.projectName.localeCompare(b.projectName));
}

// ---------------------------------------------------------------------------
// Cluster coverage
// ---------------------------------------------------------------------------

function nextActionFor(input: {
  readonly gaps: number;
  readonly hasPillar: boolean;
  readonly inProgress: number;
  readonly averageScore: number;
  readonly clusterName: string;
}): string {
  if (!input.hasPillar) {
    return "Publish the pillar — the supporting pages have nothing to point at.";
  }
  if (input.gaps > 0) {
    return `Brief the ${input.gaps} keyword${input.gaps === 1 ? "" : "s"} with no page before optimising anything already published.`;
  }
  if (input.inProgress > 0) {
    return `${input.inProgress} piece${input.inProgress === 1 ? "" : "s"} in the pipeline. Ship those, then re-measure the cluster.`;
  }
  if (input.averageScore < 65) {
    return "Coverage is complete; the pages themselves are what is holding the cluster back.";
  }
  return "Covered and scoring well. Defend it and keep the pages current.";
}

let coverageCache: readonly ClusterCoverageRow[] | null = null;

/** Content coverage of every topic cluster, thinnest first. */
export function getClusterCoverage(): readonly ClusterCoverageRow[] {
  if (coverageCache) return coverageCache;

  const records = getContentRecords();

  coverageCache = getKeywordClusters()
    .map((cluster) => {
      const pieces = records.filter(
        (record) => record.clusterId === cluster.id,
      );
      const published = pieces.filter((record) => record.url !== null);
      const inProgress = pieces.length - published.length;
      const pillar = pieces.find((record) => record.role === "pillar") ?? null;

      const averageScore = Math.round(
        mean(published.map((record) => record.score.score)),
      );

      return {
        clusterId: cluster.id,
        clusterName: cluster.name,
        parentTopic: cluster.parentTopic,
        projectId: cluster.projectId,
        projectName: cluster.projectName,
        keywordCount: cluster.keywordCount,
        totalVolume: cluster.totalVolume,
        pieces: pieces.length,
        published: published.length,
        inProgress,
        // The keyword layer already decides what share of a cluster has a page
        // behind it. Reading its figure rather than recomputing one means the
        // two modules cannot report different coverage for the same cluster.
        coverage: cluster.coverage,
        averageScore,
        gaps: cluster.contentGaps,
        hasPillar: cluster.targetUrl !== null,
        pillarId: pillar?.url === null ? null : (pillar?.id ?? null),
        owner: cluster.owner,
        nextAction: nextActionFor({
          gaps: cluster.contentGaps,
          hasPillar: cluster.targetUrl !== null,
          inProgress,
          averageScore,
          clusterName: cluster.name,
        }),
      } satisfies ClusterCoverageRow;
    })
    .sort(
      (a, b) =>
        a.coverage - b.coverage ||
        b.totalVolume - a.totalVolume ||
        a.clusterName.localeCompare(b.clusterName),
    );

  return coverageCache;
}

// ---------------------------------------------------------------------------
// Intent alignment
// ---------------------------------------------------------------------------

/** How each intent is served across the inventory. */
export function getIntentAlignment(
  records: readonly ContentRecord[],
): readonly IntentAlignmentRow[] {
  const keywords = getKeywordRecords();

  return INTENT_ORDER.map((intent) => {
    const pieces = records.filter((record) => record.primaryIntent === intent);
    const matchingKeywords = keywords.filter(
      (record) => record.intent === intent,
    );

    const aligned = pieces.filter(
      (record) => record.intentAlignment === "aligned",
    ).length;
    const partial = pieces.filter(
      (record) => record.intentAlignment === "partial",
    ).length;
    const mismatched = pieces.filter(
      (record) => record.intentAlignment === "mismatched",
    ).length;

    return {
      intent,
      keywordCount: matchingKeywords.length,
      pieces: pieces.length,
      aligned,
      partial,
      mismatched,
      volume: pieces.reduce((carry, record) => carry + record.totalVolume, 0),
      alignmentRate:
        pieces.length === 0 ? 0 : round((aligned / pieces.length) * 100, 0),
      expectedFormat: FORMAT_FOR_INTENT[intent],
    } satisfies IntentAlignmentRow;
  }).filter((row) => row.pieces > 0 || row.keywordCount > 0);
}

// ---------------------------------------------------------------------------
// Content gaps
// ---------------------------------------------------------------------------

/**
 * The keyword module's gap types, in this module's language.
 *
 * A weak page and a thin one are the same commissioning decision — rewrite
 * what is there — so they collapse into one kind here rather than splitting a
 * queue that would be worked the same way.
 */
const GAP_KIND_FOR: Record<ContentGapType, ContentGapKind> = {
  "no-page": "no-page",
  "competitor-only": "competitor-only",
  "thin-coverage": "thin",
  "weak-content": "thin",
  outdated: "outdated",
};

let gapCache: readonly ContentGapOpportunity[] | null = null;

/**
 * Every piece worth commissioning, biggest opportunity first.
 *
 * The keyword-level findings come from the Keyword Intelligence module
 * unchanged, so a gap counted there is the same gap counted here. The one
 * addition is structural: a cluster with no pillar is a missing page that no
 * single keyword can report, because the pillar is what the whole cluster
 * needs rather than any one term.
 */
export function getContentGapOpportunities(): readonly ContentGapOpportunity[] {
  if (gapCache) return gapCache;

  const records = getContentRecords();
  const servingByKeyword = new Map<string, ContentRecord>();
  for (const record of records) {
    for (const keywordId of record.keywordIds) {
      servingByKeyword.set(keywordId, record);
    }
  }

  const fromKeywords: ContentGapOpportunity[] = getContentGaps().map((gap) => {
    const serving = servingByKeyword.get(gap.keywordId) ?? null;
    const kind = GAP_KIND_FOR[gap.gapType];
    const keyword = getKeywordRecords().find(
      (entry) => entry.id === gap.keywordId,
    );

    return {
      id: `content-gap--${gap.id}`,
      kind,
      title: serving?.title ?? gap.keyword,
      clusterId: keyword?.clusterId ?? "",
      clusterName: keyword?.clusterName ?? "Unclustered",
      projectId: gap.projectId,
      projectName: gap.projectName,
      keywordId: gap.keywordId,
      keyword: gap.keyword,
      intent: gap.intent,
      volume: gap.volume,
      difficulty: gap.difficulty,
      opportunityScore: gap.opportunityScore,
      suggestedFormat: FORMAT_FOR_INTENT[gap.intent],
      trafficPotential: keyword?.trafficPotential ?? 0,
      competitor: gap.competitorName,
      reason:
        kind === "no-page"
          ? `${gap.competitorName} ranks at ${gap.competitorRank} and we have no page at all.`
          : kind === "competitor-only"
            ? `${gap.competitorName} ranks at ${gap.competitorRank}; we have a page and it does not reach the top 100.`
            : kind === "outdated"
              ? `The page has aged out of what now ranks; ${gap.competitorName} sits at ${gap.competitorRank}.`
              : `Our coverage is too slight to compete with ${gap.competitorName} at ${gap.competitorRank}.`,
      owner: gap.owner,
      contentId: serving?.id ?? null,
    } satisfies ContentGapOpportunity;
  });

  const fromClusters: ContentGapOpportunity[] = getKeywordClusters()
    .filter((cluster) => cluster.targetUrl === null)
    .map((cluster) => {
      const pillar = records.find(
        (record) => record.clusterId === cluster.id && record.role === "pillar",
      );
      const lead = getKeywordRecords()
        .filter((entry) => entry.clusterId === cluster.id)
        .sort((a, b) => b.volume - a.volume)[0];

      return {
        id: `content-gap--pillar--${cluster.id}`,
        kind: "no-pillar" as const,
        title: pillar?.title ?? `${cluster.name} hub`,
        clusterId: cluster.id,
        clusterName: cluster.name,
        projectId: cluster.projectId,
        projectName: cluster.projectName,
        keywordId: lead?.id ?? "",
        keyword: lead?.keyword ?? cluster.name,
        intent: cluster.primaryIntent,
        volume: cluster.totalVolume,
        difficulty: cluster.averageDifficulty,
        opportunityScore: cluster.opportunityScore,
        suggestedFormat: FORMAT_FOR_INTENT[cluster.primaryIntent],
        trafficPotential: cluster.trafficPotential,
        competitor: null,
        reason: `${cluster.keywordCount} keywords in this cluster with no hub page anchoring them.`,
        owner: cluster.owner,
        contentId: pillar?.id ?? null,
      } satisfies ContentGapOpportunity;
    });

  gapCache = [...fromKeywords, ...fromClusters].sort(
    (a, b) =>
      b.opportunityScore - a.opportunityScore || b.volume - a.volume,
  );

  return gapCache;
}

/** The suggested format for a gap, spelled out. */
export function gapFormatLabel(gap: ContentGapOpportunity): string {
  return FORMAT_META[gap.suggestedFormat].label;
}
