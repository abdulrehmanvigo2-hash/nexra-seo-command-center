import { Icon } from "@/components/icons";
import { Meter } from "@/components/ui/meter";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { TrendIndicator } from "@/components/ui/trend-indicator";
import { cn } from "@/lib/cn";
import { formatCompact, formatNumber } from "@/lib/format";
import { HEALTH_METER, healthOf } from "@/lib/health";
import type { AgentPerformance } from "@/types/agent";

/**
 * How well an agent has been performing.
 *
 * Eight readings and a volume chart. The rates are shown as bars as well as
 * numbers because "94% pass rate" and "6% rework" are the same fact stated two
 * ways, and seeing them together is what makes either useful.
 */
export function AgentPerformancePanel({
  performance,
  rangeCaption,
  outputLabel,
}: {
  performance: AgentPerformance;
  rangeCaption: string;
  /** What this agent produces, e.g. "briefs". */
  outputLabel: string;
}) {
  const stats: readonly {
    readonly label: string;
    readonly value: string;
    readonly unit?: string;
    readonly trend?: { value: number; invert?: boolean };
  }[] = [
    {
      label: "Tasks completed",
      value: formatNumber(performance.tasksCompleted),
      trend: performance.trend.throughput,
    },
    {
      label: "Tasks in progress",
      value: formatNumber(performance.tasksInProgress),
    },
    {
      label: "Avg completion",
      value: performance.averageCompletionHours.toFixed(1),
      unit: "hours",
      trend: performance.trend.completionTime,
    },
    {
      label: "Output volume",
      value: formatCompact(performance.outputVolume),
      unit: outputLabel,
    },
    {
      label: "Projects supported",
      value: formatNumber(performance.projectsSupported),
    },
    {
      label: "Quality score",
      value: String(performance.quality),
      unit: "/ 100",
      trend: performance.trend.quality,
    },
  ];

  return (
    <Panel>
      <PanelHeader
        eyebrow="Performance"
        title="Agent Performance"
        description={`Delivery, quality, and throughput over the ${rangeCaption.toLowerCase()}.`}
      />

      <PanelBody className="space-y-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3 xl:grid-cols-6">
          {stats.map((stat) => (
            <div key={stat.label} className="min-w-0">
              <dt className="text-[10.5px] font-medium tracking-[0.05em] text-fg-subtle uppercase">
                {stat.label}
              </dt>
              <dd className="mt-1.5 flex items-baseline gap-1.5">
                <span className="tabular text-[18px] leading-none font-semibold text-fg">
                  {stat.value}
                </span>
                {stat.unit && (
                  <span className="truncate text-[11px] text-fg-subtle">
                    {stat.unit}
                  </span>
                )}
              </dd>
              {stat.trend && (
                <dd className="mt-1.5">
                  <TrendIndicator
                    value={stat.trend.value}
                    invert={stat.trend.invert}
                  />
                </dd>
              )}
            </div>
          ))}
        </dl>

        <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
          <RateBar
            label="Review pass rate"
            hint="Outputs accepted at first review"
            value={performance.reviewPassRate}
          />
          <RateBar
            label="Rework rate"
            hint="Outputs sent back for revision"
            value={performance.reworkRate}
            invert
          />
        </div>

        <VolumeChart
          series={performance.series}
          labels={performance.labels}
          outputLabel={outputLabel}
        />
      </PanelBody>

      <PanelFooter>
        <span>
          Twelve weekly buckets, oldest first. Mock data over the{" "}
          {rangeCaption.toLowerCase()}.
        </span>
        <span>
          {formatCompact(performance.outputVolume)} {outputLabel} filed
        </span>
      </PanelFooter>
    </Panel>
  );
}

function RateBar({
  label,
  hint,
  value,
  /** Set where a lower number is the better one. */
  invert = false,
}: {
  label: string;
  hint: string;
  value: number;
  invert?: boolean;
}) {
  const health = healthOf(invert ? 100 - value * 2.6 : value);

  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[11.5px] font-medium text-fg-muted">{label}</p>
        <p className="tabular text-[13px] font-semibold text-fg">
          {value.toFixed(1)}%
        </p>
      </div>
      <Meter
        className="mt-2"
        value={value}
        tone={HEALTH_METER[health]}
        label={`${label}: ${value.toFixed(1)} percent`}
      />
      <p className="mt-1.5 text-[11px] text-fg-subtle">{hint}</p>
    </div>
  );
}

/**
 * Output volume per week.
 *
 * Drawn as plain bars rather than through a charting library — the product
 * carries no chart dependency, and a twelve-bucket column chart does not need
 * one. Values are announced through a table-free description list beneath, so
 * the chart itself is decorative to assistive technology.
 */
function VolumeChart({
  series,
  labels,
  outputLabel,
}: {
  series: readonly number[];
  labels: readonly string[];
  outputLabel: string;
}) {
  const peak = Math.max(...series, 1);

  return (
    <figure className="border-t border-border pt-4">
      <figcaption className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-fg-muted">
          <Icon name="analytics" className="h-3.5 w-3.5 text-fg-subtle" />
          Output volume by week
        </span>
        <span className="tabular text-[11px] text-fg-subtle">
          Peak {formatNumber(peak)} {outputLabel}
        </span>
      </figcaption>

      <div
        aria-hidden="true"
        className="mt-3 flex h-28 items-end gap-1.5 sm:gap-2"
      >
        {series.map((value, index) => (
          <div
            key={labels[index]}
            className="flex min-w-0 flex-1 flex-col items-center gap-1.5"
          >
            <div className="flex w-full flex-1 items-end">
              <div
                className={cn(
                  "w-full rounded-t-sm bg-accent/70 transition-[height]",
                  index === series.length - 1 && "bg-accent",
                )}
                style={{
                  height: `${Math.max(3, (value / peak) * 100)}%`,
                }}
              />
            </div>
            <span className="tabular text-[9.5px] text-fg-subtle">
              {labels[index]}
            </span>
          </div>
        ))}
      </div>

      <p className="sr-only">
        Weekly output volume:{" "}
        {series
          .map((value, index) => `${labels[index]}, ${value}`)
          .join("; ")}
        .
      </p>
    </figure>
  );
}
