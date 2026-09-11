import { clamp, rand, randInt, round } from "@/lib/mock/dashboard/core";
import {
  assemble,
  depthScore,
  evidenceBandFor,
  freshnessScore,
  ratio,
} from "@/lib/mock/ai-visibility/scoring";
import type {
  Confidence,
  EvidenceItem,
  EvidenceKind,
  EvidenceProfile,
} from "@/types/ai-visibility";
import type { ContentRecord } from "@/types/content";

/**
 * Whether a page shows its working.
 *
 * Two things are kept strictly apart here, and the separation is the point:
 *
 *   **Evidence availability** — modelled. Whether the page appears to carry
 *   support of a given kind, inferred from what the page is, how long it is,
 *   and how well it scores. This is what the module reports.
 *
 *   **Citation validation** — not performed. This product has no real source
 *   URLs, fetches nothing, and checks nothing against an external reference.
 *   No record here claims a source was verified, and no source is invented:
 *   an item says what kind of support the page appears to carry, never who
 *   said it or where.
 *
 * Every item is `modelled` provenance, and the UI states that wherever these
 * figures appear.
 */

/** Which evidence kinds a page format plausibly carries. */
const KIND_AFFINITY: Readonly<Record<string, readonly EvidenceKind[]>> = {
  guide: ["example", "methodology", "data-point", "external-authority", "expert-quote"],
  comparison: ["data-point", "example", "external-authority", "original-insight"],
  landing: ["product-proof", "first-party", "example"],
  product: ["product-proof", "data-point", "first-party", "example"],
  location: ["first-party", "product-proof", "example"],
  article: ["external-authority", "expert-quote", "data-point", "original-insight"],
  resource: ["data-point", "methodology", "example", "external-authority"],
  tool: ["methodology", "first-party", "data-point", "product-proof"],
};

/** What an item of each kind asserts, in the page's own terms. */
function statementFor(kind: EvidenceKind, title: string): string {
  switch (kind) {
    case "supported-claim":
      return `A claim in "${title}" that the page backs up.`;
    case "unsupported-claim":
      return `A claim in "${title}" stated with nothing behind it.`;
    case "first-party":
      return "Something only this business could report from its own work.";
    case "external-authority":
      return "A reference to an outside authority. Modelled — no URL is fetched or checked.";
    case "data-point":
      return "A specific figure a reader could quote.";
    case "example":
      return "A worked example rather than a general statement.";
    case "expert-quote":
      return "A named person standing behind a claim.";
    case "methodology":
      return "How a result was arrived at, shown rather than asserted.";
    case "product-proof":
      return "Specification or demonstration behind a product claim.";
    case "original-insight":
      return "An interpretation the consensus answer does not carry.";
  }
}

/**
 * How much confidence an item of each kind can carry.
 *
 * First-party evidence and original insight are the two this dataset genuinely
 * cannot establish — nothing in a content record says whether a business has
 * run its own study — so they are always low, and the UI shows it.
 */
function confidenceFor(kind: EvidenceKind): Confidence {
  if (kind === "first-party" || kind === "original-insight") return "low";
  if (kind === "external-authority" || kind === "expert-quote") return "low";
  if (kind === "data-point" || kind === "example") return "medium";
  return "medium";
}

export function buildEvidence(record: ContentRecord): EvidenceProfile {
  const seed = record.seed;
  const depth = depthScore(record.wordCount);
  const quality = record.score.score;

  // How many claims a page of this length makes at all. Longer pages assert
  // more, which is why unsupported claims scale with depth rather than
  // shrinking as the score improves.
  const claimCount = Math.max(
    2,
    Math.round(clamp(record.wordCount / 320, 2, 11)),
  );

  // How many of those the page supports. Driven by content quality and the
  // page's own answer-engine reading, with a modelled spread so two pages of
  // the same score are not identical.
  const supportRate = clamp(
    (quality * 0.55 + record.aeo.citationLikelihood * 0.45) / 100 +
      (rand(seed, 21) - 0.5) * 0.22,
    0.05,
    0.96,
  );

  const supportedClaims = Math.round(claimCount * supportRate);
  const unsupportedClaims = claimCount - supportedClaims;

  const items: EvidenceItem[] = [];

  for (let index = 0; index < supportedClaims; index += 1) {
    items.push({
      id: `evidence-${record.id}-supported-${index}`,
      kind: "supported-claim",
      statement: statementFor("supported-claim", record.title),
      supported: true,
      confidence: "medium",
    });
  }

  for (let index = 0; index < unsupportedClaims; index += 1) {
    items.push({
      id: `evidence-${record.id}-unsupported-${index}`,
      kind: "unsupported-claim",
      statement: statementFor("unsupported-claim", record.title),
      supported: false,
      confidence: "medium",
    });
  }

  // The kinds of support the page brings, drawn from what its format
  // plausibly carries. A stronger page reaches further down the list.
  const affinity = KIND_AFFINITY[record.format] ?? KIND_AFFINITY.article;
  const kindCount = Math.round(
    clamp(1 + (quality / 100) * 3.4 + (depth / 100) * 1.2, 0, affinity.length),
  );

  for (let index = 0; index < kindCount; index += 1) {
    const kind = affinity[index];
    // Even where a format suggests a kind, not every page has it.
    if (rand(seed + index, 22) > 0.62 + (quality / 100) * 0.3) continue;
    items.push({
      id: `evidence-${record.id}-${kind}`,
      kind,
      statement: statementFor(kind, record.title),
      supported: true,
      confidence: confidenceFor(kind),
    });
  }

  const distinctKinds = new Set(
    items.filter((item) => item.supported).map((item) => item.kind),
  );
  const diversity = distinctKinds.size;
  const coverage = ratio(supportedClaims, claimCount);

  const freshnessKnown = record.ageDays !== null;
  const freshness = freshnessScore(record.ageDays);

  const score = assemble(
    [
      {
        id: "coverage",
        label: "Claims with support",
        value: coverage,
        weight: 0.42,
        provenance: "modelled",
        confidence: "low",
        detail: `${supportedClaims} of ${claimCount} modelled claims carry something behind them.`,
      },
      {
        id: "diversity",
        label: "Kinds of evidence",
        value: Math.min(diversity * 22, 100),
        weight: 0.26,
        provenance: "modelled",
        confidence: "low",
        detail:
          diversity === 0
            ? "No supporting material of any kind."
            : `${diversity} distinct kinds: ${[...distinctKinds].join(", ")}.`,
      },
      {
        id: "specificity",
        label: "Specific enough to quote",
        value: Math.round(clamp(quality * 0.6 + depth * 0.4, 0, 100)),
        weight: 0.2,
        provenance: "derived",
        confidence: "medium",
        detail: "How precise the page's assertions are, from its content score and depth.",
      },
      {
        id: "freshness",
        label: "Freshness",
        value: freshness,
        weight: 0.12,
        provenance: freshnessKnown ? "derived" : "modelled",
        confidence: freshnessKnown ? "high" : "unknown",
        detail: freshnessKnown
          ? `Last updated ${record.ageDays} days ago.`
          : "Not published, so there is no update date to read.",
      },
    ],
    (value, band) =>
      band === "strong"
        ? `${value} out of 100: claims here are backed and varied.`
        : unsupportedClaims > supportedClaims
          ? `${value} out of 100: more is asserted than shown.`
          : `${value} out of 100 across ${claimCount} modelled claims.`,
  );

  return {
    score,
    band: evidenceBandFor(coverage, diversity),
    items,
    coverage,
    supportedClaims,
    unsupportedClaims,
    diversity,
    freshnessDays: record.ageDays,
    freshnessKnown,
  };
}

export { randInt, round };
