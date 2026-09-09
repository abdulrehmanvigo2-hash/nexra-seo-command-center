import { Icon } from "@/components/icons";
import { Panel } from "@/components/ui/panel";
import { TrendIndicator } from "@/components/ui/trend-indicator";
import { cn } from "@/lib/cn";
import { HEALTH_DOT } from "@/components/projects/project-chrome";
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
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {metrics.map((metric) => (
        <Panel as="div" key={metric.id} className="p-3.5">
          {/* Two lines are reserved so a wrapping label cannot push one
              tile's number out of line with the rest of the row. */}
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
              <TrendIndicator value={metric.trend.value} invert={metric.trend.invert} />
            </p>
          )}

          <p className="mt-2 text-[11.5px] leading-snug text-fg-subtle">
            {metric.detail}
          </p>
        </Panel>
      ))}
    </div>
  );
}
