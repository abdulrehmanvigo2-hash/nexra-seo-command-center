import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AssembledDraft } from "@/lib/briefs/assemble-article";
import { articleForBrief, createRefusalText, saveArticle, type CreateAnswer, type SaveArticleIo } from "@/lib/pipeline/save-article";
import type { ArticleHistory } from "@/types/content-article-record";

const BRIEF = "b0000000-0000-4000-8000-000000000001";
const TASK = "c0000000-0000-4000-8000-000000000001";
const history = (id = "a1", plan = BRIEF) => ({ article: { id, sourcePlanRunId: plan }, versions: [] }) as unknown as ArticleHistory;
const draft = (over: Partial<AssembledDraft> = {}): AssembledDraft => ({ briefRunId: BRIEF, parts: [], content: { title: "T" } as never, evidenceMap: [], issues: [], notes: [], warnings: [], ...over });

function io(over: Partial<{ draft: AssembledDraft | null; taskId: string | null; create: CreateAnswer; linkStatus: number }> = {}) {
  const calls: string[] = [];
  const sent: { content?: unknown; link?: unknown } = {};
  const x: SaveArticleIo = {
    readDraft: async () => {
      calls.push("draft");
      return { status: 200, draft: over.draft === undefined ? draft() : over.draft, taskId: over.taskId === undefined ? TASK : over.taskId };
    },
    create: async (content) => {
      calls.push("create");
      sent.content = content;
      return over.create ?? { ok: true, created: true, history: history() };
    },
    link: async (body) => {
      calls.push("link");
      sent.link = body;
      return { status: over.linkStatus ?? 200, body: { status: over.linkStatus === undefined ? "article-linked" : "terminal" } };
    },
  };
  return { io: x, calls, sent };
}

describe("saveArticle", () => {
  test("a complete, valid draft: created, then linked to the opportunity's task", async () => {
    const { io: x, calls, sent } = io();
    const out = await saveArticle(x, "nexra-agency");
    assert.ok(out.ok && out.created);
    assert.deepEqual(calls, ["draft", "create", "link"]);
    assert.deepEqual(sent.content, { title: "T" });
    assert.deepEqual(sent.link, { project: "nexra-agency", action: "link-article", taskId: TASK, articleId: "a1" });
    assert.ok(out.ok && out.link?.tone === "neutral");
  });

  test("an incomplete or invalid draft creates nothing", async () => {
    const incomplete = io({ draft: draft({ content: null }) });
    assert.deepEqual(await saveArticle(incomplete.io, "p"), { ok: false, reason: "incomplete", text: "Not every part is drafted yet, so nothing was saved." });
    const invalid = io({ draft: draft({ issues: [{ path: "slug", code: "required" }] as never }) });
    const out = await saveArticle(invalid.io, "p");
    assert.ok(!out.ok && out.reason === "invalid");
    assert.deepEqual(invalid.calls, ["draft"]);
    assert.deepEqual(incomplete.calls, ["draft"]);
  });

  test("an unreadable draft or a refused create says so; nothing is linked", async () => {
    assert.ok(!(await saveArticle(io({ draft: null }).io, "p")).ok);
    const refused = io({ create: { ok: false, reason: "invalid-sources", message: createRefusalText("invalid-sources") } });
    const out = await saveArticle(refused.io, "p");
    assert.ok(!out.ok && out.reason === "refused" && /source draft/.test(out.text));
    assert.deepEqual(refused.calls, ["draft", "create"]);
  });

  test("an article already made for the brief is answered, not linked again", async () => {
    const { io: x, calls } = io({ create: { ok: true, created: false, history: history() } });
    const out = await saveArticle(x, "p");
    assert.ok(out.ok && !out.created && out.link === null);
    assert.deepEqual(calls, ["draft", "create"]);
  });

  test("no task known: created, with the warning; a refused link is a warning, never a failure", async () => {
    const unknown = await saveArticle(io({ taskId: null }).io, "p");
    assert.ok(unknown.ok && unknown.link?.tone === "warning");
    const refused = await saveArticle(io({ linkStatus: 409 }).io, "p");
    assert.ok(refused.ok && refused.created && refused.link?.tone === "warning");
  });
});

describe("articleForBrief", () => {
  test("the article whose plan is this brief, or null", () => {
    const list = [history("x", "b0000000-0000-4000-8000-000000000009"), history("a1", BRIEF)];
    assert.equal(articleForBrief(list, BRIEF.toUpperCase())?.article.id, "a1");
    assert.equal(articleForBrief([list[0]!], BRIEF), null);
  });
});

describe("the article step on the Gate 1 panel", async () => {
  const { readFileSync } = await import("node:fs");
  const step = readFileSync("src/components/content/gate1-article.tsx", "utf8");
  const panel = readFileSync("src/components/content/gate1-panel.tsx", "utf8");
  test("shown once every part is drafted; saved without a press only right after the writing finished here", () => {
    assert.match(panel, /counts\.drafted === counts\.total && \(\s*<Gate1ArticleStep projectId=\{projectId\} briefRunId=\{briefRun\.id\} brief=\{brief\} writerRuns=\{writerRuns\} autoSave=\{justWrote\}/);
    assert.match(panel, /if \(result\.ended === "done"\) setJustWrote\(true\);/);
    assert.match(step, /if \(!autoSave \|\| autoTried\.current/);
  });
  test("created with the brief as plan and no source draft, through the editor's own Server Action; then the existing Check all", () => {
    assert.match(step, /createArticle\(projectId, briefRunId, content, \[\]\)/);
    assert.match(step, /<CheckAllControl/);
    // Gate 2's writes live in gate2-panel.tsx (PR 7), behind its own confirmation.
    assert.doesNotMatch(step, /approveArticle|recordArticleProposal|requestPublication|\/publish/);
  });
});
