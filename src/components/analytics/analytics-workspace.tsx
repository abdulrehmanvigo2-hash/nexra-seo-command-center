"use client";

import { useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import type { IconName } from "@/components/icons";
import { LatestWindowTiles, LearningsList } from "@/components/analytics/observed-analytics";
import { SearchConsolePanel } from "@/components/search-console/search-console-panel";
import { SearchConsoleQueryPages } from "@/components/search-console/search-console-query-pages";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/field";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { SectionHeader } from "@/components/ui/section-header";
import { TabList, tabDomId, tabPanelDomId } from "@/components/ui/tab-list";
import { ANALYTICS_TABS, resolveAnalyticsTab, type AnalyticsTabId } from "@/lib/analytics/screen";
import type { ProjectOption } from "@/lib/projects/selection";

/**
 * The Analytics screen over stored data only (Phase 4, checkpoint 4.3).
 *
 * One stored project, chosen on the screen. The tiles are the latest stored
 * Search Console window (decision Q6: that window only, no delta). Overview
 * adds the live Search Console panel with its stored-history comparison
 * (P4a/P4d); Pages the Search Console pages and the stored query × page
 * pairs (P4c); Learnings the project's completed performance-review runs
 * (decision Q2). The modelled series, segments, attribution and movements
 * are gone from this screen (hidden, not labelled): nothing this product
 * stores backs them. Snapshots are kept for the 30-day window only, so the
 * screen reads that window.
 */

const TABS = ANALYTICS_TABS satisfies readonly { id: string; label: string; icon: IconName }[];

export function AnalyticsWorkspace({
  projects,
}: {
  /** The stored roster, read on the server from the Projects repository. */
  projects: readonly ProjectOption[];
}) {
  const searchParams = useSearchParams();
  const selectId = useId();
  const initialProject = searchParams.get("project");

  const [projectId, setProjectId] = useState<string | null>(() =>
    initialProject !== null && projects.some((p) => p.id === initialProject) ? initialProject : (projects[0]?.id ?? null),
  );
  const [tab, setTab] = useState<AnalyticsTabId>(() => resolveAnalyticsTab(searchParams.get("tab")));
  const projectName = projects.find((p) => p.id === projectId)?.name ?? "the project";

  return (
    <div className="space-y-6">
      <SectionHeader
        size="page"
        title="Analytics"
        description={`What Google reported for ${projectName} in this product's stored Search Console snapshots, and what the Analytics & Learning agent read from it. Observed data only.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent" title="Read from Search Console snapshots this product stored and from its own agent runs. Figures are Google's. Not fixture data.">
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
                  onChange={(event) => setProjectId(event.target.value)}
                  options={projects.map((p) => ({ value: p.id, label: p.name }))}
                />
              </>
            )}
          </div>
        }
      />

      {projects.length === 0 && (
        <Panel>
          <EmptyState icon="projects" title="No stored project" description="Analytics reads a stored project's own Search Console snapshots and agent runs. Add a project on the Projects screen." />
        </Panel>
      )}

      {projectId !== null && (
        <>
          <LatestWindowTiles key={projectId} projectId={projectId} readiness={tab === "overview"} />

          <TabList tabs={TABS} value={tab} onChange={setTab} label="Analytics sections" idPrefix="analytics" />

          <div role="tabpanel" id={tabPanelDomId("analytics", tab)} aria-labelledby={tabDomId("analytics", tab)} tabIndex={0} className="space-y-4 focus-visible:outline-none">
            {tab === "overview" && <SearchConsolePanel projectId={projectId} rangeId="30d" view="summary" />}
            {tab === "pages" && (
              <>
                <SearchConsolePanel projectId={projectId} rangeId="30d" view="pages" />
                <Panel>
                  <PanelHeader eyebrow="Stored query × page pairs" title="Query-to-page overlap" description="Which pages Google showed for the same query in the newest stored pair window. Candidates for review, never a confirmed cannibalisation." />
                  <SearchConsoleQueryPages key={projectId} projectId={projectId} />
                </Panel>
              </>
            )}
            {tab === "learnings" && <LearningsList key={projectId} projectId={projectId} />}
          </div>
        </>
      )}
    </div>
  );
}
