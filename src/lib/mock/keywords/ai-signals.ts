import { round } from "@/lib/mock/dashboard/core";
import type {
  AiKeywordFilter,
  KeywordMetric,
  KeywordRecord,
} from "@/types/keyword";
import { formatCompact, formatPercent } from "@/lib/format";

/**
 * The answer-engine reading of a keyword set.
 *
 * The signals themselves are built with the keyword in `builders.ts`; this file
 * is the questions asked of them — which keywords are worth pursuing in
 * generated answers, which ones are being answered without us, which ones the
 * site is not authoritative enough to be cited for yet.
 *
 * It is the keyword slice of the AI Visibility / AEO / GEO agent's remit
 * (CLAUDE.md §13, agent 10). Nothing here calls a model or an answer engine,
 * and nothing here reports an observed citation: every reading is projected
 * from the keyword's own canonical figures, and the UI states that.
 */

/** The gap between the authority a topic demands and the authority we hold. */
export function entityGapOf(record: KeywordRecord): number {
  return record.ai.entityStrengthNeeded - record.ai.entityStrengthHeld;
}

/**
 * A single 0-100 reading of how much answer-engine upside a keyword carries.
 *
 * Relevance and answerability say whether a generated answer is likely and
 * whether we could supply it; coverage says whether we already do. A keyword
 * already positioned to be drawn from scores low here, because the work is
 * defensive rather than an opening.
 */
export function aiOpportunityOf(record: KeywordRecord): number {
  const { ai } = record;

  const base = ai.answerRelevance * 0.45 + ai.answerability * 0.35;
  const authority = Math.max(0, 100 - Math.max(0, entityGapOf(record))) * 0.2;
  const coverageFactor =
    ai.coverage === "likely-source"
      ? 0.35
      : ai.coverage === "likely-mention"
        ? 0.75
        : ai.coverage === "unlikely"
          ? 1
          : 0.6;

  return Math.round(
    Math.min(100, Math.max(0, (base + authority) * coverageFactor)),
  );
}

/** Whether a keyword belongs in one of the AI layer's narrower cuts. */
export function matchesAiFilter(
  record: KeywordRecord,
  filter: AiKeywordFilter,
): boolean {
  const { ai } = record;

  switch (filter) {
    case "all":
      return true;
    case "high-opportunity":
      return aiOpportunityOf(record) >= 62;
    case "citation-gap":
      return ai.answerProjected && ai.coverage !== "likely-source";
    case "question-based":
      return ai.questionFormat;
    case "entity-weakness":
      return entityGapOf(record) > 12;
    case "answer-ready":
      return ai.answerability >= 68 && entityGapOf(record) <= 0;
  }
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((carry, value) => carry + value, 0) / values.length;
}

/** The summary numbers above the AI search layer. */
export function getAiSummary(
  records: readonly KeywordRecord[],
): readonly KeywordMetric[] {
  const eligible = records.filter((record) => record.ai.answerProjected);
  const likelySource = eligible.filter(
    (record) => record.ai.coverage === "likely-source",
  );
  const questions = records.filter((record) => record.ai.questionFormat);
  const weak = records.filter((record) => entityGapOf(record) > 12);
  const ready = records.filter((record) =>
    matchesAiFilter(record, "answer-ready"),
  );

  const projectedRate =
    eligible.length === 0 ? 0 : (likelySource.length / eligible.length) * 100;

  const opportunityVolume = records
    .filter((record) => matchesAiFilter(record, "citation-gap"))
    .reduce((carry, record) => carry + record.volume, 0);

  return [
    {
      id: "ai-eligible",
      label: "Answer projected",
      value: formatCompact(eligible.length),
      unit: `of ${records.length}`,
      detail: "Keywords whose modelled result page carries a generated answer.",
      icon: "sparkles",
    },
    {
      id: "ai-citation-rate",
      label: "Projected source rate",
      value: formatPercent(round(projectedRate, 1)),
      detail: `${likelySource.length} of ${eligible.length} are positioned well enough to be drawn from. Projected, not observed.`,
      icon: "shield",
      health:
        projectedRate >= 35
          ? "positive"
          : projectedRate >= 18
            ? "warning"
            : "negative",
    },
    {
      id: "ai-answer-relevance",
      label: "Mean answer relevance",
      value: String(Math.round(mean(records.map((r) => r.ai.answerRelevance)))),
      unit: "/ 100",
      detail: "How well the set suits being answered rather than clicked.",
      icon: "gauge",
    },
    {
      id: "ai-question-share",
      label: "Question-format keywords",
      value: formatCompact(questions.length),
      detail: "Queries phrased as questions across the selection.",
      icon: "info",
    },
    {
      id: "ai-entity-weakness",
      label: "Entity weakness",
      value: formatCompact(weak.length),
      detail: "Topics needing more authority than the site currently holds.",
      icon: "alert",
      health: weak.length > records.length * 0.4 ? "warning" : "neutral",
    },
    {
      id: "ai-answer-ready",
      label: "Answer engine ready",
      value: formatCompact(ready.length),
      detail: "Answerable in a passage, with the authority to back it.",
      icon: "check",
      health: "positive",
    },
    {
      id: "ai-citation-gap",
      label: "Citation gap volume",
      value: formatCompact(opportunityVolume),
      unit: "searches / mo",
      detail:
        "Demand behind queries where an answer is projected and nothing of ours is positioned for it.",
      icon: "target",
    },
    {
      id: "ai-brand-mention",
      label: "Mean brand mention potential",
      value: String(
        Math.round(mean(records.map((r) => r.ai.brandMentionPotential))),
      ),
      unit: "/ 100",
      detail: "Modelled likelihood the brand is named in a generated answer.",
      icon: "ai-visibility",
    },
  ];
}
