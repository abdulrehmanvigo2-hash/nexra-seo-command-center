import { TASK_TITLE_MAX_LENGTH, type TaskOwningAgent, type TaskSourceKind } from "@/lib/agent-tasks/contract";
import type { AgentRun } from "@/types/agent-run";

/**
 * What the "Record as task" control offers an operator before they decide:
 * a proposed title, a prefilled owning agent, and the source the task would
 * name. Proposals only — the operator edits or accepts them, and nothing is
 * recorded until they confirm. Pure, so the same proposal is made on the
 * server and in a test.
 */

export type TaskProposal = {
  readonly sourceKind: TaskSourceKind;
  readonly sourceRef: string;
  readonly title: string;
  readonly owningAgent: TaskOwningAgent;
  /** How the source reads on the control. */
  readonly sourceLabel: string;
};

/** Whether a completed run is one the Director task control belongs under: a completed SEO Director review with a result. */
export function offersDirectorTask(run: AgentRun): boolean {
  return (
    run.status === "completed" &&
    run.agentId === "seo-director" &&
    (run.taskType === "priority-review" || run.taskType === "project-priority-review") &&
    typeof run.resultSummary === "string" &&
    run.resultSummary.trim().length > 0
  );
}

function cut(text: string): string {
  const characters = Array.from(text.trim().replace(/\s+/g, " "));
  return characters.length > TASK_TITLE_MAX_LENGTH ? `${characters.slice(0, TASK_TITLE_MAX_LENGTH - 1).join("")}…` : characters.join("");
}

/**
 * A title proposed from a Director review: its closing line, which the
 * instructions ask to name the single first action, with any list marker
 * or label stripped. When no usable line exists, a neutral fallback that
 * names the run. Never a claim about the site.
 */
export function proposeDirectorTaskTitle(run: AgentRun): string {
  const lines = (run.resultSummary ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])?\s*/, "").replace(/^(?:FIRST ACTION|NEXT|ACTION)\s*[:—-]\s*/i, "").trim())
    .filter((line) => line.length > 0);
  const last = lines.at(-1);
  if (last === undefined || last.length < 8) return cut(`Follow up on the SEO Director review ${run.id.slice(0, 8)}`);
  return cut(last);
}

export function directorTaskProposal(run: AgentRun): TaskProposal {
  return {
    sourceKind: "director-run",
    sourceRef: run.id,
    title: proposeDirectorTaskTitle(run),
    // The Project Manager tracks delivery; the operator may hand it to any agent.
    owningAgent: "project-manager",
    sourceLabel: `SEO Director run ${run.id.slice(0, 8)}…`,
  };
}

/** A title proposed from an observed query: review it, naming the exact stored query text. */
export function keywordTaskProposal(query: string): TaskProposal {
  return {
    sourceKind: "keyword",
    sourceRef: query,
    title: cut(`Review the observed query "${query}"`),
    owningAgent: "keyword-intent",
    sourceLabel: `observed query "${query}"`,
  };
}

/** The refusal or failure of a create request, in the operator's terms. Never the server's text. */
export function createTaskFailure(httpStatus: number, body: unknown): string {
  const error = (body as { error?: unknown } | null)?.error;
  switch (error) {
    case "unavailable":
      return "Tasks are not kept on this deployment, so nothing was recorded.";
    case "project-not-found":
      return "That project is not stored, so nothing was recorded.";
    case "run-not-found":
      return "That Director run is not this project's, or no longer exists, so nothing was recorded.";
    case "run-not-completed":
      return "That Director run has not completed, so there is no result to act on. Nothing was recorded.";
    case "run-not-director":
      return "That run is not an SEO Director review, so nothing was recorded.";
    case "keyword-not-found":
      return "That query is not one this product stored for this project, so nothing was recorded.";
    case "invalid":
      return "The task was refused: check the title (1 to 200 characters) and the fields.";
    case "rate-limited":
      return "Too many tasks recorded in a short time. Wait a few minutes.";
    case "unauthorized":
      return "Sign in as an operator to record a task.";
    default:
      return httpStatus === 0 ? "The request did not complete. Refresh before recording again — it may have been kept." : "The task was not recorded.";
  }
}
