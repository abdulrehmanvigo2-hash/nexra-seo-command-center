"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/field";
import { Panel, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { Table, TableBody, TableCell, TableEmptyRow, TableHead, TableHeaderCell, TableRow, TableSkeletonRows } from "@/components/ui/table";
import {
  TASK_PRIORITY_META,
  TASK_READ_DEFAULT_LIMIT,
  TASK_SOURCE_META,
  TASK_STATUS_META,
  agentTasksUrl,
  type AgentTask,
} from "@/lib/agent-tasks/contract";
import { formatFullDate, formatTimeUtc } from "@/lib/format";
import { AGENT_NAMES } from "@/lib/mock/agents/registry";
import type { ProjectOption } from "@/lib/projects/selection";

/**
 * The Project Manager's live tasks: the persisted rows of `nexra_agent_tasks`
 * for one stored project, read from the tasks endpoint and nothing else.
 *
 * This is the one live section on an otherwise modelled screen, and it says
 * so. It reads only what the store holds — no fixture task, count or
 * handoff is mixed in — and it offers no control: a task is recorded from
 * the record it came from (a Director result, an observed query), and
 * nothing here moves, assigns or runs one.
 */

type Load =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "unavailable" }
  | { readonly status: "failed" }
  | { readonly status: "loaded"; readonly tasks: readonly AgentTask[] };

const COLUMNS = 6;

export function LiveTasksPanel({ projects }: { projects: readonly ProjectOption[] }) {
  const [projectId, setProjectId] = useState<string>(() => projects.find((project) => project.measured)?.id ?? projects[0]?.id ?? "");
  const [load, setLoad] = useState<Load>({ status: "idle" });
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loading state belongs to this request
    setLoad({ status: "loading" });
    fetch(agentTasksUrl(projectId, { limit: TASK_READ_DEFAULT_LIMIT }), { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (response.status === 503) return setLoad({ status: "unavailable" });
        if (!response.ok) return setLoad({ status: "failed" });
        const body = (await response.json()) as { tasks?: AgentTask[] };
        setLoad({ status: "loaded", tasks: Array.isArray(body.tasks) ? body.tasks : [] });
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setLoad({ status: "failed" });
      });
    return () => controller.abort();
  }, [projectId, refreshKey]);

  const projectName = projects.find((project) => project.id === projectId)?.name ?? projectId;

  return (
    <Panel aria-busy={load.status === "loading" || undefined}>
      <PanelHeader
        eyebrow="Live · persisted"
        title="Live tasks"
        description="Tasks operators recorded from a completed SEO Director review or an observed query, read from the task store. Not the modelled board below: these are the only real tasks this product holds."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent" title="Read from nexra_agent_tasks through the tasks endpoint. No fixture record is shown here.">
              Live
            </Badge>
            <Button icon="refresh" onClick={() => setRefreshKey((key) => key + 1)} disabled={!projectId}>
              Refresh
            </Button>
          </div>
        }
      />
      <div className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-3 sm:px-5">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-[11.5px] text-fg-subtle sm:max-w-64">
          Stored project
          <Select size="sm" value={projectId} onChange={(event) => setProjectId(event.target.value)} options={projects.map((project) => ({ value: project.id, label: project.name }))} />
        </label>
      </div>
      {!projectId ? (
        <EmptyState icon="projects" title="No stored project" description="Tasks are recorded against a stored project. Create one to record tasks." />
      ) : load.status === "unavailable" ? (
        <EmptyState icon="inbox" title="Tasks are not kept on this deployment" description="Live tasks need the Supabase data source. With the mock project roster, nothing is recorded." />
      ) : load.status === "failed" ? (
        <EmptyState icon="alert" title="Tasks could not be read" description="The task store did not answer. Refresh to try again; nothing here is estimated in the meantime." />
      ) : (
        <Table caption={`Live tasks recorded for ${projectName}`}>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Title</TableHeaderCell>
              <TableHeaderCell>Owning agent</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Priority</TableHeaderCell>
              <TableHeaderCell>Source</TableHeaderCell>
              <TableHeaderCell>Recorded</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {load.status === "loaded" ? (
              load.tasks.length === 0 ? (
                <TableEmptyRow colSpan={COLUMNS}>
                  <EmptyState size="sm" icon="inbox" title="No live tasks yet" description={`No operator has recorded a task for ${projectName}. Record one from a completed SEO Director review or an observed query.`} />
                </TableEmptyRow>
              ) : (
                load.tasks.map((task) => <LiveTaskRow key={task.id} task={task} />)
              )
            ) : (
              <TableSkeletonRows columns={COLUMNS} rows={3} />
            )}
          </TableBody>
        </Table>
      )}
      <PanelFooter>
        <span>
          Read-only here. A task is a record of an operator&apos;s intention; nothing on this screen assigns it, moves it or runs an agent. At most{" "}
          {TASK_READ_DEFAULT_LIMIT} newest tasks are shown.
        </span>
      </PanelFooter>
    </Panel>
  );
}

function LiveTaskRow({ task }: { task: AgentTask }) {
  const status = TASK_STATUS_META[task.status];
  const priority = TASK_PRIORITY_META[task.priority];
  const source = TASK_SOURCE_META[task.sourceKind];
  return (
    <TableRow>
      <TableCell header className="max-w-[24rem]">
        <span className="line-clamp-2" title={task.title}>
          {task.title}
        </span>
      </TableCell>
      <TableCell>{AGENT_NAMES[task.owningAgent]}</TableCell>
      <TableCell>
        <Badge tone={status.tone} dot>
          {status.label}
        </Badge>
      </TableCell>
      <TableCell>
        <Badge tone={priority.tone}>{priority.label}</Badge>
      </TableCell>
      <TableCell className="max-w-[18rem]">
        <span className="text-fg-muted" title={source.description}>
          {source.label}
        </span>
        <span className="ml-1.5 truncate font-mono text-[11.5px] text-fg-subtle" title={task.sourceRef}>
          {task.sourceKind === "director-run" ? `${task.sourceRef.slice(0, 8)}…` : task.sourceRef}
        </span>
      </TableCell>
      <TableCell className="whitespace-nowrap text-fg-muted">
        {formatFullDate(task.createdAt)} {formatTimeUtc(task.createdAt)}
      </TableCell>
    </TableRow>
  );
}
