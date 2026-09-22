/**
 * Shapes for publication proposals: an operator's recorded intention to
 * publish one exact, approved, immutable draft version to one registered
 * destination.
 *
 * A proposal is not a publication. It creates no file, branch, commit, pull
 * request or deployment, and contacts nothing outside this product. The
 * only states are `proposed` and `withdrawn`.
 */

export type PublicationProposalStatus = "proposed" | "withdrawn";

/** The one preview format this milestone renders. */
export type PublicationPreviewFormat = "draft-section-text/1";

export type PublicationProposal = {
  readonly id: string;
  readonly projectId: string;
  readonly draftId: string;
  /** The exact version, by number. */
  readonly version: number;
  /** The exact version, by its immutable row id. */
  readonly versionId: string;
  /** SHA-256 of the bound version's title and body, recomputed by the database. */
  readonly contentSha256: string;
  /** The approval as it stood when the proposal was made. */
  readonly approvedBy: string;
  readonly approvedAt: string;
  /** A key of the destination registry. */
  readonly destination: string;
  /** The target identifier; the destination's content path is unresolved in this milestone. */
  readonly slug: string;
  readonly previewFormat: PublicationPreviewFormat;
  /** SHA-256 of the preview document the operator was shown. */
  readonly previewSha256: string;
  readonly status: PublicationProposalStatus;
  readonly requestedBy: string;
  readonly withdrawnBy: string | null;
  readonly withdrawnAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

/**
 * Where a proposal would go. Descriptive only: nothing here is a credential,
 * and nothing in this milestone contacts the destination.
 */
export type PublicationDestination = {
  readonly key: string;
  readonly label: string;
  /** The projects whose drafts may be proposed to it. */
  readonly projectIds: readonly string[];
  /** The public host of the site. */
  readonly host: string;
  /** Where the site's source is kept, as a name for a person to read. Never contacted here. */
  readonly sourceRepository: string;
  /** The directory content would be written to. Null: not yet determined. */
  readonly contentPath: string | null;
  /** The site's content format. Null: not yet inspected. */
  readonly contentFormat: string | null;
};

/** The deterministic preview of one proposal, rebuilt from the bound version row. */
export type PublicationPreview = {
  readonly format: PublicationPreviewFormat;
  /** The whole preview document, exactly as hashed. */
  readonly document: string;
  /** The bound version's title and body, exactly as stored. */
  readonly title: string;
  readonly body: string;
};
