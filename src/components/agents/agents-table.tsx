"use client";

import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Meter } from "@/components/ui/meter";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { SortableHeader } from "@/components/ui/sortable-header";
import { cn } from "@/lib/cn";
import { formatRelative } from "@/lib/format";
import { HEALTH_DOT, HEALTH_LABEL, HEALTH_METER } from "@/lib/health";
import { WORKLOAD_META } from "@/lib/mock/agents";
import {
  AgentMonogram,
  AgentStatusBadge,
} from "@/components/agents/agent-chrome";
import {
  AGENT_SORT_OPTIONS,
  type AgentSort,
} from "@/components/agents/sorting";
import type { AgentListItem } from "@/types/agent";

/**
 * The roster as a dense table.
 *
 * The same rows the cards show, read as a comparison instead of as a set of
 * summaries. Sorting is owned by the workspace above, so switching between the
 * two views keeps the order the user chose.
 */
export function AgentsTable({
  agents,
  sort,
  onSort,
  referenceIso,
}: {
  agents: readonly AgentListItem[];
  sort: { key: AgentSort; desc: boolean };
  onSort: (key: AgentSort) => void;
  referenceIso: string;
}) {
  return (
    <Table caption="Agents with status, current focus, workload, quality, and alerts">
      <TableHead>
        <TableRow>
          <SortableHeader
            label="Agent"
            sortKey="name"
            options={AGENT_SORT_OPTIONS}
            sort={sort}
            onSort={onSort}
          />
          <TableHeaderCell>Status</TableHeaderCell>
          <TableHeaderCell>Current focus</TableHeaderCell>
          <TableHeaderCell align="right">Projects</TableHeaderCell>
          <SortableHeader
            label="Tasks"
            sortKey="tasks"
            options={AGENT_SORT_OPTIONS}
            align="right"
            sort={sort}
            onSort={onSort}
          />
          <SortableHeader
            label="Workload"
            sortKey="workload"
            options={AGENT_SORT_OPTIONS}
            align="right"
            sort={sort}
            onSort={onSort}
          />
          <SortableHeader
            label="Quality"
            sortKey="quality"
            options={AGENT_SORT_OPTIONS}
            align="right"
            sort={sort}
            onSort={onSort}
          />
          <SortableHeader
            label="Last activity"
            sortKey="activity"
            options={AGENT_SORT_OPTIONS}
            align="right"
            sort={sort}
            onSort={onSort}
          />
          <TableHeaderCell>Alerts</TableHeaderCell>
          <TableHeaderCell>
            <span className="sr-only">Open</span>
          </TableHeaderCell>
        </TableRow>
      </TableHead>

      <TableBody>
        {agents.map((agent) => (
          <TableRow key={agent.id}>
            <TableCell header className="max-w-[260px]">
              <span className="flex items-center gap-2.5">
                <AgentMonogram initials={agent.initials} size="sm" />
                <span className="min-w-0">
                  <span className="block truncate text-fg">{agent.name}</span>
                  <span className="block truncate text-[11px] font-normal text-fg-subtle">
                    Stage {agent.stage} · {agent.title}
                  </span>
                </span>
              </span>
            </TableCell>

            <TableCell>
              <AgentStatusBadge status={agent.status} />
            </TableCell>

            <TableCell className="max-w-[300px] min-w-[200px]">
              <span className="block truncate text-fg-muted">
                {agent.currentFocus}
              </span>
              <span className="block truncate text-[11px] text-fg-subtle">
                {agent.currentProject
                  ? agent.currentProject.name
                  : "No project engaged"}
              </span>
            </TableCell>

            <TableCell numeric>{agent.projects.length}</TableCell>

            <TableCell numeric>
              <span className="text-fg">{agent.workload.activeTasks}</span>
              <span className="text-fg-subtle">
                {" "}
                / {agent.workload.queuedTasks + agent.workload.reviewQueue} queued
              </span>
            </TableCell>

            <TableCell numeric>
              <span className="inline-flex items-center justify-end gap-2">
                <span className="font-medium text-fg">
                  {agent.workload.percent}%
                </span>
                <span className="hidden w-12 lg:block">
                  <Meter
                    size="sm"
                    value={Math.min(100, agent.workload.percent)}
                    tone={WORKLOAD_META[agent.workload.band].meter}
                    label={`${agent.name} workload: ${agent.workload.percent}% of capacity, ${WORKLOAD_META[agent.workload.band].label}`}
                  />
                </span>
              </span>
            </TableCell>

            <TableCell numeric>
              <span className="inline-flex items-center justify-end gap-2">
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    HEALTH_DOT[agent.qualityHealth],
                  )}
                />
                <span className="font-medium text-fg">{agent.quality}</span>
                <span className="hidden w-12 lg:block">
                  <Meter
                    size="sm"
                    value={agent.quality}
                    tone={HEALTH_METER[agent.qualityHealth]}
                    label={`${agent.name} quality: ${agent.quality} out of 100, ${HEALTH_LABEL[agent.qualityHealth]}`}
                  />
                </span>
              </span>
            </TableCell>

            <TableCell numeric className="whitespace-nowrap">
              {formatRelative(agent.lastActivity, referenceIso)}
            </TableCell>

            <TableCell>
              {agent.blockers > 0 ? (
                <Badge tone={agent.attention ? "warning" : "neutral"} dot>
                  {agent.blockers}
                </Badge>
              ) : (
                <span className="text-fg-subtle">—</span>
              )}
            </TableCell>

            <TableCell align="right">
              <Link
                href={agent.href}
                aria-label={`Open ${agent.name}`}
                className="inline-flex items-center gap-1 rounded text-[12px] font-medium whitespace-nowrap text-accent transition-colors hover:text-accent-hover"
              >
                Open
                <Icon name="chevron-right" className="h-3.5 w-3.5" />
              </Link>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
