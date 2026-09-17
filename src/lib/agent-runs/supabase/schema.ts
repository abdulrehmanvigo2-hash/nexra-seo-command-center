import type {
  AttemptLease,
  ClaimOutcome,
  FinishOutcome,
  HeartbeatOutcome,
  NewAgentRun,
  RecoveredAttempt,
  RunPatch,
  RuntimeStatus,
  ScheduledRetry,
} from "@/lib/agent-runs/contract";
import {
  isAgentRunAttemptOutcome,
  isAgentRunErrorCode,
  isAgentRunStatus,
} from "@/lib/agent-runs/lifecycle";
import { isAgentTaskType } from "@/lib/agent-runs/task-types";
import { getAgentRecord } from "@/lib/mock/agents/registry";
import type { AgentExecutorId, AgentRun, AgentRunAttempt, JsonObject } from "@/types/agent-run";

/**
 * The `agent_runs` and `agent_run_attempts` tables and their functions as the
 * application sees them, and the translation to and from `AgentRun` and
 * `AgentRunAttempt`. Snake-case rows exist only in this folder. The columns
 * mirror supabase/migrations/20260914120000_create_agent_runs.sql,
 * 20260916120000_add_agent_run_attempts.sql, and
 * 20260917120000_agent_runtime_production.sql.
 */

export type AgentRunRow = {
  id: string;
  project_id: string;
  agent_id: string;
  task_type: string;
  input: JsonObject;
  input_hash: string;
  status: string;
  source: string;
  executor: string | null;
  attempt_count: number;
  max_attempts: number;
  result_summary: string | null;
  result_metadata: JsonObject | null;
  error_code: string | null;
  error_message: string | null;
  created_by: string;
  cancelled_by: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
  next_attempt_at: string | null;
  auto_retry_count: number;
};

export type AgentRunInsert = Pick<
  AgentRunRow,
  "project_id" | "agent_id" | "task_type" | "input" | "input_hash" | "source" | "max_attempts" | "created_by"
>;

export type AgentRunUpdate = Partial<
  Pick<
    AgentRunRow,
    | "status"
    | "executor"
    | "attempt_count"
    | "started_at"
    | "finished_at"
    | "result_summary"
    | "result_metadata"
    | "error_code"
    | "error_message"
    | "cancelled_by"
  >
>;

export type AgentRunAttemptRow = {
  id: string;
  run_id: string;
  attempt_number: number;
  executor: string;
  worker_id: string;
  lease_token: string;
  lease_expires_at: string;
  outcome: string;
  result_metadata: JsonObject | null;
  error_code: string | null;
  error_message: string | null;
  started_at: string;
  heartbeat_at: string;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AgentRunsDatabase = {
  public: {
    Tables: {
      agent_runs: {
        Row: AgentRunRow;
        Insert: AgentRunInsert;
        Update: AgentRunUpdate;
        Relationships: [];
      };
      agent_run_attempts: {
        Row: AgentRunAttemptRow;
        // Written only by the functions below: service_role has no insert or update grant.
        Insert: { [_ in never]: never };
        Update: { [_ in never]: never };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      agent_run_claim: {
        Args: { p_run_id: string | null; p_executor: string; p_worker_id: string; p_lease_seconds: number };
        Returns: unknown;
      };
      agent_run_heartbeat: {
        Args: { p_attempt_id: string; p_lease_token: string; p_lease_seconds: number };
        Returns: unknown;
      };
      agent_run_finish: {
        Args: {
          p_attempt_id: string;
          p_lease_token: string;
          p_outcome: "completed" | "failed";
          p_result_summary: string | null;
          p_result_metadata: JsonObject | null;
          p_error_code: string | null;
          p_error_message: string | null;
        };
        Returns: unknown;
      };
      agent_run_recover_expired: {
        Args: { p_limit: number };
        Returns: unknown;
      };
      agent_run_schedule_retries: {
        Args: { p_limit: number };
        Returns: unknown;
      };
      agent_runtime_status: {
        Args: Record<string, never>;
        Returns: unknown;
      };
    };
  };
};

/** The attempt columns the application reads: everything but the lease token and worker label. */
export const AGENT_RUN_ATTEMPT_READ_COLUMNS =
  "id,run_id,attempt_number,executor,outcome,result_metadata,error_code,error_message,started_at,heartbeat_at,finished_at";

/** Every column except `input_hash`, which only the database compares. */
export const AGENT_RUN_READ_COLUMNS =
  "id,project_id,agent_id,task_type,input,status,source,executor,attempt_count,max_attempts,result_summary,result_metadata,error_code,error_message,created_by,cancelled_by,created_at,updated_at,started_at,finished_at,next_attempt_at,auto_retry_count";

export class AgentRunRowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentRunRowError";
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(row: Record<string, unknown>, column: string): string {
  const value = row[column];
  if (typeof value !== "string") throw new AgentRunRowError(`agent_runs.${column} is not text`);
  return value;
}

function optionalText(row: Record<string, unknown>, column: string): string | null {
  return row[column] === null ? null : text(row, column);
}

function instant(value: string | null, column: string): string | null {
  if (value === null) return null;
  const time = Date.parse(value);
  if (Number.isNaN(time)) throw new AgentRunRowError(`agent_runs.${column} is not a timestamp`);
  return new Date(time).toISOString();
}

function isExecutor(value: unknown): value is AgentExecutorId {
  return value === "mock" || value === "ai";
}

function integer(row: Record<string, unknown>, column: string): number {
  const value = row[column];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new AgentRunRowError(`agent_runs.${column} is not an integer`);
  }
  return value;
}

/**
 * A stored row as an `AgentRun`. Checks every column, so a schema that has
 * drifted from the migration fails here rather than downstream.
 */
export function agentRunRowToRun(input: unknown): AgentRun {
  if (!isObject(input)) throw new AgentRunRowError("agent_runs row is not an object");
  const row: Record<string, unknown> = { ...input };

  const agent = getAgentRecord(text(row, "agent_id"));
  const taskType = row.task_type;
  const status = row.status;
  const executor = row.executor;
  const errorCode = row.error_code;
  if (!agent) throw new AgentRunRowError("agent_runs.agent_id is not a registry agent");
  if (!isAgentTaskType(taskType)) throw new AgentRunRowError("agent_runs.task_type is not a task type");
  if (!isAgentRunStatus(status)) throw new AgentRunRowError("agent_runs.status is not a run status");
  if (row.source !== "operator") throw new AgentRunRowError("agent_runs.source is not a run source");
  if (executor !== null && !isExecutor(executor)) throw new AgentRunRowError("agent_runs.executor is not an executor");
  if (errorCode !== null && !isAgentRunErrorCode(errorCode)) {
    throw new AgentRunRowError("agent_runs.error_code is not an error code");
  }
  if (!isObject(row.input)) throw new AgentRunRowError("agent_runs.input is not an object");
  if (row.result_metadata !== null && !isObject(row.result_metadata)) {
    throw new AgentRunRowError("agent_runs.result_metadata is not an object");
  }

  return {
    id: text(row, "id"),
    projectId: text(row, "project_id"),
    agentId: agent.id,
    taskType,
    input: row.input,
    status,
    source: "operator",
    executor,
    attemptCount: integer(row, "attempt_count"),
    maxAttempts: integer(row, "max_attempts"),
    resultSummary: optionalText(row, "result_summary"),
    resultMetadata: row.result_metadata,
    error: errorCode === null ? null : { code: errorCode, message: text(row, "error_message") },
    createdBy: text(row, "created_by"),
    cancelledBy: optionalText(row, "cancelled_by"),
    createdAt: instant(text(row, "created_at"), "created_at") as string,
    updatedAt: instant(text(row, "updated_at"), "updated_at") as string,
    startedAt: instant(optionalText(row, "started_at"), "started_at"),
    finishedAt: instant(optionalText(row, "finished_at"), "finished_at"),
    // Absent only in a row written before 20260917120000; treated as never retried.
    nextAttemptAt: row.next_attempt_at === undefined ? null : instant(optionalText(row, "next_attempt_at"), "next_attempt_at"),
    autoRetryCount: row.auto_retry_count === undefined ? 0 : integer(row, "auto_retry_count"),
  };
}

export function newAgentRunInsert(run: NewAgentRun): AgentRunInsert {
  return {
    project_id: run.projectId,
    agent_id: run.agentId,
    task_type: run.taskType,
    input: run.input,
    input_hash: run.inputHash,
    source: run.source,
    max_attempts: run.maxAttempts,
    created_by: run.createdBy,
  };
}

export function runPatchToUpdate(patch: RunPatch): AgentRunUpdate {
  const update: AgentRunUpdate = { status: patch.status };
  if (patch.executor !== undefined) update.executor = patch.executor;
  if (patch.attemptCount !== undefined) update.attempt_count = patch.attemptCount;
  if (patch.startedAt !== undefined) update.started_at = patch.startedAt;
  if (patch.finishedAt !== undefined) update.finished_at = patch.finishedAt;
  if (patch.resultSummary !== undefined) update.result_summary = patch.resultSummary;
  if (patch.resultMetadata !== undefined) update.result_metadata = patch.resultMetadata;
  if (patch.error !== undefined) {
    update.error_code = patch.error?.code ?? null;
    update.error_message = patch.error?.message ?? null;
  }
  if (patch.cancelledBy !== undefined) update.cancelled_by = patch.cancelledBy;
  return update;
}

/** A stored attempt row as an `AgentRunAttempt`, checked column by column. */
export function agentRunAttemptRowToAttempt(input: unknown): AgentRunAttempt {
  if (!isObject(input)) throw new AgentRunRowError("agent_run_attempts row is not an object");
  const row: Record<string, unknown> = { ...input };

  const outcome = row.outcome;
  const errorCode = row.error_code;
  if (!isAgentRunAttemptOutcome(outcome)) {
    throw new AgentRunRowError("agent_run_attempts.outcome is not an attempt outcome");
  }
  const executor = row.executor;
  if (!isExecutor(executor)) throw new AgentRunRowError("agent_run_attempts.executor is not an executor");
  if (errorCode !== null && !isAgentRunErrorCode(errorCode)) {
    throw new AgentRunRowError("agent_run_attempts.error_code is not an error code");
  }
  if (row.result_metadata !== null && !isObject(row.result_metadata)) {
    throw new AgentRunRowError("agent_run_attempts.result_metadata is not an object");
  }

  return {
    id: text(row, "id"),
    runId: text(row, "run_id"),
    attemptNumber: integer(row, "attempt_number"),
    executor,
    outcome,
    resultMetadata: row.result_metadata,
    error: errorCode === null ? null : { code: errorCode, message: text(row, "error_message") },
    startedAt: instant(text(row, "started_at"), "started_at") as string,
    heartbeatAt: instant(text(row, "heartbeat_at"), "heartbeat_at") as string,
    finishedAt: instant(optionalText(row, "finished_at"), "finished_at"),
  };
}

/*
 * Function results. Each function answers with a JSON object whose `outcome`
 * names what happened; anything else is schema drift and fails loudly.
 */

function functionResult(input: unknown, name: string): Record<string, unknown> {
  if (!isObject(input) || typeof input.outcome !== "string") {
    throw new AgentRunRowError(`${name} returned an unexpected result`);
  }
  return { ...input };
}

function leaseFromAttempt(input: unknown): AttemptLease {
  if (!isObject(input)) throw new AgentRunRowError("agent_run_claim returned no attempt");
  const row: Record<string, unknown> = { ...input };
  return {
    runId: text(row, "run_id"),
    attemptId: text(row, "id"),
    attemptNumber: integer(row, "attempt_number"),
    token: text(row, "lease_token"),
    expiresAt: instant(text(row, "lease_expires_at"), "lease_expires_at") as string,
  };
}

export function claimResultToOutcome(input: unknown): ClaimOutcome {
  const result = functionResult(input, "agent_run_claim");
  switch (result.outcome) {
    case "claimed":
      return { status: "claimed", run: agentRunRowToRun(result.run), lease: leaseFromAttempt(result.attempt) };
    case "empty":
      return { status: "empty" };
    case "not-found":
      return { status: "not-found" };
    case "not-queued":
      return { status: "not-queued", run: agentRunRowToRun(result.run) };
    case "exhausted":
      return { status: "exhausted", run: agentRunRowToRun(result.run) };
    default:
      throw new AgentRunRowError("agent_run_claim returned an unknown outcome");
  }
}

export function heartbeatResultToOutcome(input: unknown): HeartbeatOutcome {
  const result = functionResult(input, "agent_run_heartbeat");
  switch (result.outcome) {
    case "renewed":
      return {
        status: "renewed",
        expiresAt: instant(text(result, "lease_expires_at"), "lease_expires_at") as string,
      };
    case "lost":
      return { status: "lost" };
    default:
      throw new AgentRunRowError("agent_run_heartbeat returned an unknown outcome");
  }
}

export function finishResultToOutcome(input: unknown): FinishOutcome {
  const result = functionResult(input, "agent_run_finish");
  switch (result.outcome) {
    case "finished":
      return { status: "finished", run: agentRunRowToRun(result.run) };
    case "lost":
      return { status: "lost", run: result.run === undefined ? null : agentRunRowToRun(result.run) };
    default:
      throw new AgentRunRowError("agent_run_finish returned an unknown outcome");
  }
}

export function recoverResultToAttempts(input: unknown): RecoveredAttempt[] {
  if (!isObject(input) || !Array.isArray(input.recovered)) {
    throw new AgentRunRowError("agent_run_recover_expired returned an unexpected result");
  }
  return input.recovered.map((entry) => {
    if (!isObject(entry)) throw new AgentRunRowError("agent_run_recover_expired returned an unexpected entry");
    const row: Record<string, unknown> = { ...entry };
    return { runId: text(row, "run_id"), attemptNumber: integer(row, "attempt_number") };
  });
}

export function scheduleResultToRetries(input: unknown): ScheduledRetry[] {
  if (!isObject(input) || !Array.isArray(input.scheduled)) {
    throw new AgentRunRowError("agent_run_schedule_retries returned an unexpected result");
  }
  return input.scheduled.map((entry) => {
    if (!isObject(entry)) throw new AgentRunRowError("agent_run_schedule_retries returned an unexpected entry");
    const row: Record<string, unknown> = { ...entry };
    return {
      runId: text(row, "run_id"),
      attemptCount: integer(row, "attempt_count"),
      errorCode: text(row, "error_code"),
      nextAttemptAt: instant(text(row, "next_attempt_at"), "next_attempt_at") as string,
    };
  });
}

export function statusResultToStatus(input: unknown): RuntimeStatus {
  if (!isObject(input)) throw new AgentRunRowError("agent_runtime_status returned an unexpected result");
  const row: Record<string, unknown> = { ...input };
  return {
    queuedDue: integer(row, "queued_due"),
    queuedWaiting: integer(row, "queued_waiting"),
    running: integer(row, "running"),
    expiredLeases: integer(row, "expired_leases"),
    failed: integer(row, "failed"),
    oldestDueQueuedAt: instant(optionalText(row, "oldest_due_queued_at"), "oldest_due_queued_at"),
    checkedAt: instant(text(row, "checked_at"), "checked_at") as string,
  };
}
