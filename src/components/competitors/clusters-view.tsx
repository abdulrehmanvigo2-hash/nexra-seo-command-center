"use client";

import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Meter } from "@/components/ui/meter";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { formatCompact, formatPercent } from "@/lib/format";
import { DOMINANCE_META, DOMINANCE_ORDER } from "@/lib/mock/competitors";
import {
  CompetitorLink,
  DominanceBadge,
  OwnerLink,
  PositionValue,
} from "@/components/competitors/competitor-chrome";
import type { ClusterBattleground, DominanceState } from "@/types/competitor";

/**
 * Topic clusters as contested ground.
 *
 * Our side of every row is read from the records that own it — the cluster's
 * keyword count and coverage from Keyword Intelligence, the page count and the
 * pillar from the Content Studio — so this table and the cluster workspace can
 * never disagree about what we have built.
 *
 * Both sides are scored with the same function, which is what makes the two
 * numbers on a row comparable. A cluster with no rival of any weight is
 * reported as uncontested rather than as a win, because an empty topic is an
 * opening, not an achievement.
 */
export function ClustersView({
  clusters,
  stateFilter,
  onStateFilter,
}: {
  clusters: readonly ClusterBattleground[];
  stateFilter: DominanceState | "all";
  onStateFilter: (state: DominanceState | "all") => void;
}) {
  const counts = new Map<DominanceState, number>();
  for (const state of DOMINANCE_ORDER) {
    counts.set(state, clusters.filter((entry) => entry.state === state).length);
  }

  const available = DOMINANCE_ORDER.filter(
    (state) => (counts.get(state) ?? 0) > 0,
  );

  const shown =
    stateFilter === "all"
      ? clusters
      : clusters.filter((entry) => entry.state === stateFilter);

  if (clusters.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon="layers"
          title="No clusters in this selection"
          description="Widen the project or competitor filter to bring the topic map back."
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          eyebrow="Topics"
          title="Who holds which cluster"
          description="Our hold on each topic against the strongest rival in it, measured the same way for both sides."
        />
        <PanelBody>
          <div
            role="group"
            aria-label="Filter clusters by who holds them"
            className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
          >
            {available.map((state) => {
              const active = stateFilter === state;
              const meta = DOMINANCE_META[state];

              return (
                <button
                  key={state}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onStateFilter(active ? "all" : state)}
                  title={meta.description}
                  className={cn(
                    "rounded-md border px-3 py-2.5 text-left transition-colors",
                    active
                      ? "border-accent/50 bg-accent-soft"
                      : "border-border bg-surface-raised hover:border-border-strong hover:bg-surface-hover",
                  )}
                >
                  <span className="block truncate text-[11.5px] font-medium text-fg-muted">
                    {meta.label}
                  </span>
                  <span className="tabular mt-1.5 block text-[19px] leading-none font-semibold text-fg">
                    {counts.get(state)}
                  </span>
                </button>
              );
            })}
          </div>
        </PanelBody>
      </Panel>

      <Panel>
        {shown.length === 0 ? (
          <EmptyState
            icon="search"
            title="No clusters in that state"
            description="Pick another state, or clear the filter to see every cluster."
          />
        ) : (
          <Table caption="Topic clusters with our strength, the leading rival, and the recommended action">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Cluster</TableHeaderCell>
                <TableHeaderCell>Holder</TableHeaderCell>
                <TableHeaderCell align="right">Terms</TableHeaderCell>
                <TableHeaderCell align="right">Volume</TableHeaderCell>
                <TableHeaderCell align="right">We rank</TableHeaderCell>
                <TableHeaderCell align="right">Coverage</TableHeaderCell>
                <TableHeaderCell align="right">Our pages</TableHeaderCell>
                <TableHeaderCell>Pillar</TableHeaderCell>
                <TableHeaderCell align="right">Our avg.</TableHeaderCell>
                <TableHeaderCell align="right">Our strength</TableHeaderCell>
                <TableHeaderCell>Leading rival</TableHeaderCell>
                <TableHeaderCell align="right">Their strength</TableHeaderCell>
                <TableHeaderCell align="right">Shared</TableHeaderCell>
              </TableRow>
            </TableHead>

            <TableBody>
              {shown.map((entry) => (
                <TableRow key={entry.clusterId}>
                  <TableCell header className="min-w-[200px] max-w-[240px]">
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <Link
                        href={`/keywords/clusters/${entry.clusterId}`}
                        className="truncate transition-colors hover:text-accent"
                        title={entry.clusterName}
                      >
                        {entry.clusterName}
                      </Link>
                      <Link
                        href={`/projects/${entry.projectId}`}
                        className="truncate text-[11px] font-normal text-fg-subtle transition-colors hover:text-accent"
                      >
                        {entry.projectName}
                      </Link>
                    </span>
                  </TableCell>

                  <TableCell>
                    <DominanceBadge state={entry.state} />
                  </TableCell>

                  <TableCell numeric>{entry.keywordCount}</TableCell>

                  <TableCell numeric>
                    <span
                      className="tabular text-fg-muted"
                      title={`${entry.totalVolume.toLocaleString("en-US")} searches a month`}
                    >
                      {formatCompact(entry.totalVolume)}
                    </span>
                  </TableCell>

                  <TableCell numeric>
                    <span
                      className="tabular text-fg-muted"
                      title={`${entry.ourTopTen} of them on the first page`}
                    >
                      {entry.ourKeywords}
                    </span>
                  </TableCell>

                  <TableCell numeric>
                    <span
                      className="tabular text-fg-muted"
                      title="Cluster coverage from the Keyword Intelligence module"
                    >
                      {formatPercent(entry.coverage, 0)}
                    </span>
                  </TableCell>

                  <TableCell numeric>{entry.ourPages}</TableCell>

                  <TableCell>
                    {entry.hasPillar ? (
                      <Badge tone="positive" title="A pillar page is published">
                        Published
                      </Badge>
                    ) : (
                      <Badge
                        tone="critical"
                        title="No pillar page — supporting pages have nothing to point at"
                      >
                        Missing
                      </Badge>
                    )}
                  </TableCell>

                  <TableCell numeric>
                    <PositionValue
                      position={
                        entry.ourAveragePosition === null
                          ? null
                          : Math.round(entry.ourAveragePosition)
                      }
                    />
                  </TableCell>

                  <TableCell numeric>
                    <span className="inline-flex items-center gap-2">
                      <span className="tabular w-6 text-right font-semibold text-fg">
                        {entry.ourStrength}
                      </span>
                      <span className="hidden w-12 sm:block">
                        <Meter
                          size="sm"
                          value={entry.ourStrength}
                          tone="positive"
                          label={`Our strength ${entry.ourStrength} of 100`}
                        />
                      </span>
                    </span>
                  </TableCell>

                  <TableCell className="max-w-[150px]">
                    {entry.dominant === null ? (
                      <span className="text-[11.5px] text-fg-subtle">
                        No rival of weight
                      </span>
                    ) : (
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <CompetitorLink
                          id={entry.dominant.competitorId}
                          name={entry.dominant.name}
                          className="truncate font-normal text-fg-muted"
                        />
                        <span className="text-[11px] text-fg-subtle">
                          {entry.dominant.keywords} terms ·{" "}
                          {entry.dominant.pages}{" "}
                          {entry.dominant.pages === 1 ? "page" : "pages"}
                        </span>
                      </span>
                    )}
                  </TableCell>

                  <TableCell numeric>
                    {entry.dominant === null ? (
                      <span className="text-fg-subtle">—</span>
                    ) : (
                      <span className="inline-flex items-center gap-2">
                        <span className="tabular w-6 text-right font-semibold text-fg">
                          {entry.dominant.strength}
                        </span>
                        <span className="hidden w-12 sm:block">
                          <Meter
                            size="sm"
                            value={entry.dominant.strength}
                            tone={
                              entry.dominanceGap > 0 ? "critical" : "warning"
                            }
                            label={`Their strength ${entry.dominant.strength} of 100`}
                          />
                        </span>
                      </span>
                    )}
                  </TableCell>

                  <TableCell numeric>{entry.sharedKeywords}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <PanelFooter>
          <span>
            Coverage and the pillar come from the cluster and content records —
            this view reads them, it does not recompute them.
          </span>
          <span>{shown.length} clusters</span>
        </PanelFooter>
      </Panel>

      <Panel>
        <PanelHeader
          eyebrow="Next moves"
          title="What each contested topic needs"
          description="The clusters where a rival is level or ahead, with the action the gap calls for."
        />
        <PanelBody className="space-y-2.5">
          {shown.filter(
            (entry) => entry.state === "they-lead" || entry.state === "contested",
          ).length === 0 ? (
            <EmptyState
              size="sm"
              icon="shield"
              title="Nothing contested here"
              description="No rival is level with us on the clusters in this selection."
            />
          ) : (
            shown
              .filter(
                (entry) =>
                  entry.state === "they-lead" || entry.state === "contested",
              )
              .slice(0, 8)
              .map((entry) => (
                <div
                  key={`action-${entry.clusterId}`}
                  className="rounded-md border border-border bg-surface-raised px-3 py-2.5"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <Link
                      href={`/keywords/clusters/${entry.clusterId}`}
                      className="min-w-0 truncate text-[12.5px] font-medium text-fg transition-colors hover:text-accent"
                    >
                      {entry.clusterName}
                    </Link>
                    <span className="flex shrink-0 items-center gap-2">
                      <DominanceBadge state={entry.state} />
                      <span className="tabular text-[11px] text-fg-subtle">
                        gap {entry.dominanceGap > 0 ? "+" : ""}
                        {entry.dominanceGap}
                      </span>
                    </span>
                  </div>
                  <p className="mt-1.5 text-[11.5px] leading-snug text-fg-muted">
                    {entry.action}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-fg-subtle">
                    <OwnerLink agent={entry.owner} className="text-[11px]" />
                    <Link
                      href={`/content?cluster=${entry.clusterId}`}
                      className="ml-auto inline-flex items-center gap-1 text-accent transition-colors hover:text-accent-hover"
                    >
                      Open the cluster in Content Studio
                      <Icon name="arrow-right" className="h-3 w-3" />
                    </Link>
                  </div>
                </div>
              ))
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}
