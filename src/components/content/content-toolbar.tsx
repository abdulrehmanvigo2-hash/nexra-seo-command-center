"use client";

import { useId } from "react";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { Toolbar, ToolbarGroup, ToolbarSpacer } from "@/components/ui/toolbar";
import { cn } from "@/lib/cn";
import { AGENT_IDS, AGENT_NAMES } from "@/lib/mock/agents";
import { INTENT_META, INTENT_ORDER } from "@/lib/mock/keywords";
import {
  ALIGNMENT_META,
  ALIGNMENT_ORDER,
  FORMAT_META,
  FORMAT_ORDER,
  HEALTH_META,
  HEALTH_ORDER,
  ROLE_META,
  SCORE_BAND_META,
  SCORE_BAND_ORDER,
  STAGE_META,
  STAGE_ORDER,
} from "@/lib/mock/content";
import {
  activeContentFilterCount,
  hasActiveContentFilters,
  type ContentFilters,
  type ContentFlag,
} from "@/components/content/filters";
import {
  CONTENT_SORT_OPTIONS,
  type ContentSort,
} from "@/components/content/sorting";
import type {
  AgentId,
  ContentFormat,
  ContentHealth,
  ContentRole,
  ContentScoreBand,
  IntentAlignment,
  KeywordIntent,
} from "@/types/content";

/**
 * Search, filters, and sort for the content inventory.
 *
 * Twelve filters is more than fits across a toolbar, so the two reached for
 * most — search and stage — stay on screen and the rest open in a panel that
 * says how many are currently narrowing the set. Nothing is hidden behind an
 * apply step: every control changes the table immediately, and no control here
 * does nothing.
 */

const FLAGS: readonly {
  readonly value: ContentFlag;
  readonly label: string;
  readonly description: string;
}[] = [
  { value: "all", label: "Everything", description: "No flag filter applied." },
  {
    value: "attention",
    label: "Needs attention",
    description: "Decaying, thin, unmeasured, or live and not ranking.",
  },
  {
    value: "refresh-due",
    label: "Refresh queued",
    description: "Live pages with rework already in the pipeline.",
  },
  {
    value: "orphan",
    label: "Orphaned",
    description: "Nothing on the site links to the page.",
  },
  {
    value: "cannibalised",
    label: "Cannibalised",
    description: "Another page of ours competes with it.",
  },
  {
    value: "unmapped",
    label: "No keyword mapped",
    description: "The page exists, but nothing targets it.",
  },
  {
    value: "ai-gap",
    label: "Answer-engine gap",
    description:
      "An answer is projected on its keywords and this page is not positioned for any of them.",
  },
];

export function ContentToolbar({
  filters,
  onFilterChange,
  onReset,
  stageCounts,
  ownerCounts,
  sort,
  onSortChange,
  projects,
  clusters,
  advanced,
  onToggleAdvanced,
  total,
  shown,
}: {
  filters: ContentFilters;
  onFilterChange: (patch: Partial<ContentFilters>) => void;
  onReset: () => void;
  stageCounts: Record<string, number>;
  /** How many pieces each agent owns, so empty agents are not offered. */
  ownerCounts: Record<string, number>;
  sort: { key: ContentSort; desc: boolean };
  onSortChange: (key: ContentSort) => void;
  projects: readonly { readonly id: string; readonly name: string }[];
  clusters: readonly { readonly id: string; readonly label: string }[];
  /** Whether the extra filters are open. */
  advanced: boolean;
  onToggleAdvanced: () => void;
  total: number;
  shown: number;
}) {
  const searchId = useId();
  const sortId = useId();
  const count = activeContentFilterCount(filters);

  return (
    <>
      <Toolbar label="Search and sort content" className="gap-x-3">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <label htmlFor={searchId} className="sr-only">
            Search content by title, URL, keyword, cluster, or project
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
            placeholder="Search title, URL, keyword, cluster, or project"
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
                onSortChange(event.target.value as ContentSort)
              }
              options={CONTENT_SORT_OPTIONS.map((option) => ({
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

      <Toolbar label="Filter content by stage" className="gap-x-3">
        <Segmented
          label="Filter content by production stage"
          value={filters.stage}
          onChange={(stage) => onFilterChange({ stage })}
          options={[
            { value: "all" as const, label: "All", count: stageCounts.all },
            {
              value: "in-progress" as const,
              label: "In progress",
              count: stageCounts["in-progress"],
              title: "New pieces and live pages with rework queued against them.",
            },
            ...STAGE_ORDER.filter((stage) => (stageCounts[stage] ?? 0) > 0).map(
              (stage) => ({
                value: stage,
                label: STAGE_META[stage].label,
                count: stageCounts[stage],
                title: STAGE_META[stage].description,
              }),
            ),
          ]}
        />

        <ToolbarSpacer />

        <div className="flex items-center gap-3">
          <p
            aria-live="polite"
            className="text-[11.5px] whitespace-nowrap text-fg-subtle"
          >
            {shown} of {total} pieces
          </p>
          {hasActiveContentFilters(filters) && (
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
              label="Condition"
              value={filters.health}
              onChange={(value) =>
                onFilterChange({ health: value as ContentHealth | "all" })
              }
              allLabel="Any condition"
              options={HEALTH_ORDER.map((health) => ({
                value: health,
                label: HEALTH_META[health].label,
              }))}
            />

            <FilterSelect
              label="Format"
              value={filters.format}
              onChange={(value) =>
                onFilterChange({ format: value as ContentFormat | "all" })
              }
              allLabel="Any format"
              options={FORMAT_ORDER.map((format) => ({
                value: format,
                label: FORMAT_META[format].label,
              }))}
            />

            <FilterSelect
              label="Content score"
              value={filters.score}
              onChange={(value) =>
                onFilterChange({ score: value as ContentScoreBand | "all" })
              }
              allLabel="Any score"
              options={SCORE_BAND_ORDER.map((band) => ({
                value: band,
                label: `${SCORE_BAND_META[band].label} (${SCORE_BAND_META[band].range})`,
              }))}
            />

            <FilterSelect
              label="Intent fit"
              value={filters.alignment}
              onChange={(value) =>
                onFilterChange({ alignment: value as IntentAlignment | "all" })
              }
              allLabel="Any alignment"
              options={ALIGNMENT_ORDER.map((entry) => ({
                value: entry,
                label: ALIGNMENT_META[entry].label,
              }))}
            />

            <FilterSelect
              label="Search intent"
              value={filters.intent}
              onChange={(value) =>
                onFilterChange({ intent: value as KeywordIntent | "all" })
              }
              allLabel="Any intent"
              options={INTENT_ORDER.map((intent) => ({
                value: intent,
                label: INTENT_META[intent].label,
              }))}
            />

            <FilterSelect
              label="Cluster role"
              value={filters.role}
              onChange={(value) =>
                onFilterChange({ role: value as ContentRole | "all" })
              }
              allLabel="Any role"
              options={(["pillar", "supporting"] as const).map((role) => ({
                value: role,
                label: ROLE_META[role].label,
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
              label="Owner"
              value={filters.owner}
              onChange={(value) =>
                onFilterChange({ owner: value as AgentId | "all" })
              }
              allLabel="Any agent"
              options={AGENT_IDS.filter(
                (agent) => (ownerCounts[agent] ?? 0) > 0,
              ).map((agent) => ({
                value: agent,
                label: `${AGENT_NAMES[agent as AgentId]} (${ownerCounts[agent]})`,
              }))}
            />

            <FilterSelect
              label="Flag"
              value={filters.flag}
              onChange={(value) =>
                onFilterChange({ flag: value as ContentFlag })
              }
              allLabel={FLAGS[0].label}
              options={FLAGS.slice(1).map((flag) => ({
                value: flag.value,
                label: flag.label,
              }))}
              hint={
                FLAGS.find((flag) => flag.value === filters.flag)?.description
              }
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
  options,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  allLabel: string;
  options: readonly { readonly value: string; readonly label: string }[];
  /** Shown under the control where the selection needs explaining. */
  hint?: string;
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
          options={[{ value: "all", label: allLabel }, ...options]}
        />
      </div>
      {hint && value !== "all" && (
        <p className="mt-1.5 text-[10.5px] leading-snug text-fg-subtle">
          {hint}
        </p>
      )}
    </div>
  );
}
