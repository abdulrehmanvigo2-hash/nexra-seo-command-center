/**
 * The preview of a publication proposal: one plain-text document, built
 * deterministically from the bound version row and the proposal's binding.
 *
 * The title and body are the version's own, character for character, with
 * nothing added, trimmed or reformatted. Around them the document says what
 * it is — a draft section, not a complete publishable article — and names
 * the destination, the unresolved content path, the slug, the exact version
 * and the content hash. The same inputs always give the same document, so
 * its hash, stored on the proposal, lets a later milestone confirm that
 * what it would write is what the operator was shown.
 *
 * Pure, with no server-only import: the hash is taken on the server, in
 * `./content-hash`.
 */

import type { PublicationDestination, PublicationPreview, PublicationPreviewFormat } from "@/types/content-publication";

export const PREVIEW_FORMAT: PublicationPreviewFormat = "draft-section-text/1";

export const DRAFT_SECTION_LABEL = "DRAFT SECTION — NOT A COMPLETE PUBLISHABLE ARTICLE";

export const NO_PUBLICATION_STATEMENT = "This proposal does not publish content or create a GitHub pull request.";

export type PreviewInput = {
  readonly destination: PublicationDestination;
  readonly slug: string;
  readonly projectId: string;
  readonly draftId: string;
  readonly version: number;
  readonly versionId: string;
  readonly contentSha256: string;
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly title: string;
  readonly body: string;
};

export function buildPublicationPreview(input: PreviewInput): PublicationPreview {
  const lines = [
    `PUBLICATION PROPOSAL PREVIEW (${PREVIEW_FORMAT})`,
    DRAFT_SECTION_LABEL,
    NO_PUBLICATION_STATEMENT,
    `Destination: ${input.destination.key} (${input.destination.label}, ${input.destination.host})`,
    `Content path: ${input.destination.contentPath ?? "unresolved"}`,
    `Slug: ${input.slug}`,
    `Project: ${input.projectId}`,
    `Draft: ${input.draftId}`,
    `Version: ${input.version} (row ${input.versionId})`,
    `Content SHA-256: ${input.contentSha256}`,
    `Approved: ${input.approvedAt} by ${input.approvedBy}`,
    "",
    "TITLE",
    input.title,
    "",
    "BODY",
    input.body,
  ];
  return { format: PREVIEW_FORMAT, document: lines.join("\n"), title: input.title, body: input.body };
}
