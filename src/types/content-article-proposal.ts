/**
 * Shapes for the article publication proposal (Stage 5, milestone C6,
 * Checkpoint 2): whether one exact approved article version may be proposed
 * to one registered destination, and the read-only preview document an
 * operator would be shown.
 *
 * A proposal is not a publication. Nothing here writes a record, renders a
 * website file, or reaches a repository or a site. The database function
 * `nexra_article_publication_propose` (20260925120000) and the D3 trigger
 * (20260926120000) decide, under locks, whether a proposal is recorded;
 * everything here is feedback that may be stale by then.
 */

import type { ValidatedArticleContent, WebsiteCompletenessReport } from "@/types/content-article";

/** The one preview format the C6 table accepts (`preview_format`). */
export type ArticleProposalPreviewFormat = "article-proposal-text/1";

/**
 * The exact binding a proposal records: the arguments the database function
 * takes, except the preview and the requesting operator.
 */
export type ArticleProposalBinding = {
  readonly projectId: string;
  readonly articleId: string;
  readonly articleVersion: number;
  /** The version's immutable row id. */
  readonly articleVersionId: string;
  /** The version's stored canonical-content SHA-256. */
  readonly contentSha256: string;
  /** The exact C5 approval-history row. */
  readonly approvalId: string;
  /** As recorded on that approval row. */
  readonly approvedBy: string;
  readonly approvedAt: string;
  /** A destination registry key. */
  readonly destination: string;
  /** The approved content's own slug (D1). */
  readonly slug: string;
};

/** An active proposal that holds a destination and slug, from either proposal table (D3). */
export type ArticleProposalReservation =
  | { readonly kind: "article"; readonly proposalId: string; readonly articleId: string; readonly destination: string; readonly slug: string }
  | { readonly kind: "draft"; readonly proposalId: string; readonly draftId: string; readonly destination: string; readonly slug: string };

/** An active article proposal of the article in question, whatever its slug. */
export type ActiveArticleProposal = {
  readonly proposalId: string;
  readonly articleVersion: number;
  readonly destination: string;
  readonly slug: string;
};

/**
 * The proposal state the server read: the article's own active proposal, and
 * every active proposal in either table holding the requested destination
 * and slug. `null` in the facts means it was not read, which blocks.
 */
export type ArticleProposalState = {
  readonly activeForArticle: ActiveArticleProposal | null;
  readonly holders: readonly ArticleProposalReservation[];
};

/**
 * Why a version cannot be proposed. Every applicable reason is reported, in
 * this declaration's order; there is no override.
 */
export type ArticleProposalBlock =
  /** The request itself is malformed: project, article, version, destination or slug. */
  | "invalid-request"
  /** No article with this id in this project. */
  | "not-found"
  | "archived"
  /** The article is not in the approved state. */
  | "not-approved"
  /** The version asked for is not the article's current version. */
  | "not-current"
  /** The article's approval pointer names another version. */
  | "approval-not-current"
  /** No stored version row for this article and version number. */
  | "version-not-found"
  /** The version row read does not belong to this article and version number. */
  | "version-mismatch"
  /** The stored text is not exactly canonical `nexra-article-content/1` content. */
  | "content-unreadable"
  /** The stored text does not hash to the stored content hash. */
  | "content-hash-mismatch"
  /** No C5 approval-history row for this version. */
  | "approval-missing"
  /** The approval row names another article, version, version row or content hash. */
  | "approval-mismatch"
  /** The article's approval pointer (version, operator, time) differs from the approval row. */
  | "approval-pointer-mismatch"
  /** The requested slug is not a valid slug. */
  | "slug-invalid"
  /** The requested slug is not the approved content's own slug (D1). */
  | "slug-mismatch"
  /** The text still carries a `[NEEDS EVIDENCE` placeholder. */
  | "unresolved-placeholder"
  /** The destination is not registered for this project. */
  | "destination-unavailable"
  /** The proposal state was not read, so it cannot be vouched for. */
  | "proposal-state-unavailable"
  /** An active proposal of this article already exists. */
  | "proposal-exists"
  /** Another article's active proposal holds this destination and slug. */
  | "slug-taken-by-article"
  /** A draft's active proposal holds this destination and slug (D3). */
  | "slug-taken-by-draft"
  /** The slug names a live article at the destination, and the topic decision is not update-existing (D2). */
  | "slug-live-collision";

/** Something the operator must see that does not block. */
export type ArticleProposalWarning =
  /** D2: the slug names a live article and the topic decision is update-existing. A proposal is not permission to overwrite it. */
  "live-slug-update-existing";

export type ArticleProposalEligibility =
  | {
      readonly status: "eligible";
      readonly binding: ArticleProposalBinding;
      readonly content: ValidatedArticleContent;
      /** Informational only: `readingTime` and `published` are never content, so they never block. */
      readonly completeness: WebsiteCompletenessReport;
      /** The pinned template's route for the slug, or null when the destination has no pinned template. Not written anywhere. */
      readonly route: string | null;
      readonly warnings: readonly ArticleProposalWarning[];
    }
  | {
      readonly status: "blocked";
      readonly blocks: readonly ArticleProposalBlock[];
      readonly warnings: readonly ArticleProposalWarning[];
      /** The article's own active proposal, when that is one of the reasons. */
      readonly activeProposal: ActiveArticleProposal | null;
    };

/** The read-only preview document and its format. */
export type ArticleProposalPreview = {
  readonly format: ArticleProposalPreviewFormat;
  /** The exact UTF-8 text whose SHA-256 a proposal records as `preview_sha256`. LF line endings, no trailing newline. */
  readonly document: string;
};

/** One stored article publication proposal (`nexra_article_publication_proposals`), as read back. Immutable history. */
export type ArticlePublicationProposal = {
  readonly id: string;
  readonly projectId: string;
  readonly articleId: string;
  readonly articleVersion: number;
  readonly articleVersionId: string;
  readonly contentSha256: string;
  readonly approvalId: string;
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly destination: string;
  readonly slug: string;
  readonly previewFormat: ArticleProposalPreviewFormat;
  readonly previewSha256: string;
  readonly status: "proposed" | "withdrawn";
  readonly requestedBy: string;
  readonly withdrawnBy: string | null;
  readonly withdrawnAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};
