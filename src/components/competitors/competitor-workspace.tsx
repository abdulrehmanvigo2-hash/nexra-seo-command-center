"use client";

import Link from "next/link";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Icon, type IconName } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { MetricTileGrid } from "@/components/ui/metric-tile";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { SectionHeader } from "@/components/ui/section-header";
import { StackedMeter } from "@/components/ui/meter";
import { TrendIndicator } from "@/components/ui/trend-indicator";
import { cn } from "@/lib/cn";
import { formatCompact, formatFullDate, formatPercent } from "@/lib/format";
import { INTENT_META } from "@/lib/mock/keywords";
import {
  MODELLED_SOURCE_NOTE,
  getCompetitorDetail,
} from "@/lib/mock/competitors";
import { BattlesView } from "@/components/competitors/battles-view";
import { ClustersView } from "@/components/competitors/clusters-view";
import {
  CompetitorLink,
  CompetitorTypeBadge,
  DomainText,
  OwnerLink,
  ProvenanceTag,
  ScoreBreakdownList,
  ScoreReading,
  ThreatBadge,
} from "@/components/competitors/competitor-chrome";
import { GapsView, type GapState } from "@/components/competitors/gaps-view";
import {
  OpportunitiesView,
  type OpportunityState,
} from "@/components/competitors/opportunities-view";
import { OverlapTable } from "@/components/competitors/overlap-table";
import { PagesView } from "@/components/competitors/pages-view";
import { Pagination } from "@/components/keywords/pagination";
import {
  OVERLAP_SORT_OPTIONS,
  PAGE_SORT_OPTIONS,
  compareOverlap,
  comparePages,
  type OverlapSort,
  type PageSort,
} from "@/components/competitors/sorting";
import type {
  BattleState,
  CompetitorGapKind,
  DominanceState,
  OpportunityKind,
} from "@/types/competitor";

/**
 * One competitor, in depth.
 *
 * Answers a narrower question than the workspace above it: what exactly is
 * this rival doing that matters to this project? Everything here is already
 * scoped to the rival, so there is no project filter and no competitor filter
 * — the scope is the page.
 *
 * The tabs reuse the same views the main workspace uses, with the competitor
 * column dropped where it would repeat the page heading. That reuse is
 * deliberate: a gap read here and the same gap read in the module-level list
 * are the same component over the same record, so they cannot disagree.
 */

const TABS = [
  { id: "overview", label: "Overview", icon: "command-center" },
  { id: "keywords", label: "Keywords", icon: "keywords" },
  { id: "pages", label: "Pages", icon: "content" },
  { id: "clusters", label: "Clusters", icon: "layers" },
  { id: "gaps", label: "Gaps", icon: "pages" },
  { id: "battles", label: "Battles", icon: "target" },
  { id: "opportunities", label: "Opportunities", icon: "bolt" },
] as const satisfies readonly {
  id: string;
  label: string;
  icon: IconName;
}[];

type TabId = (typeof TABS)[number]["id"];

export function CompetitorWorkspace({
  competitorId,
}: {
  competitorId: string;
}) {
  const detail = useMemo(
    () => getCompetitorDetail(competitorId),
    [competitorId],
  );

  const [tab, setTab] = useState<TabId>("overview");
  const [overlapSort, setOverlapSort] = useState<{
    key: OverlapSort;
    desc: boolean;
  }>({ key: "opportunity", desc: true });
  const [pageSort, setPageSort] = useState<{ key: PageSort; desc: boolean }>({
    key: "threat",
    desc: true,
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [battleFilter, setBattleFilter] = useState<BattleState | "all">("all");
  const [gapKind, setGapKind] = useState<CompetitorGapKind | "all">("all");
  const [dominance, setDominance] = useState<DominanceState | "all">("all");
  const [opportunityKind, setOpportunityKind] = useState<
    OpportunityKind | "all"
  >("all");
  const [gapStates, setGapStates] = useState<Record<string, GapState>>({});
  const [opportunityStates, setOpportunityStates] = useState<
    Record<string, OpportunityState>
  >({});

  const tablistRef = useRef<HTMLDivElement>(null);

  const sortedOverlap = useMemo(
    () =>
      detail === null
        ? []
        : [...detail.overlap].sort((a, b) => compareOverlap(a, b, overlapSort)),
    [detail, overlapSort],
  );

  const sortedPages = useMemo(
    () =>
      detail === null
        ? []
        : [...detail.pages].sort((a, b) => comparePages(a, b, pageSort)),
    [detail, pageSort],
  );

  const contested = useMemo(
    () => sortedOverlap.filter((row) => row.theirPosition !== null),
    [sortedOverlap],
  );

  if (detail === null) {
    return (
      <Panel>
        <EmptyState
          icon="competitors"
          title="That competitor is not tracked"
          description="The link points at a competitor that does not exist in the tracked set."
          action={
            <Link href="/competitors" className={buttonClasses("primary", "md")}>
              <Icon name="arrow-left" className="h-4 w-4" />
              Back to Competitor Intelligence
            </Link>
          }
        />
      </Panel>
    );
  }

  const { record } = detail;

  const changeTab = (next: TabId) => {
    setTab(next);
    setPage(1);
  };

  const changeOverlapSort = (key: OverlapSort) => {
    setOverlapSort((current) =>
      current.key === key
        ? { key, desc: !current.desc }
        : {
            key,
            desc:
              OVERLAP_SORT_OPTIONS.find((option) => option.value === key)
                ?.desc ?? true,
          },
    );
    setPage(1);
  };

  const changePageSort = (key: PageSort) => {
    setPageSort((current) =>
      current.key === key
        ? { key, desc: !current.desc }
        : {
            key,
            desc:
              PAGE_SORT_OPTIONS.find((option) => option.value === key)?.desc ??
              true,
          },
    );
    setPage(1);
  };

  const handleTabKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
    if (!keys.includes(event.key)) return;

    event.preventDefault();
    const index = TABS.findIndex((entry) => entry.id === tab);
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % TABS.length
        : event.key === "ArrowLeft"
          ? (index - 1 + TABS.length) % TABS.length
          : event.key === "Home"
            ? 0
            : TABS.length - 1;

    changeTab(TABS[next].id);
    tablistRef.current
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [next]?.focus();
  };

  const overlapPageCount = Math.max(
    1,
    Math.ceil(sortedOverlap.length / pageSize),
  );
  const overlapPage = Math.min(page, overlapPageCount);
  const overlapRows = sortedOverlap.slice(
    (overlapPage - 1) * pageSize,
    overlapPage * pageSize,
  );

  const footprint = record.rankingFootprint;
  const footprintTotal =
    footprint.topThree +
    footprint.topTen +
    footprint.topTwenty +
    footprint.beyond;

  const tabCounts: Partial<Record<TabId, number>> = {
    keywords: detail.overlap.length,
    pages: detail.pages.length,
    clusters: detail.clusters.length,
    gaps: detail.gaps.length,
    battles: contested.length,
    opportunities: detail.opportunities.length,
  };

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb">
        <Link
          href={`/competitors?project=${record.projectId}`}
          className="inline-flex items-center gap-1.5 text-[12px] text-fg-subtle transition-colors hover:text-fg-muted"
        >
          <Icon name="arrow-left" className="h-3.5 w-3.5" />
          Competitor Intelligence
        </Link>
      </nav>

      <SectionHeader
        size="page"
        eyebrow={`${record.projectName} · ${record.market}`}
        title={record.name}
        description={record.headline}
        actions={
          <>
            <ThreatBadge level={record.threatLevel} score={record.threat.score} />
            <CompetitorTypeBadge type={record.type} />
            <Link
              href={`/projects/${record.projectId}`}
              className={buttonClasses("secondary", "sm")}
            >
              <Icon name="projects" className="h-4 w-4" />
              Open project
            </Link>
          </>
        }
      />

      <Panel>
        <PanelBody className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Domain">
            <DomainText domain={record.domain} className="text-[12.5px]" />
          </Fact>
          <Fact label="Competing against">
            <span className="font-mono text-[11.5px] text-fg-subtle">
              {record.ourDomain}
            </span>
          </Fact>
          <Fact label="Category">
            <span className="text-[12.5px] text-fg-muted">
              {record.category}
            </span>
          </Fact>
          <Fact label="Owner">
            <OwnerLink agent={record.owner} className="text-[12.5px]" />
          </Fact>
        </PanelBody>
      </Panel>

      <MetricTileGrid metrics={detail.metrics} />

      <div className="relative -mx-1 overflow-x-auto px-1">
        <div
          ref={tablistRef}
          role="tablist"
          aria-label={`${record.name} sections`}
          onKeyDown={handleTabKeys}
          className="inline-flex min-w-full items-center gap-1 border-b border-border"
        >
          {TABS.map((entry) => {
            const isSelected = entry.id === tab;
            const count = tabCounts[entry.id];

            return (
              <button
                key={entry.id}
                type="button"
                role="tab"
                id={`competitor-tab-${entry.id}`}
                aria-selected={isSelected}
                aria-controls={`competitor-panel-${entry.id}`}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => changeTab(entry.id)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-[12.5px] font-medium whitespace-nowrap transition-colors",
                  isSelected
                    ? "border-accent text-fg"
                    : "border-transparent text-fg-subtle hover:text-fg-muted",
                )}
              >
                <Icon name={entry.icon} className="h-3.5 w-3.5" />
                {entry.label}
                {count !== undefined && (
                  <span className="tabular text-[11px] text-fg-subtle">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div
        role="tabpanel"
        id={`competitor-panel-${tab}`}
        aria-labelledby={`competitor-tab-${tab}`}
        tabIndex={0}
        className="space-y-4 focus-visible:outline-none"
      >
        {tab === "overview" && (
          <div className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-3">
              <Panel>
                <PanelHeader
                  eyebrow="Threat"
                  title="What they are costing us"
                  description="A weighted sum over the tracked keyword set, published with its factors."
                />
                <PanelBody className="space-y-4">
                  <ScoreReading
                    score={record.threat.score}
                    caption="Threat score"
                    label={`Threat ${record.threat.score} of 100`}
                    tone="critical"
                    detail={record.threat.summary}
                  />
                  <ScoreBreakdownList score={record.threat} />
                </PanelBody>
              </Panel>

              <Panel>
                <PanelHeader
                  eyebrow="Strength"
                  title="How strong they are"
                  description="About them rather than about us — our position is deliberately not an input."
                />
                <PanelBody className="space-y-4">
                  <ScoreReading
                    score={record.strength.score}
                    caption="Competitor strength"
                    label={`Strength ${record.strength.score} of 100`}
                    detail={record.strength.summary}
                  />
                  <ScoreBreakdownList score={record.strength} />
                </PanelBody>
              </Panel>

              <Panel>
                <PanelHeader
                  eyebrow="Opportunity"
                  title="How much is takeable"
                  description="Not the inverse of threat: a rival can be dangerous and still hold everything firmly."
                />
                <PanelBody className="space-y-4">
                  <ScoreReading
                    score={record.opportunity.score}
                    caption="Opportunity score"
                    label={`Opportunity ${record.opportunity.score} of 100`}
                    tone="positive"
                    detail={record.opportunity.summary}
                  />
                  <ScoreBreakdownList score={record.opportunity} />
                </PanelBody>
              </Panel>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <Panel>
                <PanelHeader
                  eyebrow="Footprint"
                  title="Where their rankings sit"
                  description={`${record.keywordFootprint} of this project's terms, by position band.`}
                />
                <PanelBody className="space-y-3.5">
                  {footprintTotal === 0 ? (
                    <p className="py-4 text-center text-[12.5px] text-fg-subtle">
                      They rank for nothing in this keyword set.
                    </p>
                  ) : (
                    <>
                      <StackedMeter
                        label="Their rankings by position band"
                        segments={[
                          {
                            id: "top-three",
                            value: footprint.topThree,
                            tone: "critical" as const,
                          },
                          {
                            id: "top-ten",
                            value: footprint.topTen,
                            tone: "warning" as const,
                          },
                          {
                            id: "top-twenty",
                            value: footprint.topTwenty,
                            tone: "accent" as const,
                          },
                          {
                            id: "beyond",
                            value: footprint.beyond,
                            tone: "neutral" as const,
                          },
                        ].filter((segment) => segment.value > 0)}
                      />

                      <ul className="grid gap-2 sm:grid-cols-2">
                        <Band
                          label="Top three"
                          count={footprint.topThree}
                          total={footprintTotal}
                        />
                        <Band
                          label="Four to ten"
                          count={footprint.topTen}
                          total={footprintTotal}
                        />
                        <Band
                          label="Eleven to twenty"
                          count={footprint.topTwenty}
                          total={footprintTotal}
                        />
                        <Band
                          label="Beyond twenty"
                          count={footprint.beyond}
                          total={footprintTotal}
                        />
                      </ul>
                    </>
                  )}

                  <dl className="grid gap-x-5 gap-y-2.5 border-t border-border pt-3.5 sm:grid-cols-2">
                    <Fact label="Shared terms">
                      <span className="tabular text-[12.5px] text-fg-muted">
                        {record.sharedKeywords}
                      </span>
                    </Fact>
                    <Fact label="They rank, we do not">
                      <span className="tabular text-[12.5px] text-fg-muted">
                        {record.competitorOnly}
                      </span>
                    </Fact>
                    <Fact label="We rank, they do not">
                      <span className="tabular text-[12.5px] text-fg-muted">
                        {record.ourOnly}
                      </span>
                    </Fact>
                    <Fact label="Close contests">
                      <span className="tabular text-[12.5px] text-fg-muted">
                        {record.closeContests}
                      </span>
                    </Fact>
                    <Fact label="Their visibility">
                      <span className="tabular text-[12.5px] text-fg-muted">
                        {formatPercent(record.visibility)}
                      </span>
                    </Fact>
                    <Fact label="Ours on the same set">
                      <span className="tabular text-[12.5px] text-fg-muted">
                        {formatPercent(record.ourVisibility)}
                      </span>
                    </Fact>
                    <Fact label="Momentum">
                      <TrendIndicator value={record.momentum.value} invert />
                    </Fact>
                    <Fact label="Domain authority">
                      <span className="inline-flex items-center gap-2">
                        <span className="tabular text-[12.5px] text-fg-muted">
                          {record.authority}
                        </span>
                        <ProvenanceTag provenance="seeded" />
                      </span>
                    </Fact>
                  </dl>
                </PanelBody>
                <PanelFooter>
                  <span>{MODELLED_SOURCE_NOTE}</span>
                </PanelFooter>
              </Panel>

              <div className="space-y-4">
                <Panel>
                  <PanelHeader
                    eyebrow="Where they are beatable"
                    title="Weaknesses"
                    description="Read from their own footprint, not asserted."
                  />
                  <PanelBody>
                    <ul className="space-y-2">
                      {record.weaknesses.map((note) => (
                        <li
                          key={note}
                          className="flex items-start gap-2 rounded-md border border-border bg-surface-raised px-3 py-2 text-[12px] leading-snug text-fg-muted"
                        >
                          <Icon
                            name="check"
                            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-positive"
                          />
                          {note}
                        </li>
                      ))}
                    </ul>
                  </PanelBody>
                </Panel>

                <Panel>
                  <PanelHeader
                    eyebrow="Coverage"
                    title="What they answer"
                    description="The intents they rank for, strongest first."
                  />
                  <PanelBody className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {record.topIntents.length === 0 ? (
                        <p className="text-[12.5px] text-fg-subtle">
                          No intent coverage in this set.
                        </p>
                      ) : (
                        record.topIntents.map((intent) => (
                          <Badge
                            key={intent}
                            tone={INTENT_META[intent].tone}
                            title={INTENT_META[intent].description}
                          >
                            {INTENT_META[intent].label}
                          </Badge>
                        ))
                      )}
                    </div>

                    {record.dominatedClusterIds.length > 0 && (
                      <div className="border-t border-border pt-3">
                        <p className="text-[11px] font-medium tracking-[0.04em] text-fg-subtle uppercase">
                          Topics they lead outright
                        </p>
                        <ul className="mt-2 space-y-1.5">
                          {detail.clusters
                            .filter((entry) =>
                              record.dominatedClusterIds.includes(
                                entry.clusterId,
                              ),
                            )
                            .map((entry) => (
                              <li key={entry.clusterId}>
                                <Link
                                  href={`/keywords/clusters/${entry.clusterId}`}
                                  className="inline-flex items-center gap-1.5 text-[12px] text-fg-muted transition-colors hover:text-accent"
                                >
                                  <Icon
                                    name="layers"
                                    className="h-3.5 w-3.5 shrink-0 text-fg-subtle"
                                  />
                                  {entry.clusterName}
                                  <span className="tabular text-[11px] text-fg-subtle">
                                    {formatCompact(entry.totalVolume)} / mo
                                  </span>
                                </Link>
                              </li>
                            ))}
                        </ul>
                      </div>
                    )}
                  </PanelBody>
                </Panel>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <Panel>
                <PanelHeader
                  eyebrow="Elsewhere"
                  title="Where else this domain competes"
                  description="The same rival in our other clients' markets. Each is a separate record, because the fights are different."
                />
                <PanelBody>
                  {detail.alsoIn.length === 0 ? (
                    <p className="py-4 text-center text-[12.5px] text-fg-subtle">
                      This domain competes in {record.projectName} only.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {detail.alsoIn.map((entry) => (
                        <li
                          key={entry.id}
                          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-md border border-border bg-surface-raised px-3 py-2"
                        >
                          <span className="flex min-w-0 flex-col gap-0.5">
                            <CompetitorLink id={entry.id} name={entry.projectName} />
                            <span className="text-[11px] text-fg-subtle">
                              {entry.sharedKeywords} contested ·{" "}
                              {entry.theirWins} ahead
                            </span>
                          </span>
                          <ThreatBadge
                            level={entry.threatLevel}
                            score={entry.threat.score}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </PanelBody>
              </Panel>

              <Panel>
                <PanelHeader
                  eyebrow="The rest of the set"
                  title={`Other rivals in ${record.projectName}`}
                  description="Who else is competing for the same terms, by threat."
                />
                <PanelBody>
                  {detail.siblings.length === 0 ? (
                    <p className="py-4 text-center text-[12.5px] text-fg-subtle">
                      No other rivals are tracked against this project.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {detail.siblings.map((entry) => (
                        <li
                          key={entry.id}
                          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-md border border-border bg-surface-raised px-3 py-2"
                        >
                          <span className="flex min-w-0 flex-col gap-0.5">
                            <CompetitorLink id={entry.id} name={entry.name} />
                            <DomainText domain={entry.domain} />
                          </span>
                          <span className="flex shrink-0 items-center gap-2">
                            <span className="tabular text-[11px] text-fg-subtle">
                              {formatPercent(entry.visibility)}
                            </span>
                            <ThreatBadge level={entry.threatLevel} />
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </PanelBody>
              </Panel>
            </div>
          </div>
        )}

        {tab === "keywords" && (
          <Panel>
            {overlapRows.length === 0 ? (
              <EmptyState
                icon="keywords"
                title="No keyword overlap"
                description="Neither side ranks for anything in this project's keyword set."
              />
            ) : (
              <OverlapTable
                rows={overlapRows}
                sort={overlapSort}
                onSort={changeOverlapSort}
                hideCompetitor
              />
            )}
            <Pagination
              page={overlapPage}
              pageSize={pageSize}
              total={sortedOverlap.length}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
              noun="keywords"
            />
          </Panel>
        )}

        {tab === "pages" && (
          <PagesView
            pages={sortedPages}
            sort={pageSort}
            onSort={changePageSort}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        )}

        {tab === "clusters" && (
          <ClustersView
            clusters={detail.clusters}
            stateFilter={dominance}
            onStateFilter={setDominance}
          />
        )}

        {tab === "gaps" && (
          <GapsView
            gaps={detail.gaps}
            kindFilter={gapKind}
            onKindFilter={setGapKind}
            states={gapStates}
            onAct={(id, state) =>
              setGapStates((current) => ({ ...current, [id]: state }))
            }
          />
        )}

        {tab === "battles" && (
          <BattlesView
            rows={contested}
            sort={overlapSort}
            onSort={changeOverlapSort}
            battleFilter={battleFilter}
            onBattleFilter={(state) => {
              setBattleFilter(state);
              setPage(1);
            }}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        )}

        {tab === "opportunities" && (
          <OpportunitiesView
            opportunities={detail.opportunities}
            kindFilter={opportunityKind}
            onKindFilter={(kind) => {
              setOpportunityKind(kind);
              setPage(1);
            }}
            states={opportunityStates}
            onAct={(id, state) =>
              setOpportunityStates((current) => ({ ...current, [id]: state }))
            }
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        )}
      </div>

      <p className="text-[11.5px] text-fg-subtle">
        Figures as at {formatFullDate(detail.generatedAt)}.{" "}
        {MODELLED_SOURCE_NOTE}
      </p>
    </div>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10.5px] font-medium tracking-[0.04em] text-fg-subtle uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 min-w-0 truncate">{children}</dd>
    </div>
  );
}

function Band({
  label,
  count,
  total,
}: {
  label: string;
  count: number;
  total: number;
}) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-raised px-3 py-2">
      <span className="truncate text-[12px] text-fg-muted">{label}</span>
      <span className="flex shrink-0 items-baseline gap-2">
        <span className="tabular text-[13px] font-semibold text-fg">
          {count}
        </span>
        <span className="tabular text-[11px] text-fg-subtle">
          {formatPercent(total === 0 ? 0 : (count / total) * 100, 0)}
        </span>
      </span>
    </li>
  );
}
