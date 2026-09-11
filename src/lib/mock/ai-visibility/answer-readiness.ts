import { clamp, rand, randInt, round } from "@/lib/mock/dashboard/core";
import { ANSWER_SIGNAL_LABEL } from "@/lib/mock/ai-visibility/meta";
import { assemble, depthScore, mean } from "@/lib/mock/ai-visibility/scoring";
import type {
  AnswerReadiness,
  AnswerSignal,
  AnswerSignalId,
} from "@/types/ai-visibility";
import type { ContentRecord } from "@/types/content";
import type { KeywordRecord } from "@/types/keyword";

/**
 * Whether a page actually answers the questions its keywords ask.
 *
 * The rule this module is built around: **do not reward formatting
 * mechanically**. A page can carry headings, a table and an FAQ block and
 * still fail to answer anything, and a score that counted those would say the
 * page was ready when it is not. So every structural signal below is gated on
 * a substance signal — the table check only counts where the intent calls for
 * one, the FAQ check only where the page actually draws question keywords, and
 * the whole score is capped by how well the page's format matches the intent
 * behind its terms.
 *
 * Signals that do not apply to a page are marked inapplicable rather than
 * scored zero. A comparison check against a location page is a question that
 * was never asked, and failing the page for it would be the same mechanical
 * scoring in reverse.
 */

type Input = {
  readonly record: ContentRecord;
  readonly keywords: readonly KeywordRecord[];
};

function signal(
  id: AnswerSignalId,
  value: number,
  applicable: boolean,
  finding: string,
): AnswerSignal {
  return {
    id,
    label: ANSWER_SIGNAL_LABEL[id] ?? id,
    value: applicable ? Math.round(clamp(value, 0, 100)) : 0,
    applicable,
    finding,
  };
}

export function buildAnswerReadiness(input: Input): AnswerReadiness {
  const { record, keywords } = input;
  const seed = record.seed;

  const questionKeywords = keywords.filter((entry) => entry.ai.questionFormat);
  const answerability = mean(keywords.map((entry) => entry.ai.answerability));
  const depth = depthScore(record.wordCount);

  // -- substance ---------------------------------------------------------
  // How much of what the page's own keywords ask it actually addresses. This
  // is the reading everything structural is gated against.
  const questionMatch =
    questionKeywords.length === 0
      ? 0
      : Math.round(
          clamp(
            answerability * 0.55 +
              record.aeo.questionCoverage * 0.45 +
              randInt(seed, 11, -6, 6),
            0,
            100,
          ),
        );

  const directAnswer = Math.round(
    clamp(
      record.aeo.answerReadiness * 0.6 + answerability * 0.25 + depth * 0.15,
      0,
      100,
    ),
  );

  const intentAlignment =
    record.intentAlignment === "aligned"
      ? 92
      : record.intentAlignment === "partial"
        ? 58
        : 24;

  // -- structure, each gated on substance --------------------------------
  const headingBase = Math.round(clamp(38 + depth * 0.5 + randInt(seed, 12, -10, 14), 0, 100));
  // Headings only help if there is something under them worth finding.
  const headingStructure = Math.round(headingBase * (0.45 + (depth / 100) * 0.55));

  const definitionClarity = Math.round(
    clamp(record.aeo.entityCoverage * 0.7 + depth * 0.3, 0, 100),
  );

  const comparisonApplies =
    record.format === "comparison" ||
    record.primaryIntent === "commercial" ||
    keywords.some((entry) => /\bvs\b|versus|compare|alternative/i.test(entry.keyword));
  const comparisonCoverage = comparisonApplies
    ? Math.round(
        clamp(
          (record.format === "comparison" ? 66 : 34) +
            depth * 0.3 +
            randInt(seed, 13, -10, 12),
          0,
          100,
        ),
      )
    : 0;

  const processApplies =
    record.format === "guide" ||
    record.format === "tool" ||
    keywords.some((entry) => /\bhow to\b|\bsteps?\b|\bprocess\b|\bsetup\b/i.test(entry.keyword));
  const processCoverage = processApplies
    ? Math.round(clamp(42 + depth * 0.42 + randInt(seed, 14, -12, 14), 0, 100))
    : 0;

  // Tables and lists are only an asset where the content is comparative or
  // numeric. On a narrative page they are noise, so the check does not run.
  const tableApplies = comparisonApplies || record.format === "product" || record.format === "location";
  const tabularData = tableApplies
    ? Math.round(clamp(30 + rand(seed, 15) * 60, 0, 100))
    : 0;

  // A concise answer block is worth nothing if the answer in it is wrong for
  // the query, so it is scaled by the question match.
  const answerBlockBase = Math.round(clamp(record.aeo.answerReadiness * 0.8 + randInt(seed, 16, -10, 16), 0, 100));
  const answerBlock =
    questionKeywords.length === 0
      ? Math.round(answerBlockBase * 0.5)
      : Math.round(answerBlockBase * (0.4 + (questionMatch / 100) * 0.6));

  const supportingDepth = depth;

  // The FAQ check only applies where the page genuinely draws questions.
  const faqApplies = questionKeywords.length >= 2;
  const faqUsefulness = faqApplies
    ? Math.round(
        clamp(record.aeo.questionCoverage * 0.75 + randInt(seed, 17, -12, 18), 0, 100),
      )
    : 0;

  // Ambiguity is inverted: a page competing with another of ours for the same
  // terms says two things at once, which is the ambiguity that matters here.
  const ambiguity = Math.round(
    clamp(
      (record.cannibalised ? 42 : 88) -
        record.unintendedKeywordIds.length * 6 +
        randInt(seed, 18, -6, 6),
      0,
      100,
    ),
  );

  const subtopicCoverage = Math.round(
    clamp(
      record.aeo.questionCoverage * 0.4 +
        depth * 0.35 +
        Math.min(record.keywordCount * 7, 25),
      0,
      100,
    ),
  );

  const signals: readonly AnswerSignal[] = [
    signal(
      "question-match",
      questionMatch,
      questionKeywords.length > 0,
      questionKeywords.length === 0
        ? "No keyword on this page is phrased as a question."
        : `${questionKeywords.length} question keywords; the page addresses them at ${questionMatch} out of 100.`,
    ),
    signal(
      "direct-answer",
      directAnswer,
      true,
      directAnswer >= 65
        ? "A reader gets the answer without hunting for it."
        : "The answer is buried, or arrives only after preamble.",
    ),
    signal(
      "intent-alignment",
      intentAlignment,
      true,
      record.intentNote,
    ),
    signal(
      "heading-structure",
      headingStructure,
      true,
      headingStructure >= 60
        ? "Headings map to the questions underneath them."
        : "Headings do not reflect what each section actually answers.",
    ),
    signal(
      "definition-clarity",
      definitionClarity,
      true,
      definitionClarity >= 60
        ? "Key terms are established before they are used."
        : "Key terms are used without being defined.",
    ),
    signal(
      "comparison-coverage",
      comparisonCoverage,
      comparisonApplies,
      comparisonApplies
        ? comparisonCoverage >= 60
          ? "Options are compared, with a judgement made."
          : "Comparison intent is served without an actual comparison."
        : "Not a comparison page — this check does not apply.",
    ),
    signal(
      "process-coverage",
      processCoverage,
      processApplies,
      processApplies
        ? processCoverage >= 60
          ? "The steps are laid out in order."
          : "A process is implied but never set out."
        : "No procedural intent on this page.",
    ),
    signal(
      "tabular-data",
      tabularData,
      tableApplies,
      tableApplies
        ? tabularData >= 55
          ? "Structured data is presented where it helps."
          : "Comparable values are left in prose."
        : "Tables would not help this kind of page.",
    ),
    signal(
      "answer-block",
      answerBlock,
      true,
      answerBlock >= 60
        ? "A short passage stands alone as the answer."
        : "There is no passage that could be lifted as the answer.",
    ),
    signal(
      "supporting-depth",
      supportingDepth,
      true,
      `${record.wordCount} words behind the answer.`,
    ),
    signal(
      "faq-usefulness",
      faqUsefulness,
      faqApplies,
      faqApplies
        ? faqUsefulness >= 60
          ? "The question section answers questions people actually ask."
          : "The page draws questions it does not answer in short form."
        : "Too few question keywords for a FAQ to earn its place.",
    ),
    signal(
      "ambiguity",
      ambiguity,
      true,
      record.cannibalised
        ? "Another page of ours competes for the same terms, so the site says two things."
        : "The page says one thing clearly.",
    ),
    signal(
      "subtopic-coverage",
      subtopicCoverage,
      true,
      subtopicCoverage >= 60
        ? "The subtopics the query implies are covered."
        : "Obvious subtopics are left out.",
    ),
  ];

  // Only applicable signals count, so a page is never penalised for a check
  // that was never relevant to it.
  const applicable = signals.filter((entry) => entry.applicable);

  const substance = mean([
    questionKeywords.length > 0 ? questionMatch : directAnswer,
    directAnswer,
    intentAlignment,
  ]);
  const structure = mean(
    applicable
      .filter((entry) =>
        (
          [
            "heading-structure",
            "tabular-data",
            "answer-block",
            "faq-usefulness",
          ] as readonly string[]
        ).includes(entry.id),
      )
      .map((entry) => entry.value),
  );
  const completeness = mean(
    applicable
      .filter((entry) =>
        (
          [
            "definition-clarity",
            "comparison-coverage",
            "process-coverage",
            "supporting-depth",
            "subtopic-coverage",
          ] as readonly string[]
        ).includes(entry.id),
      )
      .map((entry) => entry.value),
  );

  const score = assemble(
    [
      {
        id: "substance",
        label: "Answers the question",
        value: substance,
        weight: 0.45,
        provenance: "derived",
        confidence: "medium",
        detail:
          "Whether the page addresses what its own keywords ask, and in the form the intent calls for.",
      },
      {
        id: "completeness",
        label: "Covers the subject",
        value: completeness,
        weight: 0.33,
        provenance: "derived",
        confidence: "medium",
        detail:
          "Definitions, subtopics and depth behind the answer, counting only the checks this page format calls for.",
      },
      {
        id: "structure",
        label: "Extractable structure",
        value: structure,
        weight: 0.22,
        provenance: "modelled",
        confidence: "low",
        detail:
          "Headings, answer blocks and question sections — scaled by whether the answer under them is right, so formatting alone cannot carry the score.",
      },
    ],
    (value, band) =>
      band === "strong"
        ? `${value} out of 100: this page answers what it was built to answer.`
        : band === "absent"
          ? `${value} out of 100: there is no clear answer here to lift.`
          : `${value} out of 100 — see the reasons below.`,
  );

  // -- why the score is what it is --------------------------------------
  const reasons: string[] = [];
  if (record.intentAlignment === "mismatched") {
    reasons.push(
      "The page format does not match what its keywords are asking for, so the answer given is not the answer asked.",
    );
  }
  if (questionKeywords.length > 0 && questionMatch < 50) {
    reasons.push(
      `${questionKeywords.length} of its keywords are questions the page does not answer directly.`,
    );
  }
  if (directAnswer < 50) {
    reasons.push("No passage on the page stands alone as the answer.");
  }
  if (record.wordCount < 700) {
    reasons.push(
      `At ${record.wordCount} words there is too little depth behind the answer to be quoted over a fuller page.`,
    );
  }
  if (record.cannibalised) {
    reasons.push(
      "Another page of ours targets the same terms, so neither reads as the definitive answer.",
    );
  }
  if (comparisonApplies && comparisonCoverage < 45) {
    reasons.push("Comparison intent is served without an actual comparison.");
  }
  if (faqApplies && faqUsefulness < 45) {
    reasons.push("The questions this page draws are never answered in short form.");
  }

  const unansweredQuestions = questionKeywords
    .filter((entry) => entry.ai.answerability >= 55 && questionMatch < 65)
    .slice(0, 4)
    .map((entry) => entry.keyword);

  return { score, signals, unansweredQuestions, reasons };
}

export { round };
