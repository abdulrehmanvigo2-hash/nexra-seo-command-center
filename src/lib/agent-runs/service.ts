import { createHash } from "node:crypto";
import type { AgentRunStore } from "@/lib/agent-runs/contract";
import type { AgentExecutor, ExecutionOutput } from "@/lib/agent-runs/executor";
import {
  AGENT_RUN_ERROR_MESSAGES,
  DEFAULT_MAX_ATTEMPTS,
  canCancel,
  canRetry,
} from "@/lib/agent-runs/lifecycle";
import { canonicalJson, checkStorableJson, looksLikeSecret } from "@/lib/agent-runs/safety";
import { agentMayRun, getTaskType } from "@/lib/agent-runs/task-types";
import { getAgentRecord } from "@/lib/mock/agents/registry";
import { isStorableProjectId } from "@/lib/projects/intake-rules";
import type {
  AgentRun,
  AgentRunErrorCode,
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
};

export type AgentRunFailure =
  /** The request is malformed. `message` names the field and the rule. */
  | { readonly ok: false; readonly reason: "invalid"; readonly message: string }
  | { readonly ok: false; readonly reason: "unknown-project" }
  | { readonly ok: false; readonly reason: "unknown-agent" }
  | { readonly ok: false; readonly reason: "unknown-task-type" }
  /** The agent exists, but this task type is not one it runs. */
  | { readonly ok: false; readonly reason: "task-not-allowed" }
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

export type AgentRunService = {
  readonly storesRuns: boolean;
  createRun(operatorId: string, request: unknown): Promise<CreateAgentRunResult>;
  /** Claims a queued run, runs one attempt, and records how it ended. */
  executeRun(runId: string): Promise<AgentRunResult>;
  cancelRun(operatorId: string, runId: string): Promise<AgentRunResult>;
  /** Puts a failed run back in the queue while it has attempts left. */
  retryRun(runId: string): Promise<AgentRunResult>;
  getRun(runId: string): Promise<AgentRunResult>;
  listRuns(filter: unknown): Promise<ListAgentRunsResult>;
};

export const DEFAULT_EXECUTION_TIMEOUT_MS = 30_000;
export const DEFAULT_LIST_LIMIT = 20;
export const MAX_LIST_LIMIT = 100;
const MAX_SUMMARY_LENGTH = 2_000;

const REQUEST_FIELDS = ["projectId", "agentId", "taskType", "input"] as const;
const LIST_FIELDS = ["projectId", "agentId", "limit"] as const;

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

/** What an executor answered, if it is safe to keep. */
function screenOutput(output: unknown): { summary: string; metadata: JsonObject | null } | null {
  const object = plainObject(output) as Partial<ExecutionOutput> | null;
  if (!object || typeof object.summary !== "string") return null;

  const summary = object.summary.trim();
  if (summary.length === 0 || summary.length > MAX_SUMMARY_LENGTH) return null;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(summary)) return null;
  if (looksLikeSecret(summary)) return null;

  if (object.metadata === undefined) return { summary, metadata: null };
  const metadata = checkStorableJson(object.metadata);
  return metadata.ok ? { summary, metadata: metadata.value } : null;
}

export function createAgentRunService(dependencies: AgentRunServiceDependencies): AgentRunService {
  const { store, executor, projects } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS;
  const instant = () => now().toISOString();

  /** Re-reads a run that moved under us, to report where it went. */
  async function staleResult(runId: string, message: string): Promise<AgentRunFailure> {
    const current = await store.getById(runId);
    return current ? conflict(current, message) : NOT_FOUND;
  }

  /** Runs one attempt with a deadline. Resolves to the output or a failure code. */
  async function attempt(
    task: Parameters<AgentExecutor["execute"]>[0],
  ): Promise<{ ok: true; output: unknown } | { ok: false; code: AgentRunErrorCode }> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve("timeout");
      }, timeoutMs);
    });

    try {
      const outcome = await Promise.race([executor.execute(task, controller.signal), deadline]);
      return outcome === "timeout" ? { ok: false, code: "timeout" } : { ok: true, output: outcome };
    } catch {
      // The executor's error text is deliberately dropped: it may quote a
      // provider response or a credential.
      return { ok: false, code: "execution-failed" };
    } finally {
      clearTimeout(timer);
    }
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

      const run = await store.getById(runId);
      if (!run) return NOT_FOUND;
      if (run.status !== "queued") return conflict(run, "Only a queued run can be started.");
      if (run.attemptCount >= run.maxAttempts) {
        return conflict(run, "This run has no attempts left.");
      }

      const claimed = await store.transition(runId, "queued", {
        status: "running",
        executor: executor.id,
        attemptCount: run.attemptCount + 1,
        startedAt: instant(),
        finishedAt: null,
      });
      if (claimed.status !== "updated") {
        return staleResult(runId, "The run was started or cancelled by another request.");
      }
      const running = claimed.run;

      const fail = async (code: AgentRunErrorCode): Promise<AgentRunResult> => {
        const failed = await store.transition(runId, "running", {
          status: "failed",
          finishedAt: instant(),
          error: { code, message: AGENT_RUN_ERROR_MESSAGES[code] },
        });
        if (failed.status === "updated") return { ok: true, run: failed.run };
        // Cancelled while it ran: the cancellation stands.
        const current = await store.getById(runId);
        return current ? { ok: true, run: current } : NOT_FOUND;
      };

      try {
        let project: ProjectRecord | null;
        try {
          project = await projects.getProjectById(running.projectId);
        } catch {
          project = null;
        }
        if (!project) return await fail("project-missing");

        const agent = getAgentRecord(running.agentId) as NonNullable<ReturnType<typeof getAgentRecord>>;
        const outcome = await attempt({
          runId,
          attempt: running.attemptCount,
          agent: { id: agent.id, name: agent.name },
          project: { id: project.id, name: project.name, domain: project.domain },
          taskType: running.taskType,
          input: running.input,
        });
        if (!outcome.ok) return await fail(outcome.code);

        const output = screenOutput(outcome.output);
        if (!output) return await fail("rejected-output");

        const completed = await store.transition(runId, "running", {
          status: "completed",
          finishedAt: instant(),
          resultSummary: output.summary,
          resultMetadata: output.metadata,
          error: null,
        });
        if (completed.status === "updated") return { ok: true, run: completed.run };
        const current = await store.getById(runId);
        return current ? { ok: true, run: current } : NOT_FOUND;
      } catch (error) {
        // Recording the outcome itself failed. Try once to close the attempt
        // so the run is not left running, then let the caller report it.
        try {
          await fail("execution-failed");
        } catch {
          // The original error is the one worth reporting.
        }
        throw error;
      }
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
      if ((projectId === undefined) === (agentId === undefined)) {
        return invalid("Filter by exactly one of projectId or agentId.");
      }

      if (projectId !== undefined) {
        if (typeof projectId !== "string" || !isStorableProjectId(projectId)) {
          return { ok: false, reason: "unknown-project" };
        }
        return { ok: true, runs: await store.listByProject(projectId, limit) };
      }

      const agent = typeof agentId === "string" ? getAgentRecord(agentId) : undefined;
      if (!agent) return { ok: false, reason: "unknown-agent" };
      return { ok: true, runs: await store.listByAgent(agent.id, limit) };
    },
  };
}
