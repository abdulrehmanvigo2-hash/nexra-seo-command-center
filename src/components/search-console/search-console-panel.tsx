"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
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
} from "@/components/ui/table";
import { QueuedReview, useQueuedReview } from "@/components/agent-runs/queued-review";
import { PERFORMANCE_REVIEW, SEARCH_QUERY_REVIEW, searchQueryReviewRequest } from "@/lib/crawl/review-request";
import { formatFullDate, formatNumber, formatPercent } from "@/lib/format";
import {
  PARTIAL_COPY,
  SEARCH_CONSOLE_SCOPE_NOTE,
  describeUnconnected,
  performanceChange,
  type PerformanceMetric,
} from "@/lib/search-console/present";
import { cn } from "@/lib/cn";
import type { RangeId } from "@/types/dashboard";
import type {
  SearchConsoleReport,
  SearchConsoleWindow,
  SearchPerformanceRow,
} from "@/types/search-console";

/**
 * Observed Search Console data, beside — never mixed into — the modelled
 * figures on the same screen.
 *
 * The panel fetches after hydration from the server route, which holds the
 * credentials, so the statically rendered page is the same for every
 * operator and no Google data or key ever sits in the page's HTML. It carries
 * its own source label and window, and every state that is not "connected"
 * says why, without borrowing a number from anywhere else.
 */

type View = "summary" | "queries" | "pages";

type Load =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly report: SearchConsoleReport }
  | { readonly status: "failed"; readonly message: string };

const COPY: Readonly<Record<View, { title: string; description: string }>> = {
  summary: {
    title: "Search performance",
    description: "Clicks, impressions, click-through rate and average position, as Google observed them.",
  },
  queries: {
    title: "Top search queries",
    description: "The queries that earned the most clicks, as Google observed them.",
  },
  pages: {
    title: "Top pages in search",
    description: "The pages that earned the most clicks, as Google observed them.",
  },
};

function useSearchConsoleReport(projectId: string | null, rangeId: RangeId): Load | null {
  const [load, setLoad] = useState<Load | null>(null);

  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loading state belongs to this request
    setLoad({ status: "loading" });

    fetch(
      `/api/search-console/report?project=${encodeURIComponent(projectId)}&range=${encodeURIComponent(rangeId)}`,
      { cache: "no-store", signal: controller.signal },
    )
      .then(async (response) => {
        if (response.status === 401) {
          setLoad({ status: "failed", message: "Your session has ended. Reload the page to sign in again." });
          return;
        }
        if (!response.ok) {
          setLoad({ status: "failed", message: "Search Console data could not be loaded for this project." });
          return;
        }
        setLoad({ status: "loaded", report: (await response.json()) as SearchConsoleReport });
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setLoad({ status: "failed", message: "Search Console data could not be loaded. Check your connection." });
      });

    return () => controller.abort();
  }, [projectId, rangeId]);

  return projectId ? load : null;
}

const windowLabel = (window: SearchConsoleWindow) =>
  `${formatFullDate(`${window.startDate}T00:00:00Z`)} – ${formatFullDate(`${window.endDate}T00:00:00Z`)}`;

export function SearchConsolePanel({
  projectId,
  rangeId,
  view,
}: {
  /** Null when the screen is scoped to more than one project. */
  projectId: string | null;
  rangeId: RangeId;
  view: View;
}) {
  const load = useSearchConsoleReport(projectId, rangeId);
  const report = load?.status === "loaded" ? load.report : null;
  const connected = report?.state === "connected" ? report : null;

  /**
   * The Keyword & Search Intent agent's review of this window. The run belongs
   * to one project and one window, so it is dropped when either changes; the
   * agent reads the same report this panel shows, on the server, at run time.
   */
  const review = useQueuedReview(
    searchQueryReviewRequest(projectId, report, rangeId),
    projectId ? `${projectId}:${rangeId}` : null,
    SEARCH_QUERY_REVIEW,
    projectId,
  );

  /**
   * The Analytics & Learning agent's review of the same window, as a
   * measurement. Its own run, dropped on the same change of project or window,
   * so one agent's result is never shown under the other's heading.
   */
  const performance = useQueuedReview(
    searchQueryReviewRequest(projectId, report, rangeId, PERFORMANCE_REVIEW),
    projectId ? `${projectId}:${rangeId}` : null,
    PERFORMANCE_REVIEW,
    projectId,
  );

  return (
    <Panel aria-busy={load?.status === "loading" || undefined}>
      <PanelHeader
        eyebrow="Google Search Console"
        title={COPY[view].title}
        description={COPY[view].description}
        actions={
          connected ? (
            <Badge
              tone={connected.stale ? "warning" : "positive"}
              dot
              title={
                connected.stale
                  ? "Google could not be reached, so this is the last answer it gave."
                  : "Observed data read from Search Console."
              }
            >
              {connected.stale ? "Observed · stale" : "Observed"}
            </Badge>
          ) : (
            <Badge tone="neutral" title="No observed search data is shown in this panel.">
              Not observed
            </Badge>
          )
        }
      />

      {!projectId ? (
        <EmptyState
          size="sm"
          icon="globe"
          title="Choose a single project"
          description="Search Console reports one property at a time, so it is shown when one project is selected."
        />
      ) : !load || load.status === "loading" ? (
        <div className="space-y-3 px-4 py-4 sm:px-5">
          <Skeleton className="h-4 w-full max-w-72" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : load.status === "failed" ? (
        <EmptyState size="sm" icon="alert" title="Search Console data not loaded" description={load.message} />
      ) : report && report.state !== "connected" ? (
        <UnconnectedBody report={report} />
      ) : !connected ? null : view === "summary" ? (
        <SummaryBody report={connected} />
      ) : (
        <RowsBody
          rows={view === "queries" ? connected.queries : connected.pages}
          unavailable={connected.partial.includes(view === "queries" ? "queries-unavailable" : "pages-unavailable")}
          noun={view === "queries" ? "Query" : "Page"}
        />
      )}

      {/* Offered where the queries are the subject — beside the summary and
          the query list, not the page list, which neither review reads. */}
      {projectId && view !== "pages" && load?.status === "loaded" && (
        <div className="space-y-4 px-4 pb-4 sm:px-5">
          <QueuedReview review={SEARCH_QUERY_REVIEW} projectId={projectId} {...review} />
          <QueuedReview review={PERFORMANCE_REVIEW} projectId={projectId} {...performance} />
        </div>
      )}

      <PanelFooter>
        <span>
          {report && (report.state === "connected" || report.state === "no-data")
            ? `Search Console, ${report.property}, ${windowLabel(report.window)} (final data, Pacific time).`
            : "Observed data from Search Console appears here once a property is connected."}
        </span>
        <span className="max-w-xl">{SEARCH_CONSOLE_SCOPE_NOTE}</span>
      </PanelFooter>
    </Panel>
  );
}

function UnconnectedBody({
  report,
}: {
  report: Exclude<SearchConsoleReport, { state: "connected" }>;
}) {
  const message = describeUnconnected(report);
  return (
    <EmptyState
      size="sm"
      icon={message.tone === "neutral" ? "link-off" : "alert"}
      title={message.title}
      description={message.description}
    />
  );
}

const METRICS: readonly { id: PerformanceMetric; label: string }[] = [
  { id: "clicks", label: "Clicks" },
  { id: "impressions", label: "Impressions" },
  { id: "ctr", label: "Click-through rate" },
  { id: "position", label: "Average position" },
];

function formatMetric(metric: PerformanceMetric, value: number): string {
  if (metric === "ctr") return formatPercent(value * 100, 2);
  if (metric === "position") return value.toFixed(1);
  return formatNumber(value);
}

function SummaryBody({ report }: { report: Extract<SearchConsoleReport, { state: "connected" }> }) {
  return (
    <div className="px-4 py-4 sm:px-5">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {METRICS.map((metric) => {
          const change = performanceChange(metric.id, report.totals, report.previousTotals);
          return (
            <div key={metric.id} className="min-w-0 rounded-md border border-border bg-surface-raised px-3 py-2.5">
              <dt className="truncate text-[11.5px] text-fg-subtle">{metric.label}</dt>
              <dd className="tabular mt-1 text-[18px] font-semibold tracking-tight text-fg">
                {formatMetric(metric.id, report.totals[metric.id])}
              </dd>
              <dd
                className={cn(
                  "mt-0.5 truncate text-[11.5px]",
                  change?.improved === true
                    ? "text-positive"
                    : change?.improved === false
                      ? "text-critical"
                      : "text-fg-subtle",
                )}
              >
                {change === null
                  ? "No comparison"
                  : change.unit === "places"
                    ? change.value === 0
                      ? "No change in position"
                      : `${change.value > 0 ? "Up" : "Down"} ${Math.abs(change.value).toFixed(1)} places`
                    : `${change.value > 0 ? "+" : ""}${change.value.toFixed(1)}% vs previous ${report.window.days} days`}
              </dd>
            </div>
          );
        })}
      </dl>
      {report.partial.filter((entry) => entry.startsWith("comparison")).map((entry) => (
        <p key={entry} className="mt-3 text-[11.5px] text-fg-subtle">
          {PARTIAL_COPY[entry]}
        </p>
      ))}
    </div>
  );
}

function RowsBody({
  rows,
  unavailable,
  noun,
}: {
  rows: readonly SearchPerformanceRow[];
  unavailable: boolean;
  noun: "Query" | "Page";
}) {
  if (unavailable) {
    return (
      <EmptyState
        size="sm"
        icon="alert"
        title={`${noun === "Query" ? "Queries" : "Pages"} not available`}
        description={`Google did not return the top ${noun === "Query" ? "queries" : "pages"} for this window. No rows are shown in their place.`}
      />
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        size="sm"
        title={`No ${noun === "Query" ? "queries" : "pages"} reported`}
        description="Search Console returned no rows for this window. Queries Google anonymises are never listed individually."
      />
    );
  }
  return (
    <Table caption={`Top ${noun === "Query" ? "queries" : "pages"} from Search Console`}>
      <TableHead>
        <TableRow>
          <TableHeaderCell>{noun}</TableHeaderCell>
          <TableHeaderCell align="right">Clicks</TableHeaderCell>
          <TableHeaderCell align="right">Impressions</TableHeaderCell>
          <TableHeaderCell align="right">CTR</TableHeaderCell>
          <TableHeaderCell align="right">Position</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.key}>
            <TableCell header className="max-w-[28rem] truncate">
              {row.key}
            </TableCell>
            <TableCell numeric>{formatNumber(row.clicks)}</TableCell>
            <TableCell numeric>{formatNumber(row.impressions)}</TableCell>
            <TableCell numeric>{formatPercent(row.ctr * 100, 2)}</TableCell>
            <TableCell numeric>{row.position.toFixed(1)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
