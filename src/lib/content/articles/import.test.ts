import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { canonicalArticleJson } from "@/lib/content/articles/canonical";
import { contentFromForm } from "@/lib/content/articles/editor-form";
import { importArticleJson, MAX_IMPORT_CHARACTERS } from "@/lib/content/articles/import";
import { createArticleProposalService } from "@/lib/content/articles/proposals/service";
import {
  APPROVAL_ID,
  APPROVED_AT,
  APPROVER,
  ARTICLE_ID,
  DESTINATION,
  PROJECT_ID,
  VERSION_ID,
  approvedArticle,
  approvedContent,
  canonicalOf,
} from "@/lib/content/articles/proposals/test-support/fixtures";
import { memoryDb, memoryStores, type MemoryDb } from "@/lib/content/articles/proposals/test-support/memory-db";
import { completeArticle } from "@/lib/content/articles/test-support/fixtures";
import { utf8Sha256 } from "@/lib/content/publications/content-hash";
import { validateArticleContent } from "@/lib/content/articles/validate";
import type { ValidatedArticleContent } from "@/types/content-article";

/**
 * Fix F9 (audit A5-03 rest, A5-01): one pasted article JSON fills the editor,
 * and the live slugs and keywords the proposal, the preview, the editor and
 * the renderer check are the records', not a list in code. No stored content,
 * hash or pin changes.
 */

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const PANEL = read("components/content/article-panel.tsx");
const V4_PIN = JSON.parse(readFileSync(new URL("./test-support/v4-pin.json", import.meta.url), "utf8")) as { canonical: string; contentSha256: string };

/** The 6.10b shape: H2 sections with H3s, FAQs, links and an attested paragraph. */
function fullArticle(): Record<string, unknown> {
  const raw = completeArticle();
  const sections = raw.sections as { id: string; heading: string; paragraphs: string[]; subsections: unknown[] }[];
  sections[0]!.subsections = [{ id: "what-to-say-first", heading: "What to say first", paragraphs: ["Keep the first message short and specific."] }];
  raw.attestations = [{ locator: `${sections[0]!.id}/0`, basis: "opinion" }];
  return raw;
}

describe("import fills every field from one pasted JSON (A5-03)", () => {
  test("the article content object fills every field, sections, H3s, FAQs, links and attestations included; the form saves back the same content", () => {
    const raw = fullArticle();
    const checked = validateArticleContent(raw);
    assert.ok(checked.ok, JSON.stringify(checked));
    const result = importArticleJson(JSON.stringify(raw, null, 2));
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.source, "content");
    assert.equal(result.form.sections[0]?.subsections[0]?.heading, "What to say first");
    assert.equal(result.form.faqs.length, (raw.faqs as unknown[]).length);
    assert.equal(result.form.internalLinks.length, (raw.internalLinks as unknown[]).length);
    assert.deepEqual(result.form.attestations, [{ locator: `${(raw.sections as { id: string }[])[0]!.id}/0`, basis: "opinion" }]);
    assert.match(result.summary, /1 H3, .* 1 attested paragraph\. Nothing is saved until you review the form and save\.$/);
    // Round trip: the filled form is exactly the pasted content, byte for byte once canonical.
    const back = validateArticleContent(contentFromForm(result.form));
    assert.ok(back.ok);
    assert.equal(canonicalArticleJson(back.article), canonicalArticleJson(checked.article));
  });

  test("a stored version's canonical text imports as it is; production V4's text fills the form and saves back to the same hash", () => {
    const result = importArticleJson(V4_PIN.canonical);
    assert.ok(result.ok);
    assert.equal(result.source, "canonical");
    const back = validateArticleContent(contentFromForm(result.form));
    assert.ok(back.ok);
    assert.equal(utf8Sha256(canonicalArticleJson(back.article)), V4_PIN.contentSha256, "V4's content hash is reproduced, unchanged");
  });

  test("unknown fields are refused and named; nothing is filled", () => {
    const result = importArticleJson(JSON.stringify({ ...fullArticle(), author: "x", published: "2026-10-01" }));
    assert.ok(!result.ok);
    assert.deepEqual(result.errors.filter((e) => /is not part of the article contract/.test(e)).length, 2);
    assert.ok(result.errors.includes("author is not part of the article contract."), result.errors.join(" | "));
    assert.ok(result.errors.includes("published is not part of the article contract."), "each unknown field is named");
  });

  test("validation errors are listed per field", () => {
    const raw = fullArticle();
    raw.slug = "Not A Slug";
    delete raw.title;
    (raw.sections as { heading: string }[])[0]!.heading = " leading space";
    const result = importArticleJson(JSON.stringify(raw));
    assert.ok(!result.ok);
    assert.ok(result.errors.includes("Slug is not in the required format."), result.errors.join(" | "));
    assert.ok(result.errors.includes("Title is required."));
    assert.ok(result.errors.includes("Sections 1 › heading starts or ends with a space; it is refused, not trimmed."));
    assert.equal(result.issues.length, result.errors.length);
  });

  test("not JSON, not an object, empty or too long: refused before anything is read", () => {
    for (const [text, pattern] of [
      ["", /Paste the article JSON first/],
      ["{ not json", /not valid JSON/],
      ["[1,2]", /one article object/],
      ['"text"', /one article object/],
      ["x".repeat(MAX_IMPORT_CHARACTERS + 1), /longer than/],
    ] as const) {
      const result = importArticleJson(text);
      assert.ok(!result.ok);
      assert.match(result.errors[0] ?? "", pattern);
    }
  });

  test("a format member other than the two canonical formats is refused as an unknown field", () => {
    const result = importArticleJson(JSON.stringify({ format: "nexra-article-content/3", ...fullArticle() }));
    assert.ok(!result.ok && result.errors.some((e) => /is not part of the article contract/.test(e)));
  });

  test("the editor: Import opens a paste box; Fill the form replaces the form and its attestation bindings only when valid; nothing is sent", () => {
    assert.match(PANEL, /Import article JSON…/);
    assert.match(PANEL, /const result = importArticleJson\(importText\);\s+if \(!result\.ok\) \{\s+setImportErrors\(result\.errors\);\s+return;\s+\}\s+setState\(\{ form: result\.form, bindings: initialBindings\(result\.form\) \}\);/);
    const apply = PANEL.slice(PANEL.indexOf("function applyImport()"), PANEL.indexOf("const update = (change"));
    assert.doesNotMatch(apply, /createArticle|saveArticleVersion|fetch\(/, "importing writes nothing");
    assert.match(PANEL, /Nothing is saved: review the form, then Create or Save as usual\./);
  });
});

describe("live articles from the records in the proposal service (A5-01)", () => {
  const OPERATOR = "00000000-0000-4000-8000-0000000000cc";

  function setup(content: ValidatedArticleContent = approvedContent(), articleId = ARTICLE_ID) {
    const { text, sha256 } = canonicalOf(content);
    const db: MemoryDb = memoryDb({
      articles: [approvedArticle({ id: articleId })],
      versions: [{ id: VERSION_ID, articleId, version: 2, origin: "operator", canonicalContent: text, contentSha256: sha256, createdBy: OPERATOR, createdAt: "2026-09-24T10:00:00+00:00" }],
      approvals: [{ id: APPROVAL_ID, articleId, articleVersion: 2, articleVersionId: VERSION_ID, contentSha256: sha256, unitCount: 4, unitsSha256: "e".repeat(64), approvedBy: APPROVER, approvedAt: APPROVED_AT, attestedCount: 0, attestedConfirmed: false }],
    });
    return { db, service: createArticleProposalService(memoryStores(db)) };
  }

  test("the records are read once per state; a slug they list as live refuses another article", async () => {
    const { db, service } = setup(approvedContent((raw) => (raw.slug = "ai-dead-lead-reactivation")));
    const result = await service.getState(PROJECT_ID, ARTICLE_ID, DESTINATION);
    assert.ok(result.ok);
    assert.ok(db.calls.reads.includes("live"));
    assert.ok(result.state.eligibility.status === "blocked" && result.state.eligibility.blocks.includes("slug-live-collision"));
    assert.equal(result.state.liveArticlesRead, true);
    assert.equal(result.state.liveSlug, null);
  });

  test("a slug added to the database's list is followed with no code change", async () => {
    const { db, service } = setup(approvedContent((raw) => (raw.slug = "missed-call-text-back")));
    const before = await service.getState(PROJECT_ID, ARTICLE_ID, DESTINATION);
    assert.ok(before.ok && before.state.eligibility.status === "eligible");
    db.liveSlugs.push({ destination: DESTINATION, slug: "missed-call-text-back", articleId: "a0000000-0000-4000-8000-0000000000ff" });
    const after = await service.getState(PROJECT_ID, ARTICLE_ID, DESTINATION);
    assert.ok(after.ok && after.state.eligibility.status === "blocked" && after.state.eligibility.blocks.includes("slug-live-collision"));
  });

  test("the owning article reads its live slug from the records (the editor's notice), and is not refused", async () => {
    const owner = "1003104c-6b25-456f-9304-eefa2ba88e7d";
    const { service } = setup(approvedContent((raw) => (raw.slug = "ai-dead-lead-reactivation")), owner);
    const result = await service.getState(PROJECT_ID, owner, DESTINATION);
    assert.ok(result.ok);
    assert.equal(result.state.liveSlug, "ai-dead-lead-reactivation");
    assert.equal(result.state.eligibility.status, "eligible");
  });

  test("records not read: the state still answers, the proposal is blocked live-articles-unread, and nothing can be recorded", async () => {
    const { db, service } = setup();
    db.failReads.add("live");
    const result = await service.getState(PROJECT_ID, ARTICLE_ID, DESTINATION);
    assert.ok(result.ok);
    assert.equal(result.state.liveArticlesRead, false);
    assert.ok(result.state.eligibility.status === "blocked" && result.state.eligibility.blocks.includes("live-articles-unread"));
    assert.equal(result.state.preview, null);
    const recorded = await service.record({ projectId: PROJECT_ID, articleId: ARTICLE_ID, articleVersion: 2, destination: DESTINATION, operatorId: OPERATOR });
    assert.ok(!recorded.ok && recorded.reason === "ineligible");
    assert.equal(db.calls.propose.length, 0);
  });
});
