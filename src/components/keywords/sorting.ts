import type { KeywordRecord } from "@/types/keyword";

/**
 * Ordering for the keyword table.
 *
 * Kept beside the table rather than inside it, because the sort survives a
 * filter change, a page change, and a tab change — the workspace owns it.
 *
 * Position needs care. A keyword that does not rank has no position, and
 * sorting it as zero would put the worst keywords at the top of an ascending
 * sort. Unranked keywords are pushed to the far end of the position scale
 * instead, which is where they belong in both directions.
 */

export type KeywordSort =
  | "opportunity"
  | "keyword"
  | "volume"
  | "position"
  | "change"
  | "difficulty"
  | "traffic"
  | "commercial"
  | "updated";

export const KEYWORD_SORT_OPTIONS: readonly {
  readonly value: KeywordSort;
  readonly label: string;
  /** Direction the option starts in — the reading most people want first. */
  readonly desc: boolean;
}[] = [
  { value: "opportunity", label: "Opportunity score", desc: true },
  { value: "volume", label: "Search volume", desc: true },
  { value: "position", label: "Position", desc: false },
  { value: "change", label: "Position change", desc: true },
  { value: "difficulty", label: "Difficulty", desc: false },
  { value: "traffic", label: "Traffic potential", desc: true },
  { value: "commercial", label: "Commercial value", desc: true },
  { value: "updated", label: "Last updated", desc: true },
  { value: "keyword", label: "Keyword", desc: false },
];

/** Sorts after an unranked keyword, whichever way the column is pointing. */
const UNRANKED = 999;

const VALUE_OF: Record<
  Exclude<KeywordSort, "keyword">,
  (record: KeywordRecord) => number
> = {
  opportunity: (record) => record.opportunity.score,
  volume: (record) => record.volume,
  position: (record) => record.position ?? UNRANKED,
  change: (record) => record.change,
  difficulty: (record) => record.difficulty,
  traffic: (record) => record.trafficPotential,
  commercial: (record) => record.commercialValue,
  updated: (record) => Date.parse(record.updatedAt),
};

/** Comparator for one sort key and direction. */
export function compareKeywords(
  a: KeywordRecord,
  b: KeywordRecord,
  sort: { key: KeywordSort; desc: boolean },
): number {
  const direction = sort.desc ? -1 : 1;

  if (sort.key === "keyword") {
    return a.keyword.localeCompare(b.keyword) * direction;
  }

  const read = VALUE_OF[sort.key];
  const difference = read(a) - read(b);
  if (difference !== 0) return difference * direction;

  // Ties fall back to opportunity, then to the term, so the order never
  // depends on array position.
  return (
    b.opportunity.score - a.opportunity.score ||
    a.keyword.localeCompare(b.keyword)
  );
}
