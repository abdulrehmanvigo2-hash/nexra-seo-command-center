import { AGENT_REGISTRY, getAgentRecord } from "@/lib/mock/agents/registry";
import { operationsByProject } from "@/lib/mock/agents/operations";
import { getProjectList } from "@/lib/mock/projects";
import { PROJECTS } from "@/lib/mock/projects/roster";
import { formatNumber } from "@/lib/format";
import type { AgentOperation } from "@/types/dashboard";
import type {
  AgentId,
  AgentWorkflow,
  WorkflowStage,
  WorkflowStageState,
} from "@/types/agent";
import type { Project, ProjectGoal } from "@/types/project";

/**
 * How work moves through the twelve-stage loop, per project.
 *
 * This is not a diagram with states painted on it. Every stage reads its state
 * from the same agent operations the Command Center and the project's own team
 * panel render: if the Technical SEO agent is blocked on Verdant Home, that
 * stage is blocked here too, because it is the same record.
 *
 * The front of the work is the furthest stage an agent is actually moving.
 * Stages behind it have delivered, stages ahead have not started, and any
 * stage carrying a review or a block is shown as such wherever it sits —
 * a decision left behind at stage six still holds the pipeline up.
 *
 * A project that is not staffed on a stage shows it as pending rather than
 * pretending an unassigned agent has finished. A paused engagement has no
 * front at all, which is the honest reading of nobody working.
 */

/** What the current cycle is for, taken from the project's own goal. */
const OBJECTIVE: Record<ProjectGoal, string> = {
  "organic-traffic": "Recover and grow informational traffic",
  leads: "Convert commercial demand into qualified leads",
  rankings: "Build topical authority on the category terms",
  "ecommerce-revenue": "Grow revenue from the category and product pages",
  "local-visibility": "Win local packs across the target locations",
  "ai-visibility": "Earn presence and citations in AI answers",
  "technical-recovery": "Restore crawlability, indexation, and site health",
};

/**
 * Agent state to pipeline state.
 *
 * The agent's own state decides everything except what an idle agent means,
 * and that depends on where it sits: idle behind the front of the work has
 * delivered and moved on, idle ahead of it has not started yet. The same word
 * on the agent board therefore reads correctly at both ends of the pipeline.
 */
function stateFor(
  operation: AgentOperation,
  index: number,
  front: number,
): WorkflowStageState {
  switch (operation.status) {
    case "blocked":
      return "blocked";
    case "needs-review":
      return "review";
    case "working":
    case "active":
      return "active";
    case "completed":
      return "complete";
    default:
      return index < front ? "complete" : "pending";
  }
}

function noteFor(
  state: WorkflowStageState,
  operation: AgentOperation,
  upstreamName: string | null,
  downstreamName: string | null,
): string {
  switch (state) {
    case "complete":
      return downstreamName
        ? `${formatNumber(operation.outputs)} ${operation.outputLabel} delivered to ${downstreamName}.`
        : `${formatNumber(operation.outputs)} ${operation.outputLabel} delivered.`;
    case "active":
      return operation.currentTask;
    case "review":
      return `${operation.currentTask} — waiting on a decision before it moves on.`;
    case "blocked":
      return `${operation.currentTask} — stopped, and the hand-off cannot complete.`;
    default:
      return upstreamName
        ? `Not started. Waiting on ${upstreamName}.`
        : "Not started.";
  }
}

function buildWorkflow(project: Project): AgentWorkflow {
  const operations =
    operationsByProject().get(project.id) ?? new Map<AgentId, AgentOperation>();

  // The team is the Projects module's answer, not a second one: a project row
  // already carries the agents staffed on it.
  const row = getProjectList().find((entry) => entry.id === project.id);
  const staffed = new Set<AgentId>(row?.agents ?? []);

  // The front of the work: the furthest stage an agent has actually reached.
  // A paused engagement has none, which leaves every stage pending — the
  // honest reading of nobody working.
  let front = -1;
  AGENT_REGISTRY.forEach((agent, index) => {
    if (!staffed.has(agent.id)) return;
    if (operations.get(agent.id)?.status !== "waiting") front = index;
  });

  const stages: WorkflowStage[] = AGENT_REGISTRY.map((agent, index) => {
    const operation = operations.get(agent.id);
    const upstream = agent.upstream[0]
      ? (getAgentRecord(agent.upstream[0])?.name ?? null)
      : null;
    const downstream = agent.downstream[0]
      ? (getAgentRecord(agent.downstream[0])?.name ?? null)
      : null;

    if (!staffed.has(agent.id) || !operation) {
      return {
        agent: agent.id,
        name: agent.name,
        initials: agent.initials,
        stage: agent.stage,
        staffed: false,
        state: "pending",
        note: "Not staffed on this engagement.",
        progress: 0,
        at: project.updatedAt,
        handoffBlocked: false,
      };
    }

    const state = stateFor(operation, index, front);

    return {
      agent: agent.id,
      name: agent.name,
      initials: agent.initials,
      stage: agent.stage,
      staffed: true,
      state,
      note: noteFor(state, operation, upstream, downstream),
      progress:
        state === "complete" ? 100 : state === "pending" ? 0 : operation.progress,
      at: operation.lastActivity,
      // Work that is stopped or awaiting a decision is work that is not
      // reaching the next agent.
      handoffBlocked: state === "blocked" || state === "review",
    };
  });

  const completed = stages.filter((stage) => stage.state === "complete").length;

  // Several stages can be active at once — an agency does not idle eleven
  // specialists while one writes. The stage the cycle has *reached* is the
  // furthest one moving, which is what a reader wants to know.
  const activeIndex = stages.reduce(
    (furthest, stage, index) => (stage.state === "active" ? index : furthest),
    -1,
  );
  const updatedAt = stages.reduce(
    (latest, stage) => (Date.parse(stage.at) > Date.parse(latest) ? stage.at : latest),
    project.updatedAt,
  );

  return {
    id: `workflow-${project.id}`,
    projectId: project.id,
    projectName: project.name,
    client: project.client,
    href: `/projects/${project.id}`,
    objective: OBJECTIVE[project.goal],
    stages,
    activeIndex,
    completedStages: completed,
    // How far through the loop this cycle has got, not how many stages have
    // finished: a stage still working has been reached, and counting only
    // finished ones would show a busy pipeline as barely started.
    progress: Math.round(((front + 1) / stages.length) * 100),
    updatedAt,
  };
}

let cache: readonly AgentWorkflow[] | null = null;

/** One workflow per project, most recently moved first. */
export function getAgentWorkflows(): readonly AgentWorkflow[] {
  cache ??= PROJECTS.map(buildWorkflow).sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  );
  return cache;
}

/** How many workflows this agent is currently carrying work in. */
export function activeWorkflowCount(agentId: AgentId): number {
  return getAgentWorkflows().filter((workflow) =>
    workflow.stages.some(
      (stage) =>
        stage.agent === agentId &&
        (stage.state === "active" ||
          stage.state === "review" ||
          stage.state === "blocked"),
    ),
  ).length;
}
