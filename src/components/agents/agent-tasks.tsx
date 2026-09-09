"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge, PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/field";
import { Meter } from "@/components/ui/meter";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import { ListExpander } from "@/components/agents/list-expander";
import { cn } from "@/lib/cn";
import { formatRelative } from "@/lib/format";
import {
  AGENT_NAMES,
  AGENT_TASK_DUE_META,
  AGENT_TASK_STATUS_META,
  AGENT_TASK_STATUS_ORDER,
} from "@/lib/mock/agents";
import type { AgentTask, AgentTaskStatus } from "@/types/agent";

/**
 * The cross-project task board.
 *
 * These are the projects' own delivery boards read by owner rather than by
 * project, which is why a task here carries the project it belongs to: moving
 * one is moving the same task the project's Tasks tab shows.
 *
 * Changing a status is frontend state over the fixture — nothing is dispatched
 * to an agent (CLAUDE.md §4).
 */

type Filter = AgentTaskStatus | "all";

/** Rows shown before the list is expanded, and inside an overview preview. */
const COLLAPSED_ROWS = 8;
const PREVIEW_ROWS = 5;

export function AgentTasks({
  tasks,
  statuses,
  onStatusChange,
  referenceIso,
  /** Hides the owner column, for an agent's own workspace. */
  hideAgent = false,
  /** Renders the shortened preview shown on an overview tab. */
  preview = false,
  onViewAll,
  title = "Active Agent Tasks",
  description = "Every task in flight across the portfolio, most urgent first.",
}: {
  tasks: readonly AgentTask[];
  statuses: Readonly<Record<string, AgentTaskStatus>>;
  onStatusChange: (id: string, status: AgentTaskStatus) => void;
  referenceIso: string;
  hideAgent?: boolean;
  preview?: boolean;
  onViewAll?: () => void;
  title?: string;
  description?: string;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState(false);

  const resolved = useMemo(
    () =>
      tasks.map((task) => ({
        ...task,
        status: statuses[task.id] ?? task.status,
      })),
    [tasks, statuses],
  );

  const counts = useMemo(() => {
    const tally: Record<string, number> = { all: resolved.length };
    for (const task of resolved) {
      tally[task.status] = (tally[task.status] ?? 0) + 1;
    }
    return tally;
  }, [resolved]);

  const open = resolved.filter((task) => task.status !== "completed").length;

  const matching =
    filter === "all"
      ? resolved
      : resolved.filter((task) => task.status === filter);

  // The board covers every project, which is far more than fits on a page.
  // Rows are sorted worst-first, so the collapsed view is the urgent end.
  const limit = preview ? PREVIEW_ROWS : expanded ? matching.length : COLLAPSED_ROWS;
  const visible = matching.slice(0, limit);

  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader
        eyebrow="Task operations"
        title={title}
        description={description}
        actions={
          <Badge tone={open > 0 ? "accent" : "positive"} dot pulse={open > 0}>
            {open} open of {resolved.length}
          </Badge>
        }
      />

      {!preview && (
        <div className="border-b border-border px-4 py-3 sm:px-5">
          <Segmented
            label="Filter tasks by status"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all" as const, label: "All", count: counts.all },
              ...AGENT_TASK_STATUS_ORDER.map((status) => ({
                value: status,
                label: AGENT_TASK_STATUS_META[status].label,
                count: counts[status] ?? 0,
              })),
            ]}
          />
        </div>
      )}

      {visible.length === 0 ? (
        <EmptyState
          icon="check"
          title="Nothing in this state"
          description="No tasks are sitting in this state right now. Clear the filter to see the whole board."
        />
      ) : (
        <PanelBody className="space-y-2.5">
          {visible.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              referenceIso={referenceIso}
              hideAgent={hideAgent}
              compact={preview}
              onStatusChange={onStatusChange}
            />
          ))}
        </PanelBody>
      )}

      <PanelFooter className="mt-auto">
        <span>
          {counts.blocked ?? 0} blocked · {counts.review ?? 0} in review
        </span>
        {preview && onViewAll ? (
          <Button variant="ghost" onClick={onViewAll}>
            View the full board
            <Icon name="arrow-right" className="h-4 w-4" />
          </Button>
        ) : (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>State changes are held in this session only.</span>
            <ListExpander
              expanded={expanded}
              onToggle={() => setExpanded((open) => !open)}
              shown={COLLAPSED_ROWS}
              total={matching.length}
              noun="tasks"
            />
          </span>
        )}
      </PanelFooter>
    </Panel>
  );
}

function TaskRow({
  task,
  referenceIso,
  hideAgent,
  compact,
  onStatusChange,
}: {
  task: AgentTask;
  referenceIso: string;
  hideAgent: boolean;
  compact: boolean;
  onStatusChange: (id: string, status: AgentTaskStatus) => void;
}) {
  const meta = AGENT_TASK_STATUS_META[task.status];
  const due = AGENT_TASK_DUE_META[task.dueState];
  const done = task.status === "completed";

  return (
    <article
      className={cn(
        "rounded-md border border-l-2 border-border bg-surface-raised px-3.5 py-3 transition-colors",
        task.status === "blocked"
          ? "border-l-critical"
          : task.status === "review"
            ? "border-l-warning"
            : done
              ? "border-l-positive"
              : "border-l-accent",
        done && "opacity-60",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={meta.status} label={meta.label} />
            <PriorityBadge priority={task.priority} />
            <Badge tone={due.tone}>{due.label}</Badge>
          </div>

          <h4
            className={cn(
              "mt-2 text-[13px] leading-snug font-semibold text-fg",
              done && "line-through",
            )}
          >
            {task.title}
          </h4>

          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-fg-subtle">
            <Link
              href={`/projects/${task.projectId}`}
              className="inline-flex items-center gap-1.5 text-fg-muted transition-colors hover:text-accent"
            >
              <Icon name="projects" className="h-3.5 w-3.5" />
              {task.projectName}
            </Link>
            {!hideAgent && (
              <Link
                href={`/agents/${task.agent}`}
                className="inline-flex items-center gap-1.5 transition-colors hover:text-accent"
              >
                <Icon name="agents" className="h-3.5 w-3.5" />
                {AGENT_NAMES[task.agent]}
              </Link>
            )}
            {task.startedAt && (
              <span className="inline-flex items-center gap-1.5">
                <Icon name="clock" className="h-3.5 w-3.5" />
                Started {formatRelative(task.startedAt, referenceIso)}
              </span>
            )}
          </p>
        </div>

        <div className="flex w-full shrink-0 items-center gap-2.5 sm:w-40">
          <Meter
            className="flex-1"
            size="sm"
            value={task.progress}
            tone={meta.meter}
            label={`${task.title} progress`}
          />
          <span className="tabular shrink-0 text-[11.5px] text-fg-muted">
            {task.progress}%
          </span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-2.5 text-[11.5px] text-fg-subtle">
        <span className="inline-flex items-center gap-1.5">
          <Icon name="layers" className="h-3.5 w-3.5" />
          {task.dependency ? (
            <>Waiting on {AGENT_NAMES[task.dependency]}</>
          ) : (
            <>No open dependency</>
          )}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Icon name="handoff" className="h-3.5 w-3.5" />
          {task.nextHandoff ? (
            <>Hands to {AGENT_NAMES[task.nextHandoff]}</>
          ) : (
            <>End of the cycle</>
          )}
        </span>

        {!compact && (
          <>
            <span className="flex-1" />
            <label className="inline-flex items-center gap-2">
              <span className="sr-only">Status for {task.title}</span>
              <span className="block w-36">
                <Select
                  size="sm"
                  value={task.status}
                  onChange={(event) =>
                    onStatusChange(
                      task.id,
                      event.target.value as AgentTaskStatus,
                    )
                  }
                  options={AGENT_TASK_STATUS_ORDER.map((status) => ({
                    value: status,
                    label: AGENT_TASK_STATUS_META[status].label,
                  }))}
                />
              </span>
            </label>
          </>
        )}
      </div>
    </article>
  );
}
