"use client";

import { Icon } from "@/components/icons";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { TrendIndicator } from "@/components/ui/trend-indicator";
import { formatPercent } from "@/lib/format";
import {
  CompetitorLink,
  CompetitorTypeBadge,
  DomainText,
  PositionValue,
  ProjectLink,
  ScoreValue,
  ThreatBadge,
  TrafficValue,
} from "@/components/competitors/competitor-chrome";
import { SortableHeader } from "@/components/competitors/sortable-header";
import {
  COMPETITOR_SORT_OPTIONS,
  type CompetitorSort,
} from "@/components/competitors/sorting";
import type { CompetitorRecord } from "@/types/competitor";

/**
 * The tracked competitive set.
 *
 * Wide on purpose: this is the table an account lead scans before a client
 * call, and the columns are the ones the conversation actually turns on — how
 * much of the set they hold, how much of it they are winning, what it is
 * costing, and whether the gap is widening. The `Table` primitive scrolls
 * horizontally rather than dropping columns on a narrow screen, and the name
 * column stays first so a row is identifiable while scrolling across.
 *
 * Selection lives with the workspace, because the comparison it feeds has to
 * survive a filter change and a tab change.
 */
export function CompetitorsTable({
  records,
  sort,
  onSort,
  selected,
  onToggle,
  onToggleAll,
  /** True where the selection has reached its cap. */
  selectionFull,
}: {
  records: readonly CompetitorRecord[];
  sort: { key: CompetitorSort; desc: boolean };
  onSort: (key: CompetitorSort) => void;
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onToggleAll: (ids: readonly string[], select: boolean) => void;
  selectionFull: boolean;
}) {
  const ids = records.map((record) => record.id);
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
  const someSelected = ids.some((id) => selected.has(id));

  return (
    <Table caption="Tracked competitors with threat, overlap, and opportunity">
      <TableHead>
        <TableRow>
          <TableHeaderCell className="w-9 pr-0">
            <label className="flex cursor-pointer items-center justify-center">
              <span className="sr-only">
                {allSelected
                  ? "Clear comparison selection on this page"
                  : "Select every competitor on this page for comparison"}
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

          <SortableHeader
            label="Competitor"
            sortKey="name"
            sort={sort}
            onSort={onSort}
            options={COMPETITOR_SORT_OPTIONS}
          />
          <TableHeaderCell>Project</TableHeaderCell>
          <TableHeaderCell>Type</TableHeaderCell>
          <SortableHeader
            label="Threat"
            sortKey="threat"
            align="right"
            sort={sort}
            onSort={onSort}
            options={COMPETITOR_SORT_OPTIONS}
          />
          <SortableHeader
            label="Opportunity"
            sortKey="opportunity"
            align="right"
            sort={sort}
            onSort={onSort}
            options={COMPETITOR_SORT_OPTIONS}
          />
          <SortableHeader
            label="Strength"
            sortKey="strength"
            align="right"
            sort={sort}
            onSort={onSort}
            options={COMPETITOR_SORT_OPTIONS}
          />
          <SortableHeader
            label="Visibility"
            sortKey="visibility"
            align="right"
            sort={sort}
            onSort={onSort}
            options={COMPETITOR_SORT_OPTIONS}
          />
          <SortableHeader
            label="Shared"
            sortKey="overlap"
            align="right"
            sort={sort}
            onSort={onSort}
            options={COMPETITOR_SORT_OPTIONS}
          />
          <SortableHeader
            label="They win"
            sortKey="wins"
            align="right"
            sort={sort}
            onSort={onSort}
            options={COMPETITOR_SORT_OPTIONS}
          />
          <SortableHeader
            label="Avg pos."
            sortKey="position"
            align="right"
            sort={sort}
            onSort={onSort}
            options={COMPETITOR_SORT_OPTIONS}
          />
          <SortableHeader
            label="Traffic gap"
            sortKey="traffic"
            align="right"
            sort={sort}
            onSort={onSort}
            options={COMPETITOR_SORT_OPTIONS}
          />
          <SortableHeader
            label="Authority"
            sortKey="authority"
            align="right"
            sort={sort}
            onSort={onSort}
            options={COMPETITOR_SORT_OPTIONS}
          />
          <TableHeaderCell align="right">Momentum</TableHeaderCell>
        </TableRow>
      </TableHead>

      <TableBody>
        {records.map((record) => {
          const isSelected = selected.has(record.id);

          return (
            <TableRow
              key={record.id}
              className={isSelected ? "bg-accent-soft/40" : undefined}
            >
              <TableCell className="pr-0">
                <label className="flex cursor-pointer items-center justify-center">
                  <span className="sr-only">
                    {isSelected ? "Remove" : "Add"} {record.name} in{" "}
                    {record.projectName} {isSelected ? "from" : "to"} the
                    comparison
                  </span>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    disabled={!isSelected && selectionFull}
                    onChange={() => onToggle(record.id)}
                    className="h-3.5 w-3.5 cursor-pointer accent-accent disabled:cursor-not-allowed disabled:opacity-40"
                  />
                </label>
              </TableCell>

              <TableCell header className="min-w-[200px]">
                <span className="flex min-w-0 flex-col gap-0.5">
                  <CompetitorLink id={record.id} name={record.name} />
                  <DomainText domain={record.domain} />
                </span>
              </TableCell>

              <TableCell className="max-w-[160px]">
                <ProjectLink
                  projectId={record.projectId}
                  projectName={record.projectName}
                />
              </TableCell>

              <TableCell>
                <CompetitorTypeBadge type={record.type} />
              </TableCell>

              <TableCell numeric>
                <span className="inline-flex items-center gap-2">
                  <ThreatBadge level={record.threatLevel} />
                  <span className="tabular w-6 text-right font-semibold text-fg">
                    {record.threat.score}
                  </span>
                </span>
              </TableCell>

              <TableCell numeric>
                <ScoreValue
                  score={record.opportunity.score}
                  label="Opportunity score"
                  tone="positive"
                />
              </TableCell>

              <TableCell numeric>
                <ScoreValue
                  score={record.strength.score}
                  label="Competitor strength"
                />
              </TableCell>

              <TableCell numeric>
                <span
                  className="tabular text-fg-muted"
                  title={`They hold ${formatPercent(record.visibility)} of what this keyword set can produce; we hold ${formatPercent(record.ourVisibility)}.`}
                >
                  {formatPercent(record.visibility)}
                </span>
              </TableCell>

              <TableCell numeric>
                <span
                  className="tabular text-fg-muted"
                  title={`${record.sharedKeywords} contested, ${record.competitorOnly} theirs only, ${record.ourOnly} ours only`}
                >
                  {record.sharedKeywords}
                </span>
              </TableCell>

              <TableCell numeric>
                <span
                  className="tabular inline-flex items-center gap-1.5"
                  title={`They lead on ${record.theirWins} contested terms; we lead on ${record.ourWins}. ${record.closeContests} are within two places.`}
                >
                  {record.theirWins > record.ourWins && (
                    <Icon
                      name="alert"
                      className="h-3.5 w-3.5 shrink-0 text-warning"
                    />
                  )}
                  <span
                    className={
                      record.theirWins > record.ourWins
                        ? "font-medium text-warning"
                        : "text-fg-muted"
                    }
                  >
                    {record.theirWins}
                  </span>
                  <span className="text-fg-subtle">/ {record.sharedKeywords}</span>
                </span>
              </TableCell>

              <TableCell numeric>
                <PositionValue
                  position={
                    record.averagePosition === null
                      ? null
                      : Math.round(record.averagePosition)
                  }
                />
              </TableCell>

              <TableCell numeric>
                <TrafficValue sessions={record.trafficGap} />
              </TableCell>

              <TableCell numeric>
                <span
                  className="tabular text-fg-muted"
                  title="Modelled authority-style score. There is no link index behind this product."
                >
                  {record.authority}
                </span>
              </TableCell>

              <TableCell numeric>
                <TrendIndicator
                  value={record.momentum.value}
                  invert
                  comparison={record.gaining ? "gaining" : undefined}
                />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** Column count, for a table-body empty state that has to span the row. */
export const COMPETITOR_TABLE_COLUMNS = 14;
