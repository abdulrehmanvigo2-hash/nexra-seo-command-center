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
import { SCORE_BAND_META, scoreBandOf } from "@/lib/mock/content";
import { OwnerLink } from "@/components/content/content-chrome";
import type { ClusterCoverageRow } from "@/types/content";

/**
 * Content coverage of the topic clusters.
 *
 * Cards rather than rows: a cluster is judged on four things at once — how big
 * it is, how much of it has a page, how good those pages are, and what is
 * still missing — and those read better side by side than strung across a
 * table.
 *
 * The coverage figure is the Keyword Intelligence module's own, not a second
 * calculation of it. A cluster that reports 80% covered there reports 80% here,
 * because both are reading the same number.
 */

type CoverageSort = "coverage" | "gaps" | "volume" | "score" | "name";
type CoverageState = "all" | "gaps" | "no-pillar" | "in-progress" | "complete";

const SORTS: readonly { readonly value: CoverageSort; readonly label: string }[] =
  [
    { value: "coverage", label: "Least covered" },
    { value: "gaps", label: "Most gaps" },
    { value: "volume", label: "Search volume" },
    { value: "score", label: "Weakest pages" },
    { value: "name", label: "Cluster name" },
  ];

export function CoverageView({
  rows,
  projects,
  projectFilter,
  onProjectChange,
}: {
  rows: readonly ClusterCoverageRow[];
  projects: readonly { readonly id: string; readonly name: string }[];
  projectFilter: string;
  onProjectChange: (projectId: string) => void;
}) {
  const [state, setState] = useState<CoverageState>("all");
  const [sort, setSort] = useState<CoverageSort>("coverage");

  const scoped = useMemo(
    () =>
      rows.filter(
        (row) => projectFilter === "all" || row.projectId === projectFilter,
      ),
    [rows, projectFilter],
  );

  const counts = useMemo(
    () => ({
      all: scoped.length,
      gaps: scoped.filter((row) => row.gaps > 0).length,
      "no-pillar": scoped.filter((row) => !row.hasPillar).length,
      "in-progress": scoped.filter((row) => row.inProgress > 0).length,
      complete: scoped.filter((row) => row.gaps === 0 && row.hasPillar).length,
    }),
    [scoped],
  );

  const visible = useMemo(() => {
    const filtered = scoped.filter((row) => {
      switch (state) {
        case "gaps":
          return row.gaps > 0;
        case "no-pillar":
          return !row.hasPillar;
        case "in-progress":
          return row.inProgress > 0;
        case "complete":
          return row.gaps === 0 && row.hasPillar;
        default:
          return true;
      }
    });

    return [...filtered].sort((a, b) => {
      switch (sort) {
        case "gaps":
          return b.gaps - a.gaps;
        case "volume":
          return b.totalVolume - a.totalVolume;
        case "score":
          return a.averageScore - b.averageScore;
        case "name":
          return a.clusterName.localeCompare(b.clusterName);
        default:
          return a.coverage - b.coverage;
      }
    });
  }, [scoped, state, sort]);

  const totalGaps = scoped.reduce((carry, row) => carry + row.gaps, 0);

  return (
    <Panel>
      <div className="border-b border-border px-4 py-3.5 sm:px-5">
        <SectionHeader
          eyebrow="Coverage"
          title="Topic clusters"
          description="How much of each topic has a page behind it, and how good those pages are."
          actions={
            <span className="text-[11.5px] text-fg-subtle">
              {scoped.length} clusters · {totalGaps} keywords with no page
            </span>
          }
        />
      </div>

      <Toolbar label="Filter and sort clusters" className="gap-x-3">
        <Segmented
          label="Filter clusters by coverage state"
          value={state}
          onChange={setState}
          options={[
            { value: "all" as const, label: "All", count: counts.all },
            {
              value: "gaps" as const,
              label: "Has gaps",
              count: counts.gaps,
              title: "Clusters with keywords that have no page behind them.",
            },
            {
              value: "no-pillar" as const,
              label: "No pillar",
              count: counts["no-pillar"],
              title: "Clusters with nothing anchoring the supporting pages.",
            },
            {
              value: "in-progress" as const,
              label: "In progress",
              count: counts["in-progress"],
              title: "Clusters with pieces moving through the pipeline.",
            },
            {
              value: "complete" as const,
              label: "Complete",
              count: counts.complete,
              title: "Every keyword has a page, and a pillar anchors them.",
            },
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
                  setSort(event.target.value as CoverageSort)
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
          description="No cluster in the current selection sits in this coverage state."
          action={
            state !== "all" ? (
              <Button icon="close" onClick={() => setState("all")}>
                Show every cluster
              </Button>
            ) : undefined
          }
        />
      ) : (
        <PanelBody>
          <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {visible.map((row) => (
              <li key={row.clusterId} className="min-w-0">
                <CoverageCard row={row} />
              </li>
            ))}
          </ul>
        </PanelBody>
      )}

      <PanelFooter>
        <span>
          Coverage is the share of a cluster&apos;s keywords with a page
          targeting them — the same figure the Keyword Intelligence module
          reports for it.
        </span>
        <span>
          {visible.length} of {scoped.length} clusters
        </span>
      </PanelFooter>
    </Panel>
  );
}

function CoverageCard({ row }: { row: ClusterCoverageRow }) {
  const band = SCORE_BAND_META[scoreBandOf(row.averageScore)];

  return (
    <article className="flex h-full flex-col rounded-panel border border-border bg-surface-raised p-3.5 transition-colors hover:border-border-strong">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10.5px] font-medium tracking-[0.04em] text-fg-subtle uppercase">
            {row.parentTopic}
          </p>
          <h4 className="mt-0.5 text-[13.5px] leading-tight font-semibold text-fg">
            <Link
              href={`/keywords/clusters/${row.clusterId}`}
              className="transition-colors hover:text-accent"
            >
              {row.clusterName}
            </Link>
          </h4>
          <p className="mt-1 truncate text-[11.5px] text-fg-subtle">
            {row.projectName}
          </p>
        </div>

        {row.hasPillar ? (
          <Badge tone="accent">Pillar live</Badge>
        ) : (
          <Badge tone="warning">
            <Icon name="alert" className="h-3 w-3" />
            No pillar
          </Badge>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[11.5px]">
        <Stat label="Pieces" value={String(row.pieces)} />
        <Stat label="Published" value={String(row.published)} />
        <Stat
          label="Volume"
          value={`${formatCompact(row.totalVolume)} / mo`}
        />
        <Stat
          label="Avg. score"
          value={row.averageScore === 0 ? "—" : String(row.averageScore)}
          emphasis
        />
      </dl>

      <div className="mt-3 space-y-2">
        <Bar
          label="Content coverage"
          value={row.coverage}
          tone={
            row.coverage >= 90
              ? "positive"
              : row.coverage >= 70
                ? "accent"
                : "warning"
          }
          caption={
            row.gaps === 0
              ? "Every keyword has a page"
              : `${row.gaps} keyword${row.gaps === 1 ? "" : "s"} with no page`
          }
        />
        <Bar
          label="Page quality"
          value={row.averageScore}
          readout={
            row.averageScore === 0 ? "not scored" : `${row.averageScore} / 100`
          }
          tone={band.meter}
          caption={`Mean content score across the ${row.published} published ${row.published === 1 ? "piece" : "pieces"}`}
        />
      </div>

      {row.inProgress > 0 && (
        <p className="mt-3 inline-flex items-center gap-1.5 text-[11.5px] text-accent">
          <Icon name="workflow" className="h-3.5 w-3.5 shrink-0" />
          {row.inProgress} {row.inProgress === 1 ? "piece" : "pieces"} in the
          pipeline
        </p>
      )}

      <p className="mt-3 flex-1 text-[11.5px] leading-relaxed text-fg-subtle">
        {row.nextAction}
      </p>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <OwnerLink agent={row.owner} className="text-[11.5px]" />
        {row.pillarId ? (
          <Link
            href={`/content/${row.pillarId}`}
            className={buttonClasses("secondary", "sm")}
          >
            Open pillar
            <Icon name="arrow-right" className="h-4 w-4" />
          </Link>
        ) : (
          <Link
            href={`/keywords/clusters/${row.clusterId}`}
            className={buttonClasses("secondary", "sm")}
          >
            Open cluster
            <Icon name="arrow-right" className="h-4 w-4" />
          </Link>
        )}
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

function Bar({
  label,
  value,
  tone,
  caption,
  /** How the figure reads. Defaults to a percentage. */
  readout,
}: {
  label: string;
  value: number;
  tone: "positive" | "accent" | "warning" | "critical" | "neutral";
  caption: string;
  readout?: string;
}) {
  const text = readout ?? `${value}%`;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-fg-subtle">{label}</span>
        <span className="tabular text-fg-muted">{text}</span>
      </div>
      <Meter
        className="mt-1"
        size="sm"
        value={value}
        tone={tone}
        label={`${label}: ${text}`}
      />
      <p className="mt-1 text-[10.5px] text-fg-subtle">{caption}</p>
    </div>
  );
}
