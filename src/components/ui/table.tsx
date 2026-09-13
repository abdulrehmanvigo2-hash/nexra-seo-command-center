import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";

type Align = "left" | "right" | "center";

const ALIGN_STYLES: Record<Align, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

/**
 * Table shell: a horizontal scroll container plus a dense `<table>`.
 *
 * Presentational only — sorting, paging, and selection belong to the module
 * that owns the data, not to this primitive.
 */
export function Table({
  children,
  /** Accessible name, rendered as a visually hidden `<caption>`. */
  caption,
  className,
}: {
  children: ReactNode;
  caption?: string;
  className?: string;
}) {
  return (
    // `relative` is load-bearing. `sr-only` is absolutely positioned, so a
    // screen-reader-only span inside a wide table would otherwise resolve its
    // containing block to the viewport, escape this scroll container, and add
    // its static position — far to the right in a table wider than the
    // screen — to the document's width. Positioning this element makes it the
    // containing block, so those spans are clipped along with everything else.
    <div className="relative w-full overflow-x-auto">
      <table
        className={cn(
          "w-full border-collapse text-left text-[12.5px]",
          className,
        )}
      >
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

export function TableHead({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <thead
      className={cn("border-b border-border bg-surface-raised", className)}
    >
      {children}
    </thead>
  );
}

export function TableBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <tbody
      className={cn(
        "[&>tr:not(:first-child)]:border-t [&>tr:not(:first-child)]:border-border [&>tr:hover]:bg-surface-hover/50",
        className,
      )}
    >
      {children}
    </tbody>
  );
}

export function TableRow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <tr className={cn("transition-colors", className)}>{children}</tr>;
}

export function TableHeaderCell({
  children,
  align = "left",
  /**
   * Sort state of this column, for a table whose rows are sorted by it.
   * Set it on every sortable column — including the inactive ones, as
   * `"none"` — so the header says which columns can be sorted at all, not
   * only which one currently is.
   */
  ariaSort,
  className,
}: {
  children: ReactNode;
  align?: Align;
  ariaSort?: "ascending" | "descending" | "none";
  className?: string;
}) {
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={cn(
        "px-4 py-2.5 text-[11px] font-semibold tracking-[0.06em] whitespace-nowrap text-fg-subtle uppercase",
        ALIGN_STYLES[align],
        className,
      )}
    >
      {children}
    </th>
  );
}

export function TableCell({
  children,
  align = "left",
  /** Right-aligns and applies tabular figures so digits line up in columns. */
  numeric = false,
  /** Renders as a row header — use for the row's identifying column. */
  header = false,
  className,
}: {
  children: ReactNode;
  align?: Align;
  numeric?: boolean;
  header?: boolean;
  className?: string;
}) {
  const Cell = header ? "th" : "td";

  return (
    <Cell
      scope={header ? "row" : undefined}
      className={cn(
        "px-4 py-3 align-middle",
        header ? "font-medium text-fg" : "text-fg-muted",
        numeric ? "tabular text-right" : ALIGN_STYLES[align],
        className,
      )}
    >
      {children}
    </Cell>
  );
}

/** Full-width row for an empty state inside a table body. */
export function TableEmptyRow({
  colSpan,
  children,
}: {
  colSpan: number;
  children: ReactNode;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="p-0">
        {children}
      </td>
    </tr>
  );
}

/** Placeholder rows shown while the real rows are loading. */
export function TableSkeletonRows({
  rows = 5,
  columns,
}: {
  rows?: number;
  columns: number;
}) {
  return (
    <>
      {Array.from({ length: rows }, (_, rowIndex) => (
        <tr key={rowIndex}>
          {Array.from({ length: columns }, (_, columnIndex) => (
            <td key={columnIndex} className="px-4 py-3">
              <Skeleton
                className={cn("h-3", columnIndex === 0 ? "w-40" : "w-16")}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
