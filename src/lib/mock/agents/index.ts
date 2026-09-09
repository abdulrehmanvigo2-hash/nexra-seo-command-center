import {
  DATA_AS_OF,
  clamp,
  jitter,
  minutesBefore,
  round,
} from "@/lib/mock/dashboard/core";
import { formatCompact, formatNumber, formatPercent } from "@/lib/format";
import { healthOf } from "@/lib/health";
import { AGENT_REGISTRY, getAgentRecord } from "@/lib/mock/agents/registry";
import { workloadBandOf } from "@/lib/mock/agents/meta";
import { projectsForAgent, sharedProjectCount } from "@/lib/mock/agents/assignments";
import { activityForAgent } from "@/lib/mock/agents/activity";
import { blockersForAgent, getAgentBlockers } from "@/lib/mock/agents/blockers";
import {
  getAgentHandoffs,
  handoffsForAgent,
  openHandoffCount,
} from "@/lib/mock/agents/handoffs";
import { outputsForAgent } from "@/lib/mock/agents/outputs";
import { getAgentTasks, tasksForAgent } from "@/lib/mock/agents/tasks";
import { activeWorkflowCount } from "@/lib/mock/agents/workflows";
import {
  AGENT_RANGE,
  operationFor,
  operationsFor,
} from "@/lib/mock/agents/operations";
import { PROJECTS, getProjectRecord } from "@/lib/mock/projects/roster";
import type {
  Agent,
  AgentAssignment,
  AgentCollaboration,
  AgentConfiguration,
  AgentDetail,
  AgentListItem,
  AgentMetric,
  AgentPerformance,
  AgentStatus,
  AgentTask,
  AgentWorkload,
  TeamHealth,
} from "@/types/agent";

/**
 * Single entry point for the AI Agents module's mock data.
 *
 * Import from `@/lib/mock/agents` and the shapes from `@/types/agent`; the
 * files behind this one are implementation detail. Everything returned is a
 * fixture — there is no API, database, agent runtime, or model provider in
 * this milestone (CLAUDE.md §4).
 *
 * Nothing in this module invents an agent's state. A roster row is assembled
 * from records the rest of the product already holds: the registry says who an
 * agent is, the Projects roster says which engagements it is staffed on, and
 * the Command Center's own builder says what it is doing on each of them. That
 * is why the status on an agent's card, the status on a project's team panel,
 * and the status on the dashboard agree — they are readings of one dataset,
 * not three datasets that happen to look alike.
 */

export {
  AGENT_REGISTRY,
  AGENT_IDS,
  AGENT_NAMES,
  getAgentRecord,
} from "@/lib/mock/agents/registry";

export {
  AGENT_CATEGORY_META,
  AGENT_CATEGORY_ORDER,
  AGENT_STATUS_META,
  AGENT_STATUS_ORDER,
  AGENT_TASK_DUE_META,
  AGENT_TASK_STATUS_META,
  AGENT_TASK_STATUS_ORDER,
  ATTENTION_STATUSES,
  BLOCKER_KIND_META,
  BLOCKER_KIND_ORDER,
  BLOCKER_RESOLUTION_META,
  HANDOFF_STATUS_CYCLE,
  HANDOFF_STATUS_META,
  HANDOFF_STATUS_ORDER,
  OUTPUT_STATUS_META,
  WORKFLOW_STATE_META,
  WORKLOAD_META,
  WORKLOAD_ORDER,
  workloadBandOf,
} from "@/lib/mock/agents/meta";

export { getAgentTasks, tasksForAgent } from "@/lib/mock/agents/tasks";
export { getAgentOutputs, outputsForAgent } from "@/lib/mock/agents/outputs";
export {
  getAgentHandoffs,
  handoffsForAgent,
} from "@/lib/mock/agents/handoffs";
export {
  blockerAgeDays,
  blockersForAgent,
  getAgentBlockers,
} from "@/lib/mock/agents/blockers";
export { activityForAgent, getAgentActivity } from "@/lib/mock/agents/activity";
export { getAgentWorkflows } from "@/lib/mock/agents/workflows";
export { projectsForAgent } from "@/lib/mock/agents/assignments";

/** The instant every agent fixture is written against. */
export const AGENTS_AS_OF = DATA_AS_OF;

/** Window the roster's numbers are measured over. */
export const AGENTS_RANGE_CAPTION = AGENT_RANGE.caption;

/**
 * Severity order, used to break ties and to decide which project a roster row
 * points at. Worse news wins.
 */
const STATUS_PRECEDENCE: readonly AgentStatus[] = [
  "blocked",
  "needs-review",
  "working",
  "active",
  "waiting",
  "completed",
];

/**
 * The agent's state across the portfolio.
 *
 * What it is mostly doing, not the worst thing happening anywhere. An agent
 * staffed on nine engagements will be stuck on one of them most weeks, and
 * letting that single project set the headline would paint the whole roster
 * red and make the status filter useless.
 *
 * Nothing is hidden by this: an agent with a block anywhere still carries the
 * attention flag and the blocker count, and its blocked project is the one the
 * row points at. Ties go to the more serious state.
 */
function rollUpStatus(states: readonly AgentStatus[]): AgentStatus {
  if (states.length === 0) return "waiting";

  // Being stopped is the one state that carries regardless of how much else
  // the agent is getting done: an operations board that reads "working" while
  // an engagement sits stuck is not telling the truth about the team.
  if (states.includes("blocked")) return "blocked";

  const tally = new Map<AgentStatus, number>();
  for (const status of states) {
    tally.set(status, (tally.get(status) ?? 0) + 1);
  }

  return [...tally.entries()].sort(
    (a, b) =>
      b[1] - a[1] ||
      STATUS_PRECEDENCE.indexOf(a[0]) - STATUS_PRECEDENCE.indexOf(b[0]),
  )[0][0];
}

// ---------------------------------------------------------------------------
// Workload
// ---------------------------------------------------------------------------

/**
 * How loaded an agent is.
 *
 * Counted from the task board rather than estimated: work in flight costs a
 * full slot, a review or a queued task costs half of one, and a blocked task
 * still occupies the agent because it has not been handed anywhere.
 */
function buildWorkload(agent: Agent, tasks: readonly AgentTask[]): AgentWorkload {
  const activeTasks = tasks.filter((task) => task.status === "working").length;
  const queuedTasks = tasks.filter((task) => task.status === "queued").length;
  const reviewQueue = tasks.filter((task) => task.status === "review").length;
  const blocked = tasks.filter((task) => task.status === "blocked").length;

  const load = activeTasks + blocked + (queuedTasks + reviewQueue) * 0.5;
  const percent = Math.round((load / agent.capacity) * 100);
  const band = workloadBandOf(percent);

  const free = Math.max(0, agent.capacity - activeTasks - blocked);

  return {
    band,
    percent,
    activeTasks,
    queuedTasks,
    reviewQueue,
    capacity: agent.capacity,
    availability:
      band === "overloaded"
        ? `Past capacity — ${queuedTasks} task${queuedTasks === 1 ? "" : "s"} queued behind the current work.`
        : band === "high"
          ? `Near capacity — room for ${free} more task${free === 1 ? "" : "s"}.`
          : free > 0
            ? `Available for ${free} more task${free === 1 ? "" : "s"}.`
            : "Available once the current work clears.",
  };
}

// ---------------------------------------------------------------------------
// Quality
// ---------------------------------------------------------------------------

/**
 * The agent's output quality index.
 *
 * Its own baseline, spread wide enough that the quality filter and the
 * quality sort both separate the roster, then reduced by work that had to be
 * sent back — an agent whose output keeps returning for revision is not
 * scoring in the nineties.
 */
function qualityFor(agent: Agent, revisions: number, blocked: number): number {
  const base = 82 + jitter(agent.seed, 3, 15);
  return Math.round(clamp(base - revisions * 4.5 - blocked * 3, 40, 98));
}

// ---------------------------------------------------------------------------
// Roster rows
// ---------------------------------------------------------------------------

/** Output volume across the window, for the card's trend line. */
function sparkFor(agent: Agent, total: number): readonly number[] {
  const daily = Math.max(1, total / 30);
  return Array.from({ length: 14 }, (_, index) =>
    Math.max(0, Math.round(daily * (1 + jitter(agent.seed + index, 11, 0.45)))),
  );
}

function buildListItem(agent: Agent): AgentListItem {
  const states = operationsFor(agent.id);
  const tasks = tasksForAgent(agent.id);
  const blockers = blockersForAgent(agent.id);
  const { outgoing } = handoffsForAgent(agent.id);

  const status = rollUpStatus(states.map((entry) => entry.operation.status));
  const revisions = outgoing.filter(
    (handoff) => handoff.status === "needs-revision",
  ).length;
  const blockedTasks = tasks.filter((task) => task.status === "blocked").length;

  // Which project the row points at: the one in the most serious state, so a
  // block on one engagement is one click away even when the headline status
  // says the agent is working. Read from that project's own board, so it is
  // the same task its team panel shows.
  const engaged = [...states].sort(
    (a, b) =>
      STATUS_PRECEDENCE.indexOf(a.operation.status) -
      STATUS_PRECEDENCE.indexOf(b.operation.status),
  )[0];
  const engagedProject = engaged
    ? getProjectRecord(engaged.projectId)
    : undefined;
  const showProject =
    status === "working" ||
    status === "active" ||
    status === "needs-review" ||
    status === "blocked";

  const completedOutputs = states.reduce(
    (total, entry) => total + entry.operation.outputs,
    0,
  );
  const quality = qualityFor(agent, revisions, blockedTasks);

  return {
    id: agent.id,
    name: agent.name,
    title: agent.title,
    description: agent.description,
    category: agent.category,
    stage: agent.stage,
    icon: agent.icon,
    initials: agent.initials,
    specialties: agent.specialties,
    href: `/agents/${agent.id}`,
    status,
    currentFocus:
      engaged?.operation.currentTask ??
      "No work assigned on any active engagement.",
    currentProject:
      showProject && engagedProject
        ? { id: engagedProject.id, name: engagedProject.name }
        : null,
    progress: engaged?.operation.progress ?? 0,
    quality,
    qualityHealth: healthOf(quality),
    workload: buildWorkload(agent, tasks),
    projects: projectsForAgent(agent.id).map((project) => project.id),
    completedOutputs,
    outputLabel: agent.outputLabel,
    lastActivity: states.reduce(
      (latest, entry) =>
        Date.parse(entry.operation.lastActivity) > Date.parse(latest)
          ? entry.operation.lastActivity
          : latest,
      minutesBefore(900),
    ),
    blockers: blockers.length,
    attention:
      status === "blocked" ||
      status === "needs-review" ||
      blockers.some((blocker) => blocker.severity === "critical"),
    spark: sparkFor(agent, completedOutputs),
  };
}

let rosterCache: readonly AgentListItem[] | null = null;

/**
 * The agent roster, in orchestration order.
 *
 * Built once and cached: every row reads several projects' boards, and the
 * Agents page re-renders on every keystroke of its search field. The builders
 * are pure, so the cached result is the only result they could produce.
 */
export function getAgentList(): readonly AgentListItem[] {
  rosterCache ??= AGENT_REGISTRY.map(buildListItem);
  return rosterCache;
}

/** Ids of every agent with a workspace — used to prerender their routes. */
export function getAgentIds(): readonly string[] {
  return AGENT_REGISTRY.map((agent) => agent.id);
}

// ---------------------------------------------------------------------------
// Team health
// ---------------------------------------------------------------------------

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((carry, value) => carry + value, 0) / values.length;
}

/**
 * The health of the AI team as a whole.
 *
 * A composite of four readings that can each fail independently: how much of
 * the work is stuck, how much of the board has been delivered, whether the
 * team has capacity left, and how good the output is. Averaging them means no
 * single good number can hide a bad one.
 */
export function getTeamHealth(): TeamHealth {
  const roster = getAgentList();
  const tasks = getAgentTasks();
  const blockers = getAgentBlockers();
  const handoffs = getAgentHandoffs();

  const blockedTasks = tasks.filter((task) => task.status === "blocked").length;
  const reviewTasks = tasks.filter((task) => task.status === "review").length;
  const completedTasks = tasks.filter(
    (task) => task.status === "completed",
  ).length;
  const activeTasks = tasks.length - completedTasks;

  const workingAgents = roster.filter(
    (agent) => agent.status === "working" || agent.status === "active",
  ).length;
  const blockedAgents = roster.filter(
    (agent) => agent.status === "blocked",
  ).length;
  const reviewAgents = roster.filter(
    (agent) => agent.status === "needs-review",
  ).length;

  const completionRate = tasks.length
    ? (completedTasks / tasks.length) * 100
    : 0;
  const averageQuality = mean(roster.map((agent) => agent.quality));
  const averageLoad = mean(roster.map((agent) => agent.workload.percent));
  const openHandoffs = handoffs.filter(
    (handoff) => handoff.status !== "accepted",
  ).length;
  const completedOutputs = roster.reduce(
    (total, agent) => total + agent.completedOutputs,
    0,
  );

  const flow = clamp(100 - (blockedTasks / Math.max(1, tasks.length)) * 260, 0, 100);
  const capacity = clamp(100 - Math.max(0, averageLoad - 80) * 2.5, 0, 100);
  // A live board is mostly unfinished by definition, so delivery is banded
  // against what a healthy window looks like — a third delivered is good —
  // rather than against everything being done.
  const delivery = clamp(completionRate * 3, 0, 100);
  const score = Math.round(mean([flow, capacity, averageQuality, delivery]));

  const metrics: readonly AgentMetric[] = [
    {
      id: "team-health",
      label: "Overall team health",
      value: String(score),
      unit: "/ 100",
      detail: "Flow, capacity, quality, and delivery combined",
      icon: "shield",
      health: healthOf(score),
    },
    {
      id: "capacity",
      label: "Operational capacity",
      value: formatPercent(round(averageLoad, 0), 0),
      unit: "in use",
      detail: `Mean load across ${roster.length} agents`,
      icon: "gauge",
      health: healthOf(clamp(100 - Math.max(0, averageLoad - 70), 0, 100)),
    },
    {
      id: "throughput",
      label: "Task throughput",
      value: formatNumber(completedTasks),
      unit: "delivered",
      detail: `${activeTasks} still open across the portfolio`,
      icon: "bolt",
    },
    {
      id: "blocked",
      label: "Blocked work",
      value: formatNumber(blockedTasks),
      unit: "tasks",
      detail: `${blockedAgents} agent${blockedAgents === 1 ? "" : "s"} stopped · ${blockers.length} items in the queue`,
      icon: "alert",
      health: blockedTasks > 0 ? "warning" : "positive",
    },
    {
      id: "review-queue",
      label: "Review queue",
      value: formatNumber(reviewTasks),
      unit: "waiting",
      detail: `${reviewAgents} agent${reviewAgents === 1 ? "" : "s"} awaiting a decision`,
      icon: "inbox",
      health: reviewTasks > 4 ? "warning" : "neutral",
    },
    {
      id: "handoffs",
      label: "Cross-agent handoffs",
      value: formatNumber(handoffs.length),
      unit: "tracked",
      detail: `${openHandoffs} still to be picked up or cleared`,
      icon: "layers",
    },
    {
      id: "completion-rate",
      label: "Completion rate",
      value: formatPercent(round(completionRate, 0), 0),
      detail: "Share of the board delivered this window",
      icon: "check",
      health: healthOf(delivery),
    },
    {
      id: "quality",
      label: "Average quality",
      value: String(Math.round(averageQuality)),
      unit: "/ 100",
      detail: `${formatCompact(completedOutputs)} artifacts filed this window`,
      icon: "sparkles",
      health: healthOf(averageQuality),
    },
  ];

  return {
    score,
    health: healthOf(score),
    summary:
      blockedAgents > 0
        ? `${blockedAgents} of ${roster.length} agents are stopped and ${reviewTasks} outputs are waiting on a decision.`
        : `All ${roster.length} agents are moving; ${reviewTasks} outputs are waiting on a decision.`,
    metrics,
    totalAgents: roster.length,
    workingAgents,
    blockedAgents,
    reviewAgents,
    activeTasks,
    completedOutputs,
    averageQuality: Math.round(averageQuality),
    lastOrchestration: minutesBefore(26),
  };
}

// ---------------------------------------------------------------------------
// Collaboration
// ---------------------------------------------------------------------------

function buildCollaboration(agent: Agent): AgentCollaboration {
  const collaborators = AGENT_REGISTRY.filter((other) => other.id !== agent.id)
    .map((other) => ({
      agent: other.id,
      sharedProjects: sharedProjectCount(agent.id, other.id),
    }))
    .filter((entry) => entry.sharedProjects > 0)
    .sort(
      (a, b) =>
        b.sharedProjects - a.sharedProjects ||
        (getAgentRecord(a.agent)?.stage ?? 0) -
          (getAgentRecord(b.agent)?.stage ?? 0),
    );

  return {
    agent: agent.id,
    name: agent.name,
    initials: agent.initials,
    stage: agent.stage,
    upstream: agent.upstream,
    downstream: agent.downstream,
    collaborators,
    activeWorkflows: activeWorkflowCount(agent.id),
    openHandoffs: openHandoffCount(agent.id),
  };
}

let collaborationCache: readonly AgentCollaboration[] | null = null;

/** The collaboration matrix, in orchestration order. */
export function getCollaborationMatrix(): readonly AgentCollaboration[] {
  collaborationCache ??= AGENT_REGISTRY.map(buildCollaboration);
  return collaborationCache;
}

// ---------------------------------------------------------------------------
// Agent workspace
// ---------------------------------------------------------------------------

function buildAssignments(agent: Agent): readonly AgentAssignment[] {
  return projectsForAgent(agent.id).map((project): AgentAssignment => {
    const operation = operationFor(project.id, agent.id);
    const openIssues = project.openIssues;

    return {
      projectId: project.id,
      projectName: project.name,
      client: project.client,
      initials: project.initials,
      href: `/projects/${project.id}`,
      projectStatus: project.status,
      responsibility: agent.responsibility,
      currentTask:
        operation?.currentTask ?? "No work scheduled on this engagement.",
      progress: operation?.progress ?? 0,
      agentStatus: operation?.status ?? "waiting",
      health: project.health,
      healthState: project.healthState,
      openIssues,
      attention: operation?.attention ?? false,
    };
  });
}

function buildPerformance(
  agent: Agent,
  listItem: AgentListItem,
  tasks: readonly AgentTask[],
): AgentPerformance {
  const completed = tasks.filter((task) => task.status === "completed").length;
  const inProgress = tasks.filter((task) => task.status === "working").length;

  const reworkRate = round(
    clamp(4 + jitter(agent.seed, 5, 6) + (100 - listItem.quality) * 0.35, 2, 28),
    1,
  );

  return {
    tasksCompleted: completed,
    tasksInProgress: inProgress,
    averageCompletionHours: round(
      clamp(6 + jitter(agent.seed, 6, 5) + agent.capacity * 1.8, 4, 96),
      1,
    ),
    quality: listItem.quality,
    reviewPassRate: round(clamp(100 - reworkRate * 1.6, 40, 99), 1),
    reworkRate,
    outputVolume: listItem.completedOutputs,
    projectsSupported: listItem.projects.length,
    trend: {
      quality: { value: round(jitter(agent.seed, 7, 4.5), 1) },
      throughput: { value: round(2 + jitter(agent.seed, 8, 11), 1) },
      completionTime: { value: round(jitter(agent.seed, 9, 9), 1), invert: true },
    },
    series: buildSeries(agent, listItem.completedOutputs),
    labels: WEEK_LABELS,
  };
}

/** Twelve weekly buckets, oldest first. */
const WEEK_LABELS: readonly string[] = Array.from(
  { length: 12 },
  (_, index) => `W${index + 1}`,
);

function buildSeries(agent: Agent, total: number): readonly number[] {
  const weekly = Math.max(1, (total / 30) * 7);
  return WEEK_LABELS.map((_, index) =>
    Math.max(
      0,
      Math.round(
        weekly * (0.72 + index * 0.045) * (1 + jitter(agent.seed + index, 13, 0.22)),
      ),
    ),
  );
}

function buildConfiguration(
  agent: Agent,
  listItem: AgentListItem,
): AgentConfiguration {
  return {
    displayName: agent.name,
    status: listItem.status,
    defaultPriority: agent.defaultPriority,
    maxConcurrent: agent.capacity,
    // The two agents on every engagement are staffed automatically; the
    // specialists are staffed when a project needs them.
    autoAssign: agent.stage <= 2,
    reviewRequired: agent.reviewRequired,
  };
}

/**
 * Everything one agent's workspace renders.
 *
 * Returns null for an unknown id so the route can render a not-found page
 * rather than inventing an agent.
 */
export function getAgentDetail(agentId: string): AgentDetail | null {
  const agent = getAgentRecord(agentId);
  if (!agent) return null;

  const listItem =
    getAgentList().find((entry) => entry.id === agent.id) ??
    buildListItem(agent);
  const tasks = tasksForAgent(agent.id);
  const { incoming, outgoing } = handoffsForAgent(agent.id);

  return {
    agent,
    listItem,
    generatedAt: DATA_AS_OF,
    rangeCaption: AGENT_RANGE.caption,
    performance: buildPerformance(agent, listItem, tasks),
    assignments: buildAssignments(agent),
    tasks,
    outputs: outputsForAgent(agent.id),
    activity: activityForAgent(agent.id),
    blockers: blockersForAgent(agent.id),
    incoming,
    outgoing,
    upstream: agent.upstream.flatMap((id) => {
      const record = getAgentRecord(id);
      return record ? [record] : [];
    }),
    downstream: agent.downstream.flatMap((id) => {
      const record = getAgentRecord(id);
      return record ? [record] : [];
    }),
    collaboration: buildCollaboration(agent),
    configuration: buildConfiguration(agent, listItem),
  };
}

/** Agents assigned to at least one project, for the roster's project filter. */
export function getAssignedProjectOptions(): readonly {
  readonly id: string;
  readonly name: string;
}[] {
  return PROJECTS.map((project) => ({ id: project.id, name: project.name }));
}
