import type {
  CompetitorPage,
  CompetitorRecord,
  OverlapRow,
} from "@/types/competitor";

/**
 * Ordering for the competitor tables.
 *
 * Three sets of keys, one per table shape, because a competitor, a keyword
 * head-to-head, and a competitor page are not sortable by the same things.
 * Each is kept beside the workspace rather than inside its table, because the
 * sort has to survive a filter change, a page change, and a tab change.
 *
 * Every key sorts both directions. Nulls are pushed to the far end of the
 * scale whichever way the column points — a rival with no measured position is
 * not the best-placed one in an ascending sort, and a page of ours that does
 * not exist is not the strongest.
 */

/** Sorts after anything with a real position, in both directions. */
const UNPLACED = 999;

// ---------------------------------------------------------------------------
// Competitors
// ---------------------------------------------------------------------------

export type CompetitorSort =
  | "threat"
  | "opportunity"
  | "strength"
  | "visibility"
  | "overlap"
  | "wins"
  | "traffic"
  | "authority"
  | "position"
  | "name";

export const COMPETITOR_SORT_OPTIONS: readonly {
  readonly value: CompetitorSort;
  readonly label: string;
  /** Direction the option starts in — the reading most people want first. */
  readonly desc: boolean;
}[] = [
  { value: "threat", label: "Threat", desc: true },
  { value: "opportunity", label: "Opportunity", desc: true },
  { value: "strength", label: "Competitor strength", desc: true },
  { value: "visibility", label: "Search visibility", desc: true },
  { value: "overlap", label: "Shared keywords", desc: true },
  { value: "wins", label: "Terms they win", desc: true },
  { value: "traffic", label: "Traffic gap", desc: true },
  { value: "authority", label: "Domain authority", desc: true },
  { value: "position", label: "Average position", desc: false },
  { value: "name", label: "Name", desc: false },
];

const COMPETITOR_VALUE: Record<
  Exclude<CompetitorSort, "name">,
  (record: CompetitorRecord) => number
> = {
  threat: (record) => record.threat.score,
  opportunity: (record) => record.opportunity.score,
  strength: (record) => record.strength.score,
  visibility: (record) => record.visibility,
  overlap: (record) => record.sharedKeywords,
  wins: (record) => record.theirWins,
  traffic: (record) => record.trafficGap,
  authority: (record) => record.authority,
  position: (record) => record.averagePosition ?? UNPLACED,
};

export function compareCompetitors(
  a: CompetitorRecord,
  b: CompetitorRecord,
  sort: { key: CompetitorSort; desc: boolean },
): number {
  const direction = sort.desc ? -1 : 1;

  if (sort.key === "name") {
    return a.name.localeCompare(b.name) * direction;
  }

  const read = COMPETITOR_VALUE[sort.key];
  const difference = read(a) - read(b);
  if (difference !== 0) return difference * direction;

  // Ties fall back to threat then name, so the order never depends on array
  // position and a re-render cannot reshuffle equal rows.
  return b.threat.score - a.threat.score || a.name.localeCompare(b.name);
}

// ---------------------------------------------------------------------------
// Keyword overlap
// ---------------------------------------------------------------------------

export type OverlapSort =
  | "opportunity"
  | "volume"
  | "difficulty"
  | "gap"
  | "their-position"
  | "our-position"
  | "traffic"
  | "keyword";

export const OVERLAP_SORT_OPTIONS: readonly {
  readonly value: OverlapSort;
  readonly label: string;
  readonly desc: boolean;
}[] = [
  { value: "opportunity", label: "Opportunity", desc: true },
  { value: "volume", label: "Search volume", desc: true },
  { value: "traffic", label: "Traffic at stake", desc: true },
  { value: "gap", label: "Rank gap", desc: false },
  { value: "their-position", label: "Their position", desc: false },
  { value: "our-position", label: "Our position", desc: false },
  { value: "difficulty", label: "Difficulty", desc: true },
  { value: "keyword", label: "Keyword", desc: false },
];

const OVERLAP_VALUE: Record<
  Exclude<OverlapSort, "keyword">,
  (row: OverlapRow) => number
> = {
  opportunity: (row) => row.opportunity,
  volume: (row) => row.volume,
  difficulty: (row) => row.difficulty,
  // Ascending puts the terms we are furthest behind on at the top, which is
  // the reading the battles table opens with.
  gap: (row) => row.rankGap ?? -UNPLACED,
  "their-position": (row) => row.theirPosition ?? UNPLACED,
  "our-position": (row) => row.ourPosition ?? UNPLACED,
  traffic: (row) => row.trafficAtStake,
};

export function compareOverlap(
  a: OverlapRow,
  b: OverlapRow,
  sort: { key: OverlapSort; desc: boolean },
): number {
  const direction = sort.desc ? -1 : 1;

  if (sort.key === "keyword") {
    return a.keyword.localeCompare(b.keyword) * direction;
  }

  const read = OVERLAP_VALUE[sort.key];
  const difference = read(a) - read(b);
  if (difference !== 0) return difference * direction;

  return b.volume - a.volume || a.keyword.localeCompare(b.keyword);
}

// ---------------------------------------------------------------------------
// Competitor pages
// ---------------------------------------------------------------------------

export type PageSort =
  | "threat"
  | "strength"
  | "keywords"
  | "volume"
  | "traffic"
  | "position"
  | "depth"
  | "title";

export const PAGE_SORT_OPTIONS: readonly {
  readonly value: PageSort;
  readonly label: string;
  readonly desc: boolean;
}[] = [
  { value: "threat", label: "Threat", desc: true },
  { value: "strength", label: "Page strength", desc: true },
  { value: "keywords", label: "Keyword footprint", desc: true },
  { value: "volume", label: "Search volume", desc: true },
  { value: "traffic", label: "Estimated traffic", desc: true },
  { value: "position", label: "Best position", desc: false },
  { value: "depth", label: "Content depth", desc: true },
  { value: "title", label: "Title", desc: false },
];

const PAGE_VALUE: Record<
  Exclude<PageSort, "title">,
  (page: CompetitorPage) => number
> = {
  threat: (page) => page.threatScore,
  strength: (page) => page.strength,
  keywords: (page) => page.keywordCount,
  volume: (page) => page.totalVolume,
  traffic: (page) => page.estimatedTraffic,
  position: (page) => page.bestPosition,
  depth: (page) => page.contentDepth,
};

export function comparePages(
  a: CompetitorPage,
  b: CompetitorPage,
  sort: { key: PageSort; desc: boolean },
): number {
  const direction = sort.desc ? -1 : 1;

  if (sort.key === "title") {
    return a.title.localeCompare(b.title) * direction;
  }

  const read = PAGE_VALUE[sort.key];
  const difference = read(a) - read(b);
  if (difference !== 0) return difference * direction;

  return b.threatScore - a.threatScore || a.title.localeCompare(b.title);
}
