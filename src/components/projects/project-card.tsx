import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { Sparkline } from "@/components/ui/sparkline";
import { TrendIndicator } from "@/components/ui/trend-indicator";
import { cn } from "@/lib/cn";
import { formatCompact, formatRelative } from "@/lib/format";
import {
  AgentStack,
  HealthReading,
  ProjectMonogram,
  ProjectStatusBadge,
  ProjectTypeChip,
} from "@/components/projects/project-chrome";
import type { ProjectListItem } from "@/types/project";

/**
 * One project as a card.
 *
 * Ordered the way an account lead reads a client: who it is, whether it is
 * healthy, what it is producing, and what is waiting on a decision. The whole
 * card is not a link — the row carries several destinations, so the primary
 * one is an explicit control at the foot of it.
 */
export function ProjectCard({
  project,
  referenceIso,
}: {
  project: ProjectListItem;
  /** Instant relative timestamps are measured against. */
  referenceIso: string;
}) {
  return (
    <Panel
      as="article"
      className={cn(
        "flex h-full flex-col transition-colors",
        project.criticalIssues > 0
          ? "border-critical/30"
          : "hover:border-border-strong",
      )}
    >
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <ProjectMonogram initials={project.initials} />
          <div className="min-w-0">
            <h3 className="truncate text-[13.5px] leading-tight font-semibold tracking-tight text-fg">
              {project.name}
            </h3>
            <p className="mt-0.5 truncate font-mono text-[11px] text-fg-subtle">
              {project.domain || "No domain set"}
            </p>
            <p className="mt-1 truncate text-[11.5px] text-fg-muted">
              {project.client}
            </p>
          </div>
        </div>
        <ProjectStatusBadge status={project.status} />
      </div>

      {project.draft ? (
        <DraftBody />
      ) : (
        <>
          <div className="border-t border-border px-4 py-3.5">
            <div className="flex items-center justify-between text-[11px] font-medium tracking-[0.04em] text-fg-subtle uppercase">
              <span>SEO health</span>
              <span>{project.market}</span>
            </div>
            <HealthReading
              className="mt-2"
              score={project.health}
              health={project.healthState}
              label={`${project.name} SEO health`}
            />
          </div>

          <dl className="grid grid-cols-3 gap-px border-t border-border bg-border">
            <Stat
              label="Traffic"
              value={formatCompact(project.organicTraffic)}
              foot={<TrendIndicator value={project.trafficTrend.value} />}
            />
            <Stat
              label="Keywords"
              value={formatCompact(project.rankingKeywords)}
              foot={<span className="text-fg-subtle">ranking</span>}
            />
            <Stat
              label="AI visibility"
              value={String(project.aiVisibility)}
              foot={<span className="text-fg-subtle">/ 100</span>}
            />
          </dl>

          <div className="px-4 pt-3">
            <Sparkline
              values={project.spark}
              tone={project.trafficTrend.value >= 0 ? "positive" : "critical"}
            />
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-3 pb-1">
            <Badge
              tone={
                project.criticalIssues > 0
                  ? "critical"
                  : project.openIssues > 0
                    ? "warning"
                    : "positive"
              }
              dot
            >
              {project.openIssues} open {project.openIssues === 1 ? "issue" : "issues"}
            </Badge>
            <span className="inline-flex items-center gap-1.5 text-[11.5px] text-fg-subtle">
              <Icon name="inbox" className="h-3.5 w-3.5" />
              {project.activeTasks} active tasks
            </span>
          </div>
        </>
      )}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <AgentStack agents={project.agents} />
          <ProjectTypeChip type={project.type} className="hidden sm:inline-flex" />
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[11px] whitespace-nowrap text-fg-subtle">
            {formatRelative(project.updatedAt, referenceIso)}
          </span>
          {project.href ? (
            <Link
              href={project.href}
              className={buttonClasses("secondary", "sm")}
              aria-label={`Open ${project.name}`}
            >
              Open
              <Icon name="arrow-right" className="h-4 w-4" />
            </Link>
          ) : (
            <button
              type="button"
              disabled
              title="The workspace opens once the first crawl has completed"
              className={buttonClasses("secondary", "sm")}
            >
              Awaiting crawl
            </button>
          )}
        </div>
      </div>
    </Panel>
  );
}

function Stat({
  label,
  value,
  foot,
}: {
  label: string;
  value: string;
  foot: ReactNode;
}) {
  return (
    <div className="bg-surface px-4 py-3">
      <dt className="text-[10.5px] font-medium tracking-[0.04em] text-fg-subtle uppercase">
        {label}
      </dt>
      <dd className="tabular mt-1.5 text-[15px] leading-none font-semibold text-fg">
        {value}
      </dd>
      <dd className="mt-1.5 text-[11px]">{foot}</dd>
    </div>
  );
}

/**
 * A project created in this session has no data behind it yet, and the card
 * says so rather than showing a health score that nothing produced.
 */
function DraftBody() {
  return (
    <div className="border-t border-border px-4 py-5">
      <div className="flex items-start gap-3 rounded-md border border-dashed border-border-strong bg-surface-raised px-3.5 py-3">
        <Icon name="clock" className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle" />
        <p className="text-[12px] leading-relaxed text-fg-muted">
          Added in this session. Metrics appear once the first crawl and
          keyword import have run — nothing is stored, so this project is gone
          on reload.
        </p>
      </div>
    </div>
  );
}
