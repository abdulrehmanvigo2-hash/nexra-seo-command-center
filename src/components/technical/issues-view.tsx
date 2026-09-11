"use client";

import Link from "next/link";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { cn } from "@/lib/cn";
import { formatPercent } from "@/lib/format";
import { AGENT_NAMES } from "@/lib/mock/seo";
import {
  ISSUE_STATUS_CYCLE,
  ISSUE_STATUS_META,
  SEVERITY_META,
} from "@/lib/mock/technical";
import {
  CategoryBadge,
  ProvenanceTag,
  SeverityBadge,
} from "@/components/technical/technical-chrome";
import type {
  IssueStatus,
  TechnicalIssue,
  TechnicalPage,
  TechnicalSeverity,
} from "@/types/technical";

/**
 * The unified issue registry.
 *
 * One card per finding, carrying what was found, why it matters, what to do,
 * who owns it, and the pages behind it. Triage cycles through the states in
 * `ISSUE_STATUS_CYCLE` and is session state only — nothing is dispatched to an
 * agent, written to a record, or sent anywhere (CLAUDE.md §4).
 */

const BORDER: Record<TechnicalSeverity, string> = {
  critical: "border-l-critical",
  high: "border-l-critical/70",
  medium: "border-l-warning",
  low: "border-l-border-strong",
  healthy: "border-l-positive",
};

export function IssuesView({
  issues,
  pagesById,
  statuses,
  onStatusChange,
  onFilterCategory,
}: {
  issues: readonly TechnicalIssue[];
  pagesById: ReadonlyMap<string, TechnicalPage>;
  statuses: Readonly<Record<string, IssueStatus>>;
  onStatusChange: (id: string, status: IssueStatus) => void;
  /** Narrows the whole workspace to one category. */
  onFilterCategory: (category: TechnicalIssue["category"]) => void;
}) {
  if (issues.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon="check"
          title="No findings for this selection"
          description="Either everything here is healthy, or the filters have narrowed past the last finding. Clear a filter to widen the set."
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-3">
      {issues.map((issue) => {
        const status = statuses[issue.id] ?? issue.status;
        const statusMeta = ISSUE_STATUS_META[status];
        const nextStatus =
          ISSUE_STATUS_CYCLE[
            (ISSUE_STATUS_CYCLE.indexOf(status) + 1) %
              ISSUE_STATUS_CYCLE.length
          ];
        const samples = issue.pageIds
          .slice(0, 4)
          .map((id) => pagesById.get(id))
          .filter((page): page is TechnicalPage => page !== undefined);

        return (
          <Panel
            key={issue.id}
            className={cn(
              "border-l-2",
              BORDER[issue.severity],
              status === "resolved" || status === "ignored"
                ? "opacity-60"
                : undefined,
            )}
          >
            <PanelHeader
              eyebrow={issue.projectName}
              title={issue.label}
              description={issue.description}
              actions={
                <>
                  <SeverityBadge severity={issue.severity} />
                  <Button
                    variant="ghost"
                    onClick={() => onStatusChange(issue.id, nextStatus)}
                    title={`Currently ${statusMeta.label.toLowerCase()}. Mark as ${ISSUE_STATUS_META[nextStatus].label.toLowerCase()} for this session.`}
                  >
                    {statusMeta.label}
                    <Icon name="chevron-right" className="h-3.5 w-3.5" />
                  </Button>
                </>
              }
            />

            <PanelBody className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onFilterCategory(issue.category)}
                  title={`Narrow the workspace to ${issue.category} findings`}
                  className="rounded-md transition-opacity hover:opacity-80"
                >
                  <CategoryBadge category={issue.category} />
                </button>
                <span className="text-[11.5px] text-fg-subtle">
                  {issue.affectedPages}{" "}
                  {issue.affectedPages === 1 ? "page" : "pages"} ·{" "}
                  {formatPercent(issue.affectedShare, 0)} of the project
                </span>
                <span className="text-[11.5px] text-fg-subtle">
                  · Owner {AGENT_NAMES[issue.owner]}
                </span>
                <ProvenanceTag provenance={issue.provenance} />
                <span className="tabular ml-auto text-[11.5px] text-fg-subtle">
                  Priority {issue.priority}
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border border-border bg-surface-raised px-3 py-2.5">
                  <p className="text-[11px] font-semibold tracking-[0.06em] text-fg-subtle uppercase">
                    Impact
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed text-fg-muted">
                    {issue.impact}
                  </p>
                </div>
                <div className="rounded-md border border-border bg-surface-raised px-3 py-2.5">
                  <p className="text-[11px] font-semibold tracking-[0.06em] text-fg-subtle uppercase">
                    Recommended action
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed text-fg-muted">
                    {issue.action}
                  </p>
                </div>
              </div>

              {samples.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold tracking-[0.06em] text-fg-subtle uppercase">
                    Affected pages
                  </p>
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {samples.map((page) => (
                      <li key={page.id} className="min-w-0 max-w-full">
                        <Link
                          href={`/technical/pages/${page.id}`}
                          title={`${page.title} — ${page.path}`}
                          className="inline-block max-w-full truncate rounded-md border border-border bg-surface px-2 py-1 font-mono text-[11px] text-fg-subtle transition-colors hover:border-accent/40 hover:text-accent"
                        >
                          {page.path}
                        </Link>
                      </li>
                    ))}
                    {issue.affectedPages > samples.length && (
                      <li className="self-center text-[11px] text-fg-subtle">
                        +{issue.affectedPages - samples.length} more
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </PanelBody>
          </Panel>
        );
      })}

      <p className="px-1 text-[11.5px] text-fg-subtle">
        Triage is recorded for this session only. Severity bands are fixed by
        the check itself —{" "}
        {SEVERITY_META.critical.label.toLowerCase()} means{" "}
        {SEVERITY_META.critical.description.toLowerCase()}
      </p>
    </div>
  );
}
