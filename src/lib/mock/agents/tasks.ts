import { minutesBefore, randInt } from "@/lib/mock/dashboard/core";
import { buildProjectTasks } from "@/lib/mock/projects/tasks";
import { PROJECTS } from "@/lib/mock/projects/roster";
import { getAgentRecord } from "@/lib/mock/agents/registry";
import type { Priority } from "@/types/dashboard";
import type {
  AgentTask,
  AgentTaskDue,
  AgentTaskStatus,
} from "@/types/agent";
import type { ProjectTaskStatus } from "@/types/project";

/**
 * The cross-project task board for the agent team.
 *
 * These are not new tasks. They are every project's delivery board, read by
 * owner instead of by project: the same records the Projects module renders on
 * a project's Tasks tab, re-grouped so an agent's queue can be seen in one
 * place. Building a second set of tasks here would let the two boards
 * disagree about what an agent is doing, which is exactly the failure the
 * shared fixture layer exists to prevent.
 *
 * The only fields added are the ones a board organised by owner needs and a
 * board organised by project does not: when the task started, which agent it
 * is waiting on, and who receives it next. Both of those come from the
 * registry's pipeline edges, so a dependency is never invented.
 */

/**
 * The Projects board and the agent board describe the same five states in
 * different words — a project talks about a to-do, an operations board talks
 * about a queue.
 */
const STATUS_MAP: Record<ProjectTaskStatus, AgentTaskStatus> = {
  todo: "queued",
  "in-progress": "working",
  review: "review",
  blocked: "blocked",
  completed: "completed",
};

const DUE_RANK: Record<AgentTaskDue, number> = {
  overdue: 0,
  "due-today": 1,
  "this-week": 2,
  scheduled: 3,
  delivered: 4,
};

const PRIORITY_RANK: Record<Priority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/** How long a task in each state has been running, as a range in minutes. */
const AGE_RANGE: Record<AgentTaskStatus, readonly [number, number]> = {
  queued: [0, 0],
  working: [40, 1_400],
  review: [600, 3_600],
  blocked: [900, 6_000],
  completed: [1_200, 8_000],
};

let cache: readonly AgentTask[] | null = null;

/**
 * Every task on every project, owned by the agent responsible for it.
 *
 * Built once and cached. The builders are pure, so the cached result is the
 * only result they could produce, and the roster reads this on every keystroke
 * of its search field.
 */
export function getAgentTasks(): readonly AgentTask[] {
  cache ??= build();
  return cache;
}

function build(): readonly AgentTask[] {
  const tasks: AgentTask[] = [];

  for (const project of PROJECTS) {
    for (const task of buildProjectTasks(project, project.status)) {
      const status = STATUS_MAP[task.status];
      const agent = getAgentRecord(task.agent);
      const [low, high] = AGE_RANGE[status];
      const index = tasks.length;

      tasks.push({
        id: `agent-${task.id}`,
        title: task.title,
        agent: task.agent,
        projectId: project.id,
        projectName: project.name,
        priority: task.priority,
        status,
        progress: task.progress,
        startedAt:
          status === "queued"
            ? null
            : minutesBefore(randInt(project.seed + 977, index, low, high)),
        due: task.due,
        dueState: task.dueState,
        // A task only waits on somebody when it is not moving. Anything in
        // flight is the agent's own to finish.
        dependency:
          (status === "blocked" || status === "queued") && agent
            ? (agent.upstream[0] ?? null)
            : null,
        nextHandoff: agent?.downstream[0] ?? null,
      });
    }
  }

  return tasks.sort(
    (a, b) =>
      DUE_RANK[a.dueState] - DUE_RANK[b.dueState] ||
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      a.title.localeCompare(b.title),
  );
}

/** Every task owned by one agent. */
export function tasksForAgent(agentId: string): readonly AgentTask[] {
  return getAgentTasks().filter((task) => task.agent === agentId);
}
