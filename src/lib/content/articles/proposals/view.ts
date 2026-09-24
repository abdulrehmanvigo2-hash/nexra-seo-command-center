/**
 * What the article proposal section shows (Stage 5, milestone C6,
 * Checkpoint 4): the section's states, whether a Record or Withdraw control
 * may be offered, and the operator's words for every answer the read API
 * and the Server Actions give.
 *
 * Kept apart from the component so each rule can be tested on its own. It
 * decides nothing about eligibility — the server's state does — and it
 * never turns a failed or unavailable read into an empty history or an
 * eligible state: those are their own states.
 *
 * A proposal is not a publication, and nothing here says otherwise. Pure.
 */

import type { ProposeRefusal } from "@/lib/content/articles/proposals/contract";
import type { RecordArticleProposalActionResult, WithdrawArticleProposalActionResult } from "@/lib/content/articles/proposals/requests";
import type { ArticleProposalStateView } from "@/lib/content/articles/proposals/service";
import type { ArticlePublicationProposal } from "@/types/content-article-proposal";

export const PROPOSAL_SECTION_TITLE = "Article publication proposal";

export const PROPOSAL_ONLY_BANNER = "PROPOSAL ONLY — NOT PUBLISHED";

export const PROPOSAL_EXPLANATION = "Recording a proposal does not publish the article, write to any website or repository, or create a GitHub pull request.";

/** The section's read state. Unauthorized, unavailable and failed are never shown as empty or eligible. */
export type ProposalLoad =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly state: ArticleProposalStateView }
  | { readonly status: "unauthorized" }
  | { readonly status: "unavailable" }
  | { readonly status: "not-found" }
  | { readonly status: "failed" };

/** The read API's answer as a load state: only a 200 with a state body is ready. */
export function proposalLoadFromResponse(status: number, body: unknown): ProposalLoad {
  if (status === 401) return { status: "unauthorized" };
  if (status === 503) return { status: "unavailable" };
  if (status === 404) return { status: "not-found" };
  if (status !== 200 || typeof body !== "object" || body === null) return { status: "failed" };
  const state = (body as { proposal?: unknown }).proposal;
  if (typeof state !== "object" || state === null || !("eligibility" in state) || !("history" in state)) return { status: "failed" };
  return { status: "ready", state: state as ArticleProposalStateView };
}

export const LOAD_MESSAGE: Readonly<Record<Exclude<ProposalLoad["status"], "ready">, string>> = {
  loading: "Reading proposal state…",
  unauthorized: "Your session has ended. Reload the page to sign in again.",
  unavailable: "Article proposals are not persisted on this deployment, so no proposal state can be shown and nothing can be recorded.",
  "not-found": "This article could not be found in this project.",
  failed: "The proposal state could not be read. Nothing is shown as eligible or empty until it can be.",
};

/** The one headline state of a ready section. */
export type ProposalHeadline = "eligible" | "not-eligible" | "active" | "active-stale";

export function proposalHeadline(state: ArticleProposalStateView): ProposalHeadline {
  if (state.activeProposal !== null) return state.activeProposalCurrent === true ? "active" : "active-stale";
  return state.eligibility.status === "eligible" ? "eligible" : "not-eligible";
}

export const HEADLINE_LABEL: Readonly<Record<ProposalHeadline, string>> = {
  eligible: "Eligible for a proposal",
  "not-eligible": "Not eligible",
  active: "Proposal recorded — not published",
  "active-stale": "Proposal stale — not published",
};

/** Record is offered only for an eligible state with a server-built preview and no active proposal. */
export function canRecord(load: ProposalLoad): boolean {
  return (
    load.status === "ready" &&
    load.state.eligibility.status === "eligible" &&
    load.state.preview !== null &&
    load.state.activeProposal === null &&
    load.state.destination !== null
  );
}

/** Withdraw is offered only for the article's active proposal. */
export function canWithdraw(load: ProposalLoad): boolean {
  return load.status === "ready" && load.state.activeProposal !== null && load.state.activeProposal.status === "proposed";
}

/** A proposal's standing, for the history list. */
export function proposalStanding(proposal: ArticlePublicationProposal, state: ArticleProposalStateView): string {
  if (proposal.status === "withdrawn") return "Withdrawn";
  if (state.activeProposal?.id === proposal.id && state.activeProposalCurrent === true) return "Active — names the current approved version";
  return "Active — stale: it no longer names the current approved version, row, hash or approval";
}

const REFUSED: Readonly<Record<ProposeRefusal | "active-exists", string>> = {
  "not-found": "The article was not found by the database.",
  archived: "The article was archived before the proposal could be recorded.",
  "destination-unavailable": "The destination is not registered for this project.",
  "not-approved": "The article is no longer approved (a newer version may have been saved).",
  stale: "The approved version is no longer the current version.",
  "version-not-found": "The version could not be found by the database.",
  "version-mismatch": "The version row changed.",
  "content-mismatch": "The stored text does not match its hash.",
  "approval-mismatch": "The approval no longer matches this exact version.",
  "slug-mismatch": "The slug is not the approved content's own slug.",
  "unresolved-placeholder": "The text still carries a [NEEDS EVIDENCE: …] placeholder.",
  "invalid-preview": "The preview was not accepted.",
  "slug-live-collision": "A live article at this destination already uses this slug.",
  "slug-taken": "Another active publication proposal — an article's or a draft's — already uses this destination and slug.",
  "active-exists": "Another active proposal of this article, with a different binding, already exists.",
};

export type ProposalNote = { readonly tone: "positive" | "critical"; readonly text: string };

const ACTION_FAILURE = {
  unauthorized: "Your session has ended. Reload the page to sign in again.",
  unconfirmed: "The action was not confirmed, so nothing was sent.",
  "rate-limited": "Too many requests. Wait a moment and try again.",
  invalid: "This request cannot be sent: its identifiers are not what the server expects.",
  unavailable: "Article proposals are not persisted on this deployment. Nothing was written.",
  "not-found": "The article or proposal could not be found in this project.",
  failed: "The request could not be completed. Nothing is known to have been written.",
} as const;

/** The operator's words for a Record answer. Only the database's created is "recorded". */
export function recordNote(result: RecordArticleProposalActionResult): ProposalNote {
  if (result.ok) {
    return result.recorded
      ? { tone: "positive", text: `Proposal recorded for version ${result.proposal.articleVersion}. Nothing was published.` }
      : { tone: "positive", text: `This exact proposal was already recorded for version ${result.proposal.articleVersion}; nothing new was written. Nothing was published.` };
  }
  switch (result.reason) {
    case "stale":
      return { tone: "critical", text: "The article has a newer version than the one shown. Nothing was recorded; review the current version." };
    case "ineligible":
      return { tone: "critical", text: "The server found this version is not eligible. Nothing was recorded." };
    case "refused":
      return { tone: "critical", text: `The database refused the proposal: ${REFUSED[result.outcome]} Nothing was written.` };
    default:
      return { tone: "critical", text: ACTION_FAILURE[result.reason] };
  }
}

/** The operator's words for a Withdraw answer. Only the database's withdrawn is "withdrawn". */
export function withdrawNote(result: WithdrawArticleProposalActionResult): ProposalNote {
  if (result.ok) {
    return result.withdrawn
      ? { tone: "positive", text: "Proposal withdrawn. It stays in the history; nothing was published or removed from any website." }
      : { tone: "positive", text: "This proposal was already withdrawn; nothing new was written." };
  }
  return { tone: "critical", text: ACTION_FAILURE[result.reason] };
}

/** The first 12 hex characters, for a compact label beside the full value. */
export function shortHash(value: string): string {
  return `${value.slice(0, 12)}…`;
}
