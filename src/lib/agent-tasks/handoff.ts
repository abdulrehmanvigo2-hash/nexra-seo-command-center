import type { TaskOwningAgent } from "@/lib/agent-tasks/contract";
import { INVENTORY_RANGE_ID } from "@/lib/projects/grounding";
import type { AgentTaskType, JsonObject } from "@/types/agent-run";

/**
 * Specialist handoff: which executable task a task's owning agent is handed,
 * and with what input (Project Manager task workflow).
 *
 * A handoff creates one queued run for the owning agent through the run
 * path, and nothing else — no execution, no "Run now". A run needs a task
 * type the agent may run and an input its definition accepts, and neither
 * is guessed: an agent is mapped only when it has one project-level review
 * whose input the server fills without choosing a record on the operator's
 * behalf — no input at all, or the product's own reporting window
 * (`INVENTORY_RANGE_ID`, the window the run inventory and the Director
 * bundle already use). An agent whose only tasks need a chosen record (a
 * crawl, a competitor domain, a plan run and section, a draft or article
 * version) is not mapped: its handoff shows "not supported yet" and creates
 * nothing. A drift test checks each mapping against the task-type
 * definitions: the agent may run it, its policy is read-only, and the
 * input parses.
 */

export type HandoffMapping = {
  readonly taskType: AgentTaskType;
  readonly input: JsonObject;
  /** How the handed-off task reads to the operator before they confirm. */
  readonly label: string;
};

export const HANDOFF_MAP: Readonly<Partial<Record<TaskOwningAgent, HandoffMapping>>> = {
  "seo-director": { taskType: "project-priority-review", input: {}, label: "Project Director review over the project's newest specialist reviews" },
  "project-manager": { taskType: "intake-review", input: {}, label: "Intake review of the project's stored records" },
  "keyword-intent": { taskType: "search-query-review", input: { range: INVENTORY_RANGE_ID }, label: `Search query review over the ${INVENTORY_RANGE_ID} Search Console window` },
  "analytics-learning": { taskType: "performance-review", input: { range: INVENTORY_RANGE_ID }, label: `Performance review over the ${INVENTORY_RANGE_ID} Search Console window` },
  "research-evidence": { taskType: "evidence-pack-review", input: {}, label: "Evidence pack review of the project's stored records" },
  "content-strategist": { taskType: "content-plan-review", input: {}, label: "Content plan review of the project's stored records" },
};

/** Why an agent is not mapped: which record its tasks need that a task cannot name. */
export const HANDOFF_DEFERRED: Readonly<Record<Exclude<TaskOwningAgent, keyof typeof HANDOFF_MAP>, string>> = {
  "technical-seo": "its crawl review needs a chosen crawl",
  "on-page-seo": "its on-page review needs a chosen crawl",
  "ai-visibility": "its answer-readiness review needs a chosen crawl",
  "authority-backlink": "its outbound link review needs a chosen crawl",
  "market-intelligence": "its competitor comparison needs a chosen competitor domain",
  writer: "its section draft needs a chosen content plan run and section, and drafts rather than reviews",
};

export function handoffFor(agent: TaskOwningAgent): HandoffMapping | null {
  return HANDOFF_MAP[agent] ?? null;
}

export function handoffUnsupportedReason(agent: TaskOwningAgent): string | null {
  return agent in HANDOFF_DEFERRED ? HANDOFF_DEFERRED[agent as keyof typeof HANDOFF_DEFERRED] : null;
}

/** The refusal or failure of a task action, in the operator's terms. Never the server's text. */
export function taskActionFailure(httpStatus: number, body: unknown): string {
  const error = (body as { error?: unknown } | null)?.error;
  switch (error) {
    case "unavailable":
      return "Tasks are not kept on this deployment, so nothing changed.";
    case "task-not-found":
      return "That task is not this project's, or no longer exists. Nothing changed.";
    case "same-status":
      return "The task is already in that status. Nothing changed.";
    case "same-owner":
      return "That agent already owns the task. Nothing changed.";
    case "terminal":
      return "A completed or cancelled task does not change. Nothing changed.";
    case "transition-not-allowed":
      return "That status does not follow the task's current one. Refresh and choose one of the offered moves.";
    case "handoff-active":
      return "A run this task was already handed off to is still queued or running. No second run was created.";
    case "handoff-unsupported":
      return "Handoff is not supported yet for this owning agent. No run was created.";
    case "run-refused":
      return "The run path refused to queue the specialist's task, so no run was created. The request is in the task's history.";
    case "invalid":
      return "The request was refused: check the fields.";
    case "rate-limited":
      return "Too many task changes in a short time. Wait a few minutes.";
    case "unauthorized":
      return "Sign in as an operator to change a task.";
    default:
      return httpStatus === 0 ? "The request did not complete. Refresh before trying again — it may have been applied." : "The change was not applied.";
  }
}
