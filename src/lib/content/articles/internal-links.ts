/**
 * Internal-link syntax, and nothing more.
 *
 * A link's path is accepted only in one conservative form: a site-relative
 * path of lowercase kebab-case segments, with an optional kebab-case
 * `#fragment`. No scheme, host, `//`, query string, `.` or `..` segment,
 * percent-encoding, uppercase, or trailing slash (the root `/` aside). Anything
 * else is refused, not repaired.
 *
 * Syntax is all C1 can know. This product holds no inventory of the
 * destination's routes or anchors and does not invent one, so every link in
 * validated content is reported as `unverified`.
 *
 * Pure.
 */

import type { ArticleInternalLink, InternalLinkCheck } from "@/types/content-article";

export const MAX_INTERNAL_PATH_LENGTH = 200;

const SEGMENT = "[a-z0-9]+(?:-[a-z0-9]+)*";
const INTERNAL_PATH = new RegExp(`^(?:/|(?:/${SEGMENT})+)(?:#${SEGMENT})?$`);

/** Whether a path is a syntactically valid internal link target. Says nothing about whether it exists. */
export function isInternalPathSyntax(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_INTERNAL_PATH_LENGTH && INTERNAL_PATH.test(value);
}

/** Every link, in content order, as syntactically valid and destination-unverified. */
export function checkInternalLinks(links: readonly ArticleInternalLink[]): InternalLinkCheck[] {
  return links.map((link) => ({ path: link.path, sectionId: link.sectionId, syntaxValid: true, destination: "unverified" }));
}
