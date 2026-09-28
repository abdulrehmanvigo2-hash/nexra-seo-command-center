import {
  isTaskEventType,
  isTaskOwningAgent,
  isTaskPriority,
  isTaskSourceKind,
  isTaskStatus,
  type AgentTask,
  type AgentTaskEvent,
  type ChangeTaskOwnerOutcome,
  type ChangeTaskPriorityOutcome,
  type ChangeTaskStatusOutcome,
  type CreateAgentTaskOutcome,
  type HandoffLinkOutcome,
  type HandoffRequestOutcome,
} from "@/lib/agent-tasks/contract";

/**
 * The shape of `nexra_agent_tasks`, of what `nexra_agent_task_create`
 * answers, and the translation into the application's types. The table
 * grants no INSERT, UPDATE or DELETE: the function is the only way in, so
 * no write type exists here. A row that does not match what the migration
 * declares is refused at read time rather than passed on.
 */

export class AgentTaskRowError extends Error {
  constructor(message: string) {
    super(`Agent task row: ${message}`);
    this.name = "AgentTaskRowError";
  }
}

export type AgentTaskRow = {
  id: string;
  project_id: string;
  title: string;
  source_kind: string;
  source_ref: string;
  owning_agent: string;
  status: string;
  priority: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type AgentTaskEventRow = {
  id: string;
  seq: number;
  task_id: string;
  project_id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  from_agent: string | null;
  to_agent: string | null;
  run_id: string | null;
  /** Present once migration 20261005120000 is applied; absent before it. */
  from_priority?: string | null;
  to_priority?: string | null;
  actor: string;
  created_at: string;
};

type ReadOnly<Row> = { Row: Row; Insert: never; Update: never; Relationships: [] };

export type AgentTasksDatabase = {
  public: {
    Tables: {
      nexra_agent_tasks: ReadOnly<AgentTaskRow>;
      nexra_agent_task_events: ReadOnly<AgentTaskEventRow>;
    };
    Views: { [_ in never]: never };
    Functions: {
      nexra_agent_task_create: {
        Args: {
          p_project_id: string;
          p_title: string;
          p_source_kind: string;
          p_source_ref: string;
          p_owning_agent: string;
          p_priority: string;
          p_operator: string;
        };
        Returns: unknown;
      };
      nexra_agent_task_set_status: {
        Args: { p_project_id: string; p_task_id: string; p_status: string; p_operator: string };
        Returns: unknown;
      };
      nexra_agent_task_set_owner: {
        Args: { p_project_id: string; p_task_id: string; p_owning_agent: string; p_operator: string };
        Returns: unknown;
      };
      nexra_agent_task_set_priority: {
        Args: { p_project_id: string; p_task_id: string; p_priority: string; p_operator: string; p_run_id?: string | null };
        Returns: unknown;
      };
      nexra_agent_task_handoff_request: {
        Args: { p_project_id: string; p_task_id: string; p_operator: string };
        Returns: unknown;
      };
      nexra_agent_task_handoff_link: {
        Args: { p_project_id: string; p_task_id: string; p_run_id: string; p_operator: string };
        Returns: unknown;
      };
    };
  };
};

export const TASK_READ_COLUMNS = "id, project_id, title, source_kind, source_ref, owning_agent, status, priority, created_by, created_at, updated_at";
/**
 * Every column of the event row. `*` rather than a list so the same read works
 * before and after migration 20261005120000 adds `from_priority` and
 * `to_priority`: a deployment that runs ahead of the migration still reads the
 * history (with no priority fields), instead of failing on a missing column.
 */
export const TASK_EVENT_READ_COLUMNS = "*";

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new AgentTaskRowError(`${what} is not an object.`);
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string): string {
  if (typeof value !== "string") throw new AgentTaskRowError(`${field} is not a string.`);
  return value;
}

export function taskRowToTask(row: unknown): AgentTask {
  const r = record(row, "the task row");
  const sourceKind = text(r.source_kind, "source_kind");
  if (!isTaskSourceKind(sourceKind)) throw new AgentTaskRowError(`source_kind "${sourceKind}" is not one this product knows.`);
  const owningAgent = text(r.owning_agent, "owning_agent");
  if (!isTaskOwningAgent(owningAgent)) throw new AgentTaskRowError(`owning_agent "${owningAgent}" is not a registry agent.`);
  const status = text(r.status, "status");
  if (!isTaskStatus(status)) throw new AgentTaskRowError(`status "${status}" is not one this product knows.`);
  const priority = text(r.priority, "priority");
  if (!isTaskPriority(priority)) throw new AgentTaskRowError(`priority "${priority}" is not one this product knows.`);
  return {
    id: text(r.id, "id"),
    projectId: text(r.project_id, "project_id"),
    title: text(r.title, "title"),
    sourceKind,
    sourceRef: text(r.source_ref, "source_ref"),
    owningAgent,
    status,
    priority,
    createdBy: text(r.created_by, "created_by"),
    createdAt: text(r.created_at, "created_at"),
    updatedAt: text(r.updated_at, "updated_at"),
  };
}

function nullableText(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return text(value, field);
}

export function eventRowToEvent(row: unknown): AgentTaskEvent {
  const r = record(row, "the event row");
  const type = text(r.event_type, "event_type");
  if (!isTaskEventType(type)) throw new AgentTaskRowError(`event_type "${type}" is not one this product knows.`);
  const fromStatus = nullableText(r.from_status, "from_status");
  const toStatus = nullableText(r.to_status, "to_status");
  const fromAgent = nullableText(r.from_agent, "from_agent");
  const toAgent = nullableText(r.to_agent, "to_agent");
  if (fromStatus !== null && !isTaskStatus(fromStatus)) throw new AgentTaskRowError(`from_status "${fromStatus}" is not one this product knows.`);
  if (toStatus !== null && !isTaskStatus(toStatus)) throw new AgentTaskRowError(`to_status "${toStatus}" is not one this product knows.`);
  if (fromAgent !== null && !isTaskOwningAgent(fromAgent)) throw new AgentTaskRowError(`from_agent "${fromAgent}" is not a registry agent.`);
  if (toAgent !== null && !isTaskOwningAgent(toAgent)) throw new AgentTaskRowError(`to_agent "${toAgent}" is not a registry agent.`);
  const fromPriority = nullableText(r.from_priority, "from_priority");
  const toPriority = nullableText(r.to_priority, "to_priority");
  if (fromPriority !== null && !isTaskPriority(fromPriority)) throw new AgentTaskRowError(`from_priority "${fromPriority}" is not one this product knows.`);
  if (toPriority !== null && !isTaskPriority(toPriority)) throw new AgentTaskRowError(`to_priority "${toPriority}" is not one this product knows.`);
  const seq = typeof r.seq === "number" ? r.seq : typeof r.seq === "string" && /^\d+$/.test(r.seq) ? Number(r.seq) : NaN;
  if (!Number.isSafeInteger(seq)) throw new AgentTaskRowError("seq is not a whole number.");
  return {
    id: text(r.id, "id"),
    seq,
    taskId: text(r.task_id, "task_id"),
    projectId: text(r.project_id, "project_id"),
    type,
    fromStatus,
    toStatus,
    fromAgent,
    toAgent,
    runId: nullableText(r.run_id, "run_id"),
    fromPriority,
    toPriority,
    actor: text(r.actor, "actor"),
    createdAt: text(r.created_at, "created_at"),
  };
}

function unexpected(result: Record<string, unknown>): never {
  throw new AgentTaskRowError(`the function answered "${String(result.outcome)}", which this product does not recognise.`);
}

export function statusResultToOutcome(data: unknown): ChangeTaskStatusOutcome {
  const result = record(data, "the function's answer");
  switch (result.outcome) {
    case "transitioned":
      return { status: "transitioned", task: taskRowToTask(result.task), event: eventRowToEvent(result.event) };
    case "task-not-found":
      return { status: "task-not-found" };
    case "same-status":
    case "terminal":
    case "transition-not-allowed":
      return { status: result.outcome, task: taskRowToTask(result.task) };
    default:
      return unexpected(result);
  }
}

export function ownerResultToOutcome(data: unknown): ChangeTaskOwnerOutcome {
  const result = record(data, "the function's answer");
  switch (result.outcome) {
    case "owner-changed":
      return { status: "owner-changed", task: taskRowToTask(result.task), event: eventRowToEvent(result.event) };
    case "task-not-found":
      return { status: "task-not-found" };
    case "same-owner":
    case "terminal":
      return { status: result.outcome, task: taskRowToTask(result.task) };
    default:
      return unexpected(result);
  }
}

export function priorityResultToOutcome(data: unknown): ChangeTaskPriorityOutcome {
  const result = record(data, "the function's answer");
  switch (result.outcome) {
    case "priority-changed":
      return { status: "priority-changed", task: taskRowToTask(result.task), event: eventRowToEvent(result.event) };
    case "task-not-found":
      return { status: "task-not-found" };
    case "same-priority":
    case "terminal":
    case "run-not-accepted":
      return { status: result.outcome, task: taskRowToTask(result.task) };
    default:
      return unexpected(result);
  }
}

export function handoffRequestResultToOutcome(data: unknown): HandoffRequestOutcome {
  const result = record(data, "the function's answer");
  switch (result.outcome) {
    case "requested":
      return { status: "requested", task: taskRowToTask(result.task), event: eventRowToEvent(result.event) };
    case "task-not-found":
      return { status: "task-not-found" };
    case "terminal":
      return { status: "terminal", task: taskRowToTask(result.task) };
    case "handoff-active":
      return { status: "handoff-active", task: taskRowToTask(result.task), runId: text(result.run_id, "run_id") };
    default:
      return unexpected(result);
  }
}

export function handoffLinkResultToOutcome(data: unknown): HandoffLinkOutcome {
  const result = record(data, "the function's answer");
  switch (result.outcome) {
    case "linked":
      return { status: "linked", task: taskRowToTask(result.task), runId: text(result.run_id, "run_id"), event: eventRowToEvent(result.event) };
    case "task-not-found":
    case "run-not-found":
      return { status: result.outcome };
    case "already-linked":
      return { status: "already-linked", task: taskRowToTask(result.task), runId: text(result.run_id, "run_id") };
    default:
      return unexpected(result);
  }
}

/** What the function answers, checked field by field: a shape it did not promise is an error, not a guess. */
export function createResultToOutcome(data: unknown): CreateAgentTaskOutcome {
  const result = record(data, "the function's answer");
  switch (result.outcome) {
    case "created":
      return { status: "created", task: taskRowToTask(result.task) };
    case "project-not-found":
    case "run-not-found":
    case "run-not-completed":
    case "run-not-director":
    case "keyword-not-found":
      return { status: result.outcome };
    default:
      throw new AgentTaskRowError(`the function answered "${String(result.outcome)}", which this product does not recognise.`);
  }
}
