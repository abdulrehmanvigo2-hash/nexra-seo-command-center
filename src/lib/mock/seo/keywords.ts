import { getKeywordList } from "@/lib/mock/keywords";
import type { KeywordRow } from "@/types/seo";

/**
 * Sample of the tracked keyword universe, ordered by opportunity score.
 *
 * Derived from the canonical keyword registry rather than authored here. This
 * dataset predates the Keyword Intelligence module and was originally a
 * hand-written list; keeping that list would have meant two sets of keyword
 * records in the product, which is exactly what the registry exists to
 * prevent. The shape is unchanged, so everything reading `KEYWORDS` still
 * works — the values now come from the same place every other module reads.
 *
 * `trend` carries the position movement over the window and is inverted,
 * because moving from 14 to 9 is a gain of five places.
 */
export const KEYWORDS: readonly KeywordRow[] = getKeywordList()
  .filter((record) => record.position !== null)
  .slice(0, 12)
  .map((record) => ({
    id: record.id,
    keyword: record.keyword,
    intent: record.intent,
    position: record.position as number,
    volume: record.volume,
    difficulty: record.difficulty,
    // The registry stores places gained; this shape wants the signed move in
    // position, where a decrease is the improvement.
    trend: { value: -record.change, unit: "absolute", invert: true },
    cluster: record.clusterName,
    opportunityScore: record.opportunity.score,
  }));
