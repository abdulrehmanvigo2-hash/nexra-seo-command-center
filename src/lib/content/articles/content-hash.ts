import "server-only";

import { canonicalArticleJson } from "@/lib/content/articles/canonical";
import { utf8Sha256 } from "@/lib/content/publications/content-hash";
import type { ValidatedArticleContent } from "@/types/content-article";

/**
 * The article content hash: SHA-256 over the UTF-8 bytes of the canonical
 * `nexra-article-content/1` text, lowercase hex. The format tag is the
 * text's first member, so it doubles as the domain separator from every
 * other hash in this product.
 *
 * PostgreSQL computes the same value from the stored text with
 * `encode(sha256(convert_to(canonical, 'UTF8')), 'hex')`.
 *
 * Server-only, like the draft and preview hashes.
 */
export function articleContentSha256(article: ValidatedArticleContent): string {
  return utf8Sha256(canonicalArticleJson(article));
}
