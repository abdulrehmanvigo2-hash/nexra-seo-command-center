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
  BACKLINKS_AS_OF,
  LINK_SOURCE_SHORT,
  getAllLinkedPages,
  getAuthorityOverview,
  getBacklinkProjectOptions,
  getBacklinks,
  getDomainOptions,
  getLinkGaps,
  getOutreachOpportunities,
  getReferringDomains,
} from "@/lib/mock/backlinks";
import { AnchorsView } from "@/components/backlinks/anchors-view";
import { OutreachView } from "@/components/backlinks/outreach-view";
import { OverviewView } from "@/components/backlinks/overview-view";
import { RiskView } from "@/components/backlinks/risk-view";
import {
  BacklinksTable,
  DomainsTable,
  GapsTable,
  LinkedPagesTable,
} from "@/components/backlinks/tables";
import {
  LinkToolbar,
  SortControl,
  type LinkFilterCounts,
} from "@/components/backlinks/link-toolbar";
import {
  EMPTY_LINK_FILTERS,
  matchesDomain,
  matchesGap,
  matchesLink,
  matchesPage,
  opportunityMatchesQuery,
  type LinkFilters,
} from "@/components/backlinks/filters";
import {
  DOMAIN_SORT_OPTIONS,
  GAP_SORT_OPTIONS,
  LINK_SORT_OPTIONS,
  PAGE_SORT_OPTIONS,
  compareDomains,
  compareGaps,
  compareLinks,
  comparePages,
  type DomainSort,
  type GapSort,
  type LinkSort,
  type PageSort,
} from "@/components/backlinks/sorting";
import type { OutreachKind, OutreachStage } from "@/types/backlinks";

/**
 * The Backlinks & Authority workspace.
 *
 * Owns every piece of state that has to survive a tab change: the filters, the
 * four sorts, the page, and the stages recorded against jobs. The views below
 * are presentational — one that owned its own state would lose it the moment a
 * filter changed.
 *
 * The filters are deliberately global. Narrowing to one project should narrow
 * the authority score, the anchor profile, the risk reading, the domains, the
 * pages, the gaps and the queue with it, because all of those are readings of
 * the same set. The narrowing runs in a fixed order — links first, then
 * everything that hangs off the links that survived — which is what keeps a
 * tab count and the table it labels describing the same rows.
 *
 * A client component because the whole screen is interactive. The data comes
 * from pure, deterministic builders, so the server render and the first client
 * render produce identical markup.
 */

const TABS = [
  { id: "overview", label: "Overview", icon: "command-center" },
  { id: "links", label: "Backlinks", icon: "backlinks" },
  { id: "domains", label: "Referring domains", icon: "globe" },
  { id: "anchors", label: "Anchors", icon: "target" },
  { id: "pages", label: "Top pages", icon: "pages" },
  { id: "gaps", label: "Link gaps", icon: "competitors" },
  { id: "risk", label: "Risk", icon: "shield" },
  { id: "outreach", label: "Opportunities", icon: "bolt" },
] as const satisfies readonly {
  id: string;
  label: string;
  icon: IconName;
}[];

type TabId = (typeof TABS)[number]["id"];

const TAB_IDS: readonly string[] = TABS.map((tab) => tab.id);

export function BacklinksWorkspace() {
  const searchParams = useSearchParams();

  const allLinks = getBacklinks();
  const allDomains = getReferringDomains();
  const allPages = getAllLinkedPages(allLinks);
  const allGaps = getLinkGaps();
  const allOpportunities = getOutreachOpportunities();
  const projects = getBacklinkProjectOptions();
  const domainOptions = getDomainOptions();

  // Deep links from the Command Center, a project or a content page arrive as
  // query parameters. They seed the initial state and nothing more — changing
  // a filter afterwards must not fight the URL.
  const initialProject = searchParams.get("project");
  const initialTab = searchParams.get("tab");

  const [tab, setTab] = useState<TabId>(() =>
    initialTab !== null && TAB_IDS.includes(initialTab)
      ? (initialTab as TabId)
      : "overview",
  );

  const [filters, setFilters] = useState<LinkFilters>(() => ({
    ...EMPTY_LINK_FILTERS,
    project:
      initialProject !== null &&
      projects.some((project) => project.id === initialProject)
        ? initialProject
        : "all",
  }));

  const [linkSort, setLinkSort] = useState<{ key: LinkSort; desc: boolean }>({
    key: "quality",
    desc: true,
  });
  const [domainSort, setDomainSort] = useState<{
    key: DomainSort;
    desc: boolean;
  }>({ key: "quality", desc: true });
  const [pageSort, setPageSort] = useState<{ key: PageSort; desc: boolean }>({
    key: "authority",
    desc: true,
  });
  const [gapSort, setGapSort] = useState<{ key: GapSort; desc: boolean }>({
    key: "value",
    desc: true,
  });

  const [outreachKind, setOutreachKind] = useState<OutreachKind | "all">("all");
  const [stages, setStages] = useState<Record<string, OutreachStage>>({});

  const [advanced, setAdvanced] = useState(initialProject !== null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const tablistRef = useRef<HTMLDivElement>(null);

  // ---------------------------------------------------------------------
  // Narrowing
  // ---------------------------------------------------------------------

  const domainsById = useMemo(
    () => new Map(allDomains.map((domain) => [domain.id, domain])),
    [allDomains],
  );

  const filteredLinks = useMemo(
    () =>
      allLinks
        .filter((link) => matchesLink(link, filters, domainsById.get(link.domainId)))
        .sort((a, b) => compareLinks(a, b, linkSort)),
    [allLinks, filters, domainsById, linkSort],
  );

  const linkIds = useMemo(
    () => new Set(filteredLinks.map((link) => link.id)),
    [filteredLinks],
  );

  const contentIds = useMemo(
    () => new Set(filteredLinks.map((link) => link.contentId)),
    [filteredLinks],
  );

  const filteredDomains = useMemo(
    () =>
      allDomains
        .filter((domain) => matchesDomain(domain, filters, linkIds))
        .sort((a, b) => compareDomains(a, b, domainSort)),
    [allDomains, filters, linkIds, domainSort],
  );

  const filteredPages = useMemo(
    () =>
      allPages
        .filter((entry) => matchesPage(entry, filters, contentIds))
        .sort((a, b) => comparePages(a, b, pageSort)),
    [allPages, filters, contentIds, pageSort],
  );

  const filteredGaps = useMemo(
    () =>
      allGaps
        .filter((gap) => matchesGap(gap, filters))
        .sort((a, b) => compareGaps(a, b, gapSort)),
    [allGaps, filters, gapSort],
  );

  /**
   * The queue, narrowed the same way everything else is.
   *
   * A job survives while it still has a link or a page behind it in the
   * current selection; jobs that carry neither — a competitor gap, which is
   * about a domain we have no link from — survive on the project filter alone.
   */
  const filteredOpportunities = useMemo(
    () =>
      allOpportunities.filter((entry) => {
        if (filters.project !== "all" && entry.projectId !== filters.project) {
          return false;
        }
        if (
          filters.outreachKind !== "all" &&
          entry.kind !== filters.outreachKind
        ) {
          return false;
        }
        if (filters.severity !== "all" && entry.severity !== filters.severity) {
          return false;
        }
        if (!opportunityMatchesQuery(entry, filters.query)) return false;
        if (entry.linkIds.length > 0) {
          return entry.linkIds.some((id) => linkIds.has(id));
        }
        if (entry.contentId !== null) return contentIds.has(entry.contentId);
        return true;
      }),
    [allOpportunities, filters, linkIds, contentIds],
  );

  const flaggedLinks = useMemo(
    () =>
      filteredLinks
        .filter((link) => link.toxicSignals.length > 0)
        .sort(
          (a, b) => b.toxicScore - a.toxicScore || a.id.localeCompare(b.id),
        ),
    [filteredLinks],
  );

  const overview = useMemo(
    () =>
      getAuthorityOverview(
        filteredLinks,
        filteredDomains,
        filteredPages,
        filteredGaps,
        filteredOpportunities,
      ),
    [
      filteredLinks,
      filteredDomains,
      filteredPages,
      filteredGaps,
      filteredOpportunities,
    ],
  );

  /**
   * Counts behind each filter option.
   *
   * Each set is counted with its own filter released, so an option always
   * reports how many records it would select if chosen — not how many are
   * already showing, which would read zero for every option but the active one.
   */
  const counts: LinkFilterCounts = useMemo(() => {
    const tally = (values: readonly string[]): Record<string, number> => {
      const result: Record<string, number> = {};
      for (const value of values) result[value] = (result[value] ?? 0) + 1;
      return result;
    };

    const linksWithout = (key: keyof LinkFilters) => {
      const relaxed = { ...filters, [key]: "all" } as LinkFilters;
      return allLinks.filter((link) =>
        matchesLink(link, relaxed, domainsById.get(link.domainId)),
      );
    };

    const domainsWithout = (key: keyof LinkFilters) => {
      const relaxed = { ...filters, [key]: "all" } as LinkFilters;
      const ids = new Set(
        allLinks
          .filter((link) => matchesLink(link, relaxed, domainsById.get(link.domainId)))
          .map((link) => link.id),
      );
      return allDomains.filter((domain) => matchesDomain(domain, relaxed, ids));
    };

    return {
      status: tally(linksWithout("status").map((link) => link.status)),
      quality: tally(linksWithout("quality").map((link) => link.band)),
      rel: tally(linksWithout("rel").map((link) => link.rel)),
      kind: tally(linksWithout("kind").map((link) => link.kind)),
      anchorKind: tally(
        linksWithout("anchorKind").map((link) => link.anchorKind),
      ),
      category: tally(domainsWithout("category").map((d) => d.category)),
      relevance: tally(domainsWithout("relevance").map((d) => d.relevanceBand)),
      relationship: tally(
        domainsWithout("relationship").map((d) => d.relationship),
      ),
      outreachKind: tally(
        allOpportunities
          .filter(
            (entry) =>
              filters.project === "all" || entry.projectId === filters.project,
          )
          .map((entry) => entry.kind),
      ),
      severity: tally(
        allOpportunities
          .filter(
            (entry) =>
              filters.project === "all" || entry.projectId === filters.project,
          )
          .map((entry) => entry.severity),
      ),
      flagged: allLinks.filter(
        (link) =>
          link.toxicSignals.length > 0 &&
          (filters.project === "all" || link.projectId === filters.project),
      ).length,
      total: filteredLinks.length,
    };
  }, [
    allLinks,
    allDomains,
    allOpportunities,
    filters,
    domainsById,
    filteredLinks.length,
  ]);

  // ---------------------------------------------------------------------
  // Interaction
  // ---------------------------------------------------------------------

  const changeFilters = (patch: Partial<LinkFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  const resetFilters = () => {
    setFilters(EMPTY_LINK_FILTERS);
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
    filters.project === "all"
      ? "the portfolio"
      : (projects.find((project) => project.id === filters.project)?.name ??
        "the portfolio");

  const tabCounts: Partial<Record<TabId, number>> = {
    links: filteredLinks.length,
    domains: filteredDomains.length,
    pages: filteredPages.length,
    gaps: filteredGaps.length,
    risk: flaggedLinks.length,
    outreach: filteredOpportunities.length,
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

  const linksPage = paged(filteredLinks);
  const domainsPage = paged(filteredDomains);
  const pagesPage = paged(filteredPages);
  const gapsPage = paged(filteredGaps);

  const sortControl =
    tab === "links" ? (
      <SortControl
        value={linkSort.key}
        desc={linkSort.desc}
        onChange={(key, desc) => setLinkSort({ key, desc })}
        options={LINK_SORT_OPTIONS}
        label="Sort backlinks"
      />
    ) : tab === "domains" ? (
      <SortControl
        value={domainSort.key}
        desc={domainSort.desc}
        onChange={(key, desc) => setDomainSort({ key, desc })}
        options={DOMAIN_SORT_OPTIONS}
        label="Sort referring domains"
      />
    ) : tab === "pages" ? (
      <SortControl
        value={pageSort.key}
        desc={pageSort.desc}
        onChange={(key, desc) => setPageSort({ key, desc })}
        options={PAGE_SORT_OPTIONS}
        label="Sort pages"
      />
    ) : tab === "gaps" ? (
      <SortControl
        value={gapSort.key}
        desc={gapSort.desc}
        onChange={(key, desc) => setGapSort({ key, desc })}
        options={GAP_SORT_OPTIONS}
        label="Sort link gaps"
      />
    ) : undefined;

  return (
    <div className="space-y-6">
      <SectionHeader
        size="page"
        title="Backlinks & Authority"
        description={`The link profile behind ${scopeName}: what it is made of, what it is worth, what is at risk, and what to go and win next.`}
        actions={
          <>
            <span className="hidden items-center gap-1.5 text-[11.5px] text-fg-subtle lg:inline-flex">
              <Icon name="clock" className="h-3.5 w-3.5" />
              Updated {formatFullDate(BACKLINKS_AS_OF)},{" "}
              {formatTimeUtc(BACKLINKS_AS_OF)}
            </span>
            <Button icon="shield" onClick={() => changeTab("risk")}>
              Risk
            </Button>
            <Button
              variant="primary"
              icon="bolt"
              onClick={() => changeTab("outreach")}
            >
              Opportunities
            </Button>
          </>
        }
      />

      <MetricTileGrid metrics={overview.metrics} />

      <Panel>
        <LinkToolbar
          filters={filters}
          onFilterChange={changeFilters}
          onReset={resetFilters}
          counts={counts}
          sortControl={sortControl}
          projects={projects}
          domains={domainOptions}
          advanced={advanced}
          onToggleAdvanced={() => setAdvanced((value) => !value)}
          total={allLinks.length}
          shown={filteredLinks.length}
          noun="links"
        />
        <PanelFooter>
          <span>
            Filters apply to every view below — the authority score, the anchor
            profile, the risk reading, the domains, the pages and the queue all
            describe the {filteredLinks.length} links selected here.
          </span>
          <span>{LINK_SOURCE_SHORT}</span>
        </PanelFooter>
      </Panel>

      <div className="relative -mx-1 overflow-x-auto px-1">
        <div
          ref={tablistRef}
          role="tablist"
          aria-label="Backlinks and Authority sections"
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
                id={`backlinks-tab-${entry.id}`}
                aria-selected={isSelected}
                aria-controls={`backlinks-panel-${entry.id}`}
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
        id={`backlinks-panel-${tab}`}
        aria-labelledby={`backlinks-tab-${tab}`}
        tabIndex={0}
        className="space-y-4 focus-visible:outline-none"
      >
        {tab === "overview" && (
          <OverviewView
            overview={overview}
            onOpenTab={(next) => changeTab(next as TabId)}
          />
        )}

        {tab === "links" && (
          <Panel>
            <BacklinksTable links={linksPage.rows} />
            {filteredLinks.length > pageSize && (
              <Pagination
                page={linksPage.current}
                pageSize={pageSize}
                total={filteredLinks.length}
                onPageChange={setPage}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
                noun="links"
              />
            )}
          </Panel>
        )}

        {tab === "domains" && (
          <Panel>
            <DomainsTable domains={domainsPage.rows} />
            {filteredDomains.length > pageSize && (
              <Pagination
                page={domainsPage.current}
                pageSize={pageSize}
                total={filteredDomains.length}
                onPageChange={setPage}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
                noun="domains"
              />
            )}
          </Panel>
        )}

        {tab === "anchors" && (
          <AnchorsView anchors={overview.anchors} onFilter={changeFilters} />
        )}

        {tab === "pages" && (
          <Panel>
            <LinkedPagesTable pages={pagesPage.rows} />
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
          <Panel>
            <GapsTable gaps={gapsPage.rows} />
            {filteredGaps.length > pageSize && (
              <Pagination
                page={gapsPage.current}
                pageSize={pageSize}
                total={filteredGaps.length}
                onPageChange={setPage}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
                noun="gaps"
              />
            )}
          </Panel>
        )}

        {tab === "risk" && (
          <RiskView
            risk={overview.risk}
            links={flaggedLinks.slice(0, 60)}
            onFilter={changeFilters}
          />
        )}

        {tab === "outreach" && (
          <OutreachView
            opportunities={filteredOpportunities}
            kind={outreachKind}
            onKindChange={setOutreachKind}
            stages={stages}
            onStageChange={(id, stage) =>
              setStages((current) => ({ ...current, [id]: stage }))
            }
          />
        )}
      </div>
    </div>
  );
}
