import type {
  AttributionRecord,
  PagePerformance,
  SegmentRow,
} from "@/types/analytics";

/**
 * Ordering for the analytics tables.
 *
 * Three sets of keys, one per table shape, kept beside the workspace rather
 * than inside the tables because a sort has to survive a filter change, a page
 * change and a tab change.
 *
 * Every key sorts both directions. Ties break on id the same way whichever way
 * the column points, so equal rows do not reshuffle when a reader flips the
 * arrow to look at the other end.
 */

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export type PageSort =
  | "traffic"
  | "headroom"
  | "value"
  | "potential"
  | "position"
  | "movement"
  | "quality"
  | "title";

export const PAGE_SORT_OPTIONS: readonly {
  readonly value: PageSort;
  readonly label: string;
  /** The direction most people want first. */
  readonly desc: boolean;
}[] = [
  { value: "traffic", label: "Sessions", desc: true },
  { value: "headroom", label: "Unclaimed sessions", desc: true },
  { value: "value", label: "Headroom value", desc: true },
  { value: "potential", label: "Potential", desc: true },
  { value: "position", label: "Average position", desc: false },
  { value: "movement", label: "Position change", desc: false },
  { value: "quality", label: "Content score", desc: true },
  { value: "title", label: "Page title", desc: false },
];

/** Unranked pages sort after ranked ones, whichever way the column points. */
const UNRANKED = 999;

export function comparePages(
  a: PagePerformance,
  b: PagePerformance,
  sort: { key: PageSort; desc: boolean },
): number {
  const direction = sort.desc ? -1 : 1;

  if (sort.key === "title") {
    return (
      a.title.localeCompare(b.title) * direction ||
      a.contentId.localeCompare(b.contentId)
    );
  }

  const read: Record<
    Exclude<PageSort, "title">,
    (page: PagePerformance) => number
  > = {
    traffic: (page) => page.traffic,
    headroom: (page) => page.headroom,
    value: (page) => page.opportunityValue,
    potential: (page) => page.potential,
    position: (page) => page.averagePosition ?? UNRANKED,
    movement: (page) => page.positionChange,
    quality: (page) => page.contentScore,
  };

  return (
    (read[sort.key](a) - read[sort.key](b)) * direction ||
    a.contentId.localeCompare(b.contentId)
  );
}

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

export type SegmentSort =
  | "traffic"
  | "potential"
  | "headroom"
  | "share"
  | "keywords"
  | "pages"
  | "position"
  | "quality"
  | "label";

export const SEGMENT_SORT_OPTIONS: readonly {
  readonly value: SegmentSort;
  readonly label: string;
  readonly desc: boolean;
}[] = [
  { value: "traffic", label: "Sessions", desc: true },
  { value: "headroom", label: "Headroom", desc: true },
  { value: "potential", label: "Potential", desc: true },
  { value: "share", label: "Share of traffic", desc: true },
  { value: "keywords", label: "Keywords", desc: true },
  { value: "pages", label: "Pages", desc: true },
  { value: "position", label: "Average position", desc: false },
  { value: "quality", label: "Content score", desc: true },
  { value: "label", label: "Segment", desc: false },
];

export function compareSegments(
  a: SegmentRow,
  b: SegmentRow,
  sort: { key: SegmentSort; desc: boolean },
): number {
  const direction = sort.desc ? -1 : 1;

  if (sort.key === "label") {
    return a.label.localeCompare(b.label) * direction || a.id.localeCompare(b.id);
  }

  const read: Record<
    Exclude<SegmentSort, "label">,
    (row: SegmentRow) => number
  > = {
    traffic: (row) => row.traffic,
    potential: (row) => row.potential,
    headroom: (row) => row.potential - row.traffic,
    share: (row) => row.share,
    keywords: (row) => row.keywords,
    pages: (row) => row.pages,
    position: (row) => row.averagePosition ?? UNRANKED,
    quality: (row) => row.quality,
  };

  return (
    (read[sort.key](a) - read[sort.key](b)) * direction ||
    a.id.localeCompare(b.id)
  );
}

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

export type AttributionSort =
  | "association"
  | "traffic"
  | "movement"
  | "work"
  | "outcome";

export const ATTRIBUTION_SORT_OPTIONS: readonly {
  readonly value: AttributionSort;
  readonly label: string;
  readonly desc: boolean;
}[] = [
  { value: "association", label: "Association", desc: true },
  { value: "traffic", label: "Sessions", desc: true },
  { value: "movement", label: "Position change", desc: true },
  { value: "work", label: "Work", desc: false },
  { value: "outcome", label: "Page", desc: false },
];

export function compareAttribution(
  a: AttributionRecord,
  b: AttributionRecord,
  sort: { key: AttributionSort; desc: boolean },
): number {
  const direction = sort.desc ? -1 : 1;

  if (sort.key === "work") {
    return (
      a.workTitle.localeCompare(b.workTitle) * direction ||
      a.id.localeCompare(b.id)
    );
  }
  if (sort.key === "outcome") {
    return (
      a.outcomeLabel.localeCompare(b.outcomeLabel) * direction ||
      a.id.localeCompare(b.id)
    );
  }

  const read: Record<
    Exclude<AttributionSort, "work" | "outcome">,
    (entry: AttributionRecord) => number
  > = {
    association: (entry) => entry.association,
    traffic: (entry) => entry.traffic,
    movement: (entry) => entry.positionChange,
  };

  return (
    (read[sort.key](a) - read[sort.key](b)) * direction ||
    a.id.localeCompare(b.id)
  );
}
