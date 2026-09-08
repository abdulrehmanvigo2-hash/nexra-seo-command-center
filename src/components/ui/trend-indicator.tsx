import { Icon } from "@/components/icons";
import { cn } from "@/lib/cn";

type TrendIndicatorProps = {
  /** Signed change. Percent by default, absolute when `unit` is `absolute`. */
  value: number;
  /**
   * Set for metrics where a decrease is an improvement — average position,
   * bounce rate, crawl errors.
   */
  invert?: boolean;
  unit?: "percent" | "absolute";
  /** Trailing context, e.g. "vs previous 28 days". */
  comparison?: string;
  /** Decimal places for percent values. */
  precision?: number;
  className?: string;
};

/**
 * Signed delta with direction glyph and semantic colour.
 *
 * Direction is never conveyed by colour alone: the arrow carries the shape and
 * a screen-reader-only word states whether the metric rose or fell.
 */
export function TrendIndicator({
  value,
  invert = false,
  unit = "percent",
  comparison,
  precision = 1,
  className,
}: TrendIndicatorProps) {
  const flat = value === 0;
  const rising = value > 0;
  const good = rising !== invert;

  const magnitude =
    unit === "percent"
      ? `${Math.abs(value).toFixed(precision)}%`
      : Math.abs(value).toLocaleString("en-US");

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[12px] font-medium",
        flat ? "text-fg-subtle" : good ? "text-positive" : "text-critical",
        className,
      )}
    >
      <Icon
        name={flat ? "trend-flat" : rising ? "trend-up" : "trend-down"}
        className="h-3.5 w-3.5 shrink-0"
      />
      <span className="tabular">
        {flat ? "" : rising ? "+" : "−"}
        {magnitude}
      </span>
      <span className="sr-only">
        {flat ? "no change" : rising ? "increase" : "decrease"}
      </span>
      {comparison && (
        <span className="font-normal text-fg-subtle">{comparison}</span>
      )}
    </span>
  );
}
