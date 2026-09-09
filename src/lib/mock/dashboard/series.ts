import { formatMonth, formatShortDate } from "@/lib/format";
import {
  DATA_AS_OF,
  clamp,
  jitter,
  rand,
  round,
} from "@/lib/mock/dashboard/core";
import type {
  DashboardProject,
  DateRange,
  SeriesMetricId,
  TrendPoint,
  TrendSeries,
} from "@/types/dashboard";

/**
 * The performance trend behind the main chart and every sparkline.
 *
 * A single daily curve is defined once, per project, and then bucketed into
 * whichever window the user selected. That keeps the ranges consistent with
 * one another: switching from 30D to 12M re-buckets the same underlying days
 * rather than showing an unrelated set of numbers.
 *
 * Two kinds of metric are aggregated differently, because they mean different
 * things:
 *  - **Flow** (traffic, conversions) accumulates, so a bucket is the sum of
 *    its days and a window total is the sum of its buckets.
 *  - **Stock** (ranking keywords, visibility index) is a level measured at a
 *    point in time, so a bucket is the mean of its days.
 */

const DAY_MS = 86_400_000;

/** Metrics that accumulate over a bucket rather than being sampled. */
const FLOW_METRICS: ReadonlySet<SeriesMetricId> = new Set([
  "organicTraffic",
  "conversions",
]);

/** Midnight UTC of the day `offset` days before the reference instant. */
function dayAt(offset: number): Date {
  const ms = Date.parse(DATA_AS_OF) - offset * DAY_MS;
  return new Date(Math.floor(ms / DAY_MS) * DAY_MS);
}

type DailyMetrics = {
  organicTraffic: number;
  organicKeywords: number;
  searchVisibility: number;
  conversions: number;
};

/**
 * The four metrics for one project on one day.
 *
 * `offset` counts backwards from the reference instant, so 0 is the most
 * recent day. Growth compounds as the offset shrinks, weekends dip, and a
 * seeded wobble keeps the line from looking machine-drawn.
 */
function dailyMetrics(project: DashboardProject, offset: number): DailyMetrics {
  const date = dayAt(offset);
  const weekday = date.getUTCDay();
  const weekend = weekday === 0 || weekday === 6;

  // Compounding growth: ~3.4% a month, unwound as we walk backwards.
  const growth = 1.034 ** (-offset / 30);
  const seasonal = weekend ? 0.69 : 1;
  const wobble = 1 + jitter(project.seed, offset, 0.045);

  const traffic = 6_620 * project.scale * growth * seasonal * wobble;

  // Ranking keywords and visibility are levels, so no weekend component.
  const keywords =
    8_940 * project.scale * 1.021 ** (-offset / 30) *
    (1 + jitter(project.seed + 17, offset, 0.012));

  const visibility = clamp(
    43.6 * 1.016 ** (-offset / 30) +
      project.healthOffset * 0.22 +
      jitter(project.seed + 41, offset, 0.7),
    1,
    100,
  );

  // Conversion rate drifts a little day to day around 1.42%.
  const conversionRate = 0.0142 * (1 + jitter(project.seed + 73, offset, 0.11));

  return {
    organicTraffic: Math.round(traffic),
    organicKeywords: Math.round(keywords),
    searchVisibility: round(visibility, 1),
    conversions: Math.max(1, Math.round(traffic * conversionRate)),
  };
}

/** Bucket label appropriate to the window's granularity. */
function bucketLabel(iso: string, range: DateRange): string {
  return range.bucket === "month" ? formatMonth(iso) : formatShortDate(iso);
}

/**
 * Aggregates `size` consecutive days into one plotted point, ending at the
 * day `endOffset` days before the reference instant.
 */
function bucketAt(
  project: DashboardProject,
  range: DateRange,
  startOffset: number,
  size: number,
): TrendPoint {
  let traffic = 0;
  let conversions = 0;
  let keywords = 0;
  let visibility = 0;

  for (let day = 0; day < size; day += 1) {
    const metrics = dailyMetrics(project, startOffset - day);
    traffic += metrics.organicTraffic;
    conversions += metrics.conversions;
    keywords += metrics.organicKeywords;
    visibility += metrics.searchVisibility;
  }

  const date = dayAt(startOffset).toISOString();

  return {
    date,
    label: bucketLabel(date, range),
    organicTraffic: traffic,
    conversions,
    organicKeywords: Math.round(keywords / size),
    searchVisibility: round(visibility / size, 1),
  };
}

/** One window of buckets, oldest first. `shift` moves the whole window back. */
function buildWindow(
  project: DashboardProject,
  range: DateRange,
  shift: number,
): readonly TrendPoint[] {
  const size = Math.round(range.days / range.points);

  return Array.from({ length: range.points }, (_, index) => {
    // Bucket 0 is the oldest, so it starts furthest back.
    const startOffset = shift + range.days - index * size - 1;
    return bucketAt(project, range, startOffset, size);
  });
}

function totalsFor(
  points: readonly TrendPoint[],
): Record<SeriesMetricId, number> {
  const metrics: SeriesMetricId[] = [
    "organicTraffic",
    "organicKeywords",
    "searchVisibility",
    "conversions",
  ];

  const totals = {} as Record<SeriesMetricId, number>;

  for (const metric of metrics) {
    const sum = points.reduce((carry, point) => carry + point[metric], 0);
    totals[metric] = FLOW_METRICS.has(metric)
      ? Math.round(sum)
      : round(sum / points.length, 1);
  }

  return totals;
}

/**
 * The current window, the one before it for comparison, and the totals and
 * percentage deltas that the KPI cards and chart legend read from.
 */
export function buildTrendSeries(
  project: DashboardProject,
  range: DateRange,
): TrendSeries {
  const current = buildWindow(project, range, 0);
  const previous = buildWindow(project, range, range.days);

  const currentTotals = totalsFor(current);
  const previousTotals = totalsFor(previous);

  const deltas = {} as Record<SeriesMetricId, number>;
  for (const key of Object.keys(currentTotals) as SeriesMetricId[]) {
    const before = previousTotals[key];
    deltas[key] = before === 0
      ? 0
      : round(((currentTotals[key] - before) / before) * 100, 1);
  }

  return { range, current, previous, totals: currentTotals, deltas };
}

/**
 * A short series for a KPI sparkline.
 *
 * Sparklines share the chart's buckets where the window is already short, and
 * thin longer windows down to twelve points so the line stays readable at
 * card size.
 */
export function sparkFrom(
  points: readonly TrendPoint[],
  metric: SeriesMetricId,
  maxPoints = 12,
): readonly number[] {
  if (points.length <= maxPoints) {
    return points.map((point) => point[metric]);
  }

  const step = points.length / maxPoints;
  return Array.from(
    { length: maxPoints },
    (_, index) => points[Math.min(points.length - 1, Math.round(index * step))][metric],
  );
}

/**
 * Derives a sparkline for a metric that has no daily series of its own, by
 * shaping a seeded curve that lands on `endValue` and reflects `changePercent`
 * over the window. Used by count KPIs such as indexed pages.
 */
export function sparkCurve(
  seed: number,
  endValue: number,
  changePercent: number,
  points = 12,
): readonly number[] {
  const startValue = endValue / (1 + changePercent / 100);

  return Array.from({ length: points }, (_, index) => {
    const progress = index / (points - 1);
    const base = startValue + (endValue - startValue) * progress;
    const wobble = index === points - 1 ? 0 : (rand(seed, index) - 0.5) * 0.03;
    return Math.round(base * (1 + wobble));
  });
}
