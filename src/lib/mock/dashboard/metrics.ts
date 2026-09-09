import {
  formatCompact,
  formatCurrencyCompact,
  formatNumber,
} from "@/lib/format";
import {
  clamp,
  deltaFor,
  round,
  scoreFor,
  volumeFor,
} from "@/lib/mock/dashboard/core";
import { sparkCurve, sparkFrom } from "@/lib/mock/dashboard/series";
import type {
  DashboardProject,
  DateRange,
  KeywordSnapshot,
  KpiCardData,
  MetricHealth,
  ScoreCardData,
  TrendSeries,
} from "@/types/dashboard";

/**
 * The two headline bands at the top of the Command Center: the six health
 * scores, and the eight volume KPIs.
 *
 * Both are derived from the same trend series and keyword snapshot the rest of
 * the page uses, so the numbers agree with the chart and the module snapshots
 * below them rather than being an independent set of figures.
 */

/** Average value of an organic session, used for the traffic-value estimate. */
const SESSION_VALUE_USD = 2.24;

/**
 * Grades a 0-100 score, then downgrades it one step where the trend is
 * clearly falling: a decent score heading downhill is a warning, not a pass.
 */
function healthFromScore(score: number, trendValue: number): MetricHealth {
  const base: MetricHealth =
    score >= 75 ? "positive"
    : score >= 60 ? "neutral"
    : score >= 45 ? "warning"
    : "negative";

  if (trendValue > -3) return base;

  return base === "positive" ? "neutral"
    : base === "neutral" ? "warning"
    : "negative";
}

/** Grades a volume metric purely on the direction and size of its change. */
function healthFromTrend(value: number, invert = false): MetricHealth {
  const effective = invert ? -value : value;
  if (effective >= 3) return "positive";
  if (effective >= -1) return "neutral";
  if (effective >= -8) return "warning";
  return "negative";
}

type ScoreSeed = {
  readonly id: ScoreCardData["id"];
  readonly label: string;
  readonly base: number;
  readonly icon: ScoreCardData["icon"];
  readonly explanation: string;
};

const SCORE_SEEDS: readonly ScoreSeed[] = [
  {
    id: "seo-health",
    label: "SEO Health",
    base: 82,
    icon: "command-center",
    explanation:
      "Composite of crawl health, content quality, authority, and Core Web Vitals, weighted by traffic exposure.",
  },
  {
    id: "organic-visibility",
    label: "Organic Visibility",
    base: 76,
    icon: "analytics",
    explanation:
      "Share of possible impressions captured across the tracked keyword set, weighted by search volume.",
  },
  {
    id: "technical-health",
    label: "Technical Health",
    base: 71,
    icon: "technical",
    explanation:
      "Crawlability, indexation, redirects, and Core Web Vitals across every crawled template.",
  },
  {
    id: "content-performance",
    label: "Content Performance",
    base: 74,
    icon: "content",
    explanation:
      "Median engagement, ranking movement, and conversion contribution across published pages.",
  },
  {
    id: "authority",
    label: "Authority Score",
    base: 63,
    icon: "backlinks",
    explanation:
      "Strength of the link profile: referring-domain quality, topical relevance, and growth rate.",
  },
  {
    id: "ai-visibility",
    label: "AI Search Visibility",
    base: 61,
    icon: "ai-visibility",
    explanation:
      "Presence in AI answers and generative engines: citations, mentions, and answer coverage.",
  },
];

/** The six 0-100 indices in the health strip. */
export function buildScoreCards(
  project: DashboardProject,
  range: DateRange,
): readonly ScoreCardData[] {
  return SCORE_SEEDS.map((seed, index) => {
    const score = scoreFor(project, seed.base, index);
    const trendValue = deltaFor(project, range, index, 3.2, 5.4);

    return {
      id: seed.id,
      label: seed.label,
      score,
      trend: { value: trendValue },
      health: healthFromScore(score, trendValue),
      icon: seed.icon,
      explanation: seed.explanation,
    };
  });
}

/** The eight volume KPIs beneath the health strip. */
export function buildKpiCards(
  project: DashboardProject,
  range: DateRange,
  trend: TrendSeries,
  keywords: KeywordSnapshot,
): readonly KpiCardData[] {
  const { comparison } = range;
  const traffic = trend.totals.organicTraffic;
  const trafficDelta = trend.deltas.organicTraffic;
  const conversions = trend.totals.conversions;
  const conversionDelta = trend.deltas.conversions;

  const trafficValue = traffic * SESSION_VALUE_USD;
  const trafficValueDelta = round(trafficDelta + deltaFor(project, range, 21, 1.4, 1.8), 1);

  const buckets = keywords.distribution;
  const bucketBy = (id: string) =>
    buckets.find((bucket) => bucket.id === id) ?? {
      count: 0,
      change: 0,
    };

  const top3 = bucketBy("top-3");
  const top10Count = top3.count + bucketBy("4-10").count;
  const top10Change = top3.change + bucketBy("4-10").change;
  const top100Count = buckets.reduce((carry, bucket) => carry + bucket.count, 0);
  const top100Change = buckets.reduce((carry, bucket) => carry + bucket.change, 0);

  const indexedPages = volumeFor(project, 48_240, 31);
  const indexedDelta = deltaFor(project, range, 31, 1.9, 2.6);

  /** Percentage change implied by an absolute movement in a count. */
  const percentOf = (count: number, change: number) =>
    count - change <= 0 ? 0 : round((change / (count - change)) * 100, 1);

  return [
    {
      id: "organic-traffic",
      label: "Organic Traffic",
      value: formatCompact(traffic),
      unit: "sessions",
      trend: { value: trafficDelta },
      comparison,
      health: healthFromTrend(trafficDelta),
      icon: "analytics",
      explanation:
        "Non-paid sessions from search engines across every tracked property in the selected window.",
      spark: sparkFrom(trend.current, "organicTraffic"),
      footnote: `${formatNumber(traffic)} sessions in ${range.caption.toLowerCase()}`,
    },
    {
      id: "traffic-value",
      label: "Traffic Value",
      value: formatCurrencyCompact(trafficValue),
      unit: "estimated",
      trend: { value: trafficValueDelta },
      comparison,
      health: healthFromTrend(trafficValueDelta),
      icon: "value",
      explanation:
        "What the organic sessions would cost to buy, priced at the average cost per click of the terms that earned them.",
      spark: sparkFrom(trend.current, "organicTraffic").map((point) =>
        Math.round(point * SESSION_VALUE_USD),
      ),
      footnote: `Priced at $${SESSION_VALUE_USD.toFixed(2)} average per session`,
    },
    {
      id: "conversions",
      label: "Conversions",
      value: formatNumber(conversions),
      unit: "leads",
      trend: { value: conversionDelta },
      comparison,
      health: healthFromTrend(conversionDelta),
      icon: "target",
      explanation:
        "Goal completions attributed to organic search: form submissions, demo requests, and bookings.",
      spark: sparkFrom(trend.current, "conversions"),
      footnote: `${round((conversions / Math.max(traffic, 1)) * 100, 2)}% conversion rate`,
    },
    {
      id: "ranking-keywords",
      label: "Ranking Keywords",
      value: formatCompact(keywords.tracked),
      unit: "tracked",
      trend: { value: trend.deltas.organicKeywords },
      comparison,
      health: healthFromTrend(trend.deltas.organicKeywords),
      icon: "keywords",
      explanation:
        "Every term the tracked properties rank for, including those outside the first ten pages.",
      spark: sparkFrom(trend.current, "organicKeywords"),
      footnote: `${formatNumber(top100Count)} ranking inside the top 100`,
    },
    {
      id: "top-3",
      label: "Top 3 Rankings",
      value: formatNumber(top3.count),
      unit: "keywords",
      trend: { value: percentOf(top3.count, top3.change) },
      comparison,
      health: healthFromTrend(percentOf(top3.count, top3.change)),
      icon: "trend-up",
      explanation:
        "Keywords holding positions one to three, where the large majority of clicks are won.",
      spark: sparkCurve(project.seed + 3, top3.count, percentOf(top3.count, top3.change)),
      footnote: `${top3.change >= 0 ? "+" : "−"}${Math.abs(top3.change)} against the previous window`,
    },
    {
      id: "top-10",
      label: "Top 10 Rankings",
      value: formatNumber(top10Count),
      unit: "keywords",
      trend: { value: percentOf(top10Count, top10Change) },
      comparison,
      health: healthFromTrend(percentOf(top10Count, top10Change)),
      icon: "keywords",
      explanation:
        "Keywords ranking on the first page of results for the tracked search engines.",
      spark: sparkCurve(project.seed + 10, top10Count, percentOf(top10Count, top10Change)),
      footnote: `${round((top10Count / Math.max(keywords.tracked, 1)) * 100, 1)}% of the tracked set`,
    },
    {
      id: "top-100",
      label: "Top 100 Rankings",
      value: formatCompact(top100Count),
      unit: "keywords",
      trend: { value: percentOf(top100Count, top100Change) },
      comparison,
      health: healthFromTrend(percentOf(top100Count, top100Change)),
      icon: "layers",
      explanation:
        "Keywords ranking anywhere in the first hundred results — the pool that can be moved onto page one.",
      spark: sparkCurve(project.seed + 100, top100Count, percentOf(top100Count, top100Change)),
      footnote: `Average position ${keywords.movement.averagePosition}`,
    },
    {
      id: "indexed-pages",
      label: "Indexed Pages",
      value: formatCompact(indexedPages),
      unit: "URLs",
      trend: { value: indexedDelta },
      comparison,
      health: healthFromTrend(indexedDelta),
      icon: "pages",
      explanation:
        "URLs currently held in the search index, measured against the URLs submitted in the sitemap.",
      spark: sparkCurve(project.seed + 48, indexedPages, indexedDelta),
      footnote: `${round(clamp(94.2 + project.healthOffset * 0.28, 60, 99.8), 1)}% of submitted URLs`,
    },
  ];
}
