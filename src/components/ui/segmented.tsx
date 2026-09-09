"use client";

import { cn } from "@/lib/cn";

export type SegmentedOption<T extends string> = {
  readonly value: T;
  readonly label: string;
  /** Count shown after the label, e.g. the number of matching rows. */
  readonly count?: number;
  /** Short accessible description, used where the label is abbreviated. */
  readonly title?: string;
};

/**
 * A row of mutually exclusive choices: a time range, a metric, a filter.
 *
 * Rendered as buttons in a `role="group"` rather than as tabs, because the
 * options filter or reshape content that is already on the page instead of
 * swapping between separate tab panels. Selection is reported with
 * `aria-pressed`, so state is not carried by colour alone.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  size = "sm",
  className,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the group. */
  label: string;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "inline-flex flex-wrap items-center gap-0.5 rounded-md border border-border bg-surface p-0.5",
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            title={option.title}
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded font-medium whitespace-nowrap transition-colors",
              size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-8 px-3 text-[12.5px]",
              selected
                ? "bg-surface-hover text-fg shadow-sm shadow-black/20"
                : "text-fg-subtle hover:text-fg-muted",
            )}
          >
            {option.label}
            {option.count !== undefined && (
              <span
                className={cn(
                  "tabular text-[11px]",
                  selected ? "text-fg-muted" : "text-fg-subtle",
                )}
              >
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
