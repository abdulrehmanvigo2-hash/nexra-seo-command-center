"use client";

import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Meter } from "@/components/ui/meter";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { cn } from "@/lib/cn";
import { formatRelative } from "@/lib/format";
import { AGENT_STATUS_META } from "@/lib/mock/dashboard";
import { agentInitials } from "@/components/projects/project-chrome";
import type { AssignedAgent } from "@/types/project";

/**
 * A short read of the agents assigned to this project, for the overview tab.
 *
 * The full board is the Command Center's `AgentOperations` panel, which the
 * team tab renders directly — this is the summary that sits above it, not a
 * second implementation of it.
 */
export function ProjectTeamPreview({
  team,
  referenceIso,
  onViewAll,
}: {
  team: readonly AssignedAgent[];
  referenceIso: string;
  onViewAll: () => void;
}) {
  const attention = team.filter((agent) => agent.attention).length;
  const working = team.filter(
    (agent) => agent.status === "working" || agent.status === "active",
  ).length;

  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader
        eyebrow="Assigned agents"
        title="Project Team"
        description="The specialists staffed on this project and what each is on now."
        actions={
          <Badge tone={attention > 0 ? "warning" : "accent"} dot pulse={working > 0}>
            {attention > 0 ? `${attention} needing attention` : `${working} in progress`}
          </Badge>
        }
      />

      <PanelBody className="space-y-2">
        {team.slice(0, 5).map((agent) => (
          <div
            key={agent.agent}
            className={cn(
              "flex items-start gap-3 rounded-md border bg-surface-raised px-3 py-2.5",
              agent.attention ? "border-warning/35" : "border-border",
            )}
          >
            <span
              aria-hidden="true"
              className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border-strong bg-surface text-[10px] font-semibold text-fg-subtle"
            >
              {agentInitials(agent.agent)}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <p className="min-w-0 truncate text-[12.5px] font-medium text-fg">
                  <Link
                    href={`/agents/${agent.agent}`}
                    className="rounded transition-colors hover:text-accent"
                  >
                    {agent.name}
                  </Link>
                </p>
                <StatusBadge
                  status={AGENT_STATUS_META[agent.status].status}
                  label={AGENT_STATUS_META[agent.status].label}
                />
              </div>

              <p className="mt-1 truncate text-[11.5px] text-fg-muted">
                {agent.currentTask}
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
                        : "accent"
                  }
                  label={`${agent.name} progress`}
                />
                <span className="tabular shrink-0 text-[10.5px] text-fg-subtle">
                  {agent.progress}%
                </span>
                <span className="shrink-0 text-[10.5px] whitespace-nowrap text-fg-subtle">
                  {formatRelative(agent.lastActivity, referenceIso)}
                </span>
              </div>
            </div>
          </div>
        ))}
      </PanelBody>

      <PanelFooter className="mt-auto">
        <Link
          href="/agents"
          className="inline-flex items-center gap-1.5 transition-colors hover:text-accent"
        >
          <Icon name="agents" className="h-3.5 w-3.5" />
          {team.length} of 12 agents assigned
        </Link>
        <Button variant="ghost" onClick={onViewAll}>
          View the team
          <Icon name="arrow-right" className="h-4 w-4" />
        </Button>
      </PanelFooter>
    </Panel>
  );
}
