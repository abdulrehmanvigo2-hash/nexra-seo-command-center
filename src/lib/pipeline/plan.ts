import type { AgentRunStatus } from "@/types/agent-run";

/**
 * OC1 — One-Click Article, PR 2: the pipeline planner (docs/roadmap/OC1-one-click-article.md).
 *
 * Pure. Given what the product has recorded for one article in progress (the snapshot), it answers the one next
 * step, the gate the owner must press, or why the pipeline cannot go on. It never decides anything a gate decides,
 * never spends by itself and holds no state: the driver (`driver.ts`) re-reads the snapshot before every step and
 * asks again, so a repeat press resumes from what is recorded, exactly as *Check all units* does (decision D1).
 *
 * Order (the note's flow): SERP → sources → extraction → brief → Gate 1 → parts → import → check all → re-draft
 * (at most MAX_REDRAFTS per part, decision D4) → Gate 2 → publish. Nothing here is wired to a route or a screen yet.
 */

/** Decision D4: automatic re-drafts per failing part before the pipeline stops for the owner. */
export const MAX_REDRAFTS = 2;
/** Stage A takes the top organic results, the project's own domain excluded (the note's step 2). */
export const MAX_SOURCES = 5;

/** One agent run as the snapshot records it: none yet, or the newest run for that step. */
export type RunState =
  | { readonly state: "none" }
  | { readonly state: "run"; readonly runId: string; readonly status: AgentRunStatus };

export type SourceState = {
  readonly url: string;
  /** `pending`: not fetched yet; `fetched`: text stored; `refused`: the safe fetch refused or failed (not retried). */
  readonly fetch: "pending" | "fetched" | "refused";
  /** The newest `evidence-extract` run for this source; only meaningful once fetched. */
  readonly extraction: RunState;
};

export type PipelineSnapshot = {
  /** The SERP for the keyword (M4). `failed` is not retried automatically (no retry in live mode). */
  readonly serp: "none" | "running" | "completed" | "failed";
  /** The chosen sources, at most MAX_SOURCES, empty until the SERP completed and the picks were recorded. */
  readonly sources: readonly SourceState[];
  /** True once the SERP's organic results were turned into the source list (even when it is empty). */
  readonly sourcesPicked: boolean;
  readonly brief: RunState;
  /** Gate 1: the owner approved the plan (the approval is recorded; the ticked units are admitted). */
  readonly gate1Approved: boolean;
  /** One entry per brief part, in order; empty until the brief completed and was parsed. */
  readonly parts: readonly RunState[];
  /** Re-drafts already made per part index (a missing index is 0). */
  readonly redrafts: Readonly<Record<number, number>>;
  /** The article version holding every newest completed part: `none` before the first import, `stale` after a re-draft. */
  readonly article: "none" | "current" | "stale";
  /** The current version's check table: not run, partly checked, all passed, or parts with a unit that did not pass. */
  readonly checks:
    | { readonly state: "not-run" }
    | { readonly state: "incomplete" }
    | { readonly state: "passed" }
    | { readonly state: "failing"; readonly parts: readonly number[] };
  /** Gate 2: the owner approved publishing this exact version. */
  readonly gate2Approved: boolean;
  /** P-L2's publication for this version. `pr-open` is dry-run's end: the owner merges on GitHub. */
  readonly publication: "none" | "requested" | "pr-open" | "live" | "failed";
};

export type PipelineStage = "serp" | "sources" | "extraction" | "brief" | "parts" | "import" | "check" | "redraft" | "publish";

/** A step the driver performs: one request, then (when it returns a run) that run executed and read back. */
export type PipelineAction =
  | { readonly kind: "fetch-serp" }
  | { readonly kind: "pick-sources" }
  | { readonly kind: "fetch-source"; readonly index: number }
  | { readonly kind: "extract"; readonly index: number }
  | { readonly kind: "draft-brief" }
  | { readonly kind: "draft-part"; readonly index: number }
  | { readonly kind: "redraft-part"; readonly index: number; readonly attempt: number }
  | { readonly kind: "import" }
  | { readonly kind: "check-all" }
  | { readonly kind: "publish" };

export type PipelineBlock =
  | { readonly reason: "serp-failed" }
  | { readonly reason: "no-source" }
  | { readonly reason: "brief-failed"; readonly runId: string }
  | { readonly reason: "brief-without-parts" }
  | { readonly reason: "part-failed"; readonly index: number; readonly runId: string }
  | { readonly reason: "redraft-limit"; readonly parts: readonly number[] }
  | { readonly reason: "run-cancelled"; readonly stage: PipelineStage; readonly runId: string }
  | { readonly reason: "publish-failed" };

export type PipelinePlan =
  | { readonly next: "act"; readonly action: PipelineAction }
  /** A run of this stage is queued or running: execute it if queued, then read it back. Nothing new is started. */
  | { readonly next: "await-run"; readonly stage: PipelineStage; readonly runId: string; readonly status: "queued" | "running" }
  /** The SERP is still running on the provider side: read the snapshot again later. */
  | { readonly next: "await-serp" }
  | { readonly next: "gate"; readonly gate: 1 | 2 }
  | { readonly next: "blocked"; readonly block: PipelineBlock }
  | { readonly next: "done"; readonly publication: "pr-open" | "live" };

const isPending = (status: AgentRunStatus): status is "queued" | "running" => status === "queued" || status === "running";

export function planPipeline(s: PipelineSnapshot): PipelinePlan {
  // Stage A — research.
  if (s.serp === "none") return act({ kind: "fetch-serp" });
  if (s.serp === "running") return { next: "await-serp" };
  if (s.serp === "failed") return blocked({ reason: "serp-failed" });

  if (!s.sourcesPicked) return act({ kind: "pick-sources" });

  const unfetched = s.sources.findIndex((source) => source.fetch === "pending");
  if (unfetched !== -1) return act({ kind: "fetch-source", index: unfetched });
  if (!s.sources.some((source) => source.fetch === "fetched")) return blocked({ reason: "no-source" });

  for (let index = 0; index < s.sources.length; index += 1) {
    const source = s.sources[index];
    if (source === undefined || source.fetch !== "fetched") continue;
    const run = source.extraction;
    if (run.state === "none") return act({ kind: "extract", index });
    if (isPending(run.status)) return awaitRun("extraction", run.runId, run.status);
    // A failed or cancelled extraction leaves that source without units; the brief still runs (EVIDENCE NEEDED says so).
  }

  if (s.brief.state === "none") return act({ kind: "draft-brief" });
  if (isPending(s.brief.status)) return awaitRun("brief", s.brief.runId, s.brief.status);
  if (s.brief.status === "failed") return blocked({ reason: "brief-failed", runId: s.brief.runId });
  if (s.brief.status === "cancelled") return blocked({ reason: "run-cancelled", stage: "brief", runId: s.brief.runId });

  // Gate 1 — the owner approves the plan.
  if (!s.gate1Approved) return { next: "gate", gate: 1 };
  if (s.parts.length === 0) return blocked({ reason: "brief-without-parts" });

  // Stage B — write, import, check.
  for (let index = 0; index < s.parts.length; index += 1) {
    const part = s.parts[index] ?? { state: "none" };
    if (part.state === "none") return act({ kind: "draft-part", index });
    if (isPending(part.status)) return awaitRun(redraftsOf(s, index) > 0 ? "redraft" : "parts", part.runId, part.status);
    if (part.status === "failed") return blocked({ reason: "part-failed", index, runId: part.runId });
    if (part.status === "cancelled") return blocked({ reason: "run-cancelled", stage: "parts", runId: part.runId });
  }

  if (s.article !== "current") return act({ kind: "import" });

  if (s.checks.state === "not-run" || s.checks.state === "incomplete") return act({ kind: "check-all" });
  if (s.checks.state === "failing") {
    const failing = [...new Set(s.checks.parts)].sort((a, b) => a - b);
    const next = failing.find((index) => redraftsOf(s, index) < MAX_REDRAFTS);
    if (next === undefined) return blocked({ reason: "redraft-limit", parts: failing });
    return act({ kind: "redraft-part", index: next, attempt: redraftsOf(s, next) + 1 });
  }

  // Gate 2 — the owner approves publishing.
  if (!s.gate2Approved) return { next: "gate", gate: 2 };
  // `requested`: the request is recorded but Publish has not finished; P-L2 continues a step without a second approval.
  if (s.publication === "none" || s.publication === "requested") return act({ kind: "publish" });
  if (s.publication === "failed") return blocked({ reason: "publish-failed" });
  return { next: "done", publication: s.publication };
}

function redraftsOf(s: PipelineSnapshot, index: number): number {
  return s.redrafts[index] ?? 0;
}

function act(action: PipelineAction): PipelinePlan {
  return { next: "act", action };
}

function awaitRun(stage: PipelineStage, runId: string, status: "queued" | "running"): PipelinePlan {
  return { next: "await-run", stage, runId, status };
}

function blocked(block: PipelineBlock): PipelinePlan {
  return { next: "blocked", block };
}
