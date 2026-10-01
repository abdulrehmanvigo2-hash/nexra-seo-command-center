import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { articleApprovalEligibility } from "@/lib/content/articles/approvals/eligibility";
import {
  ARTICLE_PROPOSAL_BLOCKS,
  articleProposalBlockMessage,
  articleProposalEligibility,
  articleProposalWarningMessage,
  type ArticleProposalFacts,
} from "@/lib/content/articles/proposals/eligibility";
import { liveSlugsIn } from "@/lib/content/articles/proposals/live-slugs";
import {
  APPROVAL_ID,
  APPROVED_AT,
  APPROVER,
  ARTICLE_ID,
  DESTINATION,
  LIVE_ARTICLES,
  OTHER_ARTICLE_ID,
  PROJECT_ID,
  VERSION_ID,
  approvedArticle,
  approvedContent,
  canonicalOf,
  eligibleFacts,
} from "@/lib/content/articles/proposals/test-support/fixtures";
import { NEXRA_AI_BLOG_TEMPLATE } from "@/lib/content/publications/website/template";
import type { ArticleProposalBlock, ArticleProposalEligibility } from "@/types/content-article-proposal";

/**
 * Stage 5, milestone C6, Checkpoint 2: which article version may be proposed.
 * Pure: every case is a set of facts the server would read.
 */

function blocks(result: ArticleProposalEligibility): readonly ArticleProposalBlock[] {
  return result.status === "blocked" ? result.blocks : [];
}

function blockedWith(facts: ArticleProposalFacts, ...expected: ArticleProposalBlock[]) {
  const result = articleProposalEligibility(facts);
  assert.equal(result.status, "blocked");
  assert.deepEqual(blocks(result), expected);
  return result;
}

const LIVE_SLUG = NEXRA_AI_BLOG_TEMPLATE.existingArticles[0].slug;

describe("an eligible version", () => {
  test("the current approved version, bound exactly to its row, hash and C5 approval", () => {
    const content = approvedContent();
    const result = articleProposalEligibility(eligibleFacts({}, content));
    assert.equal(result.status, "eligible");
    if (result.status !== "eligible") return;
    assert.deepEqual(result.binding, {
      projectId: PROJECT_ID,
      articleId: ARTICLE_ID,
      articleVersion: 2,
      articleVersionId: VERSION_ID,
      contentSha256: canonicalOf(content).sha256,
      approvalId: APPROVAL_ID,
      approvedBy: APPROVER,
      approvedAt: APPROVED_AT,
      destination: DESTINATION,
      slug: "missed-call-text-back",
    });
    assert.deepEqual(result.warnings, []);
    assert.equal(result.route, "/blog/missed-call-text-back");
    assert.deepEqual(result.content, content);
  });

  test("completeness is reported, never a reason: readingTime missing and published at publication time do not block", () => {
    const result = articleProposalEligibility(eligibleFacts());
    assert.equal(result.status, "eligible");
    if (result.status !== "eligible") return;
    assert.equal(result.completeness.structurallyComplete, false);
    assert.deepEqual(result.completeness.missingRequired.map((f) => f.key), ["readingTime"]);
    assert.deepEqual(result.completeness.publicationTime.map((f) => f.key), ["published"]);
  });

  test("an update-existing topic decision with a different slug has no warning", () => {
    const content = approvedContent((raw) => {
      raw.topicDecision = "update-existing";
    });
    const result = articleProposalEligibility(eligibleFacts({}, content));
    assert.equal(result.status, "eligible");
    assert.deepEqual(result.warnings, []);
  });
});

describe("the request and the article", () => {
  test("a malformed request stops at invalid-request", () => {
    blockedWith(eligibleFacts({ projectId: "Not A Project" }), "invalid-request");
    blockedWith(eligibleFacts({ articleId: "not-a-uuid" }), "invalid-request");
    blockedWith(eligibleFacts({ articleVersion: 0 }), "invalid-request");
    blockedWith(eligibleFacts({ articleVersion: 2.5 }), "invalid-request");
    blockedWith(eligibleFacts({ slug: undefined as unknown as string }), "invalid-request");
  });

  test("no article, or another project's: not-found, and nothing else", () => {
    blockedWith(eligibleFacts({ article: null }), "not-found");
    blockedWith(eligibleFacts({ article: approvedArticle({ projectId: "verdant-home" }) }), "not-found");
    blockedWith(eligibleFacts({ projectId: "verdant-home" }), "not-found");
    blockedWith(eligibleFacts({ article: approvedArticle({ id: OTHER_ARTICLE_ID }) }), "not-found");
  });

  test("archived", () => {
    blockedWith(eligibleFacts({ article: approvedArticle({ status: "archived" }) }), "archived");
  });

  test("drafting, and checked but not approved", () => {
    const pointerless = { approvedVersion: null, approvedBy: null, approvedAt: null };
    blockedWith(eligibleFacts({ article: approvedArticle({ status: "drafting", ...pointerless }), approval: null }), "not-approved", "approval-missing");
    blockedWith(eligibleFacts({ article: approvedArticle({ status: "checked", ...pointerless }), approval: null }), "not-approved", "approval-missing");
  });

  test("a stale version: the article has moved on", () => {
    const result = articleProposalEligibility(eligibleFacts({ article: approvedArticle({ currentVersion: 3, status: "drafting" }) }));
    assert.deepEqual(blocks(result), ["not-approved", "not-current", "approval-not-current"]);
  });

  test("a stale approval pointer: approved names an earlier version", () => {
    blockedWith(eligibleFacts({ article: approvedArticle({ approvedVersion: 1 }) }), "approval-not-current", "approval-pointer-mismatch");
  });
});

describe("the version and its text", () => {
  test("no version row", () => {
    blockedWith(eligibleFacts({ version: null }), "version-not-found", "approval-mismatch");
  });

  test("a row of another article, or another number", () => {
    const facts = eligibleFacts();
    blockedWith(eligibleFacts({ version: { ...facts.version!, articleId: OTHER_ARTICLE_ID } }), "version-mismatch", "approval-mismatch");
    blockedWith(eligibleFacts({ version: { ...facts.version!, version: 1 } }), "version-mismatch", "approval-mismatch");
  });

  test("text that is not canonical C1 content", () => {
    const facts = eligibleFacts();
    const text = facts.version!.canonicalContent.replace('"topic":', '"topic" :');
    const result = articleProposalEligibility({ ...facts, version: { ...facts.version!, canonicalContent: text }, computedContentSha256: facts.version!.contentSha256 });
    assert.deepEqual(blocks(result), ["content-unreadable"]);
    assert.deepEqual(blocks(articleProposalEligibility({ ...facts, version: { ...facts.version!, canonicalContent: "not json" } })), ["content-unreadable"]);
  });

  test("a stored hash the text does not produce, or none computed", () => {
    blockedWith(eligibleFacts({ computedContentSha256: "f".repeat(64) }), "content-hash-mismatch");
    blockedWith(eligibleFacts({ computedContentSha256: null }), "content-hash-mismatch");
    const facts = eligibleFacts();
    blockedWith({ ...facts, version: { ...facts.version!, contentSha256: facts.version!.contentSha256.toUpperCase() }, computedContentSha256: facts.version!.contentSha256.toUpperCase() }, "content-hash-mismatch", "approval-mismatch");
  });

  test("an unresolved placeholder, in any case", () => {
    const content = approvedContent((raw) => {
      raw.lead = "A missed call is often a lead [Needs Evidence: a figure].";
    });
    blockedWith(eligibleFacts({}, content), "unresolved-placeholder");
  });
});

describe("the C5 approval", () => {
  test("missing", () => {
    blockedWith(eligibleFacts({ approval: null }), "approval-missing");
  });

  test("for another article, another version, another row or another hash", () => {
    const approval = eligibleFacts().approval!;
    blockedWith(eligibleFacts({ approval: { ...approval, articleId: OTHER_ARTICLE_ID } }), "approval-mismatch");
    blockedWith(eligibleFacts({ approval: { ...approval, articleVersion: 1 } }), "approval-mismatch", "approval-pointer-mismatch");
    blockedWith(eligibleFacts({ approval: { ...approval, articleVersionId: "b6000000-0000-4000-8000-000000000001" } }), "approval-mismatch");
    blockedWith(eligibleFacts({ approval: { ...approval, contentSha256: "d".repeat(64) } }), "approval-mismatch");
  });

  test("the article's pointer names another operator or time", () => {
    blockedWith(eligibleFacts({ article: approvedArticle({ approvedBy: "00000000-0000-4000-8000-0000000000cc" }) }), "approval-pointer-mismatch");
    blockedWith(eligibleFacts({ article: approvedArticle({ approvedAt: "2026-09-24T12:00:00.123457+00:00" }) }), "approval-pointer-mismatch");
    blockedWith(eligibleFacts({ article: approvedArticle({ approvedBy: null }) }), "approval-pointer-mismatch");
  });
});

describe("the slug (D1)", () => {
  test("invalid", () => {
    blockedWith(eligibleFacts({ slug: "Missed Call" }), "slug-invalid");
    blockedWith(eligibleFacts({ slug: "ab" }), "slug-invalid");
  });

  test("valid but not the approved content's own slug", () => {
    blockedWith(eligibleFacts({ slug: "another-slug" }), "slug-mismatch");
  });
});

describe("the destination and proposal state (D3)", () => {
  test("a destination not registered, or not for this project", () => {
    blockedWith(eligibleFacts({ destination: "other-site" }), "destination-unavailable");
  });

  test("proposal state not read", () => {
    blockedWith(eligibleFacts({ proposals: null }), "proposal-state-unavailable");
  });

  test("an active proposal of this article, and it is returned", () => {
    const active = { proposalId: "d6000000-0000-4000-8000-000000000009", articleVersion: 2, destination: DESTINATION, slug: "missed-call-text-back" };
    const result = blockedWith(eligibleFacts({ proposals: { activeForArticle: active, holders: [] } }), "proposal-exists");
    assert.deepEqual(result.status === "blocked" ? result.activeProposal : null, active);
  });

  test("the destination and slug held by another article's active proposal", () => {
    blockedWith(
      eligibleFacts({ proposals: { activeForArticle: null, holders: [{ kind: "article", proposalId: "d6000000-0000-4000-8000-000000000001", articleId: OTHER_ARTICLE_ID, destination: DESTINATION, slug: "missed-call-text-back" }] } }),
      "slug-taken-by-article",
    );
  });

  test("held by a draft's active proposal (D3)", () => {
    blockedWith(
      eligibleFacts({ proposals: { activeForArticle: null, holders: [{ kind: "draft", proposalId: "d6000000-0000-4000-8000-000000000002", draftId: "d6200000-0000-4000-8000-000000000001", destination: DESTINATION, slug: "missed-call-text-back" }] } }),
      "slug-taken-by-draft",
    );
  });

  test("a holder of another destination or slug is not a reservation of this one", () => {
    const result = articleProposalEligibility(
      eligibleFacts({
        proposals: {
          activeForArticle: null,
          holders: [
            { kind: "draft", proposalId: "d6000000-0000-4000-8000-000000000003", draftId: "d6200000-0000-4000-8000-000000000002", destination: "other-site", slug: "missed-call-text-back" },
            { kind: "article", proposalId: "d6000000-0000-4000-8000-000000000004", articleId: OTHER_ARTICLE_ID, destination: DESTINATION, slug: "another-slug" },
          ],
        },
      }),
    );
    assert.equal(result.status, "eligible");
  });
});

describe("live slugs (D2)", () => {
  test("the live slugs are the records': the pinned template's, then those published after the pin (fix F9)", () => {
    assert.deepEqual(liveSlugsIn(LIVE_ARTICLES), ["ai-lead-follow-up-automation", "ai-dead-lead-reactivation"]);
    assert.deepEqual(liveSlugsIn([]), []);
  });

  test("live articles not read from the records: the slug cannot be vouched for, so it blocks (fix F9)", () => {
    const result = blockedWith(eligibleFacts({ liveArticles: null }), "live-articles-unread");
    assert.deepEqual(result.warnings, []);
  });

  test("a new article (different-angle) naming a live slug is refused", () => {
    const content = approvedContent((raw) => {
      raw.slug = LIVE_SLUG;
    });
    const result = blockedWith(eligibleFacts({}, content), "slug-live-collision");
    assert.deepEqual(result.warnings, []);
  });

  test("update-existing naming a live slug is allowed, with a warning that it is no permission to overwrite", () => {
    const content = approvedContent((raw) => {
      raw.slug = LIVE_SLUG;
      raw.topicDecision = "update-existing";
    });
    const result = articleProposalEligibility(eligibleFacts({}, content));
    assert.equal(result.status, "eligible");
    assert.deepEqual(result.warnings, ["live-slug-update-existing"]);
    assert.match(articleProposalWarningMessage("live-slug-update-existing"), /not permission to overwrite/);
  });

  test("a live slug with unreadable content is refused: the topic decision is unknown", () => {
    const content = approvedContent((raw) => {
      raw.slug = LIVE_SLUG;
      raw.topicDecision = "update-existing";
    });
    const facts = eligibleFacts({}, content);
    blockedWith({ ...facts, version: { ...facts.version!, canonicalContent: "{}" } }, "content-unreadable", "slug-live-collision");
  });
});

describe("every reason at once, in a fixed order", () => {
  test("several failures are all reported, in declaration order", () => {
    const facts = eligibleFacts();
    const result = articleProposalEligibility({
      ...facts,
      article: approvedArticle({ status: "checked", currentVersion: 3 }),
      computedContentSha256: null,
      approval: { ...facts.approval!, approvedBy: "00000000-0000-4000-8000-0000000000cc" },
      slug: "another-slug",
      destination: "other-site",
      proposals: null,
    });
    assert.deepEqual(blocks(result), [
      "not-approved",
      "not-current",
      "approval-not-current",
      "content-hash-mismatch",
      "approval-pointer-mismatch",
      "slug-mismatch",
      "destination-unavailable",
      "proposal-state-unavailable",
    ]);
    const reported = blocks(result);
    assert.deepEqual([...reported].sort((a, b) => ARTICLE_PROPOSAL_BLOCKS.indexOf(a) - ARTICLE_PROPOSAL_BLOCKS.indexOf(b)), reported);
  });

  test("the result is the same for the same facts", () => {
    const facts = eligibleFacts({ slug: "another-slug", proposals: null });
    assert.deepEqual(articleProposalEligibility(facts), articleProposalEligibility(facts));
  });

  test("every reason has operator words", () => {
    for (const block of ARTICLE_PROPOSAL_BLOCKS) assert.ok(articleProposalBlockMessage(block).length > 10, block);
  });
});

describe("the production Version 2 state (local fixture only)", () => {
  // Article c89182f9-… as observed in production and recorded in CLAUDE.md: drafting at version 2,
  // no approval, units 0 of 4 passed (3 unchecked, 1 needs review), approval history empty.
  // Built here from fixtures; the real article is not read, changed, approved or proposed.
  test("it is not eligible for a proposal, and not eligible for approval either", () => {
    const content = approvedContent((raw) => {
      raw.topicDecision = "unset";
    });
    const facts = eligibleFacts(
      {
        article: approvedArticle({ status: "drafting", currentVersion: 2, approvedVersion: null, approvedBy: null, approvedAt: null }),
        approval: null,
      },
      content,
    );
    const result = articleProposalEligibility(facts);
    assert.equal(result.status, "blocked");
    assert.deepEqual(blocks(result), ["not-approved", "approval-missing"]);

    const approval = articleApprovalEligibility({
      articleStatus: "drafting",
      currentVersion: 2,
      version: 2,
      contentReadable: true,
      planRefusal: null,
      unitStatuses: ["needs-review", null, null, null],
      mismatchedRows: 0,
      topicDecision: "unset",
      hasPlaceholder: false,
      approval: null,
    });
    assert.equal(approval.status, "blocked");
  });
});
