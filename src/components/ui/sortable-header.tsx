"use client";

import { Icon } from "@/components/icons";
import { TableHeaderCell } from "@/components/ui/table";
import { cn } from "@/lib/cn";

/**
 * A column heading that sorts.
 *
 * One implementation for every sortable table in the product. There were six
 * before this, and they had already drifted: half announced the live sort
 * state and half announced only the column name, so the same interaction
 * reported itself differently depending on which module you were in.
 *
 * Two things carry the state, because the glyph alone carries it to nobody
 * using a screen reader:
 *
 * - `aria-sort` on the cell, set on every sortable column — `"none"` included
 *   — so the header row says which columns can be sorted, not just which one
 *   currently is.
 * - The button's accessible name, which states the current direction and what
 *   pressing it will do.
 *
 * Keyboard activation is whatever a `<button>` already does: Enter and Space,
 * in the document's tab order. Nothing here overrides that.
 */
export function SortableHeader<T extends string>({
  label,
  sortKey,
  align = "left",
  sort,
  onSort,
  /**
   * The module's full sort option list. Used to expand an abbreviated column
   * heading into the wording the rest of the module uses — "AI" in the header
   * is "Answer readiness" in the sort menu. Optional: a table without a menu
   * falls back to the visible label.
   */
  options,
  className,
}: {
  label: string;
  sortKey: T;
  align?: "left" | "right";
  sort: { key: T; desc: boolean };
  onSort: (key: T) => void;
  options?: readonly { readonly value: T; readonly label: string }[];
  className?: string;
}) {
  const active = sort.key === sortKey;
  const full = options?.find((option) => option.value === sortKey)?.label ?? label;

  return (
    <TableHeaderCell
      align={align}
      ariaSort={active ? (sort.desc ? "descending" : "ascending") : "none"}
      className={cn("p-0", className)}
    >
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
