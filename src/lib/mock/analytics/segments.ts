import { INTENT_META } from "@/lib/mock/keywords";
import { getKeywordList } from "@/lib/mock/keywords";
import { FORMAT_META } from "@/lib/mock/content/meta";
import { getContentRecords } from "@/lib/mock/content";
import { headroomFor, mean, ratio, sum } from "@/lib/mock/analytics/scoring";
import type {
  SegmentDimension,
  SegmentRow,
} from "@/types/analytics";
import type { KeywordRecord } from "@/types/keyword";

/**
 * Performance cut by the dimensions this product already owns.
 *
 * Four cuts, all canonical: project, cluster, search intent, page format.
 * There is no channel, device, or geography dimension here, and that is
 * deliberate — nothing in this product measures any of them, and offering the
 * split would be offering data that does not exist.
 *
 * Traffic and potential come from the keyword layer, which is where they are
 * already computed. This module groups them; it does not recompute them.
 */

/** The pages behind a set of keywords, for the page and quality columns. */
function pagesFor(
  keywords: readonly KeywordRecord[],
): { pages: number; quality: number } {
  const urls = new Set(
    keywords
      .map((record) => record.targetUrl)
      .filter((url): url is string => url !== null),
  );

  const records = getContentRecords().filter(
    (record) => record.url !== null && urls.has(record.url),
  );

  return {
    pages: urls.size,
    quality: Math.round(mean(records.map((record) => record.score.score))),
  };
}

function buildRow(
  dimension: SegmentDimension,
  id: string,
  label: string,
  keywords: readonly KeywordRecord[],
  projectId: string,
  projectName: string,
  totalTraffic: number,
): SegmentRow {
  const traffic = sum(keywords.map((record) => record.currentTraffic));
  const potential = sum(keywords.map((record) => record.trafficPotential));
  const ranked = keywords.filter((record) => record.position !== null);
  const { pages, quality } = pagesFor(keywords);

  return {
    id,
    dimension,
    label,
    projectId,
    projectName,
    traffic,
    potential,
    keywords: keywords.length,
    pages,
    averagePosition:
      ranked.length === 0
        ? null
        : Math.round(mean(ranked.map((record) => record.position as number))),
    share: ratio(traffic, totalTraffic),
    headroom: headroomFor(traffic, potential),
    quality,
    provenance: "derived",
  };
}

/**
 * Segment rows for a selection of keywords.
 *
 * Takes the keyword set as an argument rather than reaching for the registry,
 * so narrowing to one project narrows the segments with it.
 */
export function getSegments(
  keywords: readonly KeywordRecord[],
  dimension: SegmentDimension,
): readonly SegmentRow[] {
  const totalTraffic = sum(keywords.map((record) => record.currentTraffic));
  const buckets = new Map<string, KeywordRecord[]>();

  const keyOf = (record: KeywordRecord): string => {
    switch (dimension) {
      case "project":
        return record.projectId;
      case "cluster":
        return record.clusterId;
      case "intent":
        return record.intent;
      case "format":
        // A keyword's format is the format of the page carrying it. Keywords
        // with no page are grouped as unmapped rather than dropped: an
        // unmapped keyword is a finding, not an absence.
        return formatFor(record);
    }
  };

  for (const record of keywords) {
    const key = keyOf(record);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(record);
    else buckets.set(key, [record]);
  }

  const rows: SegmentRow[] = [];

  for (const [key, group] of buckets) {
    const first = group[0];
    const label =
      dimension === "project"
        ? first.projectName
        : dimension === "cluster"
          ? first.clusterName
          : dimension === "intent"
            ? INTENT_META[first.intent].label
            : key === "unmapped"
              ? "No page mapped"
              : (FORMAT_META[key as keyof typeof FORMAT_META]?.label ?? key);

    rows.push(
      buildRow(
        dimension,
        `${dimension}-${key}`,
        label,
        group,
        // A cluster, intent or format cut within one project belongs to that
        // project; across the portfolio the row spans several, and the id is
        // what scopes it rather than the name.
        dimension === "project" ? first.projectId : first.projectId,
        first.projectName,
        totalTraffic,
      ),
    );
  }

  return rows.sort(
    (a, b) => b.traffic - a.traffic || a.id.localeCompare(b.id),
  );
}

let formatIndex: Map<string, string> | null = null;

/** The format of the page a keyword points at, or `unmapped`. */
function formatFor(record: KeywordRecord): string {
  formatIndex ??= new Map(
    getContentRecords()
      .filter((entry) => entry.url !== null)
      .map((entry) => [entry.url as string, entry.format]),
  );

  if (record.targetUrl === null) return "unmapped";
  return formatIndex.get(record.targetUrl) ?? "unmapped";
}

/**
 * The segments contributing most to a change.
 *
 * Ordered by headroom rather than by size: the biggest cluster is usually the
 * biggest cluster in every window, and listing it first tells a reader nothing
 * they did not already know. What moves the next cycle is where potential sits
 * unclaimed.
 */
export function contributorsFrom(
  rows: readonly SegmentRow[],
  limit = 6,
): readonly SegmentRow[] {
  return [...rows]
    .filter((row) => row.potential > row.traffic)
    .sort(
      (a, b) =>
        b.potential - b.traffic - (a.potential - a.traffic) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, limit);
}

export { getKeywordList };
