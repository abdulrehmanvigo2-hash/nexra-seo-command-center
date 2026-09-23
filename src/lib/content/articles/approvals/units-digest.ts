import "server-only";

import { utf8Sha256 } from "@/lib/content/publications/content-hash";

/**
 * The digest of one version's ordered check-unit set, bound into its
 * approval: SHA-256, lowercase hex, over the UTF-8 text
 *
 *   nexra-article-approval-units/1\n
 *   <index> <key> <unit sha256>\n   (one line per unit, in index order)
 *
 * The approval function in `20260924120000_create_article_approvals.sql`
 * recomputes the same text from the stored check-unit rows, and the two
 * must agree. Server-only, like every hash here.
 */

export const ARTICLE_APPROVAL_UNITS_FORMAT = "nexra-article-approval-units/1";

export type ApprovalUnitIdentity = { readonly index: number; readonly key: string; readonly sha256: string };

export function approvalUnitsText(units: readonly ApprovalUnitIdentity[]): string {
  const ordered = [...units].sort((a, b) => a.index - b.index);
  return `${ARTICLE_APPROVAL_UNITS_FORMAT}\n${ordered.map((u) => `${u.index} ${u.key} ${u.sha256}\n`).join("")}`;
}

export function approvalUnitsSha256(units: readonly ApprovalUnitIdentity[]): string {
  return utf8Sha256(approvalUnitsText(units));
}
