/**
 * What one Research & Evidence run means for one article check unit,
 * decided from the run record alone (Stage 5, milestone C4).
 *
 * The run must be this project's Research & Evidence `article-check-unit`
 * run whose input names exactly this article, version, version row id and
 * unit index. Then its state decides what may be recorded:
 *
 *   * queued or running → `pending`;
 *   * failed → `failed` (run-failed); cancelled → `failed` (run-cancelled);
 *   * completed, model-executed and grounded, whose metadata names this
 *     unit's key, hash, part, part count and the version's unit count → a
 *     verdict, built from its parsed answer; an
 *     answer outside the fixed form → `failed` (output-malformed).
 *
 * A simulated or ungrounded completed run records nothing at all: it
 * checked nothing, so it is neither a verdict nor an execution failure.
 * The database function applies the same run rules again.
 *
 * Pure: no store, no network; safe to import from either side.
 */

import { parseFactCheckOutput, type FactCheckEvidence, type ParsedFactCheckOutput } from "@/lib/content/drafts/parse-fact-check-output";
import type { AgentRun, JsonObject, JsonValue } from "@/types/agent-run";
import type { ArticleCheckFailureReason } from "@/types/content-article-check";

export const ARTICLE_CHECK_AGENT = "research-evidence";
export const ARTICLE_CHECK_TASK = "article-check-unit";

export type ArticleCheckTarget = {
  readonly projectId: string;
  readonly articleId: string;
  readonly articleVersion: number;
  readonly articleVersionId: string;
  readonly unitIndex: number;
  readonly unitKey: string;
  readonly unitSha256: string;
  readonly part: number;
  readonly partCount: number;
  readonly unitCount: number;
};

export type ArticleCheckRunRefusal =
  | "run-not-in-project"
  | "wrong-agent"
  | "wrong-task"
  /** The run was queued for another article, version, version row or unit. */
  | "input-mismatch"
  | "run-simulated"
  | "run-not-grounded"
  | "provenance-missing"
  /** The run's own evidence names another unit key, hash, part or count than the regenerated unit. */
  | "unit-mismatch";

export type ArticleCheckRunDisposition =
  | { readonly ok: true; readonly status: "pending" }
  | { readonly ok: true; readonly status: "failed"; readonly reason: ArticleCheckFailureReason; readonly checkedAt: string }
  | { readonly ok: true; readonly status: "verdict"; readonly output: ParsedFactCheckOutput; readonly evidence: FactCheckEvidence; readonly checkedAt: string }
  | { readonly ok: false; readonly reason: ArticleCheckRunRefusal };

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether the run's input names exactly this unit of this version. */
export function runTargetsUnit(run: AgentRun, target: Pick<ArticleCheckTarget, "articleId" | "articleVersion" | "articleVersionId" | "unitIndex">): boolean {
  const input = run.input;
  return (
    Object.keys(input).length === 4 &&
    typeof input.articleId === "string" &&
    input.articleId.toLowerCase() === target.articleId.toLowerCase() &&
    input.articleVersion === target.articleVersion &&
    typeof input.articleVersionId === "string" &&
    input.articleVersionId.toLowerCase() === target.articleVersionId.toLowerCase() &&
    input.unitIndex === target.unitIndex
  );
}

/** The cheap half, for the panel: whether this run is this unit's check at all. */
export function offersRecordUnit(run: AgentRun, target: Pick<ArticleCheckTarget, "articleId" | "articleVersion" | "articleVersionId" | "unitIndex">): boolean {
  return run.agentId === ARTICLE_CHECK_AGENT && run.taskType === ARTICLE_CHECK_TASK && runTargetsUnit(run, target);
}

/** The whole rule, in order, with the reason the first failing check gives. */
export function articleCheckRunDisposition(run: AgentRun, target: ArticleCheckTarget): ArticleCheckRunDisposition {
  if (run.projectId !== target.projectId) return { ok: false, reason: "run-not-in-project" };
  if (run.agentId !== ARTICLE_CHECK_AGENT) return { ok: false, reason: "wrong-agent" };
  if (run.taskType !== ARTICLE_CHECK_TASK) return { ok: false, reason: "wrong-task" };
  if (!runTargetsUnit(run, target)) return { ok: false, reason: "input-mismatch" };

  const finishedAt = run.finishedAt ?? run.updatedAt;
  if (run.status === "queued" || run.status === "running") return { ok: true, status: "pending" };
  if (run.status === "failed") return { ok: true, status: "failed", reason: "run-failed", checkedAt: finishedAt };
  if (run.status === "cancelled") return { ok: true, status: "failed", reason: "run-cancelled", checkedAt: finishedAt };

  const metadata = run.resultMetadata;
  if (run.executor !== "ai" || metadata?.simulated === true) return { ok: false, reason: "run-simulated" };
  if (metadata === null || metadata.simulated !== false || metadata.grounded !== true) return { ok: false, reason: "run-not-grounded" };

  const evidence = metadata.evidence;
  if (!isJsonObject(evidence) || evidence.source !== "article-unit") return { ok: false, reason: "provenance-missing" };
  const crawlId = evidence.crawlId;
  if (typeof crawlId !== "string" || crawlId.length === 0) return { ok: false, reason: "provenance-missing" };
  if (
    evidence.unitKey !== target.unitKey ||
    evidence.unitSha256 !== target.unitSha256 ||
    evidence.part !== target.part ||
    evidence.partCount !== target.partCount ||
    evidence.unitCount !== target.unitCount ||
    evidence.unitIndex !== target.unitIndex ||
    evidence.articleVersion !== target.articleVersion ||
    typeof evidence.articleVersionId !== "string" ||
    evidence.articleVersionId.toLowerCase() !== target.articleVersionId.toLowerCase()
  ) {
    return { ok: false, reason: "unit-mismatch" };
  }
  const recordPaths = Array.isArray(evidence.recordPaths) ? evidence.recordPaths.filter((entry): entry is string => typeof entry === "string") : [];
  const searchWindow = typeof evidence.searchWindow === "string" && evidence.searchWindow.length > 0 ? evidence.searchWindow : null;

  const parsed = run.resultSummary === null ? null : parseFactCheckOutput(run.resultSummary);
  if (parsed === null || !parsed.ok) return { ok: true, status: "failed", reason: "output-malformed", checkedAt: finishedAt };

  return { ok: true, status: "verdict", output: parsed.output, evidence: { crawlId, searchWindow, recordPaths }, checkedAt: finishedAt };
}
