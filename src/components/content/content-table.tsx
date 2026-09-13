"use client";

import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { SortableHeader } from "@/components/ui/sortable-header";
import { cn } from "@/lib/cn";
import { formatCompact, formatCurrencyCompact } from "@/lib/format";
import {
  AlignmentBadge,
  ContentLink,
  FormatBadge,
  Freshness,
  HealthBadge,
  LinkCounts,
  PageUrl,
  PositionValue,
  ScoreValue,
  StageBadge,
  WordCount,
} from "@/components/content/content-chrome";
import {
  CONTENT_SORT_OPTIONS,
  type ContentSort,
} from "@/components/content/sorting";
import type { ContentRecord } from "@/types/content";

/**
 * The content inventory.
 *
 * Wide on purpose. This is the screen an editor lives in, and the columns are
 * the ones a commissioning decision is actually made from — what state it is
 * in, how it is doing, what it is worth, how strong the page is, and what is
 * wrong with it. The `Table` primitive scrolls horizontally, so nothing is
 * dropped to fit a narrow screen; the title column stays first so a row is
 * always identifiable while scrolling across.
 *
 * Selection lives with the workspace rather than here, because bulk actions
 * have to survive a filter change and a page change.
 */

const COLUMNS = 14;

export function ContentTable({
  records,
  sort,
  onSort,
  selected,
  onToggle,
  onToggleAll,
  reviewed,
}: {
  records: readonly ContentRecord[];
  sort: { key: ContentSort; desc: boolean };
  onSort: (key: ContentSort) => void;
  /** Ids selected for a bulk action. */
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  /** Selects or clears every row currently on screen. */
  onToggleAll: (ids: readonly string[], select: boolean) => void;
  /** Ids marked reviewed in this session. */
  reviewed: ReadonlySet<string>;
}) {
  const ids = records.map((record) => record.id);
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
  const someSelected = ids.some((id) => selected.has(id));

  return (
    <Table caption="Content inventory with stage, condition, score, and performance">
      <TableHead>
        <TableRow>
          <TableHeaderCell className="w-9 pr-0">
            <label className="flex cursor-pointer items-center justify-center">
              <span className="sr-only">
                {allSelected
                  ? "Clear selection on this page"
                  : "Select every piece on this page"}
              </span>
              <input
                type="checkbox"
                checked={allSelected}
                ref={(node) => {
                  if (node) node.indeterminate = someSelected && !allSelected;
                }}
                onChange={() => onToggleAll(ids, !allSelected)}
                className="h-3.5 w-3.5 cursor-pointer accent-accent"
              />
            </label>
          </TableHeaderCell>

          <SortableHeader label="Title" sortKey="title" options={CONTENT_SORT_OPTIONS} sort={sort} onSort={onSort} />
          <TableHeaderCell>Stage</TableHeaderCell>
          <TableHeaderCell>Condition</TableHeaderCell>
          <TableHeaderCell>Format</TableHeaderCell>
          <SortableHeader label="Score" sortKey="score" options={CONTENT_SORT_OPTIONS} align="right" sort={sort} onSort={onSort} />
          <TableHeaderCell>Intent fit</TableHeaderCell>
          <SortableHeader label="Volume" sortKey="volume" options={CONTENT_SORT_OPTIONS} align="right" sort={sort} onSort={onSort} />
          <SortableHeader label="Best pos." sortKey="position" options={CONTENT_SORT_OPTIONS} align="right" sort={sort} onSort={onSort} />
          <SortableHeader label="Traffic" sortKey="traffic" options={CONTENT_SORT_OPTIONS} align="right" sort={sort} onSort={onSort} />
          <SortableHeader label="Value" sortKey="value" options={CONTENT_SORT_OPTIONS} align="right" sort={sort} onSort={onSort} />
          <SortableHeader label="Words" sortKey="words" options={CONTENT_SORT_OPTIONS} align="right" sort={sort} onSort={onSort} />
          <SortableHeader label="Links" sortKey="links" options={CONTENT_SORT_OPTIONS} align="right" sort={sort} onSort={onSort} />
          <SortableHeader label="Age" sortKey="updated" options={CONTENT_SORT_OPTIONS} align="right" sort={sort} onSort={onSort} />
        </TableRow>
      </TableHead>

      <TableBody>
        {records.map((record) => {
          const isSelected = selected.has(record.id);

          return (
            <TableRow
              key={record.id}
              className={cn(isSelected && "bg-accent-soft/40")}
            >
              <TableCell className="w-9 pr-0">
                <label className="flex cursor-pointer items-center justify-center">
                  <span className="sr-only">Select {record.title}</span>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggle(record.id)}
                    className="h-3.5 w-3.5 cursor-pointer accent-accent"
                  />
                </label>
              </TableCell>

              <TableCell header className="max-w-[300px] min-w-[220px]">
                <span className="flex items-center gap-1.5">
                  <ContentLink
                    id={record.id}
                    title={record.title}
                    className="block truncate"
                  />
                  {reviewed.has(record.id) && (
                    <span title="Marked reviewed in this session">
                      <Icon
                        name="check"
                        className="h-3.5 w-3.5 shrink-0 text-positive"
                      />
                      <span className="sr-only">Reviewed</span>
                    </span>
                  )}
                  {record.cannibalised && (
                    <span title="Another page of ours competes with this one">
                      <Icon
                        name="split"
                        className="h-3.5 w-3.5 shrink-0 text-warning"
                      />
                      <span className="sr-only">Cannibalised</span>
                    </span>
                  )}
                </span>
                <PageUrl
                  url={record.url}
                  stage={record.stage}
                  className="mt-0.5 font-normal"
                />
                <span className="mt-1 block truncate text-[11px] font-normal text-fg-subtle">
                  {record.projectName} ·{" "}
                  <Link
                    href={`/keywords/clusters/${record.clusterId}`}
                    className="transition-colors hover:text-accent"
                  >
                    {record.clusterName}
                  </Link>
                </span>
              </TableCell>

              <TableCell>
                <StageBadge stage={record.stage} short />
              </TableCell>

              <TableCell>
                {record.url === null ? (
                  <span className="text-[11.5px] text-fg-subtle">—</span>
                ) : (
                  <HealthBadge health={record.health} />
                )}
              </TableCell>

              <TableCell>
                <FormatBadge format={record.format} />
              </TableCell>

              <TableCell numeric>
                <ScoreValue
                  score={record.score.score}
                  published={record.url !== null}
                />
              </TableCell>

              <TableCell>
                <AlignmentBadge
                  alignment={record.intentAlignment}
                  note={record.intentNote}
                />
              </TableCell>

              <TableCell numeric>
                {record.keywordCount === 0 ? (
                  <Badge tone="warning">No keyword</Badge>
                ) : (
                  <span
                    className="tabular text-fg-muted"
                    title={`${record.keywordCount} keywords, ${record.totalVolume.toLocaleString("en-US")} searches a month`}
                  >
                    {formatCompact(record.totalVolume)}
                  </span>
                )}
              </TableCell>

              <TableCell numeric>
                <PositionValue position={record.bestPosition} />
              </TableCell>

              <TableCell numeric>
                {record.url === null ? (
                  <span className="text-fg-subtle">—</span>
                ) : (
                  formatCompact(record.traffic)
                )}
              </TableCell>

              <TableCell numeric>
                {record.opportunityValue === 0 ? (
                  <span className="text-fg-subtle">—</span>
                ) : (
                  formatCurrencyCompact(record.opportunityValue)
                )}
              </TableCell>

              <TableCell numeric>
                <WordCount record={record} />
              </TableCell>

              <TableCell numeric>
                <LinkCounts record={record} />
              </TableCell>

              <TableCell numeric>
                <Freshness ageDays={record.ageDays} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export const CONTENT_TABLE_COLUMNS = COLUMNS;
