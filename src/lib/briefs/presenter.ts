import { parseBrief, type ParsedBrief } from "@/lib/briefs/brief";
import type { AgentRun } from "@/types/agent-run";

/**
 * The brief panel's words and states on the Evidence tab (M5, PR 3; docs/roadmap/M5-opportunity-brief.md). Pure and
 * client-safe. A brief is the Content Strategist's stored answer, read back by `parseBrief`; it is a model's proposal,
 * never a fact, and a simulated (mock) run's answer is never shown as a brief.
 */

export const BRIEF_LABEL = "Draft brief…";
export const BRIEF_NOTE =
  "A brief is the Content Strategist's proposal for one article, from the records above. It is a model's reading, not a fact: the operator decides whether to draft from it, and every statement in an article is still checked.";
export const BRIEF_REQUEST = { agentId: "content-strategist", taskType: "opportunity-brief" } as const;

/** The brief runs of one opportunity, newest first, from the Content Strategist's run list. */
export function briefRuns(runs: readonly AgentRun[], opportunityId: string): readonly AgentRun[] {
  const id = opportunityId.toLowerCase();
  return runs.filter((run) => run.taskType === "opportunity-brief" && String(run.input.opportunityId ?? "").toLowerCase() === id);
}

export type BriefShown =
  | { readonly state: "none" }
  | { readonly state: "brief"; readonly run: AgentRun; readonly brief: ParsedBrief }
  /** A completed answer that does not hold the fixed order: shown as stored, labelled so. */
  | { readonly state: "unparsed"; readonly run: AgentRun; readonly text: string };

/** The newest completed, model-executed brief run, read back. */
export function latestBrief(runs: readonly AgentRun[]): BriefShown {
  const run = runs.find((entry) => entry.status === "completed" && entry.executor === "ai" && entry.resultSummary !== null);
  if (run === undefined) return { state: "none" };
  const brief = parseBrief(run.resultSummary!);
  return brief === null ? { state: "unparsed", run, text: run.resultSummary! } : { state: "brief", run, brief };
}

export function briefRunLine(run: AgentRun): string {
  const simulated = run.executor === "mock" ? " · simulated, never a brief" : "";
  const failed = run.status === "failed" && run.error !== null ? ` · ${run.error.code}` : "";
  return `Brief ${run.id.slice(0, 8)} · ${run.status}${failed}${simulated} · ${run.createdAt.slice(0, 16).replace("T", " ")} UTC`;
}

/** A support line in words: a crawled path, an admitted unit, or opinion. */
export function supportLabel(support: string): string {
  const crawl = /^\[crawl (\/[^\]]*)\]$/.exec(support);
  if (crawl) return `Crawled page ${crawl[1]}`;
  const unit = /^\[evidence (E\d+)\]$/.exec(support);
  if (unit) return `Admitted evidence ${unit[1]}`;
  if (/^opinion$/i.test(support)) return "Opinion — would be an attested paragraph";
  return support;
}
