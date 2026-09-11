"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Icon, type IconName } from "@/components/icons";
import { AgentOperations } from "@/components/dashboard/agent-operations";
import { ContentSnapshot } from "@/components/dashboard/content-snapshot";
import { KeywordSnapshot } from "@/components/dashboard/keyword-snapshot";
import { ScoreStrip } from "@/components/dashboard/metric-cards";
import { PerformanceChart } from "@/components/dashboard/performance-chart";
import { TechnicalSnapshot } from "@/components/dashboard/technical-snapshot";
import { SectionHeader } from "@/components/ui/section-header";
import { cn } from "@/lib/cn";
import { CURRENT_USER } from "@/lib/mock/workspace";
import { getProjectDetail } from "@/lib/mock/projects";
import { ProjectCompetitors, type PendingCompetitor } from "@/components/projects/project-competitors";
import { ProjectDetailHeader } from "@/components/projects/project-detail-header";
import { ProjectIssues } from "@/components/projects/project-issues";
import { ProjectAiStrip } from "@/components/projects/project-ai-strip";
import { ProjectAuthorityStrip } from "@/components/projects/project-authority-strip";
import { ProjectMetrics } from "@/components/projects/project-metrics";
import { ProjectNotes } from "@/components/projects/project-notes";
import { ProjectSettingsPanel } from "@/components/projects/project-settings";
import { ProjectTasks } from "@/components/projects/project-tasks";
import { ProjectTeamPreview } from "@/components/projects/project-team";
import { DEFAULT_RANGE_ID } from "@/lib/mock/dashboard";
import type { RangeId } from "@/types/dashboard";
import type {
  ProjectIssueStatus,
  ProjectNote,
  ProjectSettings,
  ProjectTaskStatus,
} from "@/types/project";

/**
 * One project's workspace.
 *
 * Owns everything that has to survive a tab change: the selected window, the
 * edited settings, the issue and task states, the competitor set, and any
 * notes added in this session. The tabs themselves are presentational — a tab
 * that owned its own state would lose it the moment the user looked at another
 * one.
 *
 * The snapshots on the keyword, content, and technical tabs are the Command
 * Center's own panels, rendered against this project's data. That is the point
 * of the shared fixture layer: the project shows the same numbers the
 * dashboard shows when it is selected there.
 */

const TABS = [
  { id: "overview", label: "Overview", icon: "command-center" },
  { id: "performance", label: "Performance", icon: "analytics" },
  { id: "issues", label: "Issues", icon: "alert" },
  { id: "tasks", label: "Tasks", icon: "inbox" },
  { id: "keywords", label: "Keywords", icon: "keywords" },
  { id: "content", label: "Content", icon: "content" },
  { id: "technical", label: "Technical", icon: "technical" },
  { id: "competitors", label: "Competitors", icon: "competitors" },
  { id: "team", label: "Team", icon: "agents" },
  { id: "notes", label: "Notes", icon: "note" },
  { id: "settings", label: "Settings", icon: "settings" },
] as const satisfies readonly {
  id: string;
  label: string;
  icon: IconName;
}[];

type TabId = (typeof TABS)[number]["id"];

export function ProjectWorkspace({ projectId }: { projectId: string }) {
  const [tab, setTab] = useState<TabId>("overview");
  const [rangeId, setRangeId] = useState<RangeId>(DEFAULT_RANGE_ID);

  const detail = useMemo(
    () => getProjectDetail(projectId, rangeId),
    [projectId, rangeId],
  );

  const [settings, setSettings] = useState<ProjectSettings | null>(() =>
    detail ? settingsOf(detail.project) : null,
  );
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [analysisQueued, setAnalysisQueued] = useState(false);

  const [issueStatuses, setIssueStatuses] = useState<
    Record<string, ProjectIssueStatus>
  >({});
  const [taskStatuses, setTaskStatuses] = useState<
    Record<string, ProjectTaskStatus>
  >({});

  const [removedCompetitors, setRemovedCompetitors] = useState<readonly string[]>(
    [],
  );
  const [addedCompetitors, setAddedCompetitors] = useState<
    readonly PendingCompetitor[]
  >([]);
  const [addedNotes, setAddedNotes] = useState<readonly ProjectNote[]>([]);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
    };
  }, []);

  const schedule = (callback: () => void, delay: number) => {
    timers.current.push(setTimeout(callback, delay));
  };

  const tablistRef = useRef<HTMLDivElement>(null);

  if (!detail || !settings) return null;

  const competitors = detail.competitors.filter(
    (competitor) => !removedCompetitors.includes(competitor.id),
  );

  const notes = [...addedNotes, ...detail.notes].sort(
    (a, b) => Date.parse(b.at) - Date.parse(a.at),
  );

  /** Roving focus across the tab strip, as a tablist is expected to behave. */
  const handleTabKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
    if (!keys.includes(event.key)) return;

    event.preventDefault();
    const index = TABS.findIndex((entry) => entry.id === tab);
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % TABS.length
        : event.key === "ArrowLeft"
          ? (index - 1 + TABS.length) % TABS.length
          : event.key === "Home"
            ? 0
            : TABS.length - 1;

    setTab(TABS[next].id);
    tablistRef.current
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [next]?.focus();
  };

  const changeIssueStatus = (id: string, status: ProjectIssueStatus) =>
    setIssueStatuses((current) => ({ ...current, [id]: status }));

  const changeTaskStatus = (id: string, status: ProjectTaskStatus) =>
    setTaskStatuses((current) => ({ ...current, [id]: status }));

  const saveSettings = (next: ProjectSettings) => {
    setSettings(next);
    setSavedAt(detail.generatedAt);
    schedule(() => setSavedAt(null), 5_000);
  };

  const runAnalysis = () => {
    setAnalysisQueued(true);
    schedule(() => setAnalysisQueued(false), 4_000);
  };

  const addNote = (body: string) =>
    setAddedNotes((current) => [
      {
        id: `session-note-${current.length + 1}`,
        body,
        author: CURRENT_USER.name,
        role: CURRENT_USER.role,
        at: detail.generatedAt,
        source: "team",
      },
      ...current,
    ]);

  const addCompetitor = (domain: string) =>
    setAddedCompetitors((current) => [
      ...current,
      { id: `session-competitor-${domain}`, domain },
    ]);

  const removeCompetitor = (id: string) => {
    if (id.startsWith("session-competitor-")) {
      setAddedCompetitors((current) =>
        current.filter((competitor) => competitor.id !== id),
      );
      return;
    }
    setRemovedCompetitors((current) => [...current, id]);
  };

  return (
    <div className="space-y-6">
      <ProjectDetailHeader
        project={detail.project}
        settings={settings}
        range={rangeId}
        onRangeChange={setRangeId}
        generatedAt={detail.generatedAt}
        analysisQueued={analysisQueued}
        onRunAnalysis={runAnalysis}
      />

      <div className="relative -mx-1 overflow-x-auto px-1">
        <div
          ref={tablistRef}
          role="tablist"
          aria-label="Project sections"
          onKeyDown={handleTabKeys}
          className="inline-flex min-w-full items-center gap-1 border-b border-border"
        >
          {TABS.map((entry) => {
            const selected = entry.id === tab;

            return (
              <button
                key={entry.id}
                type="button"
                role="tab"
                id={`tab-${entry.id}`}
                aria-selected={selected}
                aria-controls={`panel-${entry.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setTab(entry.id)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-[12.5px] font-medium whitespace-nowrap transition-colors",
                  selected
                    ? "border-accent text-fg"
                    : "border-transparent text-fg-subtle hover:text-fg-muted",
                )}
              >
                <Icon name={entry.icon} className="h-3.5 w-3.5" />
                {entry.label}
              </button>
            );
          })}
        </div>
      </div>

      <div
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        tabIndex={0}
        className="space-y-4 focus-visible:outline-none"
      >
        {tab === "overview" && (
          <>
            <section className="space-y-3">
              <SectionHeader
                as="h3"
                title="Project health"
                description={`Six indices for ${settings.name} over the ${detail.range.caption.toLowerCase()}.`}
              />
              <ScoreStrip scores={detail.health} loading={false} />
            </section>

            <ProjectMetrics metrics={detail.metrics} />

            <ProjectAiStrip projectId={detail.project.id} />

            <ProjectAuthorityStrip projectId={detail.project.id} />

            <div className="grid gap-4 xl:grid-cols-3">
              <div className="xl:col-span-2">
                <ProjectIssues
                  issues={detail.issues}
                  statuses={issueStatuses}
                  onStatusChange={changeIssueStatus}
                  preview
                  onViewAll={() => setTab("issues")}
                />
              </div>
              <ProjectTeamPreview
                team={detail.team}
                referenceIso={detail.generatedAt}
                onViewAll={() => setTab("team")}
              />
            </div>

            <ProjectTasks
              tasks={detail.tasks}
              statuses={taskStatuses}
              onStatusChange={changeTaskStatus}
              preview
              onViewAll={() => setTab("tasks")}
            />
          </>
        )}

        {tab === "performance" && (
          <>
            <ProjectMetrics metrics={detail.metrics} />
            <PerformanceChart
              trend={detail.trend}
              range={rangeId}
              onRangeChange={setRangeId}
              loading={false}
            />
          </>
        )}

        {tab === "issues" && (
          <ProjectIssues
            issues={detail.issues}
            statuses={issueStatuses}
            onStatusChange={changeIssueStatus}
          />
        )}

        {tab === "tasks" && (
          <ProjectTasks
            tasks={detail.tasks}
            statuses={taskStatuses}
            onStatusChange={changeTaskStatus}
          />
        )}

        {tab === "keywords" && (
          <KeywordSnapshot
            snapshot={detail.keywords}
            projectId={detail.project.id}
          />
        )}

        {tab === "content" && (
          <ContentSnapshot
            snapshot={detail.content}
            projectId={detail.project.id}
          />
        )}

        {tab === "technical" && (
          <TechnicalSnapshot
            snapshot={detail.technical}
            referenceIso={detail.generatedAt}
            projectId={detail.project.id}
          />
        )}

        {tab === "competitors" && (
          <ProjectCompetitors
            competitors={competitors}
            pending={addedCompetitors}
            onAdd={addCompetitor}
            onRemove={removeCompetitor}
            projectId={detail.project.id}
            projectName={settings.name}
          />
        )}

        {tab === "team" && (
          <AgentOperations
            agents={detail.team}
            referenceIso={detail.generatedAt}
            eyebrow="Assigned agents"
            title="Project Agent Team"
            description={`The specialists staffed on ${settings.name}, their current task, and where the pipeline is waiting on a decision.`}
          />
        )}

        {tab === "notes" && (
          <ProjectNotes
            notes={notes}
            onAdd={addNote}
            referenceIso={detail.generatedAt}
          />
        )}

        {tab === "settings" && (
          <ProjectSettingsPanel
            settings={settings}
            onSave={saveSettings}
            savedAt={savedAt}
          />
        )}
      </div>
    </div>
  );
}

function settingsOf(project: {
  name: string;
  client: string;
  domain: string;
  industry: string;
  market: string;
  language: string;
  goal: ProjectSettings["goal"];
  status: ProjectSettings["status"];
}): ProjectSettings {
  return {
    name: project.name,
    client: project.client,
    domain: project.domain,
    industry: project.industry,
    market: project.market,
    language: project.language,
    goal: project.goal,
    status: project.status,
  };
}
