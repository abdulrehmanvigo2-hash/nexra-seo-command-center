/**
 * Which exact article version may be proposed for publication (Stage 5,
 * milestone C6, Checkpoint 2), decided from the records the server read.
 *
 * The rule fails closed and has no override. Only the current version of an
 * approved, live article of the requested project may be proposed, and only
 * when:
 * - its stored row is that version of that article;
 * - its stored text reads as exactly canonical C1 content and hashes to the
 *   stored hash (the hash is recomputed by the server and passed in);
 * - the exact C5 approval-history row names this article, version, version
 *   row and hash, and the article's approval pointer (version, operator,
 *   time) matches it;
 * - the requested slug is valid and is the content's own slug (D1);
 * - no `[NEEDS EVIDENCE` placeholder is left;
 * - the destination is registered for the project;
 * - the proposal state was read, and neither this article nor any other
 *   proposal — article or draft (D3) — holds the destination and slug;
 * - the slug is not a live article at the destination unless the topic
 *   decision is update-existing, which is allowed with a warning (D2); a slug
 *   published after the template's pin belongs to the article it was
 *   published from, which it never blocks, and blocks every other article
 *   (D10, `live-slugs.ts`).
 *
 * Website completeness is reported, never a reason: `readingTime` is not
 * content and `published` exists only at publication.
 *
 * Every applicable reason is returned, in the order of `ARTICLE_PROPOSAL_BLOCKS`.
 * A malformed request, or an article that is not found, stops there: nothing
 * else can be said about it.
 *
 * THE DATABASE DECIDES. This result is feedback and preview preparation, and
 * may be stale by the time a proposal is recorded. The database function
 * `nexra_article_publication_propose` re-checks every condition under the
 * article's row lock, and the D3 trigger re-checks the destination and slug
 * under its own lock; an eligible result here is never permission to skip
 * them.
 *
 * Pure: no store, no network, no hash; safe to import from either side.
 */

import { hasArticlePlaceholder } from "@/lib/content/articles/approvals/eligibility";
import { readCanonicalArticle } from "@/lib/content/articles/canonical";
import { websiteCompleteness } from "@/lib/content/articles/website-completeness";
import { isProjectId, isUuid } from "@/lib/content/drafts/service";
import { findDestination } from "@/lib/content/publications/destinations";
import { validateSlug } from "@/lib/content/publications/proposal-rules";
import { liveSlugOutcome, liveSlugsFor } from "@/lib/content/articles/proposals/live-slugs";
import { routeFor, templateForDestination } from "@/lib/content/publications/website/template";
import type { ArticleApproval } from "@/types/content-article-approval";
import type {
  ArticleProposalBlock,
  ArticleProposalEligibility,
  ArticleProposalState,
  ArticleProposalWarning,
} from "@/types/content-article-proposal";
import type { Article, ArticleVersion } from "@/types/content-article-record";

/** Every reason, in the order they are reported. */
export const ARTICLE_PROPOSAL_BLOCKS: readonly ArticleProposalBlock[] = [
  "invalid-request",
  "not-found",
  "archived",
  "not-approved",
  "not-current",
  "approval-not-current",
  "version-not-found",
  "version-mismatch",
  "content-unreadable",
  "content-hash-mismatch",
  "approval-missing",
  "approval-mismatch",
  "approval-pointer-mismatch",
  "slug-invalid",
  "slug-mismatch",
  "unresolved-placeholder",
  "destination-unavailable",
  "proposal-state-unavailable",
  "proposal-exists",
  "slug-taken-by-article",
  "slug-taken-by-draft",
  "slug-live-collision",
];

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** What the server read, and what the operator asked for. */
export type ArticleProposalFacts = {
  /** The request. */
  readonly projectId: string;
  readonly articleId: string;
  readonly articleVersion: number;
  readonly destination: string;
  readonly slug: string;
  /** The article, read by project and id; null when none. */
  readonly article: Article | null;
  /** The version row, read by article id and version number; null when none. */
  readonly version: Pick<ArticleVersion, "id" | "articleId" | "version" | "canonicalContent" | "contentSha256"> | null;
  /** SHA-256 of the stored text's UTF-8 bytes, computed by the server; null when not computed. */
  readonly computedContentSha256: string | null;
  /** The C5 approval-history row for this article and version; null when none. */
  readonly approval: ArticleApproval | null;
  /** The proposal state; null when it was not read. */
  readonly proposals: ArticleProposalState | null;
};

function isVersionNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 32_767;
}

/** The live slugs at a destination (D2, D10); defined in `live-slugs.ts`, re-exported for existing callers. */
export { liveSlugsFor };

function ordered(blocks: ReadonlySet<ArticleProposalBlock>): ArticleProposalBlock[] {
  return ARTICLE_PROPOSAL_BLOCKS.filter((block) => blocks.has(block));
}

/** The whole rule, with every reason that applies. */
export function articleProposalEligibility(facts: ArticleProposalFacts): ArticleProposalEligibility {
  const none = { warnings: [] as const, activeProposal: null };
  if (
    !isProjectId(facts.projectId) ||
    !isUuid(facts.articleId) ||
    !isVersionNumber(facts.articleVersion) ||
    typeof facts.destination !== "string" ||
    typeof facts.slug !== "string"
  ) {
    return { status: "blocked", blocks: ["invalid-request"], ...none };
  }
  const article = facts.article;
  if (article === null || article.id !== facts.articleId || article.projectId !== facts.projectId) {
    return { status: "blocked", blocks: ["not-found"], ...none };
  }

  const blocks = new Set<ArticleProposalBlock>();
  const warnings: ArticleProposalWarning[] = [];

  // The article and its approval pointer.
  if (article.status === "archived") blocks.add("archived");
  else if (article.status !== "approved") blocks.add("not-approved");
  if (facts.articleVersion !== article.currentVersion) blocks.add("not-current");
  if (article.approvedVersion !== null && article.approvedVersion !== article.currentVersion) blocks.add("approval-not-current");

  // The version row and its stored text.
  const version = facts.version;
  const versionMatches = version !== null && version.articleId === article.id && version.version === facts.articleVersion;
  if (version === null) blocks.add("version-not-found");
  else if (!versionMatches) blocks.add("version-mismatch");
  const content = versionMatches ? readCanonicalArticle(version.canonicalContent) : null;
  if (versionMatches) {
    if (content === null) blocks.add("content-unreadable");
    if (!SHA256_HEX.test(version.contentSha256) || facts.computedContentSha256 !== version.contentSha256) blocks.add("content-hash-mismatch");
  }

  // The exact C5 approval row, and the pointer that names it.
  const approval = facts.approval;
  if (approval === null) {
    blocks.add("approval-missing");
  } else {
    if (
      approval.articleId !== article.id ||
      approval.articleVersion !== facts.articleVersion ||
      !versionMatches ||
      approval.articleVersionId !== version.id ||
      approval.contentSha256 !== version.contentSha256
    ) {
      blocks.add("approval-mismatch");
    }
    if (
      article.approvedVersion !== approval.articleVersion ||
      article.approvedBy === null ||
      article.approvedAt === null ||
      article.approvedBy !== approval.approvedBy ||
      article.approvedAt !== approval.approvedAt
    ) {
      blocks.add("approval-pointer-mismatch");
    }
  }

  // The slug (D1) and the text.
  const slugValid = validateSlug(facts.slug).ok;
  if (!slugValid) blocks.add("slug-invalid");
  else if (content !== null && content.slug !== facts.slug) blocks.add("slug-mismatch");
  if (versionMatches && hasArticlePlaceholder(version.canonicalContent)) blocks.add("unresolved-placeholder");

  // The destination.
  if (findDestination(facts.destination, facts.projectId) === null) blocks.add("destination-unavailable");

  // Proposal state: this article's own, and the destination and slug across both tables (D3).
  const proposals = facts.proposals;
  const activeProposal = proposals?.activeForArticle ?? null;
  if (proposals === null) {
    blocks.add("proposal-state-unavailable");
  } else {
    if (proposals.activeForArticle !== null) blocks.add("proposal-exists");
    for (const holder of proposals.holders) {
      if (holder.destination !== facts.destination || holder.slug !== facts.slug) continue;
      if (holder.kind === "draft") blocks.add("slug-taken-by-draft");
      else if (holder.articleId !== article.id) blocks.add("slug-taken-by-article");
      else blocks.add("proposal-exists");
    }
  }

  // Live slugs at the destination (D2, D10). Without readable content the topic decision is unknown: a pinned
  // slug is refused; a slug published after the pin is decided by its owning article alone.
  if (slugValid) {
    const live = liveSlugOutcome(facts.destination, facts.slug, article.id, content === null ? null : content.topicDecision);
    if (live === "update-existing-warning") warnings.push("live-slug-update-existing");
    else if (live === "collision") blocks.add("slug-live-collision");
  }

  if (blocks.size > 0 || content === null || !versionMatches || approval === null) {
    return { status: "blocked", blocks: ordered(blocks), warnings, activeProposal };
  }
  const template = templateForDestination(facts.destination);
  return {
    status: "eligible",
    binding: {
      projectId: facts.projectId,
      articleId: article.id,
      articleVersion: facts.articleVersion,
      articleVersionId: version.id,
      contentSha256: version.contentSha256,
      approvalId: approval.id,
      approvedBy: approval.approvedBy,
      approvedAt: approval.approvedAt,
      destination: facts.destination,
      slug: facts.slug,
    },
    content,
    completeness: websiteCompleteness(content),
    route: template === null ? null : routeFor(template, facts.slug),
    warnings,
  };
}

/** The operator's words for a reason. */
export function articleProposalBlockMessage(block: ArticleProposalBlock): string {
  switch (block) {
    case "invalid-request":
      return "The request does not name a valid project, article, version, destination or slug.";
    case "not-found":
      return "No such article in this project.";
    case "archived":
      return "The article is archived, so nothing in it can be proposed.";
    case "not-approved":
      return "The article is not approved. Only an approved article can be proposed for publication.";
    case "not-current":
      return "Only the article's current version can be proposed.";
    case "approval-not-current":
      return "The article's approval names an earlier version. Approve the current version first.";
    case "version-not-found":
      return "The stored version could not be found.";
    case "version-mismatch":
      return "The stored version row does not belong to this article and version.";
    case "content-unreadable":
      return "The stored text of this version does not read as article content.";
    case "content-hash-mismatch":
      return "The stored text of this version does not match its recorded hash.";
    case "approval-missing":
      return "No approval is recorded for this version.";
    case "approval-mismatch":
      return "The recorded approval does not name this exact version and text.";
    case "approval-pointer-mismatch":
      return "The article's current approval does not match the recorded approval.";
    case "slug-invalid":
      return "The slug is not valid: lowercase letters, digits and single hyphens, 3 to 80 characters.";
    case "slug-mismatch":
      return "The slug must be the approved article's own slug.";
    case "unresolved-placeholder":
      return "The text still carries a [NEEDS EVIDENCE: …] placeholder.";
    case "destination-unavailable":
      return "This destination is not registered for this project.";
    case "proposal-state-unavailable":
      return "The current proposals could not be read, so eligibility cannot be confirmed.";
    case "proposal-exists":
      return "A publication proposal for this article is already active. Withdraw it before preparing another.";
    case "slug-taken-by-article":
      return "Another article's active proposal already uses this slug at this destination.";
    case "slug-taken-by-draft":
      return "A draft's active proposal already uses this slug at this destination.";
    case "slug-live-collision":
      return "A live article at this destination already uses this slug. Only the article it was published from, or, for a slug the pinned template lists, an article whose topic decision is Update existing, may name it.";
  }
}

/** The operator's words for a warning. */
export function articleProposalWarningMessage(warning: ArticleProposalWarning): string {
  switch (warning) {
    case "live-slug-update-existing":
      return "A live article at this destination already uses this slug. The topic decision is Update existing; this proposal is not permission to overwrite the live article, and it publishes nothing.";
  }
}
