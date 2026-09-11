import { getKeywordClusters, getKeywordRecord } from "@/lib/mock/keywords";
import { entitiesForCluster, entityCoverageOf } from "@/lib/mock/ai-visibility/entities";
import { getAiPages } from "@/lib/mock/ai-visibility/gaps";
import {
  DIMENSION_META,
  mean,
  topicStateFor,
  visibilityScore,
} from "@/lib/mock/ai-visibility/scoring";
import type {
  AiDimensionId,
  AiTopicRecord,
} from "@/types/ai-visibility";
import type { KeywordRecord } from "@/types/keyword";

/**
 * Clusters, read for answer engines.
 *
 * The cluster itself stays where it is. A topic record holds no keyword list,
 * no volume, no difficulty and no coverage percentage of its own — all of that
 * belongs to the canonical keyword layer and is referenced by `clusterId`.
 * What this adds is the answer-engine reading of the pages mapped to it.
 *
 * A topic's visibility is a roll-up of its pages, not a separate calculation,
 * so a topic score always reconciles with the pages beneath it.
 */

let cache: readonly AiTopicRecord[] | null = null;

function build(): readonly AiTopicRecord[] {
  const pages = getAiPages();

  return getKeywordClusters().map((cluster) => {
    const mine = pages.filter((page) => page.clusterId === cluster.id);
    const entities = entitiesForCluster(cluster.id, cluster.projectId);

    const keywords = cluster.keywordIds
      .map((id) => getKeywordRecord(id))
      .filter((entry): entry is KeywordRecord => entry !== undefined);
    const questionKeywords = keywords.filter(
      (entry) => entry.ai.questionFormat,
    ).length;

    const answerReadiness = Math.round(
      mean(mine.map((page) => page.answer.score.score)),
    );
    const evidenceStrength = Math.round(
      mean(mine.map((page) => page.evidence.score.score)),
    );
    const citationReadiness = Math.round(
      mean(mine.map((page) => page.citation.score.score)),
    );
    const technicalHealth = Math.round(
      mean(mine.map((page) => page.technicalScore)),
    );
    const entityCoverage = entityCoverageOf(entities);

    // Topic coverage is the canonical cluster's own reading, not a second
    // one: the keyword layer already decides how much of a cluster has a page
    // behind it, and disagreeing with it here would put two numbers on screen
    // for the same question.
    const topicCoverage = Math.round(cluster.coverage);

    const meanDepth = Math.round(
      mean(
        mine.map(
          (page) =>
            page.answer.signals.find((entry) => entry.id === "supporting-depth")
              ?.value ?? 0,
        ),
      ),
    );

    const visibility = visibilityScore(
      {
        "answer-readiness": answerReadiness,
        evidence: evidenceStrength,
        "citation-readiness": citationReadiness,
        "entity-coverage": entityCoverage,
        "topic-coverage": topicCoverage,
        "technical-access": technicalHealth,
      },
      {
        technicalBlocked: mine.length > 0 && mine.every((page) => page.citation.blocked),
        gainConfidence: "low",
      },
    );

    const dimensions: readonly { id: AiDimensionId; value: number }[] = [
      { id: "answer-readiness", value: answerReadiness },
      { id: "evidence", value: evidenceStrength },
      { id: "citation-readiness", value: citationReadiness },
      { id: "entity-coverage", value: entityCoverage },
      { id: "topic-coverage", value: topicCoverage },
      { id: "technical-access", value: technicalHealth },
    ];

    const weakest = [...dimensions].sort(
      (a, b) => a.value - b.value || a.id.localeCompare(b.id),
    )[0];

    const coverageState = topicStateFor(
      mine.length,
      cluster.keywordCount,
      meanDepth,
    );

    const biggestGap =
      mine.length === 0
        ? "No published page serves this topic at all."
        : coverageState === "fragmented"
          ? `${mine.length} pages each say a little, with none that owns the topic.`
          : `${DIMENSION_META[weakest.id].label} is the weakest dimension at ${weakest.value} out of 100.`;

    const nextAction =
      mine.length === 0
        ? `Publish a hub page for ${cluster.name}, then the supporting pages beneath it.`
        : weakest.id === "technical-access"
          ? "Clear the technical findings on this topic's pages before anything else."
          : weakest.id === "evidence"
            ? "Put support behind the claims on this topic's strongest page first."
            : weakest.id === "entity-coverage"
              ? `Define the entities ${cluster.name} depends on, starting with the weakest.`
              : weakest.id === "citation-readiness"
                ? "Tighten key claims into specific, self-contained statements."
                : weakest.id === "topic-coverage"
                  ? `Close the ${cluster.contentGaps} keyword gaps in this cluster.`
                  : "Answer the questions these pages draw, directly and near the top.";

    return {
      id: `topic-${cluster.id}`,
      clusterId: cluster.id,
      name: cluster.name,
      projectId: cluster.projectId,
      projectName: cluster.projectName,
      primaryIntent: cluster.primaryIntent,
      keywordCount: cluster.keywordCount,
      questionKeywords,
      pageIds: mine.map((page) => page.id),
      pageCount: mine.length,
      coverageState,
      visibility,
      answerReadiness,
      evidenceStrength,
      entityCoverage,
      citationReadiness,
      technicalHealth,
      entityIds: entities.map((entity) => entity.id),
      weakestDimension: weakest.id,
      biggestGap,
      nextAction,
      owner: cluster.owner,
    } satisfies AiTopicRecord;
  });
}

function built(): readonly AiTopicRecord[] {
  cache ??= build();
  return cache;
}

export function getAiTopics(): readonly AiTopicRecord[] {
  return built();
}

export function getAiTopic(id: string): AiTopicRecord | undefined {
  return built().find((entry) => entry.id === id);
}

export function topicsForProject(projectId: string): readonly AiTopicRecord[] {
  return built().filter((entry) => entry.projectId === projectId);
}

/** The topic a page belongs to. */
export function topicForCluster(clusterId: string): AiTopicRecord | undefined {
  return built().find((entry) => entry.clusterId === clusterId);
}
