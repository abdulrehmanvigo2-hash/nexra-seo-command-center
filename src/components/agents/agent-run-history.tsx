"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/field";
import { Panel, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { getTaskType } from "@/lib/agent-runs/task-types";
import { outputProvenance } from "@/lib/crawl/review-request";
import { formatFullDate, formatTimeUtc } from "@/lib/format";
import { AGENT_NAMES, AGENT_REGISTRY } from "@/lib/mock/agents/registry";
import type { ProjectOption } from "@/lib/projects/selection";
import type {
  AgentRun,
  AgentRunAttempt,
  AgentRunAttemptOutcome,
  AgentRunStatus,
} from "@/types/agent-run";

/**
 * Stored agent runs and their attempts — the one panel on the Agents screen
 * that shows executed work rather than fixtures.
 *
 * Reads after hydration from `/api/agent-runs`, which confirms the operator,
 * so the prerendered page carries no run data. What it shows is exactly what
 * the API returns: status, task, the validated input where it names another
 * record, timing, attempts, the screened summary, and the fixed error
 * message. Leases, worker labels, and provider payloads are not part of the
 * API response and cannot appear here.
 *
 * Output is labelled by where it came from, read from the run's own metadata
 * (`outputProvenance`): the mock executor's is marked simulated; the AI
 * executor's says what recorded evidence it was grounded in, or that it had
 * none; and a Director hand-off names the upstream review it prioritised.
 */

const LIST_LIMIT = 25;

const STATUS: Readonly<Record<AgentRunStatus, { label: string; tone: BadgeTone; title: string }>> = {
  queued: { label: "Queued", tone: "neutral", title: "Waiting to be claimed by a worker." },
  running: { label: "Running", tone: "accent", title: "An attempt is in progress under a live lease." },
  completed: { label: "Completed", tone: "positive", title: "The last attempt finished and its result was stored." },
  failed: { label: "Failed", tone: "critical", title: "The last attempt failed. See the reason below." },
  cancelled: { label: "Cancelled", tone: "warning", title: "An operator cancelled the run." },
};

const OUTCOME: Readonly<Record<AgentRunAttemptOutcome, { label: string; tone: BadgeTone }>> = {
  running: { label: "Running", tone: "accent" },
  completed: { label: "Completed", tone: "positive" },
  failed: { label: "Failed", tone: "critical" },
  cancelled: { label: "Cancelled", tone: "warning" },
};

type Load =
  | { readonly status: "loading" }
  | {
      readonly status: "loaded";
      readonly runs: readonly AgentRun[];
      /** Whether the last page was full, so an older page may exist. */
      readonly hasMore: boolean;
      readonly more: "idle" | "loading" | "failed";
    }
  | { readonly status: "unavailable" }
  | { readonly status: "failed"; readonly message: string };

type AttemptsLoad =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly attempts: readonly AgentRunAttempt[] }
  | { readonly status: "failed" };

const stamp = (iso: string | null) => (iso ? `${formatFullDate(iso)}, ${formatTimeUtc(iso)}` : "—");

function failureMessage(status: number): string {
  if (status === 401) return "Your session has ended. Reload the page to sign in again.";
  if (status === 429) return "Too many requests. Wait a moment and refresh.";
  return "Agent runs could not be loaded.";
}

/**
 * What produced a completed run's output, from its own metadata.
 *
 * The one case the metadata cannot settle is an AI run that stored none,
 * which is described by its executor column alone and claims no evidence.
 */
function sourceLabel(run: AgentRun): string | null {
  const provenance = outputProvenance(run);
  if (provenance) return provenance.text;
  if (run.executor === "mock") return "Simulated output — the mock executor performed no analysis.";
  if (run.executor === "ai") return "Model-generated from the task input alone; no recorded evidence was supplied.";
  return null;
}

/**
 * The upstream run a Director hand-off was asked to prioritise, from the
 * validated input — shown whatever state the run is in, so a queued or failed
 * hand-off still says what it was for.
 */
function upstreamRunId(run: AgentRun): string | null {
  if (run.taskType !== "priority-review") return null;
  return typeof run.input.sourceRunId === "string" ? run.input.sourceRunId : null;
}

export function AgentRunHistory({ projects }: { projects: readonly ProjectOption[] }) {
  const [projectId, setProjectId] = useState<string>(
    () => projects.find((project) => project.measured)?.id ?? projects[0]?.id ?? "",
  );
  const [agentId, setAgentId] = useState<string>("");
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [refreshKey, setRefreshKey] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<Record<string, AttemptsLoad>>({});

  const listUrl = useCallback(
    (offset: number) => {
      const params = new URLSearchParams({ project: projectId, limit: String(LIST_LIMIT), offset: String(offset) });
      if (agentId) params.set("agent", agentId);
      return `/api/agent-runs?${params.toString()}`;
    },
    [projectId, agentId],
  );

  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loading state belongs to this request
    setLoad({ status: "loading" });
    setExpanded(null);
    setAttempts({});

    fetch(listUrl(0), { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (response.status === 503) return setLoad({ status: "unavailable" });
        if (!response.ok) return setLoad({ status: "failed", message: failureMessage(response.status) });
        const body = (await response.json()) as { runs: AgentRun[] };
        setLoad({ status: "loaded", runs: body.runs, hasMore: body.runs.length === LIST_LIMIT, more: "idle" });
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setLoad({ status: "failed", message: "Agent runs could not be loaded. Check your connection." });
      });

    return () => controller.abort();
  }, [listUrl, projectId, refreshKey]);

  /**
   * The next page, by offset. A run created since the first page shifts the
   * list down by one, so rows already shown are skipped by id rather than
   * listed twice. Runs are never deleted by the application, so nothing is
   * skipped.
   */
  const loadMore = () => {
    if (load.status !== "loaded" || load.more === "loading") return;
    const shown = load.runs;
    setLoad({ ...load, more: "loading" });
    fetch(listUrl(shown.length), { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const page = ((await response.json()) as { runs: AgentRun[] }).runs;
        const seen = new Set(shown.map((run) => run.id));
        setLoad((current) =>
          current.status === "loaded" && current.runs === shown
            ? {
                status: "loaded",
                runs: [...shown, ...page.filter((run) => !seen.has(run.id))],
                hasMore: page.length === LIST_LIMIT,
                more: "idle",
              }
            : current,
        );
      })
      .catch(() =>
        setLoad((current) => (current.status === "loaded" && current.runs === shown ? { ...current, more: "failed" } : current)),
      );
  };

  const toggle = useCallback(
    (runId: string) => {
      if (expanded === runId) return setExpanded(null);
      setExpanded(runId);
      setAttempts((current) => ({ ...current, [runId]: { status: "loading" } }));
      fetch(`/api/agent-runs/${encodeURIComponent(runId)}`, { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error(String(response.status));
          const body = (await response.json()) as { attempts: AgentRunAttempt[] };
          setAttempts((current) => ({ ...current, [runId]: { status: "loaded", attempts: body.attempts } }));
        })
        .catch(() => setAttempts((current) => ({ ...current, [runId]: { status: "failed" } })));
    },
    [expanded],
  );

  const projectName = projects.find((project) => project.id === projectId)?.name ?? projectId;

  return (
    <Panel aria-busy={load.status === "loading" || undefined}>
      <PanelHeader
        eyebrow="Agent runtime"
        title="Run History"
        description="Tasks the agents have been asked to run on a project, how each ended, and every attempt behind it."
        actions={
          <>
            <Badge tone="accent" title="Read from this product's stored agent runs and attempts. Not fixture data.">
              Observed
            </Badge>
            <Button icon="refresh" onClick={() => setRefreshKey((key) => key + 1)} disabled={!projectId}>
              Refresh
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-3 sm:px-5">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-[11.5px] text-fg-subtle sm:max-w-64">
          Project
          <Select
            size="sm"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            options={projects.map((project) => ({ value: project.id, label: project.name }))}
          />
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-[11.5px] text-fg-subtle sm:max-w-64">
          Agent
          <Select
            size="sm"
            value={agentId}
            onChange={(event) => setAgentId(event.target.value)}
            options={[
              { value: "", label: "All agents" },
              ...AGENT_REGISTRY.map((agent) => ({ value: agent.id, label: agent.name })),
            ]}
          />
        </label>
      </div>

      {!projectId ? (
        <EmptyState icon="projects" title="No projects" description="Create a project to run agent tasks on it." />
      ) : load.status === "loading" ? (
        <div className="space-y-3 p-4 sm:p-5">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-14 w-full" />
          ))}
        </div>
      ) : load.status === "unavailable" ? (
        <EmptyState
          icon="info"
          title="Agent runs are not stored in this deployment"
          description="Run history needs the Supabase data source. With the mock project roster, nothing is executed or recorded."
        />
      ) : load.status === "failed" ? (
        <EmptyState
          icon="alert"
          title="Run history is unavailable"
          description={load.message}
          action={<Button icon="refresh" onClick={() => setRefreshKey((key) => key + 1)}>Try again</Button>}
        />
      ) : load.runs.length === 0 ? (
        <EmptyState
          icon="inbox"
          title="No runs yet"
          description={`No agent task has been run on ${projectName}${agentId ? ` by ${AGENT_NAMES[agentId as keyof typeof AGENT_NAMES]}` : ""}.`}
        />
      ) : (
        <>
          <ul className="divide-y divide-border">
            {load.runs.map((run) => (
              <RunRow
                key={run.id}
                run={run}
                open={expanded === run.id}
                onToggle={() => toggle(run.id)}
                attempts={attempts[run.id]}
              />
            ))}
          </ul>
          {(load.hasMore || load.more === "failed") && (
            <div className="flex flex-wrap items-center justify-center gap-3 border-t border-border px-4 py-3">
              {load.more === "failed" && (
                <span className="text-[12px] text-critical">Older runs could not be loaded.</span>
              )}
              <Button icon="chevron-down" onClick={loadMore} disabled={load.more === "loading"}>
                {load.more === "loading" ? "Loading…" : load.more === "failed" ? "Try again" : "Load older runs"}
              </Button>
            </div>
          )}
        </>
      )}

      <PanelFooter>
        <span>Stored runs, newest first. Times in UTC.</span>
        {load.status === "loaded" && (
          <span>
            {load.hasMore ? `Latest ${load.runs.length}` : `${load.runs.length} run${load.runs.length === 1 ? "" : "s"}`}
          </span>
        )}
      </PanelFooter>
    </Panel>
  );
}

function RunRow({
  run,
  open,
  onToggle,
  attempts,
}: {
  run: AgentRun;
  open: boolean;
  onToggle: () => void;
  attempts: AttemptsLoad | undefined;
}) {
  const status = STATUS[run.status];
  const task = getTaskType(run.taskType);
  const source = run.status === "completed" ? sourceLabel(run) : null;
  const upstream = upstreamRunId(run);
  const panelId = `run-attempts-${run.id}`;

  return (
    <li className="px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={status.tone} dot pulse={run.status === "running"} title={status.title}>
              {status.label}
            </Badge>
            <span className="text-[13px] font-medium text-fg">{task?.label ?? run.taskType}</span>
            <span className="text-[12.5px] text-fg-muted">· {AGENT_NAMES[run.agentId]}</span>
          </div>
          <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11.5px] text-fg-subtle">
            <div className="flex gap-1">
              <dt>Created</dt>
              <dd className="text-fg-muted">{stamp(run.createdAt)}</dd>
            </div>
            <div className="flex gap-1">
              <dt>Started</dt>
              <dd className="text-fg-muted">{stamp(run.startedAt)}</dd>
            </div>
            <div className="flex gap-1">
              <dt>Finished</dt>
              <dd className="text-fg-muted">{stamp(run.finishedAt)}</dd>
            </div>
            <div className="flex gap-1">
              <dt>Attempts</dt>
              <dd className="text-fg-muted">
                {run.attemptCount} of {run.maxAttempts}
                {run.autoRetryCount > 0 ? ` (${run.autoRetryCount} automatic ${run.autoRetryCount === 1 ? "retry" : "retries"})` : ""}
              </dd>
            </div>
            {upstream && (
              <div className="flex gap-1">
                <dt>Hand-off from</dt>
                <dd className="text-fg-muted" title="The completed review this priority review was asked to read. Its output is model-generated advice, not a measurement.">
                  run {upstream}
                </dd>
              </div>
            )}
          </dl>
        </div>
        <Button
          variant="ghost"
          icon="chevron-down"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
        >
          {open ? "Hide attempts" : "Attempts"}
        </Button>
      </div>

      {run.status === "completed" && run.resultSummary && (
        <div className="mt-2 rounded-md border border-border bg-surface-raised px-3 py-2">
          <p className="text-[12.5px] leading-relaxed whitespace-pre-line text-fg-muted">{run.resultSummary}</p>
          {source && <p className="mt-1.5 text-[11px] text-fg-subtle">{source}</p>}
        </div>
      )}

      {run.error && run.status !== "completed" && run.status !== "cancelled" && (
        <p className="mt-2 text-[12px] text-critical">
          {run.status === "failed" ? "Failed: " : "Last attempt failed: "}
          {run.error.message}
        </p>
      )}

      {run.status === "queued" && run.nextAttemptAt && (
        <p className="mt-1 text-[11.5px] text-fg-subtle">Automatic retry not before {stamp(run.nextAttemptAt)}.</p>
      )}

      {open && (
        <div id={panelId} className="mt-3 rounded-md border border-border">
          {!attempts || attempts.status === "loading" ? (
            <div className="p-3">
              <Skeleton className="h-8 w-full" />
            </div>
          ) : attempts.status === "failed" ? (
            <p className="p-3 text-[12px] text-fg-muted">Attempt history could not be loaded.</p>
          ) : attempts.attempts.length === 0 ? (
            <p className="p-3 text-[12px] text-fg-muted">No attempt has started yet.</p>
          ) : (
            <ol className="divide-y divide-border">
              {attempts.attempts.map((attempt) => (
                <li key={attempt.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-[11.5px]">
                  <span className="font-medium text-fg">Attempt {attempt.attemptNumber}</span>
                  <Badge tone={OUTCOME[attempt.outcome].tone}>{OUTCOME[attempt.outcome].label}</Badge>
                  <span className="text-fg-subtle">
                    Started <span className="text-fg-muted">{stamp(attempt.startedAt)}</span>
                  </span>
                  <span className="text-fg-subtle">
                    Last heartbeat <span className="text-fg-muted">{stamp(attempt.heartbeatAt)}</span>
                  </span>
                  <span className="text-fg-subtle">
                    Finished <span className="text-fg-muted">{stamp(attempt.finishedAt)}</span>
                  </span>
                  {attempt.error && <span className="basis-full text-critical">{attempt.error.message}</span>}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </li>
  );
}
