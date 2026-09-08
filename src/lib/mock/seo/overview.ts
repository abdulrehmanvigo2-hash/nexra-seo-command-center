import type { OverviewMetric, RecentWin } from "@/types/seo";

/**
 * Portfolio-level headline metrics and the wins behind them.
 *
 * Demo fixtures. Every client, figure, and date here is invented — nothing in
 * this file comes from a real account, API, or analytics property.
 *
 * The eight metrics cover the current 28-day window ending 2026-09-07. Values
 * agree with the daily series in `analytics.ts`: the organic-traffic total is
 * the sum of that series, and the AI visibility score is its closing value.
 */
export const OVERVIEW_METRICS: readonly OverviewMetric[] = [
  {
    id: "seo-health",
    label: "SEO Health Score",
    value: "82",
    unit: "/ 100",
    trend: { value: 4.2 },
    comparison: "vs previous 28 days",
    icon: "command-center",
    detail: "Weighted across crawl, content, authority, and Core Web Vitals.",
  },
  {
    id: "organic-traffic",
    label: "Organic Traffic",
    value: "184,920",
    unit: "sessions",
    trend: { value: 12.4 },
    comparison: "vs previous 28 days",
    icon: "analytics",
    detail: "All five active projects, non-branded and branded combined.",
  },
  {
    id: "keywords-tracked",
    label: "Keywords Tracked",
    value: "12,480",
    trend: { value: 3.1 },
    comparison: "vs previous 28 days",
    icon: "keywords",
    detail: "412 added this cycle from the intent-clustering pass.",
  },
  {
    id: "ranking-growth",
    label: "Ranking Growth",
    value: "+1,204",
    unit: "positions",
    trend: { value: 18.6 },
    comparison: "vs previous 28 days",
    icon: "trend-up",
    detail: "Net position movement across the tracked keyword set.",
  },
  {
    id: "critical-issues",
    label: "Critical Issues",
    value: "14",
    unit: "open",
    trend: { value: -22.2, invert: true },
    comparison: "vs previous 28 days",
    icon: "technical",
    detail: "Four cleared this week; two await a deploy window.",
  },
  {
    id: "ai-visibility",
    label: "AI Visibility Score",
    value: "61",
    unit: "/ 100",
    trend: { value: 9.8 },
    comparison: "vs previous 28 days",
    icon: "ai-visibility",
    detail: "Answer presence across six generative engines.",
  },
  {
    id: "backlink-growth",
    label: "Backlink Growth",
    value: "+342",
    unit: "referring domains",
    trend: { value: 6.5 },
    comparison: "vs previous 28 days",
    icon: "backlinks",
    detail: "Net of 87 lost domains, mostly expired directory listings.",
  },
  {
    id: "content-performance",
    label: "Content Performance",
    value: "74",
    unit: "/ 100",
    trend: { value: 2.4 },
    comparison: "vs previous 28 days",
    icon: "content",
    detail: "Median engagement and ranking score across published briefs.",
  },
];

/** Delivered results, newest first. Each links back to the module that owns it. */
export const RECENT_WINS: readonly RecentWin[] = [
  {
    id: "win-01",
    result: "Pricing hub reached position 3 for its head term",
    metric: "Average position",
    change: { value: -6, unit: "absolute", invert: true },
    date: "2026-09-06",
    module: "/keywords",
    project: "Halcyon Fintech",
  },
  {
    id: "win-02",
    result: "Core Web Vitals now passing on every product template",
    metric: "LCP",
    change: { value: -34.1, invert: true },
    date: "2026-09-04",
    module: "/technical",
    project: "Verdant Home",
  },
  {
    id: "win-03",
    result: "Cited by Perplexity on eleven comparison queries",
    metric: "Citations",
    change: { value: 11, unit: "absolute" },
    date: "2026-09-02",
    module: "/ai-visibility",
    project: "Orbit Logistics",
  },
  {
    id: "win-04",
    result: "Industry-report campaign earned 23 referring domains",
    metric: "Referring domains",
    change: { value: 23, unit: "absolute" },
    date: "2026-08-29",
    module: "/backlinks",
    project: "Meridian Clinics",
  },
  {
    id: "win-05",
    result: "Buying-guide cluster overtook two competitors",
    metric: "Share of voice",
    change: { value: 8.7 },
    date: "2026-08-25",
    module: "/competitors",
    project: "Skyline Outdoors",
  },
  {
    id: "win-06",
    result: "Refreshed onboarding guides doubled assisted conversions",
    metric: "Assisted conversions",
    change: { value: 104.5 },
    date: "2026-08-21",
    module: "/content",
    project: "Halcyon Fintech",
  },
];
