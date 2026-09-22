/**
 * What the publication proposal service needs from wherever proposals are
 * kept. Storage-agnostic, like the draft contract: the service holds the
 * rules, the store holds rows, and the database function behind `create`
 * re-checks every rule under a lock on the draft.
 *
 * Nothing here publishes, and no method reaches anything outside the store.
 */

import type { PublicationPreviewFormat, PublicationProposal } from "@/types/content-publication";

export type CreateProposalInput = {
  readonly projectId: string;
  readonly draftId: string;
  readonly version: number;
  readonly versionId: string;
  readonly contentSha256: string;
  /** The approval the service read; the database refuses the proposal if the draft's differs. */
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly destination: string;
  readonly slug: string;
  readonly previewFormat: PublicationPreviewFormat;
  readonly previewSha256: string;
  readonly requestedBy: string;
};

export type CreateProposalOutcome =
  | { readonly status: "created"; readonly proposal: PublicationProposal }
  /** A proposal for this draft is already active. Nothing was written. */
  | { readonly status: "exists"; readonly proposal: PublicationProposal }
  /** No such draft in this project. */
  | { readonly status: "not-found" }
  | { readonly status: "version-not-found" }
  /** The draft is no longer approved at this exact version and approval, or the version row differs. Nothing was written. */
  | { readonly status: "stale"; readonly currentVersion: number }
  /** The database's own check of the version refused it. Nothing was written. */
  | { readonly status: "ineligible"; readonly reason: "fact-check-not-passed" | "unresolved-placeholders" }
  /** The stored text does not hash to the value the service computed. Nothing was written. */
  | { readonly status: "content-mismatch" }
  /** Another draft's active proposal holds this slug at this destination. Nothing was written. */
  | { readonly status: "slug-taken" };

export type WithdrawProposalOutcome =
  | { readonly status: "withdrawn"; readonly proposal: PublicationProposal }
  /** The statement matched no active proposal. Nothing was written. */
  | { readonly status: "unchanged" };

export type PublicationProposalStore = {
  /** Whether this store keeps proposals. The fixture data source does not. */
  readonly storesProposals: boolean;
  /** The draft's active proposal, or null. */
  findActiveForDraft(projectId: string, draftId: string): Promise<PublicationProposal | null>;
  /** The draft's proposals, newest first, at most `limit`. */
  listForDraft(projectId: string, draftId: string, limit: number): Promise<readonly PublicationProposal[]>;
  /** One proposal by project, draft and id, or null. */
  getById(projectId: string, draftId: string, proposalId: string): Promise<PublicationProposal | null>;
  /** Creates a proposal through the one database function that re-checks everything under the draft's lock. */
  create(input: CreateProposalInput): Promise<CreateProposalOutcome>;
  /**
   * Withdraws an active proposal in one statement conditional on its still
   * being active. The patch carries the status and the withdrawer only; the
   * database sets the time. No draft, version, fact-check or approval
   * column is touched.
   */
  withdraw(input: {
    readonly projectId: string;
    readonly draftId: string;
    readonly proposalId: string;
    readonly withdrawnBy: string;
  }): Promise<WithdrawProposalOutcome>;
};

/** The store used when proposals are not persisted anywhere. It refuses rather than pretends. */
export const unavailableProposalStore: PublicationProposalStore = {
  storesProposals: false,
  async findActiveForDraft() {
    return null;
  },
  async listForDraft() {
    return [];
  },
  async getById() {
    return null;
  },
  async create() {
    return { status: "not-found" };
  },
  async withdraw() {
    return { status: "unchanged" };
  },
};
