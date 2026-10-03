import type { Confirmation } from "@/lib/agent-runs/spend-confirm";
import type { EvidenceSource, EvidenceUnit } from "@/lib/evidence/contract";
import { isAdmissible } from "@/lib/evidence/contract";
import type { ProviderMode } from "@/lib/providers/dataforseo/constants";
import { SERP_PRICE_PER_CALL_USD } from "@/lib/providers/dataforseo/constants";
import type { AcceptedOpportunity, OpportunitiesView } from "@/lib/opportunities/contract";
import type { SerpRunView, SerpView } from "@/lib/serp/contract";
import type { AgentRun } from "@/types/agent-run";

/**
 * The Evidence tab's words and states (M4, PR 7; docs/roadmap/M4-research-evidence.md §4). Pure and client-safe: what
 * each read becomes on screen, the confirmations each paid or recorded act opens first, and each answer in words.
 * Nothing here decides admissibility — the database does; `isAdmissible` only repeats its rule to offer the control.
 */

export const EVIDENCE_NOTE =
  "Outside pages are fetched for an accepted opportunity and kept internally; nothing here is published. A claim can support an article only after you admit it, and only when the database found its quote, word for word, in the stored page.";
export const NOT_SET_UP_TITLE = "Not set up yet";
export const NOT_SET_UP_COPY = "Research and evidence need the M4 schema in this deployment's database. Nothing is broken: the other tabs read as before.";
export const NO_OPPORTUNITY_TITLE = "No accepted opportunity";
export const NO_OPPORTUNITY_COPY = "Accept an opportunity on the Keywords screen first; evidence is gathered for one accepted opportunity at a time.";
export const SERP_LABEL = "Fetch Google results…";
export const SNIPPET_NOTE = "Titles and snippets are what Google listed — the provider's text, never evidence. Only a fetched page's quote can be admitted.";

export type ReadState<T> = { readonly status: "loading" } | { readonly status: "not-set-up" } | { readonly status: "failed" } | { readonly status: "ready"; readonly value: T };

export function readState<T>(httpStatus: number, body: unknown, pick: (body: Record<string, unknown>) => T | null): ReadState<T> {
  if (httpStatus === 503) return { status: "not-set-up" };
  if (httpStatus < 200 || httpStatus >= 300 || typeof body !== "object" || body === null) return { status: "failed" };
  const value = pick(body as Record<string, unknown>);
  return value === null ? { status: "failed" } : { status: "ready", value };
}

/** The accepted opportunities of the approved map, newest first; none when no map is approved. */
export function acceptedOpportunities(view: OpportunitiesView): readonly AcceptedOpportunity[] {
  return view.state === "scored" ? view.accepted : [];
}

export function opportunityLabel(opportunity: AcceptedOpportunity): string {
  return `${opportunity.title} · score ${opportunity.score} · accepted ${opportunity.acceptedAt.slice(0, 10)}`;
}

/** The newest completed SERP run, whose results the tab lists. */
export function latestCompletedSerp(view: SerpView): SerpRunView | null {
  return view.runs.find((entry) => entry.run.status === "completed") ?? null;
}

export function serpEstimateUsd(mode: ProviderMode): number {
  return mode === "live" ? SERP_PRICE_PER_CALL_USD : 0;
}

export function serpConfirmation(projectId: string, opportunity: AcceptedOpportunity, mode: ProviderMode): Confirmation {
  return {
    title: "Fetch Google results?",
    facts: [
      { label: "Opportunity", value: opportunity.title },
      { label: "Project", value: projectId },
      { label: "Call", value: "DataForSEO Google organic, live, advanced — top 10, United States / English; the keyword is the opportunity's" },
      { label: "Mode", value: mode === "live" ? `Live — about $${SERP_PRICE_PER_CALL_USD.toFixed(4)}` : "Sandbox — dummy data, no charge" },
    ],
    consequence:
      "This makes one paid DataForSEO call now (free in the sandbox) against today's shared provider cap, and records the call and every result. It calls no model and fetches no page. It cannot be undone.",
    confirmLabel: "Fetch results",
    dismissLabel: "Go back",
    usage: null,
    tone: "primary",
  };
}

export function sourceConfirmation(projectId: string, url: string): Confirmation {
  return {
    title: "Fetch this page?",
    facts: [
      { label: "Page", value: url },
      { label: "Project", value: projectId },
    ],
    consequence:
      "This reads the site's robots.txt and, if it allows, fetches the page once with this product's crawler and keeps its visible text (at most 20,000 characters) internally. No model is called and nothing is charged. At most five pages a day per opportunity.",
    confirmLabel: "Fetch page",
    dismissLabel: "Go back",
    usage: null,
    tone: "primary",
  };
}

export function decideConfirmation(unit: EvidenceUnit, decision: "admitted" | "rejected"): Confirmation {
  return {
    title: decision === "admitted" ? "Admit this claim?" : "Reject this claim?",
    facts: [
      { label: "Claim", value: unit.claim },
      { label: "Quote", value: unit.quote },
    ],
    consequence:
      decision === "admitted"
        ? "An admitted claim may support an article statement when the checker cites it. The decision is recorded once and cannot be changed."
        : "A rejected claim is never shown to the checker. The decision is recorded once and cannot be changed.",
    confirmLabel: decision === "admitted" ? "Admit" : "Reject",
    dismissLabel: "Go back",
    usage: null,
    tone: decision === "admitted" ? "primary" : "danger",
  };
}

export function sourceStateTone(source: EvidenceSource): "positive" | "warning" | "neutral" {
  if (source.fetchState === "fetched") return "positive";
  if (source.fetchState === "robots-disallowed" || source.fetchState === "robots-unreachable") return "neutral";
  return "warning";
}

export function unitBadge(unit: EvidenceUnit): { readonly label: string; readonly tone: "positive" | "warning" | "critical" | "neutral" } {
  if (unit.decision === "admitted") return { label: "Admitted", tone: "positive" };
  if (unit.decision === "rejected") return { label: "Rejected", tone: "neutral" };
  if (!unit.quoteFound) return { label: "Quote not found in the page — needs review", tone: "critical" };
  if (unit.status === "supported") return { label: "Supported — awaiting your decision", tone: "warning" };
  if (unit.status === "unsupported") return { label: "Unsupported", tone: "neutral" };
  return { label: "Needs review", tone: "warning" };
}

export { isAdmissible };

/** The extraction runs of one source, newest first, from Research & Evidence's run list. */
export function extractionRuns(runs: readonly AgentRun[], sourceId: string): readonly AgentRun[] {
  return runs.filter((run) => run.taskType === "evidence-extract" && run.input.sourceId === sourceId);
}

/** Whether a run's units may be recorded: completed by the model, and none recorded from it yet. */
export function recordOffered(run: AgentRun, units: readonly EvidenceUnit[]): boolean {
  return run.status === "completed" && run.executor === "ai" && !units.some((unit) => unit.runId === run.id);
}

export function writeOutcome(httpStatus: number, body: unknown, done: string): { readonly text: string; readonly tone: "neutral" | "warning" } {
  if (httpStatus >= 200 && httpStatus < 300) return { text: done, tone: "neutral" };
  const error = (body as { error?: unknown } | null)?.error;
  switch (error) {
    case "not-set-up":
      return { text: "Not set up yet on this deployment.", tone: "warning" };
    case "not-configured":
      return { text: "DataForSEO is not configured on this deployment.", tone: "warning" };
    case "cap-reached":
      return { text: "Today's provider cap is reached; it resets at midnight UTC.", tone: "warning" };
    case "cap-invalid":
      return { text: "The daily provider cap variable is not usable; every call is refused until it is corrected.", tone: "warning" };
    case "run-active":
      return { text: "Another provider run is open on this project; try again when it finishes.", tone: "warning" };
    case "source-limit":
      return { text: "Five pages were already fetched for this opportunity today.", tone: "warning" };
    case "answer-malformed":
      return { text: "The run's answer is not in the unit format, so nothing was recorded. Queue another extraction.", tone: "warning" };
    case "no-units":
      return { text: "The run found no claim on the topic in this page; nothing was recorded.", tone: "neutral" };
    case "exists":
      return { text: "These units were already recorded.", tone: "neutral" };
    case "not-admissible":
      return { text: "Only a supported claim whose quote was found in the page can be admitted.", tone: "warning" };
    case "already-decided":
      return { text: "This claim was already decided.", tone: "neutral" };
    case "daily-cap":
      return { text: "Today's run limit is reached; the run is not queued. It resets at midnight UTC.", tone: "warning" };
    default:
      return { text: httpStatus === 0 ? "The request could not be sent. Check your connection." : "The request was refused; nothing was recorded.", tone: "warning" };
  }
}
