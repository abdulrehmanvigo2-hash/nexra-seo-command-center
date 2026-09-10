"use client";

import { useCallback, useState } from "react";
import { cn } from "@/lib/cn";
import type { KeywordRankingHistory } from "@/types/keyword";

/**
 * A keyword's rank over time.
 *
 * Drawn by hand in SVG for the same reason the performance chart is: the
 * product needs one more line chart, and a charting dependency for it is not
 * justified (CLAUDE.md §5). The SVG is rendered at the container's real pixel
 * width — measured on mount and kept in step as it changes — so the stroke
 * keeps an even weight and the axis text stays undistorted at any size.
 *
 * The vertical axis is inverted, because position one is the top of the page.
 * A rising line therefore means an improving rank, which is what a reader
 * expects a rising line to mean.
 *
 * Windows where the keyword did not rank are gaps rather than zeroes: the line
 * breaks, and the band under the axis is labelled, because "outside the top
 * 100" is a real state and drawing it as position zero would invert the whole
 * chart.
 */

const PADDING = { top: 14, right: 16, bottom: 24, left: 38 };
const HEIGHT = 200;
const FALLBACK_WIDTH = 640;

export function RankChart({ history }: { history: KeywordRankingHistory }) {
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  const [hovered, setHovered] = useState<number | null>(null);

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

  const points = history.points;
  const ranked = points
    .map((point) => point.position)
    .filter((position): position is number => position !== null);

  if (points.length < 2) return null;

  // The scale runs from the best position reached to the worst, padded so the
  // line never sits on the frame. It is clamped to at least ten places so a
  // keyword that barely moves does not get a chart of dramatic wobble.
  const best = ranked.length > 0 ? Math.min(...ranked) : 1;
  const worst = ranked.length > 0 ? Math.max(...ranked) : 100;
  const span = Math.max(worst - best, 8);
  const top = Math.max(1, best - span * 0.15);
  const bottom = Math.min(100, worst + span * 0.15);

  const plotWidth = Math.max(width - PADDING.left - PADDING.right, 10);
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;

  const xAt = (index: number) =>
    PADDING.left + (index / (points.length - 1)) * plotWidth;

  // Inverted: the smaller the position, the higher up the chart.
  const yAt = (position: number) =>
    PADDING.top + ((position - top) / (bottom - top || 1)) * plotHeight;

  const ticks = tickValues(top, bottom);

  // Consecutive runs of ranked samples, so a gap breaks the line rather than
  // being bridged across a window the keyword did not rank in.
  const segments: string[] = [];
  let current: string[] = [];
  points.forEach((point, index) => {
    if (point.position === null) {
      if (current.length > 1) segments.push(`M${current.join(" L")}`);
      current = [];
      return;
    }
    current.push(`${xAt(index).toFixed(2)},${yAt(point.position).toFixed(2)}`);
  });
  if (current.length > 1) segments.push(`M${current.join(" L")}`);

  const labelEvery = Math.max(1, Math.ceil(points.length / 7));
  const active =
    hovered !== null && hovered < points.length ? hovered : null;
  const activePoint = active === null ? null : points[active];

  const improving = history.net > 0;

  const handlePointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left - PADDING.left;
    const index = Math.round((x / plotWidth) * (points.length - 1));
    setHovered(Math.min(Math.max(index, 0), points.length - 1));
  };

  return (
    <div ref={measureRef} className="relative w-full">
      <svg
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        role="img"
        aria-label={`Ranking position over time. Best ${history.best ?? "not ranking"}, worst ${history.worst ?? "not ranking"}, net ${history.net} places.`}
        className={cn(
          "block",
          improving ? "text-positive" : "text-accent",
        )}
        onPointerMove={handlePointer}
        onPointerLeave={() => setHovered(null)}
      >
        <defs>
          <linearGradient id="nexra-rank-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity={0.18} />
            <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
          </linearGradient>
        </defs>

        <g className="text-border">
          {ticks.map((tick) => (
            <line
              key={tick}
              x1={PADDING.left}
              x2={width - PADDING.right}
              y1={yAt(tick)}
              y2={yAt(tick)}
              stroke="currentColor"
              strokeWidth={1}
              strokeDasharray="3 4"
            />
          ))}
        </g>

        <g className="fill-fg-subtle text-[10.5px]">
          {ticks.map((tick) => (
            <text
              key={tick}
              x={PADDING.left - 8}
              y={yAt(tick) + 3.5}
              textAnchor="end"
              className="tabular"
            >
              {tick}
            </text>
          ))}
        </g>

        <g className="fill-fg-subtle text-[10.5px]">
          {points.map((point, index) =>
            index % labelEvery === 0 ? (
              <text
                key={point.date}
                x={xAt(index)}
                y={HEIGHT - 7}
                textAnchor={
                  index === 0
                    ? "start"
                    : index === points.length - 1
                      ? "end"
                      : "middle"
                }
              >
                {point.label}
              </text>
            ) : null,
          )}
        </g>

        {segments.map((segment) => (
          <path
            key={segment.slice(0, 24)}
            d={segment}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {points.map((point, index) =>
          point.position === null ? (
            <line
              key={`gap-${point.date}`}
              x1={xAt(index)}
              x2={xAt(index)}
              y1={PADDING.top}
              y2={HEIGHT - PADDING.bottom}
              stroke="currentColor"
              strokeWidth={1}
              strokeDasharray="2 3"
              className="text-critical"
              opacity={0.35}
            />
          ) : null,
        )}

        {active !== null && activePoint?.position !== null && activePoint && (
          <g>
            <line
              x1={xAt(active)}
              x2={xAt(active)}
              y1={PADDING.top}
              y2={HEIGHT - PADDING.bottom}
              stroke="currentColor"
              strokeWidth={1}
              className="text-border-strong"
            />
            <circle
              cx={xAt(active)}
              cy={yAt(activePoint.position)}
              r={4}
              fill="currentColor"
            />
          </g>
        )}
      </svg>

      {activePoint && (
        <div
          role="status"
          style={{
            left: Math.min(
              Math.max(xAt(active as number) - 70, 0),
              Math.max(width - 140, 0),
            ),
            width: 140,
          }}
          className="pointer-events-none absolute top-1 rounded-md border border-border-strong bg-surface-raised px-2.5 py-1.5 shadow-xl shadow-black/40"
        >
          <p className="text-[11px] text-fg-subtle">{activePoint.label}</p>
          <p className="tabular mt-0.5 text-[13px] font-semibold text-fg">
            {activePoint.position === null
              ? "Not ranking"
              : `Position ${activePoint.position}`}
          </p>
        </div>
      )}

      {/* The chart is a second reading of numbers stated beside it, but a
          screen reader still needs the series itself. */}
      <ul className="sr-only">
        {points.map((point) => (
          <li key={point.date}>
            {point.label}:{" "}
            {point.position === null
              ? "not ranking"
              : `position ${point.position}`}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Four evenly spaced whole positions across the visible range. */
function tickValues(top: number, bottom: number): readonly number[] {
  const steps = 4;
  const values: number[] = [];

  for (let index = 0; index <= steps; index += 1) {
    const value = Math.round(top + ((bottom - top) * index) / steps);
    if (!values.includes(value)) values.push(value);
  }

  return values;
}
