import { Icon } from "@/components/icons";
import { TrendIndicator } from "@/components/ui/trend-indicator";
import { cn } from "@/lib/cn";
import { HEALTH_DOT } from "@/components/projects/project-chrome";
import type { ProjectMetric } from "@/types/project";

/**
 * The project's performance numbers for the selected window.
 *
 * A tile row rather than full cards: these sit under the health strip on the
 * overview and above the chart on the performance tab, and neither place has
 * room for a second band of large cards.
 */
export function ProjectMetrics({
  metrics,
  className,
}: {
  metrics: readonly ProjectMetric[];
  className?: string;
}) {
  return (
    <dl
      className={cn(
        "grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6",
        className,
      )}
    >
      {metrics.map((metric) => (
        <div
          key={metric.id}
          className="min-w-0 rounded-md border border-border bg-surface-raised px-3.5 py-3"
        >
          <dt className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
            <Icon name={metric.icon} className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 truncate">{metric.label}</span>
          </dt>

          <dd className="mt-2 flex items-baseline gap-1.5">
            <span className="tabular text-[19px] leading-none font-semibold tracking-tight text-fg">
              {metric.value}
            </span>
            {metric.unit && (
              <span className="truncate text-[11px] text-fg-subtle">
                {metric.unit}
              </span>
            )}
            {metric.health && (
              <span
                aria-hidden="true"
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  HEALTH_DOT[metric.health],
                )}
              />
            )}
          </dd>

          {metric.trend && (
            <dd className="mt-2">
              <TrendIndicator
                value={metric.trend.value}
                invert={metric.trend.invert}
              />
            </dd>
          )}
        </div>
      ))}
    </dl>
  );
}
