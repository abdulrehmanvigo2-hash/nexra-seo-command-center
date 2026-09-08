import type { AnalyticsPoint } from "@/types/seo";

/**
 * Daily performance series for the current 28-day window, oldest first.
 *
 * Demo fixtures, written as literals rather than generated: the values must be
 * identical on the server and in the browser, and they have to stay stable
 * between renders so the numbers on screen never move on their own.
 *
 * The series is the source the overview metrics were derived from — organic
 * traffic sums to 184,920, and the closing AI visibility value is 61.
 */
export const ANALYTICS_TREND: readonly AnalyticsPoint[] = [
  { date: "2026-08-11", organicTraffic: 6742, keywordVisibility: 38.4, conversions: 71, aiVisibility: 54.2 },
  { date: "2026-08-12", organicTraffic: 6810, keywordVisibility: 38.6, conversions: 74, aiVisibility: 54.5 },
  { date: "2026-08-13", organicTraffic: 6698, keywordVisibility: 38.5, conversions: 69, aiVisibility: 54.4 },
  { date: "2026-08-14", organicTraffic: 6903, keywordVisibility: 38.9, conversions: 76, aiVisibility: 54.9 },
  { date: "2026-08-15", organicTraffic: 4912, keywordVisibility: 38.8, conversions: 41, aiVisibility: 55.0 },
  { date: "2026-08-16", organicTraffic: 4744, keywordVisibility: 38.7, conversions: 38, aiVisibility: 55.1 },
  { date: "2026-08-17", organicTraffic: 6988, keywordVisibility: 39.2, conversions: 80, aiVisibility: 55.4 },
  { date: "2026-08-18", organicTraffic: 7042, keywordVisibility: 39.5, conversions: 82, aiVisibility: 55.8 },
  { date: "2026-08-19", organicTraffic: 7115, keywordVisibility: 39.7, conversions: 85, aiVisibility: 56.1 },
  { date: "2026-08-20", organicTraffic: 6974, keywordVisibility: 39.6, conversions: 79, aiVisibility: 56.0 },
  { date: "2026-08-21", organicTraffic: 7186, keywordVisibility: 40.1, conversions: 88, aiVisibility: 56.4 },
  { date: "2026-08-22", organicTraffic: 5131, keywordVisibility: 40.0, conversions: 46, aiVisibility: 56.5 },
  { date: "2026-08-23", organicTraffic: 4980, keywordVisibility: 39.9, conversions: 43, aiVisibility: 56.6 },
  { date: "2026-08-24", organicTraffic: 7204, keywordVisibility: 40.4, conversions: 89, aiVisibility: 57.0 },
  { date: "2026-08-25", organicTraffic: 7318, keywordVisibility: 40.8, conversions: 92, aiVisibility: 57.3 },
  { date: "2026-08-26", organicTraffic: 7261, keywordVisibility: 40.7, conversions: 90, aiVisibility: 57.6 },
  { date: "2026-08-27", organicTraffic: 7395, keywordVisibility: 41.2, conversions: 94, aiVisibility: 57.9 },
  { date: "2026-08-28", organicTraffic: 7112, keywordVisibility: 41.0, conversions: 86, aiVisibility: 58.1 },
  { date: "2026-08-29", organicTraffic: 5288, keywordVisibility: 41.1, conversions: 49, aiVisibility: 58.4 },
  { date: "2026-08-30", organicTraffic: 5142, keywordVisibility: 41.0, conversions: 45, aiVisibility: 58.5 },
  { date: "2026-08-31", organicTraffic: 7440, keywordVisibility: 41.6, conversions: 96, aiVisibility: 58.9 },
  { date: "2026-09-01", organicTraffic: 7502, keywordVisibility: 42.0, conversions: 99, aiVisibility: 59.3 },
  { date: "2026-09-02", organicTraffic: 7386, keywordVisibility: 41.9, conversions: 93, aiVisibility: 59.6 },
  { date: "2026-09-03", organicTraffic: 7548, keywordVisibility: 42.4, conversions: 101, aiVisibility: 59.9 },
  { date: "2026-09-04", organicTraffic: 7629, keywordVisibility: 42.8, conversions: 104, aiVisibility: 60.2 },
  { date: "2026-09-05", organicTraffic: 5426, keywordVisibility: 42.7, conversions: 52, aiVisibility: 60.4 },
  { date: "2026-09-06", organicTraffic: 5297, keywordVisibility: 42.6, conversions: 48, aiVisibility: 60.6 },
  { date: "2026-09-07", organicTraffic: 7747, keywordVisibility: 43.6, conversions: 108, aiVisibility: 61.0 },
];
