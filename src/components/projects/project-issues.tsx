"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge, PriorityBadge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/field";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/cn";
import { getNavItem } from "@/config/navigation";
import { AGENT_NAMES } from "@/lib/mock/seo";
import {
  ISSUE_KIND_META,
  ISSUE_KIND_ORDER,
  ISSUE_STATUS_CYCLE,
  ISSUE_STATUS_META,
} from "@/lib/mock/projects";
import type {
  ProjectIssue,
  ProjectIssueKind,
  ProjectIssueStatus,
} from "@/types/project";

/**
 * What is wrong with this project and what is available to take.
 *
 * Defects and openings live in one list rather than two, because they compete
 * for the same sprint: an agency decides between fixing a redirect chain and
 * writing the missing comparison page, not inside separate screens.
 *
 * Changing an item's state is frontend state over the fixture — nothing is
 * dispatched to an agent (CLAUDE.md §4).
 */

type Filter = ProjectIssueKind | "all";

const BORDER: Record<ProjectIssueKind, string> = {
  critical: "border-l-critical",
  warning: "border-l-warning",
  opportunity: "border-l-accent",
  "quick-win": "border-l-positive",
};

export function ProjectIssues({
  issues,
  statuses,
  onStatusChange,
  /** Renders the shortened preview shown on the overview tab. */
  preview = false,
  onViewAll,
}: {
  issues: readonly ProjectIssue[];
  statuses: Readonly<Record<string, ProjectIssueStatus>>;
  onStatusChange: (id: string, status: ProjectIssueStatus) => void;
  preview?: boolean;
  onViewAll?: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");

  const resolved = useMemo(
    () =>
      issues.map((issue) => ({
        ...issue,
        status: statuses[issue.id] ?? issue.status,
      })),
    [issues, statuses],
  );

  const counts = useMemo(() => {
    const tally: Record<string, number> = { all: resolved.length };
    for (const issue of resolved) {
      tally[issue.kind] = (tally[issue.kind] ?? 0) + 1;
    }
    return tally;
  }, [resolved]);

  const open = resolved.filter((issue) => issue.status !== "resolved").length;

  const visible = (
    filter === "all"
      ? resolved
      : resolved.filter((issue) => issue.kind === filter)
  ).slice(0, preview ? 4 : undefined);

  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader
        eyebrow="Findings"
        title="Issues & Opportunities"
        description={
          preview
            ? "The highest-priority findings for this project."
            : "Everything the agents have found on this project, worst first."
        }
        actions={
          <Badge tone={open > 0 ? "warning" : "positive"} dot>
            {open} open of {resolved.length}
          </Badge>
        }
      />

      {!preview && (
        <div className="border-b border-border px-4 py-3 sm:px-5">
          <Segmented
            label="Filter findings by type"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all" as const, label: "All", count: counts.all },
              ...ISSUE_KIND_ORDER.filter(
                (kind) => (counts[kind] ?? 0) > 0,
              ).map((kind) => ({
                value: kind,
                label: ISSUE_KIND_META[kind].label,
                count: counts[kind],
              })),
            ]}
          />
        </div>
      )}

      {visible.length === 0 ? (
        <EmptyState
          icon="check"
          title="Nothing in this category"
          description="No findings of this type are open on this project right now."
        />
      ) : (
        <PanelBody className="space-y-2.5">
          {visible.map((issue) => (
            <IssueRow
              key={issue.id}
              issue={issue}
              compact={preview}
              onStatusChange={onStatusChange}
            />
          ))}
        </PanelBody>
      )}

      <PanelFooter className="mt-auto">
        <span>
          {resolved.filter((issue) => issue.kind === "critical").length} critical
          · {resolved.filter((issue) => issue.kind === "quick-win").length} quick
          wins
        </span>
        {preview && onViewAll ? (
          <Button variant="ghost" onClick={onViewAll}>
            View all findings
            <Icon name="arrow-right" className="h-4 w-4" />
          </Button>
        ) : (
          <span>State changes are held in this session only.</span>
        )}
      </PanelFooter>
    </Panel>
  );
}

function IssueRow({
  issue,
  compact,
  onStatusChange,
}: {
  issue: ProjectIssue;
  compact: boolean;
  onStatusChange: (id: string, status: ProjectIssueStatus) => void;
}) {
  const kind = ISSUE_KIND_META[issue.kind];
  const destination = getNavItem(issue.module);
  const done = issue.status === "resolved";

  return (
    <article
      className={cn(
        "rounded-md border border-l-2 border-border bg-surface-raised px-3.5 py-3 transition-colors",
        BORDER[issue.kind],
        done && "opacity-60",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={kind.tone}>
              <Icon name={kind.icon} className="h-3 w-3" />
              {kind.label}
            </Badge>
            <PriorityBadge priority={issue.severity} />
            <Badge tone={ISSUE_STATUS_META[issue.status].tone} dot>
              {ISSUE_STATUS_META[issue.status].label}
            </Badge>
          </div>

          <h4
            className={cn(
              "mt-2 text-[13px] leading-snug font-semibold text-fg",
              done && "line-through",
            )}
          >
            {issue.title}
          </h4>

          {!compact && (
            <p className="mt-1.5 max-w-3xl text-[12.5px] leading-relaxed text-fg-muted">
              {issue.description}
            </p>
          )}
        </div>

        <div className="shrink-0 text-right">
          <p className="text-[10.5px] font-medium tracking-[0.05em] text-fg-subtle uppercase">
            Estimated impact
          </p>
          <p className="tabular mt-1 text-[13px] font-semibold text-fg">
            {issue.impact}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-2.5 text-[11.5px] text-fg-subtle">
        <span className="inline-flex items-center gap-1.5">
          <Icon name="agents" className="h-3.5 w-3.5" />
          {AGENT_NAMES[issue.agent]}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Icon name="gauge" className="h-3.5 w-3.5" />
          {issue.impactLevel} impact · {issue.effort} effort
        </span>

        {!compact && (
          <>
            <span className="flex-1" />
            <label className="inline-flex items-center gap-2">
              <span className="sr-only">Status for {issue.title}</span>
              <span className="block w-36">
                <Select
                  size="sm"
                  value={issue.status}
                  onChange={(event) =>
                    onStatusChange(
                      issue.id,
                      event.target.value as ProjectIssueStatus,
                    )
                  }
                  options={ISSUE_STATUS_CYCLE.map((status) => ({
                    value: status,
                    label: ISSUE_STATUS_META[status].label,
                  }))}
                />
              </span>
            </label>
            <Link
              href={destination.href}
              className={buttonClasses("secondary", "sm")}
            >
              Open {destination.label}
              <Icon name="arrow-right" className="h-4 w-4" />
            </Link>
          </>
        )}
      </div>
    </article>
  );
}
