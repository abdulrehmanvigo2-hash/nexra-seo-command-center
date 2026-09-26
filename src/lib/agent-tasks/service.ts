import {
  TASK_READ_DEFAULT_LIMIT,
  TASK_READ_LIMIT,
  type AgentTask,
  type CreateAgentTaskInput,
  type CreateAgentTaskOutcome,
  type ListAgentTasksFilter,
} from "@/lib/agent-tasks/contract";
import type { AgentTaskStore } from "@/lib/agent-tasks/store-contract";
import { logEvent } from "@/lib/observability/log";

/**
 * The task service: one bounded read per project and one operator-triggered
 * write. It holds no rule the database does not also hold — the function
 * re-checks everything — and it never queues, executes or assigns anything:
 * a created task is a row an operator can read, not an instruction any agent
 * receives.
 */

export type CreateAgentTaskResult = CreateAgentTaskOutcome | { readonly status: "unavailable" };

export type ListAgentTasksResult =
  | { readonly status: "listed"; readonly tasks: readonly AgentTask[] }
  | { readonly status: "unavailable" };

export type AgentTaskService = {
  /** The project's tasks, newest first, at most TASK_READ_LIMIT. Never another project's. */
  listTasks(filter: ListAgentTasksFilter): Promise<ListAgentTasksResult>;
  /** Records one task through the database function. Dispatches nothing. */
  createTask(input: CreateAgentTaskInput): Promise<CreateAgentTaskResult>;
};

export function createAgentTaskService(store: AgentTaskStore): AgentTaskService {
  return {
    async listTasks(filter) {
      if (!store.storesTasks) return { status: "unavailable" };
      const requested = filter.limit ?? TASK_READ_DEFAULT_LIMIT;
      const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, TASK_READ_LIMIT) : TASK_READ_DEFAULT_LIMIT;
      const tasks = await store.listForProject({ ...filter, limit });
      // Belt and braces: the store filters by project; a row that is not the
      // project's is dropped rather than shown, and logged as a defect.
      const own = tasks.filter((task) => task.projectId === filter.projectId);
      if (own.length !== tasks.length) {
        logEvent("error", "agent_tasks.foreign_row_dropped", { projectId: filter.projectId, count: tasks.length - own.length });
      }
      return { status: "listed", tasks: own };
    },

    async createTask(input) {
      if (!store.storesTasks) return { status: "unavailable" };
      const outcome = await store.create(input);
      // Ids, names and outcomes only: never the title, which is an operator's own text.
      logEvent(outcome.status === "created" ? "info" : "warn", "agent_tasks.create", {
        projectId: input.projectId,
        reason: input.sourceKind,
        agentId: input.owningAgent,
        outcome: outcome.status,
        runId: outcome.status === "created" ? outcome.task.id : null,
      });
      return outcome;
    },
  };
}
