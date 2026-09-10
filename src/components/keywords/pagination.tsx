"use client";

import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { formatNumber } from "@/lib/format";

/**
 * Paging for the keyword table.
 *
 * A keyword set is the one place in this product where the full list is too
 * long to render at once and too long to scroll through honestly. Paging is
 * the right control here rather than an expander: the sort decides what is on
 * page one, so what is hidden is always the least relevant, and the range is
 * stated so it is never a surprise how much is behind it.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  /** Plural noun for the rows, e.g. "keywords". */
  noun,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  noun: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-border px-4 py-3 sm:px-5">
      <p aria-live="polite" className="text-[12px] text-fg-subtle">
        {total === 0 ? (
          `No ${noun}`
        ) : (
          <>
            Showing{" "}
            <span className="tabular text-fg-muted">
              {formatNumber(first)}–{formatNumber(last)}
            </span>{" "}
            of <span className="tabular text-fg-muted">{formatNumber(total)}</span>{" "}
            {noun}
          </>
        )}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-[11.5px] text-fg-subtle">
          Rows
          <span className="block w-20">
            <Select
              size="sm"
              value={String(pageSize)}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              options={[
                { value: "25", label: "25" },
                { value: "50", label: "50" },
                { value: "100", label: "100" },
              ]}
            />
          </span>
        </label>

        <div className="flex items-center gap-1">
          <Button
            size="icon"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            aria-label="Previous page"
            title="Previous page"
          >
            <Icon name="arrow-left" className="h-4 w-4" />
          </Button>

          <span className="tabular px-2 text-[12px] whitespace-nowrap text-fg-muted">
            {page} / {pages}
          </span>

          <Button
            size="icon"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= pages}
            aria-label="Next page"
            title="Next page"
          >
            <Icon name="arrow-right" className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
