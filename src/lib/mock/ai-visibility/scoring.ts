import { clamp, round } from "@/lib/mock/dashboard/core";
import type {
  AiDimensionId,
  AiEffort,
  AiFactor,
  AiProvenance,
  AiScore,
  AiSeverity,
  CitationState,
  Confidence,
  EntityStrengthBand,
  EvidenceBand,
  GainBand,
  ReadinessBand,
  TopicCoverageState,
} from "@/types/ai-visibility";

/**
 * Every formula and every threshold in AI Visibility.
 *
 * One file, deliberately — the same discipline the Technical SEO module keeps.
 * A threshold written inside a component is one that gets copied the second
 * time it is needed and then drifts, which is how a module ends up calling a
 * page citation-ready on a card and weak in the table beneath it.
 *
 * Every score is published with its factors, their weights, what each one
 * contributed, where the reading came from, and how much confidence it carries.
 * They are weighted sums over fixture data — arithmetic, not models — and no
 * external answer engine is consulted anywhere.
 *
 * Arithmetic stays in the four operations and integer-safe ramps: the product
 * renders on the server and hydrates in the browser, and a score that rounded
 * differently in the two would be a hydration mismatch.
 */

// ---------------------------------------------------------------------------
// Bands
// ---------------------------------------------------------------------------

/** Lowest score that still reads as each readiness band. */
export const READINESS_FLOORS: Readonly<Record<ReadinessBand, number>> = {
  strong: 80,
  ready: 65,
  developing: 45,
  weak: 25,
  absent: 0,
};

export const READINESS_ORDER: readonly ReadinessBand[] = [
  "strong",
  "ready",
  "developing",
  "weak",
  "absent",
];

export function bandFor(score: number): ReadinessBand {
  if (score >= READINESS_FLOORS.strong) return "strong";
  if (score >= READINESS_FLOORS.ready) return "ready";
  if (score >= READINESS_FLOORS.developing) return "developing";
  if (score >= READINESS_FLOORS.weak) return "weak";
  return "absent";
}

/** At or above this, a page counts as AI-ready in the headline metrics. */
export const READY_THRESHOLD = READINESS_FLOORS.ready;

export const SEVERITY_RANK: Readonly<Record<AiSeverity, number>> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export const SEVERITY_ORDER: readonly AiSeverity[] = [
  "critical",
  "high",
  "medium",
  "low",
];

export const CONFIDENCE_RANK: Readonly<Record<Confidence, number>> = {
  high: 3,
  medium: 2,
  low: 1,
  unknown: 0,
};

export function evidenceBandFor(coverage: number, diversity: number): EvidenceBand {
  if (coverage >= 78 && diversity >= 4) return "robust";
  if (coverage >= 55 && diversity >= 2) return "adequate";
  if (coverage >= 28) return "thin";
  return "unsupported";
}

export function gainBandFor(score: number): GainBand {
  if (score >= 72) return "distinctive";
  if (score >= 52) return "differentiated";
  if (score >= 30) return "conventional";
  return "derivative";
}

export function entityBandFor(score: number): EntityStrengthBand {
  if (score >= 74) return "authoritative";
  if (score >= 55) return "established";
  if (score >= 34) return "emerging";
  return "thin";
}

/**
 * How completely a topic is served.
 *
 * Coverage and depth are read together on purpose: a cluster with a page for
 * every keyword but nothing said in depth is fragmented, not comprehensive,
 * and a state that read only page count would call it finished.
 */
export function topicStateFor(
  pages: number,
  keywords: number,
  meanDepth: number,
): TopicCoverageState {
  if (pages === 0) return "absent";
  const perPage = keywords / pages;
  if (meanDepth >= 68 && perPage <= 6) return "comprehensive";
  if (meanDepth >= 68) return "fragmented";
  if (meanDepth >= 48) return "adequate";
  if (pages >= 3 && meanDepth < 40) return "fragmented";
  return "shallow";
}

/**
 * How extractable a page's claims are.
 *
 * `blocked` short-circuits everything: an answer engine that cannot fetch or
 * index the URL will not be quoting anything from it, however well written.
 * `insufficient-evidence` is separated from `weak` because they need different
 * work — one needs proof added, the other needs the writing restructured.
 */
export function citationStateFor(
  score: number,
  supportedClaims: number,
  blocked: boolean,
): CitationState {
  if (blocked) return "blocked";
  if (supportedClaims === 0) return "insufficient-evidence";
  if (score >= 72) return "citation-ready";
  if (score >= 50) return "partially-ready";
  return "weak";
}

// ---------------------------------------------------------------------------
// Normalising ramps
// ---------------------------------------------------------------------------

/** A count against a target, as a 0-100 reading. */
export function ratio(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return round(clamp((part / whole) * 100, 0, 100), 1);
}

/**
 * Word count as a depth reading, 0-100.
 *
 * Piecewise, and flattening early: past about 2,400 words more text stops
 * adding answer quality, and a linear ramp would keep rewarding length for its
 * own sake — which is exactly the mechanical scoring this module avoids.
 */
export function depthScore(words: number): number {
  if (words >= 2_400) return 100;
  if (words >= 1_400) return round(78 + ((words - 1_400) / 1_000) * 22, 1);
  if (words >= 700) return round(48 + ((words - 700) / 700) * 30, 1);
  if (words >= 250) return round(18 + ((words - 250) / 450) * 30, 1);
  return round((words / 250) * 18, 1);
}

/** Days since an update, as a freshness reading. */
export function freshnessScore(days: number | null): number {
  if (days === null) return 0;
  if (days <= 90) return 100;
  if (days <= 180) return round(100 - ((days - 90) / 90) * 22, 1);
  if (days <= 365) return round(78 - ((days - 180) / 185) * 30, 1);
  return round(clamp(48 - ((days - 365) / 365) * 30, 8, 48), 1);
}

/** The mean of a set of readings, or 0 for an empty one. */
export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return round(
    values.reduce((carry, value) => carry + value, 0) / values.length,
    1,
  );
}

// ---------------------------------------------------------------------------
// Score assembly
// ---------------------------------------------------------------------------

type FactorInput = {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly weight: number;
  readonly provenance: AiProvenance;
  readonly confidence: Confidence;
  readonly detail: string;
};

/**
 * Turns weighted readings into a published score.
 *
 * Weights sum to 1 by construction at each call site: a factor added without
 * adjusting the others would quietly change every score in the module, so each
 * caller lists them together as one literal.
 */
export function assemble(
  factors: readonly FactorInput[],
  summary: (score: number, band: ReadinessBand) => string,
): AiScore {
  const resolved: AiFactor[] = factors.map((factor) => {
    const value = round(clamp(factor.value, 0, 100), 1);
    return {
      id: factor.id,
      label: factor.label,
      value,
      weight: factor.weight,
      contribution: round(value * factor.weight, 1),
      provenance: factor.provenance,
      confidence: factor.confidence,
      detail: factor.detail,
    };
  });

  const score = Math.round(
    clamp(
      resolved.reduce((carry, factor) => carry + factor.value * factor.weight, 0),
      0,
      100,
    ),
  );
  const band = bandFor(score);

  return { score, band, factors: resolved, summary: summary(score, band) };
}

// ---------------------------------------------------------------------------
// The six dimensions
// ---------------------------------------------------------------------------

export const DIMENSION_ORDER: readonly AiDimensionId[] = [
  "answer-readiness",
  "entity-coverage",
  "evidence",
  "citation-readiness",
  "topic-coverage",
  "technical-access",
];

/**
 * What each dimension contributes to an AI visibility score.
 *
 * Answer readiness leads because an answer engine's first question is whether
 * the page answers anything; technical access is last in weight but acts as a
 * hard gate elsewhere, since an unfetchable page scores nothing on it at all.
 * The six sum to 1, and nothing outside this file changes them.
 */
export const DIMENSION_WEIGHTS: Readonly<Record<AiDimensionId, number>> = {
  "answer-readiness": 0.28,
  evidence: 0.2,
  "citation-readiness": 0.17,
  "entity-coverage": 0.15,
  "topic-coverage": 0.12,
  "technical-access": 0.08,
};

export const DIMENSION_META: Readonly<
  Record<AiDimensionId, { label: string; description: string }>
> = {
  "answer-readiness": {
    label: "Answer readiness",
    description:
      "Whether the page actually answers the questions its keywords ask, in a form that can be lifted.",
  },
  "entity-coverage": {
    label: "Entity coverage",
    description:
      "Whether the things the page is about are named, defined, and connected clearly enough to be understood.",
  },
  evidence: {
    label: "Evidence",
    description:
      "Whether claims on the page show their working, and how varied that support is.",
  },
  "citation-readiness": {
    label: "Citation readiness",
    description:
      "How easily a specific, attributable claim could be extracted. Not a measure of whether anything was cited.",
  },
  "topic-coverage": {
    label: "Topic coverage",
    description:
      "Whether the surrounding topic is covered completely enough for the page to sit in a coherent answer.",
  },
  "technical-access": {
    label: "Technical access",
    description:
      "Whether the URL can be fetched and indexed at all, read from Technical SEO rather than recomputed.",
  },
};

export type VisibilityInput = Readonly<Record<AiDimensionId, number>>;

/**
 * The Nexra AI visibility score.
 *
 * A weighted sum of the six dimensions above, published with all of them, so
 * the number can be argued with rather than taken on trust. Every aggregate in
 * this module reconciles to these components by construction.
 */
export function visibilityScore(
  input: VisibilityInput,
  context: { readonly technicalBlocked: boolean; readonly gainConfidence: Confidence },
): AiScore {
  return assemble(
    [
      {
        id: "answer-readiness",
        label: DIMENSION_META["answer-readiness"].label,
        value: input["answer-readiness"],
        weight: DIMENSION_WEIGHTS["answer-readiness"],
        provenance: "derived",
        confidence: "medium",
        detail:
          "How directly the page answers the questions its own keywords ask.",
      },
      {
        id: "evidence",
        label: DIMENSION_META.evidence.label,
        value: input.evidence,
        weight: DIMENSION_WEIGHTS.evidence,
        provenance: "modelled",
        confidence: "low",
        detail:
          "Modelled support behind the page's claims. No source URL is fetched or validated.",
      },
      {
        id: "citation-readiness",
        label: DIMENSION_META["citation-readiness"].label,
        value: input["citation-readiness"],
        weight: DIMENSION_WEIGHTS["citation-readiness"],
        provenance: "derived",
        confidence: context.gainConfidence === "unknown" ? "low" : "medium",
        detail:
          "How extractable a claim would be. Says nothing about whether one was extracted.",
      },
      {
        id: "entity-coverage",
        label: DIMENSION_META["entity-coverage"].label,
        value: input["entity-coverage"],
        weight: DIMENSION_WEIGHTS["entity-coverage"],
        provenance: "derived",
        confidence: "medium",
        detail:
          "Internal semantic coverage of the entities this page should own. No external entity service is consulted.",
      },
      {
        id: "topic-coverage",
        label: DIMENSION_META["topic-coverage"].label,
        value: input["topic-coverage"],
        weight: DIMENSION_WEIGHTS["topic-coverage"],
        provenance: "derived",
        confidence: "high",
        detail: "Cluster coverage from the canonical keyword layer.",
      },
      {
        id: "technical-access",
        label: DIMENSION_META["technical-access"].label,
        value: input["technical-access"],
        weight: DIMENSION_WEIGHTS["technical-access"],
        provenance: "derived",
        confidence: "high",
        detail: context.technicalBlocked
          ? "The URL cannot be fetched or indexed, so nothing else on this page can reach an answer engine."
          : "Technical SEO's own score for this URL.",
      },
    ],
    (score, band) =>
      context.technicalBlocked
        ? `${score} out of 100, but the URL is not reachable — fix that before anything else here matters.`
        : band === "strong"
          ? `${score} out of 100: this page is in good shape to be understood and quoted.`
          : band === "absent"
            ? `${score} out of 100: there is little here an answer engine could use.`
            : `${score} out of 100, held down by the lowest dimensions above.`,
  );
}

// ---------------------------------------------------------------------------
// Opportunity ranking
// ---------------------------------------------------------------------------

/** How much of a job each effort band represents. Same shape as Phase 8. */
export const EFFORT_WEIGHT: Readonly<Record<AiEffort, number>> = {
  low: 1,
  medium: 1.35,
  high: 1.85,
};

export const EFFORT_ORDER: readonly AiEffort[] = ["low", "medium", "high"];

const SEVERITY_VALUE: Readonly<Record<AiSeverity, number>> = {
  critical: 100,
  high: 78,
  medium: 54,
  low: 30,
};

/**
 * What closing a gap is worth, 0-100.
 *
 * Severity says how bad one instance is; reach says how much of the project it
 * touches. Reach is compressed so that one broken thing does not sit below a
 * hundred tidy-ups.
 */
export function gapValue(
  severity: AiSeverity,
  affectedPages: number,
  projectPages: number,
): number {
  const reach = ratio(affectedPages, Math.max(projectPages, 1));
  const reachScore = reach >= 50 ? 100 : reach >= 20 ? 70 + reach : reach * 3.5;
  return Math.round(
    clamp(SEVERITY_VALUE[severity] * 0.72 + reachScore * 0.28, 0, 100),
  );
}

/**
 * Where a job belongs in the queue, 0-100.
 *
 * Value per unit of effort, rescaled to stay readable next to every other
 * score in the product. Same method as the Technical SEO queue, so the two
 * read consistently when an agency looks at both.
 */
export function opportunityPriority(impact: number, effort: AiEffort): number {
  return Math.round(clamp(impact / EFFORT_WEIGHT[effort], 0, 100));
}
