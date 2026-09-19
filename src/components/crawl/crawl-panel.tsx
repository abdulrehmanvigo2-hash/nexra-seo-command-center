"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { formatFullDate, formatNumber, formatTimeUtc } from "@/lib/format";
import {
  CRAWL_STATUS_META,
  DISCOVERY_SCOPE_NOTE,
  describeCrawl,
  describeLimits,
  isCrawlRunning,
} from "@/lib/crawl/present";
import type { Crawl } from "@/types/crawl";

/**
 * The first real measurement an operator can start, and where it got to.
 *
 * Discovery reads the pages a site lists in its sitemaps. That is the start of
 * a crawl and not an audit, and the panel says so in its own footer rather than
 * leaving the page to imply otherwise: the pages have not been fetched, nothing
 * has been analysed, and the modelled-figures notice below this stays exactly
 * as it was.
 *
 * Like the Search Console panel, it fetches after hydration from a route that
 * holds the credentials, so the page's HTML is the same for every operator. It
 * polls only while a pass is actually running, and stops as soon as it is not.
 */

const POLL_MS = 3_000;

type Load =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly crawl: Crawl | null }
  | { readonly status: "failed"; readonly message: string };

const FAILED_TO_READ = "The crawl status could not be read. Reload the page to try again.";

/** What a non-200 from the route means to an operator, without echoing it. */
function messageForStatus(status: number): string {
  if (status === 401) return "Your session has ended. Reload the page to sign in again.";
  if (status === 429) return "Too many requests just now. Wait a moment and try again.";
  if (status === 503) {
    return "This deployment does not store crawls, so discovery cannot run here.";
  }
  if (status === 422) {
    return "This project's website is not an address the crawler will visit. Check the domain in the project's settings.";
  }
  return FAILED_TO_READ;
}

export function CrawlPanel({ projectId }: { projectId: string }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [starting, setStarting] = useState(false);

  // Tracked so a poll that resolves after unmount cannot set state, and so a
  // pending timer is cleared when the pass ends or the component goes away.
  const alive = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const read = useCallback(async () => {
    try {
      const response = await fetch(`/api/crawls?project=${encodeURIComponent(projectId)}`, {
        cache: "no-store",
      });
      if (!alive.current) return;
      if (!response.ok) {
        setLoad({ status: "failed", message: messageForStatus(response.status) });
        return;
      }
      const body = (await response.json()) as { crawl: Crawl | null };
      if (!alive.current) return;
      setLoad({ status: "loaded", crawl: body.crawl });
    } catch {
      if (alive.current) setLoad({ status: "failed", message: FAILED_TO_READ });
    }
  }, [projectId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the first read belongs to this mount, the same way the Search Console panel's does
    void read();
  }, [read]);

  // Poll only while something is actually happening.
  const crawl = load.status === "loaded" ? load.crawl : null;
  const running = isCrawlRunning(crawl);

  /**
   * Drives the next slice of the fetch stage.
   *
   * A crawl of hundreds of pages does not fit in one request, so the page asks
   * for one bounded slice at a time. Closing the tab does not lose the crawl:
   * the queue is in the database and the worker route can finish it.
   */
  const advance = useCallback(
    async (crawlId: string) => {
      try {
        const response = await fetch("/api/crawls/pages", {
          method: "POST",
          headers: { "content-type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ crawlId }),
        });
        if (!alive.current) return;
        if (!response.ok) {
          // A slice that will not run is not a reason to lose the status; the
          // poll below keeps reporting whatever the crawl actually says.
          setLoad({ status: "failed", message: messageForStatus(response.status) });
          return;
        }
        const body = (await response.json()) as { crawl: Crawl };
        if (alive.current) setLoad({ status: "loaded", crawl: body.crawl });
      } catch {
        if (alive.current) setLoad({ status: "failed", message: FAILED_TO_READ });
      }
    },
    [],
  );

  // Read out of the record rather than closing over it, so the effect depends
  // on the three things that actually decide what happens next.
  const activeId = crawl?.id ?? null;
  const activeStatus = crawl?.status ?? null;
  const changedAt = crawl?.updatedAt ?? null;

  useEffect(() => {
    if (!running || activeId === null) return;
    timer.current = setTimeout(() => {
      void (activeStatus === "fetching" ? advance(activeId) : read());
    }, POLL_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [running, read, advance, activeId, activeStatus, changedAt]);

  const start = async () => {
    if (starting || running) return;
    setStarting(true);
    try {
      const response = await fetch("/api/crawls", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ projectId }),
      });
      if (!alive.current) return;
      if (!response.ok) {
        setLoad({ status: "failed", message: messageForStatus(response.status) });
        return;
      }
      const body = (await response.json()) as { crawl: Crawl };
      if (alive.current) setLoad({ status: "loaded", crawl: body.crawl });
    } catch {
      if (alive.current) setLoad({ status: "failed", message: FAILED_TO_READ });
    } finally {
      if (alive.current) setStarting(false);
    }
  };

  const meta = crawl ? CRAWL_STATUS_META[crawl.status] : null;
  const limitNote = crawl?.status === "completed" ? describeLimits(crawl.limits) : null;
  const busy = starting || running;

  return (
    <Panel aria-busy={load.status === "loading" || busy || undefined}>
      <PanelHeader
        eyebrow="Site discovery"
        title="Pages this site lists"
        description="Reads the site's robots.txt and sitemaps, then fetches each page and records what it answered. No page is analysed yet."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {meta && (
              <Badge tone={meta.tone} dot>
                {meta.label}
              </Badge>
            )}
            <Button
              variant="primary"
              icon="bolt"
              onClick={start}
              disabled={busy || load.status === "loading"}
            >
              {starting
                ? "Starting"
                : running
                  ? "Running"
                  : crawl
                    ? "Run discovery again"
                    : "Start first crawl"}
            </Button>
          </div>
        }
      />

      {load.status === "loading" ? (
        <div className="space-y-3 px-4 py-4 sm:px-5">
          <Skeleton className="h-4 w-full max-w-72" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : load.status === "failed" ? (
        <EmptyState
          size="sm"
          icon="alert"
          title="Discovery status not available"
          description={load.message}
        />
      ) : crawl === null ? (
        <EmptyState
          size="sm"
          icon="search"
          title="No discovery has run yet"
          description="Start the first pass to find out which pages this site lists. Nothing is fetched or analysed beyond the site's own sitemaps."
        />
      ) : (
        <div className="px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-start gap-3">
            <Icon
              name={crawl.status === "failed" ? "alert" : "clock"}
              className={`mt-0.5 h-4 w-4 shrink-0 ${
                crawl.status === "failed" ? "text-critical" : "text-fg-subtle"
              }`}
            />
            <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-fg-muted">
              {describeCrawl(crawl)}
            </p>
          </div>

          {(crawl.status === "completed" || crawl.status === "fetching") && (
            <dl className="mt-3.5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Reading label="Pages listed" value={formatNumber(crawl.discoveredCount)} />
              <Reading label="Queued" value={formatNumber(crawl.pagesTotal)} />
              <Reading label="Fetched" value={formatNumber(crawl.pagesFetched)} />
              <Reading label="Failed" value={formatNumber(crawl.pagesFailed)} />
              {/* Refused by the URL policy, disallowed by robots, or past a limit. */}
              <Reading label="Skipped" value={formatNumber(crawl.pagesSkipped)} />
            </dl>
          )}

          {limitNote && (
            <p className="mt-3 text-[11.5px] leading-relaxed text-warning">{limitNote}</p>
          )}
        </div>
      )}

      <PanelFooter>
        <span>
          {crawl?.finishedAt
            ? `Last pass ${formatFullDate(crawl.finishedAt)}, ${formatTimeUtc(crawl.finishedAt)}.`
            : "Observed from this site directly, not modelled."}
        </span>
        <span className="max-w-xl">{DISCOVERY_SCOPE_NOTE}</span>
      </PanelFooter>
    </Panel>
  );
}

function Reading({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-surface-raised px-3 py-2.5">
      <dt className="truncate text-[11.5px] text-fg-subtle">{label}</dt>
      <dd className="tabular mt-1 text-[18px] leading-none font-semibold text-fg">{value}</dd>
    </div>
  );
}
