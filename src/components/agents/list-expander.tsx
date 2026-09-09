"use client";

import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";

/**
 * Shows the rest of a long operational list.
 *
 * The agent task board, the blocker queue, and the hand-off queue each cover
 * the whole portfolio, which is dozens of rows. Rendering all of them at once
 * makes a page nobody can scan, so each opens on the most urgent handful and
 * expands in place. The rows are already sorted worst-first, so what is hidden
 * is always the least pressing.
 *
 * The count is stated on the control, so it is never a surprise how much is
 * behind it.
 */
export function ListExpander({
  expanded,
  onToggle,
  shown,
  total,
  noun,
}: {
  expanded: boolean;
  onToggle: () => void;
  shown: number;
  total: number;
  /** Plural noun for the rows, e.g. "tasks". */
  noun: string;
}) {
  if (total <= shown && !expanded) return null;

  return (
    <Button variant="ghost" onClick={onToggle}>
      {expanded ? (
        <>
          <Icon name="minus" className="h-4 w-4" />
          Show fewer
        </>
      ) : (
        <>
          <Icon name="plus" className="h-4 w-4" />
          Show all {total} {noun}
        </>
      )}
    </Button>
  );
}
