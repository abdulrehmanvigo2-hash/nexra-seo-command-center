import "server-only";

import { buildArticleProposalPreview, type ArticleProposalPreviewInput, type ArticleProposalPreviewRefusal } from "@/lib/content/articles/proposals/preview";
import { utf8Sha256 } from "@/lib/content/publications/content-hash";
import type { ArticleProposalPreview } from "@/types/content-article-proposal";

/**
 * The preview hash of an article publication proposal: SHA-256 over the
 * exact UTF-8 bytes of the `article-proposal-text/1` document, lowercase
 * hex — the value a proposal records as `preview_sha256`. It is a separate
 * hash from the canonical-content hash, which stays in the binding.
 *
 * `hashedArticleProposalPreview` also confirms the stored text hashes to the
 * binding's content hash before building anything, since the pure preview
 * cannot hash. Nothing is stored or sent.
 *
 * Server-only, like the draft and article content hashes.
 */

export function articleProposalPreviewSha256(document: string): string {
  return utf8Sha256(document);
}

export type HashedArticleProposalPreview =
  | { readonly ok: true; readonly preview: ArticleProposalPreview; readonly previewSha256: string }
  | { readonly ok: false; readonly reason: ArticleProposalPreviewRefusal | "content-hash-mismatch" };

export function hashedArticleProposalPreview(input: ArticleProposalPreviewInput): HashedArticleProposalPreview {
  if (typeof input.canonicalContent !== "string" || utf8Sha256(input.canonicalContent) !== input.binding.contentSha256) {
    return { ok: false, reason: "content-hash-mismatch" };
  }
  const built = buildArticleProposalPreview(input);
  if (!built.ok) return built;
  return { ok: true, preview: built.preview, previewSha256: articleProposalPreviewSha256(built.preview.document) };
}
