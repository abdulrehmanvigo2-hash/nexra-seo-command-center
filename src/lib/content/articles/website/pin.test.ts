import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";

import { canonicalArticleJson } from "@/lib/content/articles/canonical";
import { completeArticle } from "@/lib/content/articles/test-support/fixtures";
import { validateArticleContent } from "@/lib/content/articles/validate";
import { PUBLISH_TEMPLATE_ID, SITE_FILE_KEYS, SITE_FILE_PATHS, pinSiteAtCommit, type SiteFilesAtCommit } from "@/lib/content/articles/website/pin";
import { renderArticleForPublish, renderArticleWebsite, type PublishRenderInput } from "@/lib/content/articles/website/render";

/**
 * P-L2, PR 4: pin at publish. The site's files are read at `main`'s current commit and checked by structure; the
 * template for that commit carries their hashes; the render is the 6.9b render, with the cross-link optional. The
 * files here are small stand-ins in the real files' shape (nexra-ai at fde0faf), never copies of them.
 */

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const COMMIT = "fde0faf0000000000000000000000000000000ff";
const ARTICLE_ID = "a0000000-0000-4000-8000-000000000009";
const VERSION_ID = "b0000000-0000-4000-8000-000000000009";
const APPROVAL_ID = "e0000000-0000-4000-8000-000000000009";
const FOLLOW_UP_KEYWORDS = ["AI lead follow-up automation", "automated lead follow-up"];

const REGISTRY = [
  'import { site } from "./site";',
  "",
  "export type Article = { slug: string };",
  "",
  "export const articles: Article[] = [",
  "  {",
  '    slug: "ai-lead-follow-up-automation",',
  "  },",
  "  {",
  '    slug: "missed-call-text-back",',
  "  },",
  "];",
  "",
  "export function articleUrl(slug: string): string {",
  "  return `${site.url}/blog/${slug}`;",
  "}",
  "",
  "export function getArticle(slug: string): Article {",
  "  return articles.find((a) => a.slug === slug)!;",
  "}",
  "",
].join("\n");

const COMPONENTS = [
  "export function ArticleJsonLd() {}",
  "export function ArticleHeader() {}",
  "export function ArticleBody() {}",
  "export type ArticleSection = { id: string; title: string };",
  "export function Section() {}",
  "export function H3() {}",
  "export function P() {}",
  "export function A() {}",
  "export function ArticleToc() {}",
  "export function ArticleFaq() {}",
  "export function ArticleCta() {}",
  "",
].join("\n");

const LIVE = [
  "        <Section section={sections.what}>",
  "          <P>",
  "            The AI layer reads what someone actually wrote.",
  "          </P>",
  "        </Section>",
  "",
  "        <Section section={sections.revive}>",
  "          <P>",
  "            A reactivation run will not turn a dead list into a pipeline.",
  "          </P>",
  "        </Section>",
  "",
].join("\n");

function site(change: Partial<Record<(typeof SITE_FILE_KEYS)[number], string>> = {}, commit = COMMIT): SiteFilesAtCommit {
  return {
    commit,
    files: {
      registry: REGISTRY,
      components: COMPONENTS,
      primitives: "export function Meta() {}\n",
      types: "export type FaqItem = { q: string; a: string };\n",
      site: "export const site = { url: 'https://www.nexraagency.com' };\n",
      liveArticle: LIVE,
      ...change,
    },
  };
}

function pin(change: Parameters<typeof site>[0] = {}, keywords: readonly string[] | null = FOLLOW_UP_KEYWORDS) {
  return pinSiteAtCommit({ site: site(change), liveArticleKeywords: keywords, sha256 });
}

function canonical(): string {
  const value = completeArticle();
  Object.assign(value, { slug: "lead-scoring-basics", keywords: ["lead scoring basics"], topicDecision: "different-angle", internalLinks: [], attestations: [] });
  const checked = validateArticleContent(value);
  assert.ok(checked.ok, JSON.stringify(checked));
  return canonicalArticleJson(checked.article);
}

function publishInput(anchor: string | null): PublishRenderInput {
  const result = pin();
  assert.ok(result.ok);
  const text = canonical();
  const contentSha256 = sha256(text);
  return {
    template: result.pin.template,
    version: { articleId: ARTICLE_ID, version: 2, versionId: VERSION_ID, canonicalContent: text, contentSha256 },
    approval: { id: APPROVAL_ID, articleId: ARTICLE_ID, articleVersion: 2, articleVersionId: VERSION_ID, contentSha256 },
    published: "2026-10-06",
    crossLinkAnchor: anchor,
    sources: { registry: REGISTRY, liveArticle: LIVE },
    liveArticles: [{ slug: "ai-lead-follow-up-automation", articleId: null, articleVersion: null, keywords: FOLLOW_UP_KEYWORDS }],
    sha256,
  };
}

describe("pinSiteAtCommit: the structure check", () => {
  test("files in the expected shape give the template for that commit, with each file's hash", () => {
    const result = pin();
    assert.ok(result.ok, JSON.stringify(result));
    const { template, read } = result.pin;
    assert.equal(template.id, PUBLISH_TEMPLATE_ID);
    assert.equal(template.pinnedCommit, COMMIT);
    assert.equal(template.registry.sha256, sha256(REGISTRY));
    assert.equal(template.liveArticle.sha256, sha256(LIVE));
    assert.equal(template.liveArticle.reviveOpen, null);
    assert.deepEqual(template.liveSlugs, ["ai-lead-follow-up-automation", "missed-call-text-back"]);
    assert.deepEqual(template.liveArticle.keywords, FOLLOW_UP_KEYWORDS);
    assert.deepEqual(read.map((file) => file.path), SITE_FILE_KEYS.map((key) => SITE_FILE_PATHS[key]));
    assert.equal(read[0].sha256, sha256(REGISTRY));
  });

  test("each missing piece is refused, naming the file and what is missing", () => {
    const cases: [Parameters<typeof site>[0], string][] = [
      [{ registry: REGISTRY.replace("export const articles: Article[] = [", "export const posts = [") }, "lib/blog.ts: the articles array"],
      [{ registry: REGISTRY.replace(/\n\];\n/, "\n") }, "lib/blog.ts: the end of the articles array"],
      [{ registry: REGISTRY.replace('    slug: "ai-lead-follow-up-automation",', '    slug: "other",') }, "lib/blog.ts: the ai-lead-follow-up-automation record"],
      [{ registry: REGISTRY.replace("export function getArticle(", "function getArticle(") }, "lib/blog.ts: export getArticle"],
      [{ components: COMPONENTS.replace("export function H3() {}", "") }, "components/site/article.tsx: export H3"],
      [{ components: COMPONENTS.replace("export type ArticleSection", "type ArticleSection") }, "components/site/article.tsx: export type ArticleSection"],
      [{ primitives: "export function Label() {}\n" }, "components/ui/primitives.tsx: export Meta"],
      [{ types: "export type Faq = {};\n" }, "lib/types.ts: export type FaqItem"],
      [{ site: "export const config = {};\n" }, "lib/site.ts: export site"],
      [{ liveArticle: "export default function Page() {}\n" }, "app/blog/ai-lead-follow-up-automation/page.tsx: a section"],
    ];
    for (const [change, detail] of cases) {
      const result = pin(change);
      assert.deepEqual(result, { ok: false, refusal: { code: "site-structure-changed", detail } }, detail);
    }
  });

  test("a repeated slug, an empty file, a bad commit or unrecorded follow-up keywords are refused", () => {
    assert.deepEqual(pin({ registry: REGISTRY.replace('    slug: "missed-call-text-back",', '    slug: "ai-lead-follow-up-automation",') }), {
      ok: false,
      refusal: { code: "site-structure-changed", detail: "lib/blog.ts: a repeated slug" },
    });
    assert.deepEqual(pin({ types: "" }), { ok: false, refusal: { code: "unsafe-input", detail: "lib/types.ts" } });
    assert.deepEqual(pinSiteAtCommit({ site: site({}, "main"), liveArticleKeywords: FOLLOW_UP_KEYWORDS, sha256 }), { ok: false, refusal: { code: "unsafe-input", detail: "commit" } });
    assert.deepEqual(pin({}, null), { ok: false, refusal: { code: "live-keywords-unrecorded", detail: "ai-lead-follow-up-automation" } });
    assert.deepEqual(pin({}, []), { ok: false, refusal: { code: "live-keywords-unrecorded", detail: "ai-lead-follow-up-automation" } });
  });
});

describe("renderArticleForPublish: the render a publication writes", () => {
  test("without an anchor: the page and the registry only; the follow-up article is not modified", () => {
    const result = renderArticleForPublish(publishInput(null));
    assert.ok(result.ok, JSON.stringify(result));
    const { render } = result;
    assert.equal(render.crossLink, null);
    assert.deepEqual(render.files.map((file) => [file.path, file.kind]), [
      ["app/blog/lead-scoring-basics/page.tsx", "new-file"],
      ["lib/blog.ts", "modify"],
    ]);
    assert.equal(render.registry.baseSha256, sha256(REGISTRY));
    assert.ok(render.registry.content.includes('    slug: "lead-scoring-basics",'));
    assert.ok(render.page.content.includes(`// Template ${PUBLISH_TEMPLATE_ID} at abdulrehmanvigo2-hash/nexra-ai@${COMMIT}.`));
    for (const file of render.files) assert.equal(file.sha256, sha256(file.content));
  });

  test("with an anchor: the link is placed at its first match in any section of the follow-up article", () => {
    const result = renderArticleForPublish(publishInput("The AI layer reads what someone actually wrote"));
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.render.files.length, 3);
    const link = result.render.crossLink;
    assert.ok(link !== null);
    assert.equal(link.baseSha256, sha256(LIVE));
    assert.ok(link.content.includes('            <A href="/blog/lead-scoring-basics">The AI layer reads what someone actually wrote</A>.'));
    assert.equal(link.content.split("\n").length, LIVE.split("\n").length);
  });

  test("the same bytes as the 6.9b render for the same input; an anchor not found or markup refuses, with no partial output", () => {
    const withAnchor = publishInput("A reactivation run");
    const publish = renderArticleForPublish(withAnchor);
    const classic = renderArticleWebsite({ ...withAnchor, crossLinkAnchor: "A reactivation run" });
    assert.ok(publish.ok && classic.ok);
    assert.equal(publish.render.page.content, classic.render.page.content);
    assert.equal(publish.render.registry.content, classic.render.registry.content);
    assert.equal(publish.render.crossLink?.content, classic.render.crossLink.content);
    assert.deepEqual(renderArticleForPublish(publishInput("Words that are nowhere")), { ok: false, refusal: { code: "cross-link-anchor-not-found", detail: "Words that are nowhere" } });
    assert.deepEqual(renderArticleForPublish(publishInput("<b>x</b>")), { ok: false, refusal: { code: "cross-link-anchor-invalid" } });
  });

  test("a slug live at the commit (read from the registry) refuses", () => {
    const input = publishInput(null);
    const text = input.version.canonicalContent.replace('"slug":"lead-scoring-basics"', '"slug":"missed-call-text-back"');
    const contentSha256 = sha256(text);
    const result = renderArticleForPublish({
      ...input,
      version: { ...input.version, canonicalContent: text, contentSha256 },
      approval: input.approval === null ? null : { ...input.approval, contentSha256 },
    });
    assert.deepEqual(result, { ok: false, refusal: { code: "slug-live", detail: "missed-call-text-back" } });
  });
});
