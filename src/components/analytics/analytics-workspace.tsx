"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Icon, type IconName } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { MetricTileGrid } from "@/components/ui/metric-tile";
import { Panel, PanelFooter } from "@/components/ui/panel";
import { SectionHeader } from "@/components/ui/section-header";
import { Segmented } from "@/components/ui/segmented";
import { TabList, tabDomId, tabPanelDomId } from "@/components/ui/tab-list";
import { Toolbar, ToolbarSpacer } from "@/components/ui/toolbar";
import { formatFullDate, formatTimeUtc } from "@/lib/format";
import { Pagination } from "@/components/keywords/pagination";
import { PerformanceChart } from "@/components/dashboard/performance-chart";
import {
  ANALYTICS_AS_OF,
  ANALYTICS_SOURCE_SHORT,
  SEGMENT_META,
  SEGMENT_ORDER,
  getAnalyticsOverview,
  getAnalyticsProjectOptions,
  getAttribution,
  getPagePerformance,
  getSegments,
} from "@/lib/mock/analytics";
import { getKeywordList } from "@/lib/mock/keywords";
import { AnomaliesView, LearningsView } from "@/components/analytics/insight-views";
import { OverviewView } from "@/components/analytics/overview-view";
import {
  AttributionTable,
  PagesTable,
  SegmentsTable,
} from "@/components/analytics/tables";
import {
  AnalyticsToolbar,
  SortControl,
  type AnalyticsFilterCounts,
} from "@/components/analytics/analytics-toolbar";
import {
  EMPTY_ANALYTICS_FILTERS,
  matchesAnomaly,
  matchesAttribution,
  matchesLearning,
  matchesPage,
  matchesSegment,
  type AnalyticsFilters,
} from "@/components/analytics/filters";
import {
  ATTRIBUTION_SORT_OPTIONS,
  PAGE_SORT_OPTIONS,
  SEGMENT_SORT_OPTIONS,
  compareAttribution,
  comparePages,
  compareSegments,
  type AttributionSort,
  type PageSort,
  type SegmentSort,
} from "@/components/analytics/sorting";
import type { RangeId, SegmentDimension } from "@/types/analytics";

/**
 * The Analytics workspace.
 *
 * Owns every piece of state that has to survive a tab change: the project, the
 * window, the filters, the three sorts and the page. The views below are
 * presentational — one that owned its own state would lose it the moment the
 * window changed.
 *
 * Project and range are the selection rather than a filter over it: changing
 * either rebuilds the series everything else is read from, which is why they
 * sit at the top of the toolbar and not inside the filter drawer.
 *
 * A client component because the whole screen is interactive. The data comes
 * from pure, deterministic builders, so the server render and the first client
 * render produce identical markup.
 */

const TABS = [
  { id: "overview", label: "Overview", icon: "command-center" },
  { id: "trends", label: "Trends", icon: "analytics" },
  { id: "segments", label: "Segments", icon: "layers" },
  { id: "pages", label: "Pages", icon: "pages" },
  { id: "attribution", label: "Attribution", icon: "workflow" },
  { id: "anomalies", label: "Movements", icon: "alert" },
  { id: "learnings", label: "Learnings", icon: "sparkles" },
] as const satisfies readonly {
  id: string;
  label: string;
  icon: IconName;
}[];

type TabId = (typeof TABS)[number]["id"];

const TAB_IDS: readonly string[] = TABS.map((tab) => tab.id);
const RANGE_IDS: readonly string[] = ["7d", "30d", "3m", "6m", "12m"];

export function AnalyticsWorkspace() {
  const searchParams = useSearchParams();
  const projects = getAnalyticsProjectOptions();

  // Deep links from the Command Center or a project arrive as query
  // parameters. They seed the initial state and nothing more — changing a
  // control afterwards must not fight the URL.
  const initialProject = searchParams.get("project");
  const initialRange = searchParams.get("range");
  const initialTab = searchParams.get("tab");

  const [tab, setTab] = useState<TabId>(() =>
    initialTab !== null && TAB_IDS.includes(initialTab)
      ? (initialTab as TabId)
      : "overview",
  );

  const [projectId, setProjectId] = useState<string>(() =>
    initialProject !== null &&
    projects.some((project) => project.id === initialProject)
      ? initialProject
      : "portfolio",
  );

  const [rangeId, setRangeId] = useState<RangeId>(() =>
    initialRange !== null && RANGE_IDS.includes(initialRange)
      ? (initialRange as RangeId)
      : "30d",
  );

  const [dimension, setDimension] = useState<SegmentDimension>("cluster");
  const [filters, setFilters] = useState<AnalyticsFilters>(
    EMPTY_ANALYTICS_FILTERS,
  );

  const [pageSort, setPageSort] = useState<{ key: PageSort; desc: boolean }>({
    key: "traffic",
    desc: true,
  });
  const [segmentSort, setSegmentSort] = useState<{
    key: SegmentSort;
    desc: boolean;
  }>({ key: "traffic", desc: true });
  const [attributionSort, setAttributionSort] = useState<{
    key: AttributionSort;
    desc: boolean;
  }>({ key: "association", desc: true });

  const [advanced, setAdvanced] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // ---------------------------------------------------------------------
  // The selection
  // ---------------------------------------------------------------------

  const overview = useMemo(
    () => getAnalyticsOverview(projectId, rangeId, dimension),
    [projectId, rangeId, dimension],
  );

  const scoped = useMemo(
    () =>
      new Set(
        projectId === "portfolio"
          ? projects.map((project) => project.id)
          : [projectId],
      ),
    [projectId, projects],
  );

  const allPages = useMemo(
    () => getPagePerformance().filter((entry) => scoped.has(entry.projectId)),
    [scoped],
  );

  const allSegments = useMemo(
    () =>
      getSegments(
        getKeywordList().filter((record) => scoped.has(record.projectId)),
        dimension,
      ),
    [scoped, dimension],
  );

  const filteredPages = useMemo(
    () =>
      allPages
        .filter((entry) => matchesPage(entry, filters))
        .sort((a, b) => comparePages(a, b, pageSort)),
    [allPages, filters, pageSort],
  );

  const filteredSegments = useMemo(
    () =>
      allSegments
        .filter((row) => matchesSegment(row, filters))
        .sort((a, b) => compareSegments(a, b, segmentSort)),
    [allSegments, filters, segmentSort],
  );

  const filteredAttribution = useMemo(
    () =>
      getFullAttribution(scoped)
        .filter((entry) => matchesAttribution(entry, filters))
        .sort((a, b) => compareAttribution(a, b, attributionSort)),
    [scoped, filters, attributionSort],
  );

  const filteredAnomalies = useMemo(
    () => overview.anomalies.filter((entry) => matchesAnomaly(entry, filters)),
    [overview.anomalies, filters],
  );

  const filteredLearnings = useMemo(
    () => overview.learnings.filter((entry) => matchesLearning(entry, filters)),
    [overview.learnings, filters],
  );

  /**
   * Counts behind each filter option.
   *
   * Each set is counted with its own filter released, so an option always
   * reports how many records it would select if chosen — not how many are
   * already showing, which would read zero for every option but the active one.
   */
  const counts: AnalyticsFilterCounts = useMemo(() => {
    const tally = (values: readonly string[]): Record<string, number> => {
      const result: Record<string, number> = {};
      for (const value of values) result[value] = (result[value] ?? 0) + 1;
      return result;
    };

    const attribution = getFullAttribution(scoped);

    return {
      pageState: tally(
        allPages
          .filter((entry) =>
            matchesPage(entry, { ...filters, pageState: "all" }),
          )
          .map((entry) => entry.state),
      ),
      workKind: tally(attribution.map((entry) => entry.kind)),
      anomalyKind: tally(overview.anomalies.map((entry) => entry.kind)),
      verdict: tally(overview.learnings.map((entry) => entry.verdict)),
      confidence: tally([
        ...attribution.map((entry) => entry.confidence),
        ...overview.anomalies.map((entry) => entry.confidence),
      ]),
      significance: tally(
        overview.anomalies.map((entry) => entry.significance),
      ),
      headroom: allPages.filter((entry) => entry.headroom > 0).length,
      total: filteredPages.length,
    };
  }, [allPages, scoped, filters, overview, filteredPages.length]);

  // ---------------------------------------------------------------------
  // Interaction
  // ---------------------------------------------------------------------

  const changeFilters = (patch: Partial<AnalyticsFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  const resetFilters = () => {
    setFilters(EMPTY_ANALYTICS_FILTERS);
    setPage(1);
  };

  const changeTab = (next: TabId) => {
    setTab(next);
    setPage(1);
  };

  const scopeName =
    projectId === "portfolio"
      ? "the portfolio"
      : (projects.find((project) => project.id === projectId)?.name ??
        "the portfolio");

  const tabCounts: Partial<Record<TabId, number>> = {
    segments: filteredSegments.length,
    pages: filteredPages.length,
    attribution: filteredAttribution.length,
    anomalies: filteredAnomalies.length,
    learnings: filteredLearnings.length,
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
  const segmentsPage = paged(filteredSegments);
  const attributionPage = paged(filteredAttribution);

  const sortControl =
    tab === "pages" ? (
      <SortControl
        value={pageSort.key}
        desc={pageSort.desc}
        onChange={(key, desc) => setPageSort({ key, desc })}
        options={PAGE_SORT_OPTIONS}
        label="Sort pages"
      />
    ) : tab === "segments" ? (
      <SortControl
        value={segmentSort.key}
        desc={segmentSort.desc}
        onChange={(key, desc) => setSegmentSort({ key, desc })}
        options={SEGMENT_SORT_OPTIONS}
        label="Sort segments"
      />
    ) : tab === "attribution" ? (
      <SortControl
        value={attributionSort.key}
        desc={attributionSort.desc}
        onChange={(key, desc) => setAttributionSort({ key, desc })}
        options={ATTRIBUTION_SORT_OPTIONS}
        label="Sort attribution"
      />
    ) : undefined;

  return (
    <div className="space-y-6">
      <SectionHeader
        size="page"
        title="Analytics"
        description={`What ${scopeName} did over the ${overview.series.range.caption.toLowerCase()} — what moved, where the room is, and what the evidence supports doing next.`}
        actions={
          <>
            <span className="hidden items-center gap-1.5 text-[11.5px] text-fg-subtle lg:inline-flex">
              <Icon name="clock" className="h-3.5 w-3.5" />
              Updated {formatFullDate(ANALYTICS_AS_OF)},{" "}
              {formatTimeUtc(ANALYTICS_AS_OF)}
            </span>
            <Button icon="alert" onClick={() => changeTab("anomalies")}>
              Movements
            </Button>
            <Button
              variant="primary"
              icon="sparkles"
              onClick={() => changeTab("learnings")}
            >
              Learnings
            </Button>
          </>
        }
      />

      <MetricTileGrid metrics={overview.metrics} />

      <Panel>
        <AnalyticsToolbar
          filters={filters}
          onFilterChange={changeFilters}
          onReset={resetFilters}
          counts={counts}
          sortControl={sortControl}
          projects={projects}
          projectId={projectId}
          onProjectChange={(next) => {
            setProjectId(next);
            setPage(1);
          }}
          rangeId={rangeId}
          onRangeChange={(next) => {
            setRangeId(next);
            setPage(1);
          }}
          advanced={advanced}
          onToggleAdvanced={() => setAdvanced((value) => !value)}
          total={allPages.length}
          shown={filteredPages.length}
          noun="pages"
        />
        <PanelFooter>
          <span>
            The project and window above rebuild every figure on this screen.
            Filters narrow what is shown within them.
          </span>
          <span>{ANALYTICS_SOURCE_SHORT}</span>
        </PanelFooter>
      </Panel>

      <TabList
        tabs={TABS}
        value={tab}
        onChange={changeTab}
        label="Analytics sections"
        idPrefix="analytics"
        counts={tabCounts}
      />

      <div
        role="tabpanel"
        id={tabPanelDomId("analytics", tab)}
        aria-labelledby={tabDomId("analytics", tab)}
        tabIndex={0}
        className="space-y-4 focus-visible:outline-none"
      >
        {tab === "overview" && (
          <OverviewView
            overview={overview}
            onOpenTab={(next) => changeTab(next as TabId)}
          />
        )}

        {tab === "trends" && (
          <>
            {/* The Command Center's own chart, reading the same series. Two
                charts over one dataset would be two places for it to drift. */}
            <PerformanceChart
              trend={overview.series}
              range={rangeId}
              onRangeChange={(next) => {
                setRangeId(next);
                setPage(1);
              }}
              loading={false}
            />
            <Panel>
              <PanelFooter>
                <span>
                  The same series the Command Center plots, for{" "}
                  {overview.series.projectIds.length}{" "}
                  {overview.series.projectIds.length === 1
                    ? "project"
                    : "projects"}
                  . Search visibility is an index, so it is averaged across
                  projects rather than summed.
                </span>
              </PanelFooter>
            </Panel>
          </>
        )}

        {tab === "segments" && (
          <Panel>
            <Toolbar label="Choose the segment dimension" className="gap-x-3">
              <Segmented
                label="Segment dimension"
                value={dimension}
                onChange={(next) => {
                  setDimension(next);
                  setPage(1);
                }}
                options={SEGMENT_ORDER.map((entry) => ({
                  value: entry,
                  label: SEGMENT_META[entry].label,
                  title: SEGMENT_META[entry].description,
                }))}
              />
              <ToolbarSpacer />
              <p className="text-[11.5px] text-fg-subtle md:whitespace-nowrap">
                Cut by dimensions this product owns — there is no channel or
                device split, because nothing here measures one.
              </p>
            </Toolbar>
            <SegmentsTable rows={segmentsPage.rows} />
            {filteredSegments.length > pageSize && (
              <Pagination
                page={segmentsPage.current}
                pageSize={pageSize}
                total={filteredSegments.length}
                onPageChange={setPage}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
                noun="segments"
              />
            )}
          </Panel>
        )}

        {tab === "pages" && (
          <Panel>
            <PagesTable pages={pagesPage.rows} />
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

        {tab === "attribution" && (
          <Panel>
            <AttributionTable records={attributionPage.rows} />
            {filteredAttribution.length > pageSize && (
              <Pagination
                page={attributionPage.current}
                pageSize={pageSize}
                total={filteredAttribution.length}
                onPageChange={setPage}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
                noun="records"
              />
            )}
          </Panel>
        )}

        {tab === "anomalies" && <AnomaliesView anomalies={filteredAnomalies} />}

        {tab === "learnings" && <LearningsView learnings={filteredLearnings} />}
      </div>
    </div>
  );
}

/** Every attribution record in scope, before the filters narrow it. */
function getFullAttribution(scoped: ReadonlySet<string>) {
  return getAttribution().filter((entry) => scoped.has(entry.projectId));
}
