/**
 * Which Writer run may be saved as a draft, decided from the run record
 * alone.
 *
 * The same shape the Writer applies to a content plan and the Director to a
 * review: the run must be this project's, the Writer's own section draft,
 * completed with a result, executed by a model rather than simulated,
 * grounded in recorded evidence, carrying the plan and crawl it was written
 * over, and its text must parse as the Writer's fixed five sections. Each
 * check has its own reason and runs before anything is written. The server
 * action re-reads the run and applies this in full; the control uses the
 * cheap part of it to decide whether to offer the button at all.
 *
 * Pure: no store, no network, safe to import from either side.
 */

import { parseWriterOutput, type ParsedWriterOutput, type WriterOutputRefusal } from "@/lib/content/drafts/parse-writer-output";
import type { AgentRun, JsonObject, JsonValue } from "@/types/agent-run";

export const DRAFT_SOURCE_AGENT = "writer";
export const DRAFT_SOURCE_TASK = "section-draft";

export type DraftEligibilityRefusal =
  | "run-not-in-project"
  | "wrong-agent"
  | "wrong-task"
  | "run-unfinished"
  | "run-not-completed"
  | "run-no-result"
  | "run-simulated"
  | "run-not-grounded"
  | "provenance-missing"
  | "output-malformed";

export type EligibleWriterRun = {
  readonly run: AgentRun;
  readonly planRunId: string;
  readonly crawlId: string;
  readonly sectionIndex: number | null;
  readonly output: ParsedWriterOutput;
};

export type DraftEligibilityResult =
  | { readonly ok: true; readonly source: EligibleWriterRun }
  | { readonly ok: false; readonly reason: DraftEligibilityRefusal; readonly detail?: WriterOutputRefusal };

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The cheap half: enough to decide whether a completed run should show the control. */
export function offersSaveAsDraft(run: AgentRun): boolean {
  return (
    run.status === "completed" &&
    run.agentId === DRAFT_SOURCE_AGENT &&
    run.taskType === DRAFT_SOURCE_TASK &&
    run.executor === "ai" &&
    run.resultMetadata?.simulated === false &&
    run.resultMetadata?.grounded === true &&
    typeof run.resultSummary === "string" &&
    run.resultSummary.trim().length > 0
  );
}

/** The whole rule, in order, with the reason the first failing check gives. */
export function writerRunEligibility(run: AgentRun, projectId: string): DraftEligibilityResult {
  if (run.projectId !== projectId) return { ok: false, reason: "run-not-in-project" };
  if (run.agentId !== DRAFT_SOURCE_AGENT) return { ok: false, reason: "wrong-agent" };
  if (run.taskType !== DRAFT_SOURCE_TASK) return { ok: false, reason: "wrong-task" };
  if (run.status === "queued" || run.status === "running") return { ok: false, reason: "run-unfinished" };
  if (run.status !== "completed") return { ok: false, reason: "run-not-completed" };
  if (run.resultSummary === null || run.resultSummary.trim().length === 0) return { ok: false, reason: "run-no-result" };

  const metadata = run.resultMetadata;
  if (run.executor !== "ai" || metadata?.simulated === true) return { ok: false, reason: "run-simulated" };
  if (metadata === null || metadata.simulated !== false || metadata.grounded !== true) {
    return { ok: false, reason: "run-not-grounded" };
  }

  const evidence = metadata.evidence;
  if (!isJsonObject(evidence) || evidence.source !== "content-draft") return { ok: false, reason: "provenance-missing" };
  const planRunId = evidence.planRunId;
  const crawlId = evidence.crawlId;
  if (typeof planRunId !== "string" || planRunId.length === 0 || typeof crawlId !== "string" || crawlId.length === 0) {
    return { ok: false, reason: "provenance-missing" };
  }
  const sectionIndex =
    typeof evidence.sectionIndex === "number" && Number.isInteger(evidence.sectionIndex) && evidence.sectionIndex >= 1
      ? evidence.sectionIndex
      : null;

  const parsed = parseWriterOutput(run.resultSummary);
  if (!parsed.ok) return { ok: false, reason: "output-malformed", detail: parsed.reason };

  return { ok: true, source: { run, planRunId, crawlId, sectionIndex, output: parsed.output } };
}
