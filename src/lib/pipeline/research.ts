import type { Confirmation } from "@/lib/agent-runs/spend-confirm";
import { BRIEF_REQUEST } from "@/lib/briefs/presenter";
import type { EvidenceSource, EvidenceUnit } from "@/lib/evidence/contract";
import { latestCompletedSerp } from "@/lib/evidence/presenter";
import { SERP_PRICE_PER_CALL_USD } from "@/lib/providers/dataforseo/constants";
import type { AcceptedOpportunity } from "@/lib/opportunities/contract";
import type { PipelineHalt, PipelineOutcome } from "@/lib/pipeline/driver";
import { MAX_SOURCES, type PipelineAction, type PipelineSnapshot, type RunState } from "@/lib/pipeline/plan";
import { stageASnapshot, type StageASource } from "@/lib/pipeline/stage-a";
import type { SerpView } from "@/lib/serp/contract";
import type { AgentRun } from "@/types/agent-run";

/**
 * OC1 — One-Click Article, PR 8: *Start research…*, Stage A on a screen (docs/roadmap/OC1-one-click-article.md, steps
 * 1–5; decisions D1 and D5).
 *
 * From one accepted opportunity to Gate 1 with one confirmation: Google's results (one DataForSEO call, unless a
 * completed one is recorded), up to ten of its organic pages fetched (`pickSources`: the own site left out, one per
 * domain), one `evidence-extract` run per fetched page and its claims recorded, then the `opportunity-brief`. Every step
 * is the request the Evidence tab's own buttons send, run by the existing driver (`runPipeline`) over a snapshot that
 * ends at Gate 1 — the owner's next decision — so a repeat press resumes from what is recorded and nothing is admitted
 * here. A failed extraction leaves its page without claims and never stops the research; anything else refused stops it.
 */

export const RESEARCH_LABEL = "Start research…";

/** Model cost estimates from the M4 / M5 notes (not measured). */
export const EXTRACT_COST_USD = { low: 0.06, high: 0.15 } as const;
export const BRIEF_COST_USD = { low: 0.1, high: 0.2 } as const;

export type ResearchInput = {
  readonly projectDomain: string;
  readonly opportunityId: string;
  readonly serp: SerpView | null;
  readonly sources: readonly EvidenceSource[];
  /** Research & Evidence's runs. */
  readonly researchRuns: readonly AgentRun[];
  /** The Content Strategist's runs. */
  readonly strategistRuns: readonly AgentRun[];
  /** The recorded units of every fetched source of the opportunity. */
  readonly units: readonly EvidenceUnit[];
  /**
   * Extraction runs whose claims can never be recorded, learnt this press (`isFinalRecordRefusal`): an answer with no
   * claim or not in the fixed form. Treated as settled so the research goes on without them.
   */
  readonly settledRuns?: ReadonlySet<string>;
};

export type ResearchSnapshot = PipelineSnapshot & { readonly stageA: readonly StageASource[] };

/** The planner's snapshot for Stage A. Gate 1 is never approved here, so the driver always stops there. */
export function researchSnapshot(input: ResearchInput): ResearchSnapshot {
  // The newest completed results when there are any (an older failed call never hides them), else the newest call.
  const newestSerp = input.serp === null ? null : (latestCompletedSerp(input.serp) ?? input.serp.runs[0] ?? null);
  const stage = stageASnapshot({ projectDomain: input.projectDomain, serp: newestSerp, sources: input.sources, runs: input.researchRuns, units: input.units });
  // A simulated (mock) extraction is never evidence, and a run learnt unrecordable is settled: neither is recorded.
  const simulated = new Set(input.researchRuns.filter((run) => run.executor !== null && run.executor !== "ai").map((run) => run.id));
  const sources = stage.sources.map((source) =>
    source.extraction.state === "run" && source.extraction.status === "completed" && !source.unitsRecorded && (simulated.has(source.extraction.runId) || input.settledRuns?.has(source.extraction.runId))
      ? { ...source, unitsRecorded: true }
      : source,
  );
  return {
    serp: stage.serp,
    sourcesPicked: stage.sourcesPicked,
    sources,
    stageA: sources,
    brief: newestBrief(input.strategistRuns, input.opportunityId),
    gate1Approved: false,
    parts: [],
    redrafts: {},
    article: "none",
    checks: { state: "not-run" },
    gate2Approved: false,
    publication: "none",
  };
}

function newestBrief(runs: readonly AgentRun[], opportunityId: string): RunState {
  const id = opportunityId.toLowerCase();
  const run = runs
    .filter((r) => r.taskType === BRIEF_REQUEST.taskType && String(r.input.opportunityId ?? "").toLowerCase() === id)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))[0];
  return run === undefined ? { state: "none" } : { state: "run", runId: run.id, status: run.status };
}

export type ResearchRequest = { readonly url: string; readonly body: Readonly<Record<string, unknown>> };

/** The one request for an action, exactly as the Evidence tab's buttons send it; null for a step with no request. */
export function researchRequest(action: PipelineAction, snapshot: ResearchSnapshot, projectId: string, opportunityId: string): ResearchRequest | null {
  switch (action.kind) {
    case "fetch-serp":
      return { url: "/api/serp", body: { project: projectId, opportunity: opportunityId } };
    case "fetch-source": {
      const source = snapshot.stageA[action.index];
      if (source === undefined || source.serpResultId === null) return null;
      return { url: "/api/evidence/sources", body: { project: projectId, opportunity: opportunityId, serpResult: source.serpResultId } };
    }
    case "extract": {
      const source = snapshot.stageA[action.index];
      if (source?.sourceId == null) return null;
      return { url: "/api/agent-runs", body: { projectId, agentId: "research-evidence", taskType: "evidence-extract", input: { sourceId: source.sourceId } } };
    }
    case "record-units": {
      const source = snapshot.stageA[action.index];
      if (source?.sourceId == null) return null;
      return { url: "/api/evidence/units", body: { project: projectId, source: source.sourceId, run: action.runId } };
    }
    case "draft-brief":
      return { url: "/api/agent-runs", body: { projectId, ...BRIEF_REQUEST, input: { opportunityId } } };
    default:
      return null;
  }
}

/**
 * The fetched sources whose claims must be read again for the next snapshot: only those whose newest extraction
 * completed and whose claims are not already known to hold that run. Every other source's claims are not needed (no
 * completed run) or already read (`known`: source id → the run ids its read claims carry). Keeps each step's reads
 * small — the Evidence routes allow 120 reads per ten minutes, and ten sources read on every step used them up.
 */
export function sourcesToRead(sources: readonly EvidenceSource[], researchRuns: readonly AgentRun[], known: ReadonlyMap<string, ReadonlySet<string>>): readonly string[] {
  const ids: string[] = [];
  for (const source of sources) {
    if (source.fetchState !== "fetched") continue;
    const newest = researchRuns
      .filter((run) => run.taskType === "evidence-extract" && run.input.sourceId === source.id)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))[0];
    if (newest === undefined || newest.status !== "completed") continue;
    if (known.get(source.id)?.has(newest.id)) continue;
    ids.push(source.id);
  }
  return ids;
}

/** A refusal to record an extraction's claims that a repeat cannot change: skip that page and go on. */
export function isFinalRecordRefusal(status: number, body: unknown): boolean {
  const error = (body as { error?: unknown } | null)?.error;
  return (status === 422 && (error === "no-units" || error === "answer-malformed")) || (status === 409 && (error === "run-not-accepted" || error === "exists"));
}

/** What is left, for the confirmation and the cap check: the model runs still to start. */
export function researchWork(snapshot: ResearchSnapshot): { readonly serp: boolean; readonly pages: number; readonly extractions: number; readonly brief: boolean } {
  const pages = snapshot.sourcesPicked ? snapshot.stageA.filter((s) => s.fetch === "pending").length : MAX_SOURCES;
  const extractions = snapshot.sourcesPicked ? pages + snapshot.stageA.filter((s) => s.fetch === "fetched" && s.extraction.state === "none").length : MAX_SOURCES;
  return { serp: snapshot.serp === "none", pages, extractions, brief: snapshot.brief.state === "none" };
}

export function researchEstimate(work: ReturnType<typeof researchWork>, liveSerp: boolean): { readonly low: number; readonly high: number } {
  const serp = work.serp && liveSerp ? SERP_PRICE_PER_CALL_USD : 0;
  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    low: round(serp + work.extractions * EXTRACT_COST_USD.low + (work.brief ? BRIEF_COST_USD.low : 0)),
    high: round(serp + work.extractions * EXTRACT_COST_USD.high + (work.brief ? BRIEF_COST_USD.high : 0)),
  };
}

/** Model runs the press may start: one per extraction and the brief (checked against today's caps first). */
export function researchRuns(work: ReturnType<typeof researchWork>): number {
  return work.extractions + (work.brief ? 1 : 0);
}

export function researchConfirmation(projectId: string, opportunity: AcceptedOpportunity, work: ReturnType<typeof researchWork>, liveSerp: boolean): Confirmation {
  const estimate = researchEstimate(work, liveSerp);
  const steps = [
    work.serp ? `Google results for "${opportunity.title}" (one DataForSEO call${liveSerp ? "" : ", sandbox — dummy data"})` : null,
    work.pages > 0 ? `fetch up to ${work.pages} of the top pages (your own site left out, one per site)` : null,
    work.extractions > 0 ? `up to ${work.extractions} extraction ${work.extractions === 1 ? "run" : "runs"}, their claims recorded` : null,
    work.brief ? "one brief" : null,
  ].filter((step): step is string => step !== null);
  return {
    title: "Start the research for this article?",
    facts: [
      { label: "Opportunity", value: opportunity.title },
      { label: "Project", value: projectId },
      { label: "Steps", value: steps.length > 0 ? steps.join(" → ") : "nothing left: the brief is recorded" },
      { label: "Estimate", value: `about $${estimate.low.toFixed(2)}–$${estimate.high.toFixed(2)} (model runs and the provider call; estimates, not measured)` },
    ],
    consequence:
      "Runs the steps above one at a time now, each a recorded run or call, and stops at Gate 1 — Approve & write — where you choose the claims the Writer may use. Nothing is admitted, written or published. Keep this page open: closing it pauses the research, and Start research resumes it. A failed extraction is skipped; any refusal stops it.",
    confirmLabel: "Start research",
    dismissLabel: "Go back",
    usage: "created",
    tone: "primary",
  };
}

const STEP_WORDS: Readonly<Record<PipelineAction["kind"], string>> = {
  "fetch-serp": "Fetching Google results",
  "pick-sources": "Choosing pages",
  "fetch-source": "Fetching a page",
  extract: "Extracting claims",
  "record-units": "Recording claims",
  "draft-brief": "Drafting the brief",
  "draft-part": "",
  "redraft-part": "",
  import: "",
  "check-all": "",
  publish: "",
};

export function researchStepText(action: PipelineAction, snapshot: ResearchSnapshot | null): string {
  const words = STEP_WORDS[action.kind] || "Working";
  if ("index" in action && snapshot !== null) {
    const source = snapshot.stageA[action.index];
    if (source !== undefined) return `${words}: ${source.url}`;
  }
  return words;
}

function haltText(halt: PipelineHalt): string {
  switch (halt.kind) {
    case "refused":
      return `Refused: ${halt.message}`;
    case "run-failed":
      return `Run ${halt.runId.slice(0, 8)} failed: ${halt.message}`;
    case "unreadable":
      // The driver's own words name "the article"; here it is the research's records, and usually a read limit.
      return halt.message === "The article in progress could not be read."
        ? "What is recorded for this opportunity could not be read just now (the reads may be over their limit for a few minutes). Nothing is lost: press Start research again in a few minutes and it goes on from here."
        : halt.message;
    case "timed-out":
      return halt.runId === null ? "Google's results did not arrive in time; press Start research again." : `Run ${halt.runId.slice(0, 8)} did not finish in time; it may still complete. Press Start research again.`;
    case "blocked":
      return halt.block.reason === "serp-failed"
        ? "Google's results could not be read (or held no organic result). Fetch them again from Google results below."
        : halt.block.reason === "no-source"
          ? "None of the picked pages could be fetched. Add a page by hand below."
          : halt.block.reason === "brief-failed"
            ? `The brief run ${halt.block.runId.slice(0, 8)} failed. Queue a brief again below.`
            : "The research cannot go on from here.";
  }
}

export function researchNote(outcome: PipelineOutcome): { readonly text: string; readonly tone: "neutral" | "warning" } {
  const did = outcome.performed.length;
  const prefix = did > 0 ? `${did} ${did === 1 ? "step" : "steps"} done. ` : "";
  if (outcome.ended === "gate-1") return { text: `${prefix}Research done: the brief is below. Read it, then Approve & write.`, tone: "neutral" };
  if (outcome.ended === "stopped") return { text: `${prefix}Stopped. Press Start research to go on from here.`, tone: "neutral" };
  if (outcome.halt !== null) return { text: `${prefix}${haltText(outcome.halt)}`, tone: "warning" };
  return { text: `${prefix}The research stopped.`, tone: "warning" };
}
