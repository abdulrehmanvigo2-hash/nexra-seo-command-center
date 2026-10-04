import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { internalLinksUrl, parseTaskRequest, taskConfirmation, taskOutcome } from "@/lib/internal-links/contract";

/** M8, PR 5: the internal-links read and write, and their screens. */

const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const CRAWL = "c0000000-0000-4000-8000-000000000001";
const ok = { project: "nexra-agency", crawl: CRAWL, from: "https://nexraagency.com/", to: "https://nexraagency.com/blog/x", anchor: " missed call text back " };

describe("the task request", () => {
  test("project, crawl, two http(s) URLs and an anchor of 1–200 characters; nothing else", () => {
    assert.deepEqual(parseTaskRequest(ok), { ok: true, value: { projectId: "nexra-agency", crawlId: CRAWL, fromUrl: ok.from, toUrl: ok.to, anchor: "missed call text back" } });
    for (const bad of [{ ...ok, crawl: "x" }, { ...ok, from: "javascript:alert(1)" }, { ...ok, anchor: "  " }, { ...ok, anchor: "a".repeat(201) }, { ...ok, project: "Bad Project" }, { ...ok, extra: 1 }, null, []]) {
      assert.equal(parseTaskRequest(bad).ok, false, JSON.stringify(bad));
    }
    assert.equal(internalLinksUrl("nexra-agency"), "/api/internal-links?project=nexra-agency");
  });

  test("the confirmation says what is recorded and that nothing is edited; the answers in words", () => {
    const c = taskConfirmation({ fromPath: "/", toPath: "/blog/x", anchor: "x y" }, "nexra-agency");
    assert.equal(c.usage, null);
    assert.match(c.consequence, /edits no page, calls no model and costs nothing/);
    assert.match(taskOutcome(201, {}).text, /backlog task for On-Page SEO/);
    assert.match(taskOutcome(503, { error: "not-set-up" }).text, /migration is not applied/);
    assert.match(taskOutcome(409, { error: "page-not-found" }).text, /not fetched/);
  });
});

describe("the routes and screens", () => {
  test("the read is operator-only and read-only; the write is same-origin, operator-only and limited", () => {
    const get = read("src/app/api/internal-links/route.ts");
    assert.match(get, /const operator = await getOperator\(\);\n  if \(!operator\) return errorResponse\("unauthorized", 401\);/);
    assert.doesNotMatch(get, /export async function (POST|PUT|PATCH|DELETE)/);
    const post = read("src/app/api/internal-links/task/route.ts");
    assert.ok(post.indexOf("isSameOrigin(request)") < post.indexOf("getOperator()"));
    assert.match(post, /crawlLimiter\("triage"\)/);
  });

  test("the Suggestions section is on the Internal links tab and records through a confirmation; the editor only fills the form", () => {
    assert.match(read("src/components/technical/technical-seo.tsx"), /<InternalLinkSuggestions projectId=\{projectId\} \/>/);
    const section = read("src/components/technical/internal-link-suggestions.tsx");
    assert.match(section, /<SpendConfirmDialog\s+confirmation=\{taskConfirmation\(dialog, projectId\)\}/);
    const editor = read("src/components/content/suggest-links.tsx");
    assert.doesNotMatch(editor, /method: "POST"|createArticle|saveArticleVersion/);
    assert.match(read("src/components/content/article-panel.tsx"), /<SuggestLinks projectId=\{projectId\} form=\{form\} onAdd=/);
  });
});
