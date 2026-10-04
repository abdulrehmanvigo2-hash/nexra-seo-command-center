import type { DailyUsage } from "@/lib/agent-runs/daily-usage";
import { describeRunInput, QUEUE_CONSEQUENCE, type Confirmation, type QueueRequest } from "@/lib/agent-runs/spend-confirm";
import { partStates, partWarnings, type PartState, type PartWarning } from "@/lib/briefs/assemble-article";
import type { ArticlePart } from "@/lib/briefs/article-part";
import type { ParsedBrief } from "@/lib/briefs/brief";
import type { AgentRun } from "@/types/agent-run";

/**
 * M6, PR 4: *Draft article…* on the Brief panel. Pure and client-safe — which parts a brief still needs, the one
 * confirmation that queues them all, the cap check made before anything is sent, and each part's state in words.
 * Queueing calls no model; each part runs when the operator presses Run now or the scheduled worker picks it up.
 */

export const DRAFT_ARTICLE_LABEL = "Draft article…";
export const PART_REQUEST = { agentId: "writer", taskType: "article-part-draft" } as const;

export function partLabel(part: ArticlePart, brief: ParsedBrief): string {
  if (part === "opening") return "Opening — title, meta, lead and introduction";
  if (part === "closing") return "Closing — FAQ answers and call to action";
  const n = Number(part.slice("section-".length));
  return `Section ${n} — ${brief.outline[n - 1]?.heading ?? "not in the brief"}`;
}

/** Each part of the brief with its newest run's state, in article order. */
export function draftParts(brief: ParsedBrief, writerRuns: readonly AgentRun[], briefRunId: string): readonly PartState[] {
  return partStates(brief, writerRuns, briefRunId).map((entry) => entry.state);
}

/** The attestation warnings of the parts drafted so far (M6 follow-up), shown beside each part before the draft fails. */
export function draftWarnings(brief: ParsedBrief, writerRuns: readonly AgentRun[], briefRunId: string): readonly PartWarning[] {
  return partWarnings(partStates(brief, writerRuns, briefRunId));
}

/** The parts to queue: those with no usable run and none queued or running. */
export function partsToQueue(states: readonly PartState[]): readonly ArticlePart[] {
  return states.filter((state) => state.state === "missing" || state.state === "unparsed").map((state) => state.part);
}

export function partRequests(projectId: string, briefRunId: string, parts: readonly ArticlePart[]): readonly QueueRequest[] {
  return parts.map((part) => ({ projectId, ...PART_REQUEST, input: { briefRunId, part } }));
}

export function draftArticleConfirmation(projectId: string, briefRunId: string, parts: readonly ArticlePart[], brief: ParsedBrief): Confirmation {
  return {
    title: `Queue ${parts.length} article part ${parts.length === 1 ? "draft" : "drafts"}?`,
    facts: [
      { label: "Task", value: "Article part draft by Writer, one run per part" },
      { label: "Project", value: projectId },
      { label: "Reads", value: describeRunInput({ briefRunId }) },
      { label: "Parts", value: parts.map((part) => partLabel(part, brief)).join("; ") },
    ],
    consequence: `${QUEUE_CONSEQUENCE} This queues ${parts.length} runs, one per part, and stops at the first one refused. Writes a draft for your review, publishes nothing: no article is created until you import the draft and save it.`,
    confirmLabel: `Queue ${parts.length} runs`,
    dismissLabel: "Go back",
    usage: "created",
    tone: "primary",
  };
}

/** Whether today's caps leave room for every part; checked before anything is sent. */
export function capRoom(usage: DailyUsage | null, count: number): { readonly ok: true } | { readonly ok: false; readonly why: string } {
  if (usage === null) return { ok: false, why: "Today's run usage could not be read, so nothing was queued." };
  const projectLeft = usage.caps.perProject - usage.project.created;
  const allLeft = usage.caps.global - usage.all.created;
  if (projectLeft < count) return { ok: false, why: `Today's project limit has ${Math.max(0, projectLeft)} of the ${count} runs left; nothing was queued. It resets at midnight UTC.` };
  if (allLeft < count) return { ok: false, why: `Today's overall limit has ${Math.max(0, allLeft)} of the ${count} runs left; nothing was queued. It resets at midnight UTC.` };
  return { ok: true };
}

export function partStateLine(state: PartState): string {
  switch (state.state) {
    case "used":
      return `Drafted · run ${state.runId.slice(0, 8)}`;
    case "pending":
      return `${state.status === "running" ? "Running" : "Queued, not run"} · run ${state.runId.slice(0, 8)}`;
    case "unparsed":
      return `Not in the part format · run ${state.runId.slice(0, 8)} — queue it again`;
    default:
      return "Not drafted";
  }
}

/** The outcome of a batch, in words. */
export function batchOutcome(queued: number, total: number, refusal: string | null): { readonly text: string; readonly tone: "neutral" | "warning" } {
  if (refusal === null) return { text: `${queued} part ${queued === 1 ? "draft" : "drafts"} queued, not run. Run now below, or the scheduled worker picks them up.`, tone: "neutral" };
  return { text: `${queued} of ${total} queued; then refused: ${refusal}`, tone: "warning" };
}
