import { canonicalArticleJson } from "@/lib/content/articles/canonical";
import type { LiveArticle } from "@/lib/content/articles/proposals/live-slugs";
import type { ArticleProposalFacts } from "@/lib/content/articles/proposals/eligibility";
import { completeArticle } from "@/lib/content/articles/test-support/fixtures";
import { validateArticleContent } from "@/lib/content/articles/validate";
import { utf8Sha256 } from "@/lib/content/publications/content-hash";
import type { ValidatedArticleContent } from "@/types/content-article";
import type { ArticleApproval } from "@/types/content-article-approval";
import type { ArticleProposalBinding } from "@/types/content-article-proposal";
import type { Article } from "@/types/content-article-record";

/**
 * Fixtures for the C6 Checkpoint 2 tests: one approved article of the
 * `nexra-agency` project at version 2, its stored version row, its C5
 * approval row and an empty proposal state — eligible as built. Each test
 * changes the one fact it is about. Plain data; none of it exists anywhere
 * but here. Test support only.
 */

export const PROJECT_ID = "nexra-agency";
export const DESTINATION = "nexra-agency-website";
export const ARTICLE_ID = "a6000000-0000-4000-8000-000000000001";
export const OTHER_ARTICLE_ID = "a6000000-0000-4000-8000-000000000002";
export const VERSION_ID = "b6000000-0000-4000-8000-000000000002";
export const APPROVAL_ID = "c6000000-0000-4000-8000-000000000002";
export const APPROVER = "00000000-0000-4000-8000-0000000000bb";
/** As PostgreSQL returns a `timestamptz`: microseconds and an explicit offset, kept verbatim. */
export const APPROVED_AT = "2026-09-24T12:00:00.123456+00:00";
export const SLUG = "missed-call-text-back";

/** Valid C1 content with an approvable topic decision; `change` edits the raw object first. */
export function approvedContent(change: (raw: Record<string, unknown>) => void = () => {}): ValidatedArticleContent {
  const raw = completeArticle();
  raw.topicDecision = "different-angle";
  change(raw);
  const checked = validateArticleContent(raw);
  if (!checked.ok) throw new Error(`fixture content invalid: ${JSON.stringify(checked)}`);
  return checked.article;
}

export function canonicalOf(content: ValidatedArticleContent): { readonly text: string; readonly sha256: string } {
  const text = canonicalArticleJson(content);
  return { text, sha256: utf8Sha256(text) };
}

export function approvedArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: ARTICLE_ID,
    projectId: PROJECT_ID,
    sourcePlanRunId: "10000000-0000-4000-8000-000000000001",
    status: "approved",
    currentVersion: 2,
    approvedVersion: 2,
    approvedBy: APPROVER,
    approvedAt: APPROVED_AT,
    createdBy: "00000000-0000-4000-8000-0000000000aa",
    createdAt: "2026-09-23T10:00:00+00:00",
    updatedAt: APPROVED_AT,
    ...overrides,
  };
}

/**
 * The destination's live articles as production's records answer them since 20261015120000 (fix F9): the pinned
 * template slug (no article record), then the slug published from article 1003104c with its proposed version 6.
 */
export const LIVE_ARTICLES: readonly LiveArticle[] = [
  { slug: "ai-lead-follow-up-automation", articleId: null, articleVersion: null, keywords: null },
  { slug: "ai-dead-lead-reactivation", articleId: "1003104c-6b25-456f-9304-eefa2ba88e7d", articleVersion: 6, keywords: ["ai dead lead reactivation", "dead lead reactivation"] },
  { slug: "ai-sdr-tool", articleId: "6f50f8cb-bb85-4389-a5b4-21402c739f8b", articleVersion: 2, keywords: ["AI SDR tool", "best AI SDR tools", "AI SDR", "AI SDR companies"] },
];

/** Eligible facts for version 2; `overrides` replace whole facts. */
export function eligibleFacts(overrides: Partial<ArticleProposalFacts> = {}, content: ValidatedArticleContent = approvedContent()): ArticleProposalFacts {
  const { text, sha256 } = canonicalOf(content);
  const approval: ArticleApproval = {
    id: APPROVAL_ID,
    articleId: ARTICLE_ID,
    articleVersion: 2,
    articleVersionId: VERSION_ID,
    contentSha256: sha256,
    unitCount: 4,
    unitsSha256: "e".repeat(64),
    approvedBy: APPROVER,
    approvedAt: APPROVED_AT,
    attestedCount: 0,
    attestedConfirmed: false,
  };
  return {
    projectId: PROJECT_ID,
    articleId: ARTICLE_ID,
    articleVersion: 2,
    destination: DESTINATION,
    slug: content.slug,
    article: approvedArticle(),
    version: { id: VERSION_ID, articleId: ARTICLE_ID, version: 2, canonicalContent: text, contentSha256: sha256 },
    computedContentSha256: sha256,
    approval,
    proposals: { activeForArticle: null, holders: [] },
    liveArticles: LIVE_ARTICLES,
    ...overrides,
  };
}

/** The binding the eligible facts yield. */
export function eligibleBinding(content: ValidatedArticleContent = approvedContent(), overrides: Partial<ArticleProposalBinding> = {}): ArticleProposalBinding {
  return {
    projectId: PROJECT_ID,
    articleId: ARTICLE_ID,
    articleVersion: 2,
    articleVersionId: VERSION_ID,
    contentSha256: canonicalOf(content).sha256,
    approvalId: APPROVAL_ID,
    approvedBy: APPROVER,
    approvedAt: APPROVED_AT,
    destination: DESTINATION,
    slug: content.slug,
    ...overrides,
  };
}
