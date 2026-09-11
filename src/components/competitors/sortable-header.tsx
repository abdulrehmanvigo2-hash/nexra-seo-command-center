"use client";

import { Icon } from "@/components/icons";
import { TableHeaderCell } from "@/components/ui/table";
import { cn } from "@/lib/cn";

/**
 * A column heading that sorts.
 *
 * Generic over the sort key so the three tables in this module — competitors,
 * keyword overlap, and competitor pages — share one implementation rather than
 * three that drift. The accessible name states the current direction and what
 * clicking will do, because the glyph alone does not say that.
 */
export function SortableHeader<T extends string>({
  label,
  sortKey,
  align = "left",
  sort,
  onSort,
  options,
  className,
}: {
  label: string;
  sortKey: T;
  align?: "left" | "right";
  sort: { key: T; desc: boolean };
  onSort: (key: T) => void;
  /** The full option list, so the label can be expanded for screen readers. */
  options: readonly { readonly value: T; readonly label: string }[];
  className?: string;
}) {
  const active = sort.key === sortKey;
  const full =
    options.find((option) => option.value === sortKey)?.label ?? label;

  return (
    <TableHeaderCell align={align} className={cn("p-0", className)}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        aria-label={
          active
            ? `Sorted by ${full}, ${sort.desc ? "descending" : "ascending"}. Reverse the order.`
            : `Sort by ${full}`
        }
        title={full}
        className={cn(
          "flex w-full items-center gap-1.5 px-4 py-2.5 transition-colors hover:text-fg-muted",
          align === "right" && "justify-end",
          active && "text-fg-muted",
        )}
      >
        {label}
        <Icon
          name={active ? (sort.desc ? "trend-down" : "trend-up") : "sort"}
          className={cn("h-3 w-3 shrink-0", !active && "opacity-45")}
        />
      </button>
    </TableHeaderCell>
  );
}
