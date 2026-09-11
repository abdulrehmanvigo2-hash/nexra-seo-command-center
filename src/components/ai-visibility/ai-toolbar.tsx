"use client";

import { useId } from "react";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { Toolbar, ToolbarGroup, ToolbarSpacer } from "@/components/ui/toolbar";
import { cn } from "@/lib/cn";
import {
  CITATION_META,
  CITATION_ORDER,
  CONFIDENCE_META,
  ENTITY_TYPE_META,
  ENTITY_TYPE_ORDER,
  EVIDENCE_BAND_META,
  EVIDENCE_BAND_ORDER,
  GAP_KIND_ORDER,
  GAP_META,
  OPPORTUNITY_KIND_META,
  OPPORTUNITY_KIND_ORDER,
  READINESS_META,
  READINESS_ORDER,
  SEVERITY_META,
  SEVERITY_ORDER,
} from "@/lib/mock/ai-visibility";
import {
  activeAiFilterCount,
  hasActiveAiFilters,
  type AiFilters,
} from "@/components/ai-visibility/filters";

/**
 * Search, filters and sort for the AI Visibility workspace.
 *
 * Every option is offered with the number of records behind it, and an option
 * that would select nothing is not offered at all: a filter value that empties
 * the table is a control that wastes the reader's time.
 */

export type AiFilterCounts = {
  readonly band: Readonly<Record<string, number>>;
  readonly citation: Readonly<Record<string, number>>;
  readonly evidence: Readonly<Record<string, number>>;
  readonly entityType: Readonly<Record<string, number>>;
  readonly gapKind: Readonly<Record<string, number>>;
  readonly opportunityKind: Readonly<Record<string, number>>;
  readonly severity: Readonly<Record<string, number>>;
  readonly confidence: Readonly<Record<string, number>>;
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

export function AiToolbar({
  filters,
  onFilterChange,
  onReset,
  counts,
  sortControl,
  projects,
  topics,
  advanced,
  onToggleAdvanced,
  total,
  shown,
  noun,
}: {
  filters: AiFilters;
  onFilterChange: (patch: Partial<AiFilters>) => void;
  onReset: () => void;
  counts: AiFilterCounts;
  /** The sort control for whichever table the active tab shows. */
  sortControl?: React.ReactNode;
  projects: readonly { readonly id: string; readonly name: string }[];
  topics: readonly {
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
  const count = activeAiFilterCount(filters);

  // Narrowing to a project should narrow what the topic selector even offers.
  const scopedTopics =
    filters.project === "all"
      ? topics
      : topics.filter((entry) => entry.projectId === filters.project);

  return (
    <>
      <Toolbar label="Search and sort AI visibility records" className="gap-x-3">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <label htmlFor={searchId} className="sr-only">
            Search by page, topic, entity, or finding
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
            placeholder="Search page, topic, entity, or finding"
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

      <Toolbar label="Filter by readiness band" className="gap-x-3">
        <Segmented
          label="Filter by readiness band"
          value={filters.band}
          onChange={(band) => onFilterChange({ band })}
          options={[
            { value: "all" as const, label: "All", count: counts.total },
            ...READINESS_ORDER.filter(
              (band) => (counts.band[band] ?? 0) > 0,
            ).map((band) => ({
              value: band,
              label: READINESS_META[band].label,
              count: counts.band[band],
              title: READINESS_META[band].description,
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
          {hasActiveAiFilters(filters) && (
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
                // Changing project invalidates the topic beneath it.
                onFilterChange({ project, topic: "all" })
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
              label="Topic"
              value={filters.topic}
              onChange={(topic) => onFilterChange({ topic })}
              options={[
                { value: "all", label: "All topics" },
                ...scopedTopics.map((entry) => ({
                  value: entry.id,
                  label: entry.label,
                })),
              ]}
            />

            <FilterSelect
              label="Citation readiness"
              value={filters.citation}
              onChange={(citation) =>
                onFilterChange({ citation: citation as AiFilters["citation"] })
              }
              options={optionsFrom(
                CITATION_ORDER,
                CITATION_META,
                counts.citation,
                "Any readiness",
              )}
            />

            <FilterSelect
              label="Evidence"
              value={filters.evidence}
              onChange={(evidence) =>
                onFilterChange({ evidence: evidence as AiFilters["evidence"] })
              }
              options={optionsFrom(
                EVIDENCE_BAND_ORDER,
                EVIDENCE_BAND_META,
                counts.evidence,
                "Any evidence band",
              )}
            />

            <FilterSelect
              label="Entity type"
              value={filters.entityType}
              onChange={(entityType) =>
                onFilterChange({
                  entityType: entityType as AiFilters["entityType"],
                })
              }
              options={optionsFrom(
                ENTITY_TYPE_ORDER,
                ENTITY_TYPE_META,
                counts.entityType,
                "Any entity type",
              )}
            />

            <FilterSelect
              label="Gap kind"
              value={filters.gapKind}
              onChange={(gapKind) =>
                onFilterChange({ gapKind: gapKind as AiFilters["gapKind"] })
              }
              options={optionsFrom(
                GAP_KIND_ORDER,
                GAP_META,
                counts.gapKind,
                "Any gap kind",
              )}
            />

            <FilterSelect
              label="Opportunity kind"
              value={filters.opportunityKind}
              onChange={(opportunityKind) =>
                onFilterChange({
                  opportunityKind:
                    opportunityKind as AiFilters["opportunityKind"],
                })
              }
              options={optionsFrom(
                OPPORTUNITY_KIND_ORDER,
                OPPORTUNITY_KIND_META,
                counts.opportunityKind,
                "Any job kind",
              )}
            />

            <FilterSelect
              label="Severity"
              value={filters.severity}
              onChange={(severity) =>
                onFilterChange({ severity: severity as AiFilters["severity"] })
              }
              options={optionsFrom(
                SEVERITY_ORDER,
                SEVERITY_META,
                counts.severity,
                "Any severity",
              )}
            />

            <FilterSelect
              label="Gain confidence"
              value={filters.confidence}
              onChange={(confidence) =>
                onFilterChange({
                  confidence: confidence as AiFilters["confidence"],
                })
              }
              options={optionsFrom(
                ["high", "medium", "low", "unknown"] as const,
                CONFIDENCE_META,
                counts.confidence,
                "Any confidence",
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
