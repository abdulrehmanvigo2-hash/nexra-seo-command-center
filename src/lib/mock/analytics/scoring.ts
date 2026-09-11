import { clamp, round } from "@/lib/mock/dashboard/core";
import type {
  Confidence,
  MovementDirection,
  MovementSignificance,
  PagePerformanceState,
} from "@/types/analytics";

/**
 * Every formula and every threshold in Analytics.
 *
 * One file, deliberately — the same discipline Technical SEO, AI Visibility
 * and Backlinks keep. A threshold written inside a component is one that gets
 * copied the second time it is needed and then drifts, which is how a module
 * ends up calling a change material on a card and noise in the table beneath.
 *
 * The judgement this file exists to make is **what counts as a change at all**.
 * Most movement in a dataset this size says nothing, and a module that read a
 * trend into every wobble would be worse than useless — it would send agents
 * chasing noise. `noise` is therefore the default band, not the exception.
 */

// ---------------------------------------------------------------------------
// Significance
// ---------------------------------------------------------------------------

/**
 * Percentage change floors for each significance band.
 *
 * Deliberately wide. A 4% swing in monthly sessions on a project this size is
 * indistinguishable from sampling, and calling it a trend would be a claim the
 * data cannot support.
 */
export const SIGNIFICANCE_FLOORS: Readonly<
  Record<MovementSignificance, number>
> = {
  material: 20,
  notable: 10,
  slight: 5,
  noise: 0,
};

export const SIGNIFICANCE_ORDER: readonly MovementSignificance[] = [
  "material",
  "notable",
  "slight",
  "noise",
];

/** How large a change has to be before it is worth a reader's attention. */
export function significanceFor(change: number): MovementSignificance {
  const size = Math.abs(change);
  if (size >= SIGNIFICANCE_FLOORS.material) return "material";
  if (size >= SIGNIFICANCE_FLOORS.notable) return "notable";
  if (size >= SIGNIFICANCE_FLOORS.slight) return "slight";
  return "noise";
}

/**
 * Which way a metric went.
 *
 * Anything inside the noise band reads as flat, whichever sign it carries —
 * an arrow on a 2% move implies a direction the data does not have.
 */
export function directionFor(change: number): MovementDirection {
  if (Math.abs(change) < SIGNIFICANCE_FLOORS.slight) return "flat";
  return change > 0 ? "up" : "down";
}

/** A percentage change between two windows. */
export function changeBetween(current: number, previous: number): number {
  if (previous === 0) return current === 0 ? 0 : 100;
  return round(((current - previous) / previous) * 100, 1);
}

// ---------------------------------------------------------------------------
// Page performance
// ---------------------------------------------------------------------------

/** Sessions below which a published page is treated as dormant. */
export const DORMANT_TRAFFIC = 25;

/** Share of potential a page has to reach before it counts as performing. */
export const PERFORMING_SHARE = 55;

/**
 * How a page is doing against what it could carry.
 *
 * Read against the page's own potential rather than against other pages: a
 * location page carrying 80 sessions out of a possible 95 is doing its job,
 * and ranking it below a guide carrying 400 out of a possible 3,000 would be
 * measuring size rather than performance.
 */
export function pageStateFor(input: {
  readonly traffic: number;
  readonly potential: number;
  readonly positionChange: number;
  readonly health: string;
}): PagePerformanceState {
  if (input.traffic < DORMANT_TRAFFIC) return "dormant";

  const share = input.potential <= 0 ? 0 : (input.traffic / input.potential) * 100;

  // Decay is a movement reading, not a level one: a page can be carrying good
  // traffic and still be losing it, and that is the case worth catching early.
  if (input.health === "decaying" || input.positionChange <= -3) return "decaying";
  if (share >= PERFORMING_SHARE && input.positionChange > 0) return "compounding";
  if (share >= PERFORMING_SHARE) return "steady";
  return "underperforming";
}

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

/**
 * How strongly a piece of work and a movement sit together, 0-100.
 *
 * Association only, and the name says so. The inputs are all circumstantial:
 * that the work and the outcome touch the same cluster, that the outcome moved
 * at all, and how much traffic sits behind it. None of that establishes cause,
 * and `confidenceFor` below is deliberately incapable of returning `high`.
 */
export function associationFor(input: {
  readonly sharesCluster: boolean;
  readonly sharesPage: boolean;
  readonly positionChange: number;
  readonly traffic: number;
}): number {
  const proximity = input.sharesPage ? 55 : input.sharesCluster ? 35 : 10;
  const movement = Math.min(Math.abs(input.positionChange) * 6, 30);
  const weight = Math.min(input.traffic / 40, 15);

  return Math.round(clamp(proximity + movement + weight, 0, 100));
}

/**
 * How much an attribution reading can be trusted.
 *
 * Capped at `medium`, always. Establishing that a piece of work caused a
 * movement needs a holdout, a control, or at minimum a before-and-after on the
 * same URL with nothing else changing — and this product has none of those.
 * Returning `high` would be the module claiming something it cannot know.
 */
export function attributionConfidence(
  association: number,
  sharesPage: boolean,
  positionChange: number,
): Confidence {
  // Medium needs both halves: the work on the same page as the movement, and
  // a movement large enough that it is unlikely to be drift. Either alone is
  // circumstantial, which is what `low` is for.
  if (association >= 72 && sharesPage && Math.abs(positionChange) >= 4) {
    return "medium";
  }
  if (association >= 45) return "low";
  return "none";
}

// ---------------------------------------------------------------------------
// Anomalies
// ---------------------------------------------------------------------------

/** Change beyond which a movement is worth raising as an anomaly. */
export const ANOMALY_FLOOR = SIGNIFICANCE_FLOORS.notable;

/**
 * How much an anomaly's explanation can be trusted.
 *
 * `high` is reachable here, and only here: where a canonical finding from
 * another module directly covers the pages that moved — a URL that stopped
 * serving, a page dropped from the index — the explanation is not a guess.
 * Without such a finding the record says nothing rather than inventing one.
 */
export function anomalyConfidence(
  hasCanonicalExplanation: boolean,
  significance: MovementSignificance,
): Confidence {
  if (!hasCanonicalExplanation) return "none";
  if (significance === "material") return "high";
  if (significance === "notable") return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** A count against a total, as a 0-100 share. */
export function ratio(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return round(clamp((part / whole) * 100, 0, 100), 1);
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return round(
    values.reduce((carry, value) => carry + value, 0) / values.length,
    1,
  );
}

export function sum(values: readonly number[]): number {
  return values.reduce((carry, value) => carry + value, 0);
}

/**
 * The share of today's traffic still unclaimed, 0-100.
 *
 * Reported as headroom rather than as a shortfall: a page at 30% of potential
 * has 70% available, and framing it as a failure would misread a page that is
 * simply young.
 */
export function headroomFor(traffic: number, potential: number): number {
  if (potential <= 0) return 0;
  return round(clamp(((potential - traffic) / potential) * 100, 0, 100), 1);
}

export { clamp, round };
