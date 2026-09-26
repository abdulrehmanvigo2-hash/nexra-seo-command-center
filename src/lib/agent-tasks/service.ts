import {
  TASK_READ_DEFAULT_LIMIT,
  TASK_READ_LIMIT,
  type AgentTask,
  type AgentTaskEvent,
  type ChangeTaskOwnerInput,
  type ChangeTaskOwnerOutcome,
  type ChangeTaskStatusInput,
  type ChangeTaskStatusOutcome,
  type CreateAgentTaskInput,
  type CreateAgentTaskOutcome,
  type HandoffRequestInput,
  type ListAgentTasksFilter,
} from "@/lib/agent-tasks/contract";
import { handoffFor } from "@/lib/agent-tasks/handoff";
import type { AgentTaskStore } from "@/lib/agent-tasks/store-contract";
import { logEvent } from "@/lib/observability/log";
import type { AgentRun } from "@/types/agent-run";

/**
 * The task service: bounded reads per project and operator-triggered writes,
 * each one database function. It holds no rule the database does not also
 * hold — the functions re-check everything — and it never executes anything:
 * a status or owner change tells no agent anything, and a handoff creates at
 * most one queued run through the run path, which the scheduled worker or an
 * operator's separate "Run now" executes later.
 */

export type CreateAgentTaskResult = CreateAgentTaskOutcome | { readonly status: "unavailable" };

export type ListAgentTasksResult =
  | { readonly status: "listed"; readonly tasks: readonly AgentTask[] }
  | { readonly status: "unavailable" };

export type ReadAgentTaskResult =
  | { readonly status: "found"; readonly task: AgentTask; readonly events: readonly AgentTaskEvent[] }
  | { readonly status: "task-not-found" }
  | { readonly status: "unavailable" };

export type ChangeTaskStatusResult = ChangeTaskStatusOutcome | { readonly status: "unavailable" };
export type ChangeTaskOwnerResult = ChangeTaskOwnerOutcome | { readonly status: "unavailable" };

export type HandoffTaskResult =
  /** One run was created and linked. `duplicate` says the run path found an identical active run instead of inserting. */
  | { readonly status: "handed-off"; readonly task: AgentTask; readonly run: AgentRun; readonly duplicate: boolean }
  | { readonly status: "task-not-found" }
  | { readonly status: "terminal"; readonly task: AgentTask }
  | { readonly status: "handoff-active"; readonly task: AgentTask; readonly runId: string }
  /** The owning agent has no supported executable task; nothing was recorded. */
  | { readonly status: "handoff-unsupported"; readonly task: AgentTask }
  /** The run path refused; the request is in the history, no run exists. */
  | { readonly status: "run-refused"; readonly task: AgentTask; readonly reason: string }
  | { readonly status: "unavailable" };

/** What the handoff needs from the run path: the existing create, with provenance. */
export type HandoffRunCreator = {
  createRun(
    operatorId: string,
    request: { readonly projectId: string; readonly agentId: string; readonly taskType: string; readonly input: Record<string, unknown> },
    options: { readonly sourceTaskId: string },
  ): Promise<{ readonly ok: true; readonly run: AgentRun; readonly duplicate: boolean } | { readonly ok: false; readonly reason: string }>;
};

export type AgentTaskService = {
  /** The project's tasks, newest first, at most TASK_READ_LIMIT. Never another project's. */
  listTasks(filter: ListAgentTasksFilter): Promise<ListAgentTasksResult>;
  /** Records one task through the database function. Dispatches nothing. */
  createTask(input: CreateAgentTaskInput): Promise<CreateAgentTaskResult>;
  /** One task of one project with its history, oldest first. */
  readTask(projectId: string, taskId: string): Promise<ReadAgentTaskResult>;
  /** One transition along the fixed map. Tells no agent anything. */
  changeStatus(input: ChangeTaskStatusInput): Promise<ChangeTaskStatusResult>;
  /** One owner change to a registry agent. Queues nothing. */
  changeOwner(input: ChangeTaskOwnerInput): Promise<ChangeTaskOwnerResult>;
  /** Records the request, creates at most one queued run for the owning agent, links it. Executes nothing. */
  handoff(input: HandoffRequestInput): Promise<HandoffTaskResult>;
};

export function createAgentTaskService(store: AgentTaskStore, runs: HandoffRunCreator | null = null): AgentTaskService {
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

    async readTask(projectId, taskId) {
      if (!store.storesTasks) return { status: "unavailable" };
      const task = await store.getForProject(projectId, taskId);
      if (task === null || task.projectId !== projectId) return { status: "task-not-found" };
      const events = (await store.listEvents(projectId, taskId)).filter((event) => event.taskId === taskId && event.projectId === projectId);
      return { status: "found", task, events };
    },

    async changeStatus(input) {
      if (!store.storesTasks) return { status: "unavailable" };
      const outcome = await store.setStatus(input);
      logEvent(outcome.status === "transitioned" ? "info" : "warn", "agent_tasks.status", {
        projectId: input.projectId,
        runId: input.taskId,
        reason: input.status,
        outcome: outcome.status,
      });
      return outcome;
    },

    async changeOwner(input) {
      if (!store.storesTasks) return { status: "unavailable" };
      const outcome = await store.setOwner(input);
      logEvent(outcome.status === "owner-changed" ? "info" : "warn", "agent_tasks.owner", {
        projectId: input.projectId,
        runId: input.taskId,
        agentId: input.owningAgent,
        outcome: outcome.status,
      });
      return outcome;
    },

    async handoff(input) {
      if (!store.storesTasks || runs === null) return { status: "unavailable" };

      // The mapping is decided before anything is written: an unsupported
      // owner records no request.
      const current = await store.getForProject(input.projectId, input.taskId);
      if (current === null) return { status: "task-not-found" };
      const mapping = handoffFor(current.owningAgent);
      if (mapping === null) {
        logEvent("warn", "agent_tasks.handoff", { projectId: input.projectId, runId: input.taskId, agentId: current.owningAgent, outcome: "handoff-unsupported" });
        return { status: "handoff-unsupported", task: current };
      }

      // Step 1: the request, under the task's lock; refused while a linked run is active.
      const requested = await store.handoffRequest(input);
      if (requested.status !== "requested") {
        logEvent("warn", "agent_tasks.handoff", { projectId: input.projectId, runId: input.taskId, agentId: current.owningAgent, outcome: requested.status });
        return requested;
      }
      const task = requested.task;

      // Step 2: one run through the run path, with the task as provenance.
      // The run path's own duplicate rule (same project, agent, task type and
      // input, including sourceTaskId) hands back an identical active run
      // rather than inserting a second.
      const created = await runs.createRun(
        input.operatorId,
        { projectId: task.projectId, agentId: task.owningAgent, taskType: mapping.taskType, input: mapping.input },
        { sourceTaskId: task.id },
      );
      if (!created.ok) {
        logEvent("warn", "agent_tasks.handoff", { projectId: input.projectId, runId: input.taskId, agentId: task.owningAgent, outcome: "run-refused", reason: created.reason });
        return { status: "run-refused", task, reason: created.reason };
      }

      // Step 3: the link. A run the path handed back as a duplicate may
      // already be linked; that is recorded once and not an error.
      const linked = await store.handoffLink({ projectId: task.projectId, taskId: task.id, runId: created.run.id, operatorId: input.operatorId });
      logEvent(linked.status === "linked" || linked.status === "already-linked" ? "info" : "error", "agent_tasks.handoff", {
        projectId: input.projectId,
        runId: created.run.id,
        agentId: task.owningAgent,
        reason: mapping.taskType,
        outcome: created.duplicate ? `${linked.status}:duplicate-run` : linked.status,
      });
      if (linked.status === "task-not-found" || linked.status === "run-not-found") {
        // The run exists and is the operator's; the link is what failed. Say so rather than hide the run.
        throw new Error(`Task handoff: the run ${created.run.id} was created but could not be linked (${linked.status}).`);
      }
      return { status: "handed-off", task: linked.task, run: created.run, duplicate: created.duplicate };
    },
  };
}
