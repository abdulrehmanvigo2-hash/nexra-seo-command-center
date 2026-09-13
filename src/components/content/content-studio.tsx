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
import { AGENT_NAMES } from "@/lib/mock/agents";
import {
  ATTENTION_HEALTH,
  CONTENT_AS_OF,
  CONTENT_RANGE_CAPTION,
  RECENTLY_PUBLISHED_DAYS,
  STAGE_META,
  getActiveBriefs,
  getClusterCoverage,
  getContentClusterOptions,
  getContentGapOpportunities,
  getContentMetrics,
  getContentProjectOptions,
  getContentRecords,
  getFormatBreakdown,
  getHealthDistribution,
  getIntentAlignment,
  getKeywordMapping,
  getLinkOpportunities,
  getOrphanPages,
  getRecommendations,
  getUnmappedPages,
  getWorkflowBoard,
} from "@/lib/mock/content";
import { Pagination } from "@/components/keywords/pagination";
import { AeoView } from "@/components/content/aeo-view";
import { BriefsView } from "@/components/content/briefs-view";
import { ContentBulkActions } from "@/components/content/bulk-actions";
import { ContentSummary } from "@/components/content/content-summary";
import { ContentTable } from "@/components/content/content-table";
import { ContentToolbar } from "@/components/content/content-toolbar";
import { CoverageView } from "@/components/content/coverage-view";
import { GapsView } from "@/components/content/gaps-view";
import { IntentView } from "@/components/content/intent-view";
import { LinksView } from "@/components/content/links-view";
import { MappingView } from "@/components/content/mapping-view";
import { OverviewView } from "@/components/content/overview-view";
import { RecommendationsView } from "@/components/content/recommendations-view";
import { WorkflowBoard } from "@/components/content/workflow-board";
import {
  EMPTY_CONTENT_FILTERS,
  hasActiveContentFilters,
  matchesContentFilters,
  type ContentFilters,
} from "@/components/content/filters";
import {
  CONTENT_SORT_OPTIONS,
  compareContent,
  type ContentSort,
} from "@/components/content/sorting";
import type {
  AgentId,
  ContentRecord,
  ContentStage,
  LinkState,
  RecommendationState,
} from "@/types/content";

/**
 * The Content Studio workspace.
 *
 * Owns every piece of state that has to survive a tab change: the filters, the
 * sort, the page, the selection, and the decisions recorded against
 * recommendations, link opportunities, and gaps. The views below are
 * presentational — one that owned its own state would lose it the moment the
 * filters changed.
 *
 * The filters are deliberately global rather than local to the inventory.
 * Narrowing to one project or one format should narrow the board, the briefs,
 * the coverage, the findings, and the answer-engine layer with it, because
 * those are all readings of the same set. Anything that would disagree with
 * the inventory is derived from the same filtered records the inventory shows.
 *
 * A client component because the whole screen is interactive. The data comes
 * from pure, deterministic builders, so the server render and the first client
 * render produce identical markup.
 */

const TABS = [
  { id: "overview", label: "Overview", icon: "command-center" },
  { id: "inventory", label: "Inventory", icon: "content" },
  { id: "pipeline", label: "Pipeline", icon: "workflow" },
  { id: "briefs", label: "Briefs", icon: "brief" },
  { id: "mapping", label: "Keyword mapping", icon: "keywords" },
  { id: "coverage", label: "Coverage", icon: "layers" },
  { id: "intent", label: "Intent", icon: "target" },
  { id: "onpage", label: "On-page", icon: "sliders" },
  { id: "aeo", label: "AI readiness", icon: "sparkles" },
  { id: "links", label: "Internal links", icon: "handoff" },
  { id: "gaps", label: "Gaps", icon: "pages" },
] as const satisfies readonly {
  id: string;
  label: string;
  icon: IconName;
}[];

type TabId = (typeof TABS)[number]["id"];

const TAB_IDS: readonly string[] = TABS.map((tab) => tab.id);

type GapState = "open" | "planned" | "briefed" | "dismissed";

export function ContentStudio() {
  const searchParams = useSearchParams();

  const records = getContentRecords();
  const projects = getContentProjectOptions();
  const clusterOptions = getContentClusterOptions();

  // Deep links from the dashboard and the project workspaces arrive as query
  // parameters. They seed the initial state and nothing more — changing a
  // filter afterwards must not fight the URL.
  const initialProject = searchParams.get("project");
  const initialCluster = searchParams.get("cluster");
  const initialTab = searchParams.get("tab");

  const [tab, setTab] = useState<TabId>(() =>
    initialTab !== null && TAB_IDS.includes(initialTab)
      ? (initialTab as TabId)
      : "overview",
  );

  const [filters, setFilters] = useState<ContentFilters>(() => ({
    ...EMPTY_CONTENT_FILTERS,
    project:
      initialProject !== null &&
      projects.some((project) => project.id === initialProject)
        ? initialProject
        : "all",
    cluster:
      initialCluster !== null &&
      clusterOptions.some((cluster) => cluster.id === initialCluster)
        ? initialCluster
        : "all",
  }));

  const [sort, setSort] = useState<{ key: ContentSort; desc: boolean }>({
    key: "score",
    desc: false,
  });

  const [advanced, setAdvanced] = useState(
    initialProject !== null || initialCluster !== null,
  );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);

  const [stageMoves, setStageMoves] = useState<Record<string, ContentStage>>({});
  const [owners, setOwners] = useState<Record<string, AgentId>>({});
  const [refreshQueued, setRefreshQueued] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [reviewed, setReviewed] = useState<ReadonlySet<string>>(new Set());

  const [recommendationStates, setRecommendationStates] = useState<
    Record<string, RecommendationState>
  >({});
  const [linkStates, setLinkStates] = useState<Record<string, LinkState>>({});
  const [gapStates, setGapStates] = useState<Record<string, GapState>>({});

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
   * Bulk changes are applied here rather than held beside the data, so a moved
   * stage or a reassigned owner shows up everywhere that reads a piece — the
   * board, the briefs, the coverage counts — rather than only in the place the
   * change was made.
   */
  const sessionRecords = useMemo(() => {
    const hasChanges =
      Object.keys(stageMoves).length > 0 ||
      Object.keys(owners).length > 0 ||
      refreshQueued.size > 0;

    if (!hasChanges) return records;

    return records.map((record) => {
      const stage = stageMoves[record.id];
      const owner = owners[record.id];
      const queued = refreshQueued.has(record.id);

      if (stage === undefined && owner === undefined && !queued) return record;

      return {
        ...record,
        // A live page keeps its published stage; a stage move against it is a
        // move of the rework queued on it, which is what the board shows.
        stage: record.url === null && stage !== undefined ? stage : record.stage,
        owner: owner ?? record.owner,
        refresh:
          record.url !== null && (queued || record.refresh)
            ? {
                stage:
                  stage !== undefined && stage !== "published"
                    ? stage
                    : (record.refresh?.stage ?? "idea"),
                reason:
                  record.refresh?.reason ??
                  "Queued for rework in this session.",
                owner: owner ?? record.refresh?.owner ?? "content-strategist",
                dueAt: record.refresh?.dueAt ?? record.updatedAt,
              }
            : record.refresh,
      } satisfies ContentRecord;
    });
  }, [records, stageMoves, owners, refreshQueued]);

  const filtered = useMemo(
    () =>
      sessionRecords
        .filter((record) => matchesContentFilters(record, filters))
        .sort((a, b) => compareContent(a, b, sort)),
    [sessionRecords, filters, sort],
  );

  const filteredIds = useMemo(
    () => new Set(filtered.map((record) => record.id)),
    [filtered],
  );

  const stageCounts = useMemo(() => {
    const base = sessionRecords.filter((record) =>
      matchesContentFilters(record, { ...filters, stage: "all" }),
    );
    const tally: Record<string, number> = {
      all: base.length,
      "in-progress": base.filter(
        (record) => record.stage !== "published" || record.refresh !== null,
      ).length,
    };
    // Counted the same way the filter matches: a live page with rework queued
    // against it belongs to both its own stage and the refresh's, so a board
    // column and this control never disagree about how many are there.
    for (const record of base) {
      tally[record.stage] = (tally[record.stage] ?? 0) + 1;
      if (record.refresh) {
        tally[record.refresh.stage] = (tally[record.refresh.stage] ?? 0) + 1;
      }
    }
    return tally;
  }, [sessionRecords, filters]);

  /**
   * Which agents actually own content in this selection.
   *
   * Five of the twelve never own a page — the Director, the Project Manager,
   * Market Intelligence, Authority, and Analytics work at a level above a
   * single piece — so offering them in the filter would be offering five
   * controls that select nothing.
   */
  const ownerCounts = useMemo(() => {
    const base = sessionRecords.filter((record) =>
      matchesContentFilters(record, { ...filters, owner: "all" }),
    );
    const tally: Record<string, number> = {};
    for (const record of base) {
      tally[record.owner] = (tally[record.owner] ?? 0) + 1;
    }
    return tally;
  }, [sessionRecords, filters]);

  // Paging is 1-based and the set changes under it; clamping on read avoids an
  // effect that would cost an extra render pass on every filter change.
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRecords = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  const metrics = useMemo(() => getContentMetrics(filtered), [filtered]);
  const health = useMemo(() => getHealthDistribution(filtered), [filtered]);
  const formats = useMemo(() => getFormatBreakdown(filtered), [filtered]);
  const board = useMemo(() => getWorkflowBoard(filtered), [filtered]);
  const intents = useMemo(() => getIntentAlignment(filtered), [filtered]);

  const briefs = useMemo(
    () =>
      getActiveBriefs().filter((brief) => filteredIds.has(brief.contentId)),
    [filteredIds],
  );

  const mapping = useMemo(
    () =>
      getKeywordMapping().filter(
        (row) => row.contentId === null || filteredIds.has(row.contentId),
      ),
    [filteredIds],
  );

  const unmappedPages = useMemo(
    () => getUnmappedPages().filter((record) => filteredIds.has(record.id)),
    [filteredIds],
  );

  const coverage = useMemo(() => {
    const clusters = new Set(filtered.map((record) => record.clusterId));
    return getClusterCoverage().filter((row) => clusters.has(row.clusterId));
  }, [filtered]);

  const recommendations = useMemo(
    () =>
      getRecommendations().filter((entry) => filteredIds.has(entry.contentId)),
    [filteredIds],
  );

  const links = useMemo(
    () =>
      getLinkOpportunities().filter(
        (entry) => filteredIds.has(entry.fromId) || filteredIds.has(entry.toId),
      ),
    [filteredIds],
  );

  const orphans = useMemo(
    () => getOrphanPages().filter((record) => filteredIds.has(record.id)),
    [filteredIds],
  );

  const gaps = useMemo(
    () =>
      getContentGapOpportunities().filter(
        (gap) =>
          gap.contentId === null ||
          filteredIds.has(gap.contentId) ||
          filtered.some((record) => record.clusterId === gap.clusterId),
      ),
    [filteredIds, filtered],
  );

  const attention = useMemo(
    () =>
      filtered
        .filter(
          (record) =>
            record.url !== null && ATTENTION_HEALTH.includes(record.health),
        )
        .sort((a, b) => a.score.score - b.score.score),
    [filtered],
  );

  const recent = useMemo(
    () =>
      filtered
        .filter((record) => {
          if (record.publishedAt === null) return false;
          const days =
            (Date.parse(CONTENT_AS_OF) - Date.parse(record.publishedAt)) /
            86_400_000;
          return days <= RECENTLY_PUBLISHED_DAYS;
        })
        .sort(
          (a, b) =>
            Date.parse(b.publishedAt as string) -
            Date.parse(a.publishedAt as string),
        ),
    [filtered],
  );

  // ---------------------------------------------------------------------
  // Interactions
  // ---------------------------------------------------------------------

  const changeFilters = (patch: Partial<ContentFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  const resetFilters = () => {
    setFilters(EMPTY_CONTENT_FILTERS);
    setPage(1);
  };

  const changeSort = (key: ContentSort) =>
    setSort((current) =>
      current.key === key
        ? { key, desc: !current.desc }
        : {
            key,
            desc:
              CONTENT_SORT_OPTIONS.find((option) => option.value === key)
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

  const moveStage = (stage: ContentStage) => {
    setStageMoves((current) => {
      const next = { ...current };
      for (const id of selectedIds) next[id] = stage;
      return next;
    });
    announce(
      `Moved ${selectedIds.length} ${selectedIds.length === 1 ? "piece" : "pieces"} to ${STAGE_META[stage].label.toLowerCase()}. Session state only — nothing was published.`,
    );
  };

  const assignAgent = (agent: AgentId) => {
    setOwners((current) => {
      const next = { ...current };
      for (const id of selectedIds) next[id] = agent;
      return next;
    });
    announce(
      `Assigned ${selectedIds.length} ${selectedIds.length === 1 ? "piece" : "pieces"} to ${AGENT_NAMES[agent]}. Session state only — no task was created.`,
    );
  };

  const queueRefresh = () => {
    const live = selectedIds.filter(
      (id) => records.find((record) => record.id === id)?.url !== null,
    );

    setRefreshQueued((current) => {
      const next = new Set(current);
      for (const id of live) next.add(id);
      return next;
    });

    announce(
      live.length === 0
        ? "Nothing selected is published, so there is nothing to refresh. Unpublished pieces move through the pipeline instead."
        : `Queued a refresh on ${live.length} live ${live.length === 1 ? "page" : "pages"}. Session state only.`,
    );
  };

  const markReviewed = () => {
    setReviewed((current) => {
      const next = new Set(current);
      for (const id of selectedIds) next.add(id);
      return next;
    });
    announce(
      `Marked ${selectedIds.length} ${selectedIds.length === 1 ? "piece" : "pieces"} reviewed.`,
    );
  };

  const prepareExport = () => {
    announce(
      `${selectedIds.length} ${selectedIds.length === 1 ? "piece is" : "pieces are"} ready to export. Export runs once a backend exists — nothing was written.`,
    );
  };

  const openInventoryAtStage = (stage: ContentStage) => {
    changeFilters({ stage });
    setAdvanced(false);
    setTab("inventory");
  };

  const scopeName =
    filters.project === "all"
      ? "every project"
      : (projects.find((project) => project.id === filters.project)?.name ??
        "every project");

  const counts: Partial<Record<TabId, number>> = {
    inventory: filtered.length,
    pipeline: board.reduce((carry, column) => carry + column.items.length, 0),
    briefs: briefs.length,
    mapping: mapping.length,
    coverage: coverage.length,
    onpage: recommendations.length,
    links: links.length,
    gaps: gaps.length,
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        size="page"
        title="Content Studio"
        description={`Every page across ${scopeName}: what exists, what it is worth, what is wrong with it, and what has to be written next.`}
        actions={
          <>
            <span className="hidden items-center gap-1.5 text-[11.5px] text-fg-subtle lg:inline-flex">
              <Icon name="clock" className="h-3.5 w-3.5" />
              Updated {formatFullDate(CONTENT_AS_OF)},{" "}
              {formatTimeUtc(CONTENT_AS_OF)}
            </span>
            <Button icon="workflow" onClick={() => setTab("pipeline")}>
              Production board
            </Button>
            <Button
              variant="primary"
              icon="target"
              onClick={() => setTab("gaps")}
            >
              Commission content
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

      <ContentSummary
        metrics={metrics}
        health={health}
        formats={formats}
        total={records.length}
        filtered={filtered.length}
      />

      <Panel>
        <ContentToolbar
          filters={filters}
          onFilterChange={changeFilters}
          onReset={resetFilters}
          stageCounts={stageCounts}
          ownerCounts={ownerCounts}
          sort={sort}
          onSortChange={changeSort}
          projects={projects}
          clusters={clusterOptions}
          advanced={advanced}
          onToggleAdvanced={() => setAdvanced((value) => !value)}
          total={records.length}
          shown={filtered.length}
        />
        <PanelFooter>
          <span>
            Filters apply to every view below — the board, the briefs, the
            coverage, the findings, and the answer-engine layer all describe the{" "}
            {filtered.length} pieces selected here.
          </span>
          <span>
            Mock data over the {CONTENT_RANGE_CAPTION.toLowerCase()}
          </span>
        </PanelFooter>
      </Panel>

      <TabList
        tabs={TABS}
        value={tab}
        onChange={setTab}
        label="Content Studio sections"
        idPrefix="content"
        counts={counts}
      />

      <div
        role="tabpanel"
        id={tabPanelDomId("content", tab)}
        aria-labelledby={tabDomId("content", tab)}
        tabIndex={0}
        className="space-y-4 focus-visible:outline-none"
      >
        {tab === "overview" && (
          <OverviewView
            board={board}
            attention={attention}
            gaps={gaps}
            recent={recent}
            onOpenTab={(next) => setTab(next)}
          />
        )}

        {tab === "inventory" && (
          <Panel>
            <ContentBulkActions
              count={selected.size}
              onClear={() => setSelected(new Set())}
              onMoveStage={moveStage}
              onAssignAgent={assignAgent}
              onQueueRefresh={queueRefresh}
              onMarkReviewed={markReviewed}
              onExport={prepareExport}
              notice={notice}
            />

            {pageRecords.length === 0 ? (
              <EmptyState
                icon="search"
                title="No content matches these filters"
                description="Nothing in the inventory matches the current search and filter combination."
                action={
                  hasActiveContentFilters(filters) ? (
                    <Button icon="close" onClick={resetFilters}>
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <ContentTable
                records={pageRecords}
                sort={sort}
                onSort={changeSort}
                selected={selected}
                onToggle={toggleSelection}
                onToggleAll={toggleAll}
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
              noun="pieces"
            />
          </Panel>
        )}

        {tab === "pipeline" && (
          <WorkflowBoard
            columns={board}
            referenceIso={CONTENT_AS_OF}
            onOpenInventory={openInventoryAtStage}
          />
        )}

        {tab === "briefs" && (
          <BriefsView briefs={briefs} onOpenGaps={() => setTab("gaps")} />
        )}

        {tab === "mapping" && (
          <MappingView
            rows={mapping}
            unmappedPages={unmappedPages}
            onOpenUnmapped={() => {
              changeFilters({ flag: "unmapped" });
              setAdvanced(true);
              setTab("inventory");
            }}
          />
        )}

        {tab === "coverage" && (
          <CoverageView
            rows={coverage}
            projects={projects}
            projectFilter={filters.project}
            onProjectChange={(project) => changeFilters({ project })}
          />
        )}

        {tab === "intent" && (
          <IntentView rows={intents} records={filtered} />
        )}

        {tab === "onpage" && (
          <RecommendationsView
            recommendations={recommendations}
            states={recommendationStates}
            onAct={(id, state) =>
              setRecommendationStates((current) => ({
                ...current,
                [id]: state,
              }))
            }
          />
        )}

        {tab === "aeo" && <AeoView records={filtered} />}

        {tab === "links" && (
          <LinksView
            opportunities={links}
            orphans={orphans}
            states={linkStates}
            onAct={(id, state) =>
              setLinkStates((current) => ({ ...current, [id]: state }))
            }
            onOpenOrphans={() => {
              changeFilters({ flag: "orphan" });
              setAdvanced(true);
              setTab("inventory");
            }}
          />
        )}

        {tab === "gaps" && (
          <GapsView
            gaps={gaps}
            states={gapStates}
            onAct={(id, state) =>
              setGapStates((current) => ({ ...current, [id]: state }))
            }
          />
        )}
      </div>
    </div>
  );
}
