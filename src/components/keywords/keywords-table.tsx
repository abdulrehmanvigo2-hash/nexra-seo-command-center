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
import { cn } from "@/lib/cn";
import { formatCompact } from "@/lib/format";
import { CANNIBALIZATION_RISK_META, SERP_TYPE_META } from "@/lib/mock/keywords";
import {
  ChangeValue,
  DifficultyValue,
  IntentBadge,
  KeywordLink,
  OpportunityValue,
  PositionValue,
  SerpFeatureChips,
  TargetUrl,
  VolumeValue,
} from "@/components/keywords/keyword-chrome";
import {
  KEYWORD_SORT_OPTIONS,
  type KeywordSort,
} from "@/components/keywords/sorting";
import type { CannibalizationRisk, KeywordRecord } from "@/types/keyword";

/**
 * The master keyword table.
 *
 * Wide on purpose. This is the screen an SEO lives in, and the columns are the
 * ones a decision is actually made from — where it ranks, which way it is
 * moving, what it is worth, how hard it is, what the result page looks like,
 * and which page of ours is meant to serve it. The `Table` primitive scrolls
 * horizontally, so nothing is dropped to fit a narrow screen; the keyword
 * column stays first so a row is always identifiable while scrolling across.
 *
 * Selection lives with the workspace rather than here, because bulk actions
 * have to survive a filter change and a page change.
 */

const COLUMNS = 14;

export function KeywordsTable({
  records,
  sort,
  onSort,
  selected,
  onToggle,
  onToggleAll,
  risk,
  reviewed,
}: {
  records: readonly KeywordRecord[];
  sort: { key: KeywordSort; desc: boolean };
  onSort: (key: KeywordSort) => void;
  /** Ids selected for a bulk action. */
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  /** Selects or clears every row currently on screen. */
  onToggleAll: (ids: readonly string[], select: boolean) => void;
  risk: ReadonlyMap<string, CannibalizationRisk>;
  /** Ids marked reviewed in this session. */
  reviewed: ReadonlySet<string>;
}) {
  const ids = records.map((record) => record.id);
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
  const someSelected = ids.some((id) => selected.has(id));

  return (
    <Table caption="Keywords with position, volume, difficulty, and opportunity score">
      <TableHead>
        <TableRow>
          <TableHeaderCell className="w-9 pr-0">
            <label className="flex cursor-pointer items-center justify-center">
              <span className="sr-only">
                {allSelected
                  ? "Clear selection on this page"
                  : "Select every keyword on this page"}
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

          <SortableHeader label="Keyword" sortKey="keyword" sort={sort} onSort={onSort} />
          <TableHeaderCell>Intent</TableHeaderCell>
          <SortableHeader label="Pos." sortKey="position" align="right" sort={sort} onSort={onSort} />
          <TableHeaderCell align="right">Prev.</TableHeaderCell>
          <SortableHeader label="Change" sortKey="change" align="right" sort={sort} onSort={onSort} />
          <SortableHeader label="Volume" sortKey="volume" align="right" sort={sort} onSort={onSort} />
          <SortableHeader label="Diff." sortKey="difficulty" align="right" sort={sort} onSort={onSort} />
          <SortableHeader label="CPC" sortKey="commercial" align="right" sort={sort} onSort={onSort} />
          <SortableHeader label="Potential" sortKey="traffic" align="right" sort={sort} onSort={onSort} />
          <TableHeaderCell>SERP</TableHeaderCell>
          <TableHeaderCell>Target page</TableHeaderCell>
          <TableHeaderCell>Cluster</TableHeaderCell>
          <SortableHeader
            label="Opportunity"
            sortKey="opportunity"
            align="right"
            sort={sort}
            onSort={onSort}
          />
        </TableRow>
      </TableHead>

      <TableBody>
        {records.map((record) => {
          const cannibalized = risk.get(record.id);
          const isSelected = selected.has(record.id);

          return (
            <TableRow
              key={record.id}
              className={cn(isSelected && "bg-accent-soft/30")}
            >
              <TableCell className="pr-0">
                <label className="flex cursor-pointer items-center justify-center">
                  <span className="sr-only">Select {record.keyword}</span>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggle(record.id)}
                    className="h-3.5 w-3.5 cursor-pointer accent-accent"
                  />
                </label>
              </TableCell>

              <TableCell header className="max-w-[280px] min-w-[200px]">
                <span className="flex items-center gap-2">
                  <KeywordLink
                    id={record.id}
                    keyword={record.keyword}
                    className="truncate"
                  />
                  {/*
                    `Icon` renders an `aria-hidden` glyph and takes no label of
                    its own, so the meaning is carried by a wrapper: a `title`
                    for pointer users and a screen-reader-only word beside it.
                    A row marker that only existed visually would leave a
                    cannibalised keyword indistinguishable from a clean one.
                  */}
                  {reviewed.has(record.id) && (
                    <span
                      className="shrink-0 text-positive"
                      title="Marked reviewed in this session"
                    >
                      <Icon name="check" className="h-3.5 w-3.5" />
                      <span className="sr-only">Marked reviewed</span>
                    </span>
                  )}
                  {cannibalized && (
                    <span
                      className={cn(
                        "shrink-0",
                        cannibalized === "critical" || cannibalized === "high"
                          ? "text-critical"
                          : "text-warning",
                      )}
                      title={`Cannibalisation risk: ${CANNIBALIZATION_RISK_META[cannibalized].label}`}
                    >
                      <Icon name="split" className="h-3.5 w-3.5" />
                      <span className="sr-only">
                        Cannibalisation risk:{" "}
                        {CANNIBALIZATION_RISK_META[cannibalized].label}
                      </span>
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block truncate text-[11px] font-normal text-fg-subtle">
                  {record.projectName}
                </span>
              </TableCell>

              <TableCell>
                <IntentBadge intent={record.intent} short />
              </TableCell>

              <TableCell numeric>
                <PositionValue position={record.position} />
              </TableCell>

              <TableCell numeric className="text-fg-subtle">
                {record.previousPosition ?? "—"}
              </TableCell>

              <TableCell numeric>
                <ChangeValue change={record.change} />
              </TableCell>

              <TableCell numeric>
                <VolumeValue volume={record.volume} />
              </TableCell>

              <TableCell numeric>
                <DifficultyValue difficulty={record.difficulty} />
              </TableCell>

              <TableCell numeric>${record.cpc.toFixed(2)}</TableCell>

              <TableCell numeric>
                <span title="Estimated monthly sessions at the target position">
                  {formatCompact(record.trafficPotential)}
                </span>
              </TableCell>

              <TableCell>
                <span className="flex flex-col gap-1">
                  <Badge tone="neutral">
                    {SERP_TYPE_META[record.serpType].label}
                  </Badge>
                  <SerpFeatureChips features={record.serpFeatures} />
                </span>
              </TableCell>

              <TableCell className="max-w-[190px]">
                <TargetUrl url={record.targetUrl} />
              </TableCell>

              <TableCell className="max-w-[170px]">
                <Link
                  href={`/keywords/clusters/${record.clusterId}`}
                  className="block truncate text-fg-muted transition-colors hover:text-accent"
                >
                  {record.clusterName}
                </Link>
              </TableCell>

              <TableCell numeric>
                <OpportunityValue score={record.opportunity.score} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export const KEYWORD_TABLE_COLUMNS = COLUMNS;

function SortableHeader({
  label,
  sortKey,
  align = "left",
  sort,
  onSort,
}: {
  label: string;
  sortKey: KeywordSort;
  align?: "left" | "right";
  sort: { key: KeywordSort; desc: boolean };
  onSort: (key: KeywordSort) => void;
}) {
  const active = sort.key === sortKey;
  const full =
    KEYWORD_SORT_OPTIONS.find((option) => option.value === sortKey)?.label ??
    label;

  return (
    <TableHeaderCell align={align} className="p-0">
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
