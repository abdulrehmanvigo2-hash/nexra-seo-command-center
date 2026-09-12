import { DATA_AS_OF } from "@/lib/mock/dashboard/core";
import {
  CONTENT_RANGE,
  getContentRecords,
  keywordsForContent,
} from "@/lib/mock/content";
import { agentReachFor, technicalPageForContent } from "@/lib/mock/technical";
import { buildAnswerReadiness } from "@/lib/mock/ai-visibility/answer-readiness";
import { buildCitationReadiness } from "@/lib/mock/ai-visibility/citations";
import { buildEvidence } from "@/lib/mock/ai-visibility/evidence";
import { buildInformationGain } from "@/lib/mock/ai-visibility/information-gain";
import { entitiesForCluster } from "@/lib/mock/ai-visibility/entities";
import { mean, visibilityScore } from "@/lib/mock/ai-visibility/scoring";
import type { AiPageRecord } from "@/types/ai-visibility";

/**
 * The AI page inventory.
 *
 * Derived, never authored. Content Studio owns the pages this product has and
 * Technical SEO owns their response and indexing; an AI page record is those
 * two read for answer engines, referenced by id. There is no third inventory
 * to keep in step.
 *
 * Only published records appear. An unpublished draft has no URL for an answer
 * engine to reach, no technical record, and nothing to extract — putting a
 * readiness score against it would be scoring a page that does not exist.
 *
 * Dependency direction is one-way: this module reads keywords, content and
 * technical. None of those read back at the data layer.
 */

export const AI_AS_OF = DATA_AS_OF;
export const AI_RANGE = CONTENT_RANGE;

let cache: readonly AiPageRecord[] | null = null;

function build(): readonly AiPageRecord[] {
  return getContentRecords()
    .filter((record) => record.url !== null)
    .map((record) => {
      const keywords = keywordsForContent(record);
      const technical = technicalPageForContent(record.id);

      const answer = buildAnswerReadiness({ record, keywords });
      const evidence = buildEvidence(record);
      const gain = buildInformationGain(record, evidence);
      const citation = buildCitationReadiness({
        record,
        technical,
        answer,
        evidence,
        gain,
      });

      // Entities this page could be a source for: the ones its cluster
      // depends on, plus the project-wide ones. Which of those it actually
      // carries is decided by the entity layer, so the two agree.
      const entities = entitiesForCluster(record.clusterId, record.projectId);
      const pageId = `ai-${record.id}`;
      const owned = entities.filter((entity) => entity.pageIds.includes(pageId));
      const entityCoverage =
        entities.length === 0
          ? 0
          : Math.round(
              // Coverage is how well the entities this page should serve are
              // served — weighted toward the ones it actually carries, since a
              // page is not responsible for entities it never mentions.
              mean(owned.map((entity) => entity.strength.score)) * 0.7 +
                mean(entities.map((entity) => entity.strength.score)) * 0.3,
            );

      const topicCoverage = Math.round(
        mean([record.aeo.questionCoverage, record.score.score]),
      );

      // Technical access is two questions, and both are Technical SEO's to
      // answer: is the URL sound, and may a generative crawler fetch it. A
      // page can be flawless on the first and shut out on the second, so the
      // dimension reads both rather than the page score alone.
      const technicalScore = technical?.score.score ?? 0;
      const agentReach = technical === null ? 0 : agentReachFor(technical);
      const technicalAccess = Math.round(technicalScore * 0.65 + agentReach * 0.35);
      const technicalBlocked = citation.blocked;

      const visibility = visibilityScore(
        {
          "answer-readiness": answer.score.score,
          evidence: evidence.score.score,
          "citation-readiness": citation.score.score,
          "entity-coverage": entityCoverage,
          "topic-coverage": topicCoverage,
          "technical-access": technicalAccess,
        },
        { technicalBlocked, gainConfidence: gain.confidence },
      );

      // -- what is right and wrong with it -------------------------------
      const strengths: string[] = [];
      const weaknesses: string[] = [];

      if (answer.score.score >= 70) {
        strengths.push("Answers the questions its keywords ask, directly.");
      }
      if (evidence.band === "robust") {
        strengths.push(
          `${evidence.supportedClaims} supported claims across ${evidence.diversity} kinds of evidence.`,
        );
      }
      if (citation.state === "citation-ready") {
        strengths.push(
          `${citation.quotableFacts} claims specific enough to be lifted and attributed.`,
        );
      }
      if (gain.band === "distinctive" && gain.confidence !== "unknown") {
        strengths.push("Appears to carry material the consensus answer does not.");
      }
      if (technicalAccess >= 85) {
        strengths.push(
          "Technically clean — reachable, indexable, canonical, and open to generative crawlers.",
        );
      }
      if (technicalScore >= 70 && agentReach < 50) {
        weaknesses.push(
          "The URL is sound, but robots.txt keeps generative crawlers off it.",
        );
      }
      if (entityCoverage >= 70) {
        strengths.push("The things this page is about are clearly established.");
      }

      if (technicalBlocked) {
        weaknesses.push(
          "The URL cannot be reached or indexed, which blocks everything else here.",
        );
      }
      if (evidence.unsupportedClaims > evidence.supportedClaims) {
        weaknesses.push(
          `${evidence.unsupportedClaims} claims carry nothing behind them.`,
        );
      }
      if (answer.score.score < 50) {
        weaknesses.push(answer.reasons[0] ?? "No clear answer to lift.");
      }
      if (entityCoverage < 45) {
        weaknesses.push("The entities this page should own are thinly covered.");
      }
      if (gain.confidence === "unknown") {
        weaknesses.push(
          "Nothing establishes whether this page adds anything original.",
        );
      } else if (gain.band === "derivative") {
        weaknesses.push("Restates what is already widely available.");
      }
      if (record.cannibalised) {
        weaknesses.push("Another page of ours competes for the same terms.");
      }

      return {
        id: pageId,
        contentId: record.id,
        technicalPageId: technical?.id ?? null,
        title: record.title,
        url: record.url,
        path: (record.url as string).replace(/^https?:\/\/[^/]+/, "") || "/",
        format: record.format,
        projectId: record.projectId,
        projectName: record.projectName,
        clusterId: record.clusterId,
        clusterName: record.clusterName,
        primaryIntent: record.primaryIntent,
        keywordIds: record.keywordIds,
        questionKeywords: keywords.filter((entry) => entry.ai.questionFormat)
          .length,
        visibility,
        answer,
        evidence,
        citation,
        gain,
        entityIds: owned.map((entity) => entity.id),
        entityCoverage,
        technicalScore,
        strengths,
        weaknesses,
        // Filled by the gap layer, which is the only thing that decides what
        // is wrong with a page. Assigned there rather than guessed here.
        gapIds: [],
        owner: record.owner,
        seed: record.seed,
      } satisfies AiPageRecord;
    });
}

/**
 * The inventory before any gap is attached.
 *
 * The gap layer reads these and republishes them with their findings, so that
 * one place decides what is wrong with a page. Nothing outside `gaps.ts`
 * should call this.
 */
export function getBaseAiPages(): readonly AiPageRecord[] {
  cache ??= build();
  return cache;
}
