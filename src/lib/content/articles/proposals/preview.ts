/**
 * The read-only preview of an article publication proposal: format
 * `article-proposal-text/1`, the only `preview_format` the C6 table accepts.
 *
 * One plain-text document, built deterministically from the proposal's
 * binding and the approved version's stored canonical text. It says what it
 * is — a proposal, not a publication — and names the destination, the
 * route it would take (not written anywhere), the exact version, row, hash
 * and C5 approval, the website completeness report, and then the approved
 * canonical content itself, character for character. Its SHA-256
 * (`./preview-hash`) is what a proposal records as `preview_sha256`, so a
 * later milestone can confirm that what it would write is what the operator
 * was shown. The preview hash never replaces the content hash: both are in
 * the binding, for different things.
 *
 * DETERMINISM. The same binding and text give byte-identical output:
 * - the lines below, in this fixed order, joined by LF (`\n`), with no
 *   trailing newline, no trailing spaces and no tabs;
 * - every value is taken verbatim from the binding or the stored text —
 *   the approval time exactly as stored, never re-formatted or re-zoned;
 * - the completeness report lists fields in the pinned contract's own order
 *   (`website/article-contract.ts`), and internal links in content order;
 * - the canonical text is the stored `nexra-article-content/1` text, which
 *   is one line (JSON escapes every line break) and is included whole;
 * - nothing else goes in: no clock, no random value, no path, no
 *   environment value, no object-iteration order.
 *
 * The input is re-validated here — ids, version, hash formats, timestamp
 * form, slug, the registered destination, the canonical text and that its
 * slug is the binding's (D1), and D2's live-slug rule. A preview is not
 * built for anything that would not be eligible. The content hash itself is
 * checked on the server (`./preview-hash`), since hashing is server-only.
 *
 * FORMAT 2 (Phase 6, checkpoint 6.8b). An article with operator-attested
 * paragraphs gets `article-proposal-text/2`: the same lines, then — before
 * the canonical content — an ATTESTED PARAGRAPHS section with each attested
 * paragraph prefixed by its label, as a reader would see it. An article with
 * none gets format 1, byte for byte as before (the verification proposal's
 * preview hash is pinned in the tests).
 *
 * Nothing is rendered as TSX, stored or sent. Pure.
 */

import { hasArticlePlaceholder } from "@/lib/content/articles/approvals/eligibility";
import { attestedParagraphs, labelledParagraph } from "@/lib/content/articles/attestations";
import { articleCanonicalFormat, readCanonicalArticle } from "@/lib/content/articles/canonical";
import { liveSlugsFor } from "@/lib/content/articles/proposals/eligibility";
import { websiteCompleteness } from "@/lib/content/articles/website-completeness";
import { isProjectId, isUuid } from "@/lib/content/drafts/service";
import { findDestination } from "@/lib/content/publications/destinations";
import { validateSlug } from "@/lib/content/publications/proposal-rules";
import { routeFor, templateForDestination } from "@/lib/content/publications/website/template";
import type { WebsiteCompletenessReport } from "@/types/content-article";
import type { ArticleProposalBinding, ArticleProposalPreview, ArticleProposalPreviewFormat } from "@/types/content-article-proposal";

export const ARTICLE_PROPOSAL_PREVIEW_FORMAT: ArticleProposalPreviewFormat = "article-proposal-text/1";
/** The preview format of an article with operator-attested paragraphs (6.8b). */
export const ARTICLE_PROPOSAL_PREVIEW_FORMAT_ATTESTED: ArticleProposalPreviewFormat = "article-proposal-text/2";

export const PROPOSAL_ONLY_LABEL = "PROPOSAL ONLY — NOT PUBLISHED";

export const NO_PUBLICATION_NOTICE =
  "Generating or recording this proposal does not publish the article, does not write to any website or repository, and does not create a GitHub pull request.";

export type ArticleProposalPreviewInput = {
  readonly binding: ArticleProposalBinding;
  /** The approved version's stored canonical text, exactly as stored. */
  readonly canonicalContent: string;
};

export type ArticleProposalPreviewRefusal =
  | "binding-invalid"
  | "destination-unavailable"
  | "content-unreadable"
  | "slug-mismatch"
  | "unresolved-placeholder"
  | "slug-live-collision";

export type ArticleProposalPreviewResult =
  | { readonly ok: true; readonly preview: ArticleProposalPreview }
  | { readonly ok: false; readonly reason: ArticleProposalPreviewRefusal };

const SHA256_HEX = /^[0-9a-f]{64}$/;
/** An ISO-8601 instant with an explicit zone, as PostgreSQL returns `timestamptz`; kept verbatim. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

function bindingValid(binding: ArticleProposalBinding): boolean {
  return (
    isProjectId(binding.projectId) &&
    isUuid(binding.articleId) &&
    typeof binding.articleVersion === "number" &&
    Number.isInteger(binding.articleVersion) &&
    binding.articleVersion >= 1 &&
    binding.articleVersion <= 32_767 &&
    isUuid(binding.articleVersionId) &&
    SHA256_HEX.test(binding.contentSha256) &&
    isUuid(binding.approvalId) &&
    isUuid(binding.approvedBy) &&
    typeof binding.approvedAt === "string" &&
    INSTANT.test(binding.approvedAt) &&
    !Number.isNaN(Date.parse(binding.approvedAt)) &&
    typeof binding.destination === "string" &&
    validateSlug(binding.slug).ok
  );
}

function list(values: readonly string[]): string {
  return values.length === 0 ? "none" : values.join(", ");
}

/** The completeness report as fixed-order lines. Informational; never a publication check. */
function completenessLines(report: WebsiteCompletenessReport): string[] {
  const keys = (fields: readonly { readonly key: string }[]) => list(fields.map((field) => field.key));
  const valid = report.internalLinks.filter((link) => link.syntaxValid).length;
  return [
    `WEBSITE COMPLETENESS (${report.templateId}) — informational, not a blocker`,
    `Required, supplied by the content: ${keys(report.presentRequired)}`,
    `Required, derived by a fixed rule: ${keys(report.derived)}`,
    `Required, set only at publication time: ${keys(report.publicationTime)}`,
    `Required, not in the content model: ${keys(report.missingRequired)}`,
    `Optional: ${list(report.optional.map((field) => `${field.key} ${field.state}`))}`,
    `Internal links: ${report.internalLinks.length} (${valid} syntax-valid, ${report.internalLinks.length - valid} invalid; destinations unverified)`,
  ];
}

/** The preview document for an eligible proposal's binding and the approved stored text. */
export function buildArticleProposalPreview(input: ArticleProposalPreviewInput): ArticleProposalPreviewResult {
  const { binding, canonicalContent } = input;
  if (!bindingValid(binding)) return { ok: false, reason: "binding-invalid" };
  const destination = findDestination(binding.destination, binding.projectId);
  if (destination === null) return { ok: false, reason: "destination-unavailable" };
  const content = typeof canonicalContent === "string" ? readCanonicalArticle(canonicalContent) : null;
  if (content === null) return { ok: false, reason: "content-unreadable" };
  if (content.slug !== binding.slug) return { ok: false, reason: "slug-mismatch" };
  if (hasArticlePlaceholder(canonicalContent)) return { ok: false, reason: "unresolved-placeholder" };
  const live = liveSlugsFor(binding.destination).includes(binding.slug);
  if (live && content.topicDecision !== "update-existing") return { ok: false, reason: "slug-live-collision" };

  const attested = attestedParagraphs(content);
  const format = attested.length > 0 ? ARTICLE_PROPOSAL_PREVIEW_FORMAT_ATTESTED : ARTICLE_PROPOSAL_PREVIEW_FORMAT;
  const template = templateForDestination(binding.destination);
  const route = template === null ? "unresolved (no pinned template for this destination)" : routeFor(template, binding.slug);
  const lines = [
    `ARTICLE PUBLICATION PROPOSAL PREVIEW (${format})`,
    PROPOSAL_ONLY_LABEL,
    NO_PUBLICATION_NOTICE,
    "",
    "DESTINATION",
    `Destination: ${destination.key} (${destination.label}, ${destination.host})`,
    `Proposed route (not written): ${route}`,
    `Slug: ${binding.slug}`,
    "",
    "BINDING",
    `Project: ${binding.projectId}`,
    `Article: ${binding.articleId}`,
    `Article version: ${binding.articleVersion}`,
    `Version row: ${binding.articleVersionId}`,
    `Canonical content SHA-256: ${binding.contentSha256}`,
    `Approval record: ${binding.approvalId}`,
    `Approved by: ${binding.approvedBy}`,
    `Approved at: ${binding.approvedAt}`,
    `Topic decision: ${content.topicDecision}`,
    "",
    "WARNINGS",
    live
      ? "A live article at this destination already uses this slug. The topic decision is update-existing; this proposal is not permission to overwrite the live article."
      : "None.",
    "",
    ...completenessLines(websiteCompleteness(content)),
    "",
    ...(attested.length > 0
      ? [
          `ATTESTED PARAGRAPHS (${attested.length}) — operator-attested, not checked against the records; each shown with its label`,
          ...attested.map((paragraph) => `${paragraph.locator} (${paragraph.heading}): ${labelledParagraph(paragraph)}`),
          "",
        ]
      : []),
    `APPROVED CANONICAL CONTENT (${articleCanonicalFormat(content)}, exact stored text)`,
    canonicalContent,
  ];
  return { ok: true, preview: { format, document: lines.join("\n") } };
}
