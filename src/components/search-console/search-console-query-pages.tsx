"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { formatFullDate, formatNumber, formatPercent } from "@/lib/format";
import {
  CHANGE_CONFIDENCE_COPY,
  NO_CHANGE_COPY,
  describeQueryPageStatus,
  queryPagesReadFailure,
  queryPagesUrl,
  type ChangeView,
  type OverlapView,
  type QueryPageView,
} from "@/lib/search-console/query-pages/view";

/**
 * Query-to-page overlap (milestone M1, phase 4, P4c).
 *
 * Sits inside the Search Console panel beneath the stored history and reads
 * its own endpoint: the project's stored query × page pairs for its newest
 * window, analysed server-side by fixed rules, and the change against the
 * newest eligible earlier window. Its load is separate from the live
 * report's, so a failed or empty read never changes what the live panel
 * shows. Every label is an observation for review — "potential query
 * overlap", "cannibalization candidate for review", "leading page" — and
 * the caveats beneath say what none of them is. Nothing here is a control.
 */

type Load =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "loaded"; readonly view: QueryPageView };

const date = (iso: string) => formatFullDate(`${iso}T00:00:00Z`);
const signed = (value: number) => `${value > 0 ? "+" : ""}${formatNumber(value)}`;

export function SearchConsoleQueryPages({ projectId }: { projectId: string }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loading state belongs to this request
    setLoad({ status: "loading" });

    fetch(queryPagesUrl(projectId), { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return setLoad({ status: "failed", message: queryPagesReadFailure(response.status) });
        setLoad({ status: "loaded", view: (await response.json()) as QueryPageView });
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setLoad({ status: "failed", message: queryPagesReadFailure(0) });
      });

    return () => controller.abort();
  }, [projectId]);

  return (
    <section className="space-y-3 border-t border-border px-4 py-4 sm:px-5" aria-busy={load.status === "loading"}>
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-xs font-medium text-fg">Query-to-page overlap</h4>
        <Badge tone="neutral" title="Query × page rows this product stored from Search Console, analysed by fixed rules. Observations for review, not findings.">
          Stored pairs
        </Badge>
      </div>

      {load.status === "loading" && <Skeleton className="h-16 w-full" />}

      {load.status === "failed" && (
        <p className="text-sm text-fg-muted" role="status">
          {load.message}
        </p>
      )}

      {load.status === "loaded" &&
        (load.view.status === "overlaps" ? (
          <OverlapBody view={load.view} />
        ) : (
          <>
            <EmptyState size="sm" icon="search" title={describeQueryPageStatus(load.view).title} description={describeQueryPageStatus(load.view).description} />
            {load.view.status === "no-overlap" && <Caveats caveats={load.view.caveats} />}
          </>
        ))}
    </section>
  );
}

function OverlapBody({ view }: { view: Extract<QueryPageView, { status: "overlaps" }> }) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-fg-subtle">
        Window {date(view.startDate)} to {date(view.endDate)}: {formatNumber(view.pairs)} stored pairs over {formatNumber(view.queries)} queries and {formatNumber(view.pageTotal)} pages.{" "}
        {view.counts.overlaps} potential query overlap{view.counts.overlaps === 1 ? "" : "s"}, {view.counts.candidates} cannibalization candidate{view.counts.candidates === 1 ? "" : "s"} for review.
        {view.underOtherProperty && " Rows recorded under a previous property are set aside."}
      </p>

      <section className="space-y-1.5">
        <h5 className="text-xs font-medium text-fg">
          Potential query overlaps{" "}
          <span className="font-normal text-fg-subtle">· {view.counts.overlaps > view.overlaps.length ? `${view.overlaps.length} of ${view.counts.overlaps} shown (by the query's impressions)` : `${view.counts.overlaps}`}</span>
        </h5>
        <ul className="space-y-3">
          {view.overlaps.map((overlap) => (
            <OverlapItem key={overlap.query} overlap={overlap} />
          ))}
        </ul>
      </section>

      {view.concentration.length > 0 && (
        <section className="space-y-1.5">
          <h5 className="text-xs font-medium text-fg">Page concentration</h5>
          <p className="text-xs text-fg-subtle">Pages shown most for the overlapping queries they appear under.</p>
          <Table caption="Page concentration">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Page</TableHeaderCell>
                <TableHeaderCell align="right">Leads</TableHeaderCell>
                <TableHeaderCell align="right">Appears under</TableHeaderCell>
                <TableHeaderCell align="right">Impressions</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {view.concentration.map((row) => (
                <TableRow key={row.page}>
                  <TableCell header className="max-w-[28rem] truncate">
                    {row.page}
                  </TableCell>
                  <TableCell numeric>{row.overlapsLed}</TableCell>
                  <TableCell numeric>{row.overlaps}</TableCell>
                  <TableCell numeric>{formatNumber(row.impressions)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}

      {view.change === null ? (
        <p className="text-xs text-fg-subtle" role="status">
          {NO_CHANGE_COPY}
        </p>
      ) : (
        <ChangeBody change={view.change} />
      )}

      <Caveats caveats={view.caveats} />
    </div>
  );
}

function OverlapItem({ overlap }: { overlap: OverlapView }) {
  return (
    <li className="space-y-1.5 rounded-md border border-border bg-surface-raised px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 truncate text-sm font-medium text-fg" title={overlap.query}>
          {overlap.query}
        </span>
        {overlap.candidate ? (
          <Badge tone="warning" title={`${overlap.meaningfulPages} pages with meaningful impressions, average positions ${overlap.positionGap?.toFixed(1)} places apart. A label for review, not a finding.`}>
            Cannibalization candidate for review
          </Badge>
        ) : (
          <Badge tone="neutral" title="One query reported on more than one page. An observation, not a finding.">
            Potential query overlap
          </Badge>
        )}
        <span className="text-[11.5px] text-fg-subtle">
          {overlap.pageCount} pages · {formatNumber(overlap.impressions)} impressions · {formatNumber(overlap.clicks)} clicks
          {overlap.pages.length < overlap.pageCount && ` · ${overlap.pages.length} of ${overlap.pageCount} pages shown`}
        </span>
      </div>
      <Table caption={`Pages shown for ${overlap.query}`}>
        <TableHead>
          <TableRow>
            <TableHeaderCell>Page</TableHeaderCell>
            <TableHeaderCell align="right">Impressions</TableHeaderCell>
            <TableHeaderCell align="right">Share</TableHeaderCell>
            <TableHeaderCell align="right">Clicks</TableHeaderCell>
            <TableHeaderCell align="right">CTR</TableHeaderCell>
            <TableHeaderCell align="right">Position</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {overlap.pages.map((page) => (
            <TableRow key={page.page}>
              <TableCell header className={cn("max-w-[28rem] truncate", page.leading && "font-medium")}>
                {page.page}
                {page.leading && <span className="ml-1.5 text-[11px] font-normal text-fg-subtle">leading page</span>}
              </TableCell>
              <TableCell numeric>{formatNumber(page.impressions)}</TableCell>
              <TableCell numeric>{formatPercent(page.share * 100, 1)}</TableCell>
              <TableCell numeric>{formatNumber(page.clicks)}</TableCell>
              <TableCell numeric>{formatPercent(page.ctr * 100, 2)}</TableCell>
              <TableCell numeric>{page.position.toFixed(1)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </li>
  );
}

function ChangeBody({ change }: { change: ChangeView }) {
  const shown = (count: number, total: number) => (total > count ? `${count} of ${total}` : `${total}`);
  return (
    <section className="space-y-2">
      <h5 className="text-xs font-medium text-fg">Change since the previous stored window</h5>
      <p className="text-xs text-fg-subtle">
        Previous window ends {date(change.previousEndDate)}, {change.gapDays} days earlier; {change.matched} overlapping {change.matched === 1 ? "query" : "queries"} in both.{" "}
        <span className={cn(change.confidence === "low" && "text-warning")}>{CHANGE_CONFIDENCE_COPY[change.confidence]}</span>
      </p>
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <ChangeList title={`Overlaps that appeared · ${shown(change.appeared.length, change.counts.appeared)}`} empty="None appeared." items={change.appeared.map((r) => `${r.query} — ${r.pageCount} pages, ${formatNumber(r.impressions)} impressions`)} />
        <ChangeList title={`Overlaps no longer observed · ${shown(change.disappeared.length, change.counts.disappeared)}`} empty="None disappeared." items={change.disappeared.map((r) => `${r.query} — was on ${r.pageCount} pages, ${formatNumber(r.impressions)} impressions`)} />
        <ChangeList title={`Leading page changed · ${shown(change.leaderChanged.length, change.counts.leaderChanged)}`} empty="No leading page changed." items={change.leaderChanged.map((r) => `${r.query}: ${r.previousLeadingPage} → ${r.latestLeadingPage}`)} />
        <ChangeList title={`Impressions changed · ${shown(change.impressionsChanged.length, change.counts.impressionsChanged)}`} empty="No overlapping query moved by the change rule." items={change.impressionsChanged.map((r) => `${r.query}: ${formatNumber(r.previous)} → ${formatNumber(r.latest)} (${signed(r.absolute)})`)} />
      </dl>
    </section>
  );
}

function ChangeList({ title, items, empty }: { title: string; items: readonly string[]; empty: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-surface-raised px-3 py-2.5">
      <dt className="text-[11.5px] font-medium text-fg">{title}</dt>
      {items.length === 0 ? (
        <dd className="mt-1 text-[11.5px] text-fg-subtle">{empty}</dd>
      ) : (
        <dd className="mt-1 space-y-0.5">
          {items.map((item) => (
            <p key={item} className="truncate text-[11.5px] text-fg-muted" title={item}>
              {item}
            </p>
          ))}
        </dd>
      )}
    </div>
  );
}

function Caveats({ caveats }: { caveats: readonly string[] }) {
  return (
    <ul className="space-y-1 text-[11.5px] text-fg-subtle">
      {caveats.map((caveat) => (
        <li key={caveat}>{caveat}</li>
      ))}
    </ul>
  );
}
