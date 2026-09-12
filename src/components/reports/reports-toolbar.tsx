"use client";

import { useId } from "react";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { Toolbar, ToolbarGroup, ToolbarSpacer } from "@/components/ui/toolbar";
import { cn } from "@/lib/cn";
import {
  AUDIENCE_META,
  AUDIENCE_ORDER,
  BAND_META,
  BAND_ORDER,
  CADENCE_META,
  CADENCE_ORDER,
  STATUS_META,
  STATUS_ORDER,
} from "@/lib/mock/reports";
import {
  activeReportFilterCount,
  hasActiveReportFilters,
  type ReportFilters,
} from "@/components/reports/filters";

/**
 * Project, search, filters and sort for the Reports workspace.
 *
 * The project sits at the top rather than inside the filter drawer, because
 * changing it rebuilds every count on the screen — it is the selection, not a
 * narrowing of it.
 *
 * Every option below is built from a live count and hidden when that count is
 * zero, so no control here can ever be chosen and return nothing.
 */

export type ReportFilterCounts = {
  readonly status: Readonly<Record<string, number>>;
  readonly band: Readonly<Record<string, number>>;
  readonly audience: Readonly<Record<string, number>>;
  readonly cadence: Readonly<Record<string, number>>;
  readonly template: Readonly<Record<string, number>>;
  readonly outstanding: number;
  readonly total: number;
};

type OptionSet = readonly { readonly value: string; readonly label: string }[];

function optionsFrom<T extends string>(
  order: readonly T[],
  meta: Readonly<Record<T, { label: string }>>,
  counts: Readonly<Record<string, number>>,
  allLabel: string,
): OptionSet {
  return [
    { value: "all", label: allLabel },
    ...order
      .filter((key) => (counts[key] ?? 0) > 0)
      .map((key) => ({
        value: key,
        label: `${meta[key].label} (${counts[key]})`,
      })),
  ];
}

export function ReportsToolbar({
  filters,
  onFilterChange,
  onReset,
  counts,
  sortControl,
  projects,
  projectId,
  onProjectChange,
  templates,
  advanced,
  onToggleAdvanced,
  total,
  shown,
  noun,
}: {
  filters: ReportFilters;
  onFilterChange: (patch: Partial<ReportFilters>) => void;
  onReset: () => void;
  counts: ReportFilterCounts;
  sortControl?: React.ReactNode;
  projects: readonly { readonly id: string; readonly name: string }[];
  projectId: string;
  onProjectChange: (projectId: string) => void;
  templates: readonly { readonly id: string; readonly name: string }[];
  advanced: boolean;
  onToggleAdvanced: () => void;
  total: number;
  shown: number;
  noun: string;
}) {
  const searchId = useId();
  const projectSelectId = useId();
  const count = activeReportFilterCount(filters);

  return (
    <>
      <Toolbar label="Select the project" className="gap-x-3">
        <div className="flex min-w-0 items-center gap-2">
          <label
            htmlFor={projectSelectId}
            className="text-[11px] font-medium tracking-[0.03em] whitespace-nowrap text-fg-subtle uppercase"
          >
            Project
          </label>
          <Select
            id={projectSelectId}
            size="sm"
            className="h-9 min-w-0"
            value={projectId}
            onChange={(event) => onProjectChange(event.target.value)}
            options={[
              { value: "portfolio", label: "Whole portfolio" },
              ...projects.map((project) => ({
                value: project.id,
                label: project.name,
              })),
            ]}
          />
        </div>

        <ToolbarSpacer />

        {/* Wraps rather than staying on one line: at 375px a nowrap note is
            wider than the panel and gets clipped by its own overflow rule. */}
        <p className="min-w-0 text-[11.5px] text-fg-subtle">
          Reports compose figures the modules publish. Nothing here is
          recalculated.
        </p>
      </Toolbar>

      <Toolbar label="Search and sort reports" className="gap-x-3">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <label htmlFor={searchId} className="sr-only">
            Search by report, client, template, or period
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
            placeholder="Search report, client, template, or period"
            className={cn(
              "h-9 w-full rounded-md border border-border bg-surface-raised pr-3 pl-8 text-[12.5px] text-fg transition-colors",
              "placeholder:text-fg-subtle hover:border-border-strong focus:border-accent focus:outline-none",
            )}
          />
        </div>

        <ToolbarSpacer />

        <ToolbarGroup>
          <button
            type="button"
            aria-pressed={filters.outstandingOnly}
            onClick={() =>
              onFilterChange({ outstandingOnly: !filters.outstandingOnly })
            }
            title="Show only reports still waiting on a decision"
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-3 text-[12px] font-medium whitespace-nowrap transition-colors",
              filters.outstandingOnly
                ? "border-accent/40 bg-accent-soft text-accent"
                : "border-border-strong bg-surface-raised text-fg-muted hover:bg-surface-hover",
            )}
          >
            <Icon name="flag" className="h-4 w-4" />
            Outstanding
            <span className="tabular">({counts.outstanding})</span>
          </button>

          <button
            type="button"
            aria-pressed={advanced}
            aria-expanded={advanced}
            onClick={onToggleAdvanced}
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-3 text-[12px] font-medium whitespace-nowrap transition-colors",
              advanced || count > 0
                ? "border-accent/40 bg-accent-soft text-accent"
                : "border-border-strong bg-surface-raised text-fg-muted hover:bg-surface-hover",
            )}
          >
            <Icon name="filter" className="h-4 w-4" />
            Filters
            {count > 0 && <span className="tabular">({count})</span>}
          </button>

          {sortControl}
        </ToolbarGroup>
      </Toolbar>

      <Toolbar label="Filter by status" className="gap-x-3">
        <Segmented
          label="Filter by status"
          value={filters.status}
          onChange={(status) => onFilterChange({ status })}
          options={[
            { value: "all" as const, label: "All", count: counts.total },
            ...STATUS_ORDER.filter(
              (status) => (counts.status[status] ?? 0) > 0,
            ).map((status) => ({
              value: status,
              label: STATUS_META[status].label,
              count: counts.status[status],
              title: STATUS_META[status].description,
            })),
          ]}
        />

        <ToolbarSpacer />

        <div className="flex items-center gap-3">
          <p
            aria-live="polite"
            className="text-[11.5px] whitespace-nowrap text-fg-subtle"
          >
            {shown} of {total} {noun}
          </p>
          {hasActiveReportFilters(filters) && (
            <Button variant="ghost" icon="close" onClick={onReset}>
              Clear
            </Button>
          )}
        </div>
      </Toolbar>

      {advanced && (
        <div className="border-t border-border px-4 py-3 sm:px-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FilterSelect
              label="Completeness"
              value={filters.band}
              onChange={(band) =>
                onFilterChange({ band: band as ReportFilters["band"] })
              }
              options={optionsFrom(
                BAND_ORDER,
                BAND_META,
                counts.band,
                "Any completeness",
              )}
            />

            <FilterSelect
              label="Audience"
              value={filters.audience}
              onChange={(audience) =>
                onFilterChange({
                  audience: audience as ReportFilters["audience"],
                })
              }
              options={optionsFrom(
                AUDIENCE_ORDER,
                AUDIENCE_META,
                counts.audience,
                "Any audience",
              )}
            />

            <FilterSelect
              label="Cadence"
              value={filters.cadence}
              onChange={(cadence) =>
                onFilterChange({ cadence: cadence as ReportFilters["cadence"] })
              }
              options={optionsFrom(
                CADENCE_ORDER,
                CADENCE_META,
                counts.cadence,
                "Any cadence",
              )}
            />

            <FilterSelect
              label="Template"
              value={filters.templateId}
              onChange={(templateId) => onFilterChange({ templateId })}
              options={[
                { value: "all", label: "Any template" },
                ...templates
                  .filter((entry) => (counts.template[entry.id] ?? 0) > 0)
                  .map((entry) => ({
                    value: entry.id,
                    label: `${entry.name} (${counts.template[entry.id]})`,
                  })),
              ]}
            />
          </div>
        </div>
      )}
    </>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: OptionSet;
}) {
  const id = useId();

  return (
    <div className="min-w-0">
      <label
        htmlFor={id}
        className="block text-[11px] font-medium tracking-[0.03em] text-fg-subtle uppercase"
      >
        {label}
      </label>
      <Select
        id={id}
        className="mt-1.5 w-full"
        size="sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        options={options}
      />
    </div>
  );
}

/** The sort control for the active table. */
export function SortControl<T extends string>({
  value,
  desc,
  onChange,
  options,
  label,
}: {
  value: T;
  desc: boolean;
  onChange: (key: T, desc: boolean) => void;
  options: readonly {
    readonly value: T;
    readonly label: string;
    readonly desc: boolean;
  }[];
  label: string;
}) {
  const id = useId();
  const active = options.find((option) => option.value === value);

  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Select
        id={id}
        size="sm"
        className="h-9"
        value={value}
        onChange={(event) => {
          const next = event.target.value as T;
          const option = options.find((entry) => entry.value === next);
          onChange(next, option?.desc ?? true);
        }}
        options={options.map((option) => ({
          value: option.value,
          label: option.label,
        }))}
      />
      <button
        type="button"
        onClick={() => onChange(value, !desc)}
        aria-label={`${active?.label ?? label}: ${desc ? "descending" : "ascending"}. Reverse the order.`}
        title={desc ? "Highest first" : "Lowest first"}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border-strong bg-surface-raised text-fg-muted transition-colors hover:bg-surface-hover"
      >
        <Icon name={desc ? "trend-down" : "trend-up"} className="h-4 w-4" />
      </button>
    </div>
  );
}
