import { MetricTileGrid } from "@/components/ui/metric-tile";
import type { ProjectMetric } from "@/types/project";

/**
 * The portfolio numbers above the roster.
 *
 * Every figure is computed from the same rows the list below renders, so the
 * summary and the roster can never disagree. It always describes the whole
 * portfolio — filtering the list is a display choice, not a change to the
 * account.
 */
export function PortfolioSummary({
  metrics,
}: {
  metrics: readonly ProjectMetric[];
}) {
  return <MetricTileGrid metrics={metrics} />;
}
