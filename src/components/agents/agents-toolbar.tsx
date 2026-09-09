"use client";

import { useId } from "react";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { Toolbar, ToolbarGroup, ToolbarSpacer } from "@/components/ui/toolbar";
import { cn } from "@/lib/cn";
import {
  AGENT_CATEGORY_META,
  AGENT_CATEGORY_ORDER,
  AGENT_STATUS_META,
  AGENT_STATUS_ORDER,
  WORKLOAD_META,
  WORKLOAD_ORDER,
} from "@/lib/mock/agents";
import {
  hasActiveAgentFilters,
  type AgentFilters,
} from "@/components/agents/filters";
import {
  AGENT_SORT_OPTIONS,
  type AgentSort,
} from "@/components/agents/sorting";
import type { AgentView } from "@/components/agents/view-preference";
import type {
  AgentCategory,
  AgentStatus,
  WorkloadBand,
} from "@/types/agent";

/**
 * Search, filters, sort, and the view switch for the agent roster.
 *
 * Every control changes the list immediately — there is no apply step and no
 * control here that does nothing. Status is a segmented control with counts
 * because it is what people reach for first; the narrower filters are selects,
 * which stay usable on a phone.
 */
export function AgentsToolbar({
  filters,
  onFilterChange,
  onReset,
  statusCounts,
  sort,
  onSortChange,
  view,
  onViewChange,
  projects,
  total,
  shown,
}: {
  filters: AgentFilters;
  onFilterChange: (patch: Partial<AgentFilters>) => void;
  onReset: () => void;
  statusCounts: Record<AgentStatus | "all", number>;
  sort: { key: AgentSort; desc: boolean };
  onSortChange: (key: AgentSort) => void;
  view: AgentView;
  onViewChange: (view: AgentView) => void;
  /** Projects agents can be filtered by. */
  projects: readonly { readonly id: string; readonly name: string }[];
  total: number;
  shown: number;
}) {
  const searchId = useId();
  const sortId = useId();
  const categoryId = useId();
  const workloadId = useId();
  const projectId = useId();

  return (
    <>
      <Toolbar label="Search and sort agents" className="gap-x-3">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <label htmlFor={searchId} className="sr-only">
            Search agents by name, role, or specialty
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
            placeholder="Search name, role, or specialty"
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
          <span className="block w-44">
            <Select
              id={sortId}
              value={sort.key}
              onChange={(event) =>
                onSortChange(event.target.value as AgentSort)
              }
              options={AGENT_SORT_OPTIONS.map((option) => ({
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
            aria-label="Display agents as"
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

      <Toolbar label="Filter agents" className="gap-x-3">
        <Segmented
          label="Filter agents by status"
          value={filters.status}
          onChange={(status) => onFilterChange({ status })}
          options={[
            { value: "all" as const, label: "All", count: statusCounts.all },
            ...AGENT_STATUS_ORDER.map((status) => ({
              value: status,
              label: AGENT_STATUS_META[status].label,
              count: statusCounts[status],
              title: AGENT_STATUS_META[status].description,
            })),
          ]}
        />

        <ToolbarGroup>
          <label htmlFor={categoryId} className="sr-only">
            Filter by agent category
          </label>
          <span className="block w-40">
            <Select
              id={categoryId}
              value={filters.category}
              onChange={(event) =>
                onFilterChange({
                  category: event.target.value as AgentCategory | "all",
                })
              }
              options={[
                { value: "all", label: "Any category" },
                ...AGENT_CATEGORY_ORDER.map((category) => ({
                  value: category,
                  label: AGENT_CATEGORY_META[category].label,
                })),
              ]}
            />
          </span>

          <label htmlFor={workloadId} className="sr-only">
            Filter by workload
          </label>
          <span className="block w-40">
            <Select
              id={workloadId}
              value={filters.workload}
              onChange={(event) =>
                onFilterChange({
                  workload: event.target.value as WorkloadBand | "all",
                })
              }
              options={[
                { value: "all", label: "Any workload" },
                ...WORKLOAD_ORDER.map((band) => ({
                  value: band,
                  label: `${WORKLOAD_META[band].label} load`,
                })),
              ]}
            />
          </span>

          <label htmlFor={projectId} className="sr-only">
            Filter by assigned project
          </label>
          <span className="block w-48">
            <Select
              id={projectId}
              value={filters.project}
              onChange={(event) =>
                onFilterChange({ project: event.target.value })
              }
              options={[
                { value: "all", label: "Any project" },
                ...projects.map((project) => ({
                  value: project.id,
                  label: project.name,
                })),
              ]}
            />
          </span>

          <button
            type="button"
            aria-pressed={filters.blockedOnly}
            onClick={() =>
              onFilterChange({ blockedOnly: !filters.blockedOnly })
            }
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-3 text-[12px] font-medium whitespace-nowrap transition-colors",
              filters.blockedOnly
                ? "border-warning/40 bg-warning/10 text-warning"
                : "border-border-strong bg-surface-raised text-fg-muted hover:bg-surface-hover",
            )}
          >
            <Icon name="alert" className="h-4 w-4" />
            Has blocker
          </button>
        </ToolbarGroup>

        <ToolbarSpacer />

        <div className="flex items-center gap-3">
          <p
            aria-live="polite"
            className="text-[11.5px] whitespace-nowrap text-fg-subtle"
          >
            {shown} of {total} agents
          </p>
          {hasActiveAgentFilters(filters) && (
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
