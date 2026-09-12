import { clamp, jitter, round } from "@/lib/mock/dashboard/core";
import { healthOf } from "@/lib/health";
import { FORMAT_META } from "@/lib/mock/content/meta";
import type { ContentAeoSignal, ContentFormat } from "@/types/content";
import type { KeywordRecord } from "@/types/keyword";

/**
 * How ready a page is to be quoted by an answer engine.
 *
 * Every reading here is a roll-up of the answer-engine signals the keyword
 * layer already holds for the keywords the page targets. That module projects
 * whether a generated answer runs on a query, how relevant an answer would be,
 * what entity strength the topic demands, and whether anything of ours is
 * positioned to be drawn from it; this one asks the page-level version of the
 * same question — is this piece the thing that would get quoted?
 *
 * Projection throughout. No answer engine is queried, nothing here observes a
 * citation, and there is no second AEO dataset — the Phase 9 AI Visibility
 * module owns the full picture and this is the content slice of it
 * (CLAUDE.md §4, §14).
 */

/** Structured-data completeness a format is expected to reach. */
function structuredDataFor(
  format: ContentFormat,
  published: boolean,
  seed: number,
): number {
  if (!published) return 0;
  // Formats with an obvious schema type tend to have it; the loose ones
  // usually do not.
  const base =
    format === "product" || format === "location"
      ? 78
      : format === "guide" || format === "comparison"
        ? 62
        : format === "tool"
          ? 48
          : 44;
  return Math.round(clamp(base + jitter(seed, 101, 26), 4, 100));
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((carry, value) => carry + value, 0) / values.length;
}

export function buildAeoSignal(
  keywords: readonly KeywordRecord[],
  context: {
    readonly format: ContentFormat;
    readonly published: boolean;
    readonly contentStrength: number;
    readonly wordCount: number;
    readonly seed: number;
  },
): ContentAeoSignal {
  const { format, published, contentStrength, wordCount, seed } = context;

  const aiKeywords = keywords.filter(
    (record) => record.ai.answerProjected,
  ).length;
  const likelySourceKeywords = keywords.filter(
    (record) => record.ai.coverage === "likely-source",
  ).length;

  const questionKeywords = keywords.filter(
    (record) => record.ai.questionFormat,
  );

  // Answerability, relevance, and entity strength are the keyword layer's own
  // readings; the page-level figure is what they average to across the terms
  // this page carries.
  const answerability = mean(
    keywords.map((record) => record.ai.answerability),
  );
  const relevance = mean(keywords.map((record) => record.ai.answerRelevance));
  const entityHeld = mean(
    keywords.map((record) => record.ai.entityStrengthHeld),
  );
  const entityNeeded = mean(
    keywords.map((record) => record.ai.entityStrengthNeeded),
  );

  const depthRatio =
    wordCount === 0 ? 0 : clamp(wordCount / FORMAT_META[format].wordTarget, 0, 1.4);

  const answerReadiness = !published
    ? 0
    : keywords.length === 0
      ? Math.round(clamp(18 + contentStrength * 0.3, 0, 100))
      : Math.round(
          clamp(answerability * 0.55 + depthRatio * 26 + contentStrength * 0.2, 0, 100),
        );

  const entityCoverage =
    keywords.length === 0
      ? Math.round(clamp(contentStrength * 0.45, 0, 100))
      : Math.round(clamp((entityHeld / Math.max(entityNeeded, 1)) * 100, 0, 100));

  const questionCoverage =
    questionKeywords.length === 0
      ? 0
      : Math.round(
          clamp(
            (questionKeywords.filter(
              (record) => record.position !== null && record.position <= 10,
            ).length /
              questionKeywords.length) *
              100,
            0,
            100,
          ),
        );

  const structuredData = structuredDataFor(format, published, seed);

  const citationLikelihood = !published
    ? 0
    : Math.round(
        clamp(
          answerReadiness * 0.34 +
            entityCoverage * 0.26 +
            relevance * 0.22 +
            structuredData * 0.18,
          0,
          100,
        ),
      );

  const summary = !published
    ? "Nothing is live, so there is nothing a generated answer could draw from yet."
    : aiKeywords === 0
      ? "No generated answer is projected on this page's keywords."
      : likelySourceKeywords > 0
        ? `Positioned to be drawn from on ${likelySourceKeywords} of ${aiKeywords} keyword${aiKeywords === 1 ? "" : "s"} where an answer is projected.`
        : `An answer is projected on ${aiKeywords} of this page's keywords and this page is not positioned for any of them.`;

  return {
    answerReadiness,
    citationLikelihood,
    entityCoverage,
    questionCoverage,
    structuredData,
    aiKeywords,
    likelySourceKeywords,
    health: healthOf(citationLikelihood),
    summary,
  };
}

/** Mean of a 0-100 reading across a selection, for the roll-up tiles. */
export function averageOf(values: readonly number[]): number {
  return values.length === 0 ? 0 : round(mean(values), 0);
}
