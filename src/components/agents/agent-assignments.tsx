import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Meter } from "@/components/ui/meter";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { cn } from "@/lib/cn";
import { HEALTH_DOT, HEALTH_LABEL, HEALTH_METER } from "@/lib/health";
import { AGENT_STATUS_META } from "@/lib/mock/agents";
import { PROJECT_STATUS_META } from "@/lib/mock/projects";
import { AgentStatusBadge } from "@/components/agents/agent-chrome";
import type { AgentAssignment } from "@/types/agent";

/**
 * The projects this agent supports.
 *
 * The assignments are the Projects module's own — a project's team decides who
 * is on it, and this is that answer read from the other side. Each row links
 * back to the project workspace, so the two views are one click apart.
 */
export function AgentAssignments({
  assignments,
  agentName,
  responsibility,
}: {
  assignments: readonly AgentAssignment[];
  agentName: string;
  /** What this agent is accountable for, stated once above the list. */
  responsibility: string;
}) {
  const attention = assignments.filter(
    (assignment) => assignment.attention,
  ).length;

  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader
        eyebrow="Assignments"
        title="Assigned Projects"
        description={responsibility}
        actions={
          <Badge tone={attention > 0 ? "warning" : "neutral"} dot={attention > 0}>
            {assignments.length} project{assignments.length === 1 ? "" : "s"}
            {attention > 0 ? ` · ${attention} needing attention` : ""}
          </Badge>
        }
      />

      {assignments.length === 0 ? (
        <EmptyState
          icon="projects"
          title="Not staffed on any project"
          description={`${agentName} is not currently assigned to an engagement. It joins a project when the work reaches its stage of the pipeline.`}
        />
      ) : (
        <PanelBody className="space-y-2.5">
          {assignments.map((assignment) => (
            <AssignmentRow key={assignment.projectId} assignment={assignment} />
          ))}
        </PanelBody>
      )}

      <PanelFooter className="mt-auto">
        <span>
          Assignments follow each project&apos;s own team, set in the Projects
          module.
        </span>
        <Link href="/projects" className={buttonClasses("ghost", "sm")}>
          All projects
          <Icon name="arrow-right" className="h-4 w-4" />
        </Link>
      </PanelFooter>
    </Panel>
  );
}

function AssignmentRow({ assignment }: { assignment: AgentAssignment }) {
  const projectStatus = PROJECT_STATUS_META[assignment.projectStatus];

  return (
    <article
      className={cn(
        "rounded-md border bg-surface-raised px-3.5 py-3",
        assignment.attention ? "border-warning/35" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <Link
          href={assignment.href}
          className="flex min-w-0 items-center gap-2.5 transition-colors hover:text-accent"
        >
          <span
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border-strong bg-surface text-[10.5px] font-semibold text-fg-subtle"
          >
            {assignment.initials}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[12.5px] font-semibold text-fg">
              {assignment.projectName}
            </span>
            <span className="block truncate text-[11px] text-fg-subtle">
              {assignment.client}
            </span>
          </span>
        </Link>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Badge tone={projectStatus.tone} dot>
            {projectStatus.label}
          </Badge>
          <AgentStatusBadge status={assignment.agentStatus} />
        </div>
      </div>

      <p className="mt-2.5 text-[12px] leading-snug text-fg-muted">
        {assignment.currentTask}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2.5 border-t border-border pt-2.5">
        <div className="flex min-w-[160px] flex-1 items-center gap-2.5">
          <Meter
            className="flex-1"
            size="sm"
            value={assignment.progress}
            tone={
              assignment.agentStatus === "blocked"
                ? "critical"
                : assignment.agentStatus === "needs-review"
                  ? "warning"
                  : "accent"
            }
            label={`${assignment.projectName}: ${AGENT_STATUS_META[assignment.agentStatus].label.toLowerCase()}, ${assignment.progress}% through`}
          />
          <span className="tabular shrink-0 text-[11px] text-fg-subtle">
            {assignment.progress}%
          </span>
        </div>

        <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] text-fg-subtle">
          <span
            aria-hidden="true"
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              HEALTH_DOT[assignment.healthState],
            )}
          />
          Health {assignment.health} · {HEALTH_LABEL[assignment.healthState]}
        </span>

        <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] text-fg-subtle">
          <Icon name="flag" className="h-3.5 w-3.5" />
          {assignment.openIssues} open issue
          {assignment.openIssues === 1 ? "" : "s"}
        </span>

        <span className="hidden w-16 lg:block">
          <Meter
            size="sm"
            value={assignment.health}
            tone={HEALTH_METER[assignment.healthState]}
            label={`${assignment.projectName} health: ${assignment.health} out of 100`}
          />
        </span>
      </div>
    </article>
  );
}
