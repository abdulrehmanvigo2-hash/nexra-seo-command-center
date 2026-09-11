"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Icon, type IconName } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { MetricTileGrid } from "@/components/ui/metric-tile";
import { Panel, PanelFooter } from "@/components/ui/panel";
import { SectionHeader } from "@/components/ui/section-header";
import { cn } from "@/lib/cn";
import { formatFullDate, formatTimeUtc } from "@/lib/format";
import { Pagination } from "@/components/keywords/pagination";
import {
  TECHNICAL_AS_OF,
  TECHNICAL_RANGE_CAPTION,
  getTechnicalClusterOptions,
  getTechnicalIssues,
  getTechnicalOverview,
  getTechnicalPages,
  getTechnicalProjectOptions,
} from "@/lib/mock/technical";
import { CrawlView } from "@/components/technical/crawl-view";
import { IndexationView } from "@/components/technical/indexation-view";
import { IssuesView } from "@/components/technical/issues-view";
import { OverviewView } from "@/components/technical/overview-view";
import { PagesTable } from "@/components/technical/pages-table";
import {
  SortControl,
  TechnicalToolbar,
  type TechnicalFilterCounts,
} from "@/components/technical/technical-toolbar";
import {
  EMPTY_TECHNICAL_FILTERS,
  matchesIssue,
  matchesPage,
  scopeIssueToPages,
  type TechnicalFilters,
} from "@/components/technical/filters";
import {
  ISSUE_SORT_OPTIONS,
  PAGE_SORT_OPTIONS,
  compareIssues,
  comparePages,
  type IssueSort,
  type PageSort,
} from "@/components/technical/sorting";
import type { IssueStatus } from "@/types/technical";

/**
 * The Technical SEO workspace.
 *
 * Owns every piece of state that has to survive a tab change: the filters, the
 * two sorts, the page, and the triage recorded against findings. The views
 * below are presentational — one that owned its own state would lose it the
 * moment a filter changed.
 *
 * The filters are deliberately global. Narrowing to one project should narrow
 * the health score, the crawl reading, the coverage figures, the findings and
 * the page table with it, because all of those are readings of the same set.
 * The narrowing runs in a fixed order — pages first, then the findings that
 * still have a page behind them — which is what keeps a tab count and the
 * table it labels describing the same rows.
 *
 * A client component because the whole screen is interactive. The data comes
 * from pure, deterministic builders, so the server render and the first client
 * render produce identical markup.
 */

const TABS = [
  { id: "overview", label: "Overview", icon: "command-center" },
  { id: "issues", label: "Issues", icon: "alert" },
  { id: "crawlability", label: "Crawlability", icon: "refresh" },
  { id: "indexation", label: "Indexation", icon: "inbox" },
  { id: "pages", label: "Pages", icon: "pages" },
] as const satisfies readonly {
  id: string;
  label: string;
  icon: IconName;
}[];

type TabId = (typeof TABS)[number]["id"];

const TAB_IDS: readonly string[] = TABS.map((tab) => tab.id);

export function TechnicalSeo() {
  const searchParams = useSearchParams();

  const allPages = getTechnicalPages();
  const allIssues = getTechnicalIssues();
  const projects = getTechnicalProjectOptions();
  const clusters = getTechnicalClusterOptions();

  // Deep links from the Command Center or a project arrive as query
  // parameters. They seed the initial state and nothing more — changing a
  // filter afterwards must not fight the URL.
  const initialProject = searchParams.get("project");
  const initialTab = searchParams.get("tab");

  const [tab, setTab] = useState<TabId>(() =>
    initialTab !== null && TAB_IDS.includes(initialTab)
      ? (initialTab as TabId)
      : "overview",
  );

  const [filters, setFilters] = useState<TechnicalFilters>(() => ({
    ...EMPTY_TECHNICAL_FILTERS,
    project:
      initialProject !== null &&
      projects.some((project) => project.id === initialProject)
        ? initialProject
        : "all",
  }));

  const [pageSort, setPageSort] = useState<{ key: PageSort; desc: boolean }>({
    key: "score",
    desc: false,
  });
  const [issueSort, setIssueSort] = useState<{ key: IssueSort; desc: boolean }>(
    { key: "priority", desc: true },
  );

  const [advanced, setAdvanced] = useState(initialProject !== null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [statuses, setStatuses] = useState<Record<string, IssueStatus>>({});

  const tablistRef = useRef<HTMLDivElement>(null);

  // ---------------------------------------------------------------------
  // Narrowing
  // ---------------------------------------------------------------------

  /**
   * Pages carrying at least one finding in the selected category.
   *
   * A page holds no category of its own — a category is a property of the
   * findings against it — so without this, narrowing to "Metadata" would leave
   * the page table showing every page including the ones with no metadata
   * problem at all.
   */
  const categoryPageIds = useMemo(() => {
    if (filters.category === "all") return undefined;
    const ids = new Set<string>();
    for (const issue of allIssues) {
      if (issue.category !== filters.category) continue;
      for (const id of issue.pageIds) ids.add(id);
    }
    return ids;
  }, [allIssues, filters.category]);

  const filteredPages = useMemo(
    () =>
      allPages
        .filter((entry) => matchesPage(entry, filters, categoryPageIds))
        .sort((a, b) => comparePages(a, b, pageSort)),
    [allPages, filters, categoryPageIds, pageSort],
  );

  const pageIds = useMemo(
    () => new Set(filteredPages.map((entry) => entry.id)),
    [filteredPages],
  );

  const filteredIssues = useMemo(
    () =>
      allIssues
        .filter((issue) => matchesIssue(issue, filters, pageIds))
        .map((issue) => scopeIssueToPages(issue, pageIds))
        .sort((a, b) => compareIssues(a, b, issueSort)),
    [allIssues, filters, pageIds, issueSort],
  );

  const overview = useMemo(
    () => getTechnicalOverview(filteredPages, filteredIssues),
    [filteredPages, filteredIssues],
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
  const counts: TechnicalFilterCounts = useMemo(() => {
    const tally = (values: readonly string[]): Record<string, number> => {
      const result: Record<string, number> = {};
      for (const value of values) result[value] = (result[value] ?? 0) + 1;
      return result;
    };

    const without = (key: keyof TechnicalFilters) => {
      const relaxed = { ...filters, [key]: "all" } as TechnicalFilters;
      const scoped =
        key === "category" ? undefined : categoryPageIds;
      return allPages.filter((entry) => matchesPage(entry, relaxed, scoped));
    };

    const categoryScope = new Set(
      without("category").map((entry) => entry.id),
    );
    const categoryCounts: Record<string, number> = {};
    for (const issue of allIssues) {
      if (filters.project !== "all" && issue.projectId !== filters.project) {
        continue;
      }
      const hits = issue.pageIds.filter((id) => categoryScope.has(id)).length;
      if (hits === 0) continue;
      categoryCounts[issue.category] =
        (categoryCounts[issue.category] ?? 0) + hits;
    }

    return {
      severity: tally(without("severity").map((entry) => entry.severity)),
      category: categoryCounts,
      crawlState: tally(without("crawlState").map((entry) => entry.crawlState)),
      indexStatus: tally(
        without("indexStatus").map((entry) => entry.indexStatus),
      ),
      indexability: tally(
        without("indexability").map((entry) => entry.indexability),
      ),
      canonical: tally(
        without("canonical").map((entry) => entry.canonicalState),
      ),
      cwv: tally(without("cwv").map((entry) => entry.vitals.state)),
      schema: tally(without("schema").map((entry) => entry.schemaState)),
      total: filteredPages.length,
    };
  }, [allPages, allIssues, filters, categoryPageIds, filteredPages.length]);

  // ---------------------------------------------------------------------
  // Interaction
  // ---------------------------------------------------------------------

  const changeFilters = (patch: Partial<TechnicalFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  const resetFilters = () => {
    setFilters(EMPTY_TECHNICAL_FILTERS);
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
    else if (event.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = TABS.length - 1;
    else return;

    event.preventDefault();
    changeTab(TABS[next].id);
    const buttons = tablistRef.current?.querySelectorAll("button");
    buttons?.[next]?.focus();
  };

  const scopeName =
    filters.project === "all"
      ? "the portfolio"
      : (projects.find((project) => project.id === filters.project)?.name ??
        "the portfolio");

  const tabCounts: Partial<Record<TabId, number>> = {
    issues: filteredIssues.length,
    pages: filteredPages.length,
  };

  // Paging is 1-based and the set changes under it; clamping on read avoids an
  // effect that would cost an extra render pass on every filter change.
  const pageCount = Math.max(1, Math.ceil(filteredPages.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visiblePages = filteredPages.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  const issueCount = Math.max(1, Math.ceil(filteredIssues.length / pageSize));
  const issuePage = Math.min(page, issueCount);
  const visibleIssues = filteredIssues.slice(
    (issuePage - 1) * pageSize,
    issuePage * pageSize,
  );

  const sortControl =
    tab === "pages" ? (
      <SortControl
        value={pageSort.key}
        desc={pageSort.desc}
        onChange={(key, desc) => setPageSort({ key, desc })}
        options={PAGE_SORT_OPTIONS}
        label="Sort pages"
      />
    ) : tab === "issues" ? (
      <SortControl
        value={issueSort.key}
        desc={issueSort.desc}
        onChange={(key, desc) => setIssueSort({ key, desc })}
        options={ISSUE_SORT_OPTIONS}
        label="Sort findings"
      />
    ) : undefined;

  return (
    <div className="space-y-6">
      <SectionHeader
        size="page"
        title="Technical SEO"
        description={`Whether ${scopeName} can be crawled, indexed, and served — what is wrong, how far it reaches, and what to do about it first.`}
        actions={
          <>
            <span className="hidden items-center gap-1.5 text-[11.5px] text-fg-subtle lg:inline-flex">
              <Icon name="clock" className="h-3.5 w-3.5" />
              Updated {formatFullDate(TECHNICAL_AS_OF)},{" "}
              {formatTimeUtc(TECHNICAL_AS_OF)}
            </span>
            <Button icon="alert" onClick={() => changeTab("issues")}>
              Issues
            </Button>
            <Button
              variant="primary"
              icon="pages"
              onClick={() => changeTab("pages")}
            >
              Pages
            </Button>
          </>
        }
      />

      <MetricTileGrid metrics={overview.metrics} />

      <Panel>
        <TechnicalToolbar
          filters={filters}
          onFilterChange={changeFilters}
          onReset={resetFilters}
          counts={counts}
          sortControl={sortControl}
          projects={projects}
          clusters={clusters}
          advanced={advanced}
          onToggleAdvanced={() => setAdvanced((value) => !value)}
          total={allPages.length}
          shown={filteredPages.length}
          noun="pages"
        />
        <PanelFooter>
          <span>
            Filters apply to every view below — the health score, the crawl and
            index readings, the findings, and the page table all describe the{" "}
            {filteredPages.length} pages selected here.
          </span>
          <span>
            Modelled data over the {TECHNICAL_RANGE_CAPTION.toLowerCase()}
          </span>
        </PanelFooter>
      </Panel>

      <div className="relative -mx-1 overflow-x-auto px-1">
        <div
          ref={tablistRef}
          role="tablist"
          aria-label="Technical SEO sections"
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
                id={`technical-tab-${entry.id}`}
                aria-selected={isSelected}
                aria-controls={`technical-panel-${entry.id}`}
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
        id={`technical-panel-${tab}`}
        aria-labelledby={`technical-tab-${tab}`}
        tabIndex={0}
        className="space-y-4 focus-visible:outline-none"
      >
        {tab === "overview" && (
          <OverviewView
            overview={overview}
            onOpenTab={(next) => changeTab(next as TabId)}
          />
        )}

        {tab === "issues" && (
          <div className="space-y-4">
            <IssuesView
              issues={visibleIssues}
              pagesById={pagesById}
              statuses={statuses}
              onStatusChange={(id, status) =>
                setStatuses((current) => ({ ...current, [id]: status }))
              }
              onFilterCategory={(category) => changeFilters({ category })}
            />
            {filteredIssues.length > pageSize && (
              <Panel>
                <Pagination
                  page={issuePage}
                  pageSize={pageSize}
                  total={filteredIssues.length}
                  onPageChange={setPage}
                  onPageSizeChange={(size) => {
                    setPageSize(size);
                    setPage(1);
                  }}
                  noun="findings"
                />
              </Panel>
            )}
          </div>
        )}

        {tab === "crawlability" && (
          <CrawlView crawl={overview.crawl} onFilter={changeFilters} />
        )}

        {tab === "indexation" && (
          <IndexationView
            indexation={overview.indexation}
            onFilter={changeFilters}
          />
        )}

        {tab === "pages" && (
          <Panel>
            {visiblePages.length === 0 ? (
              <EmptyState
                icon="search"
                title="No pages match these filters"
                description="Every filter here is derived from the pages that exist, so a combination can still select nothing. Clear one to widen the set."
              />
            ) : (
              <>
                <PagesTable pages={visiblePages} />
                <Pagination
                  page={currentPage}
                  pageSize={pageSize}
                  total={filteredPages.length}
                  onPageChange={setPage}
                  onPageSizeChange={(size) => {
                    setPageSize(size);
                    setPage(1);
                  }}
                  noun="pages"
                />
              </>
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}
