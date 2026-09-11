"use client";

import { useId } from "react";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { Toolbar, ToolbarGroup, ToolbarSpacer } from "@/components/ui/toolbar";
import { cn } from "@/lib/cn";
import {
  CANONICAL_META,
  CANONICAL_ORDER,
  CATEGORY_META,
  CATEGORY_ORDER,
  CRAWL_STATE_META,
  CRAWL_STATE_ORDER,
  CWV_META,
  CWV_ORDER,
  INDEXABILITY_META,
  INDEXABILITY_ORDER,
  INDEX_STATUS_META,
  INDEX_STATUS_ORDER,
  SCHEMA_META,
  SCHEMA_ORDER,
  SEVERITY_META,
  SEVERITY_ORDER,
} from "@/lib/mock/technical";
import {
  activeTechnicalFilterCount,
  hasActiveTechnicalFilters,
  type TechnicalFilters,
} from "@/components/technical/filters";

/**
 * Search, filters, and sort for the Technical SEO workspace.
 *
 * Every option is offered with the number of records behind it, and an option
 * that would select nothing is not offered at all: a filter value that empties
 * the table is a control that wastes the reader's time.
 */

/** Counts behind each option, so nothing dead is offered. */
export type TechnicalFilterCounts = {
  readonly severity: Readonly<Record<string, number>>;
  readonly category: Readonly<Record<string, number>>;
  readonly crawlState: Readonly<Record<string, number>>;
  readonly indexStatus: Readonly<Record<string, number>>;
  readonly indexability: Readonly<Record<string, number>>;
  readonly canonical: Readonly<Record<string, number>>;
  readonly cwv: Readonly<Record<string, number>>;
  readonly schema: Readonly<Record<string, number>>;
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

export function TechnicalToolbar({
  filters,
  onFilterChange,
  onReset,
  counts,
  sortControl,
  projects,
  clusters,
  advanced,
  onToggleAdvanced,
  total,
  shown,
  noun,
}: {
  filters: TechnicalFilters;
  onFilterChange: (patch: Partial<TechnicalFilters>) => void;
  onReset: () => void;
  counts: TechnicalFilterCounts;
  /** The sort control for whichever table the active tab shows. */
  sortControl?: React.ReactNode;
  projects: readonly { readonly id: string; readonly name: string }[];
  clusters: readonly {
    readonly id: string;
    readonly label: string;
    readonly projectId: string;
  }[];
  advanced: boolean;
  onToggleAdvanced: () => void;
  total: number;
  shown: number;
  /** Plural noun for what the count describes, e.g. "pages". */
  noun: string;
}) {
  const searchId = useId();
  const count = activeTechnicalFilterCount(filters);

  // Narrowing to a project should narrow what the cluster selector offers — a
  // cluster from another client's site is not a choice here.
  const scopedClusters =
    filters.project === "all"
      ? clusters
      : clusters.filter((entry) => entry.projectId === filters.project);

  return (
    <>
      <Toolbar label="Search and sort technical records" className="gap-x-3">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <label htmlFor={searchId} className="sr-only">
            Search by URL, page title, project, cluster, or finding
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
            placeholder="Search URL, page, project, or finding"
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

      <Toolbar label="Filter by severity" className="gap-x-3">
        <Segmented
          label="Filter by severity"
          value={filters.severity}
          onChange={(severity) => onFilterChange({ severity })}
          options={[
            { value: "all" as const, label: "All", count: counts.total },
            ...SEVERITY_ORDER.filter(
              (band) => (counts.severity[band] ?? 0) > 0,
            ).map((band) => ({
              value: band,
              label: SEVERITY_META[band].label,
              count: counts.severity[band],
              title: SEVERITY_META[band].description,
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
          {hasActiveTechnicalFilters(filters) && (
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
              label="Project"
              value={filters.project}
              onChange={(project) =>
                // Changing project invalidates the cluster beneath it.
                onFilterChange({ project, cluster: "all" })
              }
              options={[
                { value: "all", label: "All projects" },
                ...projects.map((project) => ({
                  value: project.id,
                  label: project.name,
                })),
              ]}
            />

            <FilterSelect
              label="Cluster"
              value={filters.cluster}
              onChange={(cluster) => onFilterChange({ cluster })}
              options={[
                { value: "all", label: "All clusters" },
                ...scopedClusters.map((entry) => ({
                  value: entry.id,
                  label: entry.label,
                })),
              ]}
            />

            <FilterSelect
              label="Category"
              value={filters.category}
              onChange={(category) =>
                onFilterChange({
                  category: category as TechnicalFilters["category"],
                })
              }
              options={optionsFrom(
                CATEGORY_ORDER,
                CATEGORY_META,
                counts.category,
                "All categories",
              )}
            />

            <FilterSelect
              label="Crawl state"
              value={filters.crawlState}
              onChange={(crawlState) =>
                onFilterChange({
                  crawlState: crawlState as TechnicalFilters["crawlState"],
                })
              }
              options={optionsFrom(
                CRAWL_STATE_ORDER,
                CRAWL_STATE_META,
                counts.crawlState,
                "Any crawl state",
              )}
            />

            <FilterSelect
              label="Index status"
              value={filters.indexStatus}
              onChange={(indexStatus) =>
                onFilterChange({
                  indexStatus: indexStatus as TechnicalFilters["indexStatus"],
                })
              }
              options={optionsFrom(
                INDEX_STATUS_ORDER,
                INDEX_STATUS_META,
                counts.indexStatus,
                "Any index status",
              )}
            />

            <FilterSelect
              label="Indexability"
              value={filters.indexability}
              onChange={(indexability) =>
                onFilterChange({
                  indexability: indexability as TechnicalFilters["indexability"],
                })
              }
              options={optionsFrom(
                INDEXABILITY_ORDER,
                INDEXABILITY_META,
                counts.indexability,
                "Any indexability",
              )}
            />

            <FilterSelect
              label="Canonical"
              value={filters.canonical}
              onChange={(canonical) =>
                onFilterChange({
                  canonical: canonical as TechnicalFilters["canonical"],
                })
              }
              options={optionsFrom(
                CANONICAL_ORDER,
                CANONICAL_META,
                counts.canonical,
                "Any canonical",
              )}
            />

            <FilterSelect
              label="Core Web Vitals"
              value={filters.cwv}
              onChange={(cwv) =>
                onFilterChange({ cwv: cwv as TechnicalFilters["cwv"] })
              }
              options={optionsFrom(
                CWV_ORDER,
                CWV_META,
                counts.cwv,
                "Any vitals state",
              )}
            />

            <FilterSelect
              label="Structured data"
              value={filters.schema}
              onChange={(schema) =>
                onFilterChange({ schema: schema as TechnicalFilters["schema"] })
              }
              options={optionsFrom(
                SCHEMA_ORDER,
                SCHEMA_META,
                counts.schema,
                "Any schema state",
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

/**
 * The sort control for the active table.
 *
 * The key and the direction are separate controls rather than a combined list,
 * so every key is reachable in both directions without doubling the options.
 */
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
        <Icon
          name={desc ? "trend-down" : "trend-up"}
          className="h-4 w-4"
        />
      </button>
    </div>
  );
}
