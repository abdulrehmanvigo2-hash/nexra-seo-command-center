import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";
import ts from "typescript";

import { ATTESTATION_LABELS } from "@/lib/content/articles/attestations";
import { canonicalArticleJson } from "@/lib/content/articles/canonical";
import { completeArticle } from "@/lib/content/articles/test-support/fixtures";
import { validateArticleContent } from "@/lib/content/articles/validate";
import { keywordOverlaps, normalisedKeywords } from "@/lib/content/articles/website/overlap";
import {
  ARTICLE_RENDER_REFUSALS,
  articleWordCount,
  readingTimeFor,
  renderArticleWebsite,
  type ArticleRenderInput,
  type ArticleRenderResult,
} from "@/lib/content/articles/website/render";
import {
  NEXRA_AI_BLOG_TEMPLATE_V2,
  NEXRA_AI_BLOG_TEMPLATE_V3,
  NEXRA_AI_BLOG_TEMPLATE_V3_CROSS_LINK_ANCHOR,
  type ArticleWebsiteTemplate,
} from "@/lib/content/articles/website/template";
import { NEXRA_AI_BLOG_TEMPLATE } from "@/lib/content/publications/website/template";
import type { ValidatedArticleContent } from "@/types/content-article";

/**
 * Phase 6, checkpoint 6.9b: the full article renderer — an approved article
 * version and its approval become the new route file, the registry with one
 * record appended, and the live article with one cross-link (decisions
 * D1–D7). Offline and pure apart from the hashes; the files it modifies are
 * small stand-ins here, pinned by their own hashes, and the real files at
 * nexra-ai 1a688bd are exercised by the checkpoint's build proof.
 */

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

const ARTICLE_ID = "a0000000-0000-4000-8000-000000000001";
const VERSION_ID = "b0000000-0000-4000-8000-000000000003";
const APPROVAL_ID = "e0000000-0000-4000-8000-000000000001";

const REGISTRY = [
  'import { site } from "./site";',
  "",
  "export const articles: Article[] = [",
  "  {",
  '    slug: "ai-lead-follow-up-automation",',
  "  },",
  "];",
  "",
  "export function articleHref(slug: string): string {",
  "  return `/blog/${slug}`;",
  "}",
  "",
].join("\n");

const LIVE = [
  "        <Section section={sections.lost}>",
  "          <P>",
  "            A reactivation run outside the revive section.",
  "          </P>",
  "        </Section>",
  "",
  "        <Section section={sections.revive}>",
  "          <P>",
  "            It can, with honest expectations. A reactivation run will not turn a",
  "            dead list into a full pipeline.",
  "          </P>",
  "          <H3>1. Clean and segment the list first</H3>",
  '          <Callout label="Example scenario" title="Reviving a year of untouched leads">',
  "            <p>",
  "              A home-services company has leads sitting untouched.",
  "            </p>",
  "          </Callout>",
  "        </Section>",
  "",
].join("\n");

/** The pinned template with the two stand-in files' hashes. */
const TEMPLATE: ArticleWebsiteTemplate = {
  ...NEXRA_AI_BLOG_TEMPLATE_V2,
  registry: { ...NEXRA_AI_BLOG_TEMPLATE_V2.registry, sha256: sha256(REGISTRY) },
  liveArticle: { ...NEXRA_AI_BLOG_TEMPLATE_V2.liveArticle, sha256: sha256(LIVE) },
};

/** A format 2 article: an introduction, two H2 sections, one H3, one attested paragraph, two links and an FAQ. */
function raw(change: (value: Record<string, unknown>) => void = () => {}): Record<string, unknown> {
  const value = completeArticle();
  Object.assign(value, {
    topic: "AI-driven reactivation of dormant leads",
    searchIntent: "informational",
    slug: "ai-dead-lead-reactivation",
    title: "How an AI Agent Re-Engages Dormant Leads",
    metaTitle: "AI Lead Reactivation: How an Agent Re-Engages Dormant Leads",
    metaDescription: "How an AI agent re-engages dormant leads: the workflow, and where a person approves.",
    excerpt: "The workflow an AI agent follows to re-engage dormant leads, with a person approving each step.",
    category: "Lead Automation",
    keywords: ["AI lead reactivation", "AI agent lead re-engagement"],
    lead: "Dormant leads are rarely dead. They are waiting for a relevant reason to reply.",
    introduction: ["This guide explains the workflow step by step."],
    sections: [
      {
        id: "how-the-agent-works",
        heading: "How the Agent Re-Engages a Dormant Lead",
        paragraphs: ["The agent reads the original enquiry before it writes anything.", "Clients tell us the first message matters more than any later one."],
        subsections: [{ id: "approval-gates", heading: "Where a Person Approves", paragraphs: ["A person approves every message before the agent sends it."] }],
      },
      { id: "what-to-measure", heading: "What to Measure", paragraphs: ["Track replies, bookings and opt-outs for each segment."], subsections: [] },
    ],
    faqs: [{ question: "Does a person stay in control?", answer: "Yes. Every message waits for approval." }],
    internalLinks: [
      { path: "/#process", anchorText: "original enquiry", sectionId: "how-the-agent-works" },
      { path: "/about", anchorText: "approves every message", sectionId: "approval-gates" },
    ],
    ctaTitle: "Plan your reactivation run",
    ctaBody: "Tell us what is in your CRM and we will map the workflow.",
    topicDecision: "different-angle",
    attestations: [{ locator: "how-the-agent-works/1", basis: "experience" }],
  });
  change(value);
  return value;
}

function valid(value: Record<string, unknown>): ValidatedArticleContent {
  const checked = validateArticleContent(value);
  assert.ok(checked.ok, JSON.stringify(checked));
  return checked.article;
}

function input(canonical: string, overrides: Partial<ArticleRenderInput> = {}): ArticleRenderInput {
  const contentSha256 = sha256(canonical);
  return {
    template: TEMPLATE,
    version: { articleId: ARTICLE_ID, version: 3, versionId: VERSION_ID, canonicalContent: canonical, contentSha256 },
    approval: { id: APPROVAL_ID, articleId: ARTICLE_ID, articleVersion: 3, articleVersionId: VERSION_ID, contentSha256 },
    published: "2026-10-05",
    crossLinkAnchor: "reactivation run",
    sources: { registry: REGISTRY, liveArticle: LIVE },
    // The records as they stood at the 6.9b build proof: only the pinned template slug was live (fix F9 tests the rest).
    liveArticles: [{ slug: "ai-lead-follow-up-automation", articleId: null, articleVersion: null, keywords: null }],
    sha256,
    ...overrides,
  };
}

function render(value = raw(), overrides: Partial<ArticleRenderInput> = {}) {
  const result = renderArticleWebsite(input(canonicalArticleJson(valid(value)), overrides));
  assert.ok(result.ok, JSON.stringify(result));
  return result.render;
}

function refusal(result: ArticleRenderResult) {
  assert.equal(result.ok, false, "refused");
  assert.deepEqual(Object.keys(result).sort(), ["ok", "refusal"], "no partial output");
  return result.ok ? null : result.refusal;
}

function refused(value: Record<string, unknown>, overrides: Partial<ArticleRenderInput> = {}) {
  return refusal(renderArticleWebsite(input(canonicalArticleJson(valid(value)), overrides)));
}

/** Syntax errors of a TSX or TS source. */
function syntaxErrors(source: string, tsx: boolean): string[] {
  const output = ts.transpileModule(source, {
    reportDiagnostics: true,
    fileName: tsx ? "page.tsx" : "blog.ts",
    compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  return (output.diagnostics ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}

/** Every comment in a TSX source, found from the parsed tree (a bare scanner mis-reads template literals). */
function comments(source: string): string[] {
  const file = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const found = new Map<number, string>();
  const visit = (node: ts.Node) => {
    for (const range of [...(ts.getLeadingCommentRanges(source, node.getFullStart()) ?? []), ...(ts.getTrailingCommentRanges(source, node.getEnd()) ?? [])]) {
      found.set(range.pos, source.slice(range.pos, range.end));
    }
    node.getChildren(file).forEach(visit);
  };
  visit(file);
  return [...found.entries()].sort((x, y) => x[0] - y[0]).map(([, text]) => text);
}

/** Every string literal's value, every JSX text run and every identifier in a TSX source. */
function tokens(source: string) {
  const file = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const strings: string[] = [];
  const jsxText: string[] = [];
  const identifiers = new Set<string>();
  const walk = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) strings.push(node.text);
    if (ts.isJsxText(node) && node.text.trim() !== "") jsxText.push(node.text.trim());
    if (ts.isIdentifier(node)) identifiers.add(node.text);
    ts.forEachChild(node, walk);
  };
  walk(file);
  return { strings, jsxText, identifiers };
}

describe("the pinned template (D1)", () => {
  test("nexra-ai-blog-tsx/2 at 1a688bd, the files it modifies pinned by hash; the draft dry-run's /1 at a4a5722 is unchanged", () => {
    assert.equal(NEXRA_AI_BLOG_TEMPLATE_V2.id, "nexra-ai-blog-tsx/2");
    assert.equal(NEXRA_AI_BLOG_TEMPLATE_V2.pinnedCommit, "1a688bdcb0839ef3a25a41debc982a17e4217fa3");
    assert.equal(NEXRA_AI_BLOG_TEMPLATE_V2.registry.sha256, "c4af6f5c6ae4a1256609ac522bad6635d6960eb2b06c12ca21bbcacccb47667a");
    assert.equal(NEXRA_AI_BLOG_TEMPLATE_V2.liveArticle.sha256, "c2f2da23a410d84ed7accafb1426bc8bca915119688e65a85300efdfdf25f465");
    assert.equal(NEXRA_AI_BLOG_TEMPLATE_V2.components.sha256, "beb543a0ce5cc4608812ad221efcebc8216afb48b266df5b620abee6b46d72da");
    assert.equal(NEXRA_AI_BLOG_TEMPLATE.id, "nexra-ai-blog-tsx/1");
    assert.equal(NEXRA_AI_BLOG_TEMPLATE.pinnedCommit, "a4a572296eca5944dc29a436048a6fff68c33d5d");
  });
});

describe("the three files", () => {
  test("a) the route file: metadata, H2 ids and the table of contents, H3 without ids, the FAQ, links and the attested label", () => {
    const { page } = render();
    assert.equal(page.path, "app/blog/ai-dead-lead-reactivation/page.tsx");
    assert.equal(page.kind, "new-file");
    assert.deepEqual(syntaxErrors(page.content, true), []);
    const c = page.content;
    assert.ok(c.includes('const article = getArticle("ai-dead-lead-reactivation");'));
    assert.ok(c.includes("alternates: { canonical: `/blog/${article.slug}` },"));
    assert.ok(c.includes('const section1: ArticleSection = { id: "how-the-agent-works", title: "How the Agent Re-Engages a Dormant Lead" };'));
    assert.ok(c.includes("const sections: ArticleSection[] = [section1, section2, faqSection];"));
    assert.ok(c.includes("<Section section={section2}>"));
    assert.ok(!/sections\[\d/.test(c), "no indexed access: the site compiles with noUncheckedIndexedAccess");
    assert.ok(c.includes("<ArticleToc sections={sections} />"));
    assert.ok(c.includes('<H3>{"Where a Person Approves"}</H3>'), "an H3 carries no id");
    assert.ok(!/<H3 [^>]*id=/.test(c));
    assert.ok(c.includes('    q: "Does a person stay in control?",'));
    assert.ok(c.includes("<ArticleJsonLd article={article} faqs={faqs} />"));
    assert.ok(c.includes("<ArticleFaq section={faqSection} items={faqs} />"));
    assert.ok(c.includes('<A href={"/#process"}>{"original enquiry"}</A>'));
    assert.ok(c.includes('<A href={"/about"}>{"approves every message"}</A>'));
    assert.ok(c.includes(`<Meta className="text-accent-300">{"${ATTESTATION_LABELS.experience}"}</Meta>`));
    assert.ok(c.includes('import { Meta } from "@/components/ui/primitives";'));
    assert.ok(c.includes('<ArticleCta title={"Plan your reactivation run"} body={"Tell us what is in your CRM and we will map the workflow."} />'));
    assert.ok(!c.includes("modifiedTime"), "no updated date");
  });

  test("imports are exactly what the page uses: no link, H3, FAQ or attestation, no import for it", () => {
    const { page } = render(
      raw((v) => {
        v.internalLinks = [];
        v.faqs = [];
        v.attestations = [];
        (v.sections as { subsections: unknown[] }[])[0].subsections = [];
      }),
    );
    for (const name of ["  A,", "  ArticleFaq,", "  H3,", "<Meta", "{ Meta }", "FaqItem", "faqSection"]) assert.ok(!page.content.includes(name), name);
    assert.ok(page.content.includes("const sections: ArticleSection[] = [section1, section2];"));
    assert.deepEqual(syntaxErrors(page.content, true), []);
  });

  test("b) the registry: one record appended before the array closes, every field, readingTime ceil(words/200), the approval's date, no updated", () => {
    const rendered = render();
    const { registry } = rendered;
    assert.equal(registry.path, "lib/blog.ts");
    assert.equal(registry.kind, "modify");
    assert.equal(registry.baseSha256, TEMPLATE.registry.sha256);
    assert.deepEqual(syntaxErrors(registry.content, false), []);
    const record = [
      "  {",
      '    slug: "ai-dead-lead-reactivation",',
      '    title: "How an AI Agent Re-Engages Dormant Leads",',
      '    metaTitle: "AI Lead Reactivation: How an Agent Re-Engages Dormant Leads",',
      '    description: "How an AI agent re-engages dormant leads: the workflow, and where a person approves.",',
      '    excerpt: "The workflow an AI agent follows to re-engage dormant leads, with a person approving each step.",',
      '    category: "Lead Automation",',
      '    published: "2026-10-05",',
      '    readingTime: "1 min read",',
      "    keywords: [",
      '      "AI lead reactivation",',
      '      "AI agent lead re-engagement",',
      "    ],",
      "  },",
      "];",
    ].join("\n");
    assert.equal(registry.content, REGISTRY.replace("  },\n];", `  },\n${record}`), "only the record was added, before the array closes");
    assert.ok(!registry.content.includes("updated"));
  });

  test("c) the cross-link: one link in the revive section at the first exact match, nothing else changed", () => {
    const { crossLink } = render();
    assert.equal(crossLink.path, "app/blog/ai-lead-follow-up-automation/page.tsx");
    assert.equal(crossLink.baseSha256, TEMPLATE.liveArticle.sha256);
    const before = LIVE.split("\n");
    const after = crossLink.content.split("\n");
    assert.equal(after.length, before.length);
    const changed = after.map((line, i) => (line === before[i] ? -1 : i)).filter((i) => i >= 0);
    assert.deepEqual(changed, [8], "only the revive section's first match; the same words earlier in the file are untouched");
    assert.equal(after[8], '            It can, with honest expectations. A <A href="/blog/ai-dead-lead-reactivation">reactivation run</A> will not turn a');
  });

  test("deterministic: the same input gives the same bytes, and each hash is of its content", () => {
    const first = render();
    const second = render();
    assert.deepEqual(first, second);
    for (const file of [first.page, first.registry, first.crossLink]) assert.equal(file.sha256, sha256(file.content));
    assert.deepEqual(first.keywordPhrases, ["ai lead reactivation", "ai agent lead re engagement"]);
  });

  test("readingTime (D2): the words of the lead, introduction, paragraphs, H3s and FAQ answers; at least one minute", () => {
    const article = valid(raw());
    // lead 15, intro 7, paragraphs 10 + 11 + 11 + 8, H3 4, FAQ answer 6.
    assert.equal(articleWordCount(article), 72);
    assert.equal(readingTimeFor(0), "1 min read");
    assert.equal(readingTimeFor(200), "1 min read");
    assert.equal(readingTimeFor(201), "2 min read");
    assert.equal(readingTimeFor(3150), "16 min read");
  });
});

describe("safety: hostile text stays inert", () => {
  const HOSTILE = 'Quote " back ` tick ${process.env.SECRET} {curly} </P><script>alert(1)</script> & \\ slash */ // end';

  test("every hostile string is one string literal decoding to itself; no JSX text, markup or identifier comes from content", () => {
    const rendered = render(
      raw((v) => {
        v.title = HOSTILE;
        v.lead = HOSTILE;
        v.ctaTitle = HOSTILE;
        v.ctaBody = HOSTILE;
        v.faqs = [{ question: HOSTILE, answer: HOSTILE }];
        (v.sections as { heading: string; paragraphs: string[] }[])[1].heading = HOSTILE;
        (v.sections as { heading: string; paragraphs: string[] }[])[1].paragraphs = [`Before ${HOSTILE} after.`];
        v.internalLinks = [
          ...(v.internalLinks as unknown[]),
          { path: "/contact", anchorText: HOSTILE, sectionId: "what-to-measure" },
        ];
      }),
    );
    const { page, registry } = rendered;
    assert.deepEqual(syntaxErrors(page.content, true), []);
    assert.deepEqual(syntaxErrors(registry.content, false), []);
    const { strings, jsxText, identifiers } = tokens(page.content);
    assert.ok(strings.filter((s) => s === HOSTILE).length >= 6, "title-free literals: lead, CTA title and body, FAQ q and a, heading, link text");
    assert.ok(strings.includes("Before "));
    assert.ok(strings.includes(" after."));
    assert.deepEqual(jsxText, [], "no JSX text: every text is an expression holding a literal");
    for (const name of ["script", "alert", "process", "SECRET"]) assert.ok(!identifiers.has(name), name);
    assert.ok(!page.content.includes("<script"), "no markup from content appears literally");
    assert.equal(comments(page.content).length, 4, "the only comments are the four header lines: content never opens or closes one");
    assert.ok(!registry.content.includes("<script"));
    const registryStrings = tokens(registry.content).strings;
    assert.ok(registryStrings.includes(HOSTILE), "the title in the record decodes to itself");
  });
});

describe("refusals: typed, and never a partial file", () => {
  test("the codes", () => {
    assert.deepEqual([...ARTICLE_RENDER_REFUSALS], [
      "approval-missing",
      "approval-mismatch",
      "content-hash-mismatch",
      "content-unreadable",
      "missing-field",
      "invalid-content",
      "content-not-canonical",
      "topic-decision",
      "slug-live",
      "published-invalid",
      "section-id-reserved",
      "keyword-overlap",
      "live-keywords-unrecorded",
      "link-to-subsection",
      "link-anchor-not-found",
      "link-overlap",
      "registry-changed",
      "live-article-changed",
      "cross-link-anchor-invalid",
      "cross-link-anchor-not-found",
      "unsafe-input",
    ]);
  });

  test("each missing required field is named", () => {
    const fields = ["topic", "searchIntent", "slug", "title", "metaTitle", "metaDescription", "excerpt", "category", "keywords", "lead", "sections", "ctaTitle", "ctaBody", "topicDecision"];
    for (const field of fields) {
      const value = raw();
      delete value[field];
      const text = JSON.stringify({ format: "nexra-article-content/2", ...value });
      assert.deepEqual(refusal(renderArticleWebsite(input(text))), { code: "missing-field", detail: field }, field);
    }
    const empty = JSON.stringify({ format: "nexra-article-content/2", ...raw((v) => (v.keywords = [])) });
    assert.deepEqual(refusal(renderArticleWebsite(input(empty))), { code: "missing-field", detail: "keywords" });
  });

  test("the approval and the stored text", () => {
    const text = canonicalArticleJson(valid(raw()));
    assert.deepEqual(refusal(renderArticleWebsite(input(text, { approval: null }))), { code: "approval-missing" });
    const base = input(text);
    for (const approval of [
      { ...base.approval!, articleVersion: 2 },
      { ...base.approval!, articleVersionId: "b0000000-0000-4000-8000-000000000002" },
      { ...base.approval!, articleId: "a0000000-0000-4000-8000-000000000002" },
      { ...base.approval!, contentSha256: "0".repeat(64) },
    ]) {
      assert.deepEqual(refusal(renderArticleWebsite({ ...base, approval })), { code: "approval-mismatch" });
    }
    assert.deepEqual(refusal(renderArticleWebsite({ ...base, version: { ...base.version, canonicalContent: `${text} ` } })), { code: "content-hash-mismatch" });
    assert.deepEqual(refusal(renderArticleWebsite(input("not json"))), { code: "content-unreadable" });
    assert.deepEqual(refusal(renderArticleWebsite(input(JSON.stringify({ format: "other", ...raw() })))), { code: "content-unreadable", detail: "format" });
    assert.equal(refusal(renderArticleWebsite(input(JSON.stringify({ format: "nexra-article-content/2", ...raw((v) => (v.keywords = ["a", "a"])) }))))?.code, "invalid-content");
    const reordered = JSON.stringify({ format: "nexra-article-content/2", ...Object.fromEntries(Object.entries(valid(raw())).reverse()) });
    assert.deepEqual(refusal(renderArticleWebsite(input(reordered))), { code: "content-not-canonical" });
  });

  test("the article: topic decision, live slug, date, reserved section id", () => {
    assert.deepEqual(refused(raw((v) => (v.topicDecision = "update-existing"))), { code: "topic-decision", detail: "update-existing" });
    assert.deepEqual(refused(raw((v) => (v.slug = "ai-lead-follow-up-automation"))), { code: "slug-live", detail: "ai-lead-follow-up-automation" });
    for (const published of ["2026-02-30", "2026-9-28", "28 Sep 2026", ""]) {
      assert.deepEqual(refused(raw(), { published }), { code: "published-invalid" }, published);
    }
    assert.deepEqual(
      refused(
        raw((v) => {
          (v.sections as { id: string }[])[1].id = "faq";
          v.internalLinks = [];
        }),
      ),
      { code: "section-id-reserved", detail: "faq" },
    );
  });

  test("links: the anchor must be in its section (D4), a link to an H3 anchor is refused (D5), overlapping links are refused", () => {
    const withLinks = (links: unknown[]) => raw((v) => (v.internalLinks = links));
    assert.deepEqual(refused(withLinks([{ path: "/about", anchorText: "Track replies", sectionId: "how-the-agent-works" }])), {
      code: "link-anchor-not-found",
      detail: "Track replies",
    });
    assert.deepEqual(refused(withLinks([{ path: "/about", anchorText: "original enquiry", sectionId: "approval-gates" }])), {
      code: "link-anchor-not-found",
      detail: "original enquiry",
    }, "an H3's links look in that H3 only");
    assert.deepEqual(refused(withLinks([{ path: "/about", anchorText: "Original Enquiry", sectionId: "how-the-agent-works" }])), {
      code: "link-anchor-not-found",
      detail: "Original Enquiry",
    }, "exact, case included");
    assert.deepEqual(refused(withLinks([{ path: "/blog/ai-dead-lead-reactivation#approval-gates", anchorText: "Track replies", sectionId: "what-to-measure" }])), {
      code: "link-to-subsection",
      detail: "/blog/ai-dead-lead-reactivation#approval-gates",
    });
    assert.deepEqual(
      refused(
        withLinks([
          { path: "/about", anchorText: "original enquiry", sectionId: "how-the-agent-works" },
          { path: "/contact", anchorText: "enquiry before", sectionId: "how-the-agent-works" },
        ]),
      ),
      { code: "link-overlap", detail: "enquiry before" },
    );
    // An H2 fragment is fine, and an H2 link finds its anchor in the H3 paragraphs after its own.
    const ok = render(withLinks([{ path: "/blog/ai-dead-lead-reactivation#what-to-measure", anchorText: "sends it", sectionId: "how-the-agent-works" }]));
    assert.ok(ok.page.content.includes('<A href={"/blog/ai-dead-lead-reactivation#what-to-measure"}>{"sends it"}</A>'));
  });

  test("the modified files must be the pinned ones, and the cross-link anchor must be plain text found in the revive section", () => {
    assert.deepEqual(refused(raw(), { sources: { registry: `${REGISTRY}\n`, liveArticle: LIVE } }), { code: "registry-changed", detail: "lib/blog.ts" });
    assert.deepEqual(refused(raw(), { sources: { registry: REGISTRY, liveArticle: `${LIVE} ` } }), {
      code: "live-article-changed",
      detail: "app/blog/ai-lead-follow-up-automation/page.tsx",
    });
    for (const anchor of ["", " reactivation run", "reactivation run ", "<b>run</b>", "run {x}", 'run "x"', "a", "x".repeat(121)]) {
      assert.deepEqual(refused(raw(), { crossLinkAnchor: anchor }), { code: "cross-link-anchor-invalid" }, anchor);
    }
    for (const anchor of ["full pipeline dead", "Clean and segment", "home-services company", "Reviving a year"]) {
      assert.deepEqual(refused(raw(), { crossLinkAnchor: anchor }), { code: "cross-link-anchor-not-found", detail: anchor }, `${anchor}: not on one text line of a P in the revive section`);
    }
  });

  test("keyword overlap with the live article is refused (D7)", () => {
    assert.deepEqual(refused(raw((v) => (v.keywords = ["AI lead reactivation", "Dead-lead follow up"]))), {
      code: "keyword-overlap",
      detail: "Dead-lead follow up repeats dead lead follow-up (/ai-lead-follow-up-automation)",
    });
  });
});

describe("live articles from the records (fix F9, audit A5-01)", () => {
  const PINNED = { slug: "ai-lead-follow-up-automation", articleId: null, articleVersion: null, keywords: null };
  const PUBLISHED = { slug: "ai-dead-lead-reactivation", articleId: "1003104c-6b25-456f-9304-eefa2ba88e7d", articleVersion: 6, keywords: ["AI dead lead reactivation", "revive old CRM leads"] };
  const third = () => raw((v) => {
    v.slug = "missed-call-text-back";
    v.keywords = ["missed call text back"];
  });

  test("a slug the records list as live is refused, though the pinned template does not list it", () => {
    assert.deepEqual(refused(raw(), { liveArticles: [PINNED, PUBLISHED] }), { code: "slug-live", detail: "ai-dead-lead-reactivation" });
  });

  test("a third article is checked against every live article's recorded keywords, not only the template's", () => {
    assert.ok(renderArticleWebsite(input(canonicalArticleJson(valid(third())), { liveArticles: [PINNED, PUBLISHED] })).ok);
    const repeat = raw((v) => {
      v.slug = "missed-call-text-back";
      v.keywords = ["missed call text back", "Revive old CRM leads"];
    });
    assert.deepEqual(refused(repeat, { liveArticles: [PINNED, PUBLISHED] }), {
      code: "keyword-overlap",
      detail: "Revive old CRM leads repeats revive old CRM leads (/ai-dead-lead-reactivation)",
    });
  });

  test("a live article the records name without keywords refuses: nothing is checked against an unknown set", () => {
    assert.deepEqual(refused(third(), { liveArticles: [PINNED, { ...PUBLISHED, articleVersion: null, keywords: null }] }), {
      code: "live-keywords-unrecorded",
      detail: "ai-dead-lead-reactivation",
    });
  });

  test("the article's own live record is not a set it must avoid", () => {
    const own = { ...PUBLISHED, slug: "an-earlier-slug", articleId: ARTICLE_ID, keywords: ["missed call text back"] };
    assert.ok(renderArticleWebsite(input(canonicalArticleJson(valid(third())), { liveArticles: [PINNED, own] })).ok);
  });
});

describe("the keyword overlap check (D7)", () => {
  const live = NEXRA_AI_BLOG_TEMPLATE_V2.liveArticle.keywords;

  test("the live set holds the live record's ten keywords, PR #8's two included", () => {
    assert.equal(live.length, 10);
    assert.ok(live.includes("reactivate old CRM leads"));
    assert.ok(live.includes("dead lead follow-up"));
  });

  test("a repeat, a respelling or a phrase holding a live keyword overlaps; the new article's own keywords do not", () => {
    assert.deepEqual(keywordOverlaps(["reactivate old CRM leads", "dead lead follow-up"], live), [
      { keyword: "reactivate old CRM leads", liveKeyword: "reactivate old CRM leads" },
      { keyword: "dead lead follow-up", liveKeyword: "dead lead follow-up" },
    ]);
    assert.equal(keywordOverlaps(["Reactivate Old CRM Leads!"], live).length, 1);
    assert.equal(keywordOverlaps(["dead lead follow-up checklist"], live).length, 1, "holds a live keyword");
    assert.equal(keywordOverlaps(["lead follow-up"], live).length, 1, "held by a live keyword");
    assert.deepEqual(keywordOverlaps(["AI lead reactivation", "AI agent lead re-engagement", "dormant lead workflow"], live), []);
    assert.deepEqual(normalisedKeywords(["AI lead reactivation", "ai-lead reactivation", "AI agent lead re-engagement"]), ["ai lead reactivation", "ai agent lead re engagement"]);
  });
});

/**
 * Runbook §7, step 2: the template re-pinned for the second rendered article,
 * `nexra-ai-blog-tsx/3` at `356f38f`. Its cross-link lives in the follow-up
 * article's "what it does" section, not the revive section; the stand-in
 * below holds both sections, with the anchor words in each, so the test can
 * show the link lands in the "what" section only.
 */
describe("the re-pinned template /3 at 356f38f (runbook §7, step 2)", () => {
  const WHAT_OPEN = "        <Section section={sections.what}>";
  const ANCHOR_LINE = "            together. The AI layer reads what someone actually wrote — in their own";
  const LIVE3 = [
    "        <Section section={sections.lost}>",
    "          <P>",
    "            The AI layer reads what someone actually wrote, said earlier.",
    "          </P>",
    "        </Section>",
    "",
    WHAT_OPEN,
    "          <P>",
    "            &ldquo;AI lead follow-up automation&rdquo; describes two things working",
    ANCHOR_LINE,
    "            words, with typos, across a conversation — and decides what to say or",
    "          </P>",
    "        </Section>",
    "",
    "        <Section section={sections.revive}>",
    "          <P>",
    "            It can, with honest expectations. A reactivation run will not turn a",
    "          </P>",
    "        </Section>",
    "",
  ].join("\n");
  const REGISTRY3 = REGISTRY.replace('    slug: "ai-lead-follow-up-automation",\n  },', '    slug: "ai-lead-follow-up-automation",\n  },\n  {\n    slug: "ai-dead-lead-reactivation",\n  },');
  const TEMPLATE3: ArticleWebsiteTemplate = {
    ...NEXRA_AI_BLOG_TEMPLATE_V3,
    registry: { ...NEXRA_AI_BLOG_TEMPLATE_V3.registry, sha256: sha256(REGISTRY3) },
    liveArticle: { ...NEXRA_AI_BLOG_TEMPLATE_V3.liveArticle, sha256: sha256(LIVE3) },
  };
  const LIVE_RECORDS = [
    { slug: "ai-lead-follow-up-automation", articleId: null, articleVersion: null, keywords: null },
    { slug: "ai-dead-lead-reactivation", articleId: "1003104c-6b25-456f-9304-eefa2ba88e7d", articleVersion: 6, keywords: ["AI dead lead reactivation", "AI lead reactivation", "reactivate cold leads with AI", "AI agent lead re-engagement"] },
  ];
  const sdr = (change: (value: Record<string, unknown>) => void = () => {}) =>
    raw((value) => {
      Object.assign(value, { slug: "ai-sdr-tool", keywords: ["AI SDR tool", "best AI SDR tools"] });
      change(value);
    });
  const v3 = (overrides: Partial<ArticleRenderInput> = {}): Partial<ArticleRenderInput> => ({
    template: TEMPLATE3,
    sources: { registry: REGISTRY3, liveArticle: LIVE3 },
    liveArticles: LIVE_RECORDS,
    crossLinkAnchor: NEXRA_AI_BLOG_TEMPLATE_V3_CROSS_LINK_ANCHOR,
    ...overrides,
  });

  test("the pin: id, commit, the three files' hashes, both live slugs, the cross-link section; everything else as /2", () => {
    assert.equal(NEXRA_AI_BLOG_TEMPLATE_V3.id, "nexra-ai-blog-tsx/3");
    assert.equal(NEXRA_AI_BLOG_TEMPLATE_V3.pinnedCommit, "356f38f8bbff4928e704d67799e08b65b3ed94f4");
    assert.equal(NEXRA_AI_BLOG_TEMPLATE_V3.registry.sha256, "d6f1c74ce38bf035f18d2d26b6b446d340106362248438732083658481834c52");
    assert.equal(NEXRA_AI_BLOG_TEMPLATE_V3.liveArticle.sha256, "1ca570239f134f7b4c56b012974b51752d160f127ac32c3e5d7ba7242193ffd9");
    assert.equal(NEXRA_AI_BLOG_TEMPLATE_V3.components.sha256, NEXRA_AI_BLOG_TEMPLATE_V2.components.sha256, "the component file is byte-identical");
    assert.deepEqual(NEXRA_AI_BLOG_TEMPLATE_V3.liveSlugs, ["ai-lead-follow-up-automation", "ai-dead-lead-reactivation"]);
    assert.equal(NEXRA_AI_BLOG_TEMPLATE_V3.liveArticle.reviveOpen, WHAT_OPEN);
    assert.equal(NEXRA_AI_BLOG_TEMPLATE_V3.liveArticle.slug, "ai-lead-follow-up-automation");
    assert.equal(NEXRA_AI_BLOG_TEMPLATE_V3.liveArticle.path, NEXRA_AI_BLOG_TEMPLATE_V2.liveArticle.path);
    assert.deepEqual(NEXRA_AI_BLOG_TEMPLATE_V3.liveArticle.keywords, NEXRA_AI_BLOG_TEMPLATE_V2.liveArticle.keywords);
    for (const key of ["repository", "defaultBranch", "pagePathTemplate", "routeTemplate", "reservedSectionIds"] as const) {
      assert.deepEqual(NEXRA_AI_BLOG_TEMPLATE_V3[key], NEXRA_AI_BLOG_TEMPLATE_V2[key], key);
    }
    assert.deepEqual(NEXRA_AI_BLOG_TEMPLATE_V3.registry, { ...NEXRA_AI_BLOG_TEMPLATE_V2.registry, sha256: NEXRA_AI_BLOG_TEMPLATE_V3.registry.sha256 });
    assert.ok(ANCHOR_LINE.includes(NEXRA_AI_BLOG_TEMPLATE_V3_CROSS_LINK_ANCHOR));
  });

  test("/2 is untouched: its id, commit, hashes, one live slug and revive section are what 6.9b recorded", () => {
    assert.equal(NEXRA_AI_BLOG_TEMPLATE_V2.id, "nexra-ai-blog-tsx/2");
    assert.equal(NEXRA_AI_BLOG_TEMPLATE_V2.pinnedCommit, "1a688bdcb0839ef3a25a41debc982a17e4217fa3");
    assert.equal(NEXRA_AI_BLOG_TEMPLATE_V2.registry.sha256, "c4af6f5c6ae4a1256609ac522bad6635d6960eb2b06c12ca21bbcacccb47667a");
    assert.equal(NEXRA_AI_BLOG_TEMPLATE_V2.liveArticle.sha256, "c2f2da23a410d84ed7accafb1426bc8bca915119688e65a85300efdfdf25f465");
    assert.equal(NEXRA_AI_BLOG_TEMPLATE_V2.liveArticle.reviveOpen, "        <Section section={sections.revive}>");
    assert.deepEqual(NEXRA_AI_BLOG_TEMPLATE_V2.liveSlugs, ["ai-lead-follow-up-automation"]);
  });

  test("renders under /3: the record appended after two, and one link in the what section at the anchor, not in the lost section", () => {
    const result = renderArticleWebsite(input(canonicalArticleJson(valid(sdr())), v3()));
    assert.ok(result.ok, JSON.stringify(result));
    const { render: out } = result;
    assert.equal(out.templateId, "nexra-ai-blog-tsx/3");
    assert.equal(out.pinnedCommit, "356f38f8bbff4928e704d67799e08b65b3ed94f4");
    assert.equal(out.route, "/blog/ai-sdr-tool");
    assert.equal(out.page.path, "app/blog/ai-sdr-tool/page.tsx");
    assert.equal(out.registry.baseSha256, TEMPLATE3.registry.sha256);
    assert.ok(out.registry.content.includes('slug: "ai-dead-lead-reactivation"'), "the second live record stays");
    assert.ok(out.registry.content.indexOf('slug: "ai-sdr-tool"') > out.registry.content.indexOf('slug: "ai-dead-lead-reactivation"'), "appended after both");
    assert.equal(out.crossLink.baseSha256, TEMPLATE3.liveArticle.sha256);
    const before = LIVE3.split("\n");
    const after = out.crossLink.content.split("\n");
    assert.equal(after.length, before.length);
    const changed = after.map((line, i) => (line === before[i] ? -1 : i)).filter((i) => i >= 0);
    assert.deepEqual(changed, [9], "only the what section's anchor line; the same words in the lost section are untouched");
    assert.equal(after[9], '            together. <A href="/blog/ai-sdr-tool">The AI layer reads what someone actually wrote</A> — in their own');
  });

  test("under /3 the registry and the live article must be the 356f38f files, and the anchor must sit in the what section", () => {
    assert.deepEqual(refused(sdr(), v3({ sources: { registry: REGISTRY, liveArticle: LIVE3 } })), { code: "registry-changed", detail: "lib/blog.ts" }, "the 1a688bd registry is refused");
    assert.deepEqual(refused(sdr(), v3({ sources: { registry: REGISTRY3, liveArticle: LIVE } })), {
      code: "live-article-changed",
      detail: "app/blog/ai-lead-follow-up-automation/page.tsx",
    });
    assert.deepEqual(refused(sdr(), v3({ sources: { registry: REGISTRY3, liveArticle: `${LIVE3} ` } })), {
      code: "live-article-changed",
      detail: "app/blog/ai-lead-follow-up-automation/page.tsx",
    });
    assert.deepEqual(refused(sdr(), v3({ crossLinkAnchor: "reactivation run" })), { code: "cross-link-anchor-not-found", detail: "reactivation run" }, "the revive section is not searched under /3");
  });

  test("under /3 both live slugs are refused, and the dead-lead article's recorded keywords join the overlap check", () => {
    assert.deepEqual(refused(sdr((v) => Object.assign(v, { slug: "ai-dead-lead-reactivation" })), v3()), { code: "slug-live", detail: "ai-dead-lead-reactivation" });
    assert.deepEqual(refused(sdr((v) => Object.assign(v, { slug: "ai-lead-follow-up-automation" })), v3()), { code: "slug-live", detail: "ai-lead-follow-up-automation" });
    assert.deepEqual(refused(sdr((v) => Object.assign(v, { keywords: ["AI SDR tool", "AI lead qualification"] })), v3()), {
      code: "keyword-overlap",
      detail: "AI lead qualification repeats AI lead qualification (/ai-lead-follow-up-automation)",
    });
    assert.deepEqual(refused(sdr((v) => Object.assign(v, { keywords: ["AI SDR tool", "AI lead reactivation"] })), v3()), {
      code: "keyword-overlap",
      detail: "AI lead reactivation repeats AI lead reactivation (/ai-dead-lead-reactivation)",
    });
  });
});
