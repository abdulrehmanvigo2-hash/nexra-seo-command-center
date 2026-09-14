"use client";

import { useSearchParams } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Icon, type IconName } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelFooter } from "@/components/ui/panel";
import { SectionHeader } from "@/components/ui/section-header";
import { TabList, tabDomId, tabPanelDomId } from "@/components/ui/tab-list";
import { formatFullDate, formatTimeUtc } from "@/lib/format";
import {
  KEYWORDS_AS_OF,
  KEYWORDS_RANGE_CAPTION,
  cannibalizationRiskIndex,
  clusterOptions,
  getAiSummary,
  getCannibalization,
  getCompetitorGaps,
  getContentGaps,
  getIntentBreakdown,
  getKeywordClusters,
  getKeywordList,
  getKeywordMetrics,
  getKeywordOpportunities,
  getKeywordProjectOptions,
  getMovementSummary,
  getKeywordMovement,
  getRankingBands,
  getSeededLists,
  getSerpFeatureSummary,
  getStrikingDistance,
} from "@/lib/mock/keywords";
import { AiSearchView } from "@/components/keywords/ai-view";
import { BulkActions } from "@/components/keywords/bulk-actions";
import { CannibalizationView } from "@/components/keywords/cannibalization-view";
import { ClustersView } from "@/components/keywords/clusters-view";
import { CompetitorGapView, ContentGapView } from "@/components/keywords/gap-views";
import { DiscoverDialog } from "@/components/keywords/discover-dialog";
import { ImportDialog } from "@/components/keywords/import-dialog";
import { KeywordPortfolio } from "@/components/keywords/keyword-portfolio";
import { KeywordsTable } from "@/components/keywords/keywords-table";
import { KeywordsToolbar } from "@/components/keywords/keywords-toolbar";
import { ListsView } from "@/components/keywords/lists-view";
import { MovementView } from "@/components/keywords/movement-view";
import { OpportunitiesView } from "@/components/keywords/opportunities-view";
import { Pagination } from "@/components/keywords/pagination";
import { SerpView } from "@/components/keywords/serp-view";
import {
  EMPTY_KEYWORD_FILTERS,
  hasActiveKeywordFilters,
  matchesKeywordFilters,
  type KeywordFilters,
} from "@/components/keywords/filters";
import {
  KEYWORD_SORT_OPTIONS,
  compareKeywords,
  type KeywordSort,
} from "@/components/keywords/sorting";
import { UnmeasuredSelectionNotice } from "@/components/projects/unmeasured-selection-notice";
import { SearchConsolePanel } from "@/components/search-console/search-console-panel";
import type { ProjectOption } from "@/lib/projects/selection";
import type { RangeId } from "@/types/dashboard";
import type {
  AgentId,
  AiKeywordFilter,
  CannibalizationState,
  ImportedKeyword,
  KeywordList,
  KeywordRecord,
  OpportunityState,
} from "@/types/keyword";

/**
 * The Keyword Intelligence workspace.
 *
 * Owns every piece of state that has to survive a tab change: the filters, the
 * sort, the page, the selection, the saved lists, the research queue, and the
 * decisions recorded against opportunities and cannibalisation cases. The
 * views below are presentational — one that owned its own state would lose it
 * the moment the filters changed.
 *
 * The filters are deliberately global rather than local to the table. Narrowing
 * to one project or one intent should narrow the opportunities, the gaps, the
 * SERP roll-up, and the answer-engine layer with it, because those are all
 * readings of the same set. Anything that would disagree with the table is
 * derived from the same filtered records the table is showing.
 *
 * A client component because the whole screen is interactive. The data comes
 * from pure, deterministic builders, so the server render and the first client
 * render produce identical markup.
 */

const TABS = [
  { id: "keywords", label: "Keywords", icon: "keywords" },
  { id: "clusters", label: "Clusters", icon: "layers" },
  { id: "opportunities", label: "Opportunities", icon: "target" },
  { id: "movement", label: "Movement", icon: "activity" },
  { id: "cannibalization", label: "Cannibalisation", icon: "split" },
  { id: "gaps", label: "Content gap", icon: "pages" },
  { id: "competitors", label: "Competitors", icon: "competitors" },
  { id: "serp", label: "SERP", icon: "search" },
  { id: "ai", label: "AI search", icon: "sparkles" },
  { id: "lists", label: "Lists", icon: "list" },
] as const satisfies readonly {
  id: string;
  label: string;
  icon: IconName;
}[];

type TabId = (typeof TABS)[number]["id"];

const TAB_IDS: readonly string[] = TABS.map((tab) => tab.id);

export function KeywordsWorkspace({
  projects,
}: {
  /** The Projects roster, read on the server from the Projects repository. */
  projects: readonly ProjectOption[];
}) {
  const searchParams = useSearchParams();

  const records = getKeywordList();
  const clusters = getKeywordClusters();
  // The import and discovery tools write modelled keyword records, so they
  // offer only the projects the modelled dataset covers. Selection, above,
  // offers the whole roster.
  const modelledProjects = getKeywordProjectOptions();
  const clusterFilterOptions = clusterOptions();
  const risk = cannibalizationRiskIndex();

  // Deep links from the dashboard and the project workspaces arrive as query
  // parameters. They seed the initial state and nothing more — changing a
  // filter afterwards must not fight the URL.
  const initialProject = searchParams.get("project");
  const initialCluster = searchParams.get("cluster");
  const initialTab = searchParams.get("tab");

  const [tab, setTab] = useState<TabId>(() =>
    initialTab !== null && TAB_IDS.includes(initialTab)
      ? (initialTab as TabId)
      : "keywords",
  );

  const [filters, setFilters] = useState<KeywordFilters>(() => ({
    ...EMPTY_KEYWORD_FILTERS,
    project:
      initialProject !== null &&
      projects.some((project) => project.id === initialProject)
        ? initialProject
        : "all",
    cluster:
      initialCluster !== null &&
      clusters.some((cluster) => cluster.id === initialCluster)
        ? initialCluster
        : "all",
  }));

  const [sort, setSort] = useState<{ key: KeywordSort; desc: boolean }>({
    key: "opportunity",
    desc: true,
  });

  const [advanced, setAdvanced] = useState(
    initialProject !== null || initialCluster !== null,
  );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);

  const [lists, setLists] = useState<readonly KeywordList[]>(() =>
    getSeededLists(),
  );
  const [imported, setImported] = useState<readonly ImportedKeyword[]>([]);

  const [owners, setOwners] = useState<Record<string, AgentId>>({});
  const [clusterMoves, setClusterMoves] = useState<Record<string, string>>({});
  const [reviewed, setReviewed] = useState<ReadonlySet<string>>(new Set());

  const [opportunityStates, setOpportunityStates] = useState<
    Record<string, OpportunityState>
  >({});
  const [cannibalStates, setCannibalStates] = useState<
    Record<string, CannibalizationState>
  >({});

  const [movementRange, setMovementRange] = useState<RangeId>("30d");
  const [aiFilter, setAiFilter] = useState<AiKeywordFilter>("citation-gap");

  const [dialog, setDialog] = useState<"import" | "discover" | null>(null);

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

  /**
   * The records as this session has them.
   *
   * Bulk changes are applied here rather than held beside the data, so a
   * re-assigned owner or a moved cluster shows up everywhere that reads a
   * keyword — the opportunity list, the gap table, the cluster counts — rather
   * than only in the place the change was made.
   */
  const sessionRecords = useMemo(() => {
    if (
      Object.keys(owners).length === 0 &&
      Object.keys(clusterMoves).length === 0
    ) {
      return records;
    }

    return records.map((record) => {
      const owner = owners[record.id];
      const clusterId = clusterMoves[record.id];
      if (owner === undefined && clusterId === undefined) return record;

      const cluster = clusters.find((entry) => entry.id === clusterId);

      return {
        ...record,
        owner: owner ?? record.owner,
        clusterId: cluster?.id ?? record.clusterId,
        clusterName: cluster?.name ?? record.clusterName,
      } satisfies KeywordRecord;
    });
  }, [records, owners, clusterMoves, clusters]);

  const listMembers = useMemo(() => {
    if (filters.list === "all") return null;
    const list = lists.find((entry) => entry.id === filters.list);
    return list ? new Set(list.keywordIds) : null;
  }, [filters.list, lists]);

  const filtered = useMemo(
    () =>
      sessionRecords
        .filter((record) =>
          matchesKeywordFilters(record, filters, { risk, listMembers }),
        )
        .sort((a, b) => compareKeywords(a, b, sort)),
    [sessionRecords, filters, risk, listMembers, sort],
  );

  const filteredIds = useMemo(
    () => new Set(filtered.map((record) => record.id)),
    [filtered],
  );

  const intentCounts = useMemo(() => {
    const base = sessionRecords.filter((record) =>
      matchesKeywordFilters(
        record,
        { ...filters, intent: "all" },
        { risk, listMembers },
      ),
    );
    const tally: Record<string, number> = { all: base.length };
    for (const record of base) {
      tally[record.intent] = (tally[record.intent] ?? 0) + 1;
    }
    return tally;
  }, [sessionRecords, filters, risk, listMembers]);

  // Paging is 1-based and the set changes under it; clamping on read avoids an
  // effect that would cost an extra render pass on every filter change.
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRecords = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  const metrics = useMemo(() => getKeywordMetrics(filtered), [filtered]);
  const bands = useMemo(() => getRankingBands(filtered), [filtered]);
  const intents = useMemo(() => getIntentBreakdown(filtered), [filtered]);
  const serp = useMemo(() => getSerpFeatureSummary(filtered), [filtered]);
  const aiMetrics = useMemo(() => getAiSummary(filtered), [filtered]);

  const opportunities = useMemo(
    () =>
      getKeywordOpportunities().filter((entry) =>
        filteredIds.has(entry.keywordId),
      ),
    [filteredIds],
  );

  const striking = useMemo(
    () =>
      getStrikingDistance().filter((row) => filteredIds.has(row.keywordId)),
    [filteredIds],
  );

  const cannibalization = useMemo(
    () =>
      getCannibalization().filter((entry) => filteredIds.has(entry.keywordId)),
    [filteredIds],
  );

  const gaps = useMemo(
    () => getContentGaps().filter((gap) => filteredIds.has(gap.keywordId)),
    [filteredIds],
  );

  const movementRows = useMemo(
    () =>
      getKeywordMovement(movementRange).filter((row) =>
        filteredIds.has(row.keywordId),
      ),
    [movementRange, filteredIds],
  );

  const movementSummary = useMemo(
    () => getMovementSummary(movementRange, filters.project),
    [movementRange, filters.project],
  );

  const competitorGaps = getCompetitorGaps();

  // ---------------------------------------------------------------------
  // Interactions
  // ---------------------------------------------------------------------

  const changeFilters = (patch: Partial<KeywordFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  const resetFilters = () => {
    setFilters(EMPTY_KEYWORD_FILTERS);
    setPage(1);
  };

  const changeSort = (key: KeywordSort) =>
    setSort((current) =>
      current.key === key
        ? { key, desc: !current.desc }
        : {
            key,
            desc:
              KEYWORD_SORT_OPTIONS.find((option) => option.value === key)
                ?.desc ?? true,
          },
    );

  const toggleSelection = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = (ids: readonly string[], select: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (select) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const selectedIds = [...selected];

  const addToList = (listId: string) => {
    const list = lists.find((entry) => entry.id === listId);
    if (!list) return;

    const added = selectedIds.filter((id) => !list.keywordIds.includes(id));

    setLists((current) =>
      current.map((entry) =>
        entry.id === listId
          ? { ...entry, keywordIds: [...entry.keywordIds, ...added] }
          : entry,
      ),
    );

    announce(
      added.length === 0
        ? `Every selected keyword was already in “${list.name}”.`
        : `Added ${added.length} keyword${added.length === 1 ? "" : "s"} to “${list.name}”. Session state only.`,
    );
  };

  const createListFromSelection = (name: string) => {
    const id = `session-${name.toLowerCase().replace(/\s+/g, "-")}-${lists.length}`;

    setLists((current) => [
      ...current,
      {
        id,
        name,
        description: `Created in this session from ${selectedIds.length} selected keyword${selectedIds.length === 1 ? "" : "s"}.`,
        icon: "star",
        keywordIds: selectedIds,
        seeded: false,
      },
    ]);

    announce(`Created “${name}” with ${selectedIds.length} keywords.`);
  };

  const createEmptyList = (name: string) => {
    const id = `session-${name.toLowerCase().replace(/\s+/g, "-")}-${lists.length}`;

    setLists((current) => [
      ...current,
      {
        id,
        name,
        description: "Created in this session.",
        icon: "star",
        keywordIds: [],
        seeded: false,
      },
    ]);
  };

  const assignAgent = (agent: AgentId) => {
    setOwners((current) => {
      const next = { ...current };
      for (const id of selectedIds) next[id] = agent;
      return next;
    });
    announce(
      `Assigned ${selectedIds.length} keyword${selectedIds.length === 1 ? "" : "s"} to a new owner. Session state only — no task was created.`,
    );
  };

  const addToCluster = (clusterId: string) => {
    const cluster = clusters.find((entry) => entry.id === clusterId);
    if (!cluster) return;

    setClusterMoves((current) => {
      const next = { ...current };
      for (const id of selectedIds) next[id] = clusterId;
      return next;
    });

    announce(
      `Moved ${selectedIds.length} keyword${selectedIds.length === 1 ? "" : "s"} into “${cluster.name}”. Session state only.`,
    );
  };

  const markReviewed = () => {
    setReviewed((current) => {
      const next = new Set(current);
      for (const id of selectedIds) next.add(id);
      return next;
    });
    announce(
      `Marked ${selectedIds.length} keyword${selectedIds.length === 1 ? "" : "s"} reviewed.`,
    );
  };

  const addToContentPlan = () => {
    addToList("content-plan");
  };

  const openList = (listId: string) => {
    changeFilters({ list: listId });
    setAdvanced(true);
    setTab("keywords");
  };

  const addImported = (rows: readonly ImportedKeyword[]) => {
    const accepted = rows.filter(
      (row) =>
        row.status === "pending-metrics" || row.status === "awaiting-research",
    );
    setImported((current) => [...accepted, ...current]);
    setTab("lists");
    announce(
      `${accepted.length} keyword${accepted.length === 1 ? "" : "s"} added to the research queue. No metrics were invented.`,
    );
  };

  const selectedProject =
    filters.project === "all"
      ? null
      : (projects.find((project) => project.id === filters.project) ?? null);
  const scopeName = selectedProject?.name ?? "every project";
  const modelledDefaultProject = modelledProjects.some(
    (project) => project.id === filters.project,
  )
    ? filters.project
    : "all";

  const counts: Partial<Record<TabId, number>> = {
    keywords: filtered.length,
    clusters: clusters.filter(
      (cluster) =>
        (filters.project === "all" || cluster.projectId === filters.project) &&
        cluster.keywordIds.some((id) => filteredIds.has(id)),
    ).length,
    opportunities: opportunities.length,
    movement: movementRows.length,
    cannibalization: cannibalization.length,
    gaps: gaps.length,
    serp: serp.length,
    lists: lists.length,
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        size="page"
        title="Keyword Intelligence"
        description={`Every tracked keyword across ${scopeName}: what it is worth, where it ranks, what is in the way, and what to do next.`}
        actions={
          <>
            <span className="hidden items-center gap-1.5 text-[11.5px] text-fg-subtle lg:inline-flex">
              <Icon name="clock" className="h-3.5 w-3.5" />
              Updated {formatFullDate(KEYWORDS_AS_OF)},{" "}
              {formatTimeUtc(KEYWORDS_AS_OF)}
            </span>
            <Button icon="upload" onClick={() => setDialog("import")}>
              Import
            </Button>
            <Button
              variant="primary"
              icon="search"
              onClick={() => setDialog("discover")}
            >
              Discover keywords
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

      {selectedProject && !selectedProject.measured ? (
        <UnmeasuredSelectionNotice name={selectedProject.name} />
      ) : (
        <KeywordPortfolio
          metrics={metrics}
          bands={bands}
          intents={intents}
          total={records.length}
          filtered={filtered.length}
        />
      )}

      <Panel>
        <KeywordsToolbar
          filters={filters}
          onFilterChange={changeFilters}
          onReset={resetFilters}
          intentCounts={intentCounts}
          sort={sort}
          onSortChange={changeSort}
          projects={projects}
          clusters={clusterFilterOptions}
          lists={lists}
          advanced={advanced}
          onToggleAdvanced={() => setAdvanced((value) => !value)}
          total={records.length}
          shown={filtered.length}
        />
        <PanelFooter>
          <span>
            Filters apply to every view below — the opportunities, gaps, SERP
            roll-up, and answer-engine layer all describe the{" "}
            {filtered.length} keywords selected here.
          </span>
          <span>
            Mock data over the {KEYWORDS_RANGE_CAPTION.toLowerCase()}
          </span>
        </PanelFooter>
      </Panel>

      <TabList
        tabs={TABS}
        value={tab}
        onChange={setTab}
        label="Keyword intelligence sections"
        idPrefix="kw"
        counts={counts}
      />

      <div
        role="tabpanel"
        id={tabPanelDomId("kw", tab)}
        aria-labelledby={tabDomId("kw", tab)}
        tabIndex={0}
        className="space-y-4 focus-visible:outline-none"
      >
        {tab === "keywords" && (
          <Panel>
            <BulkActions
              count={selected.size}
              lists={lists}
              clusters={clusterFilterOptions}
              onClear={() => setSelected(new Set())}
              onAddToList={addToList}
              onCreateList={createListFromSelection}
              onAssignAgent={assignAgent}
              onAddToCluster={addToCluster}
              onMarkReviewed={markReviewed}
              onAddToContentPlan={addToContentPlan}
              notice={notice}
            />

            {pageRecords.length === 0 ? (
              <EmptyState
                icon="search"
                title="No keywords match these filters"
                description="Nothing in the dataset matches the current search and filter combination."
                action={
                  hasActiveKeywordFilters(filters) ? (
                    <Button icon="close" onClick={resetFilters}>
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <KeywordsTable
                records={pageRecords}
                sort={sort}
                onSort={changeSort}
                selected={selected}
                onToggle={toggleSelection}
                onToggleAll={toggleAll}
                risk={risk}
                reviewed={reviewed}
              />
            )}

            <Pagination
              page={currentPage}
              pageSize={pageSize}
              total={filtered.length}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
              noun="keywords"
            />
          </Panel>
        )}

        {/* Observed queries from Search Console, kept apart from the modelled
            keyword universe above: a tracked keyword and a query Google
            reports are different records, and neither stands in for the other. */}
        {tab === "keywords" && (
          <SearchConsolePanel
            projectId={filters.project === "all" ? null : filters.project}
            rangeId="30d"
            view="queries"
          />
        )}

        {tab === "clusters" && (
          <ClustersView
            clusters={clusters}
            keywordIds={filteredIds}
            projects={projects}
            projectFilter={filters.project}
            onProjectChange={(project) => changeFilters({ project })}
          />
        )}

        {tab === "opportunities" && (
          <OpportunitiesView
            opportunities={opportunities}
            striking={striking}
            states={opportunityStates}
            onAct={(id, state) =>
              setOpportunityStates((current) => ({ ...current, [id]: state }))
            }
          />
        )}

        {tab === "movement" && (
          <MovementView
            rows={movementRows}
            summary={movementSummary}
            range={movementRange}
            onRangeChange={setMovementRange}
          />
        )}

        {tab === "cannibalization" && (
          <CannibalizationView
            records={cannibalization}
            states={cannibalStates}
            onResolve={(id, state) =>
              setCannibalStates((current) => ({ ...current, [id]: state }))
            }
          />
        )}

        {tab === "gaps" && <ContentGapView gaps={gaps} />}

        {tab === "competitors" && (
          <CompetitorGapView
            gaps={competitorGaps}
            projects={projects}
            projectFilter={filters.project}
            onProjectChange={(project) => changeFilters({ project })}
          />
        )}

        {tab === "serp" && <SerpView summaries={serp} total={filtered.length} />}

        {tab === "ai" && (
          <AiSearchView
            records={filtered}
            metrics={aiMetrics}
            filter={aiFilter}
            onFilterChange={setAiFilter}
          />
        )}

        {tab === "lists" && (
          <ListsView
            lists={lists}
            records={sessionRecords}
            imported={imported}
            onCreate={createEmptyList}
            onRename={(id, name) =>
              setLists((current) =>
                current.map((entry) =>
                  entry.id === id ? { ...entry, name } : entry,
                ),
              )
            }
            onRemoveKeyword={(listId, keywordId) =>
              setLists((current) =>
                current.map((entry) =>
                  entry.id === listId
                    ? {
                        ...entry,
                        keywordIds: entry.keywordIds.filter(
                          (id) => id !== keywordId,
                        ),
                      }
                    : entry,
                ),
              )
            }
            onOpenList={openList}
            onRemoveImported={(id) =>
              setImported((current) => current.filter((row) => row.id !== id))
            }
            onOpenImport={() => setDialog("import")}
            onOpenDiscover={() => setDialog("discover")}
            referenceIso={KEYWORDS_AS_OF}
          />
        )}
      </div>

      {dialog === "import" && (
        <ImportDialog
          projects={modelledProjects}
          defaultProjectId={modelledDefaultProject}
          referenceIso={KEYWORDS_AS_OF}
          onClose={() => setDialog(null)}
          onImport={addImported}
        />
      )}

      {dialog === "discover" && (
        <DiscoverDialog
          projects={modelledProjects}
          defaultProjectId={modelledDefaultProject}
          referenceIso={KEYWORDS_AS_OF}
          onClose={() => setDialog(null)}
          onAdd={addImported}
        />
      )}
    </div>
  );
}
