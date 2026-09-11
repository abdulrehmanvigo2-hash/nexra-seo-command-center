"use client";

import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge, PriorityBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Meter } from "@/components/ui/meter";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { formatCompact, formatPercent } from "@/lib/format";
import {
  BattleBadge,
  CompetitorLink,
  DomainText,
  OwnerLink,
  ThreatBadge,
  TrafficValue,
} from "@/components/competitors/competitor-chrome";
import type {
  ClusterBattleground,
  CompetitorHighlight,
  CompetitorOpportunity,
  CompetitorRecord,
  OverlapRow,
  SerpThreat,
} from "@/types/competitor";

/**
 * The answer to "who are we competing with, and what do we do about it?"
 *
 * Four prioritised cards, then the three lists that follow from them: the
 * rivals costing the most, the movements that need answering, and the work
 * that would take ground back. Every card and every row leads somewhere —
 * either into a tab of this workspace or into the module that owns the
 * underlying record.
 *
 * Deliberately not a wall of totals. The tiles above already carry the counts;
 * this view exists to say what to do first.
 */
export function OverviewView({
  highlights,
  records,
  threats,
  opportunities,
  clusters,
  rows,
  onOpenTab,
  onFocusCompetitor,
}: {
  highlights: readonly CompetitorHighlight[];
  records: readonly CompetitorRecord[];
  threats: readonly SerpThreat[];
  opportunities: readonly CompetitorOpportunity[];
  clusters: readonly ClusterBattleground[];
  rows: readonly OverlapRow[];
  onOpenTab: (tab: string) => void;
  onFocusCompetitor: (competitorId: string) => void;
}) {
  if (records.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon="competitors"
          title="No competitors in this selection"
          description="Nothing matches the current filters. Widen the project or threat filter to bring the tracked set back."
        />
      </Panel>
    );
  }

  const topRivals = [...records]
    .sort((a, b) => b.threat.score - a.threat.score)
    .slice(0, 6);

  const attackable = [...rows]
    .filter(
      (row) =>
        row.battle === "easy-win" ||
        row.battle === "close-race" ||
        row.battle === "attack",
    )
    .sort((a, b) => b.opportunity - a.opportunity)
    .slice(0, 6);

  const takenTopics = [...clusters]
    .filter((entry) => entry.state === "they-lead" || entry.state === "contested")
    .sort((a, b) => b.dominanceGap - a.dominanceGap)
    .slice(0, 5);

  return (
    <div className="space-y-4">
      {highlights.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {highlights.map((card) => (
            <Panel as="article" key={card.id} className="flex flex-col p-4">
              <p className="text-[10.5px] font-semibold tracking-[0.09em] text-fg-subtle uppercase">
                {card.eyebrow}
              </p>
              <p className="mt-2 text-[15px] leading-tight font-semibold tracking-tight text-fg">
                {card.title}
              </p>
              <p className="mt-2 flex-1 text-[12px] leading-relaxed text-fg-muted">
                {card.detail}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <PriorityBadge priority={card.severity} />
                <span className="tabular text-[11.5px] text-fg-subtle">
                  {card.value}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                <Button size="sm" onClick={() => onOpenTab(card.tab)}>
                  Open
                  <Icon name="arrow-right" className="h-3.5 w-3.5" />
                </Button>
                <OwnerLink agent={card.owner} className="text-[11.5px]" />
              </div>
            </Panel>
          ))}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader
            eyebrow="Who"
            title="The rivals costing the most"
            description="Ranked by threat — how much of the contested set each one is taking, and whether the gap is widening."
            actions={
              <Button size="sm" onClick={() => onOpenTab("competitors")}>
                All competitors
              </Button>
            }
          />
          <PanelBody className="space-y-2.5">
            {topRivals.map((record) => (
              <div
                key={record.id}
                className="rounded-md border border-border bg-surface-raised px-3 py-2.5"
              >
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <CompetitorLink id={record.id} name={record.name} />
                    <DomainText domain={record.domain} />
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <ThreatBadge
                      level={record.threatLevel}
                      score={record.threat.score}
                    />
                  </span>
                </div>

                <p className="mt-2 text-[11.5px] leading-snug text-fg-muted">
                  {record.headline}
                </p>

                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-fg-subtle">
                  <span title="Their share of what this keyword set can produce">
                    Visibility {formatPercent(record.visibility)}
                  </span>
                  <span title="Terms both sides rank for">
                    {record.sharedKeywords} contested
                  </span>
                  <span title="Contested terms they lead">
                    {record.theirWins} ahead
                  </span>
                  <button
                    type="button"
                    onClick={() => onFocusCompetitor(record.id)}
                    className="ml-auto inline-flex items-center gap-1 text-accent transition-colors hover:text-accent-hover"
                  >
                    Filter to this rival
                    <Icon name="filter" className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </PanelBody>
          <PanelFooter>
            <span>
              Threat is a weighted sum over the tracked keyword set, published
              with its factors on each rival&rsquo;s own page.
            </span>
          </PanelFooter>
        </Panel>

        <Panel>
          <PanelHeader
            eyebrow="What is happening"
            title="Movements that need answering"
            description="Places a rival has taken ground, or is about to, with the evidence behind each one."
            actions={
              <Button size="sm" onClick={() => onOpenTab("threats")}>
                All threats
              </Button>
            }
          />
          <PanelBody className="space-y-2.5">
            {threats.length === 0 ? (
              <EmptyState
                size="sm"
                icon="shield"
                title="No threats in this selection"
                description="No rival is taking ground on the terms currently filtered in."
              />
            ) : (
              threats.slice(0, 6).map((threat) => (
                <div
                  key={threat.id}
                  className="rounded-md border border-border bg-surface-raised px-3 py-2.5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
                    <p className="min-w-0 flex-1 text-[12.5px] font-medium text-fg">
                      {threat.headline}
                    </p>
                    <PriorityBadge priority={threat.severity} />
                  </div>
                  <p className="mt-1.5 text-[11.5px] leading-snug text-fg-muted">
                    {threat.rationale}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-fg-subtle">
                    {threat.valueAtRisk > 0 && (
                      <span title="Estimated monthly sessions they earn from it">
                        {formatCompact(threat.valueAtRisk)} sessions / mo
                      </span>
                    )}
                    <OwnerLink agent={threat.owner} className="text-[11px]" />
                  </div>
                </div>
              ))
            )}
          </PanelBody>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader
            eyebrow="Where to push"
            title="Rankings within reach"
            description="Contested terms where the position a rival holds is not firmly held."
            actions={
              <Button size="sm" onClick={() => onOpenTab("battles")}>
                All battles
              </Button>
            }
          />
          <PanelBody className="space-y-2">
            {attackable.length === 0 ? (
              <EmptyState
                size="sm"
                icon="target"
                title="Nothing obviously attackable"
                description="No contested term in this selection is held loosely enough to take cheaply."
              />
            ) : (
              attackable.map((row) => (
                <div
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-md border border-border bg-surface-raised px-3 py-2"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <Link
                      href={`/keywords/${row.keywordId}`}
                      className="truncate text-[12.5px] font-medium text-fg transition-colors hover:text-accent"
                    >
                      {row.keyword}
                    </Link>
                    <span className="text-[11px] text-fg-subtle">
                      {row.competitorName} at {row.theirPosition} · we sit at{" "}
                      {row.ourPosition ?? "—"}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2.5">
                    <BattleBadge battle={row.battle} short />
                    <span className="tabular text-[11.5px] text-fg-subtle">
                      {formatCompact(row.volume)} / mo
                    </span>
                    <span className="w-10 shrink-0">
                      <Meter
                        size="sm"
                        value={row.opportunity}
                        tone="positive"
                        label={`Opportunity ${row.opportunity} of 100`}
                      />
                    </span>
                  </span>
                </div>
              ))
            )}
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader
            eyebrow="Topics"
            title="Ground being contested"
            description="Clusters where a rival is level with us or ahead, worst gap first."
            actions={
              <Button size="sm" onClick={() => onOpenTab("clusters")}>
                All clusters
              </Button>
            }
          />
          <PanelBody className="space-y-2">
            {takenTopics.length === 0 ? (
              <EmptyState
                size="sm"
                icon="layers"
                title="No contested topics here"
                description="We lead every cluster in this selection."
              />
            ) : (
              takenTopics.map((entry) => (
                <div
                  key={entry.clusterId}
                  className="rounded-md border border-border bg-surface-raised px-3 py-2.5"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <Link
                      href={`/keywords/clusters/${entry.clusterId}`}
                      className="min-w-0 truncate text-[12.5px] font-medium text-fg transition-colors hover:text-accent"
                    >
                      {entry.clusterName}
                    </Link>
                    <Badge
                      tone={entry.state === "they-lead" ? "critical" : "warning"}
                    >
                      {entry.dominant?.name ?? "Contested"}
                    </Badge>
                  </div>
                  <p className="mt-1.5 text-[11.5px] leading-snug text-fg-muted">
                    {entry.action}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-fg-subtle">
                    <span>Our strength {entry.ourStrength}</span>
                    <span>Theirs {entry.dominant?.strength ?? 0}</span>
                    <span>{formatCompact(entry.totalVolume)} searches / mo</span>
                  </div>
                </div>
              ))
            )}
          </PanelBody>
        </Panel>
      </div>

      <Panel>
        <PanelHeader
          eyebrow="What to do next"
          title="The work this analysis produces"
          description="The highest-value pieces of work the findings above turn into, each with the agent who would own it."
          actions={
            <Button
              size="sm"
              variant="primary"
              onClick={() => onOpenTab("opportunities")}
            >
              Full queue
            </Button>
          }
        />
        <PanelBody className="grid gap-2.5 lg:grid-cols-2">
          {opportunities.length === 0 ? (
            <div className="lg:col-span-2">
              <EmptyState
                size="sm"
                icon="target"
                title="No opportunities in this selection"
                description="Nothing in the current filters produces a piece of work."
              />
            </div>
          ) : (
            opportunities.slice(0, 6).map((entry) => (
              <div
                key={entry.id}
                className="rounded-md border border-border bg-surface-raised px-3 py-2.5"
              >
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
                  <p className="min-w-0 flex-1 text-[12.5px] leading-snug font-medium text-fg">
                    {entry.action}
                  </p>
                  <PriorityBadge priority={entry.priority} />
                </div>
                <p className="mt-1.5 text-[11.5px] leading-snug text-fg-subtle">
                  {entry.rationale}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-fg-subtle">
                  <span>{entry.competitorName}</span>
                  <TrafficValue sessions={entry.value} className="text-[11px]" />
                  <OwnerLink agent={entry.owner} className="text-[11px]" />
                </div>
              </div>
            ))
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}
