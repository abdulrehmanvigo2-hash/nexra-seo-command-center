import { PRICE_PER_CALL_USD, PRICE_PER_ITEM_USD, RELATED_LIMIT } from "@/lib/providers/dataforseo/constants";

/**
 * What one snapshot run is expected to cost (§1): one keyword-overview call
 * carrying every seed, then one related-keywords call per seed returning at
 * most RELATED_LIMIT items. Pure; the server recomputes it and never trusts a
 * figure from the browser. Rounded to the database's four decimals.
 */

export type RunEstimate = {
  readonly calls: number;
  readonly usd: number;
  /** The overview call's estimate (seq 0). */
  readonly overviewUsd: number;
  /** One related-keywords call's estimate (each later seq). */
  readonly relatedUsd: number;
};

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function estimateRun(seedCount: number): RunEstimate {
  if (!Number.isInteger(seedCount) || seedCount < 1) throw new RangeError("A run needs at least one seed.");
  const overviewUsd = round4(PRICE_PER_CALL_USD + seedCount * PRICE_PER_ITEM_USD);
  const relatedUsd = round4(PRICE_PER_CALL_USD + RELATED_LIMIT * PRICE_PER_ITEM_USD);
  return { calls: 1 + seedCount, usd: round4(overviewUsd + seedCount * relatedUsd), overviewUsd, relatedUsd };
}

/** The estimate for a set of missing calls on Resume (decision Q4): seq 0 is the overview, every other seq a related call. */
export function estimateCalls(seqs: readonly number[], seedCount: number): number {
  const full = estimateRun(seedCount);
  return round4(seqs.reduce((sum, seq) => sum + (seq === 0 ? full.overviewUsd : full.relatedUsd), 0));
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(value < 0.01 && value > 0 ? 4 : 2)}`;
}
