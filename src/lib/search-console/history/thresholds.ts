import type { SearchPerformance } from "@/types/search-console";

/**
 * The fixed rules the history comparison classifies with (milestone M1,
 * phase 4, checkpoint P4a). Constants, decided by the operator and written
 * here once, so a classification is the same on every run and never a
 * model's opinion. Every rule reads only what a snapshot stores: clicks,
 * impressions, click-through rate and average position as Google reported
 * them. Nothing here knows search volume, difficulty or which page answered.
 */

/** Two windows closer than this compare almost the same 30 days; not a comparison. */
export const MIN_GAP_DAYS = 7;

/** A gap under this, or a partial or no-data side, marks the comparison low confidence. */
export const LOW_CONFIDENCE_GAP_DAYS = 14;

/** Opportunity: shown often, near the first two pages, rarely clicked. */
export const OPPORTUNITY_MIN_IMPRESSIONS = 100;
export const OPPORTUNITY_MAX_CTR = 0.01;
export const OPPORTUNITY_MAX_POSITION = 20;

/** Movement: at least one whole place, with enough impressions on both sides to mean it. */
export const MOVEMENT_MIN_POSITION_DELTA = 1.0;
export const MOVEMENT_MIN_IMPRESSIONS = 20;

export function isOpportunity(row: SearchPerformance): boolean {
  return (
    row.impressions >= OPPORTUNITY_MIN_IMPRESSIONS &&
    row.ctr <= OPPORTUNITY_MAX_CTR &&
    row.position <= OPPORTUNITY_MAX_POSITION
  );
}

export type Movement = "improving" | "declining";

/**
 * Whether a row moved enough to name, given its position delta
 * (previous − latest; positive is better) and both windows' impressions.
 */
export function movementOf(positionDelta: number, latestImpressions: number, previousImpressions: number): Movement | null {
  if (latestImpressions < MOVEMENT_MIN_IMPRESSIONS || previousImpressions < MOVEMENT_MIN_IMPRESSIONS) return null;
  if (positionDelta >= MOVEMENT_MIN_POSITION_DELTA) return "improving";
  if (positionDelta <= -MOVEMENT_MIN_POSITION_DELTA) return "declining";
  return null;
}
