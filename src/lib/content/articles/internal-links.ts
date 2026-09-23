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
 * destination's routes or anchors and does not invent one, so every link is
 * reported as `unverified`, whether or not its syntax is valid.
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

/**
 * Checks every link, in order, against the path syntax and the article's own
 * section and subsection ids. `syntaxValid` is true only when both hold; it
 * is computed here from the input, never assumed from where the links came
 * from. The destination is `unverified` in every case.
 */
export function checkInternalLinks(links: readonly ArticleInternalLink[], sectionIds: ReadonlySet<string>): InternalLinkCheck[] {
  return links.map((link): InternalLinkCheck => {
    const path: unknown = link.path;
    const sectionId: unknown = link.sectionId;
    const shown = { path: typeof path === "string" ? path : "", sectionId: typeof sectionId === "string" ? sectionId : "" };
    if (!isInternalPathSyntax(path)) return { ...shown, syntaxValid: false, issue: "path-format", destination: "unverified" };
    if (typeof sectionId !== "string" || !sectionIds.has(sectionId)) return { ...shown, syntaxValid: false, issue: "unknown-section", destination: "unverified" };
    return { ...shown, syntaxValid: true, issue: null, destination: "unverified" };
  });
}
