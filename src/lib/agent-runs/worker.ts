import { randomBytes } from "node:crypto";
import { mayRunAutomatically } from "@/lib/agent-runs/action-policy";
import type {
  AgentRunStore,
  AttemptLease,
  AttemptResult,
  RecoveredAttempt,
  ScheduledRetry,
} from "@/lib/agent-runs/contract";
import {
  ExecutorError,
  type AgentExecutor,
  type ExecutionOutput,
  type ExecutionTask,
} from "@/lib/agent-runs/executor";
import type { DailyCapScope, DailyCaps } from "@/lib/agent-runs/daily-caps";
import { AGENT_RUN_ERROR_MESSAGES } from "@/lib/agent-runs/lifecycle";
import { checkStorableJson, looksLikeSecret } from "@/lib/agent-runs/safety";
import { getTaskType } from "@/lib/agent-runs/task-types";
import { getAgentRecord } from "@/lib/mock/agents/registry";
import { logEvent } from "@/lib/observability/log";
import type { AgentRun, AgentRunErrorCode, JsonObject } from "@/types/agent-run";
import type { ProjectRecord } from "@/types/project";

/**
 * The execution boundary: how one attempt of one run is claimed, kept alive,
 * carried out, and recorded — with no HTTP, no operator, and no session.
 *
 * Whatever drives it — an operator's request, the scheduled worker routes
 * (`/api/worker/*`), or a long-running server process — calls the same
 * operations: `executeRun` for a named run, `executeNext` for the oldest due
 * queued run nobody else holds, `processQueue` for a bounded batch of those,
 * `recoverExpired` for attempts whose worker went away, and `scheduleRetries`
 * to re-queue retryable failures with backoff. The caller is responsible for
 * authorization; the worker trusts it.
 *
 * Before an attempt runs, the task type's action policy is checked again: a
 * task that may not run automatically fails with `policy-blocked`.
 *
 * Ownership is a lease, not the lifetime of a request:
 *
 *   1. `claim` starts an attempt atomically and returns a lease token that
 *      expires `leaseSeconds` from now by the database clock.
 *   2. While the executor works, a heartbeat renews the lease every
 *      `heartbeatMs`. A refused heartbeat — the run was cancelled, or
 *      recovered, or the lease lapsed — aborts the executor and nothing more
 *      is written by this worker. So does going a full lease without one
 *      successful renewal, judged conservatively by this process's clock.
 *   3. `finish` records the outcome, and the store accepts it only from the
 *      current attempt's live lease. A stale or duplicate worker's result is
 *      refused and the run as it now stands is returned.
 *
 * If the process dies anywhere in between, the attempt stays `running` only
 * until its lease expires; `recoverExpired` then fails it with `lease-expired`,
 * and the run can be retried within its attempt limit. Recovery never
 * completes a run and never re-queues one by itself.
 *
 * Runtime limit: in a serverless deployment a function instance may be frozen
 * or stopped once its response is sent, so work is not started "in the
 * background" of a request here. The operator routes run an attempt inside the
 * request; a dedicated worker process or queue consumer is what makes
 * execution independent of requests, and it needs nothing but this module.
 */

export type AgentRunWorkerDependencies = {
  readonly store: AgentRunStore;
  readonly executor: AgentExecutor;
  readonly projects: { getProjectById(id: string): Promise<ProjectRecord | null> };
  /** A label for this process, recorded on each attempt it claims. */
  readonly workerId?: string;
  /** How long a lease lasts without a heartbeat, 1 to 900 seconds. */
  readonly leaseSeconds?: number;
  /** How often a held lease is renewed; at most half the lease. */
  readonly heartbeatMs?: number;
  /** How long one attempt may take before it fails with `timeout`. */
  readonly timeoutMs?: number;
  /**
   * Daily spend caps (checkpoint 5.5). When given, an attempt is counted
   * before its run is claimed, and a run whose project or the whole
   * deployment is at its daily cap is not claimed: it stays queued, and
   * nothing about it changes.
   */
  readonly caps?: DailyCaps;
};

export type WorkerOutcome =
  /**
   * An attempt was claimed and carried out. `recorded` is false when this
   * worker's result was not written — the lease was lost to a cancellation,
   * to recovery, or to time — and `run` is then the run as it now stands.
   */
  | {
      readonly status: "executed";
      readonly run: AgentRun;
      readonly attemptNumber: number;
      readonly recorded: boolean;
    }
  | { readonly status: "empty" }
  | { readonly status: "not-found" }
  | { readonly status: "not-queued"; readonly run: AgentRun }
  | { readonly status: "exhausted"; readonly run: AgentRun }
  /** The daily cap is reached: the run was not claimed and is still queued. */
  | { readonly status: "daily-cap"; readonly run: AgentRun; readonly scope: DailyCapScope; readonly retryAfterMs: number };

export type QueueBatch = {
  /** Runs this batch claimed, in order, with how each attempt ended. */
  readonly executed: readonly {
    readonly runId: string;
    readonly attemptNumber: number;
    readonly status: AgentRun["status"];
    readonly recorded: boolean;
  }[];
  /** Why the batch stopped claiming: nothing due, the batch size, the time budget, or the global daily cap. */
  readonly stoppedBy: "empty" | "batch-limit" | "time-budget" | "daily-cap";
  /** Due runs passed over because their project's (or the global) daily cap is reached; each is still queued. */
  readonly heldByCap?: readonly { readonly runId: string; readonly projectId: string; readonly scope: DailyCapScope }[];
};

export type AgentRunWorker = {
  readonly id: string;
  executeRun(runId: string): Promise<WorkerOutcome>;
  executeNext(): Promise<WorkerOutcome>;
  /**
   * Claims and runs due queued runs one at a time, up to `maxRuns`, and stops
   * claiming once a further attempt could overrun `budgetMs`.
   */
  processQueue(options: { readonly maxRuns: number; readonly budgetMs: number }): Promise<QueueBatch>;
  recoverExpired(limit?: number): Promise<readonly RecoveredAttempt[]>;
  scheduleRetries(limit?: number): Promise<readonly ScheduledRetry[]>;
};

export const DEFAULT_EXECUTION_TIMEOUT_MS = 30_000;
export const DEFAULT_LEASE_SECONDS = 60;
export const DEFAULT_HEARTBEAT_MS = 15_000;
export const DEFAULT_RECOVERY_LIMIT = 25;
export const MAX_RECOVERY_LIMIT = 100;
export const DEFAULT_RETRY_SCHEDULE_LIMIT = 25;
export const MAX_QUEUE_BATCH = 10;
/** How many due runs a capped batch reads to choose from. */
export const DUE_READ_LIMIT = 25;
const MAX_LEASE_SECONDS = 900;
const MAX_SUMMARY_LENGTH = 2_000;

const WORKER_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,63}$/;

export function isWorkerId(value: unknown): value is string {
  return typeof value === "string" && WORKER_ID_PATTERN.test(value);
}

/** A random label for one process. Says nothing about the host it runs on. */
export function createWorkerId(): string {
  return `worker-${randomBytes(6).toString("hex")}`;
}

function plainObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Why an executor's answer was not kept. A name only: never the answer's text. */
type ScreenRefusal =
  | "no-summary"
  | "summary-empty"
  | "summary-too-long"
  | "summary-control-characters"
  | "summary-secret"
  | `metadata-${Exclude<ReturnType<typeof checkStorableJson>, { ok: true }>["problem"]}`;

/** What an executor answered, if it is safe to keep, or why it is not. */
function screenOutput(
  output: unknown,
): { ok: true; summary: string; metadata: JsonObject | null } | { ok: false; reason: ScreenRefusal } {
  const object = plainObject(output) as Partial<ExecutionOutput> | null;
  if (!object || typeof object.summary !== "string") return { ok: false, reason: "no-summary" };

  const summary = object.summary.trim();
  if (summary.length === 0) return { ok: false, reason: "summary-empty" };
  if (summary.length > MAX_SUMMARY_LENGTH) return { ok: false, reason: "summary-too-long" };
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(summary)) return { ok: false, reason: "summary-control-characters" };
  if (looksLikeSecret(summary)) return { ok: false, reason: "summary-secret" };

  if (object.metadata === undefined) return { ok: true, summary, metadata: null };
  const metadata = checkStorableJson(object.metadata);
  return metadata.ok ? { ok: true, summary, metadata: metadata.value } : { ok: false, reason: `metadata-${metadata.problem}` };
}

function failure(code: AgentRunErrorCode): AttemptResult {
  return { outcome: "failed", error: { code, message: AGENT_RUN_ERROR_MESSAGES[code] } };
}

type LeaseKeeper = {
  /** Aborts when the lease is lost. */
  readonly signal: AbortSignal;
  /** Stops renewing, after any renewal already under way. */
  stop(): Promise<void>;
};

/**
 * Renews a lease on an interval until stopped or lost. `heldSince` is the
 * local time just before the claim was sent, so the local view of when the
 * lease lapses is never later than the store's.
 */
function keepLease(
  store: AgentRunStore,
  lease: AttemptLease,
  leaseSeconds: number,
  heartbeatMs: number,
  heldSince: number,
): LeaseKeeper {
  const controller = new AbortController();
  const leaseMs = leaseSeconds * 1_000;
  let lapsesAt = heldSince + leaseMs;
  let renewal: Promise<void> | null = null;

  const renew = async () => {
    const sentAt = performance.now();
    try {
      const outcome = await store.heartbeat(lease, leaseSeconds);
      if (outcome.status === "renewed") lapsesAt = Math.max(lapsesAt, sentAt + leaseMs);
      else controller.abort();
    } catch {
      // One failed renewal is not a lost lease; the next may land in time.
    }
    if (performance.now() >= lapsesAt) controller.abort();
  };

  const timer = setInterval(() => {
    if (controller.signal.aborted) return;
    if (performance.now() >= lapsesAt) {
      controller.abort();
      return;
    }
    renewal ??= renew().finally(() => {
      renewal = null;
    });
  }, heartbeatMs);

  return {
    signal: controller.signal,
    async stop() {
      clearInterval(timer);
      await renewal;
    },
  };
}

const TIMED_OUT = Symbol("timed out");
const LEASE_LOST = Symbol("lease lost");

export function createAgentRunWorker(dependencies: AgentRunWorkerDependencies): AgentRunWorker {
  const { store, executor, projects, caps } = dependencies;
  const workerId = dependencies.workerId ?? createWorkerId();
  const leaseSeconds = dependencies.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
  const heartbeatMs = dependencies.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS;

  if (!isWorkerId(workerId)) throw new Error("Agent run worker: the worker id is not a valid label.");
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > MAX_LEASE_SECONDS) {
    throw new Error(`Agent run worker: the lease must be a whole number of seconds from 1 to ${MAX_LEASE_SECONDS}.`);
  }
  if (!Number.isInteger(heartbeatMs) || heartbeatMs < 1 || heartbeatMs * 2 > leaseSeconds * 1_000) {
    throw new Error("Agent run worker: heartbeats must come at least twice per lease.");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error("Agent run worker: the execution timeout must be a positive whole number of milliseconds.");
  }

  /** Runs the executor until it answers, times out, or the lease is lost. */
  async function runExecutor(
    task: ExecutionTask,
    leaseSignal: AbortSignal,
  ): Promise<{ ok: true; output: unknown } | { ok: false; code: AgentRunErrorCode } | typeof LEASE_LOST> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onLost: (() => void) | undefined;

    // Settle before aborting: an executor that rejects the moment it is
    // aborted must not win the race and turn a timeout into a failure.
    const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => {
        resolve(TIMED_OUT);
        controller.abort();
      }, timeoutMs);
    });
    const lost = new Promise<typeof LEASE_LOST>((resolve) => {
      onLost = () => {
        resolve(LEASE_LOST);
        controller.abort();
      };
      if (leaseSignal.aborted) onLost();
      else leaseSignal.addEventListener("abort", onLost, { once: true });
    });

    try {
      const outcome = await Promise.race([executor.execute(task, controller.signal), deadline, lost]);
      if (outcome === LEASE_LOST) return LEASE_LOST;
      if (outcome === TIMED_OUT) return { ok: false, code: "timeout" };
      return { ok: true, output: outcome };
    } catch (error) {
      // Only the executor's own classification survives; its error text is
      // deliberately dropped, since it may quote a provider response or a
      // credential.
      return { ok: false, code: error instanceof ExecutorError ? error.code : "execution-failed" };
    } finally {
      clearTimeout(timer);
      if (onLost) leaseSignal.removeEventListener("abort", onLost);
    }
  }

  /** The attempt's outcome, or LEASE_LOST if it stopped because the lease went. */
  async function carryOut(run: AgentRun, leaseSignal: AbortSignal): Promise<AttemptResult | typeof LEASE_LOST> {
    let project: ProjectRecord | null;
    try {
      project = await projects.getProjectById(run.projectId);
    } catch {
      project = null;
    }
    if (!project) return failure("project-missing");

    const agent = getAgentRecord(run.agentId);
    const definition = getTaskType(run.taskType);
    if (!agent || !definition) return failure("execution-failed");
    if (!mayRunAutomatically(definition.policy)) return failure("policy-blocked");

    const outcome = await runExecutor(
      {
        runId: run.id,
        attempt: run.attemptCount,
        agent: { id: agent.id, name: agent.name },
        project: { id: project.id, name: project.name, domain: project.domain },
        taskType: run.taskType,
        input: run.input,
      },
      leaseSignal,
    );
    if (outcome === LEASE_LOST) return LEASE_LOST;
    if (!outcome.ok) return failure(outcome.code);

    const output = screenOutput(outcome.output);
    if (!output.ok) {
      // The reason's name, so a refusal can be diagnosed from the log; the
      // answer itself is never logged, since it is what was refused.
      logEvent("warn", "agent_run.output_rejected", {
        runId: run.id,
        projectId: run.projectId,
        agentId: run.agentId,
        taskType: run.taskType,
        reason: output.reason,
      });
      return failure("rejected-output");
    }
    return { outcome: "completed", summary: output.summary, metadata: output.metadata };
  }

  async function execute(runId: string | null): Promise<WorkerOutcome> {
    const heldSince = performance.now();
    const claim = await store.claim({ runId, executor: executor.id, workerId, leaseSeconds });
    if (claim.status !== "claimed") return claim;

    const { run, lease } = claim;
    const context = {
      runId: run.id,
      projectId: run.projectId,
      agentId: run.agentId,
      taskType: run.taskType,
      attempt: lease.attemptNumber,
      executor: executor.id,
    };
    logEvent("info", "agent_run.transition", { ...context, from: "queued", to: "running" });

    const keeper = keepLease(store, lease, leaseSeconds, heartbeatMs, heldSince);
    let result: AttemptResult | typeof LEASE_LOST;
    try {
      result = await carryOut(run, keeper.signal);
    } finally {
      await keeper.stop();
    }
    const durationMs = Math.round(performance.now() - heldSince);

    if (result === LEASE_LOST) {
      // Someone else now decides this attempt: a cancellation already has, and
      // recovery will once the lease expires. Write nothing.
      const current = await store.getById(run.id);
      logEvent("warn", "agent_run.lease_lost", { ...context, status: current?.status ?? null, durationMs });
      return { status: "executed", run: current ?? run, attemptNumber: lease.attemptNumber, recorded: false };
    }

    // The store, not this process's clock, decides whether the lease still
    // holds. If recording throws, the attempt stays running until its lease
    // expires and recovery closes it.
    const finished = await store.finish(lease, result);
    if (finished.status === "finished") {
      logEvent(result.outcome === "completed" ? "info" : "warn", "agent_run.transition", {
        ...context,
        from: "running",
        to: result.outcome,
        errorCode: result.outcome === "failed" ? result.error.code : null,
        durationMs,
      });
      return { status: "executed", run: finished.run, attemptNumber: lease.attemptNumber, recorded: true };
    }
    logEvent("warn", "agent_run.result_refused", { ...context, status: finished.run?.status ?? null, durationMs });
    return { status: "executed", run: finished.run ?? run, attemptNumber: lease.attemptNumber, recorded: false };
  }

  /**
   * With caps: counts the attempt, then claims this exact run; a capped run
   * is left queued and reported. A run that is not queued is passed to the
   * claim unchanged, which answers for it; nothing is counted for it.
   */
  async function executeCapped(run: AgentRun): Promise<WorkerOutcome> {
    if (!caps || run.status !== "queued" || run.attemptCount >= run.maxAttempts) return execute(run.id);
    const decision = await caps.consume("execute", run.projectId);
    if (!decision.allowed) {
      logEvent("warn", "agent_run.daily_cap", { runId: run.id, projectId: run.projectId, reason: `daily-cap-${decision.scope}` });
      return { status: "daily-cap", run, scope: decision.scope, retryAfterMs: decision.retryAfterMs };
    }
    return execute(run.id);
  }

  /** The next due run the caps allow, or why there is none; held runs are collected. */
  async function executeNextCapped(held: { runId: string; projectId: string; scope: DailyCapScope }[], tried: Set<string>): Promise<WorkerOutcome> {
    const listDue = store.listDue;
    if (!caps || !listDue) return execute(null);
    const due = await listDue.call(store, DUE_READ_LIMIT);
    for (const run of due) {
      if (tried.has(run.id)) continue;
      tried.add(run.id);
      const outcome = await executeCapped(run);
      if (outcome.status === "daily-cap") {
        held.push({ runId: run.id, projectId: run.projectId, scope: outcome.scope });
        // The global cap holds every project alike: stop looking.
        if (outcome.scope === "global") return outcome;
        continue;
      }
      // Another worker took it, or it ran out of attempts, meanwhile: try the next.
      if (outcome.status === "not-queued" || outcome.status === "exhausted" || outcome.status === "not-found") continue;
      return outcome;
    }
    return { status: "empty" };
  }

  return {
    id: workerId,
    async executeRun(runId) {
      if (!caps) return execute(runId);
      const run = await store.getById(runId);
      return run ? executeCapped(run) : { status: "not-found" };
    },
    executeNext: () => executeNextCapped([], new Set()),

    async processQueue({ maxRuns, budgetMs }) {
      if (!Number.isInteger(maxRuns) || maxRuns < 1 || maxRuns > MAX_QUEUE_BATCH) {
        throw new Error(`Agent run worker: a queue batch runs 1 to ${MAX_QUEUE_BATCH} runs.`);
      }
      if (!Number.isInteger(budgetMs) || budgetMs < 1) {
        throw new Error("Agent run worker: the batch time budget must be a positive whole number of milliseconds.");
      }
      const startedAt = performance.now();
      const executed: QueueBatch["executed"][number][] = [];
      const held: { runId: string; projectId: string; scope: DailyCapScope }[] = [];
      const tried = new Set<string>();
      let stoppedBy: QueueBatch["stoppedBy"] = "batch-limit";

      while (executed.length < maxRuns) {
        // Claim only if a full attempt, and recording it, still fits the budget.
        if (performance.now() - startedAt + timeoutMs > budgetMs) {
          stoppedBy = "time-budget";
          break;
        }
        const outcome = await executeNextCapped(held, tried);
        if (outcome.status !== "executed") {
          stoppedBy = outcome.status === "daily-cap" ? "daily-cap" : "empty";
          break;
        }
        executed.push({
          runId: outcome.run.id,
          attemptNumber: outcome.attemptNumber,
          status: outcome.run.status,
          recorded: outcome.recorded,
        });
      }
      return caps ? { executed, stoppedBy, heldByCap: held } : { executed, stoppedBy };
    },

    async recoverExpired(limit = DEFAULT_RECOVERY_LIMIT) {
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RECOVERY_LIMIT) {
        throw new Error(`Agent run worker: recovery handles 1 to ${MAX_RECOVERY_LIMIT} attempts at a time.`);
      }
      const recovered = await store.recoverExpired(limit);
      for (const attempt of recovered) {
        logEvent("warn", "agent_run.transition", {
          runId: attempt.runId,
          attempt: attempt.attemptNumber,
          from: "running",
          to: "failed",
          errorCode: "lease-expired",
        });
      }
      return recovered;
    },

    async scheduleRetries(limit = DEFAULT_RETRY_SCHEDULE_LIMIT) {
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RECOVERY_LIMIT) {
        throw new Error(`Agent run worker: retry scheduling handles 1 to ${MAX_RECOVERY_LIMIT} runs at a time.`);
      }
      const scheduled = await store.scheduleRetries(limit);
      for (const retry of scheduled) {
        logEvent("info", "agent_run.transition", {
          runId: retry.runId,
          attempt: retry.attemptCount,
          from: "failed",
          to: "queued",
          errorCode: retry.errorCode,
          reason: "automatic-retry",
        });
      }
      return scheduled;
    },
  };
}
