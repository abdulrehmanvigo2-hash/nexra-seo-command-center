"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Icon, type IconName } from "@/components/icons";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { SectionHeader } from "@/components/ui/section-header";
import { getAgentDetail } from "@/lib/mock/agents";
import { AgentAssignments } from "@/components/agents/agent-assignments";
import { AgentBlockers } from "@/components/agents/agent-blockers";
import { AgentBriefPanel } from "@/components/agents/agent-brief";
import { AgentConfigurationPanel } from "@/components/agents/agent-configuration";
import { AgentDetailHeader } from "@/components/agents/agent-detail-header";
import { AgentHandoffs } from "@/components/agents/agent-handoffs";
import { AgentOutputs } from "@/components/agents/agent-outputs";
import { AgentPerformancePanel } from "@/components/agents/agent-performance";
import { AgentTasks } from "@/components/agents/agent-tasks";
import { CollaborationMatrix } from "@/components/agents/collaboration-matrix";
import { ScoreReading, WorkloadReading } from "@/components/agents/agent-chrome";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { TabList, tabDomId, tabPanelDomId } from "@/components/ui/tab-list";
import type {
  AgentConfiguration,
  AgentTaskStatus,
  BlockerResolution,
  HandoffStatus,
} from "@/types/agent";

/**
 * One agent's workspace.
 *
 * Owns everything that has to survive a tab change: the edited configuration,
 * the task and hand-off states, and the blocker resolutions changed in this
 * session. The tabs themselves are presentational — a tab that owned its own
 * state would lose it the moment the user looked at another one.
 *
 * The panels are the same ones the Agents overview renders, scoped to this
 * agent. That is the point of the shared fixture layer: an agent's tasks here
 * are the tasks the team board shows for it, because they are the same records.
 */

const TABS = [
  { id: "overview", label: "Overview", icon: "command-center" },
  { id: "performance", label: "Performance", icon: "analytics" },
  { id: "projects", label: "Projects", icon: "projects" },
  { id: "tasks", label: "Tasks", icon: "inbox" },
  { id: "outputs", label: "Outputs", icon: "brief" },
  { id: "handoffs", label: "Handoffs", icon: "handoff" },
  { id: "blockers", label: "Blockers", icon: "alert" },
  { id: "activity", label: "Activity", icon: "activity" },
  { id: "collaboration", label: "Collaboration", icon: "workflow" },
  { id: "brief", label: "Brief", icon: "note" },
  { id: "settings", label: "Settings", icon: "settings" },
] as const satisfies readonly {
  id: string;
  label: string;
  icon: IconName;
}[];

type TabId = (typeof TABS)[number]["id"];

export function AgentWorkspace({ agentId }: { agentId: string }) {
  const [tab, setTab] = useState<TabId>("overview");

  const detail = useMemo(() => getAgentDetail(agentId), [agentId]);

  const [configuration, setConfiguration] = useState<AgentConfiguration | null>(
    () => detail?.configuration ?? null,
  );
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [syncQueued, setSyncQueued] = useState(false);

  const [taskStatuses, setTaskStatuses] = useState<
    Record<string, AgentTaskStatus>
  >({});
  const [handoffStatuses, setHandoffStatuses] = useState<
    Record<string, HandoffStatus>
  >({});
  const [resolutions, setResolutions] = useState<
    Record<string, BlockerResolution>
  >({});

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
    };
  }, []);

  if (!detail || !configuration) return null;

  const schedule = (callback: () => void, delay: number) => {
    timers.current.push(setTimeout(callback, delay));
  };

  const saveConfiguration = (next: AgentConfiguration) => {
    setConfiguration(next);
    setSavedAt(detail.generatedAt);
    schedule(() => setSavedAt(null), 5_000);
  };

  const runSync = () => {
    setSyncQueued(true);
    schedule(() => setSyncQueued(false), 4_000);
  };

  const changeTaskStatus = (id: string, status: AgentTaskStatus) =>
    setTaskStatuses((current) => ({ ...current, [id]: status }));

  const changeHandoffStatus = (id: string, status: HandoffStatus) =>
    setHandoffStatuses((current) => ({ ...current, [id]: status }));

  const resolveBlocker = (id: string, resolution: BlockerResolution) =>
    setResolutions((current) => ({ ...current, [id]: resolution }));

  const handoffs = [...detail.incoming, ...detail.outgoing];

  return (
    <div className="space-y-6">
      <AgentDetailHeader
        agent={detail.agent}
        listItem={detail.listItem}
        configuration={configuration}
        referenceIso={detail.generatedAt}
        queued={syncQueued}
        onRunSync={runSync}
      />

      <TabList
        tabs={TABS}
        value={tab}
        onChange={setTab}
        label="Agent sections"
        idPrefix="agent"
      />

      <div
        role="tabpanel"
        id={tabPanelDomId("agent", tab)}
        aria-labelledby={tabDomId("agent", tab)}
        tabIndex={0}
        className="space-y-4 focus-visible:outline-none"
      >
        {tab === "overview" && (
          <>
            <section className="space-y-3">
              <SectionHeader
                as="h3"
                title="Operating state"
                description={`What ${configuration.displayName} is carrying right now, over the ${detail.rangeCaption.toLowerCase()}.`}
              />

              <Panel as="div" className="p-4 sm:p-5">
                <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
                  <ScoreReading
                    score={detail.listItem.quality}
                    health={detail.listItem.qualityHealth}
                    caption="Quality score"
                    label={`${configuration.displayName} quality`}
                  />
                  <WorkloadReading
                    workload={detail.listItem.workload}
                    label={configuration.displayName}
                  />
                  <div className="min-w-0">
                    <p className="text-[11px] text-fg-subtle">Current focus</p>
                    <p className="mt-1.5 line-clamp-3 text-[12.5px] leading-snug text-fg-muted">
                      {detail.listItem.currentFocus}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] text-fg-subtle">Availability</p>
                    <p className="mt-1.5 text-[12.5px] leading-snug text-fg-muted">
                      {detail.listItem.workload.availability}
                    </p>
                  </div>
                </div>
              </Panel>
            </section>

            <AgentPerformancePanel
              performance={detail.performance}
              rangeCaption={detail.rangeCaption}
              outputLabel={detail.agent.outputLabel}
            />

            <div className="grid gap-4 xl:grid-cols-2">
              <AgentAssignments
                assignments={detail.assignments}
                agentName={configuration.displayName}
                responsibility={detail.agent.responsibility}
              />
              <AgentTasks
                tasks={detail.tasks}
                statuses={taskStatuses}
                onStatusChange={changeTaskStatus}
                referenceIso={detail.generatedAt}
                hideAgent
                preview
                onViewAll={() => setTab("tasks")}
                title="Assigned Tasks"
                description={`What ${configuration.displayName} is working on across its projects.`}
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <AgentBlockers
                blockers={detail.blockers}
                resolutions={resolutions}
                onResolve={resolveBlocker}
                referenceIso={detail.generatedAt}
                preview
                onViewAll={() => setTab("blockers")}
                title="Blockers"
                description={`What is stopping ${configuration.displayName} from moving work forward.`}
              />
              <AgentHandoffs
                handoffs={handoffs}
                statuses={handoffStatuses}
                onStatusChange={changeHandoffStatus}
                referenceIso={detail.generatedAt}
                preview
                onViewAll={() => setTab("handoffs")}
                title="Handoffs"
                description="Work arriving from the previous stage and leaving for the next."
              />
            </div>
          </>
        )}

        {tab === "performance" && (
          <AgentPerformancePanel
            performance={detail.performance}
            rangeCaption={detail.rangeCaption}
            outputLabel={detail.agent.outputLabel}
          />
        )}

        {tab === "projects" && (
          <AgentAssignments
            assignments={detail.assignments}
            agentName={configuration.displayName}
            responsibility={detail.agent.responsibility}
          />
        )}

        {tab === "tasks" && (
          <AgentTasks
            tasks={detail.tasks}
            statuses={taskStatuses}
            onStatusChange={changeTaskStatus}
            referenceIso={detail.generatedAt}
            hideAgent
            title="Assigned Tasks"
            description={`Every task ${configuration.displayName} owns, across all of its projects.`}
          />
        )}

        {tab === "outputs" && (
          <AgentOutputs
            outputs={detail.outputs}
            referenceIso={detail.generatedAt}
            totalVolume={detail.listItem.completedOutputs}
            outputLabel={detail.agent.outputLabel}
          />
        )}

        {tab === "handoffs" && (
          <div className="grid gap-4 xl:grid-cols-2">
            <AgentHandoffs
              handoffs={detail.incoming}
              statuses={handoffStatuses}
              onStatusChange={changeHandoffStatus}
              referenceIso={detail.generatedAt}
              title="Incoming"
              description={`Work arriving for ${configuration.displayName} from the previous stage.`}
            />
            <AgentHandoffs
              handoffs={detail.outgoing}
              statuses={handoffStatuses}
              onStatusChange={changeHandoffStatus}
              referenceIso={detail.generatedAt}
              title="Outgoing"
              description="Finished work leaving for the next stage of the pipeline."
            />
          </div>
        )}

        {tab === "blockers" && (
          <AgentBlockers
            blockers={detail.blockers}
            resolutions={resolutions}
            onResolve={resolveBlocker}
            referenceIso={detail.generatedAt}
            title="Blockers & Reviews"
            description={`Everything stopping ${configuration.displayName}, worst first.`}
          />
        )}

        {tab === "activity" && (
          <ActivityFeed
            events={detail.activity}
            referenceIso={detail.generatedAt}
            eyebrow="Audit trail"
            title="Recent Activity"
            description={`What ${configuration.displayName} has done across its projects, newest first.`}
            footnote="Modelled activity records — not produced by the agent runtime. Executed runs are listed under AI Agents → Run History."
          />
        )}

        {tab === "collaboration" && (
          <>
            <Panel>
              <PanelHeader
                eyebrow="Pipeline neighbours"
                title="Upstream and downstream"
                description={`Who ${configuration.displayName} receives work from, and who receives its work.`}
              />
              <PanelBody className="grid gap-4 sm:grid-cols-2">
                <NeighbourList
                  title="Receives from"
                  icon="arrow-left"
                  agents={detail.upstream}
                />
                <NeighbourList
                  title="Hands to"
                  icon="arrow-right"
                  agents={detail.downstream}
                />
              </PanelBody>
            </Panel>

            <CollaborationMatrix rows={[detail.collaboration]} />
          </>
        )}

        {tab === "brief" && <AgentBriefPanel agent={detail.agent} />}

        {tab === "settings" && (
          <AgentConfigurationPanel
            configuration={configuration}
            onSave={saveConfiguration}
            savedAt={savedAt}
            agentName={detail.agent.name}
          />
        )}
      </div>
    </div>
  );
}

function NeighbourList({
  title,
  icon,
  agents,
}: {
  title: string;
  icon: IconName;
  agents: readonly { id: string; name: string; title: string; initials: string }[];
}) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-fg-muted">
        <Icon name={icon} className="h-3.5 w-3.5 text-fg-subtle" />
        {title}
      </p>

      <ul className="mt-2.5 space-y-2">
        {agents.length === 0 && (
          <li className="text-[12px] text-fg-subtle">
            Nothing at this end of the loop.
          </li>
        )}
        {agents.map((agent) => (
          <li key={agent.id}>
            <a
              href={`/agents/${agent.id}`}
              className="flex items-center gap-2.5 rounded-md border border-border bg-surface-raised px-3 py-2.5 transition-colors hover:border-border-strong"
            >
              <span
                aria-hidden="true"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border-strong bg-surface text-[10.5px] font-semibold text-fg-subtle"
              >
                {agent.initials}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[12.5px] font-medium text-fg">
                  {agent.name}
                </span>
                <span className="block truncate text-[11px] text-fg-subtle">
                  {agent.title}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
