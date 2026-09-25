import type { ProcessQueueResult } from "@/lib/agent-runs/service";
import type { LogFields, LogLevel } from "@/lib/observability/log";
import { MIN_PROJECT_BUDGET_MS, type SnapshotCaptureBatch, type SnapshotCaptureOptions } from "@/lib/search-console/snapshots/capture";
import type { SearchConsoleWindow } from "@/types/search-console";

/**
 * The scheduled `process` job (milestone M1, checkpoint 1c): the agent-run
 * queue first, exactly as before, then — with whatever time the route has
 * left — one bounded Search Console snapshot capture.
 *
 * The queue is untouched: same batch size, same budget, same answer, and its
 * result is returned whatever the capture does. The capture is appended
 * after it and can only ever shorten itself:
 *
 *   - it gets at most CAPTURE_MAX_MS (45 s), and less when the queue left
 *     less: the route's own limit, minus a response margin, minus the time
 *     already spent;
 *   - it is skipped outright when that is under the capture's own minimum
 *     for one project (`time-budget`), with nothing started;
 *   - the whole call is raced against a hard deadline of its budget plus a
 *     short grace for a write already in flight; if the deadline wins the
 *     job answers `timed-out` and returns without waiting. The capture's own
 *     per-project deadline (checkpoint 1b) ends a Google read at its
 *     budget, so the grace only ever covers a database write, which is one
 *     transaction the database completes or rolls back whole — a later
 *     capture of the same window answers `exists` or writes it then;
 *   - a capture that throws is logged by name and answers `failed`.
 *
 * Nominal timing: queue 240 s + capture 45 s + grace 5 s = 290 s, under the
 * route's 300 s with 10 s to respond. The answer carries project ids,
 * outcome names and counts only — never a query, a page, a property or a
 * row.
 */

export const ROUTE_MAX_DURATION_MS = 300_000;
/** The queue's budget, as before this checkpoint. */
export const QUEUE_BUDGET_MS = 240_000;
export const QUEUE_MAX_RUNS = 5;
/** The most the capture may have, however early the queue finished. */
export const CAPTURE_MAX_MS = 45_000;
/** Kept free at the end of the route for the capture's grace and the response. */
export const RESPONSE_MARGIN_MS = 15_000;
/** How long past its budget a capture may run to finish a write already in flight. */
export const CAPTURE_GRACE_MS = 5_000;
export const CAPTURE_MAX_PROJECTS = 10;

export type SnapshotStepResult =
  | {
      readonly status: "captured";
      readonly window: SearchConsoleWindow;
      readonly entries: readonly {
        readonly projectId: string;
        readonly outcome: string;
        readonly reason: string | null;
        /** The P4c query × page step's outcome name for the project; a name, never a row. */
        readonly pairs: string;
      }[];
      readonly attempted: number;
      readonly stoppedBy: SnapshotCaptureBatch["stoppedBy"];
      readonly budgetMs: number;
      readonly durationMs: number;
    }
  /** Not started: the queue left too little of the route's time. */
  | { readonly status: "skipped"; readonly reason: "time-budget"; readonly budgetMs: number }
  /** Started but did not finish inside its budget and grace; the route answered without it. */
  | { readonly status: "timed-out"; readonly budgetMs: number; readonly durationMs: number }
  /** The capture threw; the error is logged by name only. */
  | { readonly status: "failed"; readonly budgetMs: number; readonly durationMs: number };

export type ProcessJobOutcome<Refusal> =
  | { readonly kind: "refused"; readonly response: Refusal }
  | { readonly kind: "queue-failed"; readonly failure: Extract<ProcessQueueResult, { ok: false }> }
  | {
      readonly kind: "ok";
      readonly queue: Extract<ProcessQueueResult, { ok: true }>;
      readonly snapshots: SnapshotStepResult;
      readonly durationMs: number;
    };

export type ProcessJobDependencies<Refusal> = {
  /** The worker's credential and rate-limit check; null admits. */
  readonly admit: () => Promise<Refusal | null>;
  readonly processQueue: (options: { readonly maxRuns: number; readonly budgetMs: number }) => Promise<ProcessQueueResult>;
  readonly capture: (options: SnapshotCaptureOptions) => Promise<SnapshotCaptureBatch>;
  /** Milliseconds, monotonic; `performance.now` by default. */
  readonly now?: () => number;
  readonly log?: (level: LogLevel, event: string, fields: LogFields) => void;
  /** Route limits, injectable for tests; production uses the constants above. */
  readonly limits?: {
    readonly routeMaxMs?: number;
    readonly captureMaxMs?: number;
    readonly responseMarginMs?: number;
    readonly captureGraceMs?: number;
  };
};

/** The capture's budget after the queue: at most CAPTURE_MAX_MS, never into the response margin. */
export function captureBudgetMs(elapsedMs: number, limits: { routeMaxMs: number; captureMaxMs: number; responseMarginMs: number }): number {
  return Math.max(0, Math.min(limits.captureMaxMs, limits.routeMaxMs - limits.responseMarginMs - Math.ceil(elapsedMs)));
}

const TIMED_OUT = Symbol("timed-out");

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), Math.max(0, ms));
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

export async function runProcessJob<Refusal>(deps: ProcessJobDependencies<Refusal>): Promise<ProcessJobOutcome<Refusal>> {
  const { admit, processQueue, capture, now = () => performance.now(), log = () => {} } = deps;
  const limits = {
    routeMaxMs: deps.limits?.routeMaxMs ?? ROUTE_MAX_DURATION_MS,
    captureMaxMs: deps.limits?.captureMaxMs ?? CAPTURE_MAX_MS,
    responseMarginMs: deps.limits?.responseMarginMs ?? RESPONSE_MARGIN_MS,
    captureGraceMs: deps.limits?.captureGraceMs ?? CAPTURE_GRACE_MS,
  };
  const startedAt = now();
  const elapsed = () => Math.round(now() - startedAt);

  const refused = await admit();
  if (refused !== null) return { kind: "refused", response: refused };

  // 1. The queue, exactly as before.
  const queue = await processQueue({ maxRuns: QUEUE_MAX_RUNS, budgetMs: QUEUE_BUDGET_MS });
  if (!queue.ok) return { kind: "queue-failed", failure: queue };

  // 2. The capture, in what is left.
  const budgetMs = captureBudgetMs(elapsed(), limits);
  let snapshots: SnapshotStepResult;
  if (budgetMs < MIN_PROJECT_BUDGET_MS) {
    snapshots = { status: "skipped", reason: "time-budget", budgetMs };
  } else {
    const began = now();
    const took = () => Math.round(now() - began);
    try {
      const batch = await withDeadline(capture({ maxProjects: CAPTURE_MAX_PROJECTS, budgetMs }), budgetMs + limits.captureGraceMs);
      snapshots =
        batch === TIMED_OUT
          ? { status: "timed-out", budgetMs, durationMs: took() }
          : {
              status: "captured",
              window: batch.window,
              entries: batch.entries.map((entry) => ({
                projectId: entry.projectId,
                outcome: entry.outcome.status,
                reason: "reason" in entry.outcome ? entry.outcome.reason : null,
                pairs: entry.pairs.status,
              })),
              attempted: batch.attempted,
              stoppedBy: batch.stoppedBy,
              budgetMs,
              durationMs: took(),
            };
    } catch (error) {
      log("error", "worker.snapshots_failed", { job: "process", errorCode: error instanceof Error ? error.name : "unknown" });
      snapshots = { status: "failed", budgetMs, durationMs: took() };
    }
  }

  log(snapshots.status === "captured" || snapshots.status === "skipped" ? "info" : "warn", "worker.snapshots", {
    job: "process",
    status: snapshots.status,
    limit: snapshots.budgetMs,
    count: snapshots.status === "captured" ? snapshots.attempted : 0,
    stoppedBy: snapshots.status === "captured" ? snapshots.stoppedBy : snapshots.status === "skipped" ? snapshots.reason : null,
    durationMs: snapshots.status === "skipped" ? 0 : snapshots.durationMs,
  });

  return { kind: "ok", queue, snapshots, durationMs: elapsed() };
}
