"use client";

import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Select, TextInput } from "@/components/ui/field";
import {
  TASK_OWNING_AGENTS,
  TASK_PRIORITIES,
  TASK_PRIORITY_META,
  TASK_TITLE_MAX_LENGTH,
  normaliseTaskTitle,
  type AgentTask,
  type AgentTaskPriority,
  type TaskOwningAgent,
} from "@/lib/agent-tasks/contract";
import { createTaskFailure, type TaskProposal } from "@/lib/agent-tasks/proposals";
import { AGENT_NAMES } from "@/lib/mock/agents/registry";

/**
 * "Record as task": an operator turns something this product holds — a
 * completed SEO Director review, an observed query — into one persisted
 * task for one agent (Project Manager real task core).
 *
 * Two deliberate steps. The first click opens the form with a proposed
 * title, a prefilled owning agent and a default priority; nothing is sent.
 * The second, "Create task", posts once to the tasks endpoint, which writes
 * the row through the one database function. The answer is shown as what
 * was recorded, never as work done: no agent is queued, executed or told
 * anything by a task existing. A refusal is named in the operator's terms.
 */
export function RecordTaskControl({
  projectId,
  proposal,
  compact = false,
}: {
  projectId: string;
  proposal: TaskProposal;
  /** Inside a table row: a smaller trigger and a stacked form. */
  compact?: boolean;
}) {
  const ids = { title: useId(), agent: useId(), priority: useId() };
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(proposal.title);
  const [owningAgent, setOwningAgent] = useState<TaskOwningAgent>(proposal.owningAgent);
  const [priority, setPriority] = useState<AgentTaskPriority>("medium");
  const [state, setState] = useState<{ status: "idle" } | { status: "sending" } | { status: "refused"; message: string } | { status: "created"; task: AgentTask }>({ status: "idle" });
  /** A ref refuses the second click of a pair before React has re-rendered. */
  const sending = useRef(false);

  const checkedTitle = normaliseTaskTitle(title);
  const titleError = checkedTitle.ok
    ? undefined
    : checkedTitle.reason === "blank"
      ? "A title is required."
      : checkedTitle.reason === "too-long"
        ? `At most ${TASK_TITLE_MAX_LENGTH} characters.`
        : "No control characters.";

  const create = async () => {
    if (sending.current || !checkedTitle.ok) return;
    sending.current = true;
    setState({ status: "sending" });
    try {
      const response = await fetch("/api/agent-tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project: projectId,
          title: checkedTitle.title,
          sourceKind: proposal.sourceKind,
          sourceRef: proposal.sourceRef,
          owningAgent,
          priority,
        }),
        cache: "no-store",
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setState({ status: "refused", message: createTaskFailure(response.status, body) });
        return;
      }
      const task = (body as { task?: AgentTask } | null)?.task;
      setState(task ? { status: "created", task } : { status: "refused", message: "The server accepted the request but returned no task." });
    } catch {
      setState({ status: "refused", message: createTaskFailure(0, null) });
    } finally {
      sending.current = false;
    }
  };

  if (state.status === "created") {
    return (
      <p className={compact ? "text-[11.5px] text-fg-muted" : "text-sm text-fg-muted"} role="status">
        <span className="font-medium text-fg">Task recorded in backlog.</span> “{state.task.title}” for {AGENT_NAMES[state.task.owningAgent]},{" "}
        {TASK_PRIORITY_META[state.task.priority].label.toLowerCase()} priority, from {proposal.sourceLabel}. No agent was run; it is listed under the Project Manager&apos;s
        live tasks.
      </p>
    );
  }

  if (!open) {
    return (
      <div className={compact ? "" : "space-y-1"}>
        <Button variant="secondary" size="sm" icon="inbox" onClick={() => setOpen(true)}>
          Record as task
        </Button>
        {!compact && <p className="text-xs text-fg-subtle">Opens a form. Nothing is recorded until you confirm, and no agent is run by recording a task.</p>}
      </div>
    );
  }

  return (
    <form
      className={compact ? "space-y-2 rounded-md border border-border bg-surface-raised p-2" : "space-y-3 rounded-md border border-border bg-surface-raised p-3"}
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
      aria-busy={state.status === "sending"}
    >
      <p className="text-xs text-fg-subtle">Source: {proposal.sourceLabel}. Recorded for this project only.</p>
      <Field label="Title" htmlFor={ids.title} required error={titleError} hint={titleError ? undefined : "Proposed from the source; edit it freely."}>
        <TextInput id={ids.title} size="sm" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={TASK_TITLE_MAX_LENGTH + 20} />
      </Field>
      <div className={compact ? "space-y-2" : "grid gap-3 sm:grid-cols-2"}>
        <Field label="Owning agent" htmlFor={ids.agent} required>
          <Select
            id={ids.agent}
            size="sm"
            value={owningAgent}
            onChange={(event) => setOwningAgent(event.target.value as TaskOwningAgent)}
            options={TASK_OWNING_AGENTS.map((agent) => ({ value: agent, label: AGENT_NAMES[agent] }))}
          />
        </Field>
        <Field label="Priority" htmlFor={ids.priority} required>
          <Select
            id={ids.priority}
            size="sm"
            value={priority}
            onChange={(event) => setPriority(event.target.value as AgentTaskPriority)}
            options={TASK_PRIORITIES.map((value) => ({ value, label: TASK_PRIORITY_META[value].label }))}
          />
        </Field>
      </div>
      {state.status === "refused" && (
        <p className="text-sm text-warning" role="status">
          <span className="font-medium">Not recorded.</span> {state.message}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={!checkedTitle.ok || state.status === "sending"} aria-busy={state.status === "sending"}>
          {state.status === "sending" ? "Recording…" : "Create task"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={state.status === "sending"}>
          Cancel
        </Button>
        <span className="text-xs text-fg-subtle">Creates one backlog task. It assigns nothing and runs nothing.</span>
      </div>
    </form>
  );
}
