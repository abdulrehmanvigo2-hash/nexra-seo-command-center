"use client";

import { useId, useRef, useState } from "react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import {
  TASK_EVENT_META,
  TASK_OWNING_AGENTS,
  TASK_STATUS_META,
  TASK_TRANSITIONS,
  agentTaskUrl,
  isTerminalTaskStatus,
  type AgentTask,
  type AgentTaskEvent,
  type AgentTaskStatus,
  type TaskOwningAgent,
} from "@/lib/agent-tasks/contract";
import { handoffFor, handoffUnsupportedReason, taskActionFailure, type HandoffRecordKind } from "@/lib/agent-tasks/handoff";
import { describeTaskRunOutcome, type TaskRunOutcome } from "@/lib/agent-tasks/outcome";
import type { HandoffCrawlChoice } from "@/lib/agent-tasks/service";
import { formatFullDate, formatTimeUtc } from "@/lib/format";
import { AGENT_NAMES } from "@/lib/mock/agents/registry";
import type { AgentRun } from "@/types/agent-run";

/**
 * The operator controls of one live task (Project Manager task workflow):
 * change its status along the fixed map, change its owning agent, hand it
 * off to that agent, and view its history.
 *
 * Every write is one confirmed POST to the task endpoint, and every answer
 * is shown as what was recorded, never as work done. A status or owner
 * change tells no agent anything. A handoff opens a confirmation first,
 * naming the one task the owning agent would be handed; only "Confirm
 * handoff" posts, once, and the answer names the queued run — which the
 * scheduled worker or a separate "Run Now" on the project's review panel
 * executes, never this control. An owner with no supported handoff shows
 * that, and offers nothing. An owner whose review reads one record (one of
 * the project's own-site crawls, or one competitor domain recorded at
 * intake) lists those records in the confirmation; the operator chooses one,
 * the server checks it, and nothing is chosen on the operator's behalf. The
 * history view also shows what became of the
 * newest handoff, as the server computed it from the linked run: read only,
 * and the task's status is never changed by it.
 */

type Mode = "idle" | "status" | "owner" | "handoff" | "history";

type Outcome =
  | { readonly kind: "none" }
  | { readonly kind: "sending" }
  | { readonly kind: "refused"; readonly message: string }
  | { readonly kind: "applied"; readonly message: string };

type Choices =
  | { readonly status: "loading" }
  | { readonly status: "failed" }
  | { readonly status: "crawl"; readonly crawls: readonly HandoffCrawlChoice[] }
  | { readonly status: "competitor"; readonly domains: readonly string[] }
  | { readonly status: "none" };

type History =
  | { readonly status: "loading" }
  | { readonly status: "failed" }
  | { readonly status: "loaded"; readonly events: readonly AgentTaskEvent[]; readonly outcome: TaskRunOutcome | null };

export function TaskRowControls({ task, onChanged }: { task: AgentTask; onChanged: (task: AgentTask) => void }) {
  const ids = { status: useId(), owner: useId() };
  const [mode, setMode] = useState<Mode>("idle");
  const [outcome, setOutcome] = useState<Outcome>({ kind: "none" });
  const [history, setHistory] = useState<History | null>(null);
  const [choices, setChoices] = useState<Choices | null>(null);
  /** The record the operator chose for a record-reading handoff; empty until they choose. */
  const [chosen, setChosen] = useState("");
  const allowed = TASK_TRANSITIONS[task.status];
  const [nextStatus, setNextStatus] = useState<AgentTaskStatus | "">(allowed[0] ?? "");
  const [nextOwner, setNextOwner] = useState<TaskOwningAgent>(task.owningAgent);
  /** A ref refuses the second click of a pair before React has re-rendered. */
  const sending = useRef(false);
  const terminal = isTerminalTaskStatus(task.status);
  const mapping = handoffFor(task.owningAgent);
  const unsupported = handoffUnsupportedReason(task.owningAgent);

  const open = (next: Mode) => {
    setOutcome({ kind: "none" });
    // Each form starts from the task as it is now, never from an earlier pick.
    if (next === "status") setNextStatus(allowed[0] ?? "");
    if (next === "owner") setNextOwner(task.owningAgent);
    setMode((current) => (current === next ? "idle" : next));
    if (next === "history") void loadHistory();
    if (next === "handoff") {
      setChosen("");
      if (mapping?.record) void loadChoices();
    }
  };

  const post = async (body: Record<string, unknown>, applied: (body: Record<string, unknown>) => { task: AgentTask; message: string }) => {
    if (sending.current) return;
    sending.current = true;
    setOutcome({ kind: "sending" });
    try {
      const response = await fetch(`/api/agent-tasks/${encodeURIComponent(task.id)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project: task.projectId, ...body }),
        cache: "no-store",
      });
      const answer: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setOutcome({ kind: "refused", message: taskActionFailure(response.status, answer) });
        const refusedTask = (answer as { task?: AgentTask } | null)?.task;
        if (refusedTask) onChanged(refusedTask);
        return;
      }
      const result = applied((answer ?? {}) as Record<string, unknown>);
      setOutcome({ kind: "applied", message: result.message });
      setMode("idle");
      onChanged(result.task);
    } catch {
      setOutcome({ kind: "refused", message: taskActionFailure(0, null) });
    } finally {
      sending.current = false;
    }
  };

  const loadChoices = async () => {
    setChoices({ status: "loading" });
    try {
      const response = await fetch(`${agentTaskUrl(task.id, task.projectId)}&view=handoff-choices`, { cache: "no-store" });
      if (!response.ok) return setChoices({ status: "failed" });
      const body = (await response.json()) as { kind?: string; crawls?: HandoffCrawlChoice[]; domains?: string[] };
      if (body.kind === "crawl" && Array.isArray(body.crawls)) return setChoices({ status: "crawl", crawls: body.crawls });
      if (body.kind === "competitor" && Array.isArray(body.domains)) return setChoices({ status: "competitor", domains: body.domains });
      setChoices({ status: "none" });
    } catch {
      setChoices({ status: "failed" });
    }
  };

  const loadHistory = async () => {
    setHistory({ status: "loading" });
    try {
      const response = await fetch(agentTaskUrl(task.id, task.projectId), { cache: "no-store" });
      if (!response.ok) return setHistory({ status: "failed" });
      const body = (await response.json()) as { events?: AgentTaskEvent[]; outcome?: TaskRunOutcome };
      const outcome = body.outcome && typeof body.outcome === "object" && typeof body.outcome.status === "string" ? body.outcome : null;
      setHistory({ status: "loaded", events: Array.isArray(body.events) ? body.events : [], outcome });
    } catch {
      setHistory({ status: "failed" });
    }
  };

  const busy = outcome.kind === "sending";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="secondary" size="sm" onClick={() => open("status")} disabled={terminal || busy} aria-expanded={mode === "status"}>
          Change status
        </Button>
        <Button variant="secondary" size="sm" onClick={() => open("owner")} disabled={terminal || busy} aria-expanded={mode === "owner"}>
          Change owner
        </Button>
        <Button variant="secondary" size="sm" onClick={() => open("handoff")} disabled={terminal || busy || mapping === null} aria-expanded={mode === "handoff"}>
          Hand off
        </Button>
        <Button variant="ghost" size="sm" onClick={() => open("history")} disabled={busy} aria-expanded={mode === "history"}>
          View history
        </Button>
      </div>
      {terminal && <p className="text-[11.5px] text-fg-subtle">{TASK_STATUS_META[task.status].label}: no further change.</p>}
      {!terminal && mapping === null && unsupported && (
        <p className="text-[11.5px] text-fg-subtle">Handoff not supported yet for {AGENT_NAMES[task.owningAgent]}: {unsupported}.</p>
      )}

      {mode === "status" && (
        <form
          className="space-y-2 rounded-md border border-border bg-surface-raised p-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (nextStatus === "") return;
            void post({ action: "status", status: nextStatus }, (body) => ({
              task: body.task as AgentTask,
              message: `Status recorded as ${TASK_STATUS_META[nextStatus].label.toLowerCase()}. No agent was told anything.`,
            }));
          }}
          aria-busy={busy}
        >
          <label className="flex flex-col gap-1 text-[11.5px] text-fg-subtle" htmlFor={ids.status}>
            Next status (only moves the map allows from {TASK_STATUS_META[task.status].label.toLowerCase()})
            <Select
              id={ids.status}
              size="sm"
              value={nextStatus}
              onChange={(event) => setNextStatus(event.target.value as AgentTaskStatus)}
              options={allowed.map((status) => ({ value: status, label: TASK_STATUS_META[status].label }))}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="primary" size="sm" disabled={busy || nextStatus === ""}>
              {busy ? "Recording…" : "Apply status"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setMode("idle")} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {mode === "owner" && (
        <form
          className="space-y-2 rounded-md border border-border bg-surface-raised p-2"
          onSubmit={(event) => {
            event.preventDefault();
            void post({ action: "owner", owningAgent: nextOwner }, (body) => ({
              task: body.task as AgentTask,
              message: `Owner recorded as ${AGENT_NAMES[nextOwner]}. No run was queued.`,
            }));
          }}
          aria-busy={busy}
        >
          <label className="flex flex-col gap-1 text-[11.5px] text-fg-subtle" htmlFor={ids.owner}>
            Owning agent (registry agents only; nothing is inferred)
            <Select
              id={ids.owner}
              size="sm"
              value={nextOwner}
              onChange={(event) => setNextOwner(event.target.value as TaskOwningAgent)}
              options={TASK_OWNING_AGENTS.map((agent) => ({ value: agent, label: AGENT_NAMES[agent] }))}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="primary" size="sm" disabled={busy || nextOwner === task.owningAgent}>
              {busy ? "Recording…" : "Apply owner"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setMode("idle")} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {mode === "handoff" && mapping && (
        <div className="space-y-2 rounded-md border border-border bg-surface-raised p-2" aria-busy={busy}>
          <p className="text-[11.5px] text-fg-muted">
            Hands this task to <span className="font-medium text-fg">{AGENT_NAMES[task.owningAgent]}</span> as one queued{" "}
            <span className="font-mono">{mapping.taskType}</span> run: {mapping.label}. The run carries this task&apos;s id as its source and waits for the scheduled
            worker, or for Run Now on the project&apos;s review panel for that review. Nothing runs when you confirm.
          </p>
          {mapping.record && <RecordChoice kind={mapping.record} choices={choices} chosen={chosen} onChoose={setChosen} disabled={busy} />}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={busy || (mapping.record !== undefined && chosen === "")}
              onClick={() =>
                void post({ action: "handoff", ...handoffRecordField(mapping.record, chosen) }, (body) => {
                  const run = body.run as AgentRun | undefined;
                  const duplicate = body.duplicate === true;
                  return {
                    task: body.task as AgentTask,
                    message: run
                      ? `${duplicate ? "An identical run was already queued" : "One run queued"}: ${run.taskType} ${run.id.slice(0, 8)}… for ${AGENT_NAMES[task.owningAgent]}, status ${run.status}. Not executed.`
                      : "Handoff recorded.",
                  };
                })
              }
            >
              {busy ? "Queueing…" : "Confirm handoff"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setMode("idle")} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {mode === "history" && (
        <div className="rounded-md border border-border bg-surface-raised p-2">
          {history === null || history.status === "loading" ? (
            <p className="text-[11.5px] text-fg-subtle">Loading history…</p>
          ) : history.status === "failed" ? (
            <p className="text-[11.5px] text-warning" role="status">
              The history could not be read. Nothing here is estimated.
            </p>
          ) : (
            <div className="space-y-2">
              <HandoffOutcome outcome={history.outcome} />
              <ol className="space-y-1 text-[11.5px]">
                {history.events.map((event) => (
                  <li key={event.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="whitespace-nowrap font-mono text-fg-subtle">
                      {formatFullDate(event.createdAt)} {formatTimeUtc(event.createdAt)}
                    </span>
                    <Badge tone="neutral">{TASK_EVENT_META[event.type]}</Badge>
                    <span className="text-fg-muted">{describeEvent(event)}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}

      {outcome.kind === "refused" && (
        <p className="text-[11.5px] text-warning" role="status">
          <span className="font-medium">Not applied.</span> {outcome.message}
        </p>
      )}
      {outcome.kind === "applied" && (
        <p className="text-[11.5px] text-fg-muted" role="status">
          <span className="font-medium text-fg">Recorded.</span> {outcome.message}
        </p>
      )}
    </div>
  );
}

/** The one record field a record-reading handoff sends: the operator's choice, never a default. */
function handoffRecordField(kind: HandoffRecordKind | undefined, chosen: string): Record<string, string> {
  if (kind === undefined || chosen === "") return {};
  return kind === "crawl" ? { crawlId: chosen } : { competitorDomain: chosen };
}

/**
 * The records an operator may choose for a record-reading handoff, read from
 * the server's own list: the project's own-site crawls (never a competitor's)
 * or the competitor domains recorded at intake. Starts with nothing chosen.
 */
function RecordChoice({
  kind,
  choices,
  chosen,
  onChoose,
  disabled,
}: {
  kind: HandoffRecordKind;
  choices: Choices | null;
  chosen: string;
  onChoose: (value: string) => void;
  disabled: boolean;
}) {
  const id = useId();
  const noun = kind === "crawl" ? "own-site crawl" : "recorded competitor domain";
  if (choices === null || choices.status === "loading") return <p className="text-[11.5px] text-fg-subtle">Loading the choosable records…</p>;
  if (choices.status === "failed" || choices.status === "none") {
    return (
      <p className="text-[11.5px] text-warning" role="status">
        The choosable records could not be read. Nothing can be handed off until they are.
      </p>
    );
  }
  const options =
    choices.status === "crawl"
      ? choices.crawls.map((crawl) => ({
          value: crawl.id,
          label: `${formatFullDate(crawl.startedAt)} ${formatTimeUtc(crawl.startedAt)} · ${crawl.status} · ${crawl.pagesFetched} page${crawl.pagesFetched === 1 ? "" : "s"} fetched · ${crawl.id.slice(0, 8)}…`,
        }))
      : choices.domains.map((domain) => ({ value: domain, label: domain }));
  if (options.length === 0) {
    return (
      <p className="text-[11.5px] text-warning" role="status">
        {kind === "crawl"
          ? "This project has no own-site crawl recorded. Run a crawl of the project's site first; a competitor crawl cannot be handed off here."
          : "This project has no competitor domain recorded at intake. Record one on the project first."}
      </p>
    );
  }
  return (
    <label htmlFor={id} className="flex max-w-md flex-col gap-1 text-[11.5px] text-fg-subtle">
      Choose the {noun} this review reads (the server checks it is this project&apos;s)
      <Select
        id={id}
        size="sm"
        value={chosen}
        disabled={disabled}
        onChange={(event) => onChoose(event.target.value)}
        options={[{ value: "", label: `Choose a ${noun}…` }, ...options]}
      />
    </label>
  );
}

const OUTCOME_BADGE: Readonly<Record<TaskRunOutcome["status"], { readonly label: string; readonly tone: BadgeTone }>> = {
  none: { label: "No handoff", tone: "neutral" },
  unavailable: { label: "Outcome unavailable", tone: "warning" },
  queued: { label: "Run queued", tone: "neutral" },
  running: { label: "Run running", tone: "accent" },
  retrying: { label: "Run retrying", tone: "warning" },
  completed: { label: "Run completed", tone: "positive" },
  failed: { label: "Run failed", tone: "critical" },
  cancelled: { label: "Run cancelled", tone: "neutral" },
};

/**
 * What became of the newest handoff, as read from its run now. Mirrors the
 * review panels' rendering of a run — the fixed error code and message, the
 * screened summary — and offers no control: nothing here runs, retries or
 * changes the task.
 */
function HandoffOutcome({ outcome }: { outcome: TaskRunOutcome | null }) {
  if (outcome === null) {
    return (
      <p className="text-[11.5px] text-warning" role="status">
        The handoff outcome could not be read. Nothing here is estimated.
      </p>
    );
  }
  const badge = OUTCOME_BADGE[outcome.status];
  return (
    <div className="space-y-1 border-b border-border pb-2 text-[11.5px]">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="font-medium text-fg">Handoff outcome</span>
        <Badge tone={badge.tone}>{badge.label}</Badge>
        <span className="text-fg-muted">{describeTaskRunOutcome(outcome)}</span>
      </div>
      {"error" in outcome && outcome.error && (
        <p className="text-critical">
          <span className="font-medium">{outcome.error.code}</span> — {outcome.error.message}
        </p>
      )}
      {outcome.status === "completed" && outcome.resultSummary && (
        <p className="max-h-48 overflow-y-auto whitespace-pre-wrap text-fg-muted">{outcome.resultSummary}</p>
      )}
      {outcome.status !== "none" && outcome.status !== "unavailable" && (
        <p className="text-fg-subtle">
          The task&apos;s status is not changed by its run. Full run history, including attempts, is on the Agents screen.
        </p>
      )}
    </div>
  );
}

function describeEvent(event: AgentTaskEvent): string {
  switch (event.type) {
    case "created":
      return "recorded by an operator";
    case "status-changed":
      return `${event.fromStatus ? TASK_STATUS_META[event.fromStatus].label : "?"} → ${event.toStatus ? TASK_STATUS_META[event.toStatus].label : "?"}`;
    case "owner-changed":
      return `${event.fromAgent ? AGENT_NAMES[event.fromAgent] : "?"} → ${event.toAgent ? AGENT_NAMES[event.toAgent] : "?"}`;
    case "handoff-requested":
      return `to ${event.toAgent ? AGENT_NAMES[event.toAgent] : "?"}`;
    case "handoff-run-linked":
      return `run ${event.runId ? `${event.runId.slice(0, 8)}…` : "?"} queued for ${event.toAgent ? AGENT_NAMES[event.toAgent] : "?"}; not executed by this record`;
  }
}
