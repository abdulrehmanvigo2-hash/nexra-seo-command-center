"use client";

import { useId } from "react";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { Toolbar, ToolbarGroup, ToolbarSpacer } from "@/components/ui/toolbar";
import { cn } from "@/lib/cn";
import {
  ANCHOR_META,
  ANCHOR_ORDER,
  CATEGORY_META,
  CATEGORY_ORDER,
  LINK_KIND_META,
  LINK_KIND_ORDER,
  LINK_REL_META,
  LINK_REL_ORDER,
  LINK_STATUS_META,
  LINK_STATUS_ORDER,
  OUTREACH_KIND_META,
  OUTREACH_KIND_ORDER,
  QUALITY_META,
  QUALITY_ORDER,
  RELATIONSHIP_META,
  RELATIONSHIP_ORDER,
  RELEVANCE_META,
  RELEVANCE_ORDER,
  SEVERITY_META,
  SEVERITY_ORDER,
} from "@/lib/mock/backlinks";
import {
  activeLinkFilterCount,
  hasActiveLinkFilters,
  type LinkFilters,
} from "@/components/backlinks/filters";

/**
 * Search, filters and sort for the Backlinks & Authority workspace.
 *
 * Every option is offered with the number of records behind it, and an option
 * that would select nothing is not offered at all: a filter value that empties
 * the table is a control that wastes the reader's time.
 */

export type LinkFilterCounts = {
  readonly status: Readonly<Record<string, number>>;
  readonly quality: Readonly<Record<string, number>>;
  readonly rel: Readonly<Record<string, number>>;
  readonly kind: Readonly<Record<string, number>>;
  readonly anchorKind: Readonly<Record<string, number>>;
  readonly category: Readonly<Record<string, number>>;
  readonly relevance: Readonly<Record<string, number>>;
  readonly relationship: Readonly<Record<string, number>>;
  readonly outreachKind: Readonly<Record<string, number>>;
  readonly severity: Readonly<Record<string, number>>;
  readonly flagged: number;
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

export function LinkToolbar({
  filters,
  onFilterChange,
  onReset,
  counts,
  sortControl,
  projects,
  domains,
  advanced,
  onToggleAdvanced,
  total,
  shown,
  noun,
}: {
  filters: LinkFilters;
  onFilterChange: (patch: Partial<LinkFilters>) => void;
  onReset: () => void;
  counts: LinkFilterCounts;
  /** The sort control for whichever table the active tab shows. */
  sortControl?: React.ReactNode;
  projects: readonly { readonly id: string; readonly name: string }[];
  domains: readonly {
    readonly id: string;
    readonly label: string;
    readonly projectId: string;
  }[];
  advanced: boolean;
  onToggleAdvanced: () => void;
  total: number;
  shown: number;
  noun: string;
}) {
  const searchId = useId();
  const count = activeLinkFilterCount(filters);

  // Narrowing to a project should narrow what the domain selector offers — a
  // referring domain on another client's profile is not a choice here.
  const scopedDomains =
    filters.project === "all"
      ? domains
      : domains.filter((entry) => entry.projectId === filters.project);

  return (
    <>
      <Toolbar label="Search and sort the link profile" className="gap-x-3">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <label htmlFor={searchId} className="sr-only">
            Search by domain, anchor, target page, or project
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
            placeholder="Search domain, anchor, page, or project"
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
            aria-pressed={filters.flaggedOnly}
            onClick={() => onFilterChange({ flaggedOnly: !filters.flaggedOnly })}
            title="Show only links and domains carrying a risk signal"
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-3 text-[12px] font-medium whitespace-nowrap transition-colors",
              filters.flaggedOnly
                ? "border-critical/40 bg-critical/10 text-critical"
                : "border-border-strong bg-surface-raised text-fg-muted hover:bg-surface-hover",
            )}
          >
            <Icon name="shield" className="h-4 w-4" />
            Flagged
            <span className="tabular">({counts.flagged})</span>
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

      <Toolbar label="Filter by link quality" className="gap-x-3">
        <Segmented
          label="Filter by link quality"
          value={filters.quality}
          onChange={(quality) => onFilterChange({ quality })}
          options={[
            { value: "all" as const, label: "All", count: counts.total },
            ...QUALITY_ORDER.filter(
              (band) => (counts.quality[band] ?? 0) > 0,
            ).map((band) => ({
              value: band,
              label: QUALITY_META[band].label,
              count: counts.quality[band],
              title: QUALITY_META[band].description,
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
          {hasActiveLinkFilters(filters) && (
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
                // Changing project invalidates the domain beneath it.
                onFilterChange({ project, domain: "all" })
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
              label="Referring domain"
              value={filters.domain}
              onChange={(domain) => onFilterChange({ domain })}
              options={[
                { value: "all", label: "All domains" },
                ...scopedDomains.map((entry) => ({
                  value: entry.id,
                  label: entry.label,
                })),
              ]}
            />

            <FilterSelect
              label="Link status"
              value={filters.status}
              onChange={(status) =>
                onFilterChange({ status: status as LinkFilters["status"] })
              }
              options={optionsFrom(
                LINK_STATUS_ORDER,
                LINK_STATUS_META,
                counts.status,
                "Any status",
              )}
            />

            <FilterSelect
              label="Link attribute"
              value={filters.rel}
              onChange={(rel) =>
                onFilterChange({ rel: rel as LinkFilters["rel"] })
              }
              options={optionsFrom(
                LINK_REL_ORDER,
                LINK_REL_META,
                counts.rel,
                "Any attribute",
              )}
            />

            <FilterSelect
              label="Link type"
              value={filters.kind}
              onChange={(kind) =>
                onFilterChange({ kind: kind as LinkFilters["kind"] })
              }
              options={optionsFrom(
                LINK_KIND_ORDER,
                LINK_KIND_META,
                counts.kind,
                "Any type",
              )}
            />

            <FilterSelect
              label="Anchor kind"
              value={filters.anchorKind}
              onChange={(anchorKind) =>
                onFilterChange({
                  anchorKind: anchorKind as LinkFilters["anchorKind"],
                })
              }
              options={optionsFrom(
                ANCHOR_ORDER,
                ANCHOR_META,
                counts.anchorKind,
                "Any anchor",
              )}
            />

            <FilterSelect
              label="Domain category"
              value={filters.category}
              onChange={(category) =>
                onFilterChange({ category: category as LinkFilters["category"] })
              }
              options={optionsFrom(
                CATEGORY_ORDER,
                CATEGORY_META,
                counts.category,
                "Any category",
              )}
            />

            <FilterSelect
              label="Relevance"
              value={filters.relevance}
              onChange={(relevance) =>
                onFilterChange({
                  relevance: relevance as LinkFilters["relevance"],
                })
              }
              options={optionsFrom(
                RELEVANCE_ORDER,
                RELEVANCE_META,
                counts.relevance,
                "Any relevance",
              )}
            />

            <FilterSelect
              label="Relationship"
              value={filters.relationship}
              onChange={(relationship) =>
                onFilterChange({
                  relationship: relationship as LinkFilters["relationship"],
                })
              }
              options={optionsFrom(
                RELATIONSHIP_ORDER,
                RELATIONSHIP_META,
                counts.relationship,
                "Any relationship",
              )}
            />

            <FilterSelect
              label="Job kind"
              value={filters.outreachKind}
              onChange={(outreachKind) =>
                onFilterChange({
                  outreachKind: outreachKind as LinkFilters["outreachKind"],
                })
              }
              options={optionsFrom(
                OUTREACH_KIND_ORDER,
                OUTREACH_KIND_META,
                counts.outreachKind,
                "Any job kind",
              )}
            />

            <FilterSelect
              label="Job severity"
              value={filters.severity}
              onChange={(severity) =>
                onFilterChange({ severity: severity as LinkFilters["severity"] })
              }
              options={optionsFrom(
                SEVERITY_ORDER,
                SEVERITY_META,
                counts.severity,
                "Any severity",
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
 * Key and direction are separate controls, so every key is reachable in both
 * directions without doubling the option list.
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
        <Icon name={desc ? "trend-down" : "trend-up"} className="h-4 w-4" />
      </button>
    </div>
  );
}
