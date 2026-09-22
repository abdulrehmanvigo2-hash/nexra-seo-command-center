/**
 * Which Research & Evidence run may be recorded as the fact-check of one
 * exact draft version, decided from the run record alone.
 *
 * The same shape as the rule that decides which Writer run may be saved:
 * the run must be this project's, the Research & Evidence agent's own
 * fact-check task, completed with a result, executed by a model rather than
 * simulated, grounded in recorded evidence, and — the binding — its own
 * metadata must name the draft and the version the operator is recording
 * for. A check of version 2 is never recorded on version 3, however current
 * version 3 has become. Each check has its own reason and runs before
 * anything is written. The server action re-reads the run and applies this
 * in full; the control uses the cheap part to decide whether to offer the
 * button.
 *
 * Pure: no store, no network, safe to import from either side.
 */

import {
  parseFactCheckOutput,
  type FactCheckEvidence,
  type FactCheckOutputRefusal,
  type ParsedFactCheckOutput,
} from "@/lib/content/drafts/parse-fact-check-output";
import type { AgentRun, JsonObject, JsonValue } from "@/types/agent-run";

export const FACT_CHECK_AGENT = "research-evidence";
export const FACT_CHECK_TASK = "draft-fact-check";

export type FactCheckEligibilityRefusal =
  | "run-not-in-project"
  | "wrong-agent"
  | "wrong-task"
  | "run-unfinished"
  | "run-not-completed"
  | "run-no-result"
  | "run-simulated"
  | "run-not-grounded"
  | "provenance-missing"
  /** The run checked a different draft or a different version than the one being recorded. */
  | "version-mismatch"
  | "output-malformed";

export type EligibleFactCheckRun = {
  readonly run: AgentRun;
  readonly evidence: FactCheckEvidence;
  readonly checkedAt: string;
  readonly output: ParsedFactCheckOutput;
};

export type FactCheckEligibilityResult =
  | { readonly ok: true; readonly source: EligibleFactCheckRun }
  | { readonly ok: false; readonly reason: FactCheckEligibilityRefusal; readonly detail?: FactCheckOutputRefusal };

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The draft and version a completed check's own metadata names, or null. */
export function checkedVersionOf(run: AgentRun): { readonly draftId: string; readonly version: number } | null {
  const evidence = run.resultMetadata?.evidence;
  if (!isJsonObject(evidence) || evidence.source !== "draft-version") return null;
  const draftId = evidence.draftId;
  const version = evidence.version;
  if (typeof draftId !== "string" || draftId.length === 0) return null;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) return null;
  return { draftId: draftId.toLowerCase(), version };
}

/** The cheap half: enough to decide whether a completed run should show the record control for this version. */
export function offersRecordFactCheck(run: AgentRun, draftId: string, version: number): boolean {
  if (
    run.status !== "completed" ||
    run.agentId !== FACT_CHECK_AGENT ||
    run.taskType !== FACT_CHECK_TASK ||
    run.executor !== "ai" ||
    run.resultMetadata?.simulated !== false ||
    run.resultMetadata?.grounded !== true ||
    typeof run.resultSummary !== "string" ||
    run.resultSummary.trim().length === 0
  ) {
    return false;
  }
  const checked = checkedVersionOf(run);
  return checked !== null && checked.draftId === draftId.toLowerCase() && checked.version === version;
}

/** The whole rule, in order, with the reason the first failing check gives. */
export function factCheckRunEligibility(
  run: AgentRun,
  target: { readonly projectId: string; readonly draftId: string; readonly version: number },
): FactCheckEligibilityResult {
  if (run.projectId !== target.projectId) return { ok: false, reason: "run-not-in-project" };
  if (run.agentId !== FACT_CHECK_AGENT) return { ok: false, reason: "wrong-agent" };
  if (run.taskType !== FACT_CHECK_TASK) return { ok: false, reason: "wrong-task" };
  if (run.status === "queued" || run.status === "running") return { ok: false, reason: "run-unfinished" };
  if (run.status !== "completed") return { ok: false, reason: "run-not-completed" };
  if (run.resultSummary === null || run.resultSummary.trim().length === 0) return { ok: false, reason: "run-no-result" };

  const metadata = run.resultMetadata;
  if (run.executor !== "ai" || metadata?.simulated === true) return { ok: false, reason: "run-simulated" };
  if (metadata === null || metadata.simulated !== false || metadata.grounded !== true) {
    return { ok: false, reason: "run-not-grounded" };
  }

  const evidence = metadata.evidence;
  if (!isJsonObject(evidence) || evidence.source !== "draft-version") return { ok: false, reason: "provenance-missing" };
  const checked = checkedVersionOf(run);
  const crawlId = evidence.crawlId;
  if (checked === null || typeof crawlId !== "string" || crawlId.length === 0) return { ok: false, reason: "provenance-missing" };
  if (checked.draftId !== target.draftId.toLowerCase() || checked.version !== target.version) {
    return { ok: false, reason: "version-mismatch" };
  }
  const recordPaths = Array.isArray(evidence.recordPaths)
    ? evidence.recordPaths.filter((entry): entry is string => typeof entry === "string")
    : [];
  const searchWindow = typeof evidence.searchWindow === "string" && evidence.searchWindow.length > 0 ? evidence.searchWindow : null;

  const parsed = parseFactCheckOutput(run.resultSummary);
  if (!parsed.ok) return { ok: false, reason: "output-malformed", detail: parsed.reason };

  return {
    ok: true,
    source: {
      run,
      evidence: { crawlId, searchWindow, recordPaths },
      checkedAt: run.finishedAt ?? run.updatedAt,
      output: parsed.output,
    },
  };
}
