import type {
  AgentExecutorId,
  AgentRun,
  AgentRunAttempt,
  AgentRunError,
  AgentRunSource,
  AgentRunStatus,
  AgentTaskType,
  JsonObject,
} from "@/types/agent-run";
import type { AgentId } from "@/types/agent";

/**
 * What the agent runtime needs from wherever runs are kept.
 *
 * Storage-agnostic, like the Projects repository contract: the service holds
 * the rules, a store holds rows.
 *
 * Two kinds of state change. Cancelling and retrying go through `transition`,
 * which only applies when the run is still in the state the caller last saw,
 * so two requests racing to cancel the same run cannot both win. Executing
 * goes through a lease: `claim` starts an attempt and returns its lease,
 * `heartbeat` renews it, and `finish` records the outcome — each accepted only
 * from the current attempt's lease holder while the lease is live. An attempt
 * whose lease runs out is closed by `recoverExpired`. A store must apply each
 * of these atomically; the Supabase store does it in Postgres functions.
 */

export type NewAgentRun = {
  readonly projectId: string;
  readonly agentId: AgentId;
  readonly taskType: AgentTaskType;
  readonly input: JsonObject;
  readonly inputHash: string;
  readonly source: AgentRunSource;
  readonly maxAttempts: number;
  readonly createdBy: string;
};

export type InsertRunOutcome =
  | { readonly status: "inserted"; readonly run: AgentRun }
  /** An identical run is already queued or running. */
  | { readonly status: "duplicate" }
  /** The project no longer exists. */
  | { readonly status: "missing-project" };

/** The fields a state change may set. Absent fields are left as they are. */
export type RunPatch = {
  readonly status: AgentRunStatus;
  readonly executor?: AgentExecutorId;
  readonly attemptCount?: number;
  readonly startedAt?: string | null;
  readonly finishedAt?: string | null;
  readonly resultSummary?: string | null;
  readonly resultMetadata?: JsonObject | null;
  readonly error?: AgentRunError | null;
  readonly cancelledBy?: string | null;
};

export type TransitionOutcome =
  | { readonly status: "updated"; readonly run: AgentRun }
  /** The run was not in the expected state, or does not exist. Nothing changed. */
  | { readonly status: "stale" }
  /** Re-queuing would duplicate a run that is already queued or running. */
  | { readonly status: "duplicate" };

/**
 * The right to act on one attempt. Held by the worker that claimed it and
 * never returned to a client: the token is what proves ownership.
 */
export type AttemptLease = {
  readonly runId: string;
  readonly attemptId: string;
  readonly attemptNumber: number;
  readonly token: string;
  /** When the lease lapses without a heartbeat, by the store's clock. */
  readonly expiresAt: string;
};

export type ClaimRequest = {
  /** A specific queued run, or null for the oldest queued run nobody else is claiming. */
  readonly runId: string | null;
  readonly executor: AgentExecutorId;
  /** A label for the claiming process; see `isWorkerId`. */
  readonly workerId: string;
  readonly leaseSeconds: number;
};

export type ClaimOutcome =
  | { readonly status: "claimed"; readonly run: AgentRun; readonly lease: AttemptLease }
  /** Asked for the next queued run, and there is none. */
  | { readonly status: "empty" }
  | { readonly status: "not-found" }
  /** Another worker claimed it first, or it is not queued. */
  | { readonly status: "not-queued"; readonly run: AgentRun }
  | { readonly status: "exhausted"; readonly run: AgentRun };

export type HeartbeatOutcome =
  | { readonly status: "renewed"; readonly expiresAt: string }
  /** The attempt was cancelled, recovered, or finished, or the lease had already lapsed. */
  | { readonly status: "lost" };

export type AttemptResult =
  | { readonly outcome: "completed"; readonly summary: string; readonly metadata: JsonObject | null }
  | { readonly outcome: "failed"; readonly error: AgentRunError };

export type FinishOutcome =
  | { readonly status: "finished"; readonly run: AgentRun }
  /** Nothing was written; `run` is the run as it now stands, if it exists. */
  | { readonly status: "lost"; readonly run: AgentRun | null };

export type RecoveredAttempt = {
  readonly runId: string;
  readonly attemptNumber: number;
};

export type ScheduledRetry = {
  readonly runId: string;
  /** Attempts made before the retry. */
  readonly attemptCount: number;
  readonly errorCode: string;
  readonly nextAttemptAt: string;
};

/** Queue and lease counts. No row contents. */
export type RuntimeStatus = {
  readonly queuedDue: number;
  readonly queuedWaiting: number;
  readonly running: number;
  readonly expiredLeases: number;
  readonly failed: number;
  readonly oldestDueQueuedAt: string | null;
  readonly checkedAt: string;
};

export type RunListFilter = {
  readonly projectId?: string;
  readonly agentId?: AgentId;
  readonly limit: number;
  /** Rows to skip, newest first; 0 for the first page. */
  readonly offset?: number;
};

export type AgentRunStore = {
  /** False where runs cannot be kept; the service then refuses every call. */
  readonly storesRuns: boolean;
  insert(run: NewAgentRun): Promise<InsertRunOutcome>;
  getById(id: string): Promise<AgentRun | null>;
  /** The queued or running run with this exact request, if there is one. */
  findActiveDuplicate(
    run: Pick<NewAgentRun, "projectId" | "agentId" | "taskType" | "inputHash">,
  ): Promise<AgentRun | null>;
  /** Newest first, by project, agent, or both. */
  listRuns(filter: RunListFilter): Promise<readonly AgentRun[]>;
  /** Cancel and retry. Never `running`, `completed`, or `failed`: those go through a lease. */
  transition(id: string, from: AgentRunStatus, patch: RunPatch): Promise<TransitionOutcome>;
  /** Starts the next attempt of a queued run. */
  claim(request: ClaimRequest): Promise<ClaimOutcome>;
  heartbeat(lease: AttemptLease, leaseSeconds: number): Promise<HeartbeatOutcome>;
  /** Records the attempt's outcome on the attempt and the run together. */
  finish(lease: AttemptLease, result: AttemptResult): Promise<FinishOutcome>;
  /** Fails up to `limit` attempts whose lease has lapsed, with `lease-expired`. */
  recoverExpired(limit: number): Promise<readonly RecoveredAttempt[]>;
  /** Oldest first. */
  listAttempts(runId: string): Promise<readonly AgentRunAttempt[]>;
  /**
   * Re-queues up to `limit` failed runs whose failure is retryable and which
   * have attempts left, with backoff (`@/lib/agent-runs/retry-policy`).
   */
  scheduleRetries(limit: number): Promise<readonly ScheduledRetry[]>;
  runtimeStatus(): Promise<RuntimeStatus>;
};

/** For a deployment with no database: the runtime is present but unavailable. */
export const unavailableAgentRunStore: AgentRunStore = {
  storesRuns: false,
  insert: () => Promise.reject(new Error("Agent runs are not stored in this deployment.")),
  getById: () => Promise.reject(new Error("Agent runs are not stored in this deployment.")),
  findActiveDuplicate: () => Promise.reject(new Error("Agent runs are not stored in this deployment.")),
  listRuns: () => Promise.reject(new Error("Agent runs are not stored in this deployment.")),
  transition: () => Promise.reject(new Error("Agent runs are not stored in this deployment.")),
  claim: () => Promise.reject(new Error("Agent runs are not stored in this deployment.")),
  heartbeat: () => Promise.reject(new Error("Agent runs are not stored in this deployment.")),
  finish: () => Promise.reject(new Error("Agent runs are not stored in this deployment.")),
  recoverExpired: () => Promise.reject(new Error("Agent runs are not stored in this deployment.")),
  listAttempts: () => Promise.reject(new Error("Agent runs are not stored in this deployment.")),
  scheduleRetries: () => Promise.reject(new Error("Agent runs are not stored in this deployment.")),
  runtimeStatus: () => Promise.reject(new Error("Agent runs are not stored in this deployment.")),
};
