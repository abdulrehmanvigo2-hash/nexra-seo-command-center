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
import {
  CRAWL_REVIEWS,
  RUN_STATUS,
  executability,
  executeOutcome,
  hasResult,
  outputProvenance,
  queueRefusal,
  queuedNote,
  reconciledNote,
  reviewRequest,
  type CrawlReviewSpec,
  type QueueState,
  type Tone,
} from "@/lib/crawl/review-request";
import { formatFullDate, formatTimeUtc } from "@/lib/format";
import type { AgentRun } from "@/types/agent-run";
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

  const technical = useCrawlReview(projectId, shown, CRAWL_REVIEWS["crawl-review"]);
  const onPage = useCrawlReview(projectId, shown, CRAWL_REVIEWS["on-page-review"]);

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

            <CrawlReview review={CRAWL_REVIEWS["crawl-review"]} {...technical} />
            <CrawlReview review={CRAWL_REVIEWS["on-page-review"]} {...onPage} />

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
 * One agent's review of the crawl on screen: its queue state, and the two
 * requests an operator can make about it.
 *
 * Owned per review, so the Technical SEO and On-Page SEO controls each hold
 * their own run and cannot show one agent's result under the other's heading.
 * Everything below is the same for both: the crawl decides whether a review
 * can be queued, the server decides whether it is, and the persisted run —
 * re-read after every request — decides what is shown.
 */
function useCrawlReview(projectId: string, crawl: Crawl | null, review: CrawlReviewSpec) {
  const [state, setState] = useState<QueueState>({ status: "idle" });
  /** A ref refuses the second click of a pair before React has re-rendered. */
  const queueing = useRef(false);
  const [executing, setExecuting] = useState(false);
  const runningNow = useRef(false);
  const [executeNote, setExecuteNote] = useState<{ text: string; tone: Tone } | null>(null);

  const crawlId = crawl?.id ?? null;

  // A review belongs to one crawl. Showing another crawl's run beside this
  // one's pages would attribute findings to the wrong evidence.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing state that belongs to a different crawl
    setState({ status: "idle" });
    setExecuteNote(null);
  }, [crawlId]);

  const reviewable = reviewRequest(projectId, crawl, review);

  /**
   * Queues the agent to review this crawl.
   *
   * It queues and stops there. The run is executed later by the scheduled
   * worker or by Run Now below, through the same service an operator's own
   * request would use — nothing here executes an agent, and the button never
   * claims it did. A matching run already queued or running comes back as a
   * duplicate rather than as a second run.
   */
  const queue = async () => {
    if (queueing.current || !reviewable.ok) return;
    queueing.current = true;
    setState({ status: "queuing" });

    try {
      const response = await fetch("/api/agent-runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reviewable.payload),
        cache: "no-store",
      });
      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setState({ status: "refused", message: queueRefusal(response.status, body, review) });
        return;
      }

      const parsed = body as { run?: AgentRun; duplicate?: boolean } | null;
      setState(
        parsed?.run
          ? { status: "queued", run: parsed.run, duplicate: parsed.duplicate === true }
          : { status: "refused", message: "The server accepted the request but returned no run." },
      );
    } catch {
      setState({
        status: "refused",
        message: "The request did not complete. Refresh before asking again — it may have been queued.",
      });
    } finally {
      queueing.current = false;
    }
  };

  /**
   * Runs the queued review now, instead of waiting for the scheduled worker.
   *
   * The request names the run on screen — `/api/agent-runs/<id>` with
   * `{action:"execute"}` — so the attempt it claims is provably this one. The
   * deployment-wide `run-next` worker action is deliberately not used: it
   * claims the oldest queued run anywhere, which could belong to another
   * project entirely.
   *
   * Whatever the POST answers, the run is read back afterwards and the panel
   * shows the persisted state. An HTTP 200 says the request was accepted, not
   * that anything was analysed, and a 409 means something else claimed the run
   * first — which is the lease working, not a failure.
   */
  const runNow = async () => {
    const current = state.status === "queued" ? state.run : null;
    if (runningNow.current || current === null || !executability(current).ok) return;
    runningNow.current = true;
    setExecuting(true);
    setExecuteNote(null);

    const runId = current.id;
    let outcome;
    try {
      const response = await fetch(`/api/agent-runs/${encodeURIComponent(runId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "execute" }),
        cache: "no-store",
      });
      const body: unknown = await response.json().catch(() => null);
      outcome = executeOutcome(response.status, body);
    } catch {
      // The attempt may or may not have started. The read below decides.
      outcome = executeOutcome(0, null);
    }

    // Always reconcile, including after a success: the POST body is not the
    // authority on what was stored.
    let persisted: AgentRun | null = null;
    try {
      const read = await fetch(`/api/agent-runs/${encodeURIComponent(runId)}`, { cache: "no-store" });
      if (read.ok) {
        const body = (await read.json()) as { run?: AgentRun };
        persisted = body.run ?? null;
      }
    } catch {
      persisted = null;
    }

    if (persisted) setState({ status: "queued", run: persisted, duplicate: false });
    setExecuteNote(reconciledNote(outcome, persisted));
    runningNow.current = false;
    setExecuting(false);
  };

  return {
    state,
    blockedWhy: reviewable.ok ? null : reviewable.why,
    busy: state.status === "queuing",
    onQueue: queue,
    executing,
    executeNote,
    onRunNow: runNow,
  };
}

/**
 * One agent's review of this crawl.
 *
 * Queueing is all the first button does. The run is carried out later by the
 * scheduled worker or by Run Now, through the agent-run service an operator's
 * own request would use, so there is one execution path and the browser is
 * not on it. Until a run finishes there is nothing to read, and the wording
 * says so rather than showing a tick for work that has not started.
 */
function CrawlReview({
  review,
  state,
  blockedWhy,
  busy,
  onQueue,
  executing,
  executeNote,
  onRunNow,
}: {
  review: CrawlReviewSpec;
  state: QueueState;
  /** Why the control is unavailable, or null when it can be used. */
  blockedWhy: string | null;
  busy: boolean;
  onQueue: () => void;
  executing: boolean;
  /** What the last execute attempt adds to the badge, or null. */
  executeNote: { text: string; tone: Tone } | null;
  onRunNow: () => void;
}) {
  const queued = state.status === "queued" ? state : null;
  const run = queued?.run ?? null;
  const provenance = run ? outputProvenance(run) : null;
  const runnable = executability(run);

  return (
    <section className="space-y-2 border-t border-border pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-xs font-medium text-fg">{review.agentName} agent</h4>
          <p className="text-xs text-fg-subtle">{review.summary}</p>
        </div>
        <Button
          variant="secondary"
          icon="agents"
          onClick={onQueue}
          disabled={blockedWhy !== null || busy}
          title={blockedWhy ?? undefined}
          aria-busy={busy}
        >
          {busy ? "Queueing…" : review.action}
        </Button>
      </div>

      {blockedWhy !== null && state.status === "idle" && (
        <p className="text-xs text-fg-subtle">{blockedWhy}</p>
      )}

      {state.status === "refused" && (
        <p className="text-sm text-warning" role="status">
          <span className="font-medium">Not queued.</span> {state.message}
        </p>
      )}

      {queued && run && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              tone={RUN_STATUS[run.status].tone}
              dot
              pulse={run.status === "running"}
              title={RUN_STATUS[run.status].title}
            >
              {RUN_STATUS[run.status].label}
            </Badge>
            <span className="text-xs text-fg-subtle">
              {queuedNote({ run, duplicate: queued.duplicate })}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              icon="bolt"
              onClick={onRunNow}
              disabled={!runnable.ok || executing}
              title={runnable.why ?? undefined}
              aria-busy={executing}
            >
              {executing ? "Running…" : "Run Now"}
            </Button>
            <span className="text-xs text-fg-subtle">
              {runnable.ok
                ? "Runs this run through the operator worker now, instead of waiting for the scheduled one."
                : (runnable.why ?? "")}
            </span>
          </div>

          {executeNote && (
            <p
              className={
                executeNote.tone === "warning" ? "text-sm text-warning" : "text-sm text-fg-muted"
              }
              role="status"
            >
              {executeNote.text}
            </p>
          )}

          {run.error && (
            <p className="text-sm text-critical">
              <span className="font-medium">{run.error.code}</span> — {run.error.message}
            </p>
          )}

          {provenance && (
            <p
              className={provenance.tone === "warning" ? "text-xs text-warning" : "text-xs text-fg-subtle"}
            >
              {provenance.text}
            </p>
          )}

          {hasResult(run) && (
            <p className="text-sm whitespace-pre-wrap text-fg-muted">{run.resultSummary}</p>
          )}

          <p className="text-xs text-fg-subtle">
            Full run history, including attempts, is on the Agents screen.
          </p>
        </div>
      )}
    </section>
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
