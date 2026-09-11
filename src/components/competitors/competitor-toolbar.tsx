"use client";

import { useId } from "react";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { Toolbar, ToolbarGroup, ToolbarSpacer } from "@/components/ui/toolbar";
import { cn } from "@/lib/cn";
import {
  DIFFICULTY_BAND_META,
  DIFFICULTY_BAND_ORDER,
  INTENT_META,
  INTENT_ORDER,
  OPPORTUNITY_BAND_META,
  OPPORTUNITY_BAND_ORDER,
  VOLUME_BAND_META,
  VOLUME_BAND_ORDER,
} from "@/lib/mock/keywords";
import {
  BATTLE_META,
  BATTLE_ORDER,
  COMPETITOR_TYPE_META,
  COMPETITOR_TYPE_ORDER,
  OVERLAP_META,
  OVERLAP_ORDER,
  THREAT_META,
  THREAT_ORDER,
} from "@/lib/mock/competitors";
import {
  activeCompetitorFilterCount,
  hasActiveCompetitorFilters,
  type CompetitorFilters,
} from "@/components/competitors/filters";
import type {
  BattleState,
  CompetitorType,
  KeywordIntent,
  OverlapType,
} from "@/types/competitor";
import type { DifficultyBand, OpportunityBand, VolumeBand } from "@/types/keyword";

/**
 * Search, filters, and sort for Competitor Intelligence.
 *
 * Eleven filters is more than fits across one row, so the two reached for most
 * — search and threat level — stay on screen and the rest open in a panel that
 * says how many are narrowing the set.
 *
 * Every option set is derived from counts the workspace passes in, and an
 * option that would select nothing is not offered. That is the difference
 * between a filter and a list of promises: a "severe threat" option in a
 * selection with no severe threats is a control that does nothing, which this
 * product does not ship (CLAUDE.md §12).
 */

/** Counts behind each option, so nothing dead is offered. */
export type FilterCounts = {
  readonly threat: Readonly<Record<string, number>>;
  readonly type: Readonly<Record<string, number>>;
  readonly battle: Readonly<Record<string, number>>;
  readonly overlap: Readonly<Record<string, number>>;
  readonly intent: Readonly<Record<string, number>>;
  readonly difficulty: Readonly<Record<string, number>>;
  readonly volume: Readonly<Record<string, number>>;
  readonly opportunity: Readonly<Record<string, number>>;
  readonly total: number;
};

export function CompetitorToolbar({
  filters,
  onFilterChange,
  onReset,
  counts,
  sortControl,
  projects,
  competitors,
  clusters,
  advanced,
  onToggleAdvanced,
  total,
  shown,
  noun,
}: {
  filters: CompetitorFilters;
  onFilterChange: (patch: Partial<CompetitorFilters>) => void;
  onReset: () => void;
  counts: FilterCounts;
  /** The sort control for whichever table the active tab shows. */
  sortControl?: React.ReactNode;
  projects: readonly { readonly id: string; readonly name: string }[];
  competitors: readonly {
    readonly id: string;
    readonly label: string;
    readonly projectId: string;
  }[];
  clusters: readonly {
    readonly id: string;
    readonly label: string;
    readonly projectId: string;
  }[];
  advanced: boolean;
  onToggleAdvanced: () => void;
  total: number;
  shown: number;
  /** Plural noun for what the count describes, e.g. "competitors". */
  noun: string;
}) {
  const searchId = useId();
  const count = activeCompetitorFilterCount(filters);

  // Narrowing to a project should narrow what the rival and cluster selectors
  // even offer — a rival from another market is not a choice here.
  const scopedCompetitors =
    filters.project === "all"
      ? competitors
      : competitors.filter((entry) => entry.projectId === filters.project);
  const scopedClusters =
    filters.project === "all"
      ? clusters
      : clusters.filter((entry) => entry.projectId === filters.project);

  return (
    <>
      <Toolbar label="Search and sort competitors" className="gap-x-3">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <label htmlFor={searchId} className="sr-only">
            Search by competitor, domain, keyword, cluster, or project
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
            placeholder="Search competitor, domain, keyword, or cluster"
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

      <Toolbar label="Filter competitors by threat level" className="gap-x-3">
        <Segmented
          label="Filter competitors by threat level"
          value={filters.threat}
          onChange={(threat) => onFilterChange({ threat })}
          options={[
            { value: "all" as const, label: "All", count: counts.total },
            ...THREAT_ORDER.filter(
              (level) => (counts.threat[level] ?? 0) > 0,
            ).map((level) => ({
              value: level,
              label: THREAT_META[level].label,
              count: counts.threat[level],
              title: THREAT_META[level].description,
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
          {hasActiveCompetitorFilters(filters) && (
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
              label="Project"
              value={filters.project}
              onChange={(value) =>
                // A rival or cluster chosen inside another project would select
                // nothing once the project changes, so both are released.
                onFilterChange({
                  project: value,
                  competitor: "all",
                  cluster: "all",
                })
              }
              allLabel="Every project"
              options={projects.map((project) => ({
                value: project.id,
                label: project.name,
              }))}
            />

            <FilterSelect
              label="Competitor"
              value={filters.competitor}
              onChange={(value) => onFilterChange({ competitor: value })}
              allLabel="Every competitor"
              options={scopedCompetitors.map((entry) => ({
                value: entry.id,
                label: entry.label,
              }))}
            />

            <FilterSelect
              label="Competitor type"
              value={filters.type}
              onChange={(value) =>
                onFilterChange({ type: value as CompetitorType | "all" })
              }
              allLabel="Any type"
              options={COMPETITOR_TYPE_ORDER.filter(
                (type) => (counts.type[type] ?? 0) > 0,
              ).map((type) => ({
                value: type,
                label: `${COMPETITOR_TYPE_META[type].label} (${counts.type[type]})`,
              }))}
            />

            <FilterSelect
              label="Opportunity"
              value={filters.opportunity}
              onChange={(value) =>
                onFilterChange({ opportunity: value as OpportunityBand | "all" })
              }
              allLabel="Any opportunity"
              options={OPPORTUNITY_BAND_ORDER.filter(
                (band) => (counts.opportunity[band] ?? 0) > 0,
              ).map((band) => ({
                value: band,
                label: `${OPPORTUNITY_BAND_META[band].label} (${counts.opportunity[band]})`,
              }))}
            />

            <FilterSelect
              label="Ranking state"
              value={filters.battle}
              onChange={(value) =>
                onFilterChange({ battle: value as BattleState | "all" })
              }
              allLabel="Any ranking state"
              options={BATTLE_ORDER.filter(
                (state) => (counts.battle[state] ?? 0) > 0,
              ).map((state) => ({
                value: state,
                label: `${BATTLE_META[state].label} (${counts.battle[state]})`,
              }))}
              hint={
                filters.battle === "all"
                  ? undefined
                  : BATTLE_META[filters.battle].description
              }
            />

            <FilterSelect
              label="Overlap"
              value={filters.overlap}
              onChange={(value) =>
                onFilterChange({ overlap: value as OverlapType | "all" })
              }
              allLabel="Any overlap"
              options={OVERLAP_ORDER.filter(
                (type) => (counts.overlap[type] ?? 0) > 0,
              ).map((type) => ({
                value: type,
                label: `${OVERLAP_META[type].label} (${counts.overlap[type]})`,
              }))}
            />

            <FilterSelect
              label="Search intent"
              value={filters.intent}
              onChange={(value) =>
                onFilterChange({ intent: value as KeywordIntent | "all" })
              }
              allLabel="Any intent"
              options={INTENT_ORDER.filter(
                (intent) => (counts.intent[intent] ?? 0) > 0,
              ).map((intent) => ({
                value: intent,
                label: `${INTENT_META[intent].label} (${counts.intent[intent]})`,
              }))}
            />

            <FilterSelect
              label="Cluster"
              value={filters.cluster}
              onChange={(value) => onFilterChange({ cluster: value })}
              allLabel="Every cluster"
              options={scopedClusters.map((entry) => ({
                value: entry.id,
                label: entry.label,
              }))}
            />

            <FilterSelect
              label="Keyword difficulty"
              value={filters.difficulty}
              onChange={(value) =>
                onFilterChange({ difficulty: value as DifficultyBand | "all" })
              }
              allLabel="Any difficulty"
              options={DIFFICULTY_BAND_ORDER.filter(
                (band) => (counts.difficulty[band] ?? 0) > 0,
              ).map((band) => ({
                value: band,
                label: `${DIFFICULTY_BAND_META[band].label} (${counts.difficulty[band]})`,
              }))}
            />

            <FilterSelect
              label="Search volume"
              value={filters.volume}
              onChange={(value) =>
                onFilterChange({ volume: value as VolumeBand | "all" })
              }
              allLabel="Any volume"
              options={VOLUME_BAND_ORDER.filter(
                (band) => (counts.volume[band] ?? 0) > 0,
              ).map((band) => ({
                value: band,
                label: `${VOLUME_BAND_META[band].label} (${counts.volume[band]})`,
              }))}
            />
          </div>

          <p className="mt-3 text-[11.5px] leading-snug text-fg-subtle">
            Options are built from the records in view, so nothing offered here
            selects an empty table. The volume, difficulty, and opportunity
            bands are the Keyword Intelligence module&rsquo;s own.
          </p>
        </div>
      )}
    </>
  );
}

/** The sort control, shared by every table in the workspace. */
export function SortControl<T extends string>({
  value,
  desc,
  onChange,
  options,
  label,
}: {
  value: T;
  desc: boolean;
  onChange: (key: T) => void;
  options: readonly { readonly value: T; readonly label: string }[];
  label: string;
}) {
  const id = useId();

  return (
    <>
      <label htmlFor={id} className="text-[11.5px] text-fg-subtle">
        Sort
      </label>
      <span className="block w-40">
        <Select
          id={id}
          aria-label={label}
          value={value}
          onChange={(event) => onChange(event.target.value as T)}
          options={options.map((option) => ({
            value: option.value,
            label: option.label,
          }))}
        />
      </span>
      <Button
        icon={desc ? "trend-down" : "trend-up"}
        onClick={() => onChange(value)}
        aria-label={
          desc
            ? "Sorted descending. Sort ascending instead."
            : "Sorted ascending. Sort descending instead."
        }
        title={desc ? "Descending" : "Ascending"}
      >
        <span className="sr-only">Reverse sort order</span>
      </Button>
    </>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  allLabel,
  options,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  allLabel: string;
  options: readonly { readonly value: string; readonly label: string }[];
  hint?: string;
}) {
  const id = useId();

  return (
    <div className="min-w-0">
      <label htmlFor={id} className="text-[11.5px] font-medium text-fg-muted">
        {label}
      </label>
      <Select
        id={id}
        className="mt-1.5"
        size="sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        options={[{ value: "all", label: allLabel }, ...options]}
      />
      {hint && (
        <p className="mt-1.5 text-[11px] leading-snug text-fg-subtle">{hint}</p>
      )}
    </div>
  );
}
