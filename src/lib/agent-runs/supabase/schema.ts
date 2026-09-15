import type { NewAgentRun, RunPatch } from "@/lib/agent-runs/contract";
import { isAgentRunErrorCode, isAgentRunStatus } from "@/lib/agent-runs/lifecycle";
import { isAgentTaskType } from "@/lib/agent-runs/task-types";
import { getAgentRecord } from "@/lib/mock/agents/registry";
import type { AgentRun, JsonObject } from "@/types/agent-run";

/**
 * The `agent_runs` table as the application sees it, and the translation to
 * and from `AgentRun`. Snake-case rows exist only in this folder. The columns
 * mirror supabase/migrations/20260914120000_create_agent_runs.sql.
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

export type AgentRunsDatabase = {
  public: {
    Tables: {
      agent_runs: {
        Row: AgentRunRow;
        Insert: AgentRunInsert;
        Update: AgentRunUpdate;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
  };
};

/** Every column except `input_hash`, which only the database compares. */
export const AGENT_RUN_READ_COLUMNS =
  "id,project_id,agent_id,task_type,input,status,source,executor,attempt_count,max_attempts,result_summary,result_metadata,error_code,error_message,created_by,cancelled_by,created_at,updated_at,started_at,finished_at";

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
  if (executor !== null && executor !== "mock") throw new AgentRunRowError("agent_runs.executor is not an executor");
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
