"use client";

import { useId } from "react";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { Toolbar, ToolbarGroup, ToolbarSpacer } from "@/components/ui/toolbar";
import { cn } from "@/lib/cn";
import {
  AI_FILTER_META,
  AI_FILTER_ORDER,
  CANNIBALIZATION_RISK_META,
  CANNIBALIZATION_RISK_ORDER,
  DIFFICULTY_BAND_META,
  DIFFICULTY_BAND_ORDER,
  INTENT_META,
  INTENT_ORDER,
  KEYWORD_STATUS_META,
  OPPORTUNITY_BAND_META,
  OPPORTUNITY_BAND_ORDER,
  RANKING_STATUS_META,
  RANKING_STATUS_ORDER,
  SERP_FEATURE_META,
  SERP_FEATURE_ORDER,
  VOLUME_BAND_META,
  VOLUME_BAND_ORDER,
} from "@/lib/mock/keywords";
import {
  activeFilterCount,
  hasActiveKeywordFilters,
  type KeywordFilters,
} from "@/components/keywords/filters";
import {
  KEYWORD_SORT_OPTIONS,
  type KeywordSort,
} from "@/components/keywords/sorting";
import type {
  AiKeywordFilter,
  CannibalizationRisk,
  DifficultyBand,
  KeywordList,
  KeywordStatus,
  OpportunityBand,
  RankingStatus,
  SerpFeatureId,
  VolumeBand,
} from "@/types/keyword";

/**
 * Search, filters, and sort for the keyword table.
 *
 * Twelve filters is more than fits across a toolbar, so the two people reach
 * for most — search and intent — stay on screen, and the rest open in a panel
 * that says how many of them are currently narrowing the set. Nothing is
 * hidden behind an apply step: every control changes the table immediately,
 * and no control here does nothing.
 */

const KEYWORD_STATUSES: readonly KeywordStatus[] = [
  "improving",
  "declining",
  "stable",
  "new",
  "lost",
];

export function KeywordsToolbar({
  filters,
  onFilterChange,
  onReset,
  intentCounts,
  sort,
  onSortChange,
  projects,
  clusters,
  lists,
  advanced,
  onToggleAdvanced,
  total,
  shown,
}: {
  filters: KeywordFilters;
  onFilterChange: (patch: Partial<KeywordFilters>) => void;
  onReset: () => void;
  intentCounts: Record<string, number>;
  sort: { key: KeywordSort; desc: boolean };
  onSortChange: (key: KeywordSort) => void;
  projects: readonly { readonly id: string; readonly name: string }[];
  clusters: readonly { readonly id: string; readonly label: string }[];
  lists: readonly KeywordList[];
  /** Whether the extra filters are open. */
  advanced: boolean;
  onToggleAdvanced: () => void;
  total: number;
  shown: number;
}) {
  const searchId = useId();
  const sortId = useId();
  const count = activeFilterCount(filters);

  return (
    <>
      <Toolbar label="Search and sort keywords" className="gap-x-3">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <label htmlFor={searchId} className="sr-only">
            Search keywords by term, URL, cluster, or project
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
            placeholder="Search keyword, URL, cluster, or project"
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

          <label htmlFor={sortId} className="text-[11.5px] text-fg-subtle">
            Sort
          </label>
          <span className="block w-44">
            <Select
              id={sortId}
              value={sort.key}
              onChange={(event) =>
                onSortChange(event.target.value as KeywordSort)
              }
              options={KEYWORD_SORT_OPTIONS.map((option) => ({
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
        </ToolbarGroup>
      </Toolbar>

      <Toolbar label="Filter keywords by intent" className="gap-x-3">
        <Segmented
          label="Filter keywords by search intent"
          value={filters.intent}
          onChange={(intent) => onFilterChange({ intent })}
          options={[
            { value: "all" as const, label: "All", count: intentCounts.all },
            ...INTENT_ORDER.filter(
              (intent) => (intentCounts[intent] ?? 0) > 0,
            ).map((intent) => ({
              value: intent,
              label: INTENT_META[intent].label,
              count: intentCounts[intent],
              title: INTENT_META[intent].description,
            })),
          ]}
        />

        <ToolbarSpacer />

        <div className="flex items-center gap-3">
          <p
            aria-live="polite"
            className="text-[11.5px] whitespace-nowrap text-fg-subtle"
          >
            {shown} of {total} keywords
          </p>
          {hasActiveKeywordFilters(filters) && (
            <Button variant="ghost" icon="close" onClick={onReset}>
              Clear
            </Button>
          )}
        </div>
      </Toolbar>

      {advanced && (
        <div className="border-b border-border bg-surface-raised px-4 py-3.5 sm:px-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <FilterSelect
              label="Position range"
              value={filters.position}
              onChange={(value) =>
                onFilterChange({ position: value as RankingStatus | "all" })
              }
              allLabel="Any position"
              options={RANKING_STATUS_ORDER.map((band) => ({
                value: band,
                label: RANKING_STATUS_META[band].label,
              }))}
            />

            <FilterSelect
              label="Ranking status"
              value={filters.status}
              onChange={(value) =>
                onFilterChange({ status: value as KeywordStatus | "all" })
              }
              allLabel="Any status"
              options={KEYWORD_STATUSES.map((status) => ({
                value: status,
                label: KEYWORD_STATUS_META[status].label,
              }))}
            />

            <FilterSelect
              label="Difficulty"
              value={filters.difficulty}
              onChange={(value) =>
                onFilterChange({ difficulty: value as DifficultyBand | "all" })
              }
              allLabel="Any difficulty"
              options={DIFFICULTY_BAND_ORDER.map((band) => ({
                value: band,
                label: `${DIFFICULTY_BAND_META[band].label} (${DIFFICULTY_BAND_META[band].range})`,
              }))}
            />

            <FilterSelect
              label="Search volume"
              value={filters.volume}
              onChange={(value) =>
                onFilterChange({ volume: value as VolumeBand | "all" })
              }
              allLabel="Any volume"
              options={VOLUME_BAND_ORDER.map((band) => ({
                value: band,
                label: `${VOLUME_BAND_META[band].label} (${VOLUME_BAND_META[band].range})`,
              }))}
            />

            <FilterSelect
              label="Opportunity score"
              value={filters.opportunity}
              onChange={(value) =>
                onFilterChange({ opportunity: value as OpportunityBand | "all" })
              }
              allLabel="Any score"
              options={OPPORTUNITY_BAND_ORDER.map((band) => ({
                value: band,
                label: `${OPPORTUNITY_BAND_META[band].label} (${OPPORTUNITY_BAND_META[band].range})`,
              }))}
            />

            <FilterSelect
              label="Project"
              value={filters.project}
              onChange={(value) => onFilterChange({ project: value })}
              allLabel="Every project"
              options={projects.map((project) => ({
                value: project.id,
                label: project.name,
              }))}
            />

            <FilterSelect
              label="Cluster"
              value={filters.cluster}
              onChange={(value) => onFilterChange({ cluster: value })}
              allLabel="Every cluster"
              options={clusters.map((cluster) => ({
                value: cluster.id,
                label: cluster.label,
              }))}
            />

            <FilterSelect
              label="SERP feature"
              value={filters.serpFeature}
              onChange={(value) =>
                onFilterChange({ serpFeature: value as SerpFeatureId | "all" })
              }
              allLabel="Any SERP"
              options={SERP_FEATURE_ORDER.map((feature) => ({
                value: feature,
                label: SERP_FEATURE_META[feature].label,
              }))}
            />

            <FilterSelect
              label="AI search relevance"
              value={filters.ai}
              onChange={(value) =>
                onFilterChange({ ai: value as AiKeywordFilter })
              }
              allLabel={AI_FILTER_META.all.label}
              allValue="all"
              options={AI_FILTER_ORDER.filter((entry) => entry !== "all").map(
                (entry) => ({
                  value: entry,
                  label: AI_FILTER_META[entry].label,
                }),
              )}
            />

            <FilterSelect
              label="Cannibalisation risk"
              value={filters.cannibalization}
              onChange={(value) =>
                onFilterChange({
                  cannibalization: value as CannibalizationRisk | "any" | "all",
                })
              }
              allLabel="Any keyword"
              options={[
                { value: "any", label: "Cannibalised (all risks)" },
                ...CANNIBALIZATION_RISK_ORDER.map((risk) => ({
                  value: risk,
                  label: `${CANNIBALIZATION_RISK_META[risk].label} risk`,
                })),
              ]}
            />

            <FilterSelect
              label="Saved list"
              value={filters.list}
              onChange={(value) => onFilterChange({ list: value })}
              allLabel="Every keyword"
              options={lists.map((list) => ({
                value: list.id,
                label: `${list.name} (${list.keywordIds.length})`,
              }))}
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
  allLabel,
  allValue = "all",
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  allLabel: string;
  allValue?: string;
  options: readonly { readonly value: string; readonly label: string }[];
}) {
  const id = useId();

  return (
    <div className="min-w-0">
      <label
        htmlFor={id}
        className="block text-[11px] font-medium text-fg-subtle"
      >
        {label}
      </label>
      <div className="mt-1.5">
        <Select
          id={id}
          size="sm"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          options={[{ value: allValue, label: allLabel }, ...options]}
        />
      </div>
    </div>
  );
}
