import Link from "next/link";
import { Icon } from "@/components/icons";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { formatCompact, formatCurrencyCompact } from "@/lib/format";
import { AGENT_NAMES } from "@/lib/mock/agents/registry";
import {
  SIGNIFICANCE_META,
  VERDICT_META,
  directionFor,
  getAnalyticsSnapshotCounts,
  significanceFor,
} from "@/lib/mock/analytics";
import type { RangeId } from "@/types/analytics";

/**
 * A one-line operational read on performance, beneath the main chart.
 *
 * The chart above says what happened; this says whether it means anything and
 * what to do about it. Both read the same series, so the two never disagree.
 *
 * Deliberately compact — the Command Center is already dense, and the full
 * picture is one click away.
 */
export function AnalyticsSummary({
  projectId,
  rangeId,
}: {
  projectId: string;
  rangeId: RangeId;
}) {
  const counts = getAnalyticsSnapshotCounts(projectId, rangeId);
  if (counts.pages === 0) return null;

  const direction = directionFor(counts.trafficDelta);
  const significance = significanceFor(counts.trafficDelta);
  const href =
    projectId === "portfolio"
      ? `/analytics?range=${rangeId}`
      : `/analytics?project=${projectId}&range=${rangeId}`;

  return (
    <section className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-panel border border-border bg-surface px-4 py-3 sm:px-5">
      <span className="flex items-center gap-2">
        <Icon name="analytics" className="h-4 w-4 shrink-0 text-fg-subtle" />
        <span className="text-[11px] font-semibold tracking-[0.06em] text-fg-subtle uppercase">
          What it means
        </span>
      </span>

      <span
        className={cn(
          "tabular inline-flex items-center gap-1.5 text-[12.5px] font-medium",
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
          — {SIGNIFICANCE_META[significance].label.toLowerCase()}
        </span>
      </span>

      <span className="text-[12px] text-fg-muted">
        {counts.compounding} compounding · {counts.decaying} decaying ·{" "}
        {formatCompact(counts.headroom)} sessions unclaimed, worth{" "}
        {formatCurrencyCompact(counts.opportunityValue)}
      </span>

      {counts.anomalies > 0 && (
        <span
          className="inline-flex items-center gap-1.5 text-[12px] text-warning"
          title={`${counts.unexplained} of them have no canonical finding behind them.`}
        >
          <Icon name="alert" className="h-3.5 w-3.5 shrink-0" />
          {counts.anomalies} to explain
        </span>
      )}

      <Link
        href={href}
        className={cn(buttonClasses("secondary", "sm"), "ml-auto")}
      >
        Open Analytics
        <Icon name="arrow-right" className="h-4 w-4" />
      </Link>

      {counts.topLearning && (
        <p className="w-full border-t border-border pt-2.5 text-[11.5px] text-fg-muted">
          <span
            className="font-medium text-fg"
            title={VERDICT_META[counts.topLearning.verdict].description}
          >
            {VERDICT_META[counts.topLearning.verdict].label}:
          </span>{" "}
          {counts.topLearning.recommendation}{" "}
          <span className="text-fg-subtle">
            Routed to {AGENT_NAMES[counts.topLearning.owner]}.
          </span>
        </p>
      )}
    </section>
  );
}
