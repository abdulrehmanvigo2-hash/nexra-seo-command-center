import type { Confirmation } from "@/lib/agent-runs/spend-confirm";
import { opportunityKey, type AcceptedOpportunity, type OpportunitiesView } from "@/lib/opportunities/contract";
import type { Opportunity, OpportunityAction, OpportunityOwner, OpportunityPriority, SignalSource } from "@/lib/opportunities/score";

/**
 * The *Content opportunities* section (M2, PR 6): what the screen says, in words, for every answer the route gives.
 * Pure and client-safe. Every line of a score carries its label — a provider's estimate, an observed Search Console
 * figure, or a derivation of fixed rules — and an unknown value reads "unknown, not counted", never zero.
 */

export const SECTION_TITLE = "Content opportunities";
export const SECTION_EYEBROW = "Scored by fixed rules";
export const SECTION_NOTE =
  "What to do next with the approved topical map: write, expand, refresh or fix, ranked by a score whose every point is shown. Accepting one records it as a backlog task; nothing runs or publishes.";
export const NOT_SET_UP_TITLE = "Not set up yet";
export const NOT_SET_UP_COPY =
  "Content opportunities need their table in this deployment's database (migration 20261021120000). Nothing here is broken: the rest of the screen reads its records as before.";
export const NO_MAP_TITLE = "Approve a topic map first";
export const NO_MAP_COPY = "Opportunities are scored from the approved topical map only. Build and approve one on the Topical map tab.";
export const NONE_TITLE = "No opportunity to list";
export const NONE_COPY = "Every cluster of the approved map is covered and no Search Console rule or crawl finding calls for work on it.";
export const ACCEPT_LABEL = "Accept as task…";
export const CANDIDATE_NOTE = "candidate — not created";
export const CANNIBALISATION_FLAG = "Review before writing: this cluster's queries were observed on two or more pages.";
export const LEGEND = "Provider estimate — DataForSEO, United States / English · Observed — stored Search Console rows · Derived — fixed rules (version 1)";

export const ACTION_LABEL: Readonly<Record<OpportunityAction, string>> = { write: "Write", expand: "Expand", refresh: "Refresh", fix: "Fix" };
export const SOURCE_LABEL: Readonly<Record<SignalSource, string>> = { observed: "Observed", "provider-estimate": "Provider estimate", derived: "Derived" };
export const OWNER_LABEL: Readonly<Record<OpportunityOwner, string>> = { "content-strategist": "Content Strategist", "technical-seo": "Technical SEO" };

export function priorityBadge(priority: OpportunityPriority): { readonly label: string; readonly tone: "warning" | "accent" | "neutral" } {
  switch (priority) {
    case "high":
      return { label: "High", tone: "warning" };
    case "medium":
      return { label: "Medium", tone: "accent" };
    case "low":
      return { label: "Low", tone: "neutral" };
  }
}

export function sourceTone(source: SignalSource): "accent" | "positive" | "neutral" {
  return source === "observed" ? "positive" : source === "provider-estimate" ? "accent" : "neutral";
}

export type SectionState =
  | { readonly status: "loading" }
  | { readonly status: "not-set-up" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "ready"; readonly view: OpportunitiesView };

export const READ_FAILED: SectionState = { status: "failed", message: "The content opportunities could not be read. Nothing is shown in their place." };

export function sectionState(httpStatus: number, body: unknown): SectionState {
  if (httpStatus === 503) return { status: "not-set-up" };
  if (httpStatus === 401 || httpStatus === 403) return { status: "failed", message: "Sign in again as an operator to read the content opportunities." };
  if (httpStatus === 429) return { status: "failed", message: "Too many reads just now; try again in a few minutes." };
  const view = typeof body === "object" && body !== null ? (body as { view?: OpportunitiesView }).view : undefined;
  if (httpStatus < 200 || httpStatus >= 300 || !view || (view.state !== "scored" && view.state !== "no-approved-map")) return READ_FAILED;
  if (view.state === "scored" && (typeof view.result !== "object" || view.result === null || !Array.isArray(view.result.opportunities))) return READ_FAILED;
  return { status: "ready", view };
}

/** Where the work lands, in words. */
export function targetLine(opportunity: Opportunity): string {
  if (opportunity.target.kind === "candidate") return `/blog/${opportunity.target.page} · ${CANDIDATE_NOTE}`;
  if (opportunity.target.kind === "none") return "no candidate (its slug is already live)";
  return opportunity.target.page ?? "—";
}

/** What the list was scored from, in one line. */
export function readLine(view: Extract<OpportunitiesView, { state: "scored" }>): string {
  const { read } = view.result;
  const approved = view.map.approvedAt === null ? "" : `, approved ${view.map.approvedAt.slice(0, 10)}`;
  const window = read.gscEndDate === null ? "no Search Console window stored" : `the Search Console window ending ${read.gscEndDate} (${read.pairs} stored query × page rows; ${read.unmatchedQueries} queries match no cluster)`;
  const crawl = read.crawlId === null ? "no crawl findings recorded" : `${read.findings} findings of crawl ${read.crawlId.slice(0, 8)}`;
  return `Scored from topic map ${view.map.id.slice(0, 8)}${approved} (${view.map.clusters} clusters), ${window}, and ${crawl}.`;
}

export function acceptedFor(view: Extract<OpportunitiesView, { state: "scored" }>, opportunity: Opportunity): AcceptedOpportunity | undefined {
  const key = opportunityKey(opportunity);
  return view.accepted.find((row) => opportunityKey(row) === key);
}

export function monitoredLine(view: Extract<OpportunitiesView, { state: "scored" }>): string | null {
  const count = view.result.monitored.length;
  if (count === 0) return null;
  return `${count} covered cluster${count === 1 ? "" : "s"} monitored, not listed: ${view.result.monitored.map((m) => m.topic).join(", ")}.`;
}

export function acceptConfirmation(projectId: string, opportunity: Opportunity): Confirmation {
  return {
    title: "Accept this opportunity as a task?",
    facts: [
      { label: "Project", value: projectId },
      { label: "Task", value: opportunity.title },
      { label: "Score", value: `${opportunity.score} of 100 · ${priorityBadge(opportunity.priority).label} priority` },
      { label: "Owner", value: OWNER_LABEL[opportunity.owner] },
      { label: "Status", value: "Backlog" },
      { label: "Cost", value: "None: no provider call, no agent run" },
    ],
    consequence: "Records this opportunity exactly as scored, with every line, and creates one backlog task for its owner. It queues no run and publishes nothing; the task moves only when you move it.",
    confirmLabel: "Accept as task",
    dismissLabel: "Go back",
    usage: null,
    tone: "primary",
  };
}

/** A POST's answer in words. */
export function acceptOutcome(httpStatus: number, body: unknown): { readonly text: string; readonly tone: "neutral" | "warning" } {
  const error = typeof body === "object" && body !== null ? (body as { error?: unknown }).error : null;
  if (httpStatus === 201) return { text: "Accepted: the opportunity is recorded and its backlog task created.", tone: "neutral" };
  if (httpStatus === 200) return { text: "Already accepted: its task exists. Nothing new was recorded.", tone: "neutral" };
  if (httpStatus === 503) return { text: NOT_SET_UP_COPY, tone: "warning" };
  if (error === "no-approved-map" || error === "map-not-approved") return { text: "The approved map changed. The list has been read again; nothing was recorded.", tone: "warning" };
  if (error === "opportunity-not-found" || error === "cluster-not-found") return { text: "That opportunity is no longer scored the same way. The list has been read again; nothing was recorded.", tone: "warning" };
  if (error === "invalid") return { text: "The database refused the opportunity as out of shape. Nothing was recorded.", tone: "warning" };
  if (httpStatus === 429) return { text: "Too many requests just now; try again in a few minutes.", tone: "warning" };
  if (httpStatus === 401 || httpStatus === 403) return { text: "Sign in again as an operator.", tone: "warning" };
  return { text: "The request failed. Nothing is known to have been recorded.", tone: "warning" };
}
