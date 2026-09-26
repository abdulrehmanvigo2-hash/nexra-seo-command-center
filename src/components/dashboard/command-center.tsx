"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { AgentOperations } from "@/components/dashboard/agent-operations";
import { AiVisibilitySnapshot } from "@/components/dashboard/ai-visibility-snapshot";
import { AlertsPanel } from "@/components/dashboard/alerts-panel";
import { AuthoritySnapshot } from "@/components/dashboard/authority-snapshot";
import { CompetitorSnapshot } from "@/components/dashboard/competitor-snapshot";
import { ContentSnapshot } from "@/components/dashboard/content-snapshot";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { AnalyticsSummary } from "@/components/dashboard/analytics-summary";
import { ReportingSummary } from "@/components/dashboard/reporting-summary";
import { KeywordSnapshot } from "@/components/dashboard/keyword-snapshot";
import { KpiGrid, ScoreStrip } from "@/components/dashboard/metric-cards";
import { PerformanceChart } from "@/components/dashboard/performance-chart";
import { PriorityActions } from "@/components/dashboard/priority-actions";
import { TechnicalSnapshot } from "@/components/dashboard/technical-snapshot";
import { UnmeasuredSelectionNotice } from "@/components/projects/unmeasured-selection-notice";
import { SectionHeader } from "@/components/ui/section-header";
import { DATA_AS_OF, getDashboardSnapshot } from "@/lib/mock/dashboard";
import {
  PORTFOLIO_OPTION,
  withPortfolioOption,
  type ProjectOption,
} from "@/lib/projects/selection";
import { usePreference } from "@/lib/preferences";
import type { ProjectId, RangeId } from "@/types/dashboard";

/**
 * The Command Center.
 *
 * Owns the two selections the whole page derives from — which project, over
 * what window — and hands the resulting snapshot to each section. Sections
 * keep their own local state (filters, sorting, expansion); nothing that is
 * purely local is lifted here.
 *
 * A client component because the selection is interactive. The snapshot
 * builder is pure and deterministic, so the server render and the first client
 * render produce identical markup.
 *
 * The roster arrives as a prop, read by the route through the Projects
 * repository, so every stored project is selectable here — not only the nine
 * the fixture layer models. What a stored project does *not* get is invented
 * figures: the snapshot builder knows nine ids and silently answers with the
 * roll-up for anything else, so an unmeasured selection is resolved before the
 * builder is called and the page says there is nothing to show instead.
 */
export function CommandCenter({
  projects,
}: {
  /** The Projects roster, read on the server from the Projects repository. */
  projects: readonly ProjectOption[];
}) {
  /**
   * The opening project and window come from Settings; an explicit choice
   * here overrides them for the rest of the session.
   *
   * Held as "chosen, or nothing yet" rather than seeded into `useState`: a
   * `useState` initialiser runs once, during hydration, while the preference
   * store is still reporting its server defaults — the stored value would
   * arrive a moment later and be ignored. Reading the preference in render
   * lets it apply as soon as it is available.
   */
  const preferredProject = usePreference("commandCenterProject");
  const preferredRange = usePreference("commandCenterRange");
  const [chosenProject, setChosenProject] = useState<ProjectId | null>(null);
  const [chosenRange, setChosenRange] = useState<RangeId | null>(null);

  const requestedProject = chosenProject ?? preferredProject;
  const rangeId = chosenRange ?? preferredRange;

  const options = useMemo(() => withPortfolioOption(projects), [projects]);

  /**
   * The selection, resolved against the roster that actually exists.
   *
   * A stored preference outlives the roster it was chosen from — a data source
   * switched, a project that is no longer listed — and an id nothing matches
   * would otherwise reach `getDashboardSnapshot`, which answers with the
   * roll-up for any id it does not know. That fallback is fine as a
   * destination and dangerous as a silent one, so it happens here, once, where
   * the header and the figures both read the same resolved option and agree on
   * what is on screen.
   */
  const project =
    options.find((option) => option.id === requestedProject) ?? PORTFOLIO_OPTION;
  const projectId = project.id;

  const [refreshing, setRefreshing] = useState(false);
  const [refreshedNow, setRefreshedNow] = useState(false);
  const [analysisQueued, setAnalysisQueued] = useState(false);

  // Timers are tracked so a selection change or an unmount cannot leave a
  // pending update to run against a stale state.
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
    };
  }, []);

  const schedule = (callback: () => void, delay: number) => {
    const timer = setTimeout(callback, delay);
    timers.current.push(timer);
  };

  // Nothing has measured this project, so nothing is built for it. The
  // builder is not called at all: every section below reads the snapshot, and
  // a snapshot for an unknown id is another project's numbers.
  const snapshot = useMemo(
    () => (project.measured ? getDashboardSnapshot(projectId, rangeId) : null),
    [project.measured, projectId, rangeId],
  );

  const selectProject = (id: ProjectId) => {
    setChosenProject(id);
    setRefreshedNow(false);
  };

  const selectRange = (id: RangeId) => {
    setChosenRange(id);
    setRefreshedNow(false);
  };

  /**
   * Re-reads the fixtures. This screen has no live fetch yet, so the busy
   * state is held briefly to show the loading treatment the real fetch would
   * put the cards through.
   */
  const refresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    schedule(() => {
      setRefreshing(false);
      setRefreshedNow(true);
    }, 700);
  };

  /** Simulates queueing an analysis. The real agent runtime is reached from the project workspace panels, not from this screen. */
  const runAnalysis = () => {
    setAnalysisQueued(true);
    schedule(() => setAnalysisQueued(false), 4_000);
  };

  const header = (
    <DashboardHeader
      project={project}
      projects={options}
      onProjectChange={selectProject}
      measured={project.measured}
      range={rangeId}
      onRangeChange={selectRange}
      generatedAt={snapshot?.generatedAt ?? DATA_AS_OF}
      refreshing={refreshing}
      refreshedNow={refreshedNow}
      onRefresh={refresh}
      analysisQueued={analysisQueued}
      onRunAnalysis={runAnalysis}
    />
  );

  /*
    An unmeasured project keeps the header — it is the only way back to
    another selection — and nothing else. Every section below this point is a
    view onto the snapshot, and there is no snapshot: showing them empty would
    read as zeroes, and showing them full would be some other project's work.
  */
  if (!snapshot) {
    return (
      <div className="space-y-6">
        {header}
        <UnmeasuredSelectionNotice name={project.name} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      <section className="space-y-3">
        <SectionHeader
          as="h3"
          title="Account health"
          description={`Six indices covering the whole account over the ${snapshot.range.caption.toLowerCase()}, with the volume metrics behind them.`}
        />
        <ScoreStrip scores={snapshot.scores} loading={refreshing} />
        <KpiGrid kpis={snapshot.kpis} loading={refreshing} />
      </section>

      <PerformanceChart
        trend={snapshot.trend}
        range={rangeId}
        onRangeChange={selectRange}
        loading={refreshing}
      />

      <AnalyticsSummary projectId={projectId} rangeId={rangeId} />

      <ReportingSummary projectId={projectId} />

      {/*
        Panels that hold their own filter, sort, or dismissal state are keyed
        on the project. Switching project replaces their rows entirely, so the
        key discards state that no longer applies instead of an effect
        clearing it after the fact.
      */}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <PriorityActions key={`actions-${projectId}`} actions={snapshot.actions} />
        </div>
        <AlertsPanel
          key={`alerts-${projectId}`}
          alerts={snapshot.alerts}
          referenceIso={snapshot.generatedAt}
        />
      </div>

      <AgentOperations
        key={`agents-${projectId}`}
        agents={snapshot.agents}
        referenceIso={snapshot.generatedAt}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <TechnicalSnapshot
          snapshot={snapshot.technical}
          referenceIso={snapshot.generatedAt}
          projectId={projectId}
        />
        <AiVisibilitySnapshot
          snapshot={snapshot.aiVisibility}
          projectId={projectId}
        />
      </div>

      <KeywordSnapshot
        key={`keywords-${projectId}`}
        snapshot={snapshot.keywords}
        projectId={projectId}
      />

      <ContentSnapshot
        key={`content-${projectId}`}
        snapshot={snapshot.content}
        projectId={projectId}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <CompetitorSnapshot
          snapshot={snapshot.competitors}
          projectId={projectId}
        />
        <AuthoritySnapshot
          snapshot={snapshot.authority}
          projectId={projectId}
        />
      </div>

      <ActivityFeed
        key={`activity-${projectId}`}
        events={snapshot.activity}
        referenceIso={snapshot.generatedAt}
      />
    </div>
  );
}
