"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { MetricTileGrid } from "@/components/ui/metric-tile";
import { Panel, PanelBody, PanelFooter } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { formatFullDate } from "@/lib/format";
import { TASK_PRIORITY_META } from "@/lib/agent-tasks/contract";
import { DIRECTOR_RUNS_READ_LIMIT, citedPriorityUrl, directorRunLabel, directorRunsUrl, learningChain, type CitedChange } from "@/lib/agent-tasks/learning-chain";
import { LEARNING_LABEL, LEARNINGS_READ_LIMIT, learningsReadFailure, learningsUrl, presentLearnings, type Learning } from "@/lib/analytics/learnings";
import {
  LATEST_WINDOW_FOOTER,
  STORED_VS_LIVE_NOTE,
  comparisonReadiness,
  describeLatestWindow,
  latestWindowLine,
  latestWindowReadFailure,
  latestWindowTiles,
  latestWindowUrl,
  type LatestWindowView,
} from "@/lib/search-console/latest/view";
import type { AgentRun } from "@/types/agent-run";

/**
 * The Analytics screen's observed sections (checkpoint 4.3): the latest
 * stored window as tiles, and the Learnings list. Each has its own read and
 * its own loading, failure and empty states; neither borrows a figure from
 * the other or from the live report.
 */

type WindowLoad =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "loaded"; readonly view: LatestWindowView };

/** The latest stored window: tiles, the window line and, on the Overview, whether a comparison can run yet. */
export function LatestWindowTiles({ projectId, readiness }: { projectId: string; readiness: boolean }) {
  const [load, setLoad] = useState<WindowLoad>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loading state belongs to this request
    setLoad({ status: "loading" });
    fetch(latestWindowUrl(projectId), { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return setLoad({ status: "failed", message: latestWindowReadFailure(response.status) });
        setLoad({ status: "loaded", view: (await response.json()) as LatestWindowView });
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setLoad({ status: "failed", message: latestWindowReadFailure(0) });
      });
    return () => controller.abort();
  }, [projectId]);

  if (load.status === "loading") {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy="true">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-24 w-full" />
        ))}
      </div>
    );
  }
  if (load.status === "failed") {
    return (
      <Panel>
        <PanelBody>
          <p className="text-sm text-critical" role="status">
            {load.message}
          </p>
        </PanelBody>
      </Panel>
    );
  }
  const view = load.view;
  if (view.status !== "window") {
    const message = describeLatestWindow(view);
    return (
      <Panel>
        <EmptyState icon="analytics" title={message.title} description={message.description} />
      </Panel>
    );
  }
  const tiles = latestWindowTiles(view);
  return (
    <div className="space-y-3">
      {tiles !== null ? (
        <MetricTileGrid metrics={tiles} />
      ) : (
        <Panel>
          <EmptyState icon="analytics" title="No impressions in the latest stored window" description="Google reported no impressions for this window, so there is no click, click-through or position figure to show." />
        </Panel>
      )}
      <Panel>
        <PanelFooter>
          <span>{latestWindowLine(view)}</span>
          <span>{LATEST_WINDOW_FOOTER}</span>
        </PanelFooter>
        <p className="border-t border-border px-4 py-2.5 text-xs text-fg-subtle sm:px-5" role="note">
          {STORED_VS_LIVE_NOTE}
        </p>
        {readiness && (
          <p className="border-t border-border px-4 py-2.5 text-xs text-fg-subtle sm:px-5" role="note">
            {comparisonReadiness(view)}
          </p>
        )}
      </Panel>
    </div>
  );
}

type ChainLoad =
  | { readonly status: "loading" }
  | { readonly status: "failed" }
  | { readonly status: "loaded"; readonly directorRuns: readonly AgentRun[]; readonly changes: readonly CitedChange[] };

/**
 * The learning loop as recorded (checkpoint 6.7): the project's SEO Director
 * runs and the priority changes that cite one, read once for the list. Its
 * own read and states; the learnings show without it.
 */
function useLearningChain(projectId: string): ChainLoad {
  const [load, setLoad] = useState<ChainLoad>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loading state belongs to this request
    setLoad({ status: "loading" });
    Promise.all([
      fetch(directorRunsUrl(projectId), { cache: "no-store", signal: controller.signal }),
      fetch(citedPriorityUrl(projectId), { cache: "no-store", signal: controller.signal }),
    ])
      .then(async ([runs, changes]) => {
        if (!runs.ok || !changes.ok) return setLoad({ status: "failed" });
        const runBody = (await runs.json()) as { runs?: AgentRun[] };
        const changeBody = (await changes.json()) as { changes?: CitedChange[] };
        setLoad({ status: "loaded", directorRuns: runBody.runs ?? [], changes: changeBody.changes ?? [] });
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setLoad({ status: "failed" });
      });
    return () => controller.abort();
  }, [projectId]);
  return load;
}

/** One performance review's recorded chain: the Director runs that read it, and the priority changes citing each. */
function LearningChainLines({ runId, chain }: { runId: string; chain: ChainLoad }) {
  if (chain.status === "loading") return <p className="text-xs text-fg-subtle">Reading what followed this review…</p>;
  if (chain.status === "failed") {
    return (
      <p className="text-xs text-warning" role="status">
        The Director runs and cited priority changes could not be read. This is a read failure, not an absent chain.
      </p>
    );
  }
  const links = learningChain(runId, chain.directorRuns, chain.changes);
  if (links.length === 0) return <p className="text-xs text-fg-subtle">No SEO Director project review among the {DIRECTOR_RUNS_READ_LIMIT} newest has read this review yet.</p>;
  return (
    <ol className="space-y-1.5 text-xs">
      {links.map((link) => (
        <li key={link.directorRun.id} className="space-y-0.5">
          <p className="text-fg-muted">
            <span className="text-fg-subtle">Performance review {runId.slice(0, 8)} → </span>
            read by {directorRunLabel(link.directorRun)}
          </p>
          {link.changes.length === 0 ? (
            <p className="pl-4 text-fg-subtle">→ no priority change cites this Director run</p>
          ) : (
            link.changes.map((change) => (
              <p key={change.event.id} className="pl-4 text-fg-muted">
                → priority change: {change.taskTitle !== null ? `“${change.taskTitle}”` : `task ${change.event.taskId.slice(0, 8)}`}{" "}
                {change.event.fromPriority ? TASK_PRIORITY_META[change.event.fromPriority].label : "?"} → {change.event.toPriority ? TASK_PRIORITY_META[change.event.toPriority].label : "?"} ·{" "}
                {formatFullDate(change.event.createdAt)}
              </p>
            ))
          )}
        </li>
      ))}
    </ol>
  );
}

type LearningsLoad =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "loaded"; readonly learnings: readonly Learning[] };

/** The project's completed performance-review runs, newest first. */
export function LearningsList({ projectId }: { projectId: string }) {
  const [load, setLoad] = useState<LearningsLoad>({ status: "loading" });
  const chain = useLearningChain(projectId);

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loading state belongs to this request
    setLoad({ status: "loading" });
    fetch(learningsUrl(projectId), { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return setLoad({ status: "failed", message: learningsReadFailure(response.status) });
        const body = (await response.json()) as { runs?: AgentRun[] };
        setLoad({ status: "loaded", learnings: presentLearnings(body.runs ?? []) });
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setLoad({ status: "failed", message: learningsReadFailure(0) });
      });
    return () => controller.abort();
  }, [projectId]);

  if (load.status === "loading") {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }
  if (load.status === "failed") {
    return (
      <Panel>
        <PanelBody>
          <p className="text-sm text-critical" role="status">
            {load.message}
          </p>
        </PanelBody>
      </Panel>
    );
  }
  if (load.learnings.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon="sparkles"
          title="No learnings yet"
          description="Learnings are the project's completed Analytics & Learning performance reviews. None has completed for this project; one can be queued from the Search Console panel on the Overview tab."
        />
      </Panel>
    );
  }
  return (
    <div className="space-y-3">
      {load.learnings.map((learning) => (
        <Panel key={learning.runId}>
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5 sm:px-5">
            <Badge tone="neutral" title={LEARNING_LABEL}>
              Model reading
            </Badge>
            <span className="text-xs text-fg-muted">
              {learning.windowStart !== null && learning.windowEnd !== null
                ? `Window ${formatFullDate(learning.windowStart)} – ${formatFullDate(learning.windowEnd)}`
                : "Window not recorded"}
            </span>
            <span className="text-xs text-fg-subtle">
              · ran {formatFullDate(learning.ranAt)}
              {learning.model !== null ? ` · ${learning.model}` : ""} · run {learning.runId.slice(0, 8)}
            </span>
          </div>
          <PanelBody>
            <p className="text-sm whitespace-pre-line text-fg">{learning.summary}</p>
            <div className="mt-3 border-t border-border pt-2">
              <p className="mb-1 text-[11px] font-medium tracking-wide text-fg-subtle uppercase">What followed, as recorded</p>
              <LearningChainLines runId={learning.runId} chain={chain} />
            </div>
          </PanelBody>
          <PanelFooter>
            <span>{LEARNING_LABEL}.</span>
          </PanelFooter>
        </Panel>
      ))}
      <p className="text-xs text-fg-subtle">
        {load.learnings.length} completed performance {load.learnings.length === 1 ? "review" : "reviews"}, read from the agent&apos;s {LEARNINGS_READ_LIMIT} newest runs on this project.
      </p>
    </div>
  );
}
