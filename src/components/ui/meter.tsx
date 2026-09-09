import { cn } from "@/lib/cn";

export type MeterTone = "accent" | "positive" | "warning" | "critical" | "neutral";

const FILL_STYLES: Record<MeterTone, string> = {
  accent: "bg-accent",
  positive: "bg-positive",
  warning: "bg-warning",
  critical: "bg-critical",
  neutral: "bg-fg-subtle",
};

/**
 * Horizontal proportion bar: a score out of 100, a completion percentage, or a
 * share of a total.
 *
 * Exposed as a progress bar to assistive technology, with the numeric value
 * always rendered alongside it by the caller — the bar is a second reading of
 * the number, never the only one.
 */
export function Meter({
  value,
  max = 100,
  tone = "accent",
  size = "md",
  label,
  className,
}: {
  value: number;
  max?: number;
  tone?: MeterTone;
  /** `sm` inside dense table rows, `md` in panels. */
  size?: "sm" | "md";
  /** Accessible name — required, since the bar carries no text of its own. */
  label: string;
  className?: string;
}) {
  const percent = Math.max(0, Math.min(100, (value / max) * 100));

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={max}
      className={cn(
        "w-full overflow-hidden rounded-full bg-surface-hover",
        size === "sm" ? "h-1" : "h-1.5",
        className,
      )}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-500", FILL_STYLES[tone])}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

/**
 * Stacked proportion bar — one row, several segments.
 *
 * Used where the parts sum to a whole, such as the ranking distribution.
 */
export function StackedMeter({
  segments,
  label,
  className,
}: {
  segments: readonly {
    readonly id: string;
    readonly value: number;
    readonly tone: MeterTone;
  }[];
  label: string;
  className?: string;
}) {
  const total = segments.reduce((carry, segment) => carry + segment.value, 0) || 1;

  return (
    <div
      role="img"
      aria-label={label}
      className={cn("flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-surface-hover", className)}
    >
      {segments.map((segment) => (
        <div
          key={segment.id}
          className={cn("h-full first:rounded-l-full last:rounded-r-full", FILL_STYLES[segment.tone])}
          style={{ width: `${(segment.value / total) * 100}%` }}
        />
      ))}
    </div>
  );
}
