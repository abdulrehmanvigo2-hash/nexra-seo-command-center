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
import { KeywordSnapshot } from "@/components/dashboard/keyword-snapshot";
import { KpiGrid, ScoreStrip } from "@/components/dashboard/metric-cards";
import { PerformanceChart } from "@/components/dashboard/performance-chart";
import { PriorityActions } from "@/components/dashboard/priority-actions";
import { TechnicalSnapshot } from "@/components/dashboard/technical-snapshot";
import { SectionHeader } from "@/components/ui/section-header";
import {
  DEFAULT_PROJECT_ID,
  DEFAULT_RANGE_ID,
  getDashboardSnapshot,
} from "@/lib/mock/dashboard";
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
 */
export function CommandCenter() {
  const [projectId, setProjectId] = useState<ProjectId>(DEFAULT_PROJECT_ID);
  const [rangeId, setRangeId] = useState<RangeId>(DEFAULT_RANGE_ID);

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

  const snapshot = useMemo(
    () => getDashboardSnapshot(projectId, rangeId),
    [projectId, rangeId],
  );

  const selectProject = (id: ProjectId) => {
    setProjectId(id);
    setRefreshedNow(false);
  };

  const selectRange = (id: RangeId) => {
    setRangeId(id);
    setRefreshedNow(false);
  };

  /**
   * Re-reads the fixtures. There is no network in this milestone, so the busy
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

  /** Queues an analysis run. Mock interaction: no agent runtime exists yet. */
  const runAnalysis = () => {
    setAnalysisQueued(true);
    schedule(() => setAnalysisQueued(false), 4_000);
  };

  return (
    <div className="space-y-6">
      <DashboardHeader
        project={snapshot.project}
        onProjectChange={selectProject}
        range={rangeId}
        onRangeChange={selectRange}
        generatedAt={snapshot.generatedAt}
        refreshing={refreshing}
        refreshedNow={refreshedNow}
        onRefresh={refresh}
        analysisQueued={analysisQueued}
        onRunAnalysis={runAnalysis}
      />

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
