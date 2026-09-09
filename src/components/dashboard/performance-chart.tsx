"use client";

import { useCallback, useState } from "react";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import { TrendIndicator } from "@/components/ui/trend-indicator";
import { cn } from "@/lib/cn";
import { formatCompact, formatNumber } from "@/lib/format";
import { DATE_RANGES } from "@/lib/mock/dashboard";
import type {
  RangeId,
  SeriesMetricId,
  TrendPoint,
  TrendSeries,
} from "@/types/dashboard";

/**
 * The main performance chart.
 *
 * Drawn by hand in SVG rather than pulling in a charting library: the product
 * needs one line chart with a comparison series, and a dependency for that is
 * not justified (CLAUDE.md §5). The SVG is rendered at the container's real
 * pixel size — measured on mount and kept in step as it changes — so strokes
 * keep an even weight and axis text stays undistorted at any width, which a
 * stretched `viewBox` cannot do.
 */

type MetricMeta = {
  readonly id: SeriesMetricId;
  readonly label: string;
  /** Flow metrics are summed over the window; levels are averaged. */
  readonly kind: "flow" | "level";
  readonly format: (value: number) => string;
  readonly totalLabel: string;
};

const METRICS: readonly MetricMeta[] = [
  {
    id: "organicTraffic",
    label: "Organic Traffic",
    kind: "flow",
    format: formatCompact,
    totalLabel: "Total sessions",
  },
  {
    id: "organicKeywords",
    label: "Organic Keywords",
    kind: "level",
    format: formatCompact,
    totalLabel: "Average keywords",
  },
  {
    id: "searchVisibility",
    label: "Search Visibility",
    kind: "level",
    format: (value) => value.toFixed(1),
    totalLabel: "Average visibility index",
  },
  {
    id: "conversions",
    label: "Conversions",
    kind: "flow",
    format: formatNumber,
    totalLabel: "Total conversions",
  },
];

const PADDING = { top: 16, right: 18, bottom: 26, left: 54 };
const HEIGHT = 268;
/** Used for the server render and the first client render, then measured. */
const FALLBACK_WIDTH = 860;

export function PerformanceChart({
  trend,
  range,
  onRangeChange,
  loading,
}: {
  trend: TrendSeries;
  range: RangeId;
  onRangeChange: (range: RangeId) => void;
  loading: boolean;
}) {
  const [metricId, setMetricId] = useState<SeriesMetricId>("organicTraffic");
  const [showPrevious, setShowPrevious] = useState(true);
  const [hovered, setHovered] = useState<number | null>(null);

  const [width, setWidth] = useState(FALLBACK_WIDTH);

  /**
   * Measures the plot area and keeps it in step with the container.
   *
   * A ref callback rather than an effect: it runs at commit, when the node
   * exists and has been laid out, so the first paint after hydration is
   * already at the right width. Relying on the observer's initial callback is
   * not enough — it is not guaranteed to arrive, and when it does not the
   * chart is stuck at the fallback width and overflows a narrow viewport.
   *
   * Setting the same width is a no-op in React, so re-measuring cannot loop.
   */
  const measureRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;

    const measure = () => {
      const measured = node.getBoundingClientRect().width;
      if (measured > 0) setWidth(measured);
    };

    measure();

    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(node);
    window.addEventListener("resize", measure);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const metric = METRICS.find((entry) => entry.id === metricId) ?? METRICS[0];
  const geometry = chartGeometry(trend, metric, width, showPrevious);

  // Ranges have different bucket counts, so an index held from a previous
  // window can point past the end of the current one. It is ignored rather
  // than corrected in an effect, which would cost an extra render pass.
  const active =
    hovered !== null && hovered < trend.current.length ? hovered : null;

  const handlePointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    setHovered(geometry.indexAt(event.clientX - bounds.left));
  };

  const selectRange = (next: RangeId) => {
    setHovered(null);
    onRangeChange(next);
  };

  const total = trend.totals[metric.id];
  const delta = trend.deltas[metric.id];
  const point = active === null ? null : trend.current[active];
  const comparisonPoint = active === null ? null : trend.previous[active];

  return (
    <Panel>
      <PanelHeader
        title="SEO Performance Trend"
        description={`${trend.range.caption}, compared against the window before it.`}
        actions={
          <Segmented
            label="Chart date range"
            value={range}
            onChange={selectRange}
            options={DATE_RANGES.map((entry) => ({
              value: entry.id,
              label: entry.label,
              title: entry.caption,
            }))}
          />
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 border-b border-border px-4 py-3 sm:px-5">
        <Segmented
          label="Chart metric"
          value={metricId}
          onChange={setMetricId}
          options={METRICS.map((entry) => ({
            value: entry.id,
            label: entry.label,
          }))}
        />

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-baseline gap-2">
            <span className="text-[11.5px] text-fg-subtle">
              {metric.totalLabel}
            </span>
            <span className="tabular text-[15px] font-semibold text-fg">
              {metric.format(total)}
            </span>
            <TrendIndicator value={delta} />
          </div>

          <button
            type="button"
            aria-pressed={showPrevious}
            onClick={() => setShowPrevious((value) => !value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px] transition-colors",
              showPrevious
                ? "border-border-strong bg-surface-raised text-fg-muted"
                : "border-border text-fg-subtle hover:text-fg-muted",
            )}
          >
            <span
              aria-hidden="true"
              className="h-px w-4 border-t border-dashed border-current"
            />
            Previous period
          </button>
        </div>
      </div>

      <PanelBody className="pt-4">
        <div ref={measureRef} className="relative w-full" aria-busy={loading}>
          <svg
            width={width}
            height={HEIGHT}
            viewBox={`0 0 ${width} ${HEIGHT}`}
            role="img"
            aria-label={`${metric.label} over the ${trend.range.caption.toLowerCase()}`}
            className={cn(
              "block text-accent transition-opacity",
              loading && "opacity-40",
            )}
            onPointerMove={handlePointer}
            onPointerLeave={() => setHovered(null)}
          >
            <defs>
              <linearGradient id="nexra-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="currentColor" stopOpacity={0.22} />
                <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
              </linearGradient>
            </defs>

            {/* Grid and value axis */}
            <g className="text-border">
              {geometry.ticks.map((tick) => (
                <line
                  key={tick.value}
                  x1={PADDING.left}
                  x2={width - PADDING.right}
                  y1={tick.y}
                  y2={tick.y}
                  stroke="currentColor"
                  strokeWidth={1}
                  strokeDasharray={tick.value === geometry.min ? undefined : "3 4"}
                />
              ))}
            </g>
            <g className="fill-fg-subtle text-[10.5px]">
              {geometry.ticks.map((tick) => (
                <text
                  key={tick.value}
                  x={PADDING.left - 10}
                  y={tick.y + 3.5}
                  textAnchor="end"
                  className="tabular"
                >
                  {metric.format(tick.value)}
                </text>
              ))}
            </g>

            {/* Date axis */}
            <g className="fill-fg-subtle text-[10.5px]">
              {geometry.xLabels.map((label) => (
                <text
                  key={label.index}
                  x={label.x}
                  y={HEIGHT - 8}
                  textAnchor="middle"
                >
                  {label.text}
                </text>
              ))}
            </g>

            {/* Comparison window */}
            {showPrevious && (
              <path
                d={geometry.previousLine}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.25}
                strokeDasharray="4 4"
                className="text-fg-subtle"
              />
            )}

            {/* Selected window */}
            <path d={geometry.area} fill="url(#nexra-area)" />
            <path
              d={geometry.line}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Hover guide */}
            {active !== null && (
              <g>
                <line
                  x1={geometry.xAt(active)}
                  x2={geometry.xAt(active)}
                  y1={PADDING.top}
                  y2={HEIGHT - PADDING.bottom}
                  stroke="currentColor"
                  strokeWidth={1}
                  className="text-border-strong"
                />
                <circle
                  cx={geometry.xAt(active)}
                  cy={geometry.yAt(trend.current[active][metric.id])}
                  r={4}
                  fill="currentColor"
                  className="text-accent"
                />
                <circle
                  cx={geometry.xAt(active)}
                  cy={geometry.yAt(trend.current[active][metric.id])}
                  r={7.5}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  strokeOpacity={0.35}
                  className="text-accent"
                />
              </g>
            )}
          </svg>

          {point && (
            <ChartTooltip
              metric={metric}
              point={point}
              comparison={showPrevious ? comparisonPoint : null}
              x={geometry.xAt(active as number)}
              width={width}
            />
          )}
        </div>
      </PanelBody>
    </Panel>
  );
}

/** Floating read-out for the hovered bucket. */
function ChartTooltip({
  metric,
  point,
  comparison,
  x,
  width,
}: {
  metric: MetricMeta;
  point: TrendPoint;
  comparison: TrendPoint | null;
  x: number;
  width: number;
}) {
  const TOOLTIP_WIDTH = 190;
  // Keep the panel inside the plot area at both ends.
  const left = Math.min(
    Math.max(x - TOOLTIP_WIDTH / 2, 0),
    Math.max(width - TOOLTIP_WIDTH, 0),
  );

  const change =
    comparison && comparison[metric.id] !== 0
      ? ((point[metric.id] - comparison[metric.id]) / comparison[metric.id]) * 100
      : null;

  return (
    <div
      role="status"
      style={{ left, width: TOOLTIP_WIDTH }}
      className="pointer-events-none absolute top-2 rounded-md border border-border-strong bg-surface-raised px-3 py-2 shadow-xl shadow-black/40"
    >
      <p className="text-[11px] text-fg-subtle">{point.label}</p>
      <p className="mt-1 flex items-baseline gap-1.5">
        <span className="tabular text-[15px] font-semibold text-fg">
          {metric.format(point[metric.id])}
        </span>
        <span className="text-[11px] text-fg-subtle">{metric.label}</span>
      </p>
      {comparison && (
        <p className="mt-1.5 flex items-center gap-2 border-t border-border pt-1.5 text-[11px] text-fg-subtle">
          <span className="tabular">
            Previous {metric.format(comparison[metric.id])}
          </span>
          {change !== null && <TrendIndicator value={Number(change.toFixed(1))} />}
        </p>
      )}
    </div>
  );
}

type Geometry = {
  readonly line: string;
  readonly area: string;
  readonly previousLine: string;
  readonly ticks: readonly { readonly value: number; readonly y: number }[];
  readonly xLabels: readonly {
    readonly index: number;
    readonly x: number;
    readonly text: string;
  }[];
  readonly min: number;
  xAt(index: number): number;
  yAt(value: number): number;
  indexAt(x: number): number;
};

/**
 * Turns the series into pixel geometry.
 *
 * Flow metrics are plotted from zero, because the height of the line is the
 * quantity. Level metrics are plotted on a padded window around their own
 * range, because their movement is the point and a zero baseline would flatten
 * it into a straight line.
 */
function chartGeometry(
  trend: TrendSeries,
  metric: MetricMeta,
  width: number,
  includePrevious: boolean,
): Geometry {
  {
    const points = trend.current.map((point) => point[metric.id]);
    const comparison = trend.previous.map((point) => point[metric.id]);
    const all = includePrevious ? [...points, ...comparison] : points;

    const rawMax = Math.max(...all);
    const rawMin = Math.min(...all);

    const min = metric.kind === "flow" ? 0 : Math.max(0, rawMin - (rawMax - rawMin) * 0.35 - 0.5);
    const max = niceCeiling(rawMax + (rawMax - min) * 0.08);

    const plotWidth = Math.max(width - PADDING.left - PADDING.right, 1);
    const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
    const step = points.length > 1 ? plotWidth / (points.length - 1) : 0;

    const xAt = (index: number) => PADDING.left + index * step;
    const yAt = (value: number) =>
      PADDING.top + plotHeight - ((value - min) / (max - min || 1)) * plotHeight;

    const toPath = (values: readonly number[]) =>
      values
        .map((value, index) => `${index === 0 ? "M" : "L"}${xAt(index).toFixed(2)},${yAt(value).toFixed(2)}`)
        .join(" ");

    const line = toPath(points);
    const baseline = PADDING.top + plotHeight;
    const area = `${line} L${xAt(points.length - 1).toFixed(2)},${baseline} L${xAt(0).toFixed(2)},${baseline} Z`;

    const ticks = Array.from({ length: 5 }, (_, index) => {
      const value = min + ((max - min) / 4) * index;
      return { value: metric.kind === "flow" ? Math.round(value) : Number(value.toFixed(1)), y: yAt(value) };
    });

    // Thin the date axis so labels never collide on a narrow viewport.
    const maxLabels = Math.max(2, Math.min(7, Math.floor(plotWidth / 78)));
    const labelStep = Math.max(1, Math.ceil(points.length / maxLabels));
    const xLabels = trend.current
      .map((entry, index) => ({ index, x: xAt(index), text: entry.label }))
      .filter(({ index }) => index % labelStep === 0 || index === points.length - 1);

    const indexAt = (x: number) => {
      if (step === 0) return 0;
      const raw = Math.round((x - PADDING.left) / step);
      return Math.max(0, Math.min(points.length - 1, raw));
    };

    return {
      line,
      area,
      previousLine: toPath(comparison),
      ticks,
      xLabels,
      min: ticks[0].value,
      xAt,
      yAt,
      indexAt,
    };
  }
}

/** Rounds an axis maximum up to a readable step. */
function niceCeiling(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalised = value / magnitude;
  const stepped = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return stepped * magnitude;
}
