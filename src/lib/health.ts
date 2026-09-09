import type { MeterTone } from "@/components/ui/meter";
import type { MetricHealth } from "@/types/dashboard";

/**
 * How a 0-100 index reads, and how it is presented.
 *
 * Lives outside any one module because three of them need the same answer: the
 * Projects roster bands a project's SEO health, the portfolio tiles band their
 * averages, and the Agents module bands team health and quality scores. One
 * definition means "Healthy" means the same thing everywhere it appears.
 *
 * The word always accompanies the colour — a band is never carried by hue
 * alone.
 */

export const HEALTH_LABEL: Record<MetricHealth, string> = {
  positive: "Healthy",
  neutral: "Steady",
  warning: "Watch",
  negative: "At risk",
};

export const HEALTH_DOT: Record<MetricHealth, string> = {
  positive: "bg-positive",
  neutral: "bg-accent",
  warning: "bg-warning",
  negative: "bg-critical",
};

export const HEALTH_METER: Record<MetricHealth, MeterTone> = {
  positive: "positive",
  neutral: "accent",
  warning: "warning",
  negative: "critical",
};

/** Health band for a bare 0-100 score. */
export function healthOf(score: number): MetricHealth {
  if (score >= 75) return "positive";
  if (score >= 60) return "neutral";
  if (score >= 45) return "warning";
  return "negative";
}
