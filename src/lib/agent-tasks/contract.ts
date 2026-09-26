/**
 * Agent tasks (Project Manager real task core): one operator-approved unit
 * of work for one registry agent on one project, recorded from something
 * this product already holds.
 *
 * A task is a record of an intention to act, kept in `nexra_agent_tasks`
 * (migration 20261003120000). It is never created automatically: an operator
 * records it from a completed SEO Director run or from an observed Search
 * Console query, names the owning agent and a priority, and the row is
 * written once, in `backlog`, through the one database function. Nothing
 * here dispatches an agent, queues a run or changes a page; a task existing
 * changes what an operator sees, not what any agent does.
 */

export const TASK_SOURCE_KINDS = ["director-run", "keyword"] as const;
export type TaskSourceKind = (typeof TASK_SOURCE_KINDS)[number];

export const TASK_STATUSES = ["backlog", "ready", "in-progress", "blocked", "review", "completed", "cancelled"] as const;
export type AgentTaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["low", "medium", "high", "critical"] as const;
export type AgentTaskPriority = (typeof TASK_PRIORITIES)[number];

/**
 * The twelve registry agents a task may be owned by, as the table's CHECK
 * restates them. A repository test checks this list against the registry
 * so the two never drift.
 */
export const TASK_OWNING_AGENTS = [
  "seo-director",
  "project-manager",
  "market-intelligence",
  "keyword-intent",
  "content-strategist",
  "research-evidence",
  "writer",
  "on-page-seo",
  "technical-seo",
  "ai-visibility",
  "authority-backlink",
  "analytics-learning",
] as const;
export type TaskOwningAgent = (typeof TASK_OWNING_AGENTS)[number];

/** The longest title the table keeps (its CHECK), in characters. */
export const TASK_TITLE_MAX_LENGTH = 200;
/** The longest source reference the table keeps (its CHECK): a run id, or a query as Google reported it. */
export const TASK_SOURCE_REF_MAX_LENGTH = 2_048;
/** The most tasks one read returns. */
export const TASK_READ_LIMIT = 100;
/** What a read returns when the caller names no limit. */
export const TASK_READ_DEFAULT_LIMIT = 50;

export function isTaskSourceKind(value: unknown): value is TaskSourceKind {
  return typeof value === "string" && (TASK_SOURCE_KINDS as readonly string[]).includes(value);
}
export function isTaskStatus(value: unknown): value is AgentTaskStatus {
  return typeof value === "string" && (TASK_STATUSES as readonly string[]).includes(value);
}
export function isTaskPriority(value: unknown): value is AgentTaskPriority {
  return typeof value === "string" && (TASK_PRIORITIES as readonly string[]).includes(value);
}
export function isTaskOwningAgent(value: unknown): value is TaskOwningAgent {
  return typeof value === "string" && (TASK_OWNING_AGENTS as readonly string[]).includes(value);
}

export type TaskTone = "neutral" | "accent" | "positive" | "warning" | "critical";

/** How each status reads on screen. Wording says what an operator recorded, never what an agent did. */
export const TASK_STATUS_META: Readonly<Record<AgentTaskStatus, { readonly label: string; readonly tone: TaskTone }>> = {
  backlog: { label: "Backlog", tone: "neutral" },
  ready: { label: "Ready", tone: "accent" },
  "in-progress": { label: "In progress", tone: "accent" },
  blocked: { label: "Blocked", tone: "critical" },
  review: { label: "Review", tone: "warning" },
  completed: { label: "Completed", tone: "positive" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export const TASK_PRIORITY_META: Readonly<Record<AgentTaskPriority, { readonly label: string; readonly tone: TaskTone }>> = {
  low: { label: "Low", tone: "neutral" },
  medium: { label: "Medium", tone: "neutral" },
  high: { label: "High", tone: "warning" },
  critical: { label: "Critical", tone: "critical" },
};

export const TASK_SOURCE_META: Readonly<Record<TaskSourceKind, { readonly label: string; readonly description: string }>> = {
  "director-run": { label: "Director run", description: "Recorded by an operator from a completed SEO Director review of this project. The run id is the source." },
  keyword: { label: "Observed query", description: "Recorded by an operator from a query Google reported in this product's stored Search Console rows for this project. The exact query text is the source." },
};

/** One stored task, as the table holds it. */
export type AgentTask = {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly sourceKind: TaskSourceKind;
  /** A run id for `director-run`; the exact stored query text for `keyword`. */
  readonly sourceRef: string;
  readonly owningAgent: TaskOwningAgent;
  readonly status: AgentTaskStatus;
  readonly priority: AgentTaskPriority;
  readonly createdBy: string;
  /** ISO timestamps. */
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type CreateAgentTaskInput = {
  readonly projectId: string;
  /** Already normalised: trimmed, within the length limit, no control characters. */
  readonly title: string;
  readonly sourceKind: TaskSourceKind;
  readonly sourceRef: string;
  readonly owningAgent: TaskOwningAgent;
  readonly priority: AgentTaskPriority;
  readonly operatorId: string;
};

export type CreateAgentTaskOutcome =
  | { readonly status: "created"; readonly task: AgentTask }
  /** No such stored project. */
  | { readonly status: "project-not-found" }
  /** No such run, or another project's. Never says which of the two. */
  | { readonly status: "run-not-found" }
  /** The run exists on this project but has not completed. */
  | { readonly status: "run-not-completed" }
  /** The run is this project's and completed, but not the SEO Director's. */
  | { readonly status: "run-not-director" }
  /** No stored Search Console row of this project carries that exact query. */
  | { readonly status: "keyword-not-found" };

export type ListAgentTasksFilter = {
  readonly projectId: string;
  readonly status?: AgentTaskStatus;
  readonly limit?: number;
};

const PROJECT_ID = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * A title as an operator typed it: trimmed, 1 to 200 characters, no control
 * characters. Anything but a string is refused rather than coerced.
 */
export type TitleCheck = { readonly ok: true; readonly title: string } | { readonly ok: false; readonly reason: "not-text" | "blank" | "too-long" | "control-characters" };

export function normaliseTaskTitle(value: unknown): TitleCheck {
  if (typeof value !== "string") return { ok: false, reason: "not-text" };
  const title = value.trim();
  if (title.length === 0) return { ok: false, reason: "blank" };
  if (title.length > TASK_TITLE_MAX_LENGTH) return { ok: false, reason: "too-long" };
  if (CONTROL.test(title)) return { ok: false, reason: "control-characters" };
  return { ok: true, title };
}

const CREATE_FIELDS: readonly string[] = ["project", "title", "sourceKind", "sourceRef", "owningAgent", "priority"];

export type CreateTaskRequest =
  | { readonly ok: true; readonly projectId: string; readonly title: string; readonly sourceKind: TaskSourceKind; readonly sourceRef: string; readonly owningAgent: TaskOwningAgent; readonly priority: AgentTaskPriority }
  | { readonly ok: false; readonly error: "invalid" };

/**
 * A create request as the route receives it: a JSON body with exactly these
 * fields. Shape only — whether the project is stored, the run the project's
 * Director's and completed, or the query one this product stored is the
 * database's decision. A `director-run` source ref must look like a run id;
 * a `keyword` source ref is the query text verbatim, never trimmed or
 * re-cased here, because the stored row is matched exactly.
 */
export function parseCreateTaskRequest(body: unknown): CreateTaskRequest {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "invalid" };
  const fields = body as Record<string, unknown>;
  if (Object.keys(fields).some((key) => !CREATE_FIELDS.includes(key))) return { ok: false, error: "invalid" };
  const { project, title, sourceKind, sourceRef, owningAgent, priority } = fields;
  if (typeof project !== "string" || project.length > 64 || !PROJECT_ID.test(project)) return { ok: false, error: "invalid" };
  const checkedTitle = normaliseTaskTitle(title);
  if (!checkedTitle.ok) return { ok: false, error: "invalid" };
  if (!isTaskSourceKind(sourceKind)) return { ok: false, error: "invalid" };
  if (typeof sourceRef !== "string" || sourceRef.length < 1 || sourceRef.length > TASK_SOURCE_REF_MAX_LENGTH) return { ok: false, error: "invalid" };
  if (sourceKind === "director-run" && !UUID.test(sourceRef)) return { ok: false, error: "invalid" };
  if (sourceKind === "keyword" && CONTROL.test(sourceRef)) return { ok: false, error: "invalid" };
  if (!isTaskOwningAgent(owningAgent)) return { ok: false, error: "invalid" };
  const chosenPriority = priority === undefined ? "medium" : priority;
  if (!isTaskPriority(chosenPriority)) return { ok: false, error: "invalid" };
  return {
    ok: true,
    projectId: project,
    title: checkedTitle.title,
    sourceKind,
    sourceRef: sourceKind === "director-run" ? sourceRef.toLowerCase() : sourceRef,
    owningAgent,
    priority: chosenPriority,
  };
}

export type ListTasksRequest =
  | { readonly ok: true; readonly filter: ListAgentTasksFilter }
  | { readonly ok: false; readonly error: "invalid" };

/** The list query as the route receives it: a project, an optional status, an optional limit within the bound. */
export function parseListTasksRequest(params: { readonly project: string | null; readonly status: string | null; readonly limit: string | null }): ListTasksRequest {
  const { project, status, limit } = params;
  if (project === null || project.length > 64 || !PROJECT_ID.test(project)) return { ok: false, error: "invalid" };
  if (status !== null && !isTaskStatus(status)) return { ok: false, error: "invalid" };
  let bounded = TASK_READ_DEFAULT_LIMIT;
  if (limit !== null) {
    if (!/^\d{1,3}$/.test(limit)) return { ok: false, error: "invalid" };
    bounded = Number(limit);
    if (bounded < 1 || bounded > TASK_READ_LIMIT) return { ok: false, error: "invalid" };
  }
  return { ok: true, filter: { projectId: project, ...(status !== null ? { status } : {}), limit: bounded } };
}

/** The existing list endpoint, filtered to one project. */
export function agentTasksUrl(projectId: string, options: { readonly status?: AgentTaskStatus; readonly limit?: number } = {}): string {
  const params = new URLSearchParams({ project: projectId });
  if (options.status) params.set("status", options.status);
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  return `/api/agent-tasks?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Workflow (migration 20261004120000): status transitions, owner changes,
// handoff, and the immutable event history behind each.

/** The statuses nothing follows. */
export const TASK_TERMINAL_STATUSES = ["completed", "cancelled"] as const satisfies readonly AgentTaskStatus[];

/**
 * The fixed transition map, exactly as `nexra_agent_task_transition_allowed`
 * restates it in SQL. The database decides; this copy lets the panel offer
 * only the moves that can succeed.
 */
export const TASK_TRANSITIONS: Readonly<Record<AgentTaskStatus, readonly AgentTaskStatus[]>> = {
  backlog: ["ready", "blocked", "cancelled"],
  ready: ["in-progress", "blocked", "cancelled"],
  "in-progress": ["review", "blocked", "cancelled"],
  blocked: ["ready", "in-progress", "cancelled"],
  review: ["in-progress", "completed", "blocked"],
  completed: [],
  cancelled: [],
};

export function isTerminalTaskStatus(status: AgentTaskStatus): boolean {
  return (TASK_TERMINAL_STATUSES as readonly string[]).includes(status);
}

export function canTransitionTask(from: AgentTaskStatus, to: AgentTaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

export const TASK_EVENT_TYPES = ["created", "status-changed", "owner-changed", "handoff-requested", "handoff-run-linked"] as const;
export type AgentTaskEventType = (typeof TASK_EVENT_TYPES)[number];

export function isTaskEventType(value: unknown): value is AgentTaskEventType {
  return typeof value === "string" && (TASK_EVENT_TYPES as readonly string[]).includes(value);
}

/** One row of `nexra_agent_task_events`: a change an operator made, never edited. */
export type AgentTaskEvent = {
  readonly id: string;
  /** The order the events were written in. */
  readonly seq: number;
  readonly taskId: string;
  readonly projectId: string;
  readonly type: AgentTaskEventType;
  readonly fromStatus: AgentTaskStatus | null;
  readonly toStatus: AgentTaskStatus | null;
  readonly fromAgent: TaskOwningAgent | null;
  readonly toAgent: TaskOwningAgent | null;
  /** The run a handoff produced, on `handoff-run-linked` only. */
  readonly runId: string | null;
  readonly actor: string;
  readonly createdAt: string;
};

export const TASK_EVENT_META: Readonly<Record<AgentTaskEventType, string>> = {
  created: "Recorded",
  "status-changed": "Status changed",
  "owner-changed": "Owner changed",
  "handoff-requested": "Handoff requested",
  "handoff-run-linked": "Handoff run queued",
};

/** The most events one read returns; a task sees far fewer. */
export const TASK_EVENT_READ_LIMIT = 200;

export type ChangeTaskStatusInput = { readonly projectId: string; readonly taskId: string; readonly status: AgentTaskStatus; readonly operatorId: string };
export type ChangeTaskStatusOutcome =
  | { readonly status: "transitioned"; readonly task: AgentTask; readonly event: AgentTaskEvent }
  /** No such task, or another project's. Never says which. */
  | { readonly status: "task-not-found" }
  | { readonly status: "same-status"; readonly task: AgentTask }
  | { readonly status: "terminal"; readonly task: AgentTask }
  | { readonly status: "transition-not-allowed"; readonly task: AgentTask };

export type ChangeTaskOwnerInput = { readonly projectId: string; readonly taskId: string; readonly owningAgent: TaskOwningAgent; readonly operatorId: string };
export type ChangeTaskOwnerOutcome =
  | { readonly status: "owner-changed"; readonly task: AgentTask; readonly event: AgentTaskEvent }
  | { readonly status: "task-not-found" }
  | { readonly status: "same-owner"; readonly task: AgentTask }
  | { readonly status: "terminal"; readonly task: AgentTask };

export type HandoffRequestInput = { readonly projectId: string; readonly taskId: string; readonly operatorId: string };
export type HandoffRequestOutcome =
  | { readonly status: "requested"; readonly task: AgentTask; readonly event: AgentTaskEvent }
  | { readonly status: "task-not-found" }
  | { readonly status: "terminal"; readonly task: AgentTask }
  /** A run this task was handed off to is still queued or running. */
  | { readonly status: "handoff-active"; readonly task: AgentTask; readonly runId: string };

export type HandoffLinkInput = { readonly projectId: string; readonly taskId: string; readonly runId: string; readonly operatorId: string };
export type HandoffLinkOutcome =
  | { readonly status: "linked"; readonly task: AgentTask; readonly runId: string; readonly event: AgentTaskEvent }
  | { readonly status: "task-not-found" }
  /** No such run, another project's, another agent's, or one without this task in its input. Never says which. */
  | { readonly status: "run-not-found" }
  | { readonly status: "already-linked"; readonly task: AgentTask; readonly runId: string };

export const TASK_ACTIONS = ["status", "owner", "handoff"] as const;
export type TaskActionName = (typeof TASK_ACTIONS)[number];

export type TaskActionRequest =
  | { readonly ok: true; readonly projectId: string; readonly action: "status"; readonly status: AgentTaskStatus }
  | { readonly ok: true; readonly projectId: string; readonly action: "owner"; readonly owningAgent: TaskOwningAgent }
  | { readonly ok: true; readonly projectId: string; readonly action: "handoff" }
  | { readonly ok: false; readonly error: "invalid" };

/**
 * An action request as the task route receives it: `{ project, action,
 * status? | owningAgent? }` and nothing else. A handoff names no agent, no
 * task type and no input — the server maps the task's owning agent to the
 * one executable task type it supports, or refuses.
 */
export function parseTaskActionRequest(body: unknown): TaskActionRequest {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "invalid" };
  const fields = body as Record<string, unknown>;
  const { project, action } = fields;
  if (typeof project !== "string" || project.length > 64 || !PROJECT_ID.test(project)) return { ok: false, error: "invalid" };
  const keys = Object.keys(fields);
  switch (action) {
    case "status": {
      if (keys.length !== 3 || !keys.includes("status") || !isTaskStatus(fields.status)) return { ok: false, error: "invalid" };
      return { ok: true, projectId: project, action, status: fields.status };
    }
    case "owner": {
      if (keys.length !== 3 || !keys.includes("owningAgent") || !isTaskOwningAgent(fields.owningAgent)) return { ok: false, error: "invalid" };
      return { ok: true, projectId: project, action, owningAgent: fields.owningAgent };
    }
    case "handoff": {
      if (keys.length !== 2) return { ok: false, error: "invalid" };
      return { ok: true, projectId: project, action };
    }
    default:
      return { ok: false, error: "invalid" };
  }
}

export function isTaskId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** One task and its history, at the task endpoint. */
export function agentTaskUrl(taskId: string, projectId: string): string {
  return `/api/agent-tasks/${encodeURIComponent(taskId)}?${new URLSearchParams({ project: projectId }).toString()}`;
}
