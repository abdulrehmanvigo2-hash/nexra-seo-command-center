import { formatCompact, formatNumber, formatPercent } from "@/lib/format";
import {
  DASHBOARD_PROJECTS,
  DATA_AS_OF,
  buildTrendSeries,
  getRange,
} from "@/lib/mock/dashboard";
import { getKeywordList } from "@/lib/mock/keywords";
import {
  METRIC_META,
  METRIC_ORDER,
  PAGE_STATE_META,
  PAGE_STATE_ORDER,
} from "@/lib/mock/analytics/meta";
import {
  changeBetween,
  directionFor,
  mean,
  ratio,
  significanceFor,
  sum,
} from "@/lib/mock/analytics/scoring";
import { contributorsFrom, getSegments } from "@/lib/mock/analytics/segments";
import { getPagePerformance } from "@/lib/mock/analytics/pages";
import { getAttribution } from "@/lib/mock/analytics/attribution";
import { getAnomalies } from "@/lib/mock/analytics/anomalies";
import { getLearnings } from "@/lib/mock/analytics/learnings";
import type {
  AnalyticsDatasetCounts,
  AnalyticsDistributionRow,
  AnalyticsMetric,
  AnalyticsOverview,
  AnalyticsSeries,
  MetricReading,
  RangeId,
  SegmentDimension,
  SeriesMetricId,
  TrendPoint,
} from "@/types/analytics";

/**
 * Analytics: the module's public surface.
 *
 * Analytics measures; it does not own. The series is the Command Center's, the
 * pages are Content Studio's, the keywords are Keyword Intelligence's, and the
 * work in the attribution view belongs to the queues that publish it. Every
 * reading below takes a selection so that narrowing to one project narrows the
 * whole screen with it.
 *
 * Dependency direction is one-way: this module reads dashboard, keywords,
 * content, technical, ai-visibility and backlinks. None of those read back.
 */

export const ANALYTICS_AS_OF = DATA_AS_OF;

export {
  ANALYTICS_SOURCE_NOTE,
  ANALYTICS_SOURCE_SHORT,
  ANOMALY_KIND_META,
  ANOMALY_KIND_ORDER,
  ATTRIBUTION_NOTE,
  CONFIDENCE_META,
  DIRECTION_META,
  METRIC_META,
  METRIC_ORDER,
  PAGE_STATE_META,
  PAGE_STATE_ORDER,
  PROVENANCE_META,
  SEGMENT_META,
  SEGMENT_ORDER,
  SIGNIFICANCE_META,
  SIGNIFICANCE_ORDER,
  VERDICT_META,
  VERDICT_ORDER,
  WORK_KIND_META,
  WORK_KIND_ORDER,
} from "@/lib/mock/analytics/meta";

export {
  DORMANT_TRAFFIC,
  PERFORMING_SHARE,
  SIGNIFICANCE_FLOORS,
  changeBetween,
  directionFor,
  headroomFor,
  significanceFor,
} from "@/lib/mock/analytics/scoring";

export {
  getPagePerformance,
  pagePerformanceFor,
  pagesForProject,
} from "@/lib/mock/analytics/pages";

export { contributorsFrom, getSegments } from "@/lib/mock/analytics/segments";

export {
  attributionForPage,
  attributionForProject,
  getAttribution,
} from "@/lib/mock/analytics/attribution";

export { getAnomalies } from "@/lib/mock/analytics/anomalies";
export { getLearnings } from "@/lib/mock/analytics/learnings";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tally(values: readonly string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return result;
}

/** Projects that carry a link to a real dashboard project. */
const REAL_PROJECTS = DASHBOARD_PROJECTS.filter(
  (project) => project.id !== "portfolio",
);

export function getAnalyticsProjectOptions(): readonly {
  readonly id: string;
  readonly name: string;
}[] {
  return REAL_PROJECTS.map((project) => ({
    id: project.id,
    name: project.name,
  }));
}

// ---------------------------------------------------------------------------
// Series
// ---------------------------------------------------------------------------

/**
 * The trend series for a selection.
 *
 * For a single project this is the Command Center's own series, unchanged —
 * the two screens quote the same numbers because they read the same builder.
 * For the portfolio the windows are summed point by point, and the visibility
 * index is averaged rather than summed, because an index does not add.
 */
export function getAnalyticsSeries(
  projectId: string,
  rangeId: RangeId,
): AnalyticsSeries {
  const range = getRange(rangeId);

  const projects =
    projectId === "portfolio"
      ? REAL_PROJECTS
      : REAL_PROJECTS.filter((project) => project.id === projectId);

  const built = projects.map((project) => buildTrendSeries(project, range));

  if (built.length === 0) {
    return {
      range,
      current: [],
      previous: [],
      totals: {
        organicTraffic: 0,
        organicKeywords: 0,
        searchVisibility: 0,
        conversions: 0,
      },
      deltas: {
        organicTraffic: 0,
        organicKeywords: 0,
        searchVisibility: 0,
        conversions: 0,
      },
      projectIds: [],
      provenance: "series",
    };
  }

  if (built.length === 1) {
    const single = built[0];
    return {
      range: single.range,
      current: single.current,
      previous: single.previous,
      totals: single.totals,
      deltas: single.deltas,
      projectIds: projects.map((project) => project.id),
      provenance: "series",
    };
  }

  const combine = (
    windows: readonly (readonly TrendPoint[])[],
  ): readonly TrendPoint[] => {
    const length = windows[0].length;
    const out: TrendPoint[] = [];

    for (let index = 0; index < length; index += 1) {
      const slice = windows.map((points) => points[index]);
      out.push({
        date: slice[0].date,
        label: slice[0].label,
        organicTraffic: sum(slice.map((point) => point.organicTraffic)),
        organicKeywords: sum(slice.map((point) => point.organicKeywords)),
        // An index is a position, not a quantity: summing nine of them would
        // produce a number with no meaning.
        searchVisibility: Math.round(
          mean(slice.map((point) => point.searchVisibility)),
        ),
        conversions: sum(slice.map((point) => point.conversions)),
      });
    }

    return out;
  };

  const current = combine(built.map((entry) => entry.current));
  const previous = combine(built.map((entry) => entry.previous));

  const totalsFor = (points: readonly TrendPoint[]) => ({
    organicTraffic: sum(points.map((point) => point.organicTraffic)),
    organicKeywords: Math.round(
      mean(points.map((point) => point.organicKeywords)),
    ),
    searchVisibility: Math.round(
      mean(points.map((point) => point.searchVisibility)),
    ),
    conversions: sum(points.map((point) => point.conversions)),
  });

  const totals = totalsFor(current);
  const before = totalsFor(previous);

  const deltas = {} as Record<SeriesMetricId, number>;
  for (const key of METRIC_ORDER) {
    deltas[key] = changeBetween(totals[key], before[key]);
  }

  return {
    range,
    current,
    previous,
    totals,
    deltas,
    projectIds: projects.map((project) => project.id),
    provenance: "series",
  };
}

/** The four headline metrics, each with its own movement reading. */
export function getReadings(series: AnalyticsSeries): readonly MetricReading[] {
  return METRIC_ORDER.map((id) => {
    const delta = series.deltas[id];
    const significance = significanceFor(delta);
    const direction = directionFor(delta);
    const raw = series.totals[id];

    return {
      id,
      label: METRIC_META[id].label,
      value:
        id === "searchVisibility"
          ? String(Math.round(raw))
          : formatCompact(Math.round(raw)),
      raw,
      delta,
      direction,
      significance,
      invert: false,
      detail:
        significance === "noise"
          ? `${delta > 0 ? "+" : ""}${delta}% — inside the range this dataset moves in anyway.`
          : `${delta > 0 ? "+" : ""}${delta}% ${series.range.comparison}.`,
      icon: METRIC_META[id].icon,
      health:
        direction === "flat"
          ? "neutral"
          : direction === "up"
            ? "positive"
            : significance === "material"
              ? "negative"
              : "warning",
      provenance: "series",
    } satisfies MetricReading;
  });
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

/**
 * The headline reading for a selection.
 *
 * One call, because every figure has to describe the same set. Assembling them
 * separately in the component is how a card ends up counting a page the table
 * below it has already filtered out.
 */
export function getAnalyticsOverview(
  projectId: string,
  rangeId: RangeId,
  dimension: SegmentDimension = "cluster",
): AnalyticsOverview {
  const series = getAnalyticsSeries(projectId, rangeId);
  const scoped = new Set(
    projectId === "portfolio"
      ? REAL_PROJECTS.map((project) => project.id)
      : [projectId],
  );

  const keywords = getKeywordList().filter((record) =>
    scoped.has(record.projectId),
  );
  const pages = getPagePerformance().filter((page) =>
    scoped.has(page.projectId),
  );
  const segments = getSegments(keywords, dimension);
  const attribution = getAttribution().filter((entry) =>
    scoped.has(entry.projectId),
  );
  const anomalies = getAnomalies(series, [...scoped]);

  const project = REAL_PROJECTS.find((entry) => entry.id === projectId);
  const learnings = getLearnings({
    projectId: projectId === "portfolio" ? "portfolio" : projectId,
    projectName: project?.name ?? "the portfolio",
    segments,
    pages,
    anomalies,
    attribution,
  });

  const headroom = pages.reduce((carry, page) => carry + page.headroom, 0);
  const opportunityValue = pages.reduce(
    (carry, page) => carry + page.opportunityValue,
    0,
  );

  const stateCounts = tally(pages.map((page) => page.state));

  const metrics: readonly AnalyticsMetric[] = [
    {
      id: "traffic",
      label: METRIC_META.organicTraffic.label,
      value: formatCompact(Math.round(series.totals.organicTraffic)),
      detail: `${series.deltas.organicTraffic > 0 ? "+" : ""}${series.deltas.organicTraffic}% ${series.range.comparison}.`,
      icon: "analytics",
      health:
        directionFor(series.deltas.organicTraffic) === "down"
          ? "negative"
          : directionFor(series.deltas.organicTraffic) === "up"
            ? "positive"
            : "neutral",
    },
    {
      id: "visibility",
      label: METRIC_META.searchVisibility.label,
      value: String(Math.round(series.totals.searchVisibility)),
      unit: "/ 100",
      detail: METRIC_META.searchVisibility.description,
      icon: "gauge",
      health: series.totals.searchVisibility >= 50 ? "positive" : "warning",
    },
    {
      id: "keywords",
      label: METRIC_META.organicKeywords.label,
      value: formatCompact(Math.round(series.totals.organicKeywords)),
      detail: `${keywords.length} tracked across this selection.`,
      icon: "keywords",
      health: "neutral",
    },
    {
      id: "conversions",
      label: METRIC_META.conversions.label,
      value: formatCompact(Math.round(series.totals.conversions)),
      detail: "Modelled. No conversion feed is connected.",
      icon: "value",
      health:
        directionFor(series.deltas.conversions) === "down"
          ? "warning"
          : "neutral",
    },
    {
      id: "headroom",
      label: "Unclaimed sessions",
      value: formatCompact(Math.round(headroom)),
      detail: "A month, across published pages below their potential.",
      icon: "target",
      health: "neutral",
    },
    {
      id: "value",
      label: "Headroom value",
      value: `$${formatCompact(Math.round(opportunityValue))}`,
      detail: "That gap priced at the keywords' listed cost per click.",
      icon: "value",
      health: "neutral",
    },
    {
      id: "compounding",
      label: "Compounding pages",
      value: formatNumber(stateCounts.compounding ?? 0),
      unit: `of ${formatCompact(pages.length)}`,
      detail: "Carrying most of their potential and still climbing.",
      icon: "trend-up",
      health: (stateCounts.compounding ?? 0) > 0 ? "positive" : "neutral",
    },
    {
      id: "decaying",
      label: "Decaying pages",
      value: formatNumber(stateCounts.decaying ?? 0),
      detail: "Losing ground. Cheaper to catch now than to rebuild later.",
      icon: "trend-down",
      health: (stateCounts.decaying ?? 0) === 0 ? "positive" : "negative",
    },
    {
      id: "anomalies",
      label: "Movements to explain",
      value: formatNumber(anomalies.length),
      detail: `${anomalies.filter((entry) => entry.explanation !== null).length} have a finding behind them.`,
      icon: "alert",
      health: anomalies.length === 0 ? "positive" : "warning",
    },
    {
      id: "attribution",
      label: "Work beside movement",
      value: formatNumber(attribution.length),
      detail: "Association only — nothing here establishes cause.",
      icon: "workflow",
      health: "neutral",
    },
    {
      id: "learnings",
      label: "Learnings routed",
      value: formatNumber(learnings.length),
      detail: "Recommendations sent back to the SEO Director.",
      icon: "sparkles",
      health: "neutral",
    },
    {
      id: "coverage",
      label: "Pages measured",
      value: formatNumber(pages.length),
      detail: `${formatPercent(ratio(pages.length - (stateCounts.dormant ?? 0), Math.max(pages.length, 1)), 0)} carry enough traffic to read.`,
      icon: "pages",
      health: "neutral",
    },
  ];

  const pageStates: readonly AnalyticsDistributionRow[] = PAGE_STATE_ORDER.filter(
    (state) => (stateCounts[state] ?? 0) > 0,
  ).map((state) => ({
    id: state,
    label: PAGE_STATE_META[state].label,
    count: stateCounts[state],
    share: ratio(stateCounts[state], pages.length),
    tone: PAGE_STATE_META[state].tone,
    description: PAGE_STATE_META[state].description,
  }));

  return {
    series,
    readings: getReadings(series),
    metrics,
    contributors: contributorsFrom(segments),
    pageStates,
    topPages: [...pages]
      .sort(
        (a, b) => b.traffic - a.traffic || a.contentId.localeCompare(b.contentId),
      )
      .slice(0, 8),
    decayingPages: [...pages]
      .filter((page) => page.state === "decaying")
      .sort(
        (a, b) =>
          a.positionChange - b.positionChange ||
          a.contentId.localeCompare(b.contentId),
      )
      .slice(0, 8),
    anomalies,
    learnings,
    attribution: attribution.slice(0, 8),
    headroom,
    opportunityValue,
  };
}

// ---------------------------------------------------------------------------
// Integration readers
// ---------------------------------------------------------------------------

/**
 * The counts other modules show.
 *
 * Read from the same builders the workspace reads, so a figure quoted on the
 * Command Center and the same figure inside this module are one reading rather
 * than two. `"portfolio"` means every project.
 */
export type AnalyticsSnapshotCounts = {
  readonly traffic: number;
  readonly trafficDelta: number;
  readonly visibility: number;
  readonly conversions: number;
  readonly headroom: number;
  readonly opportunityValue: number;
  readonly pages: number;
  readonly compounding: number;
  readonly decaying: number;
  readonly anomalies: number;
  readonly unexplained: number;
  readonly learnings: number;
  readonly topLearning: AnalyticsOverview["learnings"][number] | null;
};

export function getAnalyticsSnapshotCounts(
  projectId: string,
  rangeId: RangeId = "30d",
): AnalyticsSnapshotCounts {
  const overview = getAnalyticsOverview(projectId, rangeId);
  const scoped = new Set(
    projectId === "portfolio"
      ? REAL_PROJECTS.map((project) => project.id)
      : [projectId],
  );
  const pages = getPagePerformance().filter((page) =>
    scoped.has(page.projectId),
  );

  return {
    traffic: Math.round(overview.series.totals.organicTraffic),
    trafficDelta: overview.series.deltas.organicTraffic,
    visibility: Math.round(overview.series.totals.searchVisibility),
    conversions: Math.round(overview.series.totals.conversions),
    headroom: Math.round(overview.headroom),
    opportunityValue: Math.round(overview.opportunityValue),
    pages: pages.length,
    compounding: pages.filter((page) => page.state === "compounding").length,
    decaying: pages.filter((page) => page.state === "decaying").length,
    anomalies: overview.anomalies.length,
    unexplained: overview.anomalies.filter(
      (entry) => entry.explanation === null,
    ).length,
    learnings: overview.learnings.length,
    topLearning: overview.learnings[0] ?? null,
  };
}

// ---------------------------------------------------------------------------
// Development inspector
// ---------------------------------------------------------------------------

/**
 * Counts and an integrity pass, for `/dev/data`.
 *
 * Every finding the pass can return is a way this reading layer could
 * contradict the canonical layers beneath it, or could make a claim the
 * product has no right to make. An empty list is the passing result.
 */
export function getAnalyticsDatasetCounts(): AnalyticsDatasetCounts {
  const pages = getPagePerformance();
  const attribution = getAttribution();
  const portfolio = getAnalyticsOverview("portfolio", "30d");
  const segments = getSegments(getKeywordList(), "cluster");

  const contentIds = new Set(pages.map((page) => page.contentId));
  const projectIds = new Set(pages.map((page) => page.projectId));
  const integrity: string[] = [];

  const note = (condition: boolean, message: string) => {
    if (condition) integrity.push(message);
  };

  note(contentIds.size !== pages.length, "Duplicate page-performance records");
  note(
    new Set(attribution.map((entry) => entry.id)).size !== attribution.length,
    "Duplicate attribution ids",
  );
  note(
    new Set(segments.map((row) => row.id)).size !== segments.length,
    "Duplicate segment ids",
  );
  note(
    new Set(portfolio.anomalies.map((entry) => entry.id)).size !==
      portfolio.anomalies.length,
    "Duplicate anomaly ids",
  );
  note(
    new Set(portfolio.learnings.map((entry) => entry.id)).size !==
      portfolio.learnings.length,
    "Duplicate learning ids",
  );

  // -- referential integrity --------------------------------------------
  note(
    attribution.some(
      (entry) =>
        !contentIds.has(entry.outcomeHref.replace("/content/", "")),
    ),
    "Attribution references a page outside the content inventory",
  );
  note(
    attribution.some((entry) => !projectIds.has(entry.projectId)),
    "Attribution references an unknown project",
  );
  note(
    segments.some((row) => !projectIds.has(row.projectId)),
    "Segment references an unknown project",
  );

  // -- project scope -----------------------------------------------------
  const pageProject = new Map(
    pages.map((page) => [page.contentId, page.projectId]),
  );
  note(
    attribution.some(
      (entry) =>
        pageProject.get(entry.outcomeHref.replace("/content/", "")) !==
        entry.projectId,
    ),
    "Attribution pairs work and an outcome from different projects",
  );

  const scopedOverview = getAnalyticsOverview([...projectIds][0], "30d");
  note(
    scopedOverview.topPages.some(
      (page) => page.projectId !== [...projectIds][0],
    ),
    "A project overview includes pages from another project",
  );
  note(
    scopedOverview.series.projectIds.length !== 1,
    "A project series is built from more than one project",
  );

  // -- claims the product has no right to make --------------------------
  // Attribution must never assert cause. Confidence is capped at medium by
  // `attributionConfidence`; this checks the guarantee survived.
  note(
    attribution.some((entry) => entry.confidence === "high"),
    "An attribution record claims high confidence, which no holdout supports",
  );
  note(
    attribution.some((entry) => entry.caveat.trim().length === 0),
    "An attribution record carries no caveat",
  );
  note(
    portfolio.anomalies.some(
      (entry) => entry.explanation === null && entry.confidence !== "none",
    ),
    "An anomaly with no explanation claims confidence in one",
  );
  note(
    portfolio.anomalies.some(
      (entry) => entry.explanation !== null && entry.explanationHref === null,
    ),
    "An anomaly offers an explanation with nowhere to verify it",
  );

  // -- readings agree with their own thresholds --------------------------
  note(
    portfolio.readings.some(
      (reading) => significanceFor(reading.delta) !== reading.significance,
    ),
    "A metric reading disagrees with its own significance band",
  );
  note(
    portfolio.readings.some(
      (reading) => directionFor(reading.delta) !== reading.direction,
    ),
    "A metric reading disagrees with its own direction",
  );
  note(
    portfolio.readings.some(
      (reading) => reading.direction === "flat" && reading.significance !== "noise",
    ),
    "A flat reading is not in the noise band",
  );

  // -- a series that could exist ----------------------------------------
  note(
    portfolio.series.current.length !== portfolio.series.previous.length,
    "The comparison window has a different number of points",
  );
  note(
    portfolio.series.current.length === 0,
    "The portfolio series has no points",
  );
  note(
    portfolio.series.totals.searchVisibility > 100,
    "Search visibility is an index and cannot exceed 100",
  );

  // -- pages agree with their own state ----------------------------------
  note(
    pages.some(
      (page) => page.state === "dormant" && page.traffic >= 25,
    ),
    "A dormant page carries enough traffic to read",
  );
  note(
    pages.some((page) => page.headroom < 0),
    "A page reports negative headroom",
  );
  note(
    pages.some((page) => page.traffic > page.potential && page.headroom > 0),
    "A page above its own potential still reports headroom",
  );

  // -- degenerate data ---------------------------------------------------
  const distinctTrafficValues = new Set(pages.map((page) => page.traffic)).size;
  note(
    pages.length > 50 && distinctTrafficValues < 20,
    `Only ${distinctTrafficValues} distinct traffic figures across ${pages.length} pages`,
  );
  note(
    new Set(pages.map((page) => page.state)).size < 3,
    "Page states are too uniform to be meaningful",
  );
  note(portfolio.learnings.length === 0, "No learnings derived for the portfolio");
  note(
    portfolio.anomalies.length === 0,
    "No anomalies raised across the portfolio",
  );

  return {
    projects: projectIds.size,
    pages: pages.length,
    segments: segments.length,
    attribution: attribution.length,
    anomalies: portfolio.anomalies.length,
    learnings: portfolio.learnings.length,
    seriesPoints: portfolio.series.current.length,
    byPageState: tally(pages.map((page) => page.state)),
    bySegmentDimension: tally(segments.map((row) => row.dimension)),
    byWorkKind: tally(attribution.map((entry) => entry.kind)),
    byAnomalyKind: tally(portfolio.anomalies.map((entry) => entry.kind)),
    byVerdict: tally(portfolio.learnings.map((entry) => entry.verdict)),
    byConfidence: tally(attribution.map((entry) => entry.confidence)),
    // Sampled across every range, not just the default: a month-on-month
    // reading on a series that compounds at 3.4% is noise by construction, and
    // checking only that window would report a vocabulary as unreachable when
    // it is simply not reachable *there*.
    bySignificance: tally(
      (["7d", "30d", "3m", "6m", "12m"] as const).flatMap((rangeId) =>
        getReadings(getAnalyticsSeries("portfolio", rangeId)).map(
          (reading) => reading.significance,
        ),
      ),
    ),
    distinctTrafficValues,
    integrity,
  };
}
