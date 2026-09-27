import type { AgentTask, AgentTaskEvent } from "@/lib/agent-tasks/contract";
import type { AgentRun, AgentRunErrorCode, AgentTaskType } from "@/types/agent-run";

/**
 * What became of a task's handoff (Phase 2, checkpoint 2.2): the outcome of
 * the run the task was last handed off to, computed at read time from the
 * run itself. Nothing here is stored: the task's history keeps the link
 * (`handoff-run-linked`, with the run id) and the run row is the one record
 * of how it ended, so a retried run is never shown from a stale copy.
 *
 * Read-only by construction: a task's status never changes because its run
 * finished, and nothing here queues, retries or executes a run. The run is
 * shown only when it provably belongs to the task — it exists, it is the
 * same project's, and its input names this task as `sourceTaskId` — and is
 * otherwise "unavailable", never guessed at.
 */

/** Why an outcome could not be shown. Ids and names only, for the log. */
export type TaskOutcomeUnavailableReason = "run-not-found" | "other-project" | "not-this-task" | "read-failed";

export type TaskRunOutcomeState = "queued" | "running" | "retrying" | "completed" | "failed" | "cancelled";

export type TaskRunOutcome =
  /** The task was never handed off to a run. */
  | { readonly status: "none" }
  /** A run is linked, but it cannot be shown as this task's. */
  | { readonly status: "unavailable"; readonly runId: string }
  | {
      readonly status: TaskRunOutcomeState;
      readonly runId: string;
      readonly taskType: AgentTaskType;
      readonly attemptCount: number;
      readonly autoRetryCount: number;
      /** For `retrying`: not claimed from the queue before this. */
      readonly nextAttemptAt: string | null;
      readonly finishedAt: string | null;
      /** The answering model, when the executor recorded one. */
      readonly model: string | null;
      /** The screened summary, for `completed` only. */
      readonly resultSummary: string | null;
      /** The fixed failure code and message: for `failed`, and for `retrying` (the failure being retried). */
      readonly error: { readonly code: AgentRunErrorCode; readonly message: string } | null;
    };

/** The run the task was last handed off to: the newest `handoff-run-linked` event by `seq`, or null. */
export function latestLinkedRunId(events: readonly AgentTaskEvent[]): string | null {
  let latest: AgentTaskEvent | null = null;
  for (const event of events) {
    if (event.type !== "handoff-run-linked" || event.runId === null) continue;
    if (latest === null || event.seq > latest.seq) latest = event;
  }
  return latest?.runId ?? null;
}

/** Why a read run cannot be shown as this task's outcome, or null when it can. */
export function outcomeMismatch(task: AgentTask, runId: string, run: AgentRun): TaskOutcomeUnavailableReason | null {
  if (run.id.toLowerCase() !== runId.toLowerCase()) return "run-not-found";
  if (run.projectId !== task.projectId) return "other-project";
  const source = run.input.sourceTaskId;
  if (typeof source !== "string" || source.toLowerCase() !== task.id.toLowerCase()) return "not-this-task";
  return null;
}

function stateOf(run: AgentRun): TaskRunOutcomeState {
  // A failed run queued again (by the retry policy or an operator) keeps its failure.
  if (run.status === "queued" && run.error !== null) return "retrying";
  return run.status;
}

/** The outcome of a run already checked with `outcomeMismatch`. */
export function presentTaskRunOutcome(run: AgentRun): TaskRunOutcome {
  const state = stateOf(run);
  const model = run.resultMetadata?.model;
  const summary = typeof run.resultSummary === "string" && run.resultSummary.trim().length > 0 ? run.resultSummary : null;
  return {
    status: state,
    runId: run.id,
    taskType: run.taskType,
    attemptCount: run.attemptCount,
    autoRetryCount: run.autoRetryCount,
    nextAttemptAt: state === "retrying" ? run.nextAttemptAt : null,
    finishedAt: state === "completed" || state === "failed" || state === "cancelled" ? run.finishedAt : null,
    model: typeof model === "string" && model.length > 0 ? model : null,
    resultSummary: state === "completed" ? summary : null,
    error: (state === "failed" || state === "retrying") && run.error !== null ? { code: run.error.code, message: run.error.message } : null,
  };
}

/** One line naming the outcome, in the operator's terms. Never claims work the run did not record. */
export function describeTaskRunOutcome(outcome: TaskRunOutcome): string {
  switch (outcome.status) {
    case "none":
      return "Not handed off yet. No run is linked to this task.";
    case "unavailable":
      return `Outcome unavailable: the linked run ${outcome.runId.slice(0, 8)}… cannot be read as this task's run. Nothing is inferred.`;
    case "queued":
      return `Handed off — run ${outcome.runId.slice(0, 8)}… is queued and has not run yet.`;
    case "running":
      return `Handed off — run ${outcome.runId.slice(0, 8)}… is running.`;
    case "retrying":
      return `Run ${outcome.runId.slice(0, 8)}… failed${outcome.error ? ` (${outcome.error.code})` : ""} and is queued again${outcome.autoRetryCount > 0 ? ` (automatic retry ${outcome.autoRetryCount})` : ""}; it has not run again yet.`;
    case "completed":
      return `Run ${outcome.runId.slice(0, 8)}… completed after ${outcome.attemptCount} attempt${outcome.attemptCount === 1 ? "" : "s"}${outcome.model ? `, answered by ${outcome.model}` : ""}.`;
    case "failed":
      return outcome.error?.code === "rejected-output"
        ? `Run ${outcome.runId.slice(0, 8)}… failed: its answer was refused by the output screen (rejected-output), so no answer was stored.`
        : `Run ${outcome.runId.slice(0, 8)}… failed${outcome.error ? ` (${outcome.error.code})` : ""}.`;
    case "cancelled":
      return `Run ${outcome.runId.slice(0, 8)}… was cancelled. Nothing was stored.`;
  }
}
