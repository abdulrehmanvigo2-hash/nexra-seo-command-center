/**
 * Which Run Now button shows "Running…" in a list of queued runs. Only the run whose execute request is in flight is
 * running; every other queued run in the same list is held (disabled, still labelled Run now), because one list sends
 * one execute request at a time. Pure and client-safe.
 */
export type RunNowButtonState = { readonly executing: boolean; readonly blocked: boolean };

export function runNowButtonState(runId: string, executingId: string | null): RunNowButtonState {
  if (executingId === null) return { executing: false, blocked: false };
  return executingId === runId ? { executing: true, blocked: false } : { executing: false, blocked: true };
}
