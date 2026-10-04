import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { AssembledDraft } from "@/lib/briefs/assemble-article";
import { draftUrl, editorHref, handoff, importBriefParam, openable, statusCounts } from "@/lib/briefs/handoff";
import { importArticleJson } from "@/lib/content/articles/import";
import type { ArticleContent } from "@/types/content-article";

/** M6, PR 5: the assembled draft read on demand, and the hand-off into the article editor's Import box. */

const root = new URL("../../../", import.meta.url);
const BRIEF = "99999999-9999-4999-8999-999999999999";
const content: ArticleContent = {
  topic: "AI SDR", searchIntent: "commercial", slug: "ai-sdr-approval", title: "AI SDR with a person in the loop", metaTitle: "AI SDR with approval", metaDescription: "How an AI SDR replies and who approves.",
  excerpt: "Where a person approves.", category: "AI Automation", keywords: ["ai sdr"], lead: "AI SDR tools reply within a minute.", introduction: ["This guide covers the approval step."],
  sections: [{ id: "what-it-does", heading: "What it does", paragraphs: ["It replies."], subsections: [] }], faqs: [], internalLinks: [], ctaTitle: "Talk to us", ctaBody: "Book a call.",
  topicDecision: "unset", attestations: [], citations: [],
};
const draft = (over: Partial<AssembledDraft> = {}): AssembledDraft => ({
  briefRunId: BRIEF, parts: [], content, issues: [], notes: [], warnings: [],
  evidenceMap: [{ locator: "what-it-does/0", text: "It replies.", tag: "none", status: "unsupported", note: "No tag: what it rests on is not named." }, { locator: "lead", text: "x", tag: "[evidence E1]", status: "record", note: null }],
  ...over,
});

describe("the hand-off", () => {
  test("URLs: the draft read and the editor link carry the project and the brief run", () => {
    assert.equal(draftUrl("nexra-agency", BRIEF), `/api/briefs/draft?project=nexra-agency&brief=${BRIEF}`);
    assert.equal(editorHref("nexra-agency", BRIEF), `/projects/nexra-agency?importBrief=${BRIEF}`);
    assert.equal(importBriefParam(`?importBrief=${BRIEF.toUpperCase()}`), BRIEF);
    assert.equal(importBriefParam("?importBrief=not-a-uuid"), null);
    assert.equal(importBriefParam(""), null);
  });

  test("a complete, valid draft goes into the Import box as JSON the editor accepts, with its unsupported lines named", () => {
    const result = handoff(draft(), 200);
    assert.ok(result.json !== null && importArticleJson(result.json).ok);
    assert.equal(result.note.tone, "warning");
    assert.match(result.note.text, /press Fill the form.*Nothing is saved until then\. 1 line is unsupported and still in the text/);
    assert.equal(handoff(draft({ evidenceMap: [] }), 200).note.tone, "neutral");
    assert.deepEqual(statusCounts(draft()), { unsupported: 1, record: 1, opinion: 0, connective: 0 });
  });

  test("an incomplete, invalid or unreadable draft fills nothing and says why", () => {
    assert.deepEqual(handoff(draft({ content: null }), 200), { note: { text: "Not every part of the brief is drafted yet, so nothing was filled.", tone: "warning" }, json: null });
    assert.equal(handoff(draft({ issues: [{ path: "slug", code: "format" }] }), 200).json, null);
    assert.equal(openable(draft({ issues: [{ path: "slug", code: "format" }] })), false);
    assert.match(handoff(null, 404).note.text, /not a completed brief of this project/);
    assert.match(handoff(null, 503).note.text, /not kept on this deployment/);
    assert.match(handoff(null, 0).note.text, /could not be read/);
  });

  test("the route is operator-only and read-only; the editor never applies or saves on its own", () => {
    const route = readFileSync(new URL("src/app/api/briefs/draft/route.ts", root), "utf8");
    assert.match(route, /const operator = await getOperator\(\);\n  if \(!operator\) return errorResponse\("unauthorized", 401\);/);
    assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);
    const panel = readFileSync(new URL("src/components/content/article-panel.tsx", root), "utf8");
    const effect = panel.slice(panel.indexOf("M6, PR 5: the assembled draft of a brief"), panel.indexOf("// Fix F9 (A5-03)"));
    assert.match(effect, /setImportText\(result\.json\);\n\s+setImporting\(true\);/);
    assert.doesNotMatch(effect, /applyImport|createArticle|saveArticleVersion/, "the operator presses Fill the form, then Create");
  });
});
