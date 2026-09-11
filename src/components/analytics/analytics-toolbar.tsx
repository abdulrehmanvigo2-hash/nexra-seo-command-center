"use client";

import { useId } from "react";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { Toolbar, ToolbarGroup, ToolbarSpacer } from "@/components/ui/toolbar";
import { cn } from "@/lib/cn";
import { DATE_RANGES } from "@/lib/mock/dashboard";
import {
  ANOMALY_KIND_META,
  ANOMALY_KIND_ORDER,
  CONFIDENCE_META,
  PAGE_STATE_META,
  PAGE_STATE_ORDER,
  SIGNIFICANCE_META,
  SIGNIFICANCE_ORDER,
  VERDICT_META,
  VERDICT_ORDER,
  WORK_KIND_META,
  WORK_KIND_ORDER,
} from "@/lib/mock/analytics";
import {
  activeAnalyticsFilterCount,
  hasActiveAnalyticsFilters,
  type AnalyticsFilters,
} from "@/components/analytics/filters";
import type { RangeId } from "@/types/analytics";

/**
 * Project, window, search, filters and sort for the Analytics workspace.
 *
 * The project and the window sit at the top rather than inside the filter
 * drawer, because changing either rebuilds the series the whole screen reads
 * from — they are the selection, not a narrowing of it.
 */

export type AnalyticsFilterCounts = {
  readonly pageState: Readonly<Record<string, number>>;
  readonly workKind: Readonly<Record<string, number>>;
  readonly anomalyKind: Readonly<Record<string, number>>;
  readonly verdict: Readonly<Record<string, number>>;
  readonly confidence: Readonly<Record<string, number>>;
  readonly significance: Readonly<Record<string, number>>;
  readonly headroom: number;
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

export function AnalyticsToolbar({
  filters,
  onFilterChange,
  onReset,
  counts,
  sortControl,
  projects,
  projectId,
  onProjectChange,
  rangeId,
  onRangeChange,
  advanced,
  onToggleAdvanced,
  total,
  shown,
  noun,
}: {
  filters: AnalyticsFilters;
  onFilterChange: (patch: Partial<AnalyticsFilters>) => void;
  onReset: () => void;
  counts: AnalyticsFilterCounts;
  sortControl?: React.ReactNode;
  projects: readonly { readonly id: string; readonly name: string }[];
  projectId: string;
  onProjectChange: (projectId: string) => void;
  rangeId: RangeId;
  onRangeChange: (rangeId: RangeId) => void;
  advanced: boolean;
  onToggleAdvanced: () => void;
  total: number;
  shown: number;
  noun: string;
}) {
  const searchId = useId();
  const projectSelectId = useId();
  const count = activeAnalyticsFilterCount(filters);

  return (
    <>
      <Toolbar label="Select the project and window" className="gap-x-3">
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

        <Segmented
          label="Reporting window"
          value={rangeId}
          onChange={onRangeChange}
          options={DATE_RANGES.map((range) => ({
            value: range.id,
            label: range.label,
            title: range.caption,
          }))}
        />
      </Toolbar>

      <Toolbar label="Search and sort analytics records" className="gap-x-3">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <label htmlFor={searchId} className="sr-only">
            Search by page, segment, work, or finding
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
            placeholder="Search page, segment, work, or finding"
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
            aria-pressed={filters.headroomOnly}
            onClick={() =>
              onFilterChange({ headroomOnly: !filters.headroomOnly })
            }
            title="Show only pages and segments with sessions still unclaimed"
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-3 text-[12px] font-medium whitespace-nowrap transition-colors",
              filters.headroomOnly
                ? "border-accent/40 bg-accent-soft text-accent"
                : "border-border-strong bg-surface-raised text-fg-muted hover:bg-surface-hover",
            )}
          >
            <Icon name="target" className="h-4 w-4" />
            Headroom
            <span className="tabular">({counts.headroom})</span>
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

      <Toolbar label="Filter by page state" className="gap-x-3">
        <Segmented
          label="Filter by page state"
          value={filters.pageState}
          onChange={(pageState) => onFilterChange({ pageState })}
          options={[
            { value: "all" as const, label: "All", count: counts.total },
            ...PAGE_STATE_ORDER.filter(
              (state) => (counts.pageState[state] ?? 0) > 0,
            ).map((state) => ({
              value: state,
              label: PAGE_STATE_META[state].label,
              count: counts.pageState[state],
              title: PAGE_STATE_META[state].description,
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
          {hasActiveAnalyticsFilters(filters) && (
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
              label="Work kind"
              value={filters.workKind}
              onChange={(workKind) =>
                onFilterChange({ workKind: workKind as AnalyticsFilters["workKind"] })
              }
              options={optionsFrom(
                WORK_KIND_ORDER,
                WORK_KIND_META,
                counts.workKind,
                "Any work kind",
              )}
            />

            <FilterSelect
              label="Finding kind"
              value={filters.anomalyKind}
              onChange={(anomalyKind) =>
                onFilterChange({
                  anomalyKind: anomalyKind as AnalyticsFilters["anomalyKind"],
                })
              }
              options={optionsFrom(
                ANOMALY_KIND_ORDER,
                ANOMALY_KIND_META,
                counts.anomalyKind,
                "Any finding",
              )}
            />

            <FilterSelect
              label="Significance"
              value={filters.significance}
              onChange={(significance) =>
                onFilterChange({
                  significance: significance as AnalyticsFilters["significance"],
                })
              }
              options={optionsFrom(
                SIGNIFICANCE_ORDER,
                SIGNIFICANCE_META,
                counts.significance,
                "Any significance",
              )}
            />

            <FilterSelect
              label="Confidence"
              value={filters.confidence}
              onChange={(confidence) =>
                onFilterChange({
                  confidence: confidence as AnalyticsFilters["confidence"],
                })
              }
              options={optionsFrom(
                ["high", "medium", "low", "none"] as const,
                CONFIDENCE_META,
                counts.confidence,
                "Any confidence",
              )}
            />

            <FilterSelect
              label="Learning verdict"
              value={filters.verdict}
              onChange={(verdict) =>
                onFilterChange({ verdict: verdict as AnalyticsFilters["verdict"] })
              }
              options={optionsFrom(
                VERDICT_ORDER,
                VERDICT_META,
                counts.verdict,
                "Any verdict",
              )}
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
