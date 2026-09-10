import { round } from "@/lib/mock/dashboard/core";
import { SERP_FEATURE_ORDER } from "@/lib/mock/keywords/meta";
import type { KeywordRecord, Level, SerpFeatureId } from "@/types/keyword";

/**
 * What the result pages behind a keyword set look like.
 *
 * A roll-up of the features already attached to each keyword, not a second
 * dataset: the count against "Featured snippet" here is the number of keywords
 * whose own SERP panel shows one, so opening any of them confirms the number.
 *
 * Ownership is the point of the view. A feature nobody holds is an opening, a
 * feature a rival holds is a loss with a name on it, and a feature we hold is
 * something to defend — so the roll-up counts all three separately rather than
 * reporting presence alone.
 */

export type SerpFeatureSummary = {
  readonly feature: SerpFeatureId;
  /** Keywords whose result page shows this feature. */
  readonly total: number;
  readonly ours: number;
  readonly competitor: number;
  readonly unclaimed: number;
  /** Share of the selection showing the feature, 0-100. */
  readonly share: number;
  /** Monthly searches sitting behind the feature. */
  readonly volume: number;
  /** Searches behind the instances we do not hold. */
  readonly openVolume: number;
  readonly opportunity: Level;
  readonly action: string;
  /** The keywords worth looking at first, highest volume first. */
  readonly examples: readonly {
    readonly id: string;
    readonly keyword: string;
    readonly projectName: string;
    readonly volume: number;
    readonly ownership: string;
  }[];
};

/** Feature roll-up across a selection, biggest opening first. */
export function getSerpFeatureSummary(
  records: readonly KeywordRecord[],
): readonly SerpFeatureSummary[] {
  const summaries: SerpFeatureSummary[] = [];

  for (const feature of SERP_FEATURE_ORDER) {
    const matches = records.filter((record) =>
      record.serpFeatures.some((entry) => entry.feature === feature),
    );
    if (matches.length === 0) continue;

    const presenceOf = (record: KeywordRecord) =>
      record.serpFeatures.find((entry) => entry.feature === feature);

    const ours = matches.filter(
      (record) => presenceOf(record)?.ownership === "ours",
    );
    const competitor = matches.filter(
      (record) => presenceOf(record)?.ownership === "competitor",
    );
    const unclaimed = matches.filter(
      (record) => presenceOf(record)?.ownership === "unclaimed",
    );

    const open = [...competitor, ...unclaimed];
    const openVolume = open.reduce((carry, record) => carry + record.volume, 0);

    // The action is the one attached to the highest-volume instance we do not
    // hold, so the advice on the roll-up is advice from a real keyword.
    const leader = [...open].sort((a, b) => b.volume - a.volume)[0];
    const action =
      leader === undefined
        ? "Held across the selection — monitor for a rival taking one back."
        : (presenceOf(leader)?.action ?? "");

    summaries.push({
      feature,
      total: matches.length,
      ours: ours.length,
      competitor: competitor.length,
      unclaimed: unclaimed.length,
      share: round((matches.length / Math.max(records.length, 1)) * 100, 1),
      volume: matches.reduce((carry, record) => carry + record.volume, 0),
      openVolume,
      opportunity:
        openVolume >= 40_000 ? "high" : openVolume >= 10_000 ? "medium" : "low",
      action,
      examples: [...matches]
        .sort((a, b) => b.volume - a.volume)
        .slice(0, 4)
        .map((record) => ({
          id: record.id,
          keyword: record.keyword,
          projectName: record.projectName,
          volume: record.volume,
          ownership: presenceOf(record)?.ownership ?? "unclaimed",
        })),
    });
  }

  return summaries.sort((a, b) => b.openVolume - a.openVolume);
}
