"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge, PriorityBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/field";
import { Meter } from "@/components/ui/meter";
import { Panel, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import {
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { formatShortDate } from "@/lib/format";
import { AGENT_NAMES } from "@/lib/mock/seo";
import {
  TASK_DUE_META,
  TASK_STATUS_META,
  TASK_STATUS_ORDER,
} from "@/lib/mock/projects";
import { agentInitials } from "@/components/projects/project-chrome";
import type { ProjectTask, ProjectTaskStatus } from "@/types/project";

/**
 * The delivery board for this project.
 *
 * A snapshot, not the task manager — that module is sequenced later. Moving a
 * task between states is frontend state over the fixture; nothing is assigned,
 * scheduled, or executed (CLAUDE.md §4).
 */

type Filter = ProjectTaskStatus | "all";

export function ProjectTasks({
  tasks,
  statuses,
  onStatusChange,
  preview = false,
  onViewAll,
}: {
  tasks: readonly ProjectTask[];
  statuses: Readonly<Record<string, ProjectTaskStatus>>;
  onStatusChange: (id: string, status: ProjectTaskStatus) => void;
  preview?: boolean;
  onViewAll?: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");

  const resolved = useMemo(
    () =>
      tasks.map((task) => {
        const status = statuses[task.id] ?? task.status;
        return {
          ...task,
          status,
          // The bar must agree with the badge: a task moved to completed by
          // hand is complete, and one moved back to todo has not started.
          progress:
            status === "completed" ? 100 : status === "todo" ? 0 : task.progress,
          dueState: status === "completed" ? "delivered" : task.dueState,
        };
      }),
    [tasks, statuses],
  );

  const counts = useMemo(() => {
    const tally: Record<string, number> = { all: resolved.length };
    for (const task of resolved) {
      tally[task.status] = (tally[task.status] ?? 0) + 1;
    }
    return tally;
  }, [resolved]);

  const openTasks = resolved.filter((task) => task.status !== "completed");
  const overdue = openTasks.filter((task) => task.dueState === "overdue").length;

  const visible = (
    filter === "all" ? resolved : resolved.filter((task) => task.status === filter)
  ).slice(0, preview ? 5 : undefined);

  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader
        eyebrow="Delivery"
        title="Tasks"
        description={
          preview
            ? "What the team and its agents are working on next."
            : "The current board for this project, most urgent first."
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {overdue > 0 && (
              <Badge tone="critical" dot>
                {overdue} overdue
              </Badge>
            )}
            <Badge tone="accent" dot>
              {openTasks.length} active
            </Badge>
          </div>
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
              ...TASK_STATUS_ORDER.map((status) => ({
                value: status,
                label: TASK_STATUS_META[status].label,
                count: counts[status] ?? 0,
              })),
            ]}
          />
        </div>
      )}

      <Table caption="Project tasks with owner, due state, and progress">
        <TableHead>
          <TableRow>
            <TableHeaderCell>Task</TableHeaderCell>
            <TableHeaderCell>Priority</TableHeaderCell>
            <TableHeaderCell>Agent</TableHeaderCell>
            <TableHeaderCell>Due</TableHeaderCell>
            <TableHeaderCell>Progress</TableHeaderCell>
            <TableHeaderCell>Status</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {visible.length === 0 ? (
            <TableEmptyRow colSpan={6}>
              <EmptyState
                size="sm"
                icon="inbox"
                title="No tasks in this state"
                description="Nothing on this board matches the current filter."
              />
            </TableEmptyRow>
          ) : (
            visible.map((task) => (
              <TableRow key={task.id}>
                <TableCell header className="max-w-[320px]">
                  <span className="block truncate">{task.title}</span>
                </TableCell>

                <TableCell>
                  <PriorityBadge priority={task.priority} />
                </TableCell>

                <TableCell>
                  <span className="inline-flex items-center gap-2 whitespace-nowrap">
                    <span
                      aria-hidden="true"
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border-strong bg-surface text-[9.5px] font-semibold text-fg-subtle"
                    >
                      {agentInitials(task.agent)}
                    </span>
                    <span className="hidden lg:inline">
                      {AGENT_NAMES[task.agent]}
                    </span>
                    <span className="sr-only lg:hidden">
                      {AGENT_NAMES[task.agent]}
                    </span>
                  </span>
                </TableCell>

                <TableCell>
                  <span className="inline-flex items-center gap-2 whitespace-nowrap">
                    <Badge tone={TASK_DUE_META[task.dueState].tone}>
                      {TASK_DUE_META[task.dueState].label}
                    </Badge>
                    <span className="hidden text-[11px] text-fg-subtle xl:inline">
                      {formatShortDate(task.due)}
                    </span>
                  </span>
                </TableCell>

                <TableCell>
                  <span className="flex items-center gap-2">
                    <span className="tabular w-8 shrink-0 text-right text-[11.5px]">
                      {task.progress}%
                    </span>
                    <span className="w-16 shrink-0">
                      <Meter
                        size="sm"
                        value={task.progress}
                        tone={
                          task.status === "blocked"
                            ? "critical"
                            : task.status === "review"
                              ? "warning"
                              : task.progress === 100
                                ? "positive"
                                : "accent"
                        }
                        label={`${task.title} progress`}
                      />
                    </span>
                  </span>
                </TableCell>

                <TableCell>
                  <label>
                    <span className="sr-only">Status for {task.title}</span>
                    <span className="block w-32">
                      <Select
                        size="sm"
                        value={task.status}
                        onChange={(event) =>
                          onStatusChange(
                            task.id,
                            event.target.value as ProjectTaskStatus,
                          )
                        }
                        options={TASK_STATUS_ORDER.map((status) => ({
                          value: status,
                          label: TASK_STATUS_META[status].label,
                        }))}
                      />
                    </span>
                  </label>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <PanelFooter className="mt-auto">
        <span>
          {resolved.filter((task) => task.status === "completed").length} of{" "}
          {resolved.length} delivered
        </span>
        {preview && onViewAll ? (
          <Button variant="ghost" onClick={onViewAll}>
            Open the board
            <Icon name="arrow-right" className="h-4 w-4" />
          </Button>
        ) : (
          <span>The full task module arrives in a later phase.</span>
        )}
      </PanelFooter>
    </Panel>
  );
}
