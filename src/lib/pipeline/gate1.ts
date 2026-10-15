import type { DailyUsage } from "@/lib/agent-runs/daily-usage";
import { QUEUE_CONSEQUENCE, type Confirmation } from "@/lib/agent-runs/spend-confirm";
import type { ArticlePart } from "@/lib/briefs/article-part";
import type { ParsedBrief } from "@/lib/briefs/brief";
import { capRoom, partLabel, partRequests, PART_REQUEST } from "@/lib/briefs/draft-presenter";
import { writeOutcome } from "@/lib/evidence/presenter";
import type { Gate1Evidence } from "@/lib/pipeline/stage-a";
import type { AgentRun } from "@/types/agent-run";

/**
 * OC1 — One-Click Article, PR 4: Gate 1, *Approve the plan* (docs/roadmap/OC1-one-click-article.md).
 *
 * Pure apart from `runGate1`, whose calls are injected. The owner sees the brief, the evidence offered pre-ticked
 * (`gate1Evidence`), the parts the Writer will draft and an estimate, and presses one button: the ticked units are
 * admitted through the existing decide route (the database's own admission rule still decides each), then every part
 * is queued through the existing run route — the same requests *Draft article…* sends. Nothing runs a model here:
 * queued parts run on Run now or the scheduled worker.
 *
 * Where the approval is recorded (a deviation from the note, which said "one approval record"): Gate 1 is approved when
 * a Writer part run names this brief — the queued runs are the operator's recorded action (who, when, which brief),
 * permanent in the run store, so no new table or migration is needed. The ticked units' admissions are recorded as
 * before, one decision each.
 */

export const GATE1_LABEL = "Approve & write…";

/** Writer cost per part from the M6 note (estimate, not measured). */
export const PART_COST_USD = { low: 0.05, high: 0.1 } as const;

export type Gate1State =
  | { readonly approved: false }
  /** The earliest Writer part run naming this brief: when, and by whom, the plan was approved. */
  | { readonly approved: true; readonly at: string; readonly by: string; readonly runs: number };

export function gate1State(briefRunId: string, writerRuns: readonly AgentRun[]): Gate1State {
  const id = briefRunId.toLowerCase();
  const parts = writerRuns.filter((run) => run.taskType === PART_REQUEST.taskType && String(run.input.briefRunId ?? "").toLowerCase() === id);
  if (parts.length === 0) return { approved: false };
  const first = [...parts].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))[0]!;
  return { approved: true, at: first.createdAt, by: first.createdBy, runs: parts.length };
}

export function partsEstimate(parts: number): { readonly low: number; readonly high: number } {
  const round = (value: number) => Math.round(value * 100) / 100;
  return { low: round(parts * PART_COST_USD.low), high: round(parts * PART_COST_USD.high) };
}

export function gate1Confirmation(projectId: string, brief: ParsedBrief, parts: readonly ArticlePart[], admit: number, offered: Gate1Evidence): Confirmation {
  const estimate = partsEstimate(parts.length);
  const left = offered.preTicked.length - admit;
  return {
    title: `Approve the plan and queue ${parts.length} article ${parts.length === 1 ? "part" : "parts"}?`,
    facts: [
      { label: "Project", value: projectId },
      { label: "Angle", value: brief.angle },
      { label: "Evidence to admit", value: `${admit} ${admit === 1 ? "claim" : "claims"}${left > 0 ? ` (${left} unticked, left pending)` : ""}` },
      { label: "Parts", value: parts.map((part) => partLabel(part, brief)).join("; ") },
      { label: "Writing estimate", value: `about $${estimate.low.toFixed(2)}–$${estimate.high.toFixed(2)} (one Writer run per part; checks are separate)` },
    ],
    consequence: `Admits each ticked claim (the database checks each one again), then queues one Writer run per part. ${QUEUE_CONSEQUENCE} Writes a draft for your review, publishes nothing.`,
    confirmLabel: `Approve & queue ${parts.length}`,
    dismissLabel: "Go back",
    usage: "created",
    tone: "primary",
  };
}

export type Gate1Request = { readonly url: string; readonly body: Readonly<Record<string, unknown>>; readonly kind: "admit" | "queue" };

/** The requests, in order: every admission first, then every part. */
export function gate1Requests(projectId: string, briefRunId: string, admit: readonly string[], parts: readonly ArticlePart[]): readonly Gate1Request[] {
  return [
    ...admit.map((unitId): Gate1Request => ({ kind: "admit", url: `/api/evidence/units/${unitId}`, body: { project: projectId, decision: "admitted" } })),
    ...partRequests(projectId, briefRunId, parts).map((request): Gate1Request => ({ kind: "queue", url: "/api/agent-runs", body: request })),
  ];
}

export type Gate1Io = {
  readonly usage: () => Promise<DailyUsage | null>;
  readonly post: (url: string, body: Readonly<Record<string, unknown>>) => Promise<{ readonly status: number; readonly body: unknown }>;
};

export type Gate1Outcome = { readonly admitted: number; readonly queued: number; readonly refusal: string | null; readonly text: string; readonly tone: "neutral" | "warning" };

/**
 * Sends the requests one at a time and stops at the first refusal. The run cap is checked before anything is sent, so a
 * press that cannot queue every part admits nothing. An admission refused because the unit was decided meanwhile
 * (`already-decided`) does not stop the rest; any other refusal does.
 */
export async function runGate1(io: Gate1Io, requests: readonly Gate1Request[]): Promise<Gate1Outcome> {
  const parts = requests.filter((request) => request.kind === "queue").length;
  let admitted = 0;
  let queued = 0;
  let refusal: string | null = null;
  try {
    const room = capRoom(await io.usage(), parts);
    if (!room.ok) refusal = room.why;
    else {
      for (const request of requests) {
        const answer = await io.post(request.url, request.body);
        if (answer.status >= 200 && answer.status < 300) {
          if (request.kind === "admit") admitted += 1;
          else queued += 1;
          continue;
        }
        if (request.kind === "admit" && (answer.body as { error?: unknown } | null)?.error === "already-decided") continue;
        refusal = writeOutcome(answer.status, answer.body, "").text || `Refused (HTTP ${answer.status}).`;
        break;
      }
    }
  } catch {
    refusal = "The request could not be sent. Check your connection.";
  }
  if (refusal === null) {
    return { admitted, queued, refusal, tone: "neutral", text: `Plan approved: ${admitted} ${admitted === 1 ? "claim" : "claims"} admitted, ${queued} ${queued === 1 ? "part" : "parts"} queued, not run. Run now below, or the scheduled worker picks them up.` };
  }
  return { admitted, queued, refusal, tone: "warning", text: `${admitted} admitted and ${queued} of ${parts} queued; then refused: ${refusal}` };
}
