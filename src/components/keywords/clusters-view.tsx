"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/field";
import { Meter } from "@/components/ui/meter";
import { Panel, PanelBody, PanelFooter } from "@/components/ui/panel";
import { SectionHeader } from "@/components/ui/section-header";
import { Segmented } from "@/components/ui/segmented";
import { Toolbar, ToolbarGroup, ToolbarSpacer } from "@/components/ui/toolbar";
import { cn } from "@/lib/cn";
import { formatCompact } from "@/lib/format";
import {
  CLUSTER_STATUS_META,
  CLUSTER_STATUS_ORDER,
  INTENT_META,
} from "@/lib/mock/keywords";
import { OwnerLink } from "@/components/keywords/keyword-chrome";
import type { ClusterStatus, KeywordCluster } from "@/types/keyword";

/**
 * Topic clusters across the portfolio.
 *
 * Cards rather than rows: a cluster is judged on four things at once —
 * how big it is, how covered it is, how it is ranking, and what is missing —
 * and those read better side by side than strung across a table. Opening one
 * goes to its own workspace.
 *
 * Every number on a card is a reading of the keywords in the cluster, so a
 * count here and a count in the keyword table cannot disagree.
 */

type ClusterSort = "opportunity" | "volume" | "gaps" | "coverage" | "name";

const SORTS: readonly { readonly value: ClusterSort; readonly label: string }[] =
  [
    { value: "opportunity", label: "Opportunity score" },
    { value: "volume", label: "Search volume" },
    { value: "gaps", label: "Content gaps" },
    { value: "coverage", label: "Coverage" },
    { value: "name", label: "Cluster name" },
  ];

export function ClustersView({
  clusters,
  keywordIds,
  projects,
  projectFilter,
  onProjectChange,
}: {
  clusters: readonly KeywordCluster[];
  /**
   * Ids of the keywords the page-level filters have selected.
   *
   * A cluster is shown when at least one of its keywords is in the selection,
   * so searching for "radiator" narrows the cluster list to the clusters that
   * contain one. The figures on a card still describe the whole cluster — a
   * cluster is a decision about a topic, and a half-counted one would be
   * misleading — and the footer says which reading is which.
   */
  keywordIds: ReadonlySet<string>;
  projects: readonly { readonly id: string; readonly name: string }[];
  projectFilter: string;
  onProjectChange: (projectId: string) => void;
}) {
  const [status, setStatus] = useState<ClusterStatus | "all">("all");
  const [sort, setSort] = useState<ClusterSort>("opportunity");

  const scoped = useMemo(
    () =>
      clusters.filter(
        (cluster) =>
          (projectFilter === "all" || cluster.projectId === projectFilter) &&
          cluster.keywordIds.some((id) => keywordIds.has(id)),
      ),
    [clusters, projectFilter, keywordIds],
  );

  const counts = useMemo(() => {
    const tally: Record<string, number> = { all: scoped.length };
    for (const cluster of scoped) {
      tally[cluster.status] = (tally[cluster.status] ?? 0) + 1;
    }
    return tally;
  }, [scoped]);

  const visible = useMemo(() => {
    const filtered =
      status === "all"
        ? scoped
        : scoped.filter((cluster) => cluster.status === status);

    return [...filtered].sort((a, b) => {
      switch (sort) {
        case "volume":
          return b.totalVolume - a.totalVolume;
        case "gaps":
          return b.contentGaps - a.contentGaps;
        case "coverage":
          return a.coverage - b.coverage;
        case "name":
          return a.name.localeCompare(b.name);
        default:
          return b.opportunityScore - a.opportunityScore;
      }
    });
  }, [scoped, status, sort]);

  const totalGaps = scoped.reduce(
    (carry, cluster) => carry + cluster.contentGaps,
    0,
  );

  return (
    <Panel>
      <div className="border-b border-border px-4 py-3.5 sm:px-5">
        <SectionHeader
          eyebrow="Clusters"
          title="Topic clusters"
          description="Keywords grouped by the page that should serve them, with what each cluster is still missing."
          actions={
            <span className="text-[11.5px] text-fg-subtle">
              {scoped.length} clusters · {totalGaps} keywords with no page
            </span>
          }
        />
      </div>

      <Toolbar label="Filter and sort clusters" className="gap-x-3">
        <Segmented
          label="Filter clusters by coverage status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "all" as const, label: "All", count: counts.all },
            ...CLUSTER_STATUS_ORDER.filter(
              (entry) => (counts[entry] ?? 0) > 0,
            ).map((entry) => ({
              value: entry,
              label: CLUSTER_STATUS_META[entry].label,
              count: counts[entry],
              title: CLUSTER_STATUS_META[entry].description,
            })),
          ]}
        />

        <ToolbarSpacer />

        <ToolbarGroup>
          <label className="flex items-center gap-2 text-[11.5px] text-fg-subtle">
            Project
            <span className="block w-44">
              <Select
                size="sm"
                value={projectFilter}
                onChange={(event) => onProjectChange(event.target.value)}
                options={[
                  { value: "all", label: "Every project" },
                  ...projects.map((project) => ({
                    value: project.id,
                    label: project.name,
                  })),
                ]}
              />
            </span>
          </label>

          <label className="flex items-center gap-2 text-[11.5px] text-fg-subtle">
            Sort
            <span className="block w-40">
              <Select
                size="sm"
                value={sort}
                onChange={(event) =>
                  setSort(event.target.value as ClusterSort)
                }
                options={SORTS.map((option) => ({
                  value: option.value,
                  label: option.label,
                }))}
              />
            </span>
          </label>
        </ToolbarGroup>
      </Toolbar>

      {visible.length === 0 ? (
        <EmptyState
          icon="layers"
          title="No clusters match these filters"
          description="No cluster contains a keyword in the current selection, or none sits in this coverage state."
          action={
            status !== "all" ? (
              <Button icon="close" onClick={() => setStatus("all")}>
                Show every status
              </Button>
            ) : undefined
          }
        />
      ) : (
        <PanelBody>
          <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {visible.map((cluster) => (
              <li key={cluster.id} className="min-w-0">
                <ClusterCard cluster={cluster} />
              </li>
            ))}
          </ul>
        </PanelBody>
      )}

      <PanelFooter>
        <span>
          Coverage is the share of a cluster&apos;s keywords with a page
          targeting them; ranking coverage is the share ranking in the top 20.
          Card figures describe the whole cluster, not just the filtered
          keywords in it.
        </span>
        <span>
          {visible.length} of {scoped.length} clusters
        </span>
      </PanelFooter>
    </Panel>
  );
}

function ClusterCard({ cluster }: { cluster: KeywordCluster }) {
  const meta = CLUSTER_STATUS_META[cluster.status];

  return (
    <article className="flex h-full flex-col rounded-panel border border-border bg-surface-raised p-3.5 transition-colors hover:border-border-strong">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10.5px] font-medium tracking-[0.04em] text-fg-subtle uppercase">
            {cluster.parentTopic}
          </p>
          <h4 className="mt-0.5 text-[13.5px] leading-tight font-semibold text-fg">
            <Link
              href={`/keywords/clusters/${cluster.id}`}
              className="transition-colors hover:text-accent"
            >
              {cluster.name}
            </Link>
          </h4>
          <p className="mt-1 truncate text-[11.5px] text-fg-subtle">
            {cluster.projectName}
          </p>
        </div>

        <Badge tone={meta.tone} dot>
          {meta.label}
        </Badge>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[11.5px]">
        <Stat label="Keywords" value={String(cluster.keywordCount)} />
        <Stat label="Volume" value={`${formatCompact(cluster.totalVolume)} / mo`} />
        <Stat label="Avg. difficulty" value={String(cluster.averageDifficulty)} />
        <Stat
          label="Opportunity"
          value={String(cluster.opportunityScore)}
          emphasis
        />
      </dl>

      <div className="mt-3 space-y-2">
        <CoverageBar
          label="Content coverage"
          value={cluster.coverage}
          tone={
            cluster.coverage >= 90
              ? "positive"
              : cluster.coverage >= 70
                ? "accent"
                : "warning"
          }
          caption={
            cluster.contentGaps === 0
              ? "Every keyword has a page"
              : `${cluster.contentGaps} keyword${cluster.contentGaps === 1 ? "" : "s"} with no page`
          }
        />
        <CoverageBar
          label="Ranking coverage"
          value={cluster.rankingCoverage}
          tone={
            cluster.rankingCoverage >= 60
              ? "positive"
              : cluster.rankingCoverage >= 35
                ? "accent"
                : "warning"
          }
          caption="Share ranking in the top 20"
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Badge tone={INTENT_META[cluster.primaryIntent].tone}>
          {INTENT_META[cluster.primaryIntent].label} led
        </Badge>
        {cluster.targetUrl === null && (
          <Badge tone="warning">
            <Icon name="alert" className="h-3 w-3" />
            No pillar page
          </Badge>
        )}
      </div>

      <p className="mt-3 flex-1 text-[11.5px] leading-relaxed text-fg-subtle">
        {cluster.nextAction}
      </p>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <OwnerLink agent={cluster.owner} className="text-[11.5px]" />
        <Link
          href={`/keywords/clusters/${cluster.id}`}
          className={buttonClasses("secondary", "sm")}
        >
          Open cluster
          <Icon name="arrow-right" className="h-4 w-4" />
        </Link>
      </div>
    </article>
  );
}

function Stat({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-fg-subtle">{label}</dt>
      <dd
        className={cn(
          "tabular mt-0.5 font-semibold",
          emphasis ? "text-[14px] text-accent" : "text-[13px] text-fg",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function CoverageBar({
  label,
  value,
  tone,
  caption,
}: {
  label: string;
  value: number;
  tone: "positive" | "accent" | "warning";
  caption: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-fg-subtle">{label}</span>
        <span className="tabular text-fg-muted">{value}%</span>
      </div>
      <Meter
        className="mt-1"
        size="sm"
        value={value}
        tone={tone}
        label={`${label}: ${value}%`}
      />
      <p className="mt-1 text-[10.5px] text-fg-subtle">{caption}</p>
    </div>
  );
}
