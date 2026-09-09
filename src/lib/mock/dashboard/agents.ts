import { minutesBefore, randInt } from "@/lib/mock/dashboard/core";
import { AGENT_REGISTRY } from "@/lib/mock/agents/registry";
import type {
  AgentOperation,
  AgentOpsStatus,
  DashboardProject,
  DateRange,
} from "@/types/dashboard";

/**
 * The operating state of the twelve specialist agents (CLAUDE.md §13).
 *
 * Who the agents are comes from the registry in `@/lib/mock/agents/registry` —
 * their names, disciplines, pipeline positions, and output vocabulary are
 * written once, there. This file adds only the part that varies: which task an
 * agent is on for the selected project, what state it is in, and how much it
 * has produced over the selected window.
 *
 * The agents are mocked in this milestone: these are realistic run records,
 * not the output of any runtime (CLAUDE.md §4).
 */

/**
 * Presentation for each operational state.
 *
 * Defined in the agents module, because the Command Center, a project's team
 * panel, and the agents roster all read it. Re-exported here so the components
 * that already import it from the dashboard layer keep working.
 */
export { AGENT_STATUS_META, AGENT_STATUS_ORDER } from "@/lib/mock/agents/meta";

/**
 * A fixed mix of states across the roster.
 *
 * Rotating this array by a project-derived offset gives each project a
 * different assignment while keeping the overall balance realistic — a control
 * centre where every agent is blocked, or none is, would not be.
 */
const STATUS_MIX: readonly AgentOpsStatus[] = [
  "working",
  "active",
  "working",
  "completed",
  "working",
  "needs-review",
  "active",
  "waiting",
  "working",
  "waiting",
  "blocked",
  "completed",
];

/** Progress and recency behave differently in each operational state. */
const STATE_SHAPE: Record<
  AgentOpsStatus,
  {
    readonly progress: readonly [number, number];
    /** Minutes since the last action, as a range. */
    readonly idle: readonly [number, number];
  }
> = {
  working: { progress: [22, 92], idle: [2, 40] },
  active: { progress: [45, 96], idle: [4, 75] },
  waiting: { progress: [0, 0], idle: [90, 420] },
  completed: { progress: [100, 100], idle: [45, 640] },
  "needs-review": { progress: [100, 100], idle: [55, 300] },
  blocked: { progress: [18, 68], idle: [180, 900] },
};

/** The twelve agents as they stand for the selected project and window. */
export function buildAgentOperations(
  project: DashboardProject,
  range: DateRange,
): readonly AgentOperation[] {
  const offset = randInt(project.seed, 1, 0, STATUS_MIX.length - 1);
  const windowScale = Math.max(0.35, range.days / 30);

  return AGENT_REGISTRY.map((agent, index) => {
    const status = STATUS_MIX[(index + offset) % STATUS_MIX.length];
    const shape = STATE_SHAPE[status];

    const progress = randInt(
      project.seed + index,
      2,
      shape.progress[0],
      shape.progress[1],
    );
    const idle = randInt(project.seed + index, 3, shape.idle[0], shape.idle[1]);
    const outputs = Math.max(
      1,
      Math.round(
        agent.outputBase *
          (project.portfolio ? 1 : project.scale * 1.9) *
          windowScale ** 0.75,
      ),
    );

    return {
      agent: agent.id,
      name: agent.name,
      discipline: agent.title,
      status,
      currentTask: agent.tasks[randInt(project.seed + index, 4, 0, 2)],
      progress,
      lastActivity: minutesBefore(idle),
      outputs,
      outputLabel: agent.outputLabel,
      queue: status === "completed" ? 0 : randInt(project.seed + index, 5, 0, 6),
      attention: status === "needs-review" || status === "blocked",
      stage: agent.stage,
      project: project.name,
    };
  });
}
