import type { ExecuteOutcome } from "@/lib/crawl/review-request";
import { planPipeline, type PipelineAction, type PipelineBlock, type PipelineSnapshot, type PipelineStage } from "@/lib/pipeline/plan";
import type { AgentRun } from "@/types/agent-run";

/**
 * OC1 — One-Click Article, PR 2: the pipeline driver (docs/roadmap/OC1-one-click-article.md, decision D1).
 *
 * The *Check all units* loop (`src/lib/content/articles/checks/check-all-loop.ts`) generalised to the whole article:
 * browser-driven, one step at a time, every call injected (`PipelineIo`) so the screen supplies `fetch` and the
 * tests supply fakes. Before every step it re-reads the snapshot and asks the planner what comes next; a repeat
 * press resumes from what is recorded. It stops at a gate (the owner decides), at a block, on a refused request
 * (a cap, a rate limit, an ended session, the server's own checks), on a run that failed, or on the owner's Stop,
 * which takes effect after the step in flight settles. It never retries a paid run by itself: the only automatic
 * re-runs are the planner's re-drafts, bounded by MAX_REDRAFTS. Nothing here is wired to a route or a screen yet.
 */

export type PerformResult =
  /** The request was accepted. `run` is the agent run it queued or found (a duplicate is the existing run). */
  | { readonly ok: true; readonly run?: AgentRun }
  | { readonly ok: false; readonly message: string };

export type PipelineIo = {
  /** What is recorded for this article in progress; null when it could not be read. */
  readonly readSnapshot: () => Promise<PipelineSnapshot | null>;
  /** One request for one action (queue a run, fetch a source, import, run *Check all units*, publish). */
  readonly perform: (action: PipelineAction) => Promise<PerformResult>;
  readonly execute: (runId: string) => Promise<ExecuteOutcome>;
  readonly readRun: (runId: string) => Promise<AgentRun | null>;
  readonly sleep: (ms: number) => Promise<void>;
  /** True once the owner pressed Stop; read before every step. */
  readonly stopRequested: () => boolean;
  readonly onProgress?: (event: PipelineProgress) => void;
};

export type PipelineProgress =
  | { readonly type: "acting"; readonly action: PipelineAction }
  | { readonly type: "running"; readonly stage: PipelineStage | null; readonly runId: string }
  | { readonly type: "settled"; readonly runId: string; readonly status: AgentRun["status"] }
  | { readonly type: "waiting-serp" };

export type PipelineHalt =
  | { readonly kind: "refused"; readonly action: PipelineAction["kind"] | "execute"; readonly message: string }
  | { readonly kind: "run-failed"; readonly runId: string; readonly code: string | null; readonly message: string }
  | { readonly kind: "unreadable"; readonly message: string }
  | { readonly kind: "timed-out"; readonly runId: string | null }
  | { readonly kind: "blocked"; readonly block: PipelineBlock };

export type PipelineOutcome = {
  readonly ended: "gate-1" | "gate-2" | "done" | "stopped" | "halted";
  readonly halt: PipelineHalt | null;
  /** Every action performed by this press, in order. */
  readonly performed: readonly PipelineAction[];
  readonly snapshot: PipelineSnapshot | null;
};

export type PipelineOptions = {
  readonly pollMs?: number;
  readonly maxPolls?: number;
  /** A safety bound, so a snapshot that never settles cannot loop forever. */
  readonly maxSteps?: number;
};

const DEFAULTS = { pollMs: 3_000, maxPolls: 100, maxSteps: 200 } as const;

export async function runPipeline(io: PipelineIo, options: PipelineOptions = {}): Promise<PipelineOutcome> {
  const { pollMs, maxPolls, maxSteps } = { ...DEFAULTS, ...options };
  const performed: PipelineAction[] = [];
  let snapshot: PipelineSnapshot | null = null;
  let serpPolls = 0;
  const progress = (event: PipelineProgress) => io.onProgress?.(event);
  const finish = (ended: PipelineOutcome["ended"], halt: PipelineHalt | null = null): PipelineOutcome => ({ ended, halt, performed, snapshot });

  /** Executes a queued run (or waits on a running one) and reads it back; a halt, or null to go on. */
  const settle = async (stage: PipelineStage | null, run: AgentRun): Promise<PipelineHalt | null> => {
    if (run.status === "queued") {
      const outcome = await io.execute(run.id);
      if (outcome.kind === "refused") return { kind: "refused", action: "execute", message: outcome.message };
    }
    let current: AgentRun = run;
    for (let polls = 0; ; polls += 1) {
      const read = await io.readRun(run.id);
      if (read === null) return { kind: "unreadable", message: `Run ${run.id.slice(0, 8)} could not be read back.` };
      current = read;
      if (current.status !== "queued" && current.status !== "running") break;
      if (polls >= maxPolls) return { kind: "timed-out", runId: run.id };
      progress({ type: "running", stage, runId: run.id });
      await io.sleep(pollMs);
    }
    progress({ type: "settled", runId: current.id, status: current.status });
    // A failed extraction leaves its source without units and never stops the article; any other failed run does.
    if (current.status === "failed" && stage !== "extraction") {
      return { kind: "run-failed", runId: current.id, code: current.error?.code ?? null, message: current.error?.message ?? "The run failed." };
    }
    // Completed or cancelled: the next snapshot says what follows (a cancelled run blocks in the planner).
    return null;
  };

  for (let steps = 0; steps < maxSteps; steps += 1) {
    if (io.stopRequested()) return finish("stopped");
    snapshot = await io.readSnapshot();
    if (snapshot === null) return finish("halted", { kind: "unreadable", message: "The article in progress could not be read." });

    const plan = planPipeline(snapshot);
    if (plan.next !== "await-serp") serpPolls = 0;

    switch (plan.next) {
      case "gate":
        return finish(plan.gate === 1 ? "gate-1" : "gate-2");
      case "done":
        return finish("done");
      case "blocked":
        return finish("halted", { kind: "blocked", block: plan.block });
      case "await-serp": {
        if (serpPolls >= maxPolls) return finish("halted", { kind: "timed-out", runId: null });
        serpPolls += 1;
        progress({ type: "waiting-serp" });
        await io.sleep(pollMs);
        continue;
      }
      case "await-run": {
        const run = await io.readRun(plan.runId);
        if (run === null) return finish("halted", { kind: "unreadable", message: `Run ${plan.runId.slice(0, 8)} could not be read back.` });
        const halt = await settle(plan.stage, run);
        if (halt !== null) return finish("halted", halt);
        continue;
      }
      case "act": {
        progress({ type: "acting", action: plan.action });
        const result = await io.perform(plan.action);
        if (!result.ok) return finish("halted", { kind: "refused", action: plan.action.kind, message: result.message });
        performed.push(plan.action);
        if (result.run !== undefined) {
          const halt = await settle(stageOf(plan.action), result.run);
          if (halt !== null) return finish("halted", halt);
        }
        continue;
      }
    }
  }

  return finish("halted", { kind: "unreadable", message: "The pipeline did not settle; nothing more was started." });
}

const STAGES: Record<PipelineAction["kind"], PipelineStage> = {
  "fetch-serp": "serp",
  "pick-sources": "sources",
  "fetch-source": "sources",
  extract: "extraction",
  "record-units": "extraction",
  "draft-brief": "brief",
  "draft-part": "parts",
  "redraft-part": "redraft",
  import: "import",
  "check-all": "check",
  publish: "publish",
};

export function stageOf(action: PipelineAction): PipelineStage {
  return STAGES[action.kind];
}
