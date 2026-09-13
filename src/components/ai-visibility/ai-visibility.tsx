"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Icon, type IconName } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { MetricTileGrid } from "@/components/ui/metric-tile";
import { Panel, PanelFooter } from "@/components/ui/panel";
import { SectionHeader } from "@/components/ui/section-header";
import { TabList, tabDomId, tabPanelDomId } from "@/components/ui/tab-list";
import { formatFullDate, formatTimeUtc } from "@/lib/format";
import { Pagination } from "@/components/keywords/pagination";
import {
  AI_AS_OF,
  AI_SOURCE_SHORT,
  getAiEntities,
  getAiGaps,
  getAiOpportunities,
  getAiOverview,
  getAiPages,
  getAiProjectOptions,
  getEntityConnectivity,
  getEntityRelations,
  getFanOut,
  getFanOutBranches,
  getAiTopicOptions,
  getAiTopics,
} from "@/lib/mock/ai-visibility";
import { FanOutView } from "@/components/ai-visibility/fan-out-view";
import { RelationshipsPanel } from "@/components/ai-visibility/relationships-panel";
import { GapsView } from "@/components/ai-visibility/gaps-view";
import { OpportunitiesView } from "@/components/ai-visibility/opportunities-view";
import { OverviewView } from "@/components/ai-visibility/overview-view";
import {
  AiPagesTable,
  EntitiesTable,
  TopicsTable,
} from "@/components/ai-visibility/tables";
import {
  AiToolbar,
  SortControl,
  type AiFilterCounts,
} from "@/components/ai-visibility/ai-toolbar";
import {
  EMPTY_AI_FILTERS,
  matchesAiEntity,
  matchesAiGap,
  matchesBranch,
  matchesAiPage,
  matchesAiTopic,
  type AiFilters,
} from "@/components/ai-visibility/filters";
import {
  BRANCH_SORT_OPTIONS,
  ENTITY_SORT_OPTIONS,
  PAGE_SORT_OPTIONS,
  TOPIC_SORT_OPTIONS,
  compareAiEntities,
  compareAiPages,
  compareAiTopics,
  compareBranches,
  type AiEntitySort,
  type AiPageSort,
  type BranchSort,
  type AiTopicSort,
} from "@/components/ai-visibility/sorting";
import type {
  AiOpportunityKind,
  AiOpportunityState,
} from "@/types/ai-visibility";

/**
 * The AI Visibility workspace.
 *
 * Owns every piece of state that has to survive a tab change: the filters, the
 * three sorts, the page, and the decisions recorded against jobs. The views
 * below are presentational — one that owned its own state would lose it the
 * moment a filter changed.
 *
 * The filters are deliberately global. Narrowing to one project should narrow
 * the visibility score, the dimensions, the topics, the entities, the gaps and
 * the queue with it, because all of those are readings of the same set. The
 * narrowing runs in a fixed order — pages first, then everything that hangs
 * off the pages that survived — which is what keeps a tab count and the table
 * it labels describing the same rows.
 *
 * A client component because the whole screen is interactive. The data comes
 * from pure, deterministic builders, so the server render and the first client
 * render produce identical markup.
 */

const TABS = [
  { id: "overview", label: "Overview", icon: "command-center" },
  { id: "topics", label: "Topics", icon: "target" },
  { id: "entities", label: "Entities", icon: "layers" },
  { id: "readiness", label: "Answer readiness", icon: "flag" },
  { id: "citations", label: "Citations", icon: "note" },
  { id: "evidence", label: "Evidence", icon: "shield" },
  { id: "fan-out", label: "Query fan-out", icon: "split" },
  { id: "gaps", label: "Content gaps", icon: "alert" },
  { id: "opportunities", label: "Opportunities", icon: "bolt" },
] as const satisfies readonly {
  id: string;
  label: string;
  icon: IconName;
}[];

type TabId = (typeof TABS)[number]["id"];

const TAB_IDS: readonly string[] = TABS.map((tab) => tab.id);

export function AiVisibility() {
  const searchParams = useSearchParams();

  const allPages = getAiPages();
  const allTopics = getAiTopics();
  const allEntities = getAiEntities();
  const allGaps = getAiGaps();
  const allOpportunities = getAiOpportunities();
  const projects = getAiProjectOptions();
  const topicOptions = getAiTopicOptions();

  // Deep links from the Command Center, a project, a content page or a keyword
  // arrive as query parameters. They seed the initial state and nothing more —
  // changing a filter afterwards must not fight the URL.
  const initialProject = searchParams.get("project");
  const initialTopic = searchParams.get("topic");
  const initialTab = searchParams.get("tab");

  const [tab, setTab] = useState<TabId>(() =>
    initialTab !== null && TAB_IDS.includes(initialTab)
      ? (initialTab as TabId)
      : "overview",
  );

  const [filters, setFilters] = useState<AiFilters>(() => ({
    ...EMPTY_AI_FILTERS,
    project:
      initialProject !== null &&
      projects.some((project) => project.id === initialProject)
        ? initialProject
        : "all",
    topic:
      initialTopic !== null &&
      topicOptions.some((entry) => entry.id === initialTopic)
        ? initialTopic
        : "all",
  }));

  const [pageSort, setPageSort] = useState<{ key: AiPageSort; desc: boolean }>({
    key: "visibility",
    desc: false,
  });
  const [topicSort, setTopicSort] = useState<{
    key: AiTopicSort;
    desc: boolean;
  }>({ key: "visibility", desc: false });
  const [entitySort, setEntitySort] = useState<{
    key: AiEntitySort;
    desc: boolean;
  }>({ key: "strength", desc: false });

  const [branchSort, setBranchSort] = useState<{
    key: BranchSort;
    desc: boolean;
  }>({ key: "priority", desc: true });

  const [opportunityKind, setOpportunityKind] = useState<
    AiOpportunityKind | "all"
  >("all");
  const [opportunityStates, setOpportunityStates] = useState<
    Record<string, AiOpportunityState>
  >({});

  const [advanced, setAdvanced] = useState(
    initialProject !== null || initialTopic !== null,
  );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // ---------------------------------------------------------------------
  // Narrowing
  // ---------------------------------------------------------------------

  /**
   * Pages carrying at least one entity of the selected type.
   *
   * A page holds no entity type of its own, so without this the entity-type
   * filter would narrow the entity table and leave every page in place —
   * a filter that only half works.
   */
  const entityTypePageIds = useMemo(() => {
    if (filters.entityType === "all") return undefined;
    const ids = new Set<string>();
    for (const entity of allEntities) {
      if (entity.type !== filters.entityType) continue;
      for (const id of entity.pageIds) ids.add(id);
    }
    return ids;
  }, [allEntities, filters.entityType]);

  const filteredPages = useMemo(
    () =>
      allPages
        .filter((entry) => matchesAiPage(entry, filters, entityTypePageIds))
        .sort((a, b) => compareAiPages(a, b, pageSort)),
    [allPages, filters, entityTypePageIds, pageSort],
  );

  const pageIds = useMemo(
    () => new Set(filteredPages.map((entry) => entry.id)),
    [filteredPages],
  );

  const filteredTopics = useMemo(
    () =>
      allTopics
        .filter((entry) => matchesAiTopic(entry, filters, pageIds))
        .sort((a, b) => compareAiTopics(a, b, topicSort)),
    [allTopics, filters, pageIds, topicSort],
  );

  const filteredEntities = useMemo(
    () =>
      allEntities
        .filter((entry) => matchesAiEntity(entry, filters, pageIds))
        .sort((a, b) => compareAiEntities(a, b, entitySort)),
    [allEntities, filters, pageIds, entitySort],
  );

  const filteredGaps = useMemo(
    () => allGaps.filter((entry) => matchesAiGap(entry, filters, pageIds)),
    [allGaps, filters, pageIds],
  );

  /**
   * The fan-out, narrowed and ordered.
   *
   * Branches are filtered on their own rather than through the surviving
   * pages: an uncovered branch has no page by definition, and running it
   * through the page filter would hide exactly the rows worth seeing.
   */
  /**
   * Connections among the entities that survived the filters.
   *
   * Scoped to the entity table above rather than to the project, so narrowing
   * to one type or one topic narrows the graph with it — a panel describing
   * entities that are no longer on screen would be describing a different set.
   */
  const scopedRelations = useMemo(() => {
    const ids = new Set(filteredEntities.map((entry) => entry.id));
    return getEntityRelations().filter(
      (entry) => ids.has(entry.sourceId) && ids.has(entry.targetId),
    );
  }, [filteredEntities]);

  const scopedConnectivity = useMemo(() => {
    const ids = new Set(filteredEntities.map((entry) => entry.id));
    return getEntityConnectivity().filter((entry) => ids.has(entry.entityId));
  }, [filteredEntities]);

  const allFanOut = useMemo(() => getFanOut(), []);

  const filteredBranches = useMemo(
    () =>
      getFanOutBranches()
        .filter((entry) => matchesBranch(entry, filters))
        .sort((a, b) => compareBranches(a, b, branchSort)),
    [filters, branchSort],
  );

  /**
   * The queue, narrowed the same way everything else is.
   *
   * A job survives while it still has a page behind it, and reports only the
   * pages that survived — so a job touching forty URLs across the portfolio
   * reads as the six it touches on the project in scope.
   */
  const filteredOpportunities = useMemo(() => {
    const gapKinds = new Set(filteredGaps.map((gap) => gap.kind));

    return allOpportunities
      .filter((entry) => {
        if (filters.project !== "all" && entry.projectId !== filters.project) {
          return false;
        }
        if (
          filters.opportunityKind !== "all" &&
          entry.kind !== filters.opportunityKind
        ) {
          return false;
        }
        if (filters.severity !== "all" && entry.severity !== filters.severity) {
          return false;
        }
        if (!gapKinds.has(entry.gapKind)) return false;
        if (entry.pageIds.length === 0) return true;
        return entry.pageIds.some((id) => pageIds.has(id));
      })
      .map((entry) => {
        const kept = entry.pageIds.filter((id) => pageIds.has(id));
        return kept.length === entry.pageIds.length
          ? entry
          : { ...entry, pageIds: kept, affectedPages: kept.length };
      });
  }, [allOpportunities, filteredGaps, filters, pageIds]);

  const overview = useMemo(
    () =>
      getAiOverview(
        filteredPages,
        filteredTopics,
        filteredEntities,
        filteredGaps,
        filteredOpportunities,
      ),
    [
      filteredPages,
      filteredTopics,
      filteredEntities,
      filteredGaps,
      filteredOpportunities,
    ],
  );

  const pagesById = useMemo(
    () => new Map(allPages.map((entry) => [entry.id, entry])),
    [allPages],
  );

  /**
   * Counts behind each filter option.
   *
   * Each set is counted with its own filter released, so an option always
   * reports how many records it would select if chosen — not how many are
   * already showing, which would read zero for every option but the active one.
   */
  const counts: AiFilterCounts = useMemo(() => {
    const tally = (values: readonly string[]): Record<string, number> => {
      const result: Record<string, number> = {};
      for (const value of values) result[value] = (result[value] ?? 0) + 1;
      return result;
    };

    const pagesWithout = (key: keyof AiFilters) => {
      const relaxed = { ...filters, [key]: "all" } as AiFilters;
      const scoped = key === "entityType" ? undefined : entityTypePageIds;
      return allPages.filter((entry) => matchesAiPage(entry, relaxed, scoped));
    };

    const scopeIds = new Set(pagesWithout("entityType").map((p) => p.id));

    // The fan-out counts each release their own filter the same way, so an
    // option always reports what it would select rather than what is showing.
    const branchesWithout = (key: keyof AiFilters) =>
      getFanOutBranches().filter((entry) =>
        matchesBranch(entry, { ...filters, [key]: "all" } as AiFilters),
      );

    return {
      coverage: tally(
        branchesWithout("coverage").map((entry) => entry.coverage),
      ),
      facet: tally(branchesWithout("facet").map((entry) => entry.facet)),
      band: tally(pagesWithout("band").map((entry) => entry.visibility.band)),
      citation: tally(
        pagesWithout("citation").map((entry) => entry.citation.state),
      ),
      evidence: tally(
        pagesWithout("evidence").map((entry) => entry.evidence.band),
      ),
      confidence: tally(
        pagesWithout("confidence").map((entry) => entry.gain.confidence),
      ),
      entityType: tally(
        allEntities
          .filter(
            (entity) =>
              (filters.project === "all" ||
                entity.projectId === filters.project) &&
              (entity.pageIds.length === 0 ||
                entity.pageIds.some((id) => scopeIds.has(id))),
          )
          .map((entity) => entity.type),
      ),
      gapKind: tally(
        allGaps
          .filter(
            (gap) =>
              (filters.project === "all" ||
                gap.projectId === filters.project) &&
              (gap.pageId === null || pageIds.has(gap.pageId)),
          )
          .map((gap) => gap.kind),
      ),
      opportunityKind: tally(
        allOpportunities
          .filter(
            (entry) =>
              filters.project === "all" || entry.projectId === filters.project,
          )
          .map((entry) => entry.kind),
      ),
      severity: tally(
        allGaps
          .filter(
            (gap) =>
              (filters.project === "all" ||
                gap.projectId === filters.project) &&
              (gap.pageId === null || pageIds.has(gap.pageId)),
          )
          .map((gap) => gap.severity),
      ),
      total: filteredPages.length,
    };
  }, [
    allPages,
    allEntities,
    allGaps,
    allOpportunities,
    filters,
    entityTypePageIds,
    pageIds,
    filteredPages.length,
  ]);

  // ---------------------------------------------------------------------
  // Interaction
  // ---------------------------------------------------------------------

  const changeFilters = (patch: Partial<AiFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  const resetFilters = () => {
    setFilters(EMPTY_AI_FILTERS);
    setPage(1);
  };

  const changeTab = (next: TabId) => {
    setTab(next);
    setPage(1);
  };

  const scopeName =
    filters.project === "all"
      ? "the portfolio"
      : (projects.find((project) => project.id === filters.project)?.name ??
        "the portfolio");

  const tabCounts: Partial<Record<TabId, number>> = {
    topics: filteredTopics.length,
    entities: filteredEntities.length,
    readiness: filteredPages.length,
    citations: filteredPages.length,
    evidence: filteredPages.length,
    "fan-out": filteredBranches.length,
    gaps: filteredGaps.length,
    opportunities: filteredOpportunities.length,
  };

  // Paging is 1-based and the set changes under it; clamping on read avoids an
  // effect that would cost an extra render pass on every filter change.
  const paged = <T,>(items: readonly T[]) => {
    const count = Math.max(1, Math.ceil(items.length / pageSize));
    const current = Math.min(page, count);
    return {
      current,
      rows: items.slice((current - 1) * pageSize, current * pageSize),
    };
  };

  const pagesPage = paged(filteredPages);
  const topicsPage = paged(filteredTopics);
  const entitiesPage = paged(filteredEntities);
  const gapsPage = paged(filteredGaps);

  const sortControl =
    tab === "fan-out" ? (
      <SortControl
        value={branchSort.key}
        desc={branchSort.desc}
        onChange={(key, desc) => setBranchSort({ key, desc })}
        options={BRANCH_SORT_OPTIONS}
        label="Sort sub-questions"
      />
    ) : tab === "topics" ? (
      <SortControl
        value={topicSort.key}
        desc={topicSort.desc}
        onChange={(key, desc) => setTopicSort({ key, desc })}
        options={TOPIC_SORT_OPTIONS}
        label="Sort topics"
      />
    ) : tab === "entities" ? (
      <SortControl
        value={entitySort.key}
        desc={entitySort.desc}
        onChange={(key, desc) => setEntitySort({ key, desc })}
        options={ENTITY_SORT_OPTIONS}
        label="Sort entities"
      />
    ) : tab === "readiness" || tab === "citations" || tab === "evidence" ? (
      <SortControl
        value={pageSort.key}
        desc={pageSort.desc}
        onChange={(key, desc) => setPageSort({ key, desc })}
        options={PAGE_SORT_OPTIONS}
        label="Sort pages"
      />
    ) : undefined;

  const nounFor: Partial<Record<TabId, string>> = {
    topics: "topics",
    entities: "entities",
    gaps: "gaps",
    opportunities: "jobs",
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        size="page"
        title="AI Visibility"
        description={`How likely ${scopeName} is to be understood, used, and quoted by AI answer engines — and what is stopping it.`}
        actions={
          <>
            <span className="hidden items-center gap-1.5 text-[11.5px] text-fg-subtle lg:inline-flex">
              <Icon name="clock" className="h-3.5 w-3.5" />
              Updated {formatFullDate(AI_AS_OF)}, {formatTimeUtc(AI_AS_OF)}
            </span>
            <Button icon="alert" onClick={() => changeTab("gaps")}>
              Gaps
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

      <MetricTileGrid metrics={overview.metrics} />

      <Panel>
        <AiToolbar
          filters={filters}
          onFilterChange={changeFilters}
          onReset={resetFilters}
          counts={counts}
          sortControl={sortControl}
          projects={projects}
          topics={topicOptions}
          advanced={advanced}
          onToggleAdvanced={() => setAdvanced((value) => !value)}
          total={allPages.length}
          shown={filteredPages.length}
          noun="pages"
        />
        <PanelFooter>
          <span>
            Filters apply to every view below — the score, the dimensions, the
            topics, the entities, the gaps and the queue all describe the{" "}
            {filteredPages.length} pages selected here.
          </span>
          <span>{AI_SOURCE_SHORT}</span>
        </PanelFooter>
      </Panel>

      <TabList
        tabs={TABS}
        value={tab}
        onChange={changeTab}
        label="AI Visibility sections"
        idPrefix="ai"
        counts={tabCounts}
      />

      <div
        role="tabpanel"
        id={tabPanelDomId("ai", tab)}
        aria-labelledby={tabDomId("ai", tab)}
        tabIndex={0}
        className="space-y-4 focus-visible:outline-none"
      >
        {tab === "overview" && (
          <OverviewView
            overview={overview}
            onOpenTab={(next) => changeTab(next as TabId)}
          />
        )}

        {tab === "topics" && (
          <Panel>
            <TopicsTable topics={topicsPage.rows} />
            {filteredTopics.length > pageSize && (
              <Pagination
                page={topicsPage.current}
                pageSize={pageSize}
                total={filteredTopics.length}
                onPageChange={setPage}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
                noun={nounFor.topics as string}
              />
            )}
          </Panel>
        )}

        {tab === "entities" && (
          <>
          <Panel>
            <EntitiesTable entities={entitiesPage.rows} />
            {filteredEntities.length > pageSize && (
              <Pagination
                page={entitiesPage.current}
                pageSize={pageSize}
                total={filteredEntities.length}
                onPageChange={setPage}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
                noun={nounFor.entities as string}
              />
            )}
          </Panel>
          <RelationshipsPanel
            relations={scopedRelations}
            connectivity={scopedConnectivity}
          />
          </>
        )}

        {(tab === "readiness" || tab === "citations" || tab === "evidence") && (
          <Panel>
            <AiPagesTable pages={pagesPage.rows} variant={tab} />
            {filteredPages.length > pageSize && (
              <Pagination
                page={pagesPage.current}
                pageSize={pageSize}
                total={filteredPages.length}
                onPageChange={setPage}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
                noun="pages"
              />
            )}
          </Panel>
        )}

        {tab === "gaps" && (
          <div className="space-y-4">
            <GapsView
              gaps={gapsPage.rows}
              onFilterKind={(gapKind) => changeFilters({ gapKind })}
            />
            {filteredGaps.length > pageSize && (
              <Panel>
                <Pagination
                  page={gapsPage.current}
                  pageSize={pageSize}
                  total={filteredGaps.length}
                  onPageChange={setPage}
                  onPageSizeChange={(size) => {
                    setPageSize(size);
                    setPage(1);
                  }}
                  noun={nounFor.gaps as string}
                />
              </Panel>
            )}
          </div>
        )}

        {tab === "fan-out" && (
          <FanOutView topics={allFanOut} branches={filteredBranches} />
        )}

        {tab === "opportunities" && (
          <OpportunitiesView
            opportunities={filteredOpportunities}
            pagesById={pagesById}
            kind={opportunityKind}
            onKindChange={setOpportunityKind}
            states={opportunityStates}
            onStateChange={(id, state) =>
              setOpportunityStates((current) => ({ ...current, [id]: state }))
            }
          />
        )}
      </div>
    </div>
  );
}
