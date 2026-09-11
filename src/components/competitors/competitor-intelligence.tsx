"use client";

import { useSearchParams } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Icon, type IconName } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelFooter } from "@/components/ui/panel";
import { SectionHeader } from "@/components/ui/section-header";
import { cn } from "@/lib/cn";
import { formatFullDate, formatTimeUtc } from "@/lib/format";
import {
  difficultyBandOf,
  opportunityBandOf,
  volumeBandOf,
} from "@/lib/mock/keywords";
import {
  COMPETITORS_AS_OF,
  COMPETITOR_RANGE_CAPTION,
  buildComparison,
  getClusterBattlegrounds,
  getCompetitorGapFindings,
  getCompetitorHighlights,
  getCompetitorMetrics,
  getCompetitorOpportunities,
  getCompetitorOptions,
  getCompetitorPages,
  getCompetitorPosture,
  getCompetitorProjectOptions,
  getCompetitorRecords,
  getContestedClusterOptions,
  getIntentBattlegrounds,
  getOverlapRows,
  getSerpThreats,
} from "@/lib/mock/competitors";
import { Pagination } from "@/components/keywords/pagination";
import { BattlesView } from "@/components/competitors/battles-view";
import { ClustersView } from "@/components/competitors/clusters-view";
import { COMPARE_LIMIT, CompareView } from "@/components/competitors/compare-view";
import { CompetitorSummary } from "@/components/competitors/competitor-summary";
import {
  CompetitorToolbar,
  SortControl,
  type FilterCounts,
} from "@/components/competitors/competitor-toolbar";
import { CompetitorsTable } from "@/components/competitors/competitors-table";
import { GapsView, type GapState } from "@/components/competitors/gaps-view";
import { IntentView } from "@/components/competitors/intent-view";
import { OpportunitiesView, type OpportunityState } from "@/components/competitors/opportunities-view";
import { OverlapTable } from "@/components/competitors/overlap-table";
import { OverviewView } from "@/components/competitors/overview-view";
import { PagesView } from "@/components/competitors/pages-view";
import { ThreatsView } from "@/components/competitors/threats-view";
import {
  EMPTY_COMPETITOR_FILTERS,
  hasActiveCompetitorFilters,
  matchesCompetitor,
  matchesRow,
  rowMatchesQuery,
  type CompetitorFilters,
} from "@/components/competitors/filters";
import {
  COMPETITOR_SORT_OPTIONS,
  OVERLAP_SORT_OPTIONS,
  PAGE_SORT_OPTIONS,
  compareCompetitors,
  compareOverlap,
  comparePages,
  type CompetitorSort,
  type OverlapSort,
  type PageSort,
} from "@/components/competitors/sorting";
import type {
  BattleState,
  CompetitorGapKind,
  DominanceState,
  OpportunityKind,
  ThreatKind,
} from "@/types/competitor";

/**
 * The Competitor Intelligence workspace.
 *
 * Owns every piece of state that has to survive a tab change: the filters, the
 * three sorts, the page, the comparison selection, and the decisions recorded
 * against gaps, threats, and opportunities. The views below are presentational
 * — one that owned its own state would lose it the moment the filters changed.
 *
 * The filters are deliberately global. Narrowing to one project or one rival
 * should narrow the overlap, the gaps, the pages, the battles, the clusters,
 * the intents, the threats, and the queue with it, because those are all
 * readings of the same set. The narrowing runs in a fixed order — competitors
 * first, then everything belonging to the competitors that survived — which is
 * what keeps a tab count and the table it labels describing the same rows.
 *
 * A client component because the whole screen is interactive. The data comes
 * from pure, deterministic builders, so the server render and the first client
 * render produce identical markup.
 */

const TABS = [
  { id: "overview", label: "Overview", icon: "command-center" },
  { id: "competitors", label: "Competitors", icon: "competitors" },
  { id: "overlap", label: "Keyword overlap", icon: "keywords" },
  { id: "battles", label: "Rankings", icon: "target" },
  { id: "gaps", label: "Content gaps", icon: "pages" },
  { id: "pages", label: "Top pages", icon: "content" },
  { id: "clusters", label: "Clusters", icon: "layers" },
  { id: "intent", label: "Intent", icon: "flag" },
  { id: "threats", label: "SERP threats", icon: "alert" },
  { id: "opportunities", label: "Opportunities", icon: "bolt" },
  { id: "compare", label: "Compare", icon: "split" },
] as const satisfies readonly {
  id: string;
  label: string;
  icon: IconName;
}[];

type TabId = (typeof TABS)[number]["id"];

const TAB_IDS: readonly string[] = TABS.map((tab) => tab.id);

export function CompetitorIntelligence() {
  const searchParams = useSearchParams();

  const allRecords = getCompetitorRecords();
  const allRows = getOverlapRows();
  const projects = getCompetitorProjectOptions();
  const competitorOptions = getCompetitorOptions();
  const clusterOptions = getContestedClusterOptions();

  // Deep links from the Command Center, a project, a keyword, or a content
  // page arrive as query parameters. They seed the initial state and nothing
  // more — changing a filter afterwards must not fight the URL.
  const initialProject = searchParams.get("project");
  const initialCompetitor = searchParams.get("competitor");
  const initialCluster = searchParams.get("cluster");
  const initialTab = searchParams.get("tab");

  const [tab, setTab] = useState<TabId>(() =>
    initialTab !== null && TAB_IDS.includes(initialTab)
      ? (initialTab as TabId)
      : "overview",
  );

  const [filters, setFilters] = useState<CompetitorFilters>(() => ({
    ...EMPTY_COMPETITOR_FILTERS,
    project:
      initialProject !== null &&
      projects.some((project) => project.id === initialProject)
        ? initialProject
        : "all",
    competitor:
      initialCompetitor !== null &&
      competitorOptions.some((entry) => entry.id === initialCompetitor)
        ? initialCompetitor
        : "all",
    cluster:
      initialCluster !== null &&
      clusterOptions.some((entry) => entry.id === initialCluster)
        ? initialCluster
        : "all",
  }));

  const [competitorSort, setCompetitorSort] = useState<{
    key: CompetitorSort;
    desc: boolean;
  }>({ key: "threat", desc: true });
  const [overlapSort, setOverlapSort] = useState<{
    key: OverlapSort;
    desc: boolean;
  }>({ key: "opportunity", desc: true });
  const [pageSort, setPageSort] = useState<{ key: PageSort; desc: boolean }>({
    key: "threat",
    desc: true,
  });

  const [advanced, setAdvanced] = useState(
    initialProject !== null ||
      initialCompetitor !== null ||
      initialCluster !== null,
  );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [battleFilter, setBattleFilter] = useState<BattleState | "all">("all");
  const [gapKind, setGapKind] = useState<CompetitorGapKind | "all">("all");
  const [threatKind, setThreatKind] = useState<ThreatKind | "all">("all");
  const [opportunityKind, setOpportunityKind] = useState<
    OpportunityKind | "all"
  >("all");
  const [dominance, setDominance] = useState<DominanceState | "all">("all");

  const [gapStates, setGapStates] = useState<Record<string, GapState>>({});
  const [opportunityStates, setOpportunityStates] = useState<
    Record<string, OpportunityState>
  >({});
  const [acknowledged, setAcknowledged] = useState<ReadonlySet<string>>(
    new Set(),
  );

  const [compareProject, setCompareProject] = useState<string>(
    () =>
      (initialProject !== null &&
      projects.some((project) => project.id === initialProject)
        ? initialProject
        : projects[0]?.id) ?? "",
  );
  const [compareSelection, setCompareSelection] = useState<ReadonlySet<string>>(
    new Set(),
  );

  const [notice, setNotice] = useState<string | null>(null);
  const tablistRef = useRef<HTMLDivElement>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  const announce = (message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 6_000);
  };

  // ---------------------------------------------------------------------
  // Narrowing
  // ---------------------------------------------------------------------

  /**
   * Competitors with at least one keyword matching the search.
   *
   * A competitor record holds no keywords of its own, so without this a search
   * for a term would narrow the competitor set to nothing and empty every tab
   * below it — including the keyword table the search is for.
   */
  const queryMatchedIds = useMemo(() => {
    if (filters.query.trim().length === 0) return undefined;
    const ids = new Set<string>();
    for (const row of allRows) {
      if (rowMatchesQuery(row, filters.query)) ids.add(row.competitorId);
    }
    return ids;
  }, [allRows, filters.query]);

  const filteredRecords = useMemo(
    () =>
      allRecords
        .filter((record) => matchesCompetitor(record, filters, queryMatchedIds))
        .sort((a, b) => compareCompetitors(a, b, competitorSort)),
    [allRecords, filters, queryMatchedIds, competitorSort],
  );

  const recordIds = useMemo(
    () => new Set(filteredRecords.map((record) => record.id)),
    [filteredRecords],
  );

  const filteredRows = useMemo(
    () =>
      allRows
        .filter(
          (row) => recordIds.has(row.competitorId) && matchesRow(row, filters),
        )
        .sort((a, b) => compareOverlap(a, b, overlapSort)),
    [allRows, recordIds, filters, overlapSort],
  );

  const contested = useMemo(
    () => filteredRows.filter((row) => row.theirPosition !== null),
    [filteredRows],
  );

  /** Whether a derived record survives the filters that are not about rivals. */
  const inScope = useMemo(() => {
    const query = filters.query.trim().toLowerCase();

    return (entry: {
      readonly competitorId: string;
      readonly clusterId: string | null;
      readonly intent?: string;
      readonly haystack: string;
    }) => {
      if (!recordIds.has(entry.competitorId)) return false;
      if (
        filters.cluster !== "all" &&
        entry.clusterId !== filters.cluster
      ) {
        return false;
      }
      if (
        filters.intent !== "all" &&
        entry.intent !== undefined &&
        entry.intent !== filters.intent
      ) {
        return false;
      }
      if (query.length > 0 && !entry.haystack.toLowerCase().includes(query)) {
        return false;
      }
      return true;
    };
  }, [recordIds, filters]);

  const pages = useMemo(
    () =>
      getCompetitorPages()
        .filter((entry) =>
          inScope({
            competitorId: entry.competitorId,
            clusterId: entry.clusterId,
            intent: entry.intent,
            haystack: `${entry.title} ${entry.url} ${entry.competitorName} ${entry.clusterName} ${entry.projectName}`,
          }),
        )
        .sort((a, b) => comparePages(a, b, pageSort)),
    [inScope, pageSort],
  );

  const gaps = useMemo(
    () =>
      getCompetitorGapFindings().filter((gap) =>
        inScope({
          competitorId: gap.competitorId,
          clusterId: gap.clusterId,
          intent: gap.intent,
          haystack: `${gap.keyword ?? ""} ${gap.clusterName} ${gap.competitorName} ${gap.projectName} ${gap.finding}`,
        }),
      ),
    [inScope],
  );

  const threats = useMemo(
    () =>
      getSerpThreats().filter((threat) =>
        inScope({
          competitorId: threat.competitorId,
          clusterId: threat.clusterId,
          haystack: `${threat.keyword ?? ""} ${threat.clusterName ?? ""} ${threat.competitorName} ${threat.projectName} ${threat.headline}`,
        }),
      ),
    [inScope],
  );

  const opportunities = useMemo(
    () =>
      getCompetitorOpportunities().filter((entry) =>
        inScope({
          competitorId: entry.competitorId,
          clusterId: entry.clusterId,
          intent: entry.intent,
          haystack: `${entry.keyword ?? ""} ${entry.clusterName ?? ""} ${entry.competitorName} ${entry.projectName} ${entry.action}`,
        }),
      ),
    [inScope],
  );

  const clusters = useMemo(() => {
    const contestedClusters = new Set(
      contested.map((row) => row.clusterId),
    );
    return getClusterBattlegrounds().filter((entry) =>
      contestedClusters.has(entry.clusterId),
    );
  }, [contested]);

  const intents = useMemo(
    () => getIntentBattlegrounds(filteredRows),
    [filteredRows],
  );

  const metrics = useMemo(
    () => getCompetitorMetrics(filteredRecords, filteredRows),
    [filteredRecords, filteredRows],
  );

  const posture = useMemo(
    () => getCompetitorPosture(filteredRecords, filteredRows),
    [filteredRecords, filteredRows],
  );

  const highlights = useMemo(
    () =>
      getCompetitorHighlights({
        records: filteredRecords,
        threats,
        opportunities,
        gaps,
        clusters,
      }),
    [filteredRecords, threats, opportunities, gaps, clusters],
  );

  /**
   * Counts behind each filter option.
   *
   * Each set is counted with its own filter released, so an option always
   * reports how many records it would select if chosen — not how many are
   * already showing, which would read zero for every option but the active one.
   */
  const counts: FilterCounts = useMemo(() => {
    const tally = <T extends string>(
      items: readonly T[],
    ): Record<string, number> => {
      const result: Record<string, number> = {};
      for (const item of items) result[item] = (result[item] ?? 0) + 1;
      return result;
    };

    const recordsWithout = (key: keyof CompetitorFilters) =>
      allRecords.filter((record) =>
        matchesCompetitor(record, { ...filters, [key]: "all" }, queryMatchedIds),
      );

    const rowsWithout = (key: keyof CompetitorFilters) => {
      const base = new Set(
        allRecords
          .filter((record) =>
            matchesCompetitor(
              record,
              { ...filters, [key]: "all" },
              queryMatchedIds,
            ),
          )
          .map((record) => record.id),
      );
      return allRows.filter(
        (row) =>
          base.has(row.competitorId) &&
          matchesRow(row, { ...filters, [key]: "all" }),
      );
    };

    return {
      threat: tally(
        recordsWithout("threat").map((record) => record.threatLevel),
      ),
      type: tally(recordsWithout("type").map((record) => record.type)),
      opportunity: tally(
        recordsWithout("opportunity").map((record) =>
          opportunityBandOf(record.opportunity.score),
        ),
      ),
      battle: tally(
        rowsWithout("battle")
          .map((row) => row.battle)
          .filter((state): state is BattleState => state !== null),
      ),
      overlap: tally(rowsWithout("overlap").map((row) => row.overlap)),
      intent: tally(rowsWithout("intent").map((row) => row.intent)),
      difficulty: tally(
        rowsWithout("difficulty").map((row) => difficultyBandOf(row.difficulty)),
      ),
      volume: tally(rowsWithout("volume").map((row) => volumeBandOf(row.volume))),
      total: recordsWithout("threat").length,
    };
  }, [allRecords, allRows, filters, queryMatchedIds]);

  const comparison = useMemo(
    () => buildComparison(compareProject, [...compareSelection]),
    [compareProject, compareSelection],
  );

  const compareCandidates = useMemo(
    () =>
      allRecords
        .filter((record) => record.projectId === compareProject)
        .sort((a, b) => b.threat.score - a.threat.score)
        .map((record) => ({
          id: record.id,
          name: record.name,
          domain: record.domain,
          threatScore: record.threat.score,
        })),
    [allRecords, compareProject],
  );

  // ---------------------------------------------------------------------
  // Interactions
  // ---------------------------------------------------------------------

  const changeFilters = (patch: Partial<CompetitorFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  const resetFilters = () => {
    setFilters(EMPTY_COMPETITOR_FILTERS);
    setPage(1);
  };

  const changeTab = (next: TabId) => {
    setTab(next);
    setPage(1);
  };

  const cycle = <T extends string>(
    setter: (
      value: (current: { key: T; desc: boolean }) => { key: T; desc: boolean },
    ) => void,
    options: readonly { readonly value: T; readonly desc: boolean }[],
  ) => (key: T) => {
    setter((current) =>
      current.key === key
        ? { key, desc: !current.desc }
        : {
            key,
            desc: options.find((option) => option.value === key)?.desc ?? true,
          },
    );
    setPage(1);
  };

  const changeCompetitorSort = cycle(setCompetitorSort, COMPETITOR_SORT_OPTIONS);
  const changeOverlapSort = cycle(setOverlapSort, OVERLAP_SORT_OPTIONS);
  const changePageSort = cycle(setPageSort, PAGE_SORT_OPTIONS);

  const toggleCompare = (id: string) =>
    setCompareSelection((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
        return next;
      }
      if (next.size >= COMPARE_LIMIT) {
        announce(
          `The comparison holds ${COMPARE_LIMIT} rivals at a time. Remove one before adding another.`,
        );
        return current;
      }

      // A rival from another project cannot share a denominator with the ones
      // already selected, so switching project resets rather than mixing.
      const record = allRecords.find((entry) => entry.id === id);
      if (record && record.projectId !== compareProject) {
        setCompareProject(record.projectId);
        announce(
          `Comparison switched to ${record.projectName} — rivals are only comparable inside one project.`,
        );
        return new Set([id]);
      }

      next.add(id);
      return next;
    });

  const toggleCompareAll = (ids: readonly string[], select: boolean) => {
    if (!select) {
      setCompareSelection((current) => {
        const next = new Set(current);
        for (const id of ids) next.delete(id);
        return next;
      });
      return;
    }

    const first = allRecords.find((record) => record.id === ids[0]);
    const project = first?.projectId ?? compareProject;
    const eligible = ids.filter(
      (id) =>
        allRecords.find((record) => record.id === id)?.projectId === project,
    );

    setCompareProject(project);
    setCompareSelection(new Set(eligible.slice(0, COMPARE_LIMIT)));
    announce(
      eligible.length > COMPARE_LIMIT
        ? `Added the first ${COMPARE_LIMIT} rivals in ${first?.projectName ?? "this project"} — the comparison holds four at a time.`
        : `Added ${eligible.length} ${eligible.length === 1 ? "rival" : "rivals"} to the comparison.`,
    );
  };

  const focusCompetitor = (competitorId: string) => {
    const record = allRecords.find((entry) => entry.id === competitorId);
    changeFilters({
      competitor: competitorId,
      project: record?.projectId ?? filters.project,
    });
    setAdvanced(true);
    changeTab("overlap");
  };

  /** Roving focus across the tab strip, as a tablist is expected to behave. */
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

  const scopeName =
    filters.project === "all"
      ? "every project"
      : (projects.find((project) => project.id === filters.project)?.name ??
        "every project");

  const tabCounts: Partial<Record<TabId, number>> = {
    competitors: filteredRecords.length,
    overlap: filteredRows.length,
    battles: contested.length,
    gaps: gaps.length,
    pages: pages.length,
    clusters: clusters.length,
    intent: intents.length,
    threats: threats.length,
    opportunities: opportunities.length,
    compare: compareSelection.size,
  };

  // Paging is 1-based and the set changes under it; clamping on read avoids an
  // effect that would cost an extra render pass on every filter change.
  const overlapPageCount = Math.max(
    1,
    Math.ceil(filteredRows.length / pageSize),
  );
  const overlapPage = Math.min(page, overlapPageCount);
  const overlapRows = filteredRows.slice(
    (overlapPage - 1) * pageSize,
    overlapPage * pageSize,
  );

  const competitorPageCount = Math.max(
    1,
    Math.ceil(filteredRecords.length / pageSize),
  );
  const competitorPage = Math.min(page, competitorPageCount);
  const competitorRows = filteredRecords.slice(
    (competitorPage - 1) * pageSize,
    competitorPage * pageSize,
  );

  const sortControl =
    tab === "competitors" ? (
      <SortControl
        value={competitorSort.key}
        desc={competitorSort.desc}
        onChange={changeCompetitorSort}
        options={COMPETITOR_SORT_OPTIONS}
        label="Sort competitors"
      />
    ) : tab === "overlap" || tab === "battles" ? (
      <SortControl
        value={overlapSort.key}
        desc={overlapSort.desc}
        onChange={changeOverlapSort}
        options={OVERLAP_SORT_OPTIONS}
        label="Sort keyword overlap"
      />
    ) : tab === "pages" ? (
      <SortControl
        value={pageSort.key}
        desc={pageSort.desc}
        onChange={changePageSort}
        options={PAGE_SORT_OPTIONS}
        label="Sort competitor pages"
      />
    ) : undefined;

  return (
    <div className="space-y-6">
      <SectionHeader
        size="page"
        title="Competitor Intelligence"
        description={`Who we are competing with across ${scopeName}, where they are ahead, what it is costing, and which of it is takeable back.`}
        actions={
          <>
            <span className="hidden items-center gap-1.5 text-[11.5px] text-fg-subtle lg:inline-flex">
              <Icon name="clock" className="h-3.5 w-3.5" />
              Updated {formatFullDate(COMPETITORS_AS_OF)},{" "}
              {formatTimeUtc(COMPETITORS_AS_OF)}
            </span>
            <Button icon="alert" onClick={() => changeTab("threats")}>
              Threats
            </Button>
            <Button
              variant="primary"
              icon="bolt"
              onClick={() => changeTab("opportunities")}
            >
              Opportunities
            </Button>
          </>
        }
      />

      <div aria-live="polite">
        {notice && (
          <div className="flex flex-wrap items-start gap-3 rounded-panel border border-accent/30 bg-accent-soft px-4 py-3">
            <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-fg-muted">
              {notice}
            </p>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setNotice(null)}
              aria-label="Dismiss notice"
            >
              <Icon name="close" className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      <CompetitorSummary
        metrics={metrics}
        threats={posture.threats}
        battles={posture.battles}
        contested={posture.contested}
        total={allRecords.length}
        filtered={filteredRecords.length}
      />

      <Panel>
        <CompetitorToolbar
          filters={filters}
          onFilterChange={changeFilters}
          onReset={resetFilters}
          counts={counts}
          sortControl={sortControl}
          projects={projects}
          competitors={competitorOptions}
          clusters={clusterOptions}
          advanced={advanced}
          onToggleAdvanced={() => setAdvanced((value) => !value)}
          total={allRecords.length}
          shown={filteredRecords.length}
          noun="competitors"
        />
        <PanelFooter>
          <span>
            Filters apply to every view below — the overlap, the gaps, the
            pages, the battles, the clusters, the intents, and the queue all
            describe the {filteredRecords.length} competitors selected here.
          </span>
          <span>
            Mock data over the {COMPETITOR_RANGE_CAPTION.toLowerCase()}
          </span>
        </PanelFooter>
      </Panel>

      <div className="relative -mx-1 overflow-x-auto px-1">
        <div
          ref={tablistRef}
          role="tablist"
          aria-label="Competitor Intelligence sections"
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
                id={`competitors-tab-${entry.id}`}
                aria-selected={isSelected}
                aria-controls={`competitors-panel-${entry.id}`}
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
        id={`competitors-panel-${tab}`}
        aria-labelledby={`competitors-tab-${tab}`}
        tabIndex={0}
        className="space-y-4 focus-visible:outline-none"
      >
        {tab === "overview" && (
          <OverviewView
            highlights={highlights}
            records={filteredRecords}
            threats={threats}
            opportunities={opportunities}
            clusters={clusters}
            rows={contested}
            onOpenTab={(next) => changeTab(next as TabId)}
            onFocusCompetitor={focusCompetitor}
          />
        )}

        {tab === "competitors" && (
          <Panel>
            {competitorRows.length === 0 ? (
              <EmptyState
                icon="search"
                title="No competitors match these filters"
                description="Nothing in the tracked set matches the current search and filter combination."
                action={
                  hasActiveCompetitorFilters(filters) ? (
                    <Button icon="close" onClick={resetFilters}>
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <CompetitorsTable
                records={competitorRows}
                sort={competitorSort}
                onSort={changeCompetitorSort}
                selected={compareSelection}
                onToggle={toggleCompare}
                onToggleAll={toggleCompareAll}
                selectionFull={compareSelection.size >= COMPARE_LIMIT}
              />
            )}

            <Pagination
              page={competitorPage}
              pageSize={pageSize}
              total={filteredRecords.length}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
              noun="competitors"
            />
          </Panel>
        )}

        {tab === "overlap" && (
          <Panel>
            {overlapRows.length === 0 ? (
              <EmptyState
                icon="search"
                title="No overlap matches these filters"
                description="No keyword in the current selection is ranked by either side."
                action={
                  hasActiveCompetitorFilters(filters) ? (
                    <Button icon="close" onClick={resetFilters}>
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <OverlapTable
                rows={overlapRows}
                sort={overlapSort}
                onSort={changeOverlapSort}
              />
            )}

            <Pagination
              page={overlapPage}
              pageSize={pageSize}
              total={filteredRows.length}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
              noun="keywords"
            />
          </Panel>
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

        {tab === "gaps" && (
          <GapsView
            gaps={gaps}
            kindFilter={gapKind}
            onKindFilter={setGapKind}
            states={gapStates}
            onAct={(id, state) =>
              setGapStates((current) => ({ ...current, [id]: state }))
            }
          />
        )}

        {tab === "pages" && (
          <PagesView
            pages={pages}
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
            clusters={clusters}
            stateFilter={dominance}
            onStateFilter={setDominance}
          />
        )}

        {tab === "intent" && <IntentView rows={intents} />}

        {tab === "threats" && (
          <ThreatsView
            threats={threats}
            kindFilter={threatKind}
            onKindFilter={setThreatKind}
            acknowledged={acknowledged}
            onAcknowledge={(id) =>
              setAcknowledged((current) => {
                const next = new Set(current);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
          />
        )}

        {tab === "opportunities" && (
          <OpportunitiesView
            opportunities={opportunities}
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

        {tab === "compare" && (
          <CompareView
            comparison={comparison}
            projects={projects}
            projectId={compareProject}
            onProjectChange={(id) => {
              setCompareProject(id);
              setCompareSelection(new Set());
            }}
            selected={compareSelection}
            onToggle={toggleCompare}
            onClear={() => setCompareSelection(new Set())}
            available={compareCandidates}
          />
        )}
      </div>
    </div>
  );
}
