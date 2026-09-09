import { Icon, type IconName } from "@/components/icons";
import { Panel } from "@/components/ui/panel";
import { TrendIndicator } from "@/components/ui/trend-indicator";
import { cn } from "@/lib/cn";
import { HEALTH_DOT } from "@/lib/health";
import type { MetricHealth, MetricTrend } from "@/types/dashboard";

/**
 * A compact summary number: one figure, its band, and a line of context.
 *
 * Smaller and denser than `StatCard`, which is the headline treatment on the
 * Command Center. This is the tile used where six to eight numbers sit above a
 * roster and have to stay readable two-up on a phone.
 *
 * The shape is structural on purpose, so a module's own metric type (a
 * `ProjectMetric`, an `AgentMetric`) drops in without a mapping layer.
 */
export type MetricTileData = {
  readonly id: string;
  readonly label: string;
  /** Pre-formatted for display — formatting decisions stay with the metric. */
  readonly value: string;
  readonly unit?: string;
  readonly detail: string;
  readonly icon: IconName;
  readonly trend?: MetricTrend;
  readonly health?: MetricHealth;
};

export function MetricTile({ metric }: { metric: MetricTileData }) {
  return (
    <Panel as="div" className="p-3.5">
      {/* Two lines are reserved so a wrapping label cannot push one tile's
          number out of line with the rest of the row. */}
      <p className="flex min-h-8 items-start gap-1.5 text-[11px] leading-tight font-medium tracking-[0.03em] text-fg-muted uppercase">
        <Icon
          name={metric.icon}
          className="mt-px h-3.5 w-3.5 shrink-0 text-fg-subtle"
        />
        <span className="min-w-0">{metric.label}</span>
      </p>

      <p className="mt-2.5 flex items-baseline gap-1.5">
        <span className="tabular text-[22px] leading-none font-semibold tracking-tight text-fg">
          {metric.value}
        </span>
        {metric.unit && (
          <span className="text-[11.5px] font-medium text-fg-subtle">
            {metric.unit}
          </span>
        )}
        {metric.health && (
          <span
            aria-hidden="true"
            className={cn(
              "ml-0.5 h-1.5 w-1.5 rounded-full",
              HEALTH_DOT[metric.health],
            )}
          />
        )}
      </p>

      {metric.trend && (
        <p className="mt-2">
          <TrendIndicator
            value={metric.trend.value}
            invert={metric.trend.invert}
          />
        </p>
      )}

      <p className="mt-2 text-[11.5px] leading-snug text-fg-subtle">
        {metric.detail}
      </p>
    </Panel>
  );
}

/** The tiles as a responsive row: two-up on a phone, four-up from `lg`. */
export function MetricTileGrid({
  metrics,
  className,
}: {
  metrics: readonly MetricTileData[];
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", className)}>
      {metrics.map((metric) => (
        <MetricTile key={metric.id} metric={metric} />
      ))}
    </div>
  );
}
