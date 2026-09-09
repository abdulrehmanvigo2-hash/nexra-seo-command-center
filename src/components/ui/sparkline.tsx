import { cn } from "@/lib/cn";

const TONE_STYLES = {
  positive: "text-positive",
  warning: "text-warning",
  critical: "text-critical",
  neutral: "text-fg-subtle",
  accent: "text-accent",
} as const;

export type SparklineTone = keyof typeof TONE_STYLES;

/**
 * Miniature trend line for a KPI card.
 *
 * Drawn in a normalised 100x32 box and stretched to fit its container, with a
 * non-scaling stroke so the line keeps an even weight at any card width. It is
 * decorative: the value and the percentage change beside it carry the meaning,
 * so it is hidden from assistive technology.
 */
export function Sparkline({
  values,
  tone = "accent",
  className,
}: {
  values: readonly number[];
  tone?: SparklineTone;
  className?: string;
}) {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat series would divide by zero; give it a mid-height line instead.
  const span = max - min || 1;
  const step = 100 / (values.length - 1);

  const points = values.map((value, index) => {
    const x = index * step;
    const y = 30 - ((value - min) / span) * 28;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const line = `M${points.join(" L")}`;
  const area = `${line} L100,32 L0,32 Z`;

  return (
    <svg
      viewBox="0 0 100 32"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={cn("h-8 w-full", TONE_STYLES[tone], className)}
    >
      <path d={area} fill="currentColor" opacity={0.12} />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
