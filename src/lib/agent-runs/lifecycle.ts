import type {
  AgentRun,
  AgentRunAttemptOutcome,
  AgentRunErrorCode,
  AgentRunStatus,
} from "@/types/agent-run";

/**
 * The run lifecycle, as pure rules.
 *
 *   queued  → running | cancelled
 *   running → completed | failed | cancelled
 *   failed  → queued          (a retry, while attempts remain)
 *   completed, cancelled      final
 *
 * The database enforces the same graph in a trigger
 * (supabase/migrations/20260914120000_create_agent_runs.sql, extended in
 * 20260916120000_add_agent_run_attempts.sql so a run starts and finishes only
 * through its attempt's lease), so a writer that skips these functions is
 * still refused. These exist so the service can say
 * no before it asks.
 */

export const AGENT_RUN_STATUSES = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const satisfies readonly AgentRunStatus[];

const TRANSITIONS: Readonly<Record<AgentRunStatus, readonly AgentRunStatus[]>> = {
  queued: ["running", "cancelled"],
  running: ["completed", "failed", "cancelled"],
  failed: ["queued"],
  completed: [],
  cancelled: [],
};

/** Attempts a new run is allowed, including the first. */
export const DEFAULT_MAX_ATTEMPTS = 3;

export function isAgentRunStatus(value: unknown): value is AgentRunStatus {
  return typeof value === "string" && (AGENT_RUN_STATUSES as readonly string[]).includes(value);
}

export function canTransition(from: AgentRunStatus, to: AgentRunStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Whether nothing further can happen to the run, retry aside. */
export function isFinished(status: AgentRunStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export function canCancel(run: Pick<AgentRun, "status">): boolean {
  return canTransition(run.status, "cancelled");
}

export function canRetry(run: Pick<AgentRun, "status" | "attemptCount" | "maxAttempts">): boolean {
  return canTransition(run.status, "queued") && run.attemptCount < run.maxAttempts;
}

/** The only failure text a run ever stores or shows. */
export const AGENT_RUN_ERROR_MESSAGES: Readonly<Record<AgentRunErrorCode, string>> = {
  timeout: "The task did not finish in the time allowed.",
  "execution-failed": "The executor could not complete the task.",
  "rejected-output": "The executor's result was refused because it was too large or looked like it contained a credential.",
  "project-missing": "The project this run belongs to could not be read.",
  // Mirrored in agent_run_recover_expired
  // (supabase/migrations/20260916120000_add_agent_run_attempts.sql), which
  // writes it without the application.
  "lease-expired": "The attempt stopped reporting progress before it finished, so it was abandoned.",
};

export function isAgentRunErrorCode(value: unknown): value is AgentRunErrorCode {
  return typeof value === "string" && Object.hasOwn(AGENT_RUN_ERROR_MESSAGES, value);
}

export const AGENT_RUN_ATTEMPT_OUTCOMES = [
  "running",
  "completed",
  "failed",
  "cancelled",
] as const satisfies readonly AgentRunAttemptOutcome[];

export function isAgentRunAttemptOutcome(value: unknown): value is AgentRunAttemptOutcome {
  return typeof value === "string" && (AGENT_RUN_ATTEMPT_OUTCOMES as readonly string[]).includes(value);
}
