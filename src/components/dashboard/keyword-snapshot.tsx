"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Meter, StackedMeter, type MeterTone } from "@/components/ui/meter";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import {
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { formatCompact, formatNumber } from "@/lib/format";
import { INTENT_META, INTENT_ORDER } from "@/lib/mock/keywords";
import type {
  KeywordSnapshot as Snapshot,
  KeywordSnapshotRow,
  SearchIntent,
} from "@/types/dashboard";

/**
 * Ranking distribution, movement, and the terms worth looking at now.
 *
 * The table sorts and filters in place. Sorting lives here rather than in the
 * `Table` primitive, which stays presentational — the module owns its data, so
 * it owns the ordering of it too.
 */

const BUCKET_TONE: Record<string, MeterTone> = {
  "top-3": "positive",
  "4-10": "accent",
  "11-20": "neutral",
  "21-50": "warning",
  "51-100": "critical",
};

type SortKey = "keyword" | "position" | "change" | "volume" | "difficulty";
type IntentFilter = SearchIntent | "all";

/** Positions improve as they fall, so a positive change is places gained. */
const changeOf = (row: KeywordSnapshotRow) => row.previousPosition - row.position;

export function KeywordSnapshot({
  snapshot,
  projectId,
}: {
  snapshot: Snapshot;
  /**
   * Scopes the "Open Keyword Intelligence" link to one project, so the module
   * opens already filtered to the keywords this panel is showing. Omitted for
   * the portfolio roll-up, which opens the whole set.
   */
  projectId?: string;
}) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({
    key: "volume",
    desc: true,
  });
  const [intent, setIntent] = useState<IntentFilter>("all");

  const counts = useMemo(() => {
    const tally: Record<string, number> = { all: snapshot.rows.length };
    for (const row of snapshot.rows) {
      tally[row.intent] = (tally[row.intent] ?? 0) + 1;
    }
    return tally;
  }, [snapshot.rows]);

  const rows = useMemo(() => {
    const filtered = intent === "all"
      ? snapshot.rows
      : snapshot.rows.filter((row) => row.intent === intent);

    const direction = sort.desc ? -1 : 1;

    return [...filtered].sort((a, b) => {
      if (sort.key === "keyword") {
        return a.keyword.localeCompare(b.keyword) * direction;
      }
      const value =
        sort.key === "change"
          ? changeOf(a) - changeOf(b)
          : a[sort.key] - b[sort.key];
      return value * direction;
    });
  }, [snapshot.rows, intent, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((current) =>
      current.key === key
        ? { key, desc: !current.desc }
        : { key, desc: key !== "keyword" && key !== "position" },
    );

  const { movement } = snapshot;

  return (
    <Panel>
      <PanelHeader
        eyebrow="Keyword intelligence"
        title="Keyword Performance"
        description={`${formatNumber(snapshot.tracked)} tracked terms · average position ${movement.averagePosition}`}
        actions={
          <Link
            href={
              projectId === undefined || projectId === "portfolio"
                ? "/keywords"
                : `/keywords?project=${projectId}`
            }
            className={buttonClasses("secondary", "sm")}
          >
            Open Keyword Intelligence
            <Icon name="arrow-right" className="h-4 w-4" />
          </Link>
        }
      />

      <PanelBody className="border-b border-border">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div>
            <div className="flex items-baseline justify-between">
              <p className="text-[11px] font-semibold tracking-[0.07em] text-fg-subtle uppercase">
                Ranking distribution
              </p>
              <p className="text-[11.5px] text-fg-subtle">
                Share of ranking keywords
              </p>
            </div>

            <StackedMeter
              className="mt-2.5"
              label="Ranking distribution across position bands"
              segments={snapshot.distribution.map((bucket) => ({
                id: bucket.id,
                value: bucket.count,
                tone: BUCKET_TONE[bucket.id] ?? "neutral",
              }))}
            />

            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {snapshot.distribution.map((bucket) => (
                <li
                  key={bucket.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-raised px-3 py-2"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full",
                        BUCKET_TONE[bucket.id] === "positive" ? "bg-positive"
                        : BUCKET_TONE[bucket.id] === "accent" ? "bg-accent"
                        : BUCKET_TONE[bucket.id] === "warning" ? "bg-warning"
                        : BUCKET_TONE[bucket.id] === "critical" ? "bg-critical"
                        : "bg-fg-subtle",
                      )}
                    />
                    <span className="truncate text-[12px] text-fg-muted">
                      {bucket.label}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-baseline gap-2">
                    <span className="tabular text-[13px] font-semibold text-fg">
                      {formatCompact(bucket.count)}
                    </span>
                    <span
                      className={cn(
                        "tabular text-[11px]",
                        bucket.change > 0 ? "text-positive"
                        : bucket.change < 0 ? "text-critical"
                        : "text-fg-subtle",
                      )}
                    >
                      {bucket.change > 0 ? "+" : bucket.change < 0 ? "−" : ""}
                      {Math.abs(bucket.change)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-[11px] font-semibold tracking-[0.07em] text-fg-subtle uppercase">
              Movement this window
            </p>

            <dl className="mt-2.5 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              <MovementTile label="Winners" value={movement.winners} tone="positive" />
              <MovementTile label="Losers" value={movement.losers} tone="critical" />
              <MovementTile label="New rankings" value={movement.newRankings} tone="positive" />
              <MovementTile label="Lost rankings" value={movement.lostRankings} tone="critical" />
              <MovementTile
                label="Opportunities"
                value={movement.opportunities}
                tone="accent"
              />
              <div className="rounded-md border border-border bg-surface-raised px-3 py-2.5">
                <dt className="text-[11px] text-fg-subtle">Average position</dt>
                <dd className="tabular mt-1 text-[18px] leading-none font-semibold text-fg">
                  {movement.averagePosition}
                </dd>
                <dd className="mt-1.5">
                  <span
                    className={cn(
                      "text-[11px]",
                      movement.averagePositionTrend.value <= 0
                        ? "text-positive"
                        : "text-critical",
                    )}
                  >
                    {movement.averagePositionTrend.value <= 0 ? "Improving" : "Slipping"}
                  </span>
                </dd>
              </div>
            </dl>

            <div className="mt-3 rounded-md border border-border bg-surface-raised px-3 py-2.5">
              <div className="flex items-center justify-between text-[11.5px]">
                <span className="text-fg-subtle">Share of movement that is positive</span>
                <span className="tabular text-fg-muted">
                  {Math.round(
                    (movement.winners /
                      Math.max(movement.winners + movement.losers, 1)) *
                      100,
                  )}
                  %
                </span>
              </div>
              <Meter
                className="mt-2"
                value={
                  (movement.winners /
                    Math.max(movement.winners + movement.losers, 1)) *
                  100
                }
                tone="positive"
                label="Share of keyword movement that is positive"
              />
            </div>
          </div>
        </div>
      </PanelBody>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-border px-4 py-3 sm:px-5">
        <Segmented
          label="Filter keywords by intent"
          value={intent}
          onChange={setIntent}
          options={[
            { value: "all" as const, label: "All intents", count: counts.all },
            ...INTENT_ORDER.filter((entry) => (counts[entry] ?? 0) > 0).map(
              (entry) => ({
                value: entry,
                label: INTENT_META[entry].label,
                count: counts[entry],
              }),
            ),
          ]}
        />
        <p className="text-[11.5px] text-fg-subtle">
          {rows.length} of {snapshot.rows.length} terms
        </p>
      </div>

      <Table caption="Tracked keywords with position, volume, and difficulty">
        <TableHead>
          <TableRow>
            <SortableHeader
              label="Keyword"
              sortKey="keyword"
              sort={sort}
              onSort={toggleSort}
            />
            <TableHeaderCell>Intent</TableHeaderCell>
            <SortableHeader
              label="Position"
              sortKey="position"
              align="right"
              sort={sort}
              onSort={toggleSort}
            />
            <TableHeaderCell align="right">Previous</TableHeaderCell>
            <SortableHeader
              label="Change"
              sortKey="change"
              align="right"
              sort={sort}
              onSort={toggleSort}
            />
            <SortableHeader
              label="Volume"
              sortKey="volume"
              align="right"
              sort={sort}
              onSort={toggleSort}
            />
            <SortableHeader
              label="Difficulty"
              sortKey="difficulty"
              align="right"
              sort={sort}
              onSort={toggleSort}
            />
            <TableHeaderCell>URL</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.length === 0 ? (
            <TableEmptyRow colSpan={8}>
              <EmptyState
                size="sm"
                icon="keywords"
                title="No keywords match this intent"
                description="Clear the intent filter to see the full sample."
              />
            </TableEmptyRow>
          ) : (
            rows.map((row) => {
              const change = changeOf(row);

              return (
                <TableRow key={row.id}>
                  <TableCell header className="max-w-[260px]">
                    <span className="block truncate">{row.keyword}</span>
                  </TableCell>
                  <TableCell>
                    <Badge tone={INTENT_META[row.intent].tone}>
                      {INTENT_META[row.intent].label}
                    </Badge>
                  </TableCell>
                  <TableCell numeric className="font-medium text-fg">
                    {row.position}
                  </TableCell>
                  <TableCell numeric>{row.previousPosition}</TableCell>
                  <TableCell numeric>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 font-medium",
                        change > 0 ? "text-positive"
                        : change < 0 ? "text-critical"
                        : "text-fg-subtle",
                      )}
                    >
                      {change !== 0 && (
                        <Icon
                          name={change > 0 ? "trend-up" : "trend-down"}
                          className="h-3.5 w-3.5"
                        />
                      )}
                      {change > 0 ? "+" : change < 0 ? "−" : ""}
                      {Math.abs(change)}
                    </span>
                  </TableCell>
                  <TableCell numeric>{formatNumber(row.volume)}</TableCell>
                  <TableCell numeric>
                    <span className="inline-flex items-center gap-2">
                      <span className="w-8 text-right">{row.difficulty}</span>
                      <span className="hidden w-14 sm:block">
                        <Meter
                          size="sm"
                          value={row.difficulty}
                          tone={
                            row.difficulty >= 65 ? "critical"
                            : row.difficulty >= 45 ? "warning"
                            : "positive"
                          }
                          label={`Difficulty ${row.difficulty} out of 100`}
                        />
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="max-w-[200px]">
                    <span className="block truncate font-mono text-[11.5px] text-fg-subtle">
                      {row.url}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>

      <PanelFooter>
        <span>A sample of the tracked set — the full universe lives in Keyword Intelligence.</span>
        <span>{formatNumber(movement.opportunities)} opportunities identified</span>
      </PanelFooter>
    </Panel>
  );
}

function MovementTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "positive" | "critical" | "accent";
}) {
  return (
    <div className="rounded-md border border-border bg-surface-raised px-3 py-2.5">
      <dt className="text-[11px] text-fg-subtle">{label}</dt>
      <dd
        className={cn(
          "tabular mt-1 text-[18px] leading-none font-semibold",
          tone === "positive" ? "text-positive"
          : tone === "critical" ? "text-critical"
          : "text-accent",
        )}
      >
        {formatNumber(value)}
      </dd>
    </div>
  );
}

function SortableHeader({
  label,
  sortKey,
  align = "left",
  sort,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  align?: "left" | "right";
  sort: { key: SortKey; desc: boolean };
  onSort: (key: SortKey) => void;
}) {
  const active = sort.key === sortKey;

  return (
    <TableHeaderCell align={align} className="p-0">
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        aria-label={`Sort by ${label}`}
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
