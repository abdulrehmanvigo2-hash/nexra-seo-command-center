import { createHash } from "node:crypto";
import { mayRunAutomatically } from "@/lib/agent-runs/action-policy";
import type {
  AgentRunStore,
  RecoveredAttempt,
  RuntimeStatus,
  ScheduledRetry,
} from "@/lib/agent-runs/contract";
import type { AgentExecutor } from "@/lib/agent-runs/executor";
import { DEFAULT_MAX_ATTEMPTS, canCancel, canRetry } from "@/lib/agent-runs/lifecycle";
import { canonicalJson, checkStorableJson } from "@/lib/agent-runs/safety";
import { agentMayRun, getTaskType } from "@/lib/agent-runs/task-types";
import {
  createAgentRunWorker,
  type QueueBatch,
  type WorkerOutcome,
} from "@/lib/agent-runs/worker";
import { getAgentRecord } from "@/lib/mock/agents/registry";
import { isStorableProjectId } from "@/lib/projects/intake-rules";
import type {
  AgentRun,
  AgentRunAttempt,
  AgentRunStatus,
  JsonObject,
} from "@/types/agent-run";
import type { ProjectRecord } from "@/types/project";

/**
 * The agent runtime's rules: who may ask for what, how a run moves through its
 * lifecycle, and what an executor's answer must look like before it is kept.
 *
 * Pure in the sense that matters: storage, execution, the project roster, and
 * the clock are all handed in, so the same rules run against Supabase in the
 * application and against an in-memory store in a test. It holds no
 * credentials and reads no environment.
 *
 * It trusts nothing it is given. A request arrives as `unknown` and is checked
 * against the agent registry, the task type's own input rules, the size and
 * credential screens, and the project roster before anything is written.
 * Authorization is the caller's job: every method assumes an operator has
 * already been confirmed, and records the operator's id where it matters.
 *
 * Failures are typed reasons. The only free text a caller receives is a
 * validation message built from field names and limits, never from the value
 * that was refused, and never from an exception.
 */

export type AgentRunServiceDependencies = {
  readonly store: AgentRunStore;
  readonly executor: AgentExecutor;
  readonly projects: { getProjectById(id: string): Promise<ProjectRecord | null> };
  readonly now?: () => Date;
  /** How long one attempt may take before it fails with `timeout`. */
  readonly timeoutMs?: number;
  /** Lease settings for the worker that executes runs; see `@/lib/agent-runs/worker`. */
  readonly leaseSeconds?: number;
  readonly heartbeatMs?: number;
  readonly workerId?: string;
};

export type AgentRunFailure =
  /** The request is malformed. `message` names the field and the rule. */
  | { readonly ok: false; readonly reason: "invalid"; readonly message: string }
  | { readonly ok: false; readonly reason: "unknown-project" }
  | { readonly ok: false; readonly reason: "unknown-agent" }
  | { readonly ok: false; readonly reason: "unknown-task-type" }
  /** The agent exists, but this task type is not one it runs. */
  | { readonly ok: false; readonly reason: "task-not-allowed" }
  /**
   * The task's action policy requires an approval workflow, which does not
   * exist: it can be neither queued nor executed.
   */
  | { readonly ok: false; readonly reason: "approval-required" }
  | { readonly ok: false; readonly reason: "not-found" }
  /** The run is not in a state that allows this; `status` is its current state. */
  | {
      readonly ok: false;
      readonly reason: "conflict";
      readonly status: AgentRunStatus;
      readonly message: string;
    }
  /** This deployment does not store runs. */
  | { readonly ok: false; readonly reason: "unavailable" };

export type AgentRunResult = { readonly ok: true; readonly run: AgentRun } | AgentRunFailure;

export type CreateAgentRunResult =
  /** `duplicate`: an identical run was already queued or running, and is returned instead. */
  | { readonly ok: true; readonly run: AgentRun; readonly duplicate: boolean }
  | AgentRunFailure;

export type ListAgentRunsResult =
  | { readonly ok: true; readonly runs: readonly AgentRun[] }
  | AgentRunFailure;

export type ListAttemptsResult =
  | { readonly ok: true; readonly attempts: readonly AgentRunAttempt[] }
  | AgentRunFailure;

export type ExecuteNextResult =
  /** `run` is null when nothing was queued. */
  | { readonly ok: true; readonly run: AgentRun | null }
  | AgentRunFailure;

export type RecoverRunsResult =
  | { readonly ok: true; readonly recovered: readonly RecoveredAttempt[] }
  | AgentRunFailure;

export type ProcessQueueResult =
  | {
      readonly ok: true;
      /** Failed runs the retry policy re-queued before the batch ran. */
      readonly scheduled: readonly ScheduledRetry[];
      readonly batch: QueueBatch;
    }
  | AgentRunFailure;

export type RuntimeStatusResult =
  | { readonly ok: true; readonly status: RuntimeStatus }
  | AgentRunFailure;

export type AgentRunService = {
  readonly storesRuns: boolean;
  createRun(operatorId: string, request: unknown): Promise<CreateAgentRunResult>;
  /** Claims a queued run, runs one attempt under a lease, and records how it ended. */
  executeRun(runId: string): Promise<AgentRunResult>;
  /** Claims and runs the oldest queued run no other worker holds. */
  executeNextRun(): Promise<ExecuteNextResult>;
  cancelRun(operatorId: string, runId: string): Promise<AgentRunResult>;
  /** Puts a failed run back in the queue while it has attempts left. */
  retryRun(runId: string): Promise<AgentRunResult>;
  /** Fails attempts whose lease expired, and their runs, with `lease-expired`. */
  recoverStaleRuns(): Promise<RecoverRunsResult>;
  /**
   * The scheduled queue job: re-queues retryable failures (with backoff), then
   * runs a bounded batch of due queued runs.
   */
  processQueue(options: { readonly maxRuns: number; readonly budgetMs: number }): Promise<ProcessQueueResult>;
  runtimeStatus(): Promise<RuntimeStatusResult>;
  getRun(runId: string): Promise<AgentRunResult>;
  /** A run's attempts, oldest first. */
  listAttempts(runId: string): Promise<ListAttemptsResult>;
  /** Newest first, filtered by project, agent, or both. */
  listRuns(filter: unknown): Promise<ListAgentRunsResult>;
};

export const DEFAULT_LIST_LIMIT = 20;
export const MAX_LIST_LIMIT = 100;
/** How deep a history list may page; older runs are for maintenance queries. */
export const MAX_LIST_OFFSET = 1_000;

const REQUEST_FIELDS = ["projectId", "agentId", "taskType", "input"] as const;
const LIST_FIELDS = ["projectId", "agentId", "limit", "offset"] as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isRunId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function invalid(message: string): AgentRunFailure {
  return { ok: false, reason: "invalid", message };
}

function conflict(run: AgentRun, message: string): AgentRunFailure {
  return { ok: false, reason: "conflict", status: run.status, message };
}

const UNAVAILABLE: AgentRunFailure = { ok: false, reason: "unavailable" };
const NOT_FOUND: AgentRunFailure = { ok: false, reason: "not-found" };

function plainObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function unexpectedFields(object: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(object).filter((key) => !allowed.includes(key));
}

const STORABLE_PROBLEMS = {
  "not-object": "Task input must be an object.",
  "too-large": "Task input is too large.",
  "too-deep": "Task input is nested too deeply.",
  "not-json": "Task input must be plain JSON.",
  secret: "Task input looks like it contains a credential. Remove it.",
} as const;

export function inputHash(input: JsonObject): string {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}

function executionResult(outcome: WorkerOutcome): AgentRunResult {
  switch (outcome.status) {
    case "executed":
      return { ok: true, run: outcome.run };
    case "not-queued":
      return conflict(outcome.run, "Only a queued run can be started.");
    case "exhausted":
      return conflict(outcome.run, "This run has no attempts left.");
    case "not-found":
    case "empty":
      return NOT_FOUND;
  }
}

export function createAgentRunService(dependencies: AgentRunServiceDependencies): AgentRunService {
  const { store, executor, projects } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  const instant = () => now().toISOString();
  const worker = createAgentRunWorker({
    store,
    executor,
    projects,
    workerId: dependencies.workerId,
    leaseSeconds: dependencies.leaseSeconds,
    heartbeatMs: dependencies.heartbeatMs,
    timeoutMs: dependencies.timeoutMs,
  });

  /** Re-reads a run that moved under us, to report where it went. */
  async function staleResult(runId: string, message: string): Promise<AgentRunFailure> {
    const current = await store.getById(runId);
    return current ? conflict(current, message) : NOT_FOUND;
  }

  return {
    storesRuns: store.storesRuns,

    async createRun(operatorId, request) {
      if (!store.storesRuns) return UNAVAILABLE;
      if (!isRunId(operatorId)) throw new Error("createRun: the operator id is not a user id.");

      const body = plainObject(request);
      if (!body) return invalid("The request must be an object.");
      const extra = unexpectedFields(body, REQUEST_FIELDS);
      if (extra.length > 0) {
        return invalid(`The request has fields this endpoint does not accept: ${extra.slice(0, 5).join(", ")}.`);
      }

      const { projectId, agentId, taskType } = body;
      if (typeof projectId !== "string" || !isStorableProjectId(projectId)) {
        return { ok: false, reason: "unknown-project" };
      }
      const agent = typeof agentId === "string" ? getAgentRecord(agentId) : undefined;
      if (!agent) return { ok: false, reason: "unknown-agent" };
      const definition = getTaskType(taskType);
      if (!definition) return { ok: false, reason: "unknown-task-type" };
      if (!agentMayRun(definition, agent.id)) return { ok: false, reason: "task-not-allowed" };
      // No approval workflow exists, so a task that needs one is not queued at all.
      if (!mayRunAutomatically(definition.policy)) return { ok: false, reason: "approval-required" };

      const parsed = definition.parseInput(body.input);
      if (!parsed.ok) return invalid(parsed.error);
      const storable = checkStorableJson(parsed.value);
      if (!storable.ok) return invalid(STORABLE_PROBLEMS[storable.problem]);

      if ((await projects.getProjectById(projectId)) === null) {
        return { ok: false, reason: "unknown-project" };
      }

      const identity = {
        projectId,
        agentId: agent.id,
        taskType: definition.id,
        inputHash: inputHash(storable.value),
      };

      const existing = await store.findActiveDuplicate(identity);
      if (existing) return { ok: true, run: existing, duplicate: true };

      const inserted = await store.insert({
        ...identity,
        input: storable.value,
        source: "operator",
        maxAttempts: DEFAULT_MAX_ATTEMPTS,
        createdBy: operatorId,
      });
      switch (inserted.status) {
        case "inserted":
          return { ok: true, run: inserted.run, duplicate: false };
        case "missing-project":
          return { ok: false, reason: "unknown-project" };
        case "duplicate": {
          // Lost a race with an identical submission: hand back the winner.
          const winner = await store.findActiveDuplicate(identity);
          if (winner) return { ok: true, run: winner, duplicate: true };
          throw new Error("createRun: a duplicate was reported but no active run matches.");
        }
      }
    },

    async executeRun(runId) {
      if (!store.storesRuns) return UNAVAILABLE;
      if (!isRunId(runId)) return NOT_FOUND;

      // The claim is atomic: of several concurrent requests, one starts the
      // attempt and the rest see it running. If recording the outcome fails,
      // the attempt keeps its lease until it expires and recovery closes it.
      return executionResult(await worker.executeRun(runId));
    },

    async executeNextRun() {
      if (!store.storesRuns) return UNAVAILABLE;
      const outcome = await worker.executeNext();
      return outcome.status === "executed" ? { ok: true, run: outcome.run } : { ok: true, run: null };
    },

    async recoverStaleRuns() {
      if (!store.storesRuns) return UNAVAILABLE;
      return { ok: true, recovered: await worker.recoverExpired() };
    },

    async processQueue(options) {
      if (!store.storesRuns) return UNAVAILABLE;
      const scheduled = await worker.scheduleRetries();
      const batch = await worker.processQueue(options);
      return { ok: true, scheduled, batch };
    },

    async runtimeStatus() {
      if (!store.storesRuns) return UNAVAILABLE;
      return { ok: true, status: await store.runtimeStatus() };
    },

    async cancelRun(operatorId, runId) {
      if (!store.storesRuns) return UNAVAILABLE;
      if (!isRunId(operatorId)) throw new Error("cancelRun: the operator id is not a user id.");
      if (!isRunId(runId)) return NOT_FOUND;

      const run = await store.getById(runId);
      if (!run) return NOT_FOUND;
      if (!canCancel(run)) return conflict(run, "Only a queued or running run can be cancelled.");

      const cancelled = await store.transition(runId, run.status, {
        status: "cancelled",
        // The database replaces this with its own clock (migration
        // 20260918120000); it is sent because a cancelled run must carry a
        // finish time, and a database without that migration uses this one.
        finishedAt: instant(),
        cancelledBy: operatorId,
      });
      if (cancelled.status === "updated") return { ok: true, run: cancelled.run };
      return staleResult(runId, "The run changed state before it could be cancelled.");
    },

    async retryRun(runId) {
      if (!store.storesRuns) return UNAVAILABLE;
      if (!isRunId(runId)) return NOT_FOUND;

      const run = await store.getById(runId);
      if (!run) return NOT_FOUND;
      if (run.status !== "failed") return conflict(run, "Only a failed run can be retried.");
      if (!canRetry(run)) return conflict(run, "This run has no attempts left.");

      const requeued = await store.transition(runId, "failed", {
        status: "queued",
        startedAt: null,
        finishedAt: null,
      });
      switch (requeued.status) {
        case "updated":
          return { ok: true, run: requeued.run };
        case "duplicate":
          return conflict(run, "An identical run is already queued or running.");
        case "stale":
          return staleResult(runId, "The run changed state before it could be retried.");
      }
    },

    async getRun(runId) {
      if (!store.storesRuns) return UNAVAILABLE;
      if (!isRunId(runId)) return NOT_FOUND;
      const run = await store.getById(runId);
      return run ? { ok: true, run } : NOT_FOUND;
    },

    async listAttempts(runId) {
      if (!store.storesRuns) return UNAVAILABLE;
      if (!isRunId(runId)) return NOT_FOUND;
      return { ok: true, attempts: await store.listAttempts(runId) };
    },

    async listRuns(filter) {
      if (!store.storesRuns) return UNAVAILABLE;

      const object = plainObject(filter);
      if (!object) return invalid("The filter must be an object.");
      const extra = unexpectedFields(object, LIST_FIELDS);
      if (extra.length > 0) return invalid(`Unknown filter: ${extra.slice(0, 5).join(", ")}.`);

      const { projectId, agentId } = object;
      const limit = object.limit ?? DEFAULT_LIST_LIMIT;
      if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
        return invalid(`limit must be a whole number from 1 to ${MAX_LIST_LIMIT}.`);
      }
      const offset = object.offset ?? 0;
      if (typeof offset !== "number" || !Number.isInteger(offset) || offset < 0 || offset > MAX_LIST_OFFSET) {
        return invalid(`offset must be a whole number from 0 to ${MAX_LIST_OFFSET}.`);
      }
      if (projectId === undefined && agentId === undefined) {
        return invalid("Filter by projectId, agentId, or both.");
      }

      if (projectId !== undefined && (typeof projectId !== "string" || !isStorableProjectId(projectId))) {
        return { ok: false, reason: "unknown-project" };
      }
      const agent = agentId === undefined ? undefined : typeof agentId === "string" ? getAgentRecord(agentId) : undefined;
      if (agentId !== undefined && !agent) return { ok: false, reason: "unknown-agent" };

      return {
        ok: true,
        runs: await store.listRuns({
          ...(projectId !== undefined ? { projectId: projectId as string } : {}),
          ...(agent ? { agentId: agent.id } : {}),
          limit,
          offset,
        }),
      };
    },
  };
}
