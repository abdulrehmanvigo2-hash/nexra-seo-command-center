import { clamp, rand, randInt } from "@/lib/mock/dashboard/core";
import { pageDemonstratesRelation } from "@/lib/mock/ai-visibility/relationships";
import { depthScore } from "@/lib/mock/ai-visibility/scoring";
import { gainBandFor } from "@/lib/mock/ai-visibility/scoring";
import type {
  Confidence,
  EvidenceProfile,
  GainSignal,
  InformationGain,
} from "@/types/ai-visibility";
import type { ContentRecord } from "@/types/content";

/**
 * Whether a page contributes anything beyond the consensus answer.
 *
 * This is the least knowable reading in the module and it is treated that way.
 * Nothing in a content record says whether a business ran its own study, holds
 * a proprietary method, or has an expert worth quoting — so originality is
 * never asserted with confidence here, and the confidence level is published
 * with every reading rather than buried.
 *
 * The rule: **do not generate fake originality.** Where the underlying record
 * gives no basis for a claim, the signal is not emitted and the confidence
 * drops. A page with no evidence behind it returns `unknown`, which the UI
 * shows as "unknown" rather than as a low score — a different statement, and
 * the honest one.
 */

/** Which signals a page format could plausibly carry at all. */
const FORMAT_SIGNALS: Readonly<Record<string, readonly GainSignal[]>> = {
  guide: ["unique-examples", "expert-interpretation", "proprietary-process", "uncommon-subtopic"],
  comparison: ["comparative-analysis", "original-data", "specific-evidence", "entity-relationships"],
  landing: ["first-party-experience", "case-study", "proprietary-process"],
  product: ["first-party-experience", "specific-evidence", "case-study"],
  location: ["first-party-experience", "unique-examples"],
  article: ["expert-interpretation", "original-data", "uncommon-subtopic", "entity-relationships"],
  resource: ["original-data", "specific-evidence", "uncommon-subtopic"],
  tool: ["proprietary-process", "original-data", "first-party-experience"],
};

/**
 * Evidence kinds that are the only grounds this dataset has for a gain claim.
 *
 * A signal is emitted only where the page's evidence profile actually carries
 * the corresponding support. Without it there is nothing to base the claim on,
 * and the claim is not made.
 */
const REQUIRES: Partial<Record<GainSignal, readonly string[]>> = {
  "original-data": ["data-point"],
  "first-party-experience": ["first-party"],
  "proprietary-process": ["methodology"],
  "case-study": ["example", "first-party"],
  "unique-examples": ["example"],
  "expert-interpretation": ["expert-quote", "original-insight"],
  "specific-evidence": ["data-point", "product-proof"],
  "comparative-analysis": ["data-point", "original-insight"],
};

export function buildInformationGain(
  record: ContentRecord,
  evidence: EvidenceProfile,
): InformationGain {
  const seed = record.seed;
  const depth = depthScore(record.wordCount);

  const held = new Set(evidence.items.map((item) => item.kind as string));
  const candidates = FORMAT_SIGNALS[record.format] ?? FORMAT_SIGNALS.article;

  const signals: GainSignal[] = [];
  for (const candidate of candidates) {
    const needs = REQUIRES[candidate];
    // No grounds in the record means no claim. This is the guard that stops
    // the module inventing originality it cannot see.
    if (needs && !needs.some((kind) => held.has(kind))) continue;
    if (rand(seed + candidates.indexOf(candidate), 31) > 0.66) continue;
    signals.push(candidate);
  }

  // Entity relationships used to be guessed from keyword count and outbound
  // link count, which measured how busy a page was rather than whether it
  // connected anything. It now reads the derived entity graph: the signal
  // fires where this page is itself the evidence for a direct connection
  // between two entities, which is what "carries entity relationships" was
  // always meant to mean.
  if (
    pageDemonstratesRelation(`ai-${record.id}`) &&
    !signals.includes("entity-relationships")
  ) {
    signals.push("entity-relationships");
  }
  if (record.unintendedKeywordIds.length >= 2 && !signals.includes("uncommon-subtopic")) {
    signals.push("uncommon-subtopic");
  }

  // Where confidence will be unknown, no signal is claimed either: the two
  // would contradict each other, and the integrity pass checks for exactly
  // that combination.
  const grounded = evidence.diversity > 1 ? signals : [];

  const score = Math.round(
    clamp(
      grounded.length * 15 +
        depth * 0.22 +
        (evidence.diversity - 1) * 6 +
        randInt(seed, 32, -6, 6),
      0,
      100,
    ),
  );

  /**
   * How much the reading can be trusted.
   *
   * `unknown` where the page carries no distinguishing evidence — a page that
   * only asserts might be entirely original or entirely derivative, and this
   * dataset has no way to tell the two apart. Never higher than medium,
   * because originality is not something these records can establish.
   */
  // Bare claims are not grounds for reasoning about originality: every page
  // asserts things. Only a distinguishing kind of evidence — a figure, an
  // example, a named source, a shown method — gives this reading anything to
  // work from, and without one the honest answer is that we cannot tell.
  const distinguishing = evidence.diversity > 1;

  const confidence: Confidence =
    !distinguishing
      ? "unknown"
      : grounded.length === 0
        ? "low"
        : evidence.diversity >= 3 && grounded.length >= 3
          ? "medium"
          : "low";

  const band = gainBandFor(score);

  const summary =
    confidence === "unknown"
      ? "Nothing in this record establishes whether the page adds anything original. Stated as unknown rather than guessed."
      : grounded.length === 0
        ? "No signal of original contribution — the page appears to restate what is already available."
        : `Appears to carry ${grounded.length} signal${grounded.length === 1 ? "" : "s"} of original contribution, modelled at ${confidence} confidence.`;

  return { score, band, signals: grounded, confidence, summary };
}
