"use client";

import { useMemo, useState } from "react";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelBody, PanelFooter } from "@/components/ui/panel";
import { SectionHeader } from "@/components/ui/section-header";
import {
  AGENTS_AS_OF,
  AGENTS_RANGE_CAPTION,
  getAgentActivity,
  getAgentBlockers,
  getAgentHandoffs,
  getAgentList,
  getAgentTasks,
  getAgentWorkflows,
  getAssignedProjectOptions,
  getCollaborationMatrix,
  getTeamHealth,
} from "@/lib/mock/agents";
import { AgentBlockers } from "@/components/agents/agent-blockers";
import { AgentRunHistory } from "@/components/agents/agent-run-history";
import { AgentCard } from "@/components/agents/agent-card";
import { AgentHandoffs } from "@/components/agents/agent-handoffs";
import { AgentTasks } from "@/components/agents/agent-tasks";
import { AgentsTable } from "@/components/agents/agents-table";
import { AgentsToolbar } from "@/components/agents/agents-toolbar";
import { CollaborationMatrix } from "@/components/agents/collaboration-matrix";
import { OrchestrationPipeline } from "@/components/agents/orchestration-pipeline";
import { TeamHealthSummary } from "@/components/agents/team-health";
import {
  EMPTY_AGENT_FILTERS,
  hasActiveAgentFilters,
  matchesAgentFilters,
  type AgentFilters,
} from "@/components/agents/filters";
import {
  AGENT_SORT_OPTIONS,
  compareAgents,
  type AgentSort,
} from "@/components/agents/sorting";
import {
  setAgentView,
  useAgentView,
  type AgentView,
} from "@/components/agents/view-preference";
import type {
  AgentStatus,
  AgentTaskStatus,
  BlockerResolution,
  HandoffStatus,
} from "@/types/agent";
import type { ProjectOption } from "@/lib/projects/selection";
import { ModelledSection } from "@/components/ui/modelled-badge";

/**
 * The AI Agents area: the team, what it is working on, and what is stopping it.
 *
 * Owns every piece of state that has to survive a filter change or a scroll —
 * the search and filter selection, the sort, and the task, handoff, and
 * blocker states changed in this session. The panels below are presentational;
 * one that owned its own state would lose it the moment the roster re-rendered.
 *
 * A client component because the selection is interactive. The data is built
 * by pure, deterministic functions, so the server render and the first client
 * render produce identical markup.
 */
export function AgentsWorkspace({ projects: storedProjects }: { projects: readonly ProjectOption[] }) {
  const roster = getAgentList();
  const health = getTeamHealth();
  const workflows = getAgentWorkflows();
  const tasks = getAgentTasks();
  const handoffs = getAgentHandoffs();
  const blockers = getAgentBlockers();
  const activity = getAgentActivity();
  const collaboration = getCollaborationMatrix();
  const projects = getAssignedProjectOptions();

  const [filters, setFilters] = useState<AgentFilters>(EMPTY_AGENT_FILTERS);
  const [sort, setSort] = useState<{ key: AgentSort; desc: boolean }>({
    key: "stage",
    desc: false,
  });

  const [taskStatuses, setTaskStatuses] = useState<
    Record<string, AgentTaskStatus>
  >({});
  const [handoffStatuses, setHandoffStatuses] = useState<
    Record<string, HandoffStatus>
  >({});
  const [resolutions, setResolutions] = useState<
    Record<string, BlockerResolution>
  >({});

  const view = useAgentView();

  const statusCounts = useMemo(() => {
    const tally = { all: roster.length } as Record<AgentStatus | "all", number>;
    for (const agent of roster) {
      tally[agent.status] = (tally[agent.status] ?? 0) + 1;
    }
    return tally;
  }, [roster]);

  const visible = useMemo(
    () =>
      roster
        .filter((agent) => matchesAgentFilters(agent, filters))
        .sort((a, b) => compareAgents(a, b, sort)),
    [roster, filters, sort],
  );

  const changeFilters = (patch: Partial<AgentFilters>) =>
    setFilters((current) => ({ ...current, ...patch }));

  /** Re-selecting the current key reverses it; a new key starts in its own default. */
  const changeSort = (key: AgentSort) =>
    setSort((current) =>
      current.key === key
        ? { key, desc: !current.desc }
        : {
            key,
            desc:
              AGENT_SORT_OPTIONS.find((option) => option.value === key)?.desc ??
              true,
          },
    );

  const changeView = (next: AgentView) => setAgentView(next);

  return (
    <div className="space-y-6">
      <SectionHeader
        size="page"
        title="AI Agents"
        description="The twelve specialist agents behind every project: what each is working on, how loaded it is, and where the pipeline is waiting."
      />

      <ModelledSection name="Team health">
        <TeamHealthSummary health={health} referenceIso={AGENTS_AS_OF} />
      </ModelledSection>

      <ModelledSection name="Agent roster figures">
      <Panel>
        <AgentsToolbar
          filters={filters}
          onFilterChange={changeFilters}
          onReset={() => setFilters(EMPTY_AGENT_FILTERS)}
          statusCounts={statusCounts}
          sort={sort}
          onSortChange={changeSort}
          view={view}
          onViewChange={changeView}
          projects={projects}
          total={roster.length}
          shown={visible.length}
        />

        {visible.length === 0 ? (
          <EmptyState
            icon="search"
            title="No agents match these filters"
            description="Nothing in the team matches the current search and filter combination."
            action={
              hasActiveAgentFilters(filters) ? (
                <Button
                  icon="close"
                  onClick={() => setFilters(EMPTY_AGENT_FILTERS)}
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : view === "grid" ? (
          <PanelBody>
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {visible.map((agent) => (
                <li key={agent.id} className="min-w-0">
                  <AgentCard agent={agent} referenceIso={AGENTS_AS_OF} />
                </li>
              ))}
            </ul>
          </PanelBody>
        ) : (
          <AgentsTable
            agents={visible}
            sort={sort}
            onSort={changeSort}
            referenceIso={AGENTS_AS_OF}
          />
        )}

        <PanelFooter>
          <span>
            All figures are mock data over the {AGENTS_RANGE_CAPTION.toLowerCase()}.
            Open an agent for its full workspace.
          </span>
          <span>
            {visible.length} of {roster.length} agents
          </span>
        </PanelFooter>
      </Panel>
      </ModelledSection>

      <ModelledSection name="Orchestration pipeline">
        <OrchestrationPipeline
          workflows={workflows}
          referenceIso={AGENTS_AS_OF}
        />
      </ModelledSection>

      <div className="grid gap-4 xl:grid-cols-2">
        <ModelledSection name="Agent tasks">
        <AgentTasks
          tasks={tasks}
          statuses={taskStatuses}
          onStatusChange={(id, status) =>
            setTaskStatuses((current) => ({ ...current, [id]: status }))
          }
          referenceIso={AGENTS_AS_OF}
        />
        </ModelledSection>
        <ModelledSection name="Blockers">
        <AgentBlockers
          blockers={blockers}
          resolutions={resolutions}
          onResolve={(id, resolution) =>
            setResolutions((current) => ({ ...current, [id]: resolution }))
          }
          referenceIso={AGENTS_AS_OF}
        />
        </ModelledSection>
      </div>

      <ModelledSection name="Handoffs">
      <AgentHandoffs
        handoffs={handoffs}
        statuses={handoffStatuses}
        onStatusChange={(id, status) =>
          setHandoffStatuses((current) => ({ ...current, [id]: status }))
        }
        referenceIso={AGENTS_AS_OF}
      />
      </ModelledSection>

      <ModelledSection name="Collaboration">
        <CollaborationMatrix rows={collaboration} />
      </ModelledSection>

      <AgentRunHistory projects={storedProjects} />

      <ModelledSection name="Recent activity">
      <ActivityFeed
        events={activity}
        referenceIso={AGENTS_AS_OF}
        eyebrow="Audit trail"
        title="Recent Agent Activity"
        description="What the twelve agents have done across every project, newest first."
        footnote="Modelled activity records — not produced by the agent runtime. Executed runs are listed in Run History."
      />
      </ModelledSection>
    </div>
  );
}
