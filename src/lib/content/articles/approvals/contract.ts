/**
 * What the article approval service needs from wherever approvals are
 * kept (Stage 5, milestone C5).
 *
 * Storage-agnostic, like the article and check contracts: the service holds
 * the rules, the store holds rows, and the one database function behind
 * `approve` re-checks every rule in one transaction under the parent
 * article's lock. Nothing here publishes or proposes anything.
 */

import type { ApprovalUnitIdentity } from "@/lib/content/articles/approvals/units-digest";
import type { ArticleApproval } from "@/types/content-article-approval";
import type { Article } from "@/types/content-article-record";

export type ApproveVersionInput = {
  readonly projectId: string;
  readonly articleId: string;
  readonly articleVersion: number;
  /** The version's immutable row id, as the server read it. */
  readonly articleVersionId: string;
  /** The version's canonical-content SHA-256, as the server computed it from the stored text. */
  readonly contentSha256: string;
  /** The units the server regenerated from the stored text, in index order. */
  readonly units: readonly ApprovalUnitIdentity[];
  /** The digest of those units, computed by the server. */
  readonly unitsSha256: string;
  /** The operator's Supabase Auth user id, confirmed by the caller. */
  readonly approvedBy: string;
};

export type ApproveVersionOutcome =
  /** Written: the approval row and the article's pointer, together. */
  | { readonly status: "approved"; readonly approval: ArticleApproval; readonly article: Article }
  /** This version was already approved; nothing was written. */
  | { readonly status: "exists"; readonly approval: ArticleApproval; readonly article: Article }
  | {
      readonly status:
        | "not-found"
        | "archived"
        | "stale"
        | "version-not-found"
        | "version-mismatch"
        | "content-mismatch"
        | "status-unexpected"
        | "units-mismatch"
        | "units-not-passed"
        | "units-incomplete"
        | "topic-decision"
        | "unresolved-placeholder";
    };

export type ArticleApprovalStore = {
  /** Whether this store keeps approvals. The fixture data source does not. */
  readonly storesApprovals: boolean;
  /** Every approval of one article, newest first. */
  listApprovals(articleId: string): Promise<readonly ArticleApproval[]>;
  /** One approval, in one database transaction under the parent's lock. */
  approve(input: ApproveVersionInput): Promise<ApproveVersionOutcome>;
};

/** The store used when articles are not persisted anywhere. It refuses rather than pretends. */
export const unavailableArticleApprovalStore: ArticleApprovalStore = {
  storesApprovals: false,
  async listApprovals() {
    return [];
  },
  async approve() {
    return { status: "not-found" };
  },
};
