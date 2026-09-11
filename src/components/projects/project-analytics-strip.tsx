import Link from "next/link";
import { Icon } from "@/components/icons";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { formatCompact, formatCurrencyCompact } from "@/lib/format";
import {
  ANALYTICS_SOURCE_SHORT,
  SIGNIFICANCE_META,
  directionFor,
  getAnalyticsSnapshotCounts,
  significanceFor,
} from "@/lib/mock/analytics";

/**
 * How this project performed, on the project overview.
 *
 * A strip rather than a tab: the full picture lives in Analytics, and this is
 * the summary plus the way into it.
 *
 * Every figure is read from that module, so this panel and that workspace never
 * quote different numbers for the same project. The import direction is
 * deliberate — `analytics/*` reads the canonical layers, and this component
 * reads back from the component layer rather than the fixture layer.
 */
export function ProjectAnalyticsStrip({ projectId }: { projectId: string }) {
  const counts = getAnalyticsSnapshotCounts(projectId);
  if (counts.pages === 0) return null;

  const direction = directionFor(counts.trafficDelta);
  const significance = significanceFor(counts.trafficDelta);

  const figures: readonly {
    readonly id: string;
    readonly label: string;
    readonly value: string;
    readonly detail: string;
    readonly tone?: "positive" | "warning" | "critical";
  }[] = [
    {
      id: "compounding",
      label: "Compounding pages",
      value: String(counts.compounding),
      detail: "Carrying most of their potential and still climbing.",
      tone: counts.compounding > 0 ? "positive" : undefined,
    },
    {
      id: "decaying",
      label: "Decaying pages",
      value: String(counts.decaying),
      detail: "Losing ground against the positions they held.",
      tone: counts.decaying > 0 ? "critical" : undefined,
    },
    {
      id: "headroom",
      label: "Unclaimed sessions",
      value: formatCompact(counts.headroom),
      detail: `A month, worth ${formatCurrencyCompact(counts.opportunityValue)}.`,
    },
    {
      id: "anomalies",
      label: "Movements to explain",
      value: String(counts.anomalies),
      detail: `${counts.unexplained} have nothing behind them.`,
      tone: counts.unexplained > 0 ? "warning" : undefined,
    },
  ];

  return (
    <section className="rounded-panel border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-border px-4 py-3 sm:px-5">
        <span className="flex items-center gap-2">
          <Icon name="analytics" className="h-4 w-4 shrink-0 text-fg-subtle" />
          <span className="text-[11px] font-semibold tracking-[0.06em] text-fg-subtle uppercase">
            Analytics
          </span>
        </span>

        <span className="flex items-baseline gap-2">
          <span className="tabular text-[18px] leading-none font-semibold text-fg">
            {formatCompact(counts.traffic)}
          </span>
          <span className="text-[11px] text-fg-subtle">sessions / 30d</span>
        </span>

        <span
          className={cn(
            "tabular inline-flex items-center gap-1 text-[12px] font-medium",
            direction === "up"
              ? "text-positive"
              : direction === "down"
                ? "text-critical"
                : "text-fg-subtle",
          )}
          title={SIGNIFICANCE_META[significance].description}
        >
          {direction !== "flat" && (
            <Icon
              name={direction === "up" ? "trend-up" : "trend-down"}
              className="h-3.5 w-3.5 shrink-0"
            />
          )}
          {counts.trafficDelta > 0 ? "+" : ""}
          {counts.trafficDelta}%
          <span className="font-normal text-fg-subtle">
            · {SIGNIFICANCE_META[significance].label.toLowerCase()}
          </span>
        </span>

        <span className="text-[12px] text-fg-muted">
          Visibility {counts.visibility} / 100 · {counts.pages} pages measured
        </span>

        <Link
          href={`/analytics?project=${projectId}`}
          className={cn(buttonClasses("secondary", "sm"), "ml-auto")}
        >
          Open Analytics
          <Icon name="arrow-right" className="h-4 w-4" />
        </Link>
      </div>

      <dl className="grid grid-cols-2 gap-3 px-4 py-3.5 sm:px-5 lg:grid-cols-4">
        {figures.map((figure) => (
          <div
            key={figure.id}
            className="rounded-md border border-border bg-surface-raised px-3 py-2.5"
          >
            <dt className="text-[11px] font-medium tracking-[0.03em] text-fg-muted uppercase">
              {figure.label}
            </dt>
            <dd
              className={cn(
                "tabular mt-1.5 text-[18px] leading-none font-semibold",
                figure.tone === "critical"
                  ? "text-critical"
                  : figure.tone === "warning"
                    ? "text-warning"
                    : figure.tone === "positive"
                      ? "text-positive"
                      : "text-fg",
              )}
            >
              {figure.value}
            </dd>
            <p className="mt-1.5 text-[11px] leading-snug text-fg-subtle">
              {figure.detail}
            </p>
          </div>
        ))}
      </dl>

      {counts.topLearning && (
        <p className="border-t border-border px-4 py-2.5 text-[11.5px] text-fg-muted sm:px-5">
          <span className="font-medium text-fg">Next:</span>{" "}
          {counts.topLearning.recommendation}
        </p>
      )}

      <p className="border-t border-border px-4 py-2.5 text-[11px] text-fg-subtle sm:px-5">
        {ANALYTICS_SOURCE_SHORT}
      </p>
    </section>
  );
}
