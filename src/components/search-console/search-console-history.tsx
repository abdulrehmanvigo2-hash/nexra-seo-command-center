"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { formatFullDate, formatNumber, formatPercent } from "@/lib/format";
import {
  CONFIDENCE_COPY,
  HISTORY_LIST_LIMIT,
  LIST_UNAVAILABLE_COPY,
  OPPORTUNITY_RULE_COPY,
  describeHistoryStatus,
  historyReadFailure,
  historyUrl,
  type HistoryView,
  type ListView,
  type OpportunityView,
  type RowView,
  type TotalsView,
} from "@/lib/search-console/history/view";
import { PARTIAL_COPY } from "@/lib/search-console/present";

/**
 * Change since the last stored snapshot (milestone M1, phase 4, P4d).
 *
 * Sits inside the Search Console panel, beneath the live report, and reads
 * its own endpoint: the P4a comparison of the project's two newest
 * comparable stored windows, projected server-side. Its load is separate
 * from the live report's, so a failed or empty history never changes what
 * the live panel shows, and the live panel never lends it a figure. A
 * value the comparison could not establish is shown as not established,
 * never as a zero. Nothing here is a control.
 */

type View = "summary" | "queries" | "pages";

type Load =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "loaded"; readonly view: HistoryView };

const date = (iso: string) => formatFullDate(`${iso}T00:00:00Z`);

export function SearchConsoleHistory({ projectId, view }: { projectId: string; view: View }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loading state belongs to this request
    setLoad({ status: "loading" });

    fetch(historyUrl(projectId), { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return setLoad({ status: "failed", message: historyReadFailure(response.status) });
        setLoad({ status: "loaded", view: (await response.json()) as HistoryView });
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setLoad({ status: "failed", message: historyReadFailure(0) });
      });

    return () => controller.abort();
  }, [projectId]);

  return (
    <section className="space-y-3 border-t border-border px-4 py-4 sm:px-5" aria-busy={load.status === "loading"}>
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-xs font-medium text-fg">Change since last stored snapshot</h4>
        <Badge tone="neutral" title="Two 30-day windows this product stored from Search Console, compared by fixed rules. Not the live report above, and not a trend.">
          Stored history
        </Badge>
      </div>

      {load.status === "loading" && <Skeleton className="h-16 w-full" />}

      {load.status === "failed" && (
        <p className="text-sm text-fg-muted" role="status">
          {load.message}
        </p>
      )}

      {load.status === "loaded" &&
        (load.view.status === "available" ? (
          <HistoryBody view={load.view} which={view} />
        ) : (
          <EmptyState size="sm" icon="calendar" title={describeHistoryStatus(load.view).title} description={describeHistoryStatus(load.view).description} />
        ))}
    </section>
  );
}

function HistoryBody({ view, which }: { view: Extract<HistoryView, { status: "available" }>; which: View }) {
  const list = which === "pages" ? view.pages : view.queries;
  const noun = which === "pages" ? "Page" : "Query";
  return (
    <div className="space-y-4">
      <p className="text-xs text-fg-subtle">
        Latest window ends {date(view.latestEndDate)}; previous ends {date(view.previousEndDate)}; {view.gapDays} days apart.{" "}
        <span className={cn(view.confidence === "low" && "text-warning")}>{CONFIDENCE_COPY[view.confidence]}</span>
        {view.historyUnderOtherProperty && " Snapshots recorded under a previous property are set aside."}
      </p>

      {[...view.latestPartial.map((entry) => `Latest window: ${PARTIAL_COPY[entry]}`), ...view.previousPartial.map((entry) => `Previous window: ${PARTIAL_COPY[entry]}`)].map((line) => (
        <p key={line} className="text-xs text-warning">
          {line}
        </p>
      ))}

      {view.totals === null ? (
        <p className="text-sm text-fg-muted" role="status">
          The latest window reported no impressions, so there are no totals to compare.
        </p>
      ) : (
        <TotalsTiles totals={view.totals} />
      )}

      {!list.available ? (
        <p className="text-sm text-fg-muted" role="status">
          {LIST_UNAVAILABLE_COPY[list.reason]}
        </p>
      ) : (
        <ListBody list={list} noun={noun} />
      )}

      <ul className="space-y-1 text-[11.5px] text-fg-subtle">
        {view.caveats.map((caveat) => (
          <li key={caveat}>{caveat}</li>
        ))}
      </ul>
    </div>
  );
}

function TotalsTiles({ totals }: { totals: TotalsView }) {
  const tiles: readonly { readonly label: string; readonly value: string; readonly change: string; readonly improved: boolean | null }[] = [
    {
      label: "Clicks",
      value: formatNumber(totals.clicks.latest),
      change: totals.clicks.percent === null ? `${signed(totals.clicks.absolute)} · no baseline` : `${signed(totals.clicks.absolute)} (${signed(totals.clicks.percent)}%)`,
      improved: totals.clicks.absolute === 0 ? null : totals.clicks.absolute > 0,
    },
    {
      label: "Impressions",
      value: formatNumber(totals.impressions.latest),
      change: totals.impressions.percent === null ? `${signed(totals.impressions.absolute)} · no baseline` : `${signed(totals.impressions.absolute)} (${signed(totals.impressions.percent)}%)`,
      improved: totals.impressions.absolute === 0 ? null : totals.impressions.absolute > 0,
    },
    {
      label: "Click-through rate",
      value: formatPercent(totals.ctr.latest * 100, 2),
      change: `${signed(totals.ctr.points)} points`,
      improved: totals.ctr.points === 0 ? null : totals.ctr.points > 0,
    },
    {
      label: "Average position",
      value: totals.position.latest.toFixed(1),
      change:
        totals.position.delta === null
          ? "Not established: the previous window had no impressions"
          : totals.position.delta === 0
            ? "No change in position"
            : `${totals.position.delta > 0 ? "Up" : "Down"} ${Math.abs(totals.position.delta).toFixed(1)} places`,
      improved: totals.position.delta === null || totals.position.delta === 0 ? null : totals.position.delta > 0,
    },
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((tile) => (
        <div key={tile.label} className="min-w-0 rounded-md border border-border bg-surface-raised px-3 py-2.5">
          <dt className="truncate text-[11.5px] text-fg-subtle">{tile.label}</dt>
          <dd className="tabular mt-1 text-[18px] font-semibold tracking-tight text-fg">{tile.value}</dd>
          <dd className={cn("mt-0.5 text-[11.5px]", tile.improved === true ? "text-positive" : tile.improved === false ? "text-critical" : "text-fg-subtle")} title={tile.change}>
            {tile.change}
          </dd>
        </div>
      ))}
      {totals.previousNoData && (
        <p className="col-span-2 text-[11.5px] text-fg-subtle lg:col-span-4">The previous window reported no impressions: its counts are zero and its position is not established.</p>
      )}
    </dl>
  );
}

const signed = (value: number) => `${value > 0 ? "+" : ""}${formatNumber(value)}`;

function ListBody({ list, noun }: { list: Extract<ListView, { available: true }>; noun: "Query" | "Page" }) {
  const plural = noun === "Query" ? "queries" : "pages";
  return (
    <div className="space-y-4">
      <p className="text-xs text-fg-subtle">
        {list.counts.matched} {plural} in both windows&apos; top lists; {list.counts.appeared} appeared; {list.counts.left} left.
        {list.previousNoData && " The previous window reported no impressions, so every latest row appeared."}
      </p>
      <MovementTable title={`Improving ${plural}`} rows={list.improving} total={list.counts.improving} noun={noun} />
      <MovementTable title={`Declining ${plural}`} rows={list.declining} total={list.counts.declining} noun={noun} />
      <OpportunityTable rows={list.opportunities} total={list.counts.opportunities} noun={noun} plural={plural} />
    </div>
  );
}

function shown(count: number, total: number) {
  return total > count ? `${count} of ${total} shown (top ${HISTORY_LIST_LIMIT} by size of move)` : `${total}`;
}

function MovementTable({ title, rows, total, noun }: { title: string; rows: readonly RowView[]; total: number; noun: "Query" | "Page" }) {
  return (
    <section className="space-y-1.5">
      <h5 className="text-xs font-medium text-fg">
        {title} <span className="font-normal text-fg-subtle">· {shown(rows.length, total)}</span>
      </h5>
      {rows.length === 0 ? (
        <p className="text-xs text-fg-subtle">None met the movement rule (at least one place, with enough impressions in both windows).</p>
      ) : (
        <Table caption={title}>
          <TableHead>
            <TableRow>
              <TableHeaderCell>{noun}</TableHeaderCell>
              <TableHeaderCell align="right">Position</TableHeaderCell>
              <TableHeaderCell align="right">Was</TableHeaderCell>
              <TableHeaderCell align="right">Move</TableHeaderCell>
              <TableHeaderCell align="right">Clicks</TableHeaderCell>
              <TableHeaderCell align="right">Clicks Δ</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell header className="max-w-[28rem] truncate">
                  {row.key}
                </TableCell>
                <TableCell numeric>{row.latest.position.toFixed(1)}</TableCell>
                <TableCell numeric>{row.previousPosition.toFixed(1)}</TableCell>
                <TableCell numeric className={row.positionDelta > 0 ? "text-positive" : "text-critical"}>
                  {row.positionDelta > 0 ? "Up" : "Down"} {Math.abs(row.positionDelta).toFixed(1)}
                </TableCell>
                <TableCell numeric>{formatNumber(row.latest.clicks)}</TableCell>
                <TableCell numeric>{signed(row.clicksAbsolute)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function OpportunityTable({ rows, total, noun, plural }: { rows: readonly OpportunityView[]; total: number; noun: "Query" | "Page"; plural: string }) {
  return (
    <section className="space-y-1.5">
      <h5 className="text-xs font-medium text-fg">
        Opportunities among {plural} <span className="font-normal text-fg-subtle">· {total > rows.length ? `${rows.length} of ${total} shown (top ${HISTORY_LIST_LIMIT} by impressions)` : `${total}`}</span>
      </h5>
      <p className="text-xs text-fg-subtle">{OPPORTUNITY_RULE_COPY}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-fg-subtle">None met the opportunity rule in the latest window.</p>
      ) : (
        <Table caption={`Opportunities among ${plural}`}>
          <TableHead>
            <TableRow>
              <TableHeaderCell>{noun}</TableHeaderCell>
              <TableHeaderCell align="right">Impressions</TableHeaderCell>
              <TableHeaderCell align="right">CTR</TableHeaderCell>
              <TableHeaderCell align="right">Position</TableHeaderCell>
              <TableHeaderCell align="right">Clicks</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell header className="max-w-[28rem] truncate">
                  {row.key}
                </TableCell>
                <TableCell numeric>{formatNumber(row.latest.impressions)}</TableCell>
                <TableCell numeric>{formatPercent(row.latest.ctr * 100, 2)}</TableCell>
                <TableCell numeric>{row.latest.position.toFixed(1)}</TableCell>
                <TableCell numeric>{formatNumber(row.latest.clicks)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
