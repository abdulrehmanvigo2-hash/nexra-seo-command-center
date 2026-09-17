import type { AgentRun, AgentRunErrorCode } from "@/types/agent-run";

/**
 * Which failures the runtime retries by itself, and when.
 *
 * Conservative on purpose. A failure is retried automatically only when it
 * says nothing about the request being wrong — the executor stumbled, ran out
 * of time, lost its worker, or could not reach its provider — and only while
 * the run has attempts left (`max_attempts`, 3 by default). Everything else is
 * terminal: retrying a refused output, a missing project, a provider refusal,
 * a missing provider configuration, or a policy block would fail the same way
 * again, or worse, succeed at something it should not.
 *
 * The rule is enforced in Postgres by `agent_run_schedule_retries`
 * (supabase/migrations/20260917120000_agent_runtime_production.sql), which
 * holds its own copy of the list and the backoff; this module is the
 * application's copy, for the service, the interface, and the tests. The two
 * must be changed together.
 *
 * Requests that are invalid never become runs at all — unknown projects,
 * agents, and task types, malformed or credential-bearing input — so they have
 * no error code to retry. A cancelled run is never failed, so it is never
 * retried either.
 */

export const RETRYABLE_ERROR_CODES = [
  "timeout",
  "execution-failed",
  "lease-expired",
  "provider-unavailable",
] as const satisfies readonly AgentRunErrorCode[];

export const TERMINAL_ERROR_CODES = [
  "rejected-output",
  "project-missing",
  "provider-rejected",
  "provider-not-configured",
  "policy-blocked",
] as const satisfies readonly AgentRunErrorCode[];

/** Backoff before the first automatic retry; doubles per attempt already made. */
export const RETRY_BASE_DELAY_SECONDS = 120;
export const RETRY_MAX_DELAY_SECONDS = 1_800;

export function isRetryableErrorCode(code: AgentRunErrorCode): boolean {
  return (RETRYABLE_ERROR_CODES as readonly AgentRunErrorCode[]).includes(code);
}

/** The delay before retrying a run that has made `attemptCount` attempts. */
export function retryDelaySeconds(attemptCount: number): number {
  return Math.min(RETRY_MAX_DELAY_SECONDS, RETRY_BASE_DELAY_SECONDS * 2 ** (Math.max(attemptCount, 1) - 1));
}

/** Whether the retry policy would re-queue this run on its next sweep. */
export function willRetryAutomatically(
  run: Pick<AgentRun, "status" | "error" | "attemptCount" | "maxAttempts" | "autoRetryCount">,
): boolean {
  return (
    run.status === "failed" &&
    run.error !== null &&
    isRetryableErrorCode(run.error.code) &&
    run.attemptCount < run.maxAttempts &&
    run.autoRetryCount < run.maxAttempts - 1
  );
}
