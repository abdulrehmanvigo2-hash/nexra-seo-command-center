import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Meter } from "@/components/ui/meter";
import { Panel } from "@/components/ui/panel";
import { Sparkline } from "@/components/ui/sparkline";
import { cn } from "@/lib/cn";
import { formatCompact, formatRelative } from "@/lib/format";
import {
  AgentMonogram,
  AgentStatusBadge,
  WorkloadReading,
} from "@/components/agents/agent-chrome";
import type { AgentListItem } from "@/types/agent";

/**
 * One agent in the grid.
 *
 * Reads top to bottom as an operations card: who the agent is, what state it
 * is in, what it is working on and for whom, how loaded it is, and what it has
 * produced. The card is a summary — everything on it is expanded on the
 * agent's own workspace, which the whole card links to.
 */
export function AgentCard({
  agent,
  referenceIso,
}: {
  agent: AgentListItem;
  /** Instant relative timestamps are measured against. */
  referenceIso: string;
}) {
  return (
    <Panel
      as="article"
      className={cn(
        "flex h-full flex-col p-4 transition-colors",
        agent.attention
          ? "border-warning/35"
          : "hover:border-border-strong",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <AgentMonogram initials={agent.initials} stage={agent.stage} />
          <div className="min-w-0">
            <h3 className="truncate text-[13.5px] leading-tight font-semibold tracking-tight text-fg">
              {agent.name}
            </h3>
            <p className="mt-1 truncate text-[11.5px] text-fg-subtle">
              {agent.title}
            </p>
          </div>
        </div>
        <AgentStatusBadge status={agent.status} />
      </div>

      <div className="mt-3.5 rounded-md border border-border bg-surface-raised px-3 py-2.5">
        <p className="text-[10.5px] font-medium tracking-[0.05em] text-fg-subtle uppercase">
          Current focus
        </p>
        <p className="mt-1 line-clamp-2 min-h-[2.4rem] text-[12.5px] leading-snug text-fg-muted">
          {agent.currentFocus}
        </p>

        <div className="mt-2 flex items-center gap-2.5">
          <Meter
            className="flex-1"
            size="sm"
            value={agent.progress}
            tone={
              agent.status === "blocked"
                ? "critical"
                : agent.status === "needs-review"
                  ? "warning"
                  : agent.progress === 100
                    ? "positive"
                    : "accent"
            }
            label={`${agent.name} task progress`}
          />
          <span className="tabular shrink-0 text-[10.5px] text-fg-subtle">
            {agent.progress}%
          </span>
        </div>

        <p className="mt-2 truncate text-[11px] text-fg-subtle">
          {agent.currentProject ? (
            <>
              On{" "}
              <span className="font-medium text-fg-muted">
                {agent.currentProject.name}
              </span>
            </>
          ) : (
            "Not currently engaged on a project"
          )}
        </p>
      </div>

      <div className="mt-3.5 grid grid-cols-2 gap-3">
        <WorkloadReading workload={agent.workload} label={agent.name} />
        <div className="min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] text-fg-subtle">Quality</span>
            <span className="tabular text-[11px] font-medium text-fg-muted">
              {agent.quality} / 100
            </span>
          </div>
          <Sparkline
            values={agent.spark}
            tone={agent.attention ? "warning" : "accent"}
            className="mt-1"
          />
        </div>
      </div>

      <dl className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3 text-[11.5px]">
        <div className="flex items-center gap-1.5">
          <dt className="sr-only">Projects supported</dt>
          <Icon name="projects" className="h-3.5 w-3.5 text-fg-subtle" />
          <dd className="tabular text-fg-muted">
            {agent.projects.length}{" "}
            <span className="text-fg-subtle">projects</span>
          </dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt className="sr-only">Active tasks</dt>
          <Icon name="inbox" className="h-3.5 w-3.5 text-fg-subtle" />
          <dd className="tabular text-fg-muted">
            {agent.workload.activeTasks}{" "}
            <span className="text-fg-subtle">active</span>
          </dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt className="sr-only">Outputs this window</dt>
          <Icon name="layers" className="h-3.5 w-3.5 text-fg-subtle" />
          <dd className="tabular text-fg-muted">
            {formatCompact(agent.completedOutputs)}{" "}
            <span className="text-fg-subtle">{agent.outputLabel}</span>
          </dd>
        </div>
      </dl>

      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border pt-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {agent.blockers > 0 ? (
            <Badge tone="warning" dot>
              {agent.blockers} blocker{agent.blockers === 1 ? "" : "s"}
            </Badge>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-fg-subtle">
              <Icon name="check" className="h-3.5 w-3.5 text-positive" />
              Nothing blocking
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 text-[11px] whitespace-nowrap text-fg-subtle">
            <Icon name="clock" className="h-3.5 w-3.5" />
            {formatRelative(agent.lastActivity, referenceIso)}
          </span>
        </div>

        <Link href={agent.href} className={buttonClasses("secondary", "sm")}>
          Open
          <Icon name="arrow-right" className="h-4 w-4" />
        </Link>
      </div>
    </Panel>
  );
}
