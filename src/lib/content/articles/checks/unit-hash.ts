import "server-only";

import { utf8Sha256 } from "@/lib/content/publications/content-hash";
import type { ArticleCheckUnit } from "@/types/content-article-check";

/**
 * A check unit's hash: SHA-256 over the UTF-8 bytes of its canonical
 * `nexra-article-check-unit/1` text, lowercase hex. The format tag is the
 * text's first member, so it doubles as the domain separator from the
 * article content hash and every other hash in this product.
 *
 * Server-only, like every hash here: the browser is never trusted with one.
 */
export function unitSha256(unit: Pick<ArticleCheckUnit, "text">): string {
  return utf8Sha256(unit.text);
}
