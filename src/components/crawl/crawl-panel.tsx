"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import {
  STATUS_LABEL,
  canStart,
  crawlSummary,
  startRefusal,
  type CrawlRunState,
} from "@/lib/crawl/panel-state";
import {
  COLUMNS,
  GROUP_HEADING,
  PROVENANCE_NOTE,
  groupPages,
  pageRow,
  type PageRow,
} from "@/lib/crawl/pages-view";
import { CRAWL_REVIEWS, reviewRequest } from "@/lib/crawl/review-request";
import { QueuedReview, useQueuedReview } from "@/components/agent-runs/queued-review";
import { formatFullDate, formatTimeUtc } from "@/lib/format";
import type { Crawl, CrawlPage } from "@/types/crawl";

/**
 * The operator control for the real crawler.
 *
 * This is the only thing in the product that fetches a client's website. It
 * is deliberately not the "Run SEO Analysis" button beside it: that one is a
 * mock interaction over fixture data, and quietly wiring a live crawler to it
 * would make a real outbound request look like the demo it has always been.
 *
 * Everything it can do is bounded by the server. The body carries a project
 * id and nothing else, so the site crawled comes from that project's stored
 * domain rather than from anything typed here; the page budget, depth,
 * concurrency, host allow-list and robots rules are all server configuration
 * this panel cannot see or change. A refusal is reported as the server's
 * decision, not as an error to click through.
 */

type Load =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly latest: Crawl | null }
  /** The deployment does not persist crawls, so there is nothing to show. */
  | { readonly status: "unavailable" }
  | { readonly status: "failed"; readonly message: string };

/**
 * The pages one crawl recorded, read from the crawl-detail endpoint.
 *
 * Separate from the crawl row's own load: the summary is worth showing even
 * when the page list cannot be read, and a failure here must not make a
 * finished crawl look like it did not happen.
 */
type PagesLoad =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly pages: readonly CrawlPage[] }
  | { readonly status: "failed" };

/** The server caps this at 1,000; a crawl's own page budget caps it at 500. */
const PAGE_LIMIT = 500;

function listFailure(httpStatus: number): string {
  if (httpStatus === 401) return "Your session has ended. Reload the page to sign in again.";
  if (httpStatus === 429) return "Too many requests. Wait a moment and refresh.";
  return "Crawl history could not be loaded.";
}

const stamp = (iso: string) => `${formatFullDate(iso)}, ${formatTimeUtc(iso)}`;

export function CrawlPanel({
  projectId,
  domain,
}: {
  /** The project being worked on. Never a literal: the workspace passes its own. */
  projectId: string;
  /** Shown so an operator can see what will be fetched before asking. */
  domain: string;
}) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [run, setRun] = useState<CrawlRunState>({ status: "idle" });
  /**
   * A second guard beside the disabled button. React sets state on the next
   * render, so two clicks inside one frame would both pass a state check; a
   * ref is written immediately and refuses the second.
   */
  const inFlight = useRef(false);
  const [pages, setPages] = useState<PagesLoad>({ status: "idle" });

  const readLatest = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      const response = await fetch(
        `/api/crawls?project=${encodeURIComponent(projectId)}&limit=1`,
        { cache: "no-store", signal },
      );
      if (response.status === 503) return setLoad({ status: "unavailable" });
      if (!response.ok) return setLoad({ status: "failed", message: listFailure(response.status) });
      const body = (await response.json()) as { crawls: Crawl[] };
      setLoad({ status: "loaded", latest: body.crawls[0] ?? null });
    },
    [projectId],
  );

  // The prerendered page carries no crawl data: this reads after hydration,
  // through the endpoint that confirms the operator.
  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loading state belongs to this request
    setLoad({ status: "loading" });
    setRun({ status: "idle" });

    readLatest(controller.signal).catch((error: unknown) => {
      if (error instanceof Error && error.name === "AbortError") return;
      setLoad({ status: "failed", message: "Crawl history could not be loaded. Check your connection." });
    });

    return () => controller.abort();
  }, [readLatest]);

  /**
   * Starts one crawl and waits for it.
   *
   * The crawl runs inside the POST, so this request stays open for as long as
   * the server's time budget allows. When it answers, the record is re-read
   * through the list endpoint rather than trusted from the response body: what
   * the panel shows is then what was actually persisted.
   */
  const start = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRun({ status: "running" });

    try {
      const response = await fetch("/api/crawls", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId }),
        cache: "no-store",
      });

      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setRun(startRefusal(response.status, body));
        return;
      }

      const crawl = (body as { crawl?: Crawl } | null)?.crawl;
      setRun(crawl ? { status: "finished", crawl } : { status: "idle" });
      await readLatest().catch(() => {
        /* The crawl ran and is stored; a failed re-read is not a failed crawl. */
      });
    } catch {
      setRun({
        status: "failed",
        message: "The crawl request did not complete. It may still have run — refresh before asking again.",
      });
    } finally {
      inFlight.current = false;
    }
  };

  const running = run.status === "running";
  const shown = run.status === "finished" ? run.crawl : load.status === "loaded" ? load.latest : null;
  const shownId = shown?.id ?? null;

  /**
   * The pages of whichever crawl is on screen. Read through the existing
   * crawl-detail endpoint — this panel adds no route and no query of its own.
   */
  useEffect(() => {
    if (shownId === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing state that belongs to a crawl that is no longer shown
      setPages({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    setPages({ status: "loading" });

    fetch(`/api/crawls/${encodeURIComponent(shownId)}?pages=${PAGE_LIMIT}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return setPages({ status: "failed" });
        const body = (await response.json()) as { pages: CrawlPage[] };
        setPages({ status: "loaded", pages: body.pages });
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setPages({ status: "failed" });
      });

    return () => controller.abort();
  }, [shownId]);

  // Each review owns its run. A review belongs to one crawl, so both reset
  // when the crawl on screen changes.
  const technical = useQueuedReview(
    reviewRequest(projectId, shown, CRAWL_REVIEWS["crawl-review"]),
    shownId,
    CRAWL_REVIEWS["crawl-review"],
  );
  const onPage = useQueuedReview(
    reviewRequest(projectId, shown, CRAWL_REVIEWS["on-page-review"]),
    shownId,
    CRAWL_REVIEWS["on-page-review"],
  );

  return (
    <Panel>
      <PanelHeader
        eyebrow="Observed data"
        title="Site crawl"
        description={`Fetches ${domain} directly, within the server's page, depth and time budgets. Separate from Run SEO Analysis, which reports modelled figures.`}
        actions={
          <Button
            variant="primary"
            icon="technical"
            onClick={start}
            disabled={!canStart(run) || load.status === "unavailable"}
            aria-busy={running}
          >
            {running ? "Crawling…" : "Run Crawl"}
          </Button>
        }
      />

      <PanelBody className="space-y-4">
        {running && (
          <p className="text-sm text-fg-muted" role="status">
            Fetching {domain}. The crawl runs inside this request and stops on the server&apos;s
            budget, so this can take up to a minute.
          </p>
        )}

        {run.status === "refused" && (
          <p className="text-sm text-warning" role="status">
            <span className="font-medium">Not started.</span> {run.message}
          </p>
        )}

        {run.status === "failed" && (
          <p className="text-sm text-critical" role="status">
            {run.message}
          </p>
        )}

        {load.status === "loading" && <Skeleton className="h-24 w-full" />}

        {load.status === "unavailable" && (
          <EmptyState
            icon="technical"
            size="sm"
            title="Crawls are not stored on this deployment"
            description="The crawl store is not configured, so a crawl could not be recorded even if it ran."
          />
        )}

        {load.status === "failed" && (
          <p className="text-sm text-critical" role="status">
            {load.message}
          </p>
        )}

        {load.status === "loaded" && shown === null && !running && run.status === "idle" && (
          <EmptyState
            icon="technical"
            size="sm"
            title="No crawl has been run for this project"
            description="Running one fetches the site now. Nothing here is fixture data."
          />
        )}

        {shown && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                tone={STATUS_LABEL[shown.status].tone}
                dot
                pulse={shown.status === "running"}
                title={STATUS_LABEL[shown.status].title}
              >
                {STATUS_LABEL[shown.status].label}
              </Badge>
              <span className="text-xs text-fg-subtle">Started {stamp(shown.startedAt)}</span>
            </div>

            {shown.error && (
              <p className="text-sm text-critical">
                <span className="font-medium">{shown.error.code}</span> — {shown.error.message}
              </p>
            )}

            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {crawlSummary(shown).map((entry) => (
                <div key={entry.label} className="flex items-baseline justify-between gap-3">
                  <dt className="text-xs text-fg-subtle" title={entry.title}>
                    {entry.label}
                  </dt>
                  <dd className="truncate text-sm text-fg" title={entry.value}>
                    {entry.value}
                  </dd>
                </div>
              ))}
            </dl>

            <QueuedReview review={CRAWL_REVIEWS["crawl-review"]} {...technical} />
            <QueuedReview review={CRAWL_REVIEWS["on-page-review"]} {...onPage} />

            {pages.status === "loading" && <Skeleton className="h-20 w-full" />}

            {pages.status === "failed" && (
              <p className="text-sm text-fg-muted" role="status">
                The recorded pages could not be read. The crawl itself is unaffected.
              </p>
            )}

            {pages.status === "loaded" && <CrawlPages pages={pages.pages} />}
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}

/**
 * What the crawl recorded, one row per URL.
 *
 * Grouped rather than sorted, because the groups are the finding: a URL that
 * was fetched, a URL that answered with something else, and a URL nobody
 * looked at are three different states, and a single ranked table would let
 * the third pass for the first.
 */
function CrawlPages({ pages }: { pages: readonly CrawlPage[] }) {
  const groups = groupPages(pages);

  return (
    <div className="space-y-4 border-t border-border pt-4">
      {(["fetched", "notFetched", "notReached"] as const).map((key) => {
        const group = groups[key];
        if (group.length === 0) return null;
        return (
          <PageGroup
            key={key}
            title={`${GROUP_HEADING[key].title} (${group.length})`}
            note={GROUP_HEADING[key].note}
            rows={group.map(pageRow)}
          />
        );
      })}

      <p className="text-xs text-fg-subtle">{PROVENANCE_NOTE}</p>
    </div>
  );
}

function PageGroup({
  title,
  note,
  rows,
}: {
  title: string;
  note: string;
  rows: readonly PageRow[];
}) {
  return (
    <section className="space-y-1.5">
      <h4 className="text-xs font-medium text-fg">{title}</h4>
      <p className="text-xs text-fg-subtle">{note}</p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] border-collapse text-left">
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="py-1.5 pr-3 text-[10.5px] font-medium tracking-[0.05em] text-fg-subtle uppercase">
                Path
              </th>
              {COLUMNS.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  title={"title" in column ? column.title : undefined}
                  className="py-1.5 pr-3 text-[10.5px] font-medium tracking-[0.05em] text-fg-subtle uppercase"
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border/60 last:border-0">
                <th scope="row" className="max-w-[18rem] truncate py-1.5 pr-3 text-[12px] font-normal text-fg" title={row.url}>
                  {row.path}
                </th>
                {row.cells.map((entry) => (
                  <td
                    key={entry.key}
                    title={entry.cell.title}
                    className="py-1.5 pr-3 text-[12px] text-fg-muted"
                  >
                    {entry.cell.text}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
