"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { IconName } from "@/components/icons";
import { CuratedKeywordsList, type CuratedLoad } from "@/components/keywords/curated-keywords";
import { ObservedCannibalization, ObservedGroups, ObservedMovement, ObservedOpportunities, ObservedPortfolio } from "@/components/keywords/observed-views";
import { ProviderEstimatesSection } from "@/components/keywords/provider-estimates";
import { TopicMapSection } from "@/components/keywords/topic-map";
import { ContentOpportunitiesSection } from "@/components/keywords/content-opportunities";
import { SearchConsoleKeywords, type Curation } from "@/components/search-console/search-console-keywords";
import { SearchConsolePanel } from "@/components/search-console/search-console-panel";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Select, TextInput } from "@/components/ui/field";
import { Panel, PanelBody, PanelFooter } from "@/components/ui/panel";
import { SectionHeader } from "@/components/ui/section-header";
import { Skeleton } from "@/components/ui/skeleton";
import { TabList, tabDomId, tabPanelDomId } from "@/components/ui/tab-list";
import { curatedReadFailure, keywordsListUrl } from "@/lib/keywords/contract";
import type { CuratedKeywordRow } from "@/lib/keywords/service";
import type { ProjectOption } from "@/lib/projects/selection";
import type { IntentHint } from "@/lib/search-console/keywords/intent";
import {
  EMPTY_KEYWORD_SCREEN_FILTERS,
  KEYWORD_TABS,
  OBSERVED_FOOTER,
  hasKeywordScreenFilters,
  presentKeywordScreen,
  resolveKeywordTab,
  type KeywordScreenFilters,
  type KeywordTabId,
} from "@/lib/search-console/keywords/screen";
import { OPPORTUNITY_LABELS, type OpportunityLabel } from "@/lib/search-console/keywords/thresholds";
import {
  INTENT_LABEL,
  OPPORTUNITY_LABEL,
  describeKeywordStatus,
  keywordsReadFailure,
  keywordsUrl,
  type KeywordIntelligenceView,
} from "@/lib/search-console/keywords/view";

/**
 * The Keyword Intelligence screen over observed data only (Phase 3,
 * checkpoint 3.4).
 *
 * One read, `GET /api/search-console/keywords`, answers the Keywords, Groups
 * and Opportunities tabs: the M4 observed query inventory, derived by fixed
 * rules from the project's stored Search Console snapshots and query × page
 * pairs. Movement reads the stored-window comparison (P4a/P4d) and
 * Cannibalisation the pair overlap (P4c), each through its existing section.
 * The modelled keyword universe is gone from this screen (decision Q1): no
 * volume, difficulty, cost per click, potential, SERP, content gap,
 * competitor or AI search reading, and no session-only bulk action — each
 * observed row carries *Record as task* instead. Since checkpoint 3.5 the
 * Lists tab holds the operator's curated keywords (`GET /api/keywords`), and
 * each observed row can be tracked as one.
 */

const TABS = KEYWORD_TABS satisfies readonly { id: string; label: string; icon: IconName }[];

type Load =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "loaded"; readonly view: KeywordIntelligenceView };

const INTENT_OPTIONS: readonly IntentHint[] = ["informational", "commercial", "transactional", "navigational", "local", "mixed", "unclassified"];

export function KeywordsWorkspace({
  projects,
}: {
  /** The stored roster, read on the server from the Projects repository. */
  projects: readonly ProjectOption[];
}) {
  const searchParams = useSearchParams();
  const selectId = useId();
  const searchId = useId();
  const initialProject = searchParams.get("project");

  const [projectId, setProjectId] = useState<string | null>(() =>
    initialProject !== null && projects.some((p) => p.id === initialProject) ? initialProject : (projects[0]?.id ?? null),
  );
  const [tab, setTab] = useState<KeywordTabId>(() => resolveKeywordTab(searchParams.get("tab")));
  const [filters, setFilters] = useState<KeywordScreenFilters>(EMPTY_KEYWORD_SCREEN_FILTERS);
  const [load, setLoad] = useState<Load>({ status: "idle" });

  useEffect(() => {
    if (projectId === null) return;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loading state belongs to this request
    setLoad({ status: "loading" });
    fetch(keywordsUrl(projectId), { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return setLoad({ status: "failed", message: keywordsReadFailure(response.status) });
        setLoad({ status: "loaded", view: (await response.json()) as KeywordIntelligenceView });
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setLoad({ status: "failed", message: keywordsReadFailure(0) });
      });
    return () => controller.abort();
  }, [projectId]);

  // Checkpoint 3.5: the project's curated keywords, read beside the inventory and re-read after a change.
  const [curated, setCurated] = useState<CuratedLoad>({ status: "idle" });
  const [curatedVersion, setCuratedVersion] = useState(0);
  const reloadCurated = useCallback(() => setCuratedVersion((v) => v + 1), []);
  /** The project the shown list belongs to: a re-read keeps it on screen, a new project never shows the last one's. */
  const curatedFor = useRef<string | null>(null);
  useEffect(() => {
    if (projectId === null) return;
    const controller = new AbortController();
    const sameProject = curatedFor.current === projectId;
    curatedFor.current = projectId;
    setCurated((current) => (sameProject && current.status === "loaded" ? current : { status: "loading" }));
    fetch(keywordsListUrl(projectId), { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (response.status === 503) return setCurated({ status: "unavailable" });
        if (!response.ok) return setCurated({ status: "failed", message: curatedReadFailure(response.status) });
        const body = (await response.json()) as { keywords?: CuratedKeywordRow[] };
        setCurated({ status: "loaded", keywords: body.keywords ?? [] });
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setCurated({ status: "failed", message: curatedReadFailure(0) });
      });
    return () => controller.abort();
  }, [projectId, curatedVersion]);

  // Track is offered only once the list has been read: without it, an already curated query could not be told apart.
  const curation = useMemo<Curation | null>(
    () =>
      curated.status !== "loaded"
        ? null
        : { ids: new Map(curated.keywords.map((row) => [row.keyword.query, row.keyword.id] as const)), onAdded: () => reloadCurated() },
    [curated, reloadCurated],
  );

  const inventory = load.status === "loaded" && load.view.status === "inventory" ? load.view : null;
  const screen = useMemo(() => (inventory === null ? null : presentKeywordScreen(inventory, filters)), [inventory, filters]);
  const projectName = projects.find((p) => p.id === projectId)?.name ?? "the project";
  const filtered = hasKeywordScreenFilters(filters);

  return (
    <div className="space-y-6">
      <SectionHeader
        size="page"
        title="Keyword Intelligence"
        description={`What Google reported for ${projectName} in this product's stored Search Console rows, with fixed-rule labels for review. Observed data only.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent" title="Read from Search Console rows this product stored. Figures are Google's; labels are derived. Not fixture data.">
              Observed
            </Badge>
            {projects.length > 0 && (
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
                    setFilters(EMPTY_KEYWORD_SCREEN_FILTERS);
                  }}
                  options={projects.map((p) => ({ value: p.id, label: p.name }))}
                />
              </>
            )}
          </div>
        }
      />

      {projects.length === 0 && (
        <Panel>
          <EmptyState icon="projects" title="No stored project" description="Keyword Intelligence reads a stored project's own Search Console rows. Add a project on the Projects screen." />
        </Panel>
      )}

      {projectId !== null && (
        <>
          {inventory !== null && screen !== null && (
            <Panel>
              <div className="flex flex-wrap items-end gap-3 px-4 py-3 sm:px-5">
                <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
                  <label htmlFor={searchId} className="text-[11px] font-medium text-fg-subtle uppercase">
                    Query contains
                  </label>
                  <TextInput id={searchId} size="sm" value={filters.search} placeholder="seo agency" onChange={(event) => setFilters((f) => ({ ...f, search: event.target.value }))} />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-fg-subtle uppercase">Intent hint</span>
                  <Select
                    size="sm"
                    aria-label="Filter by intent hint"
                    value={filters.intent}
                    onChange={(event) => setFilters((f) => ({ ...f, intent: event.target.value as IntentHint | "all" }))}
                    options={[
                      { value: "all", label: "Every hint" },
                      ...INTENT_OPTIONS.map((intent) => ({ value: intent, label: `${INTENT_LABEL[intent]} (${screen.filterCounts.intent[intent] ?? 0})` })),
                    ]}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-fg-subtle uppercase">Opportunity label</span>
                  <Select
                    size="sm"
                    aria-label="Filter by opportunity label"
                    value={filters.opportunity}
                    onChange={(event) => setFilters((f) => ({ ...f, opportunity: event.target.value as OpportunityLabel | "all" }))}
                    options={[
                      { value: "all", label: "Every row" },
                      ...OPPORTUNITY_LABELS.map((label) => ({ value: label, label: `${OPPORTUNITY_LABEL[label].label} (${screen.filterCounts.opportunity[label]})` })),
                    ]}
                  />
                </div>
                {filtered && (
                  <button type="button" className="text-xs text-accent hover:underline" onClick={() => setFilters(EMPTY_KEYWORD_SCREEN_FILTERS)}>
                    Clear filters
                  </button>
                )}
              </div>
              <PanelFooter>
                <span>
                  Filters narrow the Keywords and Opportunities tabs: {screen.rows.length} of {inventory.rows.length} shown rows. {screen.windows}
                </span>
                <span>{OBSERVED_FOOTER}</span>
              </PanelFooter>
            </Panel>
          )}

          <TabList
            tabs={TABS}
            value={tab}
            onChange={setTab}
            label="Keyword intelligence sections"
            idPrefix="kw"
            counts={{ ...(screen?.tabCounts ?? {}), ...(curated.status === "loaded" ? { lists: curated.keywords.filter((row) => row.keyword.status !== "archived").length } : {}) }}
          />

          <div role="tabpanel" id={tabPanelDomId("kw", tab)} aria-labelledby={tabDomId("kw", tab)} tabIndex={0} className="space-y-4 focus-visible:outline-none">
            {/* M2: the scored content opportunities, on their own read, above the query labels. */}
            {tab === "opportunities" && <ContentOpportunitiesSection projectId={projectId} onOpenMap={() => setTab("map")} />}
            {/* The tabs over the observed inventory show its state until it is read. */}
            {(tab === "keywords" || tab === "clusters" || tab === "opportunities") && (
              <>
                {load.status === "loading" && (
                  <div className="space-y-3" aria-busy="true">
                    <Skeleton className="h-9 w-full" />
                    <div className="grid gap-4 xl:grid-cols-2">
                      <Skeleton className="h-40 w-full" />
                      <Skeleton className="h-40 w-full" />
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
                {load.status === "loaded" && load.view.status !== "inventory" && (
                  <>
                    <Panel>
                      <EmptyState icon="search" title={describeKeywordStatus(load.view).title} description={describeKeywordStatus(load.view).description} />
                    </Panel>
                    {/* The live Search Console report stands on its own read, so it shows whatever the stored rows say. */}
                    {tab === "keywords" && <SearchConsolePanel projectId={projectId} rangeId="30d" view="summary" />}
                  </>
                )}
              </>
            )}
            {inventory !== null && screen !== null && (
              <>
                {tab === "keywords" && (
                  <>
                    <ObservedPortfolio screen={screen} />
                    <SearchConsoleKeywords projectId={projectId} view={inventory} rows={screen.rows} filtered={filtered} curation={curation} />
                    <SearchConsolePanel projectId={projectId} rangeId="30d" view="summary" />
                    {/* F0: a provider's estimates, on their own read, kept apart from the observed rows. */}
                    <ProviderEstimatesSection projectId={projectId} />
                  </>
                )}
                {tab === "clusters" && <ObservedGroups view={inventory} />}
                {tab === "opportunities" && <ObservedOpportunities screen={screen} projectId={projectId} curation={curation} />}
              </>
            )}
            {tab === "movement" && <ObservedMovement projectId={projectId} />}
            {tab === "cannibalization" && <ObservedCannibalization projectId={projectId} />}
            {tab === "lists" && <CuratedKeywordsList projectId={projectId} load={curated} onChanged={reloadCurated} />}
            {tab === "map" && <TopicMapSection projectId={projectId} />}
          </div>
        </>
      )}
    </div>
  );
}
