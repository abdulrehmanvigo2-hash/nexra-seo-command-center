"use client";

import Link from "next/link";
import { Icon } from "@/components/icons";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { formatCompact, formatCurrencyCompact } from "@/lib/format";
import { AGENT_NAMES } from "@/lib/mock/agents/registry";
import {
  AssociationValue,
  ConfidenceTag,
  HeadroomBar,
  PageLink,
  PageStateBadge,
  SegmentBadge,
  TrafficValue,
  WorkKindBadge,
} from "@/components/analytics/analytics-chrome";
import type {
  AttributionRecord,
  PagePerformance,
  SegmentRow,
} from "@/types/analytics";

/**
 * The three analytics tables.
 *
 * Kept together because they share the same row grammar: an identity column, a
 * set of measured figures, and a state. Less load-bearing columns are hidden
 * below `lg` rather than wrapped, and each table scrolls inside its own
 * container so the page itself never does.
 */

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export function PagesTable({ pages }: { pages: readonly PagePerformance[] }) {
  if (pages.length === 0) {
    return (
      <EmptyState
        icon="pages"
        title="No pages match these filters"
        description="Every filter here is derived from the pages that exist, so a combination can still select nothing. Clear one to widen the set."
      />
    );
  }

  return (
    <Table caption="Published pages, measured against their own potential">
      <TableHead>
        <TableRow>
          <TableHeaderCell>Page</TableHeaderCell>
          <TableHeaderCell className="hidden lg:table-cell">
            Cluster
          </TableHeaderCell>
          <TableHeaderCell align="right">Sessions</TableHeaderCell>
          <TableHeaderCell align="right" className="hidden sm:table-cell">
            Potential
          </TableHeaderCell>
          <TableHeaderCell align="right">Carrying</TableHeaderCell>
          <TableHeaderCell align="right" className="hidden xl:table-cell">
            Unclaimed
          </TableHeaderCell>
          <TableHeaderCell align="right" className="hidden xl:table-cell">
            Value
          </TableHeaderCell>
          <TableHeaderCell align="right" className="hidden lg:table-cell">
            Position
          </TableHeaderCell>
          <TableHeaderCell align="right" className="hidden sm:table-cell">
            Change
          </TableHeaderCell>
          <TableHeaderCell>State</TableHeaderCell>
        </TableRow>
      </TableHead>

      <TableBody>
        {pages.map((page) => (
          <TableRow key={page.contentId}>
            <TableCell header className="max-w-[20rem] min-w-[11rem]">
              <PageLink
                contentId={page.contentId}
                title={page.title}
                path={page.path}
              />
            </TableCell>

            <TableCell className="hidden max-w-[12rem] lg:table-cell">
              <span className="block truncate" title={page.clusterName}>
                {page.clusterName}
              </span>
            </TableCell>

            <TableCell numeric>
              <TrafficValue sessions={page.traffic} />
            </TableCell>

            <TableCell numeric className="hidden sm:table-cell">
              <TrafficValue sessions={page.potential} />
            </TableCell>

            <TableCell numeric>
              <HeadroomBar traffic={page.traffic} potential={page.potential} />
            </TableCell>

            <TableCell numeric className="hidden xl:table-cell">
              <TrafficValue sessions={page.headroom} />
            </TableCell>

            <TableCell numeric className="hidden xl:table-cell">
              {page.opportunityValue > 0
                ? formatCurrencyCompact(page.opportunityValue)
                : "—"}
            </TableCell>

            <TableCell numeric className="hidden lg:table-cell">
              {page.averagePosition ?? "—"}
            </TableCell>

            <TableCell
              numeric
              className={cn(
                "hidden sm:table-cell",
                page.positionChange > 0
                  ? "text-positive"
                  : page.positionChange < 0
                    ? "text-critical"
                    : undefined,
              )}
            >
              {page.positionChange > 0 ? "+" : ""}
              {page.positionChange}
            </TableCell>

            <TableCell>
              <PageStateBadge state={page.state} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

export function SegmentsTable({ rows }: { rows: readonly SegmentRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon="layers"
        title="No segments match these filters"
        description="Clear a filter to widen the set."
      />
    );
  }

  return (
    <Table caption="Performance cut by a canonical dimension">
      <TableHead>
        <TableRow>
          <TableHeaderCell>Segment</TableHeaderCell>
          <TableHeaderCell className="hidden xl:table-cell">
            Dimension
          </TableHeaderCell>
          <TableHeaderCell align="right">Sessions</TableHeaderCell>
          <TableHeaderCell align="right" className="hidden sm:table-cell">
            Share
          </TableHeaderCell>
          <TableHeaderCell align="right" className="hidden sm:table-cell">
            Potential
          </TableHeaderCell>
          <TableHeaderCell align="right">Unclaimed</TableHeaderCell>
          <TableHeaderCell align="right" className="hidden lg:table-cell">
            Keywords
          </TableHeaderCell>
          <TableHeaderCell align="right" className="hidden lg:table-cell">
            Pages
          </TableHeaderCell>
          <TableHeaderCell align="right" className="hidden xl:table-cell">
            Position
          </TableHeaderCell>
          <TableHeaderCell align="right" className="hidden xl:table-cell">
            Quality
          </TableHeaderCell>
        </TableRow>
      </TableHead>

      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell header className="max-w-[18rem] min-w-[10rem]">
              <span className="block min-w-0">
                <span className="block truncate font-medium text-fg" title={row.label}>
                  {row.label}
                </span>
                <span className="block truncate text-[11px] text-fg-subtle">
                  {row.projectName}
                </span>
              </span>
            </TableCell>

            <TableCell className="hidden xl:table-cell">
              <SegmentBadge dimension={row.dimension} />
            </TableCell>

            <TableCell numeric>
              <TrafficValue sessions={row.traffic} />
            </TableCell>

            <TableCell numeric className="hidden sm:table-cell">
              {row.share}%
            </TableCell>

            <TableCell numeric className="hidden sm:table-cell">
              <TrafficValue sessions={row.potential} />
            </TableCell>

            <TableCell numeric>
              <span
                className={cn(
                  "tabular",
                  row.potential - row.traffic > 0
                    ? "font-semibold text-fg"
                    : "text-fg-subtle",
                )}
              >
                {formatCompact(Math.max(row.potential - row.traffic, 0))}
              </span>
            </TableCell>

            <TableCell numeric className="hidden lg:table-cell">
              {row.keywords}
            </TableCell>

            <TableCell numeric className="hidden lg:table-cell">
              {row.pages}
            </TableCell>

            <TableCell numeric className="hidden xl:table-cell">
              {row.averagePosition ?? "—"}
            </TableCell>

            <TableCell numeric className="hidden xl:table-cell">
              {row.quality > 0 ? row.quality : "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

/**
 * Work set beside the movement it sits next to.
 *
 * The column is headed "Association" rather than "Impact" or "Contribution",
 * and every row carries its caveat on hover. Neither is decoration: this table
 * is the one place in the product where a reader might take a coincidence for
 * a result, and the wording is what stops that.
 */
export function AttributionTable({
  records,
}: {
  records: readonly AttributionRecord[];
}) {
  if (records.length === 0) {
    return (
      <EmptyState
        icon="workflow"
        title="No work sits beside movement in this window"
        description="Either nothing moved enough to pair, or the filters have narrowed past the last record."
      />
    );
  }

  return (
    <Table caption="Work paired with movement in the same window. Association only.">
      <TableHead>
        <TableRow>
          <TableHeaderCell>Work</TableHeaderCell>
          <TableHeaderCell className="hidden sm:table-cell">
            Source
          </TableHeaderCell>
          <TableHeaderCell>Page that moved</TableHeaderCell>
          <TableHeaderCell align="right" className="hidden lg:table-cell">
            Sessions
          </TableHeaderCell>
          <TableHeaderCell align="right" className="hidden sm:table-cell">
            Change
          </TableHeaderCell>
          <TableHeaderCell className="hidden xl:table-cell">
            Owner
          </TableHeaderCell>
          <TableHeaderCell align="right">Association</TableHeaderCell>
        </TableRow>
      </TableHead>

      <TableBody>
        {records.map((entry) => (
          <TableRow key={entry.id}>
            <TableCell header className="max-w-[20rem] min-w-[11rem]">
              <span className="block min-w-0">
                <Link
                  href={entry.sourceHref}
                  className="block truncate font-medium text-fg transition-colors hover:text-accent"
                  title={entry.workTitle}
                >
                  {entry.workTitle}
                </Link>
                <span className="mt-0.5 block">
                  <ConfidenceTag confidence={entry.confidence} />
                </span>
              </span>
            </TableCell>

            <TableCell className="hidden sm:table-cell">
              <WorkKindBadge kind={entry.kind} />
            </TableCell>

            <TableCell className="max-w-[18rem]">
              <Link
                href={entry.outcomeHref}
                className="block truncate text-fg-muted transition-colors hover:text-accent"
                title={entry.outcomeLabel}
              >
                {entry.outcomeLabel}
              </Link>
            </TableCell>

            <TableCell numeric className="hidden lg:table-cell">
              <TrafficValue sessions={entry.traffic} />
            </TableCell>

            <TableCell
              numeric
              className={cn(
                "hidden sm:table-cell",
                entry.positionChange > 0
                  ? "text-positive"
                  : entry.positionChange < 0
                    ? "text-critical"
                    : undefined,
              )}
            >
              {entry.positionChange > 0 ? "+" : ""}
              {entry.positionChange}
            </TableCell>

            <TableCell className="hidden xl:table-cell">
              {AGENT_NAMES[entry.owner]}
            </TableCell>

            <TableCell numeric>
              <span
                className="inline-flex items-center gap-1.5"
                title={entry.caveat}
              >
                <AssociationValue association={entry.association} />
                <Icon
                  name="info"
                  className="h-3.5 w-3.5 shrink-0 text-fg-subtle"
                />
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
