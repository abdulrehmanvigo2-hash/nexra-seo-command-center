"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { QueuedReview, useQueuedReview } from "@/components/agent-runs/queued-review";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import {
  competitorCrawlRequest,
  competitorCrawlsUrl,
  competitorStartRefusal,
  describeCompetitorCrawl,
  offeredCompetitorHosts,
} from "@/lib/crawl/competitor-request";
import { canStart, type CrawlRunState } from "@/lib/crawl/panel-state";
import { COMPETITOR_COMPARISON_REVIEW, competitorComparisonRequest } from "@/lib/crawl/review-request";
import { formatFullDate, formatTimeUtc } from "@/lib/format";
import type { Crawl } from "@/types/crawl";

/**
 * The competitor sites an operator may crawl for this project, one row per
 * domain the agency recorded at intake.
 *
 * Evidence collection, and one review of it. Each row reads its newest
 * recorded crawl after hydration through the existing crawl list endpoint,
 * filtered to that host, and offers one explicitly labelled control that
 * fetches that host and nothing else. Beneath a reviewable crawl it offers
 * the Market & Competitor Intelligence agent's comparison of that crawl with
 * the project's own newest site crawl — the shared queue-then-run control
 * every other review uses, keyed by this competitor's host, which restores
 * its newest persisted run after a page load. Nothing here crawls on its
 * own, crawls every domain at once, schedules anything, or queues a review
 * on its own: a recorded competitor crawl is what a rival's public pages
 * returned to this crawler, and the panel says so rather than calling it a
 * finding.
 *
 * The domain list is the server's — read from the stored project on the
 * server and handed in as a prop — never the fixture competitor dashboard and
 * never a domain added in this session, which is not recorded anywhere.
 */

type Latest =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly crawl: Crawl | null }
  | { readonly status: "unavailable" }
  | { readonly status: "failed"; readonly message: string };

const stamp = (iso: string) => `${formatFullDate(iso)}, ${formatTimeUtc(iso)}`;

function listFailure(httpStatus: number): string {
  if (httpStatus === 401) return "Your session has ended. Reload the page to sign in again.";
  if (httpStatus === 429) return "Too many requests. Wait a moment and refresh.";
  return "Competitor crawl history could not be loaded.";
}

export function CompetitorCrawlsPanel({
  projectId,
  projectDomain,
  competitorDomains,
}: {
  projectId: string;
  /** The project's own stored domain, so its own site is never offered as a rival. */
  projectDomain: string;
  /** The competitor domains recorded for the project at intake, as the server stores them. */
  competitorDomains: readonly string[];
}) {
  const hosts = offeredCompetitorHosts(projectDomain, competitorDomains);

  /**
   * The project's own newest site crawl — the other side of every
   * comparison. Read once for the panel, after hydration, through the same
   * own-site listing the crawl panel reads; `undefined` until it answers, and
   * again if it cannot, so no comparison is offered on a side nobody has seen.
   */
  const [projectCrawl, setProjectCrawl] = useState<Crawl | null | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/crawls?project=${encodeURIComponent(projectId)}&limit=1`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json()) as { crawls?: Crawl[] };
        setProjectCrawl(body.crawls?.[0] ?? null);
      })
      .catch(() => {
        /* Left unknown: the control says the project's crawl history has not loaded. */
      });
    return () => controller.abort();
  }, [projectId]);

  return (
    <Panel>
      <PanelHeader
        eyebrow="Observed data"
        title="Competitor site crawls"
        description="Fetches one recorded competitor's public pages directly, within the same page, depth and time budgets, robots rules and network guards as the project's own crawl. Each crawl is started by you, for one domain, and records what that site returned — nothing about how the competitor performs. A recorded crawl can then be compared with the project's own newest site crawl by the Market & Competitor Intelligence agent, as page declarations only."
      />

      {hosts.length === 0 ? (
        <EmptyState
          size="sm"
          icon="competitors"
          title="No competitor domains recorded"
          description="Competitor domains are recorded when a project is created. None usable is recorded for this project, so there is nothing to crawl here."
        />
      ) : (
        <ul className="divide-y divide-border">
          {hosts.map((host) => (
            <CompetitorRow
              key={host}
              projectId={projectId}
              projectDomain={projectDomain}
              host={host}
              recorded={competitorDomains}
              projectCrawl={projectCrawl}
            />
          ))}
        </ul>
      )}

      <PanelFooter>
        <span>
          Only domains recorded at intake are offered. The server checks the domain against the stored record and its
          allow-list before any request is made.
        </span>
        <span>
          The comparison reads what both crawls recorded; it measures neither site, and nothing queues it on its own.
        </span>
      </PanelFooter>
    </Panel>
  );
}

function CompetitorRow({
  projectId,
  projectDomain,
  host,
  recorded,
  projectCrawl,
}: {
  projectId: string;
  projectDomain: string;
  host: string;
  recorded: readonly string[];
  /** The project's newest own-site crawl, null when none, undefined while unknown. */
  projectCrawl: Crawl | null | undefined;
}) {
  const [latest, setLatest] = useState<Latest>({ status: "loading" });
  const [run, setRun] = useState<CrawlRunState>({ status: "idle" });
  /** A ref refuses the second click of a pair before React has re-rendered. */
  const inFlight = useRef(false);

  const readLatest = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      const response = await fetch(competitorCrawlsUrl(projectId, host), { cache: "no-store", signal });
      if (response.status === 503) return setLatest({ status: "unavailable" });
      if (!response.ok) return setLatest({ status: "failed", message: listFailure(response.status) });
      const body = (await response.json()) as { crawls?: Crawl[] };
      setLatest({ status: "loaded", crawl: body.crawls?.[0] ?? null });
    },
    [projectId, host],
  );

  // A read only, after hydration, through the endpoint that confirms the operator.
  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loading state belongs to this request
    setLatest({ status: "loading" });
    setRun({ status: "idle" });
    readLatest(controller.signal).catch((error: unknown) => {
      if (error instanceof Error && error.name === "AbortError") return;
      setLatest({ status: "failed", message: "Competitor crawl history could not be loaded. Check your connection." });
    });
    return () => controller.abort();
  }, [readLatest]);

  const request = competitorCrawlRequest(projectId, projectDomain, host, recorded);

  /**
   * Starts one crawl of this host and waits for it. The crawl runs inside the
   * POST; when it answers, the record is re-read through the list endpoint
   * rather than trusted from the response, so what is shown is what was
   * persisted.
   */
  const start = async () => {
    if (inFlight.current || !request.ok) return;
    inFlight.current = true;
    setRun({ status: "running" });

    try {
      const response = await fetch("/api/crawls", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request.payload),
        cache: "no-store",
      });
      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setRun(competitorStartRefusal(response.status, body));
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
  const shown = run.status === "finished" ? run.crawl : latest.status === "loaded" ? latest.crawl : null;
  const described = shown ? describeCompetitorCrawl(shown) : null;

  /**
   * The comparison belongs to this competitor: its run is keyed by the host,
   * so a page load restores this competitor's newest comparison and never
   * another's. While this row's crawl history is still loading, the crawl is
   * unknown rather than absent, and the control says so.
   */
  const comparison = useQueuedReview(
    competitorComparisonRequest({
      projectId,
      projectDomain,
      competitorDomain: host,
      recorded,
      projectCrawl,
      competitorCrawl: latest.status === "loading" || latest.status === "failed" ? undefined : shown,
    }),
    host,
    COMPETITOR_COMPARISON_REVIEW,
    projectId,
  );

  return (
    <li className="space-y-2 px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-[12.5px] text-fg">{host}</p>
          <p className="text-xs text-fg-subtle">Recorded at intake by the agency; not verified as a competitor.</p>
        </div>
        <Button
          variant="secondary"
          icon="technical"
          onClick={start}
          disabled={!request.ok || !canStart(run) || latest.status === "unavailable"}
          title={request.ok ? undefined : request.why}
          aria-busy={running}
        >
          {running ? "Crawling…" : "Crawl competitor site"}
        </Button>
      </div>

      {running && (
        <p className="text-sm text-fg-muted" role="status">
          Fetching {host}. The crawl runs inside this request and stops on the server&apos;s budget.
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

      {latest.status === "loading" ? (
        <Skeleton className="h-4 w-full max-w-72" />
      ) : latest.status === "unavailable" ? (
        <p className="text-xs text-fg-subtle">Crawls are not stored on this deployment&apos;s data source.</p>
      ) : latest.status === "failed" ? (
        <p className="text-xs text-warning">{latest.message}</p>
      ) : shown && described ? (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={described.tone} dot pulse={shown.status === "running"}>
              {described.label}
            </Badge>
            <span className="text-xs text-fg-subtle">
              Latest crawl started {stamp(shown.startedAt)}
              {shown.finishedAt ? `, finished ${stamp(shown.finishedAt)}` : ""}.
            </span>
          </div>
          <p className="text-xs text-fg-muted">{described.detail}</p>
          {shown.error && (
            <p className="text-xs text-critical">
              <span className="font-medium">{shown.error.code}</span> — {shown.error.message}
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-fg-subtle">No crawl of this competitor has been recorded.</p>
      )}

      {latest.status !== "unavailable" && (
        <QueuedReview review={COMPETITOR_COMPARISON_REVIEW} projectId={projectId} {...comparison} />
      )}
    </li>
  );
}
