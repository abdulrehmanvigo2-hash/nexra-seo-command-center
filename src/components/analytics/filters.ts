import type {
  Anomaly,
  AnomalyKind,
  AttributionRecord,
  Confidence,
  LearningVerdict,
  MovementSignificance,
  PagePerformance,
  PagePerformanceState,
  SegmentRow,
  WorkKind,
} from "@/types/analytics";

/**
 * Filtering for Analytics.
 *
 * One filter object over four record shapes — pages, segments, attribution and
 * anomalies. Somebody narrowing to one project or one page state expects all
 * of them to narrow together, so they share a state object.
 *
 * The project and range live outside this object, on the workspace, because
 * they are not filters over a fixed set: changing either rebuilds the series
 * the whole screen is read from.
 */

export type AnalyticsFilters = {
  /** Matched against page, cluster, work, and finding text. */
  readonly query: string;
  readonly pageState: PagePerformanceState | "all";
  readonly workKind: WorkKind | "all";
  readonly anomalyKind: AnomalyKind | "all";
  readonly verdict: LearningVerdict | "all";
  readonly confidence: Confidence | "all";
  readonly significance: MovementSignificance | "all";
  /** Narrows to pages with headroom left, which is where the work is. */
  readonly headroomOnly: boolean;
};

export const EMPTY_ANALYTICS_FILTERS: AnalyticsFilters = {
  query: "",
  pageState: "all",
  workKind: "all",
  anomalyKind: "all",
  verdict: "all",
  confidence: "all",
  significance: "all",
  headroomOnly: false,
};

const COUNTED: readonly (keyof AnalyticsFilters)[] = [
  "pageState",
  "workKind",
  "anomalyKind",
  "verdict",
  "confidence",
  "significance",
];

export function activeAnalyticsFilterCount(
  filters: AnalyticsFilters,
): number {
  return (
    COUNTED.filter((key) => filters[key] !== "all").length +
    (filters.headroomOnly ? 1 : 0)
  );
}

export function hasActiveAnalyticsFilters(
  filters: AnalyticsFilters,
): boolean {
  return (
    filters.query.trim().length > 0 || activeAnalyticsFilterCount(filters) > 0
  );
}

function matches(haystack: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  return haystack.toLowerCase().includes(needle);
}

export function matchesPage(
  page: PagePerformance,
  filters: AnalyticsFilters,
): boolean {
  if (filters.pageState !== "all" && page.state !== filters.pageState) {
    return false;
  }
  if (filters.headroomOnly && page.headroom <= 0) return false;
  return matches(
    `${page.title} ${page.path} ${page.projectName} ${page.clusterName}`,
    filters.query,
  );
}

export function matchesSegment(
  row: SegmentRow,
  filters: AnalyticsFilters,
): boolean {
  if (filters.headroomOnly && row.potential <= row.traffic) return false;
  return matches(`${row.label} ${row.projectName}`, filters.query);
}

export function matchesAttribution(
  entry: AttributionRecord,
  filters: AnalyticsFilters,
): boolean {
  if (filters.workKind !== "all" && entry.kind !== filters.workKind) {
    return false;
  }
  if (filters.confidence !== "all" && entry.confidence !== filters.confidence) {
    return false;
  }
  return matches(
    `${entry.workTitle} ${entry.outcomeLabel} ${entry.sourceModule} ${entry.projectName}`,
    filters.query,
  );
}

export function matchesAnomaly(
  anomaly: Anomaly,
  filters: AnalyticsFilters,
): boolean {
  if (filters.anomalyKind !== "all" && anomaly.kind !== filters.anomalyKind) {
    return false;
  }
  if (
    filters.significance !== "all" &&
    anomaly.significance !== filters.significance
  ) {
    return false;
  }
  if (filters.confidence !== "all" && anomaly.confidence !== filters.confidence) {
    return false;
  }
  return matches(
    `${anomaly.label} ${anomaly.finding} ${anomaly.explanation ?? ""} ${anomaly.projectName}`,
    filters.query,
  );
}

export function matchesLearning(
  learning: { verdict: LearningVerdict; headline: string; observation: string; recommendation: string; confidence: Confidence },
  filters: AnalyticsFilters,
): boolean {
  if (filters.verdict !== "all" && learning.verdict !== filters.verdict) {
    return false;
  }
  if (
    filters.confidence !== "all" &&
    learning.confidence !== filters.confidence
  ) {
    return false;
  }
  return matches(
    `${learning.headline} ${learning.observation} ${learning.recommendation}`,
    filters.query,
  );
}
