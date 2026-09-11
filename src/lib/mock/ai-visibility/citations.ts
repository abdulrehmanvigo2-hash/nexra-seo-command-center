import { clamp, round } from "@/lib/mock/dashboard/core";
import { assemble, citationStateFor } from "@/lib/mock/ai-visibility/scoring";
import type {
  AnswerReadiness,
  CitationReadiness,
  EvidenceProfile,
  InformationGain,
} from "@/types/ai-visibility";
import type { ContentRecord } from "@/types/content";
import type { TechnicalPage } from "@/types/technical";

/**
 * How easily a useful claim could be extracted from a page and attributed
 * to it.
 *
 * The question this module answers is a capability, never an outcome. Nothing
 * here knows, or can know, whether any answer engine has quoted a page: there
 * is no citation feed behind this product. Every state in `CitationState` is
 * phrased as readiness for that reason, and `cited` is deliberately not a
 * member of the union — the claim cannot be made because it cannot be
 * expressed.
 *
 * Technical access is a gate rather than a weight. A URL that cannot be
 * fetched or indexed is `blocked` regardless of how well it is written, which
 * is the truthful reading: an engine that cannot reach the page will not be
 * quoting anything from it.
 */

type Input = {
  readonly record: ContentRecord;
  readonly technical: TechnicalPage | null;
  readonly answer: AnswerReadiness;
  readonly evidence: EvidenceProfile;
  readonly gain: InformationGain;
};

export function buildCitationReadiness(input: Input): CitationReadiness {
  const { record, technical, answer, evidence, gain } = input;

  const blocked =
    technical === null ||
    technical.crawlState === "broken" ||
    technical.crawlState === "server-error" ||
    technical.crawlState === "blocked" ||
    technical.indexability === "error" ||
    technical.indexability === "blocked" ||
    technical.indexability === "noindex";

  // Claims specific enough to stand on their own when lifted out of context.
  const quotableFacts = evidence.items.filter(
    (item) =>
      item.supported &&
      (item.kind === "data-point" ||
        item.kind === "product-proof" ||
        item.kind === "expert-quote" ||
        item.kind === "methodology"),
  ).length;

  const specificity = Math.round(
    clamp(quotableFacts * 20 + evidence.coverage * 0.4, 0, 100),
  );

  const attribution = Math.round(
    clamp(
      // Whether the page makes clear who is asserting what. Read from the
      // evidence kinds that carry an attributable voice.
      (evidence.items.some((item) => item.kind === "expert-quote") ? 42 : 0) +
        (evidence.items.some((item) => item.kind === "first-party") ? 30 : 0) +
        (evidence.items.some((item) => item.kind === "external-authority") ? 24 : 0) +
        evidence.coverage * 0.25,
      0,
      100,
    ),
  );

  const clarity = Math.round(
    clamp(
      answer.score.score * 0.6 +
        (record.cannibalised ? 0 : 18) +
        record.score.score * 0.22,
      0,
      100,
    ),
  );

  const canonicalClean =
    technical === null
      ? 0
      : technical.canonicalState === "self"
        ? 100
        : technical.canonicalState === "points-elsewhere"
          ? 25
          : technical.canonicalState === "conflict"
            ? 10
            : 55;

  const indexability = technical === null ? 0 : technical.score.score;

  const score = assemble(
    [
      {
        id: "specificity",
        label: "Factual specificity",
        value: specificity,
        weight: 0.26,
        provenance: "modelled",
        confidence: "low",
        detail: `${quotableFacts} claim${quotableFacts === 1 ? "" : "s"} specific enough to quote as written.`,
      },
      {
        id: "clarity",
        label: "Claim clarity",
        value: clarity,
        weight: 0.22,
        provenance: "derived",
        confidence: "medium",
        detail:
          "Whether a single claim can be isolated without the surrounding page.",
      },
      {
        id: "attribution",
        label: "Source attribution",
        value: attribution,
        weight: 0.2,
        provenance: "modelled",
        confidence: "low",
        detail:
          "Whether it is clear who is asserting the claim. Modelled — no source is fetched or verified.",
      },
      {
        id: "indexability",
        label: "Technical reachability",
        value: indexability,
        weight: 0.18,
        provenance: "derived",
        confidence: "high",
        detail:
          technical === null
            ? "Not published, so there is nothing to reach."
            : "Technical SEO's own score for this URL.",
      },
      {
        id: "canonical",
        label: "Canonical clarity",
        value: canonicalClean,
        weight: 0.08,
        provenance: "derived",
        confidence: "high",
        detail:
          technical === null
            ? "No canonical to read."
            : `Canonical state: ${technical.canonicalState}.`,
      },
      {
        id: "distinctiveness",
        label: "Worth quoting over the consensus",
        value: gain.confidence === "unknown" ? 0 : gain.score,
        weight: 0.06,
        provenance: "modelled",
        confidence: gain.confidence,
        detail:
          gain.confidence === "unknown"
            ? "Originality cannot be established from this record, so it contributes nothing here."
            : gain.summary,
      },
    ],
    (value) =>
      blocked
        ? "The URL cannot be reached or indexed, so nothing on it is extractable however well written."
        : `${value} out of 100 — how easily a claim could be lifted and attributed. Not a measure of whether one was.`,
  );

  const state = citationStateFor(score.score, evidence.supportedClaims, blocked);

  const reason = blocked
    ? technical === null
      ? "Not published, so there is no URL to extract from."
      : "The URL cannot be fetched or indexed, so nothing on it is reachable."
    : evidence.supportedClaims === 0
      ? "Nothing on the page carries the support an extractable claim would need."
      : score.score >= 72
        ? `${quotableFacts} specific, supported claims that could be lifted and attributed.`
        : score.score >= 50
          ? "Some claims are extractable; others are too vague or unsupported to quote."
          : "Claims are present but hard to isolate, attribute, or trust as written.";

  return { score, state, reason, quotableFacts, blocked };
}

export { round };
