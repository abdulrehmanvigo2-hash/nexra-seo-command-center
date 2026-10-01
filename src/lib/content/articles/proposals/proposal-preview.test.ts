import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { articleProposalEligibility } from "@/lib/content/articles/proposals/eligibility";
import {
  ARTICLE_PROPOSAL_PREVIEW_FORMAT,
  NO_PUBLICATION_NOTICE,
  PROPOSAL_ONLY_LABEL,
  buildArticleProposalPreview,
} from "@/lib/content/articles/proposals/preview";
import { articleProposalPreviewSha256, hashedArticleProposalPreview } from "@/lib/content/articles/proposals/preview-hash";
import {
  APPROVAL_ID,
  APPROVED_AT,
  APPROVER,
  ARTICLE_ID,
  LIVE_ARTICLES,
  VERSION_ID,
  approvedContent,
  canonicalOf,
  eligibleBinding,
  eligibleFacts,
} from "@/lib/content/articles/proposals/test-support/fixtures";
import { NEXRA_AI_BLOG_TEMPLATE } from "@/lib/content/publications/website/template";

/**
 * Stage 5, milestone C6, Checkpoint 2: the read-only `article-proposal-text/1`
 * preview and its SHA-256. Nothing here stores, renders or sends anything.
 */

const root = new URL("../../../../../", import.meta.url);

function preview(content = approvedContent(), overrides = {}) {
  const result = buildArticleProposalPreview({ liveArticles: LIVE_ARTICLES, binding: eligibleBinding(content, overrides), canonicalContent: canonicalOf(content).text });
  assert.ok(result.ok, JSON.stringify(result));
  return result.preview;
}

describe("the document", () => {
  test("the exact layout: proposal-only label, notice, destination, route, binding, completeness, then the exact canonical text", () => {
    const content = approvedContent();
    const { text, sha256 } = canonicalOf(content);
    const doc = preview(content).document;
    assert.equal(
      doc,
      [
        "ARTICLE PUBLICATION PROPOSAL PREVIEW (article-proposal-text/1)",
        "PROPOSAL ONLY — NOT PUBLISHED",
        "Generating or recording this proposal does not publish the article, does not write to any website or repository, and does not create a GitHub pull request.",
        "",
        "DESTINATION",
        "Destination: nexra-agency-website (Nexra Agency website, nexraagency.com)",
        "Proposed route (not written): /blog/missed-call-text-back",
        "Slug: missed-call-text-back",
        "",
        "BINDING",
        "Project: nexra-agency",
        `Article: ${ARTICLE_ID}`,
        "Article version: 2",
        `Version row: ${VERSION_ID}`,
        `Canonical content SHA-256: ${sha256}`,
        `Approval record: ${APPROVAL_ID}`,
        `Approved by: ${APPROVER}`,
        `Approved at: ${APPROVED_AT}`,
        "Topic decision: different-angle",
        "",
        "WARNINGS",
        "None.",
        "",
        "WEBSITE COMPLETENESS (nexra-ai-blog-tsx/1) — informational, not a blocker",
        "Required, supplied by the content: slug, title, metaTitle, description, excerpt, category, keywords, lead, sections, ctaTitle, ctaBody",
        "Required, derived by a fixed rule: canonical, jsonLd",
        "Required, set only at publication time: published",
        "Required, not in the content model: readingTime",
        "Optional: intro present, toc derived, h3 present, faq present, furtherReading absent, internalLinks present",
        "Internal links: 1 (1 syntax-valid, 0 invalid; destinations unverified)",
        "",
        "APPROVED CANONICAL CONTENT (nexra-article-content/1, exact stored text)",
        text,
      ].join("\n"),
    );
  });

  test("the format is the one the C6 table accepts", () => {
    assert.equal(preview().format, "article-proposal-text/1");
    assert.equal(ARTICLE_PROPOSAL_PREVIEW_FORMAT, "article-proposal-text/1");
    const sql = readFileSync(new URL("supabase/migrations/20260925120000_create_article_publication_proposals.sql", root), "utf8");
    assert.match(sql, /check \(preview_format in \('article-proposal-text\/1'\)\)/);
  });

  test("it says it is a proposal, and never that anything was published", () => {
    const doc = preview().document;
    assert.ok(doc.includes(PROPOSAL_ONLY_LABEL));
    assert.ok(doc.includes(NO_PUBLICATION_NOTICE));
    assert.doesNotMatch(doc, /\b(has been|was|is now|successfully) published\b/i);
    assert.doesNotMatch(doc, /\bpull request (created|opened)\b/i);
    assert.doesNotMatch(doc, /<\w+[^>]*>|export default|import /);
  });

  test("the canonical text is included whole and last, character for character", () => {
    const content = approvedContent();
    const doc = preview(content).document;
    assert.ok(doc.endsWith(`\n${canonicalOf(content).text}`));
  });

  test("LF only, no trailing newline, no trailing spaces, no tabs", () => {
    const doc = preview().document;
    assert.ok(!doc.includes("\r"));
    assert.ok(!doc.endsWith("\n"));
    assert.ok(!doc.includes("\t"));
    for (const line of doc.split("\n")) assert.equal(line, line.trimEnd());
  });

  test("the approval time is verbatim, never re-formatted", () => {
    const at = "2026-09-24T12:00:00Z";
    assert.ok(preview(approvedContent(), { approvedAt: at }).document.includes(`Approved at: ${at}\n`));
  });

  test("the D2 warning is stated for update-existing on a live slug", () => {
    const content = approvedContent((raw) => {
      raw.slug = NEXRA_AI_BLOG_TEMPLATE.existingArticles[0].slug;
      raw.topicDecision = "update-existing";
    });
    const doc = preview(content).document;
    assert.match(doc, /WARNINGS\nA live article at this destination already uses this slug\. The topic decision is update-existing; this proposal is not permission to overwrite the live article\.\n/);
    assert.ok(doc.includes("Proposed route (not written): /blog/ai-lead-follow-up-automation"));
  });

  test("the preview follows the eligible result's binding exactly", () => {
    const content = approvedContent();
    const eligibility = articleProposalEligibility(eligibleFacts({}, content));
    assert.equal(eligibility.status, "eligible");
    if (eligibility.status !== "eligible") return;
    const built = buildArticleProposalPreview({ liveArticles: LIVE_ARTICLES, binding: eligibility.binding, canonicalContent: canonicalOf(content).text });
    assert.ok(built.ok);
    assert.equal(built.ok && built.preview.document, preview(content).document);
    assert.ok(built.ok && built.preview.document.includes(`Proposed route (not written): ${eligibility.route}`));
  });
});

describe("determinism and the hash", () => {
  test("the same input gives byte-identical text and the same SHA-256", () => {
    const a = hashedArticleProposalPreview({ liveArticles: LIVE_ARTICLES, binding: eligibleBinding(), canonicalContent: canonicalOf(approvedContent()).text });
    const b = hashedArticleProposalPreview({ liveArticles: LIVE_ARTICLES, binding: eligibleBinding(), canonicalContent: canonicalOf(approvedContent()).text });
    assert.ok(a.ok && b.ok);
    if (!a.ok || !b.ok) return;
    assert.ok(Buffer.from(a.preview.document, "utf8").equals(Buffer.from(b.preview.document, "utf8")));
    assert.equal(a.previewSha256, b.previewSha256);
  });

  test("the hash is SHA-256 of the document's UTF-8 bytes, 64 lowercase hex", () => {
    const doc = preview().document;
    const expected = createHash("sha256").update(Buffer.from(doc, "utf8")).digest("hex");
    assert.equal(articleProposalPreviewSha256(doc), expected);
    assert.match(expected, /^[0-9a-f]{64}$/);
  });

  test("the preview hash is not the content hash, and both are kept", () => {
    const content = approvedContent();
    const hashed = hashedArticleProposalPreview({ liveArticles: LIVE_ARTICLES, binding: eligibleBinding(content), canonicalContent: canonicalOf(content).text });
    assert.ok(hashed.ok);
    if (!hashed.ok) return;
    assert.notEqual(hashed.previewSha256, canonicalOf(content).sha256);
    assert.ok(hashed.preview.document.includes(`Canonical content SHA-256: ${canonicalOf(content).sha256}`));
  });

  test("any change to the binding or text changes the document and hash", () => {
    const base = articleProposalPreviewSha256(preview().document);
    assert.notEqual(articleProposalPreviewSha256(preview(approvedContent(), { approvedAt: "2026-09-24T12:00:00.123457+00:00" }).document), base);
    const edited = approvedContent((raw) => {
      raw.lead = "A missed call is often a lead deciding where to go.";
    });
    assert.notEqual(articleProposalPreviewSha256(preview(edited).document), base);
  });

  test("nothing from the clock, randomness or the environment", () => {
    const content = approvedContent();
    const input = { liveArticles: LIVE_ARTICLES, binding: eligibleBinding(content), canonicalContent: canonicalOf(content).text };
    const first = buildArticleProposalPreview(input);
    const realNow = Date.now;
    const realRandom = Math.random;
    const realCwd = process.cwd;
    try {
      Date.now = () => 0;
      Math.random = () => 0.5;
      process.cwd = () => "/elsewhere";
      process.env.NEXRA_PREVIEW_PROBE = "x";
      assert.deepEqual(buildArticleProposalPreview(input), first);
    } finally {
      Date.now = realNow;
      Math.random = realRandom;
      process.cwd = realCwd;
      delete process.env.NEXRA_PREVIEW_PROBE;
    }
    const doc = first.ok ? first.preview.document : "";
    assert.ok(!doc.includes(process.cwd()));
  });
});

describe("refusals: no preview for anything that would not be eligible", () => {
  const content = approvedContent();
  const text = canonicalOf(content).text;

  test("an invalid binding", () => {
    for (const bad of [
      { projectId: "Bad" },
      { articleId: "x" },
      { articleVersion: 0 },
      { articleVersion: 1.5 },
      { articleVersionId: "x" },
      { contentSha256: "F".repeat(64) },
      { approvalId: "x" },
      { approvedBy: "x" },
      { approvedAt: "2026-09-24 12:00:00" },
      { approvedAt: "yesterday" },
      { slug: "Bad Slug" },
    ]) {
      const result = buildArticleProposalPreview({ liveArticles: LIVE_ARTICLES, binding: eligibleBinding(content, bad), canonicalContent: text });
      assert.deepEqual(result, { ok: false, reason: "binding-invalid" }, JSON.stringify(bad));
    }
  });

  test("a destination not registered for the project", () => {
    assert.deepEqual(buildArticleProposalPreview({ liveArticles: LIVE_ARTICLES, binding: eligibleBinding(content, { destination: "other-site" }), canonicalContent: text }), { ok: false, reason: "destination-unavailable" });
    assert.deepEqual(buildArticleProposalPreview({ liveArticles: LIVE_ARTICLES, binding: eligibleBinding(content, { projectId: "verdant-home" }), canonicalContent: text }), { ok: false, reason: "destination-unavailable" });
  });

  test("text that is not canonical content", () => {
    assert.deepEqual(buildArticleProposalPreview({ liveArticles: LIVE_ARTICLES, binding: eligibleBinding(content), canonicalContent: `${text} ` }), { ok: false, reason: "content-unreadable" });
    assert.deepEqual(buildArticleProposalPreview({ liveArticles: LIVE_ARTICLES, binding: eligibleBinding(content), canonicalContent: undefined as unknown as string }), { ok: false, reason: "content-unreadable" });
  });

  test("a slug that is not the content's own", () => {
    assert.deepEqual(buildArticleProposalPreview({ liveArticles: LIVE_ARTICLES, binding: eligibleBinding(content, { slug: "another-slug" }), canonicalContent: text }), { ok: false, reason: "slug-mismatch" });
  });

  test("a placeholder, and a live-slug collision for a new article", () => {
    const placeholder = approvedContent((raw) => {
      raw.lead = "Lead [NEEDS EVIDENCE: x].";
    });
    assert.deepEqual(buildArticleProposalPreview({ liveArticles: LIVE_ARTICLES, binding: eligibleBinding(placeholder), canonicalContent: canonicalOf(placeholder).text }), { ok: false, reason: "unresolved-placeholder" });
    const live = approvedContent((raw) => {
      raw.slug = NEXRA_AI_BLOG_TEMPLATE.existingArticles[0].slug;
    });
    assert.deepEqual(buildArticleProposalPreview({ liveArticles: LIVE_ARTICLES, binding: eligibleBinding(live), canonicalContent: canonicalOf(live).text }), { ok: false, reason: "slug-live-collision" });
  });

  test("the server refuses text that does not hash to the binding's content hash", () => {
    assert.deepEqual(hashedArticleProposalPreview({ liveArticles: LIVE_ARTICLES, binding: eligibleBinding(content, { contentSha256: "a".repeat(64) }), canonicalContent: text }), { ok: false, reason: "content-hash-mismatch" });
  });
});
