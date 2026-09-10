import type { ContentRecord } from "@/types/content";

/**
 * Ordering for the content inventory.
 *
 * Kept beside the table rather than inside it, because the sort survives a
 * filter change, a page change, and a tab change — the workspace owns it.
 *
 * Position needs the same care it needs in the keyword table. A piece that has
 * not been published has no position, and sorting it as zero would put the
 * pages nobody can find at the top of an ascending sort. Unpositioned pieces
 * are pushed to the far end of the scale instead, which is where they belong
 * in both directions.
 */

export type ContentSort =
  | "score"
  | "volume"
  | "traffic"
  | "potential"
  | "value"
  | "position"
  | "words"
  | "links"
  | "updated"
  | "title";

export const CONTENT_SORT_OPTIONS: readonly {
  readonly value: ContentSort;
  readonly label: string;
  /** Direction the option starts in — the reading most people want first. */
  readonly desc: boolean;
}[] = [
  { value: "score", label: "Content score", desc: true },
  { value: "volume", label: "Search volume", desc: true },
  { value: "traffic", label: "Estimated traffic", desc: true },
  { value: "potential", label: "Traffic potential", desc: true },
  { value: "value", label: "Opportunity value", desc: true },
  { value: "position", label: "Best position", desc: false },
  { value: "words", label: "Word count", desc: true },
  { value: "links", label: "Inbound links", desc: true },
  { value: "updated", label: "Last updated", desc: true },
  { value: "title", label: "Title", desc: false },
];

/** Sorts after a piece with no position, whichever way the column points. */
const UNPLACED = 999;

const VALUE_OF: Record<
  Exclude<ContentSort, "title">,
  (record: ContentRecord) => number
> = {
  score: (record) => record.score.score,
  volume: (record) => record.totalVolume,
  traffic: (record) => record.traffic,
  potential: (record) => record.trafficPotential,
  value: (record) => record.opportunityValue,
  position: (record) => record.bestPosition ?? UNPLACED,
  words: (record) => record.wordCount,
  links: (record) => record.internalLinksIn,
  updated: (record) => Date.parse(record.updatedAt),
};

/** Comparator for one sort key and direction. */
export function compareContent(
  a: ContentRecord,
  b: ContentRecord,
  sort: { key: ContentSort; desc: boolean },
): number {
  const direction = sort.desc ? -1 : 1;

  if (sort.key === "title") {
    return a.title.localeCompare(b.title) * direction;
  }

  const read = VALUE_OF[sort.key];
  const difference = read(a) - read(b);
  if (difference !== 0) return difference * direction;

  // Ties fall back to volume, then to the title, so the order never depends on
  // array position.
  return b.totalVolume - a.totalVolume || a.title.localeCompare(b.title);
}
