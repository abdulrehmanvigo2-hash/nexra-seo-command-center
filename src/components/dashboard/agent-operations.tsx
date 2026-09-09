"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Meter } from "@/components/ui/meter";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/cn";
import { formatNumber, formatRelative } from "@/lib/format";
import { AGENT_STATUS_META, AGENT_STATUS_ORDER } from "@/lib/mock/dashboard";
import type { AgentOperation, AgentOpsStatus } from "@/types/dashboard";

/**
 * The AI SEO team as an operations board: what each of the twelve agents is
 * working on, how far through it is, and which ones are stuck.
 *
 * The agents are mocked in this milestone (CLAUDE.md §13) — nothing here runs.
 * The filter, though, is real frontend state over the real dataset.
 */

type Filter = AgentOpsStatus | "all";

export function AgentOperations({
  agents,
  referenceIso,
  eyebrow = "AI SEO team",
  title = "Agent Operations",
  description = "The twelve specialist agents, their current task, and where the pipeline is waiting on a decision.",
}: {
  agents: readonly AgentOperation[];
  /** Instant relative timestamps are measured against. */
  referenceIso: string;
  /**
   * Framing for the panel. Overridden by the Projects module, which shows the
   * subset of the roster assigned to one project rather than all twelve.
   */
  eyebrow?: string;
  title?: string;
  description?: string;
}) {
  const [filter, setFilter] = useState<Filter>("all");

  const counts = useMemo(() => {
    const tally = {} as Record<AgentOpsStatus, number>;
    for (const status of AGENT_STATUS_ORDER) tally[status] = 0;
    for (const agent of agents) tally[agent.status] += 1;
    return tally;
  }, [agents]);

  const visible = filter === "all"
    ? agents
    : agents.filter((agent) => agent.status === filter);

  const attention = agents.filter((agent) => agent.attention).length;
  const working = counts.working + counts.active;

  return (
    <Panel>
      <PanelHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={attention > 0 ? "warning" : "neutral"} dot>
              {attention} needing attention
            </Badge>
            <Badge tone="accent" dot pulse={working > 0}>
              {working} in progress
            </Badge>
          </div>
        }
      />

      <div className="border-b border-border px-4 py-3 sm:px-5">
        <Segmented
          label="Filter agents by status"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all" as const, label: "All", count: agents.length },
            ...AGENT_STATUS_ORDER.map((status) => ({
              value: status,
              label: AGENT_STATUS_META[status].label,
              count: counts[status],
            })),
          ]}
        />
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon="agents"
          title="No agents in this state"
          description="Every agent is in a different state right now. Clear the filter to see the full roster."
        />
      ) : (
        <PanelBody>
          <ul className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {visible.map((agent) => (
              <AgentCard
                key={agent.agent}
                agent={agent}
                referenceIso={referenceIso}
              />
            ))}
          </ul>
        </PanelBody>
      )}

      <PanelFooter>
        <span>
          Workflow loop: Project Manager → SEO Director → Intelligence →
          Keywords → Content → Technical → AI Visibility → Authority →
          Analytics, and back to the Director.
        </span>
        <span>{agents.length} agents</span>
      </PanelFooter>
    </Panel>
  );
}

function AgentCard({
  agent,
  referenceIso,
}: {
  agent: AgentOperation;
  referenceIso: string;
}) {
  const meta = AGENT_STATUS_META[agent.status];

  return (
    <li
      className={cn(
        // `min-w-0` so a nowrap status badge cannot force the grid track
        // wider than its column on a narrow viewport.
        "min-w-0 rounded-md border bg-surface-raised p-3.5 transition-colors",
        agent.attention
          ? "border-warning/35"
          : "border-border hover:border-border-strong",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            aria-hidden="true"
            className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border-strong bg-surface text-[10.5px] font-semibold text-fg-subtle"
          >
            {agent.stage}
          </span>
          <div className="min-w-0">
            <h4 className="truncate text-[13px] font-semibold tracking-tight text-fg">
              {agent.name}
            </h4>
            <p className="truncate text-[11.5px] text-fg-subtle">
              {agent.discipline}
            </p>
          </div>
        </div>
        <StatusBadge status={meta.status} label={meta.label} />
      </div>

      <p className="mt-3 line-clamp-2 min-h-[2.4rem] text-[12.5px] leading-snug text-fg-muted">
        {agent.currentTask}
      </p>

      <div className="mt-3">
        <div className="flex items-center justify-between text-[11px] text-fg-subtle">
          <span>{agent.status === "waiting" ? "Not started" : "Progress"}</span>
          <span className="tabular">{agent.progress}%</span>
        </div>
        <Meter
          className="mt-1.5"
          size="sm"
          value={agent.progress}
          tone={
            agent.status === "blocked" ? "critical"
            : agent.status === "needs-review" ? "warning"
            : agent.progress === 100 ? "positive"
            : "accent"
          }
          label={`${agent.name} task progress`}
        />
      </div>

      <dl className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border pt-2.5 text-[11.5px]">
        <div className="flex items-center gap-1.5">
          <dt className="sr-only">Outputs this window</dt>
          <Icon name="layers" className="h-3.5 w-3.5 text-fg-subtle" />
          <dd className="tabular text-fg-muted">
            {formatNumber(agent.outputs)}{" "}
            <span className="text-fg-subtle">{agent.outputLabel}</span>
          </dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt className="sr-only">Queued tasks</dt>
          <Icon name="inbox" className="h-3.5 w-3.5 text-fg-subtle" />
          <dd className="tabular text-fg-muted">
            {agent.queue} <span className="text-fg-subtle">queued</span>
          </dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt className="sr-only">Last activity</dt>
          <Icon name="clock" className="h-3.5 w-3.5 text-fg-subtle" />
          <dd className="text-fg-subtle">
            {formatRelative(agent.lastActivity, referenceIso)}
          </dd>
        </div>
      </dl>
    </li>
  );
}
