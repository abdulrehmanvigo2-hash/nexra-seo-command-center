"use client";

import { useId } from "react";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { Toolbar, ToolbarGroup, ToolbarSpacer } from "@/components/ui/toolbar";
import { cn } from "@/lib/cn";
import { AGENT_NAMES } from "@/lib/mock/seo";
import {
  PROJECT_STATUS_META,
  PROJECT_STATUS_ORDER,
  PROJECT_TYPE_META,
  PROJECT_TYPE_ORDER,
} from "@/lib/mock/projects";
import {
  HEALTH_FILTER_OPTIONS,
  hasActiveFilters,
  type HealthFilter,
  type ProjectFilters,
} from "@/components/projects/filters";
import { SORT_OPTIONS, type ProjectSort } from "@/components/projects/sorting";
import type { ProjectView } from "@/components/projects/view-preference";
import type { AgentId } from "@/types/seo";
import type { ProjectStatus, ProjectType } from "@/types/project";

/**
 * Search, filters, sort, and the view switch for the projects roster.
 *
 * Every control changes the list immediately — there is no apply step and no
 * control here that does nothing. The status filter is a segmented control
 * with counts because it is the one people reach for first; the narrower
 * filters are selects, which stay usable on a phone.
 */
export function ProjectsToolbar({
  filters,
  onFilterChange,
  onReset,
  statusCounts,
  sort,
  onSortChange,
  view,
  onViewChange,
  agents,
  total,
  shown,
}: {
  filters: ProjectFilters;
  onFilterChange: (patch: Partial<ProjectFilters>) => void;
  onReset: () => void;
  statusCounts: Record<ProjectStatus | "all", number>;
  sort: { key: ProjectSort; desc: boolean };
  onSortChange: (key: ProjectSort) => void;
  view: ProjectView;
  onViewChange: (view: ProjectView) => void;
  /** Agents assigned to at least one project, for the owner filter. */
  agents: readonly AgentId[];
  total: number;
  shown: number;
}) {
  const searchId = useId();
  const typeId = useId();
  const agentId = useId();
  const healthId = useId();
  const sortId = useId();

  return (
    <>
      <Toolbar label="Search and filter projects" className="gap-x-3">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <label htmlFor={searchId} className="sr-only">
            Search projects by name, domain, or client
          </label>
          <Icon
            name="search"
            className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-fg-subtle"
          />
          <input
            id={searchId}
            type="search"
            value={filters.query}
            onChange={(event) => onFilterChange({ query: event.target.value })}
            placeholder="Search name, domain, or client"
            className={cn(
              "h-9 w-full rounded-md border border-border bg-surface-raised pr-3 pl-8 text-[12.5px] text-fg transition-colors",
              "placeholder:text-fg-subtle hover:border-border-strong focus:border-accent focus:outline-none",
            )}
          />
        </div>

        <ToolbarSpacer />

        <ToolbarGroup>
          <label htmlFor={sortId} className="text-[11.5px] text-fg-subtle">
            Sort
          </label>
          <span className="block w-40">
            <Select
              id={sortId}
              value={sort.key}
              onChange={(event) =>
                onSortChange(event.target.value as ProjectSort)
              }
              options={SORT_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
            />
          </span>
          <Button
            icon={sort.desc ? "trend-down" : "trend-up"}
            onClick={() => onSortChange(sort.key)}
            aria-label={
              sort.desc
                ? "Sorted descending. Sort ascending instead."
                : "Sorted ascending. Sort descending instead."
            }
            title={sort.desc ? "Descending" : "Ascending"}
          >
            <span className="sr-only">Reverse sort order</span>
          </Button>

          <div
            role="group"
            aria-label="Display projects as"
            className="inline-flex items-center gap-0.5 rounded-md border border-border bg-surface p-0.5"
          >
            <ViewButton
              icon="grid"
              label="Cards"
              selected={view === "grid"}
              onClick={() => onViewChange("grid")}
            />
            <ViewButton
              icon="rows"
              label="Table"
              selected={view === "table"}
              onClick={() => onViewChange("table")}
            />
          </div>
        </ToolbarGroup>
      </Toolbar>

      <Toolbar label="Filter projects" className="gap-x-3">
        <Segmented
          label="Filter projects by status"
          value={filters.status}
          onChange={(status) => onFilterChange({ status })}
          options={[
            { value: "all" as const, label: "All", count: statusCounts.all },
            ...PROJECT_STATUS_ORDER.map((status) => ({
              value: status,
              label: PROJECT_STATUS_META[status].label,
              count: statusCounts[status],
              title: PROJECT_STATUS_META[status].description,
            })),
          ]}
        />

        <ToolbarGroup>
          <label htmlFor={typeId} className="sr-only">
            Filter by project type
          </label>
          <span className="block w-40">
            <Select
              id={typeId}
              value={filters.type}
              onChange={(event) =>
                onFilterChange({
                  type: event.target.value as ProjectType | "all",
                })
              }
              options={[
                { value: "all", label: "Any type" },
                ...PROJECT_TYPE_ORDER.map((type) => ({
                  value: type,
                  label: PROJECT_TYPE_META[type].label,
                })),
              ]}
            />
          </span>

          <label htmlFor={healthId} className="sr-only">
            Filter by health
          </label>
          <span className="block w-44">
            <Select
              id={healthId}
              value={filters.health}
              onChange={(event) =>
                onFilterChange({ health: event.target.value as HealthFilter })
              }
              options={HEALTH_FILTER_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
            />
          </span>

          <label htmlFor={agentId} className="sr-only">
            Filter by assigned agent
          </label>
          <span className="block w-48">
            <Select
              id={agentId}
              value={filters.agent}
              onChange={(event) =>
                onFilterChange({ agent: event.target.value as AgentId | "all" })
              }
              options={[
                { value: "all", label: "Any agent" },
                ...agents.map((agent) => ({
                  value: agent,
                  label: AGENT_NAMES[agent],
                })),
              ]}
            />
          </span>

          <button
            type="button"
            aria-pressed={filters.attentionOnly}
            onClick={() =>
              onFilterChange({ attentionOnly: !filters.attentionOnly })
            }
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-3 text-[12px] font-medium whitespace-nowrap transition-colors",
              filters.attentionOnly
                ? "border-warning/40 bg-warning/10 text-warning"
                : "border-border-strong bg-surface-raised text-fg-muted hover:bg-surface-hover",
            )}
          >
            <Icon name="alert" className="h-4 w-4" />
            Needs attention
          </button>
        </ToolbarGroup>

        <ToolbarSpacer />

        <div className="flex items-center gap-3">
          <p aria-live="polite" className="text-[11.5px] whitespace-nowrap text-fg-subtle">
            {shown} of {total} projects
          </p>
          {hasActiveFilters(filters) && (
            <Button variant="ghost" icon="close" onClick={onReset}>
              Clear
            </Button>
          )}
        </div>
      </Toolbar>
    </>
  );
}

function ViewButton({
  icon,
  label,
  selected,
  onClick,
}: {
  icon: "grid" | "rows";
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      title={`${label} view`}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-[12px] font-medium transition-colors",
        selected
          ? "bg-surface-hover text-fg shadow-sm shadow-black/20"
          : "text-fg-subtle hover:text-fg-muted",
      )}
    >
      <Icon name={icon} className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">{label}</span>
      <span className="sr-only sm:hidden">{label} view</span>
    </button>
  );
}
