"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import {
  BattleBadge,
  CompetitorLink,
  CompetitorPageUrl,
  DifficultyValue,
  IntentBadge,
  KeywordLink,
  OpportunityValue,
  OverlapBadge,
  PositionValue,
  RankGap,
  TrafficValue,
  VolumeValue,
} from "@/components/competitors/competitor-chrome";
import { SortableHeader } from "@/components/competitors/sortable-header";
import {
  OVERLAP_SORT_OPTIONS,
  type OverlapSort,
} from "@/components/competitors/sorting";
import type { OverlapRow } from "@/types/competitor";
import Link from "next/link";

/**
 * The keyword overlap, one row per term per rival.
 *
 * Every column here is a link back to where the fact lives: the keyword opens
 * its own workspace, the cluster opens the cluster workspace, the page of ours
 * opens the Content Studio, and the rival opens its detail page. Nothing in
 * this table is a dead end, because a competitive finding is only useful if
 * you can get to the thing it is about.
 *
 * The keyword itself is never copied. Volume, difficulty, and intent are read
 * from the keyword record, so a number here is the number the Keyword
 * Intelligence module shows for the same term.
 */
export function OverlapTable({
  rows,
  sort,
  onSort,
  /** Hides the competitor column — for a single rival's own workspace. */
  hideCompetitor = false,
}: {
  rows: readonly OverlapRow[];
  sort: { key: OverlapSort; desc: boolean };
  onSort: (key: OverlapSort) => void;
  hideCompetitor?: boolean;
}) {
  return (
    <Table caption="Keyword overlap with positions, rank gap, and opportunity">
      <TableHead>
        <TableRow>
          <SortableHeader
            label="Keyword"
            sortKey="keyword"
            sort={sort}
            onSort={onSort}
            options={OVERLAP_SORT_OPTIONS}
          />
          {!hideCompetitor && <TableHeaderCell>Competitor</TableHeaderCell>}
          <TableHeaderCell>Overlap</TableHeaderCell>
          <TableHeaderCell>State</TableHeaderCell>
          <SortableHeader
            label="Ours"
            sortKey="our-position"
            align="right"
            sort={sort}
            onSort={onSort}
            options={OVERLAP_SORT_OPTIONS}
          />
          <SortableHeader
            label="Theirs"
            sortKey="their-position"
            align="right"
            sort={sort}
            onSort={onSort}
            options={OVERLAP_SORT_OPTIONS}
          />
          <SortableHeader
            label="Gap"
            sortKey="gap"
            align="right"
            sort={sort}
            onSort={onSort}
            options={OVERLAP_SORT_OPTIONS}
          />
          <SortableHeader
            label="Volume"
            sortKey="volume"
            align="right"
            sort={sort}
            onSort={onSort}
            options={OVERLAP_SORT_OPTIONS}
          />
          <SortableHeader
            label="Difficulty"
            sortKey="difficulty"
            align="right"
            sort={sort}
            onSort={onSort}
            options={OVERLAP_SORT_OPTIONS}
          />
          <TableHeaderCell>Intent</TableHeaderCell>
          <TableHeaderCell>Cluster</TableHeaderCell>
          <TableHeaderCell>Our page</TableHeaderCell>
          <TableHeaderCell>Their page</TableHeaderCell>
          <SortableHeader
            label="At stake"
            sortKey="traffic"
            align="right"
            sort={sort}
            onSort={onSort}
            options={OVERLAP_SORT_OPTIONS}
          />
          <SortableHeader
            label="Opportunity"
            sortKey="opportunity"
            align="right"
            sort={sort}
            onSort={onSort}
            options={OVERLAP_SORT_OPTIONS}
          />
        </TableRow>
      </TableHead>

      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell header className="min-w-[180px]">
              <KeywordLink id={row.keywordId} keyword={row.keyword} />
            </TableCell>

            {!hideCompetitor && (
              <TableCell className="max-w-[150px]">
                <CompetitorLink
                  id={row.competitorId}
                  name={row.competitorName}
                  className="truncate font-normal text-fg-muted"
                />
              </TableCell>
            )}

            <TableCell>
              <OverlapBadge overlap={row.overlap} />
            </TableCell>

            <TableCell>
              <BattleBadge battle={row.battle} short />
            </TableCell>

            <TableCell numeric>
              <PositionValue position={row.ourPosition} />
            </TableCell>

            <TableCell numeric>
              <PositionValue position={row.theirPosition} />
            </TableCell>

            <TableCell numeric>
              <RankGap gap={row.rankGap} />
            </TableCell>

            <TableCell numeric>
              <VolumeValue volume={row.volume} />
            </TableCell>

            <TableCell numeric>
              <DifficultyValue difficulty={row.difficulty} />
            </TableCell>

            <TableCell>
              <IntentBadge intent={row.intent} short />
            </TableCell>

            <TableCell className="max-w-[160px]">
              <Link
                href={`/keywords/clusters/${row.clusterId}`}
                className="block truncate text-fg-muted transition-colors hover:text-accent"
                title={row.clusterName}
              >
                {row.clusterName}
              </Link>
            </TableCell>

            <TableCell className="max-w-[170px]">
              {row.ourContentId === null ? (
                <span
                  className="text-[11.5px] text-warning"
                  title="No page of ours targets this term"
                >
                  Nothing of ours
                </span>
              ) : (
                <Link
                  href={`/content/${row.ourContentId}`}
                  className="block truncate font-mono text-[11.5px] text-fg-subtle transition-colors hover:text-accent"
                  title={row.ourUrl ?? "Planned, not published"}
                >
                  {row.ourUrl ?? "Planned"}
                </Link>
              )}
            </TableCell>

            <TableCell className="max-w-[170px]">
              {row.theirUrl === null ? (
                <span className="text-fg-subtle">—</span>
              ) : (
                <CompetitorPageUrl url={row.theirUrl} />
              )}
            </TableCell>

            <TableCell numeric>
              <TrafficValue sessions={row.trafficAtStake} />
            </TableCell>

            <TableCell numeric>
              <OpportunityValue score={row.opportunity} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
