/**
 * "Check all units" — the loop (step 2). Drives one version's units through
 * the calls the operator makes by hand today, strictly one unit at a time,
 * and nothing else: carry (fix F8's action), queue (`POST /api/agent-runs`),
 * run now (`POST /api/agent-runs/<id> {action:"execute"}`), read back
 * (`GET /api/agent-runs/<id>`), record (the check action). Every unit keeps
 * its own run and its own record; no new lifecycle exists.
 *
 * The calls are injected (`CheckAllIo`), so the browser hook supplies
 * `fetch` and the Server Actions and the tests supply fakes; the driver
 * itself is pure apart from them. It re-reads the check table before every
 * step and asks the planner (step 1) what comes next, so a repeat press
 * resumes from the unchecked rows and skips the recorded ones (decision Q5).
 *
 * It stops (decisions Q2 and Q5) on: a run that failed; a malformed answer
 * recorded `failed`; any refused request — the daily cap, a rate limit, an
 * ended session, the server refusing a record; or the operator's Stop, which
 * takes effect after the unit in flight settles. A unit recorded
 * needs-review does not stop it: the unit is recorded and the next follows,
 * and the outcome lists every unit needing review for the end summary.
 */

import type { ExecuteOutcome } from "@/lib/crawl/review-request";
import { needsReviewUnits, planCheckAll, type CheckAllStep } from "@/lib/content/articles/checks/check-all";
import type { AgentRun } from "@/types/agent-run";
import type { ArticleCheckUnitRecord, ArticleVersionChecks } from "@/types/content-article-check";

export type CheckAllQueueResult = { readonly ok: true; readonly run: AgentRun; readonly duplicate: boolean } | { readonly ok: false; readonly message: string };

export type CheckAllCarryResult =
  | { readonly ok: true }
  /** The earlier pass cannot be carried after all (the evidence changed, or could not be read): the unit is checked instead. */
  | { readonly ok: false; readonly checkInstead: true; readonly message: string }
  | { readonly ok: false; readonly checkInstead: false; readonly message: string };

export type CheckAllRecordResult = { readonly ok: true; readonly status: ArticleCheckUnitRecord["status"] } | { readonly ok: false; readonly message: string };

/** The calls the loop makes, in the shape the browser hook and the tests both supply. */
export type CheckAllIo = {
  /** The version's check table, as `GET /api/content-article-checks` answers it; null when it could not be read. */
  readonly readChecks: () => Promise<ArticleVersionChecks | null>;
  readonly carry: (unitIndex: number) => Promise<CheckAllCarryResult>;
  readonly queue: (unitIndex: number) => Promise<CheckAllQueueResult>;
  readonly execute: (runId: string) => Promise<ExecuteOutcome>;
  readonly readRun: (runId: string) => Promise<AgentRun | null>;
  readonly record: (unitIndex: number, runId: string) => Promise<CheckAllRecordResult>;
  readonly sleep: (ms: number) => Promise<void>;
  /** True once the operator pressed Stop; read before every step and after the unit in flight settles. */
  readonly stopRequested: () => boolean;
  readonly onProgress?: (event: CheckAllProgress) => void;
};

export type CheckAllProgress =
  | { readonly type: "carrying"; readonly index: number; readonly fromVersion: number }
  | { readonly type: "carried"; readonly index: number }
  | { readonly type: "queued"; readonly index: number; readonly runId: string; readonly duplicate: boolean }
  | { readonly type: "running"; readonly index: number; readonly runId: string }
  | { readonly type: "recorded"; readonly index: number; readonly runId: string; readonly status: ArticleCheckUnitRecord["status"] };

export type CheckAllHalt =
  /** A unit's run failed (the provider refused, timed out, or the answer was rejected). */
  | { readonly kind: "run-failed"; readonly index: number; readonly runId: string; readonly code: string | null; readonly message: string }
  /** The run completed but its answer was recorded `failed` (malformed; coverage incomplete). */
  | { readonly kind: "check-failed"; readonly index: number; readonly runId: string }
  /** A request was refused: the cap, a rate limit, the session, the server's own checks. */
  | { readonly kind: "refused"; readonly index: number; readonly step: CheckAllStep["kind"]; readonly message: string }
  /** The check table or a run could not be read back. */
  | { readonly kind: "unreadable"; readonly index: number | null; readonly message: string }
  /** A run stayed queued or running past the wait: the worker may still finish it; nothing else is started. */
  | { readonly kind: "timed-out"; readonly index: number; readonly runId: string };

export type CheckAllOutcome = {
  readonly ended: "done" | "stopped" | "halted";
  readonly halt: CheckAllHalt | null;
  readonly carried: readonly number[];
  readonly checked: readonly number[];
  /** Every unit of the version whose recorded result needs review, after the loop (not only those this press checked). */
  readonly needsReview: readonly number[];
  /** The table as last read, for the screen; null when it could not be read. */
  readonly checks: ArticleVersionChecks | null;
};

export type CheckAllOptions = {
  /** How long to wait, in ms, between reads of a run that is still queued or running. */
  readonly pollMs?: number;
  /** How many reads before a run still queued or running is given up on. */
  readonly maxPolls?: number;
  /** A safety bound on steps, so a table that never settles cannot loop forever. */
  readonly maxSteps?: number;
};

const DEFAULTS = { pollMs: 3_000, maxPolls: 100, maxSteps: 400 } as const;

export async function runCheckAll(io: CheckAllIo, options: CheckAllOptions = {}): Promise<CheckAllOutcome> {
  const { pollMs, maxPolls, maxSteps } = { ...DEFAULTS, ...options };
  const carried: number[] = [];
  const checked: number[] = [];
  /** Units whose carry was refused after all: checked instead, never re-tried as a carry. */
  const checkInstead = new Set<number>();
  let checks: ArticleVersionChecks | null = null;
  const progress = (event: CheckAllProgress) => io.onProgress?.(event);

  const finish = (ended: CheckAllOutcome["ended"], halt: CheckAllHalt | null): CheckAllOutcome => ({
    ended,
    halt,
    carried,
    checked,
    needsReview: checks === null ? [] : needsReviewUnits(checks).map((unit) => unit.index),
    checks,
  });

  /** Reads a run until it is neither queued nor running; null when unreadable, undefined when the wait ran out. */
  const settle = async (index: number, runId: string): Promise<AgentRun | null | undefined> => {
    for (let polls = 0; polls <= maxPolls; polls += 1) {
      const run = await io.readRun(runId);
      if (run === null) return null;
      if (run.status !== "queued" && run.status !== "running") return run;
      if (polls === maxPolls) return undefined;
      progress({ type: "running", index, runId });
      await io.sleep(pollMs);
    }
    return undefined;
  };

  /** Executes a queued run (or waits on a running one), then records its outcome on the unit. Returns a halt, or null to continue. */
  const runAndRecord = async (index: number, run: AgentRun): Promise<CheckAllHalt | null> => {
    let current: AgentRun | null | undefined = run;
    if (run.status === "queued") {
      const outcome = await io.execute(run.id);
      if (outcome.kind === "refused") return { kind: "refused", index, step: "check", message: outcome.message };
      // Accepted or claimed elsewhere: the stored run decides, as Run Now's own read-back does.
      current = await settle(index, run.id);
    } else if (run.status === "running") {
      current = await settle(index, run.id);
    }
    if (current === null) return { kind: "unreadable", index, message: `Run ${run.id.slice(0, 8)} could not be read back.` };
    if (current === undefined) return { kind: "timed-out", index, runId: run.id };
    if (current.status === "failed") {
      return { kind: "run-failed", index, runId: current.id, code: current.error?.code ?? null, message: current.error?.message ?? "The run failed." };
    }
    if (current.status === "cancelled") return { kind: "refused", index, step: "check", message: `Run ${current.id.slice(0, 8)} was cancelled; nothing was recorded.` };
    const recorded = await io.record(index, current.id);
    if (!recorded.ok) return { kind: "refused", index, step: "check", message: recorded.message };
    progress({ type: "recorded", index, runId: current.id, status: recorded.status });
    if (recorded.status === "failed") return { kind: "check-failed", index, runId: current.id };
    if (!checked.includes(index)) checked.push(index);
    return null;
  };

  for (let steps = 0; steps < maxSteps; steps += 1) {
    if (io.stopRequested()) return finish("stopped", null);
    checks = await io.readChecks();
    if (checks === null) return finish("halted", { kind: "unreadable", index: null, message: "The check units could not be read." });

    // The planner's next step, with a refused carry turned into a check; the caps were tested at the press, the server re-checks each request.
    const plan = planCheckAll(checks, { status: "loading" });
    const mapped = plan.steps.map((step): CheckAllStep => (step.kind === "carry" && checkInstead.has(step.index) ? { kind: "check", index: step.index } : step));
    // Carries still first: a carry turned into a check waits until every free carry is done.
    const next = mapped.find((step) => step.kind === "carry") ?? mapped[0];
    if (next === undefined) return finish("done", null);

    if (next.kind === "carry") {
      progress({ type: "carrying", index: next.index, fromVersion: next.fromVersion });
      const result = await io.carry(next.index);
      if (result.ok) {
        carried.push(next.index);
        progress({ type: "carried", index: next.index });
        continue;
      }
      if (result.checkInstead) {
        checkInstead.add(next.index);
        continue;
      }
      return finish("halted", { kind: "refused", index: next.index, step: "carry", message: result.message });
    }

    if (next.kind === "record-pending") {
      const run = await io.readRun(next.runId);
      if (run === null) return finish("halted", { kind: "unreadable", index: next.index, message: `Run ${next.runId.slice(0, 8)} could not be read back.` });
      if (run.status === "cancelled") {
        // A cancelled run leaves the unit pending in the table; the operator clears it by hand (Record as failed). Nothing to automate here.
        return finish("halted", { kind: "refused", index: next.index, step: "record-pending", message: `Unit ${next.index} waits on run ${run.id.slice(0, 8)}, which was cancelled. Record its outcome by hand, then press again.` });
      }
      const halt = await runAndRecord(next.index, run);
      if (halt !== null) return finish("halted", halt);
      continue;
    }

    // next.kind === "check": one paid run for this unit.
    const queued = await io.queue(next.index);
    if (!queued.ok) return finish("halted", { kind: "refused", index: next.index, step: "check", message: queued.message });
    progress({ type: "queued", index: next.index, runId: queued.run.id, duplicate: queued.duplicate });
    const halt = await runAndRecord(next.index, queued.run);
    if (halt !== null) return finish("halted", halt);
  }

  return finish("halted", { kind: "unreadable", index: null, message: "The sequence did not settle; nothing more was started." });
}
