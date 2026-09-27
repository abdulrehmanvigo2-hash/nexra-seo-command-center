"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { Icon, type IconName } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Select, TextInput } from "@/components/ui/field";
import { MetricTileGrid, type MetricTileData } from "@/components/ui/metric-tile";
import { Panel, PanelBody, PanelFooter } from "@/components/ui/panel";
import { SectionHeader } from "@/components/ui/section-header";
import { Skeleton } from "@/components/ui/skeleton";
import { TabList, tabDomId, tabPanelDomId } from "@/components/ui/tab-list";
import { FindingHistoryPanel } from "@/components/technical/finding-history";
import { ObservedFindings } from "@/components/technical/observed-findings";
import { CoverageBanner, LiveCrawlability, LiveLinks, LiveOverview, LivePages, LiveSchema } from "@/components/technical/live-views";
import type { FindingCategory, FindingSeverity } from "@/lib/crawl/findings/contract";
import { CATEGORY_LABEL, SEVERITY_LABEL, SEVERITY_ORDER } from "@/lib/crawl/findings/present";
import { overviewReadFailure, overviewUrl, type CrawlOverview } from "@/lib/crawl/overview/contract";
import { EMPTY_LIVE_FILTERS, LIVE_PROVENANCE, presentLiveTechnical, type LiveFilters } from "@/lib/crawl/overview/present";
import { formatFullDate, formatTimeUtc } from "@/lib/format";
import type { ProjectOption } from "@/lib/projects/selection";

/**
 * The Technical SEO screen, over this product's own crawl records (Phase 3,
 * checkpoint 3.2).
 *
 * One read, `GET /api/crawls/latest-overview`, answers every tab: the stored
 * project's latest own-site crawl, its pages, a summary of its recorded link
 * edges and its findings at the current rule version. The Issues tab is the
 * existing observed-findings section (M3), following the project chosen
 * here. Nothing on the screen is fixture data: the modelled Core Web Vitals,
 * opportunities, answer-engine access and index coverage are not shown,
 * because this product holds nothing to back them. Every section carries the
 * crawl's coverage banner, so a crawl that stopped on its budget never reads
 * as the whole site.
 */

const TABS = [
  { id: "overview", label: "Overview", icon: "command-center" },
  { id: "issues", label: "Issues", icon: "alert" },
  { id: "crawlability", label: "Crawlability", icon: "refresh" },
  { id: "pages", label: "Pages", icon: "pages" },
  { id: "schema", label: "Schema", icon: "layers" },
  { id: "links", label: "Internal links", icon: "link-off" },
] as const satisfies readonly { id: string; label: string; icon: IconName }[];

type TabId = (typeof TABS)[number]["id"];
const TAB_IDS: readonly string[] = TABS.map((tab) => tab.id);

type Load =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "unavailable" }
  | { readonly status: "loaded"; readonly overview: Exclude<CrawlOverview, { status: "unavailable" }> };

const stamp = (iso: string) => `${formatFullDate(iso)}, ${formatTimeUtc(iso)}`;

const SEVERITY_OPTIONS = [{ value: "all", label: "Every severity" }, ...SEVERITY_ORDER.map((s) => ({ value: s, label: SEVERITY_LABEL[s].label }))];
const CATEGORY_OPTIONS = [{ value: "all", label: "Every category" }, ...Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label }))];

export function TechnicalSeo({
  storedProjects,
}: {
  /** The stored roster: every section reads only these projects' own crawl records. */
  storedProjects: readonly ProjectOption[];
}) {
  const searchParams = useSearchParams();
  const selectId = useId();
  const searchId = useId();
  const initialProject = searchParams.get("project");
  const initialTab = searchParams.get("tab");

  const [projectId, setProjectId] = useState<string | null>(() =>
    initialProject !== null && storedProjects.some((p) => p.id === initialProject) ? initialProject : (storedProjects[0]?.id ?? null),
  );
  const [tab, setTab] = useState<TabId>(() => (initialTab !== null && TAB_IDS.includes(initialTab) ? (initialTab as TabId) : "overview"));
  const [filters, setFilters] = useState<LiveFilters>(EMPTY_LIVE_FILTERS);
  const [load, setLoad] = useState<Load>({ status: "idle" });

  useEffect(() => {
    if (projectId === null) return;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loading state belongs to this request
    setLoad({ status: "loading" });
    fetch(overviewUrl(projectId), { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (response.status === 503) return setLoad({ status: "unavailable" });
        if (!response.ok) return setLoad({ status: "failed", message: overviewReadFailure(response.status) });
        const body = (await response.json()) as Exclude<CrawlOverview, { status: "unavailable" }>;
        setLoad({ status: "loaded", overview: body });
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setLoad({ status: "failed", message: overviewReadFailure(0) });
      });
    return () => controller.abort();
  }, [projectId]);

  const crawled = load.status === "loaded" && load.overview.status === "crawled" ? load.overview : null;
  const view = useMemo(
    () => (crawled === null ? null : presentLiveTechnical({ crawl: crawled.crawl, pages: crawled.pages, links: crawled.links, report: crawled.report, filters })),
    [crawled, filters],
  );

  const tiles: MetricTileData[] = (view?.tiles ?? []).map((tile) => ({
    id: tile.id,
    label: tile.label,
    value: tile.value,
    detail: tile.detail,
    icon: tile.id === "findings" ? "alert" : tile.id === "rules" ? "layers" : "pages",
  }));

  const projectName = storedProjects.find((p) => p.id === projectId)?.name ?? "the project";
  const filtered = filters.severity !== "all" || filters.category !== "all" || filters.search.trim().length > 0;

  return (
    <div className="space-y-6">
      <SectionHeader
        size="page"
        title="Technical SEO"
        description={`What this product's own crawl of ${projectName} observed: how its pages answered, what they declared, and what fixed rules found. Observed data only.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {view !== null && (
              <span className="inline-flex items-center gap-1.5 text-[11.5px] text-fg-subtle">
                <Icon name="clock" className="h-3.5 w-3.5" />
                Crawl {view.statusLabel.toLowerCase()}
                {view.finishedAt ? `, finished ${stamp(view.finishedAt)}` : ", not finished"}
              </span>
            )}
            <Badge tone="accent" title="Read from this product's own crawl records. Not fixture data.">
              Observed
            </Badge>
            {storedProjects.length > 0 && (
              <>
                <label htmlFor={selectId} className="text-xs text-fg-subtle">
                  Stored project
                </label>
                <Select
                  id={selectId}
                  size="sm"
                  value={projectId ?? ""}
                  onChange={(event) => {
                    setProjectId(event.target.value);
                    setFilters(EMPTY_LIVE_FILTERS);
                  }}
                  options={storedProjects.map((p) => ({ value: p.id, label: p.name }))}
                />
              </>
            )}
          </div>
        }
      />

      {storedProjects.length === 0 && (
        <Panel>
          <EmptyState icon="projects" title="No stored project" description="The Technical SEO screen reads a stored project's own crawl. Add a project on the Projects screen and run a crawl from its page." />
        </Panel>
      )}

      {load.status === "loading" && (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-9 w-full" />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        </div>
      )}

      {load.status === "failed" && (
        <Panel>
          <PanelBody>
            <p className="text-sm text-critical" role="status">
              {load.message}
            </p>
          </PanelBody>
        </Panel>
      )}

      {load.status === "unavailable" && (
        <Panel>
          <EmptyState icon="inbox" title="Crawls are not stored on this deployment" description="This deployment keeps no crawl records, so there is nothing observed to show. Nothing is shown in its place." />
        </Panel>
      )}

      {load.status === "loaded" && load.overview.status === "none" && (
        <Panel>
          <EmptyState
            icon="refresh"
            title="No crawl recorded for this project"
            description="Nothing on this screen is shown until this product's own crawler has fetched the project's site. Run a crawl from the project's page. This says nothing about the site itself."
          />
        </Panel>
      )}

      {view !== null && (
        <>
          <CoverageBanner text={view.banner} />
          <MetricTileGrid metrics={tiles} />
          {view.report.note !== null && (
            <p className="text-xs text-fg-muted" role="status">
              {view.report.note}
            </p>
          )}

          <Panel>
            <div className="flex flex-wrap items-end gap-3 px-4 py-3 sm:px-5">
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-fg-subtle uppercase">Severity</span>
                <Select
                  size="sm"
                  aria-label="Filter by severity"
                  value={filters.severity}
                  onChange={(event) => setFilters((f) => ({ ...f, severity: event.target.value as FindingSeverity | "all" }))}
                  options={SEVERITY_OPTIONS.map((o) => ({ ...o, label: o.value === "all" ? o.label : `${o.label} (${view.filterCounts.severity[o.value] ?? 0})` }))}
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-fg-subtle uppercase">Category</span>
                <Select
                  size="sm"
                  aria-label="Filter by category"
                  value={filters.category}
                  onChange={(event) => setFilters((f) => ({ ...f, category: event.target.value as FindingCategory | "all" }))}
                  options={CATEGORY_OPTIONS.map((o) => ({ ...o, label: o.value === "all" ? o.label : `${o.label} (${view.filterCounts.category[o.value] ?? 0})` }))}
                />
              </div>
              <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
                <label htmlFor={searchId} className="text-[11px] font-medium text-fg-subtle uppercase">
                  URL contains
                </label>
                <TextInput id={searchId} size="sm" value={filters.search} placeholder="/services" onChange={(event) => setFilters((f) => ({ ...f, search: event.target.value }))} />
              </div>
              {filtered && (
                <button type="button" className="text-xs text-accent hover:underline" onClick={() => setFilters(EMPTY_LIVE_FILTERS)}>
                  Clear filters
                </button>
              )}
            </div>
            <PanelFooter>
              <span>
                Filters narrow the findings and the pages together: {view.counts.findings} findings and {view.counts.pages} recorded pages ({view.counts.fetched} fetched) shown.
              </span>
              <span>
                Observed in crawl of {view.hostScope}
                {view.finishedAt ? ` finished ${stamp(view.finishedAt)}` : ""}
              </span>
            </PanelFooter>
          </Panel>

          <TabList
            tabs={TABS}
            value={tab}
            onChange={setTab}
            label="Technical SEO sections"
            idPrefix="technical"
            counts={{ issues: view.counts.findings, pages: view.counts.pages }}
          />

          <div role="tabpanel" id={tabPanelDomId("technical", tab)} aria-labelledby={tabDomId("technical", tab)} tabIndex={0} className="space-y-4 focus-visible:outline-none">
            {tab === "overview" && <LiveOverview view={view} />}
            {tab === "issues" && (
              <div className="space-y-3">
                <CoverageBanner text={view.banner} />
                {/* The existing observed-findings section (M3), following this screen's project: the same
                    recorded findings with the decisions operators have made. Its own filters are its own. */}
                <ObservedFindings projects={storedProjects} initialProjectId={null} projectId={projectId} />
                {/* Checkpoint 3.3: what became of each finding across the project's crawls, derived on read. */}
                {projectId !== null && <FindingHistoryPanel projectId={projectId} />}
              </div>
            )}
            {tab === "crawlability" && <LiveCrawlability view={view} />}
            {tab === "pages" && <LivePages view={view} />}
            {tab === "schema" && <LiveSchema view={view} />}
            {tab === "links" && <LiveLinks view={view} />}
          </div>

          <p className="text-xs text-fg-subtle">{LIVE_PROVENANCE}</p>
        </>
      )}
    </div>
  );
}
