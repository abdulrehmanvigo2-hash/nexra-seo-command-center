"use client";

import Link from "next/link";
import { Icon } from "@/components/icons";
import { Button, buttonClasses } from "@/components/ui/button";
import { Dropdown } from "@/components/ui/dropdown";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/cn";
import { formatFullDate, formatTimeUtc } from "@/lib/format";
import { DASHBOARD_PROJECTS, DATE_RANGES } from "@/lib/mock/dashboard";
import type { DashboardProject, ProjectId, RangeId } from "@/types/dashboard";

/**
 * The dashboard's own header: which project is being viewed, over what window,
 * how fresh the data is, and the two actions that start work.
 *
 * Sits below the application header, which owns the workspace and the account.
 * This one owns the selection that everything on the page is derived from.
 */
export function DashboardHeader({
  project,
  onProjectChange,
  range,
  onRangeChange,
  generatedAt,
  refreshing,
  refreshedNow,
  onRefresh,
  analysisQueued,
  onRunAnalysis,
}: {
  project: DashboardProject;
  onProjectChange: (id: ProjectId) => void;
  range: RangeId;
  onRangeChange: (id: RangeId) => void;
  /** ISO instant the fixtures represent. */
  generatedAt: string;
  refreshing: boolean;
  /** True after a manual refresh, until the selection changes. */
  refreshedNow: boolean;
  onRefresh: () => void;
  analysisQueued: boolean;
  onRunAnalysis: () => void;
}) {
  return (
    <section className="rounded-panel border border-border bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4 px-4 py-4 sm:px-5">
        <div className="flex min-w-0 items-start gap-3.5">
          <span
            aria-hidden="true"
            className="mt-0.5 hidden h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border-strong bg-surface-raised text-[12.5px] font-semibold text-fg-muted sm:flex"
          >
            {project.initials}
          </span>

          <div className="min-w-0">
            <p className="text-[10.5px] font-semibold tracking-[0.09em] text-fg-subtle uppercase">
              Command Center
            </p>

            <div className="mt-1 flex flex-wrap items-center gap-2.5">
              <h2 className="text-[20px] leading-tight font-semibold tracking-tight text-fg">
                {project.name}
              </h2>

              <ProjectSelector
                project={project}
                onProjectChange={onProjectChange}
              />
            </div>

            <p className="mt-1.5 text-[12.5px] leading-relaxed text-fg-muted">
              {project.domain} · {project.industry}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {/*
            The roll-up has no workspace of its own; a single project does, and
            it is the same record the Projects module lists.
          */}
          {!project.portfolio && (
            <Link
              href={`/projects/${project.id}`}
              className={buttonClasses("secondary", "sm")}
            >
              View project
              <Icon name="arrow-right" className="h-4 w-4" />
            </Link>
          )}
          <Button
            icon="refresh"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Refresh dashboard data"
          >
            {refreshing ? "Refreshing" : "Refresh"}
          </Button>
          <Button variant="primary" icon="bolt" onClick={onRunAnalysis}>
            Run SEO Analysis
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 border-t border-border px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium tracking-[0.03em] text-fg-subtle uppercase">
            <Icon name="calendar" className="h-3.5 w-3.5" />
            Date range
          </span>
          <Segmented
            label="Date range"
            value={range}
            onChange={onRangeChange}
            options={DATE_RANGES.map((entry) => ({
              value: entry.id,
              label: entry.label,
              title: entry.caption,
            }))}
          />
        </div>

        <p
          aria-live="polite"
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-fg-subtle"
        >
          {analysisQueued ? (
            <span className="inline-flex items-center gap-1.5 text-positive">
              <Icon name="check" className="h-3.5 w-3.5" />
              Analysis simulated — no agent run was started
            </span>
          ) : (
            <>
              <Icon name="clock" className="h-3.5 w-3.5" />
              <span>
                {refreshedNow
                  ? "Updated just now"
                  : `Last updated ${formatFullDate(generatedAt)}, ${formatTimeUtc(generatedAt)}`}
              </span>
              <span aria-hidden="true">·</span>
              <span>Mock data</span>
            </>
          )}
        </p>
      </div>
    </section>
  );
}

/** Switches the project every dataset on the page is derived from. */
function ProjectSelector({
  project,
  onProjectChange,
}: {
  project: DashboardProject;
  onProjectChange: (id: ProjectId) => void;
}) {
  return (
    <Dropdown
      label="Switch project"
      align="left"
      panelClassName="w-72"
      triggerClassName="h-7 gap-1.5 border-border-strong bg-surface-raised px-2"
      trigger={
        <>
          <span className="text-[11.5px] font-medium">Switch project</span>
          <Icon name="chevron-down" className="h-3.5 w-3.5" />
        </>
      }
    >
      {(close) => (
        <div className="py-1">
          <div className="px-3 pt-2 pb-1.5 text-[10.5px] font-medium tracking-[0.08em] text-fg-subtle uppercase">
            Projects
          </div>
          {DASHBOARD_PROJECTS.map((entry) => {
            const selected = entry.id === project.id;

            return (
              <button
                key={entry.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  onProjectChange(entry.id);
                  close();
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-surface-hover",
                  entry.portfolio && "border-b border-border",
                )}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border-strong bg-surface text-[10.5px] font-semibold text-fg-muted">
                  {entry.initials}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-fg">
                    {entry.name}
                  </span>
                  <span className="block truncate text-[11px] text-fg-subtle">
                    {entry.domain}
                  </span>
                </span>
                {selected && (
                  <Icon name="check" className="h-4 w-4 shrink-0 text-accent" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </Dropdown>
  );
}
