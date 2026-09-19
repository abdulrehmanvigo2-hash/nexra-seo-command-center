"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableSkeletonRows,
} from "@/components/ui/table";
import { formatNumber } from "@/lib/format";
import {
  PAGE_STATE_LABEL,
  PAGE_STATE_TONE,
  SIGNALS_SCOPE_NOTE,
  SIGNAL_STATE_META,
  describePageOutcome,
  summariseSignals,
} from "@/lib/crawl/present";
import type { Crawl, CrawlPage, StoredPageSignals } from "@/types/crawl";

/**
 * What the crawl read out of each page.
 *
 * Every number here is a count of stored rows, and the two title figures are
 * observations rather than findings: a missing title is reported as a missing
 * title, not as an issue, a severity or a lost point of a score. Nothing on
 * this panel is weighted, and nothing recommends anything.
 *
 * Not polled. The crawl panel above already polls the crawl's one status row
 * while a pass runs, and a second poll over a few hundred signal rows would
 * cost far more than it showed. Instead that panel reports its progress, and
 * `progress` changing is what re-reads this one — so a pass that fetches its
 * pages while this panel is open fills it in, rather than leaving it saying
 * nothing has been read until someone presses Refresh.
 */

/** Rows rendered. A crawl holds at most a few hundred; the table shows a slice. */
const MAX_ROWS = 100;

type Load =
  | { readonly status: "loading" }
  | {
      readonly status: "loaded";
      readonly crawl: Crawl | null;
      readonly signals: readonly StoredPageSignals[];
      readonly unread: readonly CrawlPage[];
    }
  | { readonly status: "failed"; readonly message: string };

const FAILED_TO_READ = "These readings could not be loaded. Reload the page to try again.";

function messageForStatus(status: number): string {
  if (status === 401) return "Your session has ended. Reload the page to sign in again.";
  if (status === 429) return "Too many requests just now. Wait a moment and try again.";
  if (status === 503) return "This deployment does not store crawls, so there is nothing to read.";
  return FAILED_TO_READ;
}

/** The part of a URL worth showing in a dense table; the full URL is the title. */
function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

export function CrawlSignalsPanel({
  projectId,
  progress = 0,
}: {
  readonly projectId: string;
  /**
   * A number the crawl panel changes whenever the pass advances. Its value
   * means nothing; that it changed means there is more to read.
   */
  readonly progress?: number;
}) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [reloading, setReloading] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const read = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/crawls/signals?project=${encodeURIComponent(projectId)}`,
        { cache: "no-store" },
      );
      if (!alive.current) return;
      if (!response.ok) {
        setLoad({ status: "failed", message: messageForStatus(response.status) });
        return;
      }
      const body = (await response.json()) as {
        crawl: Crawl | null;
        signals: readonly StoredPageSignals[];
        unread?: readonly CrawlPage[];
      };
      if (!alive.current) return;
      setLoad({
        status: "loaded",
        crawl: body.crawl,
        signals: body.signals,
        unread: body.unread ?? [],
      });
    } catch {
      if (alive.current) setLoad({ status: "failed", message: FAILED_TO_READ });
    }
  }, [projectId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the first read belongs to this mount, as in the crawl panel above
    void read();
  }, [read, progress]);

  const refresh = async () => {
    if (reloading) return;
    setReloading(true);
    await read();
    if (alive.current) setReloading(false);
  };

  const signals = load.status === "loaded" ? load.signals : [];
  const unread = load.status === "loaded" ? load.unread : [];
  const summary = summariseSignals(signals);
  const rows = signals.slice(0, MAX_ROWS);

  return (
    <Panel aria-busy={load.status === "loading" || reloading || undefined}>
      <PanelHeader
        eyebrow="On-page signals"
        title="What each page says about itself"
        description="Titles, headings, word counts and link counts, read from the HTML the crawl fetched. Observations only — nothing here is scored or turned into a recommendation."
        actions={
          <Button
            variant="secondary"
            icon="refresh"
            onClick={refresh}
            disabled={load.status === "loading" || reloading}
          >
            {reloading ? "Refreshing" : "Refresh"}
          </Button>
        }
      />

      {load.status === "loading" ? (
        <div className="space-y-3 px-4 py-4 sm:px-5">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-4 w-full max-w-72" />
        </div>
      ) : load.status === "failed" ? (
        <EmptyState
          size="sm"
          icon="alert"
          title="Readings not available"
          description={load.message}
        />
      ) : summary.pages === 0 ? (
        <EmptyState
          size="sm"
          icon="pages"
          title="No pages have been read yet"
          description={
            load.crawl === null
              ? "Start a crawl above. Once its pages are fetched, what each one says about itself appears here."
              : "This crawl has not fetched a page whose HTML could be read. Nothing is inferred in the meantime."
          }
        />
      ) : (
        <>
          <div className="px-4 py-4 sm:px-5">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Reading label="Pages read" value={formatNumber(summary.pages)} />
              <Reading label="Parsed" value={formatNumber(summary.states.parsed)} />
              <Reading label="Not HTML" value={formatNumber(summary.states["not-html"])} />
              <Reading label="Empty" value={formatNumber(summary.states.empty)} />
              <Reading label="Unreadable" value={formatNumber(summary.states.failed)} />
            </dl>

            <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Reading
                label="No title"
                value={formatNumber(summary.missingTitle)}
                note="Parsed pages carrying no title."
              />
              <Reading
                label="Shared titles"
                value={formatNumber(summary.duplicateTitlePages)}
                note={
                  summary.duplicateTitles === 0
                    ? "No two parsed pages share a title."
                    : `Parsed pages sharing ${formatNumber(summary.duplicateTitles)} ${
                        summary.duplicateTitles === 1 ? "title" : "titles"
                      } between them.`
                }
              />
            </dl>
          </div>

          <Table caption="Pages read by the latest crawl">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Page</TableHeaderCell>
                <TableHeaderCell>Read as</TableHeaderCell>
                <TableHeaderCell>Title</TableHeaderCell>
                <TableHeaderCell align="right">Words</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {reloading ? (
                <TableSkeletonRows columns={4} />
              ) : (
                rows.map((page) => {
                  const meta = SIGNAL_STATE_META[page.state];
                  const title = page.title?.trim() ?? "";
                  return (
                    <TableRow key={page.url}>
                      <TableCell header className="max-w-[22rem] truncate">
                        <span title={page.url}>{pathOf(page.url)}</span>
                      </TableCell>
                      <TableCell>
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      </TableCell>
                      <TableCell className="max-w-[26rem] truncate">
                        {title.length > 0 ? (
                          <span title={title}>{title}</span>
                        ) : (
                          <span className="text-fg-subtle">
                            {page.state === "parsed" ? "No title" : "—"}
                          </span>
                        )}
                      </TableCell>
                      <TableCell numeric>
                        {page.wordCount === null ? (
                          <span className="text-fg-subtle">—</span>
                        ) : (
                          formatNumber(page.wordCount)
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </>
      )}

      {unread.length > 0 && (
        <>
          <div className="border-t border-border px-4 pt-4 pb-1">
            <h3 className="text-[13px] font-semibold text-fg">
              Pages not read ({formatNumber(unread.length)})
            </h3>
            <p className="mt-1 text-[12px] leading-snug text-fg-subtle">
              Discovered, but no on-page signals came from them. The reason is the one the
              crawl recorded at the time.
            </p>
          </div>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Page</TableHeaderCell>
                <TableHeaderCell>State</TableHeaderCell>
                <TableHeaderCell>Reason</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {unread.slice(0, MAX_ROWS).map((page) => (
                <TableRow key={page.url}>
                  <TableCell>
                    <span className="block max-w-[22rem] truncate" title={page.url}>
                      {pathOf(page.url)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge tone={PAGE_STATE_TONE[page.state]}>
                      {PAGE_STATE_LABEL[page.state]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="block max-w-[26rem] text-fg-muted">
                      {describePageOutcome(page)}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}

      <PanelFooter>
        <span>
          {summary.pages > MAX_ROWS
            ? `Showing the first ${formatNumber(MAX_ROWS)} of ${formatNumber(summary.pages)} pages read.`
            : "Read from this site's own pages, not modelled."}
        </span>
        <span className="max-w-xl">{SIGNALS_SCOPE_NOTE}</span>
      </PanelFooter>
    </Panel>
  );
}

function Reading({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-surface-raised px-3 py-2.5">
      <dt className="truncate text-[11.5px] text-fg-subtle">{label}</dt>
      <dd className="tabular mt-1 text-[18px] leading-none font-semibold text-fg">{value}</dd>
      {note && <p className="mt-1.5 text-[11px] leading-snug text-fg-subtle">{note}</p>}
    </div>
  );
}
