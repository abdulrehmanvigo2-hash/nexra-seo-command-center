"use client";

import { Icon } from "@/components/icons";
import { InfoTip } from "@/components/ui/info-tip";
import { Meter, type MeterTone } from "@/components/ui/meter";
import { Panel } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkline, type SparklineTone } from "@/components/ui/sparkline";
import { TrendIndicator } from "@/components/ui/trend-indicator";
import { cn } from "@/lib/cn";
import type { KpiCardData, MetricHealth, ScoreCardData } from "@/types/dashboard";

/**
 * The two headline bands: six health scores, then eight volume KPIs.
 *
 * Both card types read a `MetricHealth` rather than deciding their own colour,
 * so "warning" looks the same wherever it appears and a card never has to
 * re-derive what a number means.
 */

const HEALTH_METER: Record<MetricHealth, MeterTone> = {
  positive: "positive",
  neutral: "accent",
  warning: "warning",
  negative: "critical",
};

const HEALTH_SPARK: Record<MetricHealth, SparklineTone> = {
  positive: "positive",
  neutral: "accent",
  warning: "warning",
  negative: "critical",
};

const HEALTH_LABEL: Record<MetricHealth, string> = {
  positive: "Healthy",
  neutral: "Steady",
  warning: "Watch",
  negative: "At risk",
};

const HEALTH_DOT: Record<MetricHealth, string> = {
  positive: "bg-positive",
  neutral: "bg-accent",
  warning: "bg-warning",
  negative: "bg-critical",
};

/** The six 0-100 indices, as a responsive strip of compact tiles. */
export function ScoreStrip({
  scores,
  loading,
}: {
  scores: readonly ScoreCardData[];
  loading: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {scores.map((score) => (
        <ScoreCard key={score.id} score={score} loading={loading} />
      ))}
    </div>
  );
}

function ScoreCard({
  score,
  loading,
}: {
  score: ScoreCardData;
  loading: boolean;
}) {
  return (
    <Panel as="div" className="p-3.5" aria-busy={loading}>
      {/* Two lines are reserved so a wrapping label cannot push one tile's
          number out of line with the rest of the strip. */}
      <div className="flex min-h-8 items-start justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] leading-tight font-medium text-fg-muted">
          <Icon name={score.icon} className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
          <span className="min-w-0">{score.label}</span>
        </span>
        <InfoTip label={`About ${score.label}`}>{score.explanation}</InfoTip>
      </div>

      {loading ? (
        <div className="mt-3 space-y-2.5">
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-1.5 w-full" />
        </div>
      ) : (
        <>
          <p className="mt-2.5 flex items-baseline gap-1">
            <span className="tabular text-[24px] leading-none font-semibold tracking-tight text-fg">
              {score.score}
            </span>
            <span className="text-[11.5px] font-medium text-fg-subtle">/ 100</span>
          </p>

          <Meter
            className="mt-2.5"
            value={score.score}
            tone={HEALTH_METER[score.health]}
            label={`${score.label}: ${score.score} out of 100`}
          />

          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <TrendIndicator value={score.trend.value} invert={score.trend.invert} />
            <span className="inline-flex items-center gap-1.5 text-[11px] text-fg-subtle">
              <span
                aria-hidden="true"
                className={cn("h-1.5 w-1.5 rounded-full", HEALTH_DOT[score.health])}
              />
              {HEALTH_LABEL[score.health]}
            </span>
          </div>
        </>
      )}
    </Panel>
  );
}

/** The eight volume KPIs. */
export function KpiGrid({
  kpis,
  loading,
}: {
  kpis: readonly KpiCardData[];
  loading: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {kpis.map((kpi) => (
        <KpiCard key={kpi.id} kpi={kpi} loading={loading} />
      ))}
    </div>
  );
}

function KpiCard({ kpi, loading }: { kpi: KpiCardData; loading: boolean }) {
  return (
    <Panel as="div" className="flex flex-col p-4" aria-busy={loading}>
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11.5px] font-medium tracking-[0.03em] text-fg-muted uppercase">
          <Icon name={kpi.icon} className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
          {kpi.label}
        </span>
        <InfoTip label={`About ${kpi.label}`}>{kpi.explanation}</InfoTip>
      </div>

      {loading ? (
        <div className="mt-3 space-y-2.5">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : (
        <>
          <p className="mt-2.5 flex items-baseline gap-1.5">
            <span className="tabular text-[26px] leading-none font-semibold tracking-tight text-fg">
              {kpi.value}
            </span>
            {kpi.unit && (
              <span className="text-[12px] font-medium text-fg-subtle">
                {kpi.unit}
              </span>
            )}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
            <TrendIndicator value={kpi.trend.value} invert={kpi.trend.invert} />
            <span className="text-[11.5px] text-fg-subtle">{kpi.comparison}</span>
          </div>

          <div className="mt-3 -mx-1">
            <Sparkline values={kpi.spark} tone={HEALTH_SPARK[kpi.health]} />
          </div>

          {kpi.footnote && (
            <p className="mt-2.5 border-t border-border pt-2.5 text-[11.5px] leading-relaxed text-fg-subtle">
              {kpi.footnote}
            </p>
          )}
        </>
      )}
    </Panel>
  );
}
