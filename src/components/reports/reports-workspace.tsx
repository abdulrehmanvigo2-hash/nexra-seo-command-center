"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Icon, type IconName } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { MetricTileGrid } from "@/components/ui/metric-tile";
import { Panel, PanelFooter } from "@/components/ui/panel";
import { SectionHeader } from "@/components/ui/section-header";
import { cn } from "@/lib/cn";
import { formatFullDate, formatTimeUtc } from "@/lib/format";
import { Pagination } from "@/components/keywords/pagination";
import {
  DELIVERY_NOTE_SHORT,
  REPORTS_AS_OF,
  REPORTS_SOURCE_SHORT,
  getReportMetrics,
  getReportProjectOptions,
  getReportTemplates,
  getReportsOverview,
} from "@/lib/mock/reports";
import { OverviewView } from "@/components/reports/overview-view";
import { TemplatesView } from "@/components/reports/template-views";
import {
  CoverageTable,
  LibraryTable,
  ScheduleTable,
} from "@/components/reports/tables";
import {
  ReportsToolbar,
  SortControl,
  type ReportFilterCounts,
} from "@/components/reports/reports-toolbar";
import {
  EMPTY_REPORT_FILTERS,
  isOutstanding,
  matchesCoverage,
  matchesReport,
  matchesSchedule,
  matchesTemplate,
  type ReportFilters,
} from "@/components/reports/filters";
import {
  COVERAGE_SORT_OPTIONS,
  REPORT_SORT_OPTIONS,
  compareCoverage,
  compareReports,
  type CoverageSort,
  type ReportSort,
} from "@/components/reports/sorting";

/**
 * The Reports workspace.
 *
 * Owns every piece of state that has to survive a tab change: the project, the
 * filters, the two sorts and the page. The views below are presentational —
 * one that owned its own state would lose it the moment the project changed.
 *
 * The project is the selection rather than a filter over it: changing it
 * rebuilds every count on the screen, which is why it sits at the top of the
 * toolbar and not inside the filter drawer. There is no window control, and
 * deliberately so — a report's window is its period, fixed on the cover.
 *
 * A client component because the whole screen is interactive. The data comes
 * from pure, deterministic builders, so the server render and the first client
 * render produce identical markup.
 */

const TABS = [
  { id: "overview", label: "Overview", icon: "command-center" },
  { id: "library", label: "Library", icon: "rows" },
  { id: "schedule", label: "Schedule", icon: "calendar" },
  { id: "templates", label: "Templates", icon: "reports" },
  { id: "coverage", label: "Coverage", icon: "projects" },
] as const satisfies readonly {
  id: string;
  label: string;
  icon: IconName;
}[];

type TabId = (typeof TABS)[number]["id"];

const TAB_IDS: readonly string[] = TABS.map((tab) => tab.id);

export function ReportsWorkspace() {
  const searchParams = useSearchParams();
  const projects = getReportProjectOptions();
  const templates = getReportTemplates();

  // Deep links from the Command Center or a project arrive as query
  // parameters. They seed the initial state and nothing more — changing a
  // control afterwards must not fight the URL.
  const initialProject = searchParams.get("project");
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

  const [filters, setFilters] = useState<ReportFilters>(EMPTY_REPORT_FILTERS);

  const [reportSort, setReportSort] = useState<{
    key: ReportSort;
    desc: boolean;
  }>({ key: "priority", desc: true });

  const [coverageSort, setCoverageSort] = useState<{
    key: CoverageSort;
    desc: boolean;
  }>({ key: "overdue", desc: true });

  const [advanced, setAdvanced] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const tablistRef = useRef<HTMLDivElement>(null);

  // ---------------------------------------------------------------------
  // The selection
  // ---------------------------------------------------------------------

  const overview = useMemo(() => getReportsOverview(projectId), [projectId]);
  const metrics = useMemo(() => getReportMetrics(overview), [overview]);

  const filteredReports = useMemo(
    () =>
      overview.reports
        .filter((report) => matchesReport(report, filters))
        .sort((a, b) => compareReports(a, b, reportSort)),
    [overview.reports, filters, reportSort],
  );

  const filteredSchedules = useMemo(
    () =>
      overview.schedules.filter((schedule) =>
        matchesSchedule(schedule, filters),
      ),
    [overview.schedules, filters],
  );

  const filteredTemplates = useMemo(
    () => templates.filter((entry) => matchesTemplate(entry, filters)),
    [templates, filters],
  );

  const filteredCoverage = useMemo(
    () =>
      overview.coverage
        .filter((row) => matchesCoverage(row, filters))
        .sort((a, b) => compareCoverage(a, b, coverageSort)),
    [overview.coverage, filters, coverageSort],
  );

  /**
   * Counts behind each filter option.
   *
   * Each set is counted with its own filter released, so an option always
   * reports how many records it would select if chosen — not how many are
   * already showing, which would read zero for every option but the active one.
   */
  const counts: ReportFilterCounts = useMemo(() => {
    const tally = (values: readonly string[]): Record<string, number> => {
      const result: Record<string, number> = {};
      for (const value of values) result[value] = (result[value] ?? 0) + 1;
      return result;
    };

    const without = (key: keyof ReportFilters) =>
      overview.reports.filter((report) =>
        matchesReport(report, { ...filters, [key]: "all" }),
      );

    return {
      status: tally(without("status").map((report) => report.status)),
      band: tally(without("band").map((report) => report.band)),
      audience: tally(without("audience").map((report) => report.audience)),
      cadence: tally(
        without("cadence").map((report) => report.period.cadence),
      ),
      template: tally(
        without("templateId").map((report) => report.templateId),
      ),
      outstanding: overview.reports.filter(isOutstanding).length,
      total: filteredReports.length,
    };
  }, [overview.reports, filters, filteredReports.length]);

  // ---------------------------------------------------------------------
  // Interaction
  // ---------------------------------------------------------------------

  const changeFilters = (patch: Partial<ReportFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  const resetFilters = () => {
    setFilters(EMPTY_REPORT_FILTERS);
    setPage(1);
  };

  const changeTab = (next: TabId) => {
    setTab(next);
    setPage(1);
  };

  /** Roving tab focus: Arrow keys move, Home and End jump to the ends. */
  const handleTabKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = TABS.findIndex((entry) => entry.id === tab);
    let next = index;

    if (event.key === "ArrowRight") next = (index + 1) % TABS.length;
    else if (event.key === "ArrowLeft")
      next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = TABS.length - 1;
    else return;

    event.preventDefault();
    changeTab(TABS[next].id);
    tablistRef.current?.querySelectorAll("button")[next]?.focus();
  };

  const scopeName =
    projectId === "portfolio"
      ? "every account"
      : (projects.find((project) => project.id === projectId)?.name ??
        "every account");

  const tabCounts: Partial<Record<TabId, number>> = {
    library: filteredReports.length,
    schedule: filteredSchedules.length,
    templates: filteredTemplates.length,
    coverage: filteredCoverage.length,
  };

  // Paging is 1-based and the set changes under it; clamping on read avoids an
  // effect that would cost an extra render pass on every filter change.
  const pageCount = Math.max(1, Math.ceil(filteredReports.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pagedReports = filteredReports.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  const templateUsage = useMemo(() => {
    const result: Record<string, number> = {};
    for (const report of overview.reports) {
      result[report.templateId] = (result[report.templateId] ?? 0) + 1;
    }
    return result;
  }, [overview.reports]);

  const sortControl =
    tab === "library" ? (
      <SortControl
        value={reportSort.key}
        desc={reportSort.desc}
        onChange={(key, desc) => setReportSort({ key, desc })}
        options={REPORT_SORT_OPTIONS}
        label="Sort reports"
      />
    ) : tab === "coverage" ? (
      <SortControl
        value={coverageSort.key}
        desc={coverageSort.desc}
        onChange={(key, desc) => setCoverageSort({ key, desc })}
        options={COVERAGE_SORT_OPTIONS}
        label="Sort projects"
      />
    ) : undefined;

  return (
    <div className="space-y-6">
      <SectionHeader
        size="page"
        title="Reports"
        description={`Client-ready reporting for ${scopeName} — what is due, how complete it is, what each figure was quoted from, and the file to send.`}
        actions={
          <>
            <span className="hidden items-center gap-1.5 text-[11.5px] text-fg-subtle lg:inline-flex">
              <Icon name="clock" className="h-3.5 w-3.5" />
              Updated {formatFullDate(REPORTS_AS_OF)},{" "}
              {formatTimeUtc(REPORTS_AS_OF)}
            </span>
            <Button icon="calendar" onClick={() => changeTab("schedule")}>
              Schedule
            </Button>
            <Button
              variant="primary"
              icon="rows"
              onClick={() => changeTab("library")}
            >
              Library
            </Button>
          </>
        }
      />

      <MetricTileGrid metrics={metrics} />

      <Panel>
        <ReportsToolbar
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
          templates={templates}
          advanced={advanced}
          onToggleAdvanced={() => setAdvanced((value) => !value)}
          total={overview.reports.length}
          shown={filteredReports.length}
          noun="reports"
        />
        <PanelFooter>
          <span>
            The project above rebuilds every figure on this screen. Filters
            narrow what is shown within it.
          </span>
          <span>
            {REPORTS_SOURCE_SHORT} {DELIVERY_NOTE_SHORT}
          </span>
        </PanelFooter>
      </Panel>

      <div className="relative -mx-1 overflow-x-auto px-1">
        <div
          ref={tablistRef}
          role="tablist"
          aria-label="Reports sections"
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
                id={`reports-tab-${entry.id}`}
                aria-selected={isSelected}
                aria-controls={`reports-panel-${entry.id}`}
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
        id={`reports-panel-${tab}`}
        aria-labelledby={`reports-tab-${tab}`}
        tabIndex={0}
        className="space-y-4 focus-visible:outline-none"
      >
        {tab === "overview" && (
          <OverviewView
            overview={overview}
            onOpenTab={(next) => changeTab(next as TabId)}
          />
        )}

        {tab === "library" && (
          <Panel>
            <LibraryTable reports={pagedReports} />
            {filteredReports.length > pageSize && (
              <Pagination
                page={currentPage}
                pageSize={pageSize}
                total={filteredReports.length}
                onPageChange={setPage}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
                noun="reports"
              />
            )}
          </Panel>
        )}

        {tab === "schedule" && (
          <Panel>
            <ScheduleTable schedules={filteredSchedules} />
            <PanelFooter>
              <span>
                A schedule assembles a report and marks it ready. It does not
                send anything, and there is no control here that would.
              </span>
              <span>{DELIVERY_NOTE_SHORT}</span>
            </PanelFooter>
          </Panel>
        )}

        {tab === "templates" && (
          <TemplatesView templates={filteredTemplates} usage={templateUsage} />
        )}

        {tab === "coverage" && (
          <Panel>
            <CoverageTable rows={filteredCoverage} />
            <PanelFooter>
              <span>
                Every project on the roster appears here, including any with no
                reporting configured — that absence is the question this table
                exists to answer.
              </span>
            </PanelFooter>
          </Panel>
        )}
      </div>
    </div>
  );
}
