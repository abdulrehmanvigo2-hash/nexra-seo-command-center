import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import { Panel } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendIndicator } from "@/components/ui/trend-indicator";
import { cn } from "@/lib/cn";

type StatCardProps = {
  label: string;
  /**
   * Pre-formatted value. Formatting stays at the call site so each metric
   * controls its own units, precision, and locale.
   */
  value: string;
  /** Short qualifier after the value, e.g. "%", "sessions", "avg". */
  unit?: string;
  trend?: {
    value: number;
    /** Set when a decrease is an improvement. */
    invert?: boolean;
    unit?: "percent" | "absolute";
  };
  /** Comparison window, e.g. "vs previous 28 days". */
  comparison?: string;
  icon?: IconName;
  /** Extra context below the value. */
  footnote?: ReactNode;
  loading?: boolean;
  className?: string;
};

/** Single headline metric. Designed to tile in a responsive grid. */
export function StatCard({
  label,
  value,
  unit,
  trend,
  comparison,
  icon,
  footnote,
  loading = false,
  className,
}: StatCardProps) {
  return (
    <Panel as="div" className={cn("p-4 sm:p-5", className)} aria-busy={loading}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11.5px] font-medium tracking-[0.03em] text-fg-muted uppercase">
          {label}
        </p>
        {icon && (
          <span className="shrink-0 text-fg-subtle">
            <Icon name={icon} className="h-4 w-4" />
          </span>
        )}
      </div>

      {loading ? (
        <div className="mt-3 space-y-2.5">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-3 w-32" />
        </div>
      ) : (
        <>
          <p className="mt-2.5 flex items-baseline gap-1.5">
            <span className="tabular text-[26px] leading-none font-semibold tracking-tight text-fg">
              {value}
            </span>
            {unit && (
              <span className="text-[12.5px] font-medium text-fg-subtle">
                {unit}
              </span>
            )}
          </p>

          {(trend || comparison) && (
            <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              {trend && (
                <TrendIndicator
                  value={trend.value}
                  invert={trend.invert}
                  unit={trend.unit}
                />
              )}
              {comparison && (
                <span className="text-[12px] text-fg-subtle">{comparison}</span>
              )}
            </div>
          )}

          {footnote && (
            <div className="mt-3 border-t border-border pt-3 text-[12px] leading-relaxed text-fg-subtle">
              {footnote}
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
