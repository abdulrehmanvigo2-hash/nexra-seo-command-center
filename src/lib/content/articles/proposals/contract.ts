/**
 * What the article proposal service needs from wherever proposals are kept
 * (Stage 5, milestone C6, Checkpoint 3).
 *
 * Storage-agnostic, like the approval contract: the service holds the rules,
 * the store holds rows, and the two database functions behind `propose` and
 * `withdraw` — with the D3 trigger — re-check every rule under locks. The
 * outcomes below are exactly what `nexra_article_publication_propose` and
 * `nexra_article_publication_withdraw` (20260925120000) answer. Nothing
 * here publishes anything.
 */

import type { ArticleProposalPreviewFormat, ArticleProposalReservation, ArticlePublicationProposal } from "@/types/content-article-proposal";

export type ProposeArticleInput = {
  readonly projectId: string;
  readonly articleId: string;
  readonly articleVersion: number;
  /** All below are the server's own, from its reads and its eligibility result — never the browser's. */
  readonly articleVersionId: string;
  readonly contentSha256: string;
  readonly approvalId: string;
  readonly destination: string;
  readonly slug: string;
  readonly previewFormat: ArticleProposalPreviewFormat;
  /** The server's SHA-256 of the preview document it built. */
  readonly previewSha256: string;
  /** The operator's Supabase Auth user id, confirmed by the caller. */
  readonly requestedBy: string;
};

/** The database's refusals, in the order its function checks them. */
export const PROPOSE_REFUSALS = [
  "not-found",
  "archived",
  "destination-unavailable",
  "not-approved",
  "stale",
  "version-not-found",
  "version-mismatch",
  "content-mismatch",
  "approval-mismatch",
  "slug-mismatch",
  "unresolved-placeholder",
  "invalid-preview",
  "slug-live-collision",
  "slug-taken",
] as const;

export type ProposeRefusal = (typeof PROPOSE_REFUSALS)[number];

export type ProposeArticleOutcome =
  /** Written: the proposal row. */
  | { readonly status: "created"; readonly proposal: ArticlePublicationProposal }
  /** An active proposal with this exact binding already exists; nothing was written. */
  | { readonly status: "exists"; readonly proposal: ArticlePublicationProposal }
  /** An active proposal of this article with another binding exists; nothing was written. */
  | { readonly status: "active-exists"; readonly proposal: ArticlePublicationProposal }
  | { readonly status: ProposeRefusal };

export type WithdrawArticleInput = {
  readonly projectId: string;
  readonly proposalId: string;
  /** The operator's Supabase Auth user id, confirmed by the caller. */
  readonly withdrawnBy: string;
};

export type WithdrawArticleOutcome =
  | { readonly status: "withdrawn" | "already-withdrawn"; readonly proposal: ArticlePublicationProposal }
  | { readonly status: "not-found" };

export type ArticleProposalStore = {
  /** Whether this store keeps proposals. The fixture data source does not. */
  readonly storesProposals: boolean;
  /** Every proposal of one article of one project, newest first. */
  listProposals(projectId: string, articleId: string): Promise<readonly ArticlePublicationProposal[]>;
  /** One proposal by project and id together, or null. */
  getProposal(projectId: string, proposalId: string): Promise<ArticlePublicationProposal | null>;
  /** Every active proposal, in either proposal table, holding exactly this destination and slug (D3). */
  listSlugHolders(destination: string, slug: string): Promise<readonly ArticleProposalReservation[]>;
  /** One proposal, in one database transaction under the article's lock and the D3 slug lock. */
  propose(input: ProposeArticleInput): Promise<ProposeArticleOutcome>;
  /** One withdrawal, under the article's lock; never a delete. */
  withdraw(input: WithdrawArticleInput): Promise<WithdrawArticleOutcome>;
};

/** The store used when articles are not persisted anywhere. It refuses rather than pretends. */
export const unavailableArticleProposalStore: ArticleProposalStore = {
  storesProposals: false,
  async listProposals() {
    return [];
  },
  async getProposal() {
    return null;
  },
  async listSlugHolders() {
    return [];
  },
  async propose() {
    return { status: "not-found" };
  },
  async withdraw() {
    return { status: "not-found" };
  },
};
