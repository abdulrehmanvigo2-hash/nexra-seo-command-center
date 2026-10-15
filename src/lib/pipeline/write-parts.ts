import type { ExecuteOutcome } from "@/lib/crawl/review-request";
import type { PartState } from "@/lib/briefs/assemble-article";
import type { ArticlePart } from "@/lib/briefs/article-part";
import type { ParsedBrief } from "@/lib/briefs/brief";
import { draftParts } from "@/lib/briefs/draft-presenter";
import type { AgentRun } from "@/types/agent-run";

/**
 * OC1 — One-Click Article, PR 5: write every part after Gate 1, without a Run now press per part
 * (docs/roadmap/OC1-one-click-article.md, Stage B step 6; decision D1).
 *
 * The *Check all units* pattern again: browser-driven, one run at a time, calls injected. Before every step it re-reads
 * the Writer's runs for this brief and takes the first queued (or running) part; it executes it through the same
 * request Run now sends and reads it back until it settles. It never queues a run and never re-runs a failed one: a
 * failed part, a refusal (the daily cap included), a timeout or the owner's Stop ends it, and a repeat press resumes
 * from what is recorded. When every part is drafted, the assembled draft is ready below (M6's *Open in editor*).
 */

export type WritingIo = {
  /** The Writer's runs (any order); null when they could not be read. */
  readonly readRuns: () => Promise<readonly AgentRun[] | null>;
  readonly execute: (runId: string) => Promise<ExecuteOutcome>;
  readonly readRun: (runId: string) => Promise<AgentRun | null>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly stopRequested: () => boolean;
  readonly onProgress?: (event: WritingProgress) => void;
};

export type WritingProgress =
  | { readonly type: "running"; readonly part: ArticlePart; readonly runId: string; readonly done: number; readonly total: number }
  | { readonly type: "drafted"; readonly part: ArticlePart; readonly runId: string; readonly done: number; readonly total: number };

export type WritingHalt =
  | { readonly kind: "run-failed"; readonly part: ArticlePart; readonly runId: string; readonly code: string | null; readonly message: string }
  | { readonly kind: "refused"; readonly part: ArticlePart; readonly message: string }
  | { readonly kind: "cancelled"; readonly part: ArticlePart; readonly runId: string }
  | { readonly kind: "unreadable"; readonly message: string }
  | { readonly kind: "timed-out"; readonly part: ArticlePart; readonly runId: string }
  /** No run is queued for these parts (never queued, or drafted outside the part format): queue them again first. */
  | { readonly kind: "not-queued"; readonly parts: readonly ArticlePart[] };

export type WritingOutcome = {
  readonly ended: "done" | "stopped" | "halted";
  readonly halt: WritingHalt | null;
  /** Parts this press ran to completion. */
  readonly ran: readonly ArticlePart[];
  readonly states: readonly PartState[] | null;
};

const DEFAULTS = { pollMs: 3_000, maxPolls: 100, maxSteps: 50 } as const;

export function writingCounts(states: readonly PartState[]): { readonly drafted: number; readonly waiting: number; readonly total: number } {
  return {
    drafted: states.filter((s) => s.state === "used").length,
    waiting: states.filter((s) => s.state === "pending").length,
    total: states.length,
  };
}

export async function runWriting(io: WritingIo, brief: ParsedBrief, briefRunId: string, options: { pollMs?: number; maxPolls?: number; maxSteps?: number } = {}): Promise<WritingOutcome> {
  const { pollMs, maxPolls, maxSteps } = { ...DEFAULTS, ...options };
  const ran: ArticlePart[] = [];
  let states: readonly PartState[] | null = null;
  const finish = (ended: WritingOutcome["ended"], halt: WritingHalt | null = null): WritingOutcome => ({ ended, halt, ran, states });

  for (let steps = 0; steps < maxSteps; steps += 1) {
    if (io.stopRequested()) return finish("stopped");
    const runs = await io.readRuns();
    if (runs === null) return finish("halted", { kind: "unreadable", message: "The Writer's runs could not be read." });
    states = draftParts(brief, runs, briefRunId);
    const next = states.find((s): s is Extract<PartState, { state: "pending" }> => s.state === "pending");
    if (next === undefined) {
      const notQueued = states.filter((s) => s.state === "missing" || s.state === "unparsed").map((s) => s.part);
      return notQueued.length === 0 ? finish("done") : finish("halted", { kind: "not-queued", parts: notQueued });
    }

    const counts = writingCounts(states);
    io.onProgress?.({ type: "running", part: next.part, runId: next.runId, done: counts.drafted, total: counts.total });
    if (next.status === "queued") {
      const outcome = await io.execute(next.runId);
      if (outcome.kind === "refused") return finish("halted", { kind: "refused", part: next.part, message: outcome.message });
    }

    let settled: AgentRun | null = null;
    for (let polls = 0; ; polls += 1) {
      const run = await io.readRun(next.runId);
      if (run === null) return finish("halted", { kind: "unreadable", message: `Run ${next.runId.slice(0, 8)} could not be read back.` });
      if (run.status !== "queued" && run.status !== "running") {
        settled = run;
        break;
      }
      if (polls >= maxPolls) return finish("halted", { kind: "timed-out", part: next.part, runId: next.runId });
      await io.sleep(pollMs);
    }
    if (settled.status === "failed") {
      return finish("halted", { kind: "run-failed", part: next.part, runId: settled.id, code: settled.error?.code ?? null, message: settled.error?.message ?? "The run failed." });
    }
    if (settled.status === "cancelled") return finish("halted", { kind: "cancelled", part: next.part, runId: settled.id });
    ran.push(next.part);
    io.onProgress?.({ type: "drafted", part: next.part, runId: settled.id, done: counts.drafted + 1, total: counts.total });
  }
  return finish("halted", { kind: "unreadable", message: "The writing did not settle; nothing more was started." });
}

/** The outcome in words, for the panel. */
export function writingNote(outcome: WritingOutcome, label: (part: ArticlePart) => string): { readonly text: string; readonly tone: "neutral" | "warning" } {
  const ran = outcome.ran.length;
  const prefix = ran > 0 ? `${ran} ${ran === 1 ? "part" : "parts"} written. ` : "";
  if (outcome.ended === "done") return { text: `${prefix}Every part is drafted: the assembled draft is below the brief — open it in the editor.`, tone: "neutral" };
  if (outcome.ended === "stopped") return { text: `${prefix}Stopped. Press Continue writing to go on from here.`, tone: "neutral" };
  const halt = outcome.halt!;
  switch (halt.kind) {
    case "run-failed":
      return { text: `${prefix}${label(halt.part)} failed (${halt.code ?? "error"}): ${halt.message} Queue that part again from the article draft above; nothing else was run.`, tone: "warning" };
    case "refused":
      return { text: `${prefix}${label(halt.part)} was not run: ${halt.message}`, tone: "warning" };
    case "cancelled":
      return { text: `${prefix}${label(halt.part)}'s run was cancelled. Queue it again from the article draft above.`, tone: "warning" };
    case "timed-out":
      return { text: `${prefix}${label(halt.part)} is still running after the wait. It may still finish; press Continue writing later.`, tone: "warning" };
    case "not-queued":
      return { text: `${prefix}No run is queued for: ${halt.parts.map(label).join("; ")}. Its answer did not hold the part's form, or no run was queued: press Write the missing parts below.`, tone: "warning" };
    default:
      return { text: `${prefix}${halt.message}`, tone: "warning" };
  }
}
