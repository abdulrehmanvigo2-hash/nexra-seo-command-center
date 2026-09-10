import { clamp, round } from "@/lib/mock/dashboard/core";
import { FORMAT_META, scoreBandOf } from "@/lib/mock/content/meta";
import type { KeywordRecord } from "@/types/keyword";
import type {
  ContentFormat,
  ContentScore,
  ContentScoreFactor,
  ContentScoreFactorId,
  IntentAlignment,
} from "@/types/content";

/**
 * The Nexra content score.
 *
 * Eight readings of a page, each scored out of 100 and weighted, summed into
 * one number. It is arithmetic over the mock dataset — a weighted sum, not a
 * model — and the weights are published in the UI beside the result so the
 * number can be argued with rather than taken on trust.
 *
 * Every input is something the canonical layers already know: the keywords the
 * page targets and where they rank, how the format lines up against the intent
 * behind them, how much has been written, how the page sits in the internal
 * link graph, when it was last touched, and how quotable it is. Nothing is
 * measured here that is not measured somewhere else first.
 */

/** Weights, published in the UI. They sum to 1. */
const FACTOR_WEIGHTS: Record<ContentScoreFactorId, number> = {
  "keyword-coverage": 0.18,
  "search-intent": 0.16,
  ranking: 0.15,
  depth: 0.12,
  "on-page": 0.11,
  "internal-links": 0.1,
  freshness: 0.09,
  "answer-readiness": 0.09,
};

const ALIGNMENT_VALUE: Record<IntentAlignment, number> = {
  aligned: 100,
  partial: 58,
  mismatched: 18,
};

/**
 * How well the page covers what it is meant to.
 *
 * One keyword on a page is thin coverage of a topic; a page carrying several
 * related terms is what a cluster wants. Nothing mapped at all scores zero,
 * because a page nobody targeted is not covering anything on purpose.
 */
function coverageValue(keywords: readonly KeywordRecord[]): number {
  if (keywords.length === 0) return 0;
  return Math.round(clamp(38 + Math.log2(keywords.length + 1) * 30, 0, 100));
}

/** Where the page actually sits, averaged over the keywords that rank. */
function rankingValue(averagePosition: number | null, published: boolean): number {
  if (!published) return 0;
  if (averagePosition === null) return 8;
  if (averagePosition <= 3) return 100;
  if (averagePosition <= 10) return 82;
  if (averagePosition <= 20) return 60;
  if (averagePosition <= 50) return 36;
  return 18;
}

/** Words written against what the format calls for. */
function depthValue(wordCount: number, format: ContentFormat): number {
  const target = FORMAT_META[format].wordTarget;
  if (wordCount === 0) return 0;
  const ratio = wordCount / target;
  // Overshooting stops helping well before it starts hurting, so the curve
  // flattens above target rather than rewarding length for its own sake.
  if (ratio >= 1) return Math.round(clamp(92 + (ratio - 1) * 12, 0, 100));
  return Math.round(clamp(ratio * 92, 0, 100));
}

/**
 * The state of the page itself, as the keyword layer already reads it.
 *
 * `contentStrength` is the keyword module's own judgement of how strong our
 * page is on a topic. Reusing it means the on-page reading here and the
 * content-readiness factor in the keyword opportunity score cannot disagree.
 */
function onPageValue(contentStrength: number, published: boolean): number {
  return published ? Math.round(clamp(contentStrength, 0, 100)) : 0;
}

/** How the page sits in the internal link graph, both directions. */
function linkValue(linksIn: number, linksOut: number, published: boolean): number {
  if (!published) return 0;
  const inbound = clamp(linksIn * 22, 0, 62);
  const outbound = clamp(linksOut * 14, 0, 38);
  return Math.round(clamp(inbound + outbound, 0, 100));
}

/** How recently the page was touched. */
function freshnessValue(ageDays: number | null): number {
  if (ageDays === null) return 0;
  if (ageDays <= 60) return 100;
  if (ageDays <= 180) return 82;
  if (ageDays <= 365) return 58;
  if (ageDays <= 540) return 34;
  return 16;
}

export function buildContentScore(input: {
  readonly keywords: readonly KeywordRecord[];
  readonly format: ContentFormat;
  readonly published: boolean;
  readonly contentStrength: number;
  readonly wordCount: number;
  readonly alignment: IntentAlignment;
  readonly linksOut: number;
  readonly linksIn: number;
  readonly ageDays: number | null;
  readonly averagePosition: number | null;
  readonly answerReadiness: number;
}): ContentScore {
  const readings: readonly {
    readonly id: ContentScoreFactorId;
    readonly label: string;
    readonly value: number;
    readonly detail: string;
  }[] = [
    {
      id: "keyword-coverage",
      label: "Keyword coverage",
      value: coverageValue(input.keywords),
      detail:
        input.keywords.length === 0
          ? "No keyword is mapped to this page at all."
          : `${input.keywords.length} keyword${input.keywords.length === 1 ? "" : "s"} mapped to this page.`,
    },
    {
      id: "search-intent",
      label: "Intent match",
      value: ALIGNMENT_VALUE[input.alignment],
      detail: `The format is ${input.alignment} with what the primary keyword is asking for.`,
    },
    {
      id: "ranking",
      label: "Ranking performance",
      value: rankingValue(input.averagePosition, input.published),
      detail: !input.published
        ? "Not published, so there is nothing to rank yet."
        : input.averagePosition === null
          ? "Live, but none of its keywords reach the top 100."
          : `Average position ${input.averagePosition.toFixed(1)} across the keywords that rank.`,
    },
    {
      id: "depth",
      label: "Depth",
      value: depthValue(input.wordCount, input.format),
      detail: !input.published
        ? `Nothing written yet against a ${FORMAT_META[input.format].wordTarget.toLocaleString("en-US")}-word target.`
        : `${input.wordCount.toLocaleString("en-US")} words against a ${FORMAT_META[input.format].wordTarget.toLocaleString("en-US")}-word target for this format.`,
    },
    {
      id: "on-page",
      label: "On-page strength",
      value: onPageValue(input.contentStrength, input.published),
      detail: input.published
        ? `The page scores ${input.contentStrength} of 100 on its own topic.`
        : "No page exists, so there is nothing on it to optimise.",
    },
    {
      id: "internal-links",
      label: "Internal linking",
      value: linkValue(input.linksIn, input.linksOut, input.published),
      detail: input.published
        ? `${input.linksIn} link${input.linksIn === 1 ? "" : "s"} in, ${input.linksOut} out.`
        : "Unpublished pages carry no links and receive none.",
    },
    {
      id: "freshness",
      label: "Freshness",
      value: freshnessValue(input.ageDays),
      detail:
        input.ageDays === null
          ? "Never published."
          : input.ageDays <= 60
            ? `Updated ${input.ageDays} days ago.`
            : `Last touched ${Math.round(input.ageDays / 30)} months ago.`,
    },
    {
      id: "answer-readiness",
      label: "Answer readiness",
      value: input.answerReadiness,
      detail:
        "How quotable the page is for a generated answer, from its keywords' answer-engine signals.",
    },
  ];

  const factors: readonly ContentScoreFactor[] = readings.map((reading) => {
    const weight = FACTOR_WEIGHTS[reading.id];
    return {
      id: reading.id,
      label: reading.label,
      value: reading.value,
      weight,
      contribution: round(reading.value * weight, 1),
      detail: reading.detail,
    };
  });

  const score = Math.round(
    clamp(
      factors.reduce((carry, factor) => carry + factor.value * factor.weight, 0),
      0,
      100,
    ),
  );

  const leading = [...factors].sort(
    (a, b) => b.contribution - a.contribution,
  )[0];
  const weakest = [...factors].sort((a, b) => a.value - b.value)[0];

  return {
    score,
    band: scoreBandOf(score),
    factors,
    summary: `${leading.label} carries this score; ${weakest.label.toLowerCase()} holds it back.`,
  };
}
