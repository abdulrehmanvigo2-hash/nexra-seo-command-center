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
 * is guessed: the server never chooses a record on the operator's behalf.
 * An agent is mapped in one of two shapes. Either its review needs no
 * record — no input at all, or the product's own reporting window
 * (`INVENTORY_RANGE_ID`, the window the run inventory and the Director
 * bundle already use) — or its review reads one record the OPERATOR
 * supplies in the handoff request (checkpoint 2.3): one of the project's
 * own-site crawls (`record: "crawl"`) or one competitor domain the project
 * recorded at intake (`record: "competitor"`). The server validates that
 * record against the project before anything is written, and the run's
 * existing grounding re-checks it at execution. An agent whose task drafts
 * rather than reviews stays deferred: its handoff shows "not supported yet"
 * and creates nothing. A drift test checks each mapping against the
 * task-type definitions: the agent may run it, its policy is read-only, and
 * the input parses.
 */

/** The one record an operator supplies for an agent whose review reads it. */
export type HandoffRecordKind = "crawl" | "competitor";

export type HandoffMapping = {
  readonly taskType: AgentTaskType;
  /** The fixed input; for a record-reading review, empty until the operator's record is added. */
  readonly input: JsonObject;
  /** How the handed-off task reads to the operator before they confirm. */
  readonly label: string;
  /** Set when the operator must supply one record; absent when the review needs none. */
  readonly record?: HandoffRecordKind;
};

/** The record as the handoff request carries it: exactly one field, of the mapping's kind. */
export type HandoffRecord = { readonly crawlId: string } | { readonly competitorDomain: string };

export function handoffRecordKind(record: HandoffRecord): HandoffRecordKind {
  return "crawlId" in record ? "crawl" : "competitor";
}

/** The run input for a mapping and the operator's validated record. */
export function handoffInput(mapping: HandoffMapping, record: HandoffRecord | null): JsonObject {
  if (mapping.record === undefined || record === null) return mapping.input;
  return "crawlId" in record ? { ...mapping.input, crawlId: record.crawlId } : { ...mapping.input, competitorDomain: record.competitorDomain };
}

export const HANDOFF_MAP: Readonly<Partial<Record<TaskOwningAgent, HandoffMapping>>> = {
  "seo-director": { taskType: "project-priority-review", input: {}, label: "Project Director review over the project's newest specialist reviews" },
  "project-manager": { taskType: "intake-review", input: {}, label: "Intake review of the project's stored records" },
  "keyword-intent": { taskType: "search-query-review", input: { range: INVENTORY_RANGE_ID }, label: `Search query review over the ${INVENTORY_RANGE_ID} Search Console window` },
  "analytics-learning": { taskType: "performance-review", input: { range: INVENTORY_RANGE_ID }, label: `Performance review over the ${INVENTORY_RANGE_ID} Search Console window` },
  "research-evidence": { taskType: "evidence-pack-review", input: {}, label: "Evidence pack review of the project's stored records" },
  "content-strategist": { taskType: "content-plan-review", input: {}, label: "Content plan review of the project's stored records" },
  "technical-seo": { taskType: "crawl-review", input: {}, record: "crawl", label: "Crawl review of one of the project's own-site crawls, chosen by the operator" },
  "on-page-seo": { taskType: "on-page-review", input: {}, record: "crawl", label: "On-page review of one of the project's own-site crawls, chosen by the operator" },
  "ai-visibility": { taskType: "answer-readiness-review", input: {}, record: "crawl", label: "Answer-readiness review of one of the project's own-site crawls, chosen by the operator" },
  "authority-backlink": { taskType: "outbound-link-review", input: {}, record: "crawl", label: "Outbound link review of one of the project's own-site crawls, chosen by the operator" },
  "market-intelligence": { taskType: "competitor-comparison-review", input: {}, record: "competitor", label: "Competitor comparison with one competitor domain recorded at intake, chosen by the operator" },
};

/** Why an agent is not mapped. */
export const HANDOFF_DEFERRED: Readonly<Partial<Record<TaskOwningAgent, string>>> = {
  writer: "its only task, the section draft, has the draft policy, not read-only, so it fails the handoff's read-only drift test; it also needs a chosen content plan run and section",
};

export function handoffFor(agent: TaskOwningAgent): HandoffMapping | null {
  return HANDOFF_MAP[agent] ?? null;
}

export function handoffUnsupportedReason(agent: TaskOwningAgent): string | null {
  return HANDOFF_DEFERRED[agent] ?? null;
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
    case "record-required":
      return "This agent's review reads one record: choose it before confirming. Nothing was recorded.";
    case "record-not-accepted":
      return "This agent's review takes no chosen record, or a different kind. Nothing was recorded.";
    case "record-invalid":
      return "The chosen record is not one of this project's own-site crawls or recorded competitor domains. Nothing was recorded.";
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
