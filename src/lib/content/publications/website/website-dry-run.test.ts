import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import ts from "typescript";
import { utf8Sha256 } from "../content-hash.ts";
import { createPublicationService } from "../service.ts";
import { DRAFT_ID, memoryDraftStore, memoryProposalStore, OPERATOR, PROJECT, VERSION_2, VERSION_2_ID, VERSION_2_SQL_HASH, world, type World } from "../test-support/fixtures.ts";
import { envelopeFromProposal, REQUIRED_FIELDS, type ArticleEnvelope } from "./article-contract.ts";
import { buildWebsiteDryRun, COMPLETE_LABEL, INCOMPLETE_LABEL, NO_EXTERNAL_ACTION_NOTICE, renderPage, renderRegistryRecord, type DryRunProvenance } from "./render.ts";
import { createWebsiteDryRunService } from "./service.ts";
import { NEXRA_AI_BLOG_TEMPLATE, templateForDestination } from "./template.ts";
import { OVERLAP_DECISION } from "./topic-overlap.ts";
import { tsString } from "./tsx-literal.ts";

/**
 * The website artifact dry-run, offline: the pinned template, the two
 * artifacts, the completeness model, the topic warning, the escaping, and
 * the server's refusals. Rendered TSX is parsed with the TypeScript
 * compiler, so the injection checks look at the syntax tree, not at text.
 * `fetch` is a trap for the whole file.
 */

const realFetch = globalThis.fetch;
let fetchCalls = 0;
beforeEach(() => {
  fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("no network call is allowed from the website dry-run");
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  assert.equal(fetchCalls, 0, "the website dry-run made a network call");
});

const PROVENANCE: DryRunProvenance = {
  proposalId: "00000000-0000-4000-8000-0000000000f1",
  draftId: DRAFT_ID,
  version: 2,
  versionId: VERSION_2_ID,
  contentSha256: VERSION_2_SQL_HASH,
};

const SLUG = "lead-follow-up";

/** The current Nexra draft: one section, a title and a body, nothing else. */
const SECTION_ONLY = envelopeFromProposal({ slug: SLUG, title: VERSION_2.title, body: VERSION_2.body });

const COMPLETE: ArticleEnvelope = {
  ...SECTION_ONLY,
  slug: "missed-call-text-back",
  title: "Missed-Call Text-Back",
  metaTitle: "Missed-Call Text-Back",
  description: "A description.",
  excerpt: "An excerpt.",
  category: "Operations",
  published: "2026-10-01",
  readingTime: "3 min read",
  keywords: ["missed call text back"],
  lead: "A lead.",
  sections: [{ title: "What it does", paragraphs: ["A paragraph."] }],
  ctaTitle: "A CTA title.",
  ctaBody: "A CTA body.",
};

const dryRunOf = (envelope: ArticleEnvelope) =>
  buildWebsiteDryRun({ template: NEXRA_AI_BLOG_TEMPLATE, envelope, provenance: PROVENANCE, sha256: utf8Sha256 });

/** Syntax errors a TSX file has, by the TypeScript compiler. */
function syntaxErrors(source: string, fileName: string): string[] {
  const out = ts.transpileModule(source, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  return (out.diagnostics ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}

type Tree = { strings: string[]; jsxText: string[]; identifiers: Set<string>; calls: string[]; comments: string[] };

function walk(source: string, fileName: string): Tree {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const tree: Tree = { strings: [], jsxText: [], identifiers: new Set(), calls: [], comments: [] };
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) && !ts.isImportDeclaration(node.parent)) tree.strings.push(node.text);
    if (ts.isJsxText(node) && node.text.trim().length > 0) tree.jsxText.push(node.text);
    if (ts.isIdentifier(node)) tree.identifiers.add(node.text);
    if (ts.isCallExpression(node)) tree.calls.push(node.expression.getText(file));
    ts.forEachChild(node, visit);
  };
  visit(file);
  tree.comments = source.split("\n").filter((line) => line.trimStart().startsWith("//"));
  return tree;
}

/** Wraps a registry record in the array it is appended to, so it parses on its own. */
const asRegistry = (record: string) => `const articles = [\n${record}];\n`;

describe("the pinned template contract", () => {
  test("names the repository, branch, commit, paths, route and format audited, and nothing is read at runtime", () => {
    assert.deepEqual(
      { ...NEXRA_AI_BLOG_TEMPLATE, existingArticles: undefined },
      {
        id: "nexra-ai-blog-tsx/1",
        destinationKey: "nexra-agency-website",
        repository: "abdulrehmanvigo2-hash/nexra-ai",
        defaultBranch: "main",
        pinnedCommit: "a4a572296eca5944dc29a436048a6fff68c33d5d",
        pagePathTemplate: "app/blog/<slug>/page.tsx",
        registryPath: "lib/blog.ts",
        routeTemplate: "/blog/<slug>",
        articleFormat: "tsx",
        existingArticles: undefined,
      },
    );
    assert.equal(templateForDestination("nexra-agency-website"), NEXRA_AI_BLOG_TEMPLATE);
    assert.equal(templateForDestination("another-site"), null);
    assert.deepEqual(NEXRA_AI_BLOG_TEMPLATE.existingArticles.map((a) => a.slug), ["ai-lead-follow-up-automation"]);
  });
});

describe("the two artifacts", () => {
  test("are exactly app/blog/<slug>/page.tsx (a new file) and one record for lib/blog.ts, at route /blog/<slug>", () => {
    const run = dryRunOf(SECTION_ONLY);
    assert.equal(run.page.path, "app/blog/lead-follow-up/page.tsx");
    assert.equal(run.page.kind, "new-file");
    assert.equal(run.registry.path, "lib/blog.ts");
    assert.equal(run.registry.kind, "append-record");
    assert.equal(run.route, "/blog/lead-follow-up");
    assert.equal(run.notice, NO_EXTERNAL_ACTION_NOTICE);
    assert.equal(NO_EXTERNAL_ACTION_NOTICE, "No GitHub branch, commit, pull request, deployment, or publication has been created.");
  });

  test("render byte-identically every time, and each SHA-256 is the hash of its own bytes, pinned here", () => {
    const a = dryRunOf(SECTION_ONLY);
    const b = dryRunOf(envelopeFromProposal({ slug: SLUG, title: VERSION_2.title, body: VERSION_2.body }));
    assert.equal(a.page.content, b.page.content);
    assert.equal(a.registry.content, b.registry.content);
    assert.equal(a.page.sha256, utf8Sha256(a.page.content));
    assert.equal(a.registry.sha256, utf8Sha256(a.registry.content));
    // Pinned: any change to the renderer's output bytes changes these.
    assert.equal(a.page.sha256, PINNED_PAGE_SHA256);
    assert.equal(a.registry.sha256, PINNED_REGISTRY_SHA256);
  });

  test("the page follows the pinned article pattern: its imports, getArticle, the metadata export, JSON-LD, header, TOC, sections and CTA", () => {
    const page = dryRunOf(SECTION_ONLY).page.content;
    assert.match(page, /^import type \{ Metadata \} from "next";$/m);
    assert.match(page, /\} from "@\/components\/site\/article";/);
    assert.match(page, /^const article = getArticle\("lead-follow-up"\);$/m);
    assert.match(page, /alternates: \{ canonical: `\/blog\/\$\{article\.slug\}` \},/);
    for (const part of ["<ArticleJsonLd article={article} />", "<ArticleHeader article={article} lead={lead} />", "<ArticleToc sections={sections} />", "<Section section={sections[0]}>", "<ArticleCta title={ctaTitle} body={ctaBody} />"]) {
      assert.ok(page.includes(part), part);
    }
    assert.deepEqual(syntaxErrors(page, "page.tsx"), [], "the page is not valid TSX");
    assert.deepEqual(syntaxErrors(asRegistry(dryRunOf(SECTION_ONLY).registry.content), "blog.ts"), [], "the record is not a valid array element");
  });
});

describe("completeness", () => {
  test("the current draft section alone is incomplete: every missing required field is listed, in contract order", () => {
    const run = dryRunOf(SECTION_ONLY);
    assert.equal(run.status, "incomplete");
    assert.equal(run.statusLabel, INCOMPLETE_LABEL);
    assert.equal(INCOMPLETE_LABEL, "INCOMPLETE — NOT PUBLISHABLE");
    assert.deepEqual(run.missingRequired, [
      "Title (the page's H1)",
      "Meta title",
      "Meta description",
      "Excerpt (blog index card)",
      "Category",
      "Published date",
      "Reading time",
      "Keywords",
      "Lead paragraph",
      "CTA title",
      "CTA body",
    ]);
    const state = Object.fromEntries(run.fields.map((f) => [f.key, f.state]));
    assert.deepEqual(state, {
      slug: "present",
      title: "missing",
      metaTitle: "missing",
      description: "missing",
      excerpt: "missing",
      category: "missing",
      published: "missing",
      readingTime: "missing",
      keywords: "missing",
      lead: "missing",
      sections: "present",
      canonical: "derived",
      jsonLd: "template",
      ctaTitle: "missing",
      ctaBody: "missing",
      intro: "absent",
      toc: "derived",
      h3: "absent",
      faq: "absent",
      furtherReading: "absent",
      internalLinks: "absent",
    });
    assert.equal(run.fields.filter((f) => f.required).length, REQUIRED_FIELDS.length);
  });

  test("invents nothing: the only string values are the slug, the section's anchor and title, and the body's lines; every missing field is an undeclared identifier", () => {
    const run = dryRunOf(SECTION_ONLY);
    const page = walk(run.page.content, "page.tsx");
    const lines = VERSION_2.body.split("\n");
    const fixedCode = ["article", "/opengraph-image", "summary_large_image"];
    assert.deepEqual(
      page.strings.filter((s) => !fixedCode.includes(s)).sort(),
      [SLUG, "automated-lead-follow-up-how-it-works", VERSION_2.title, ...lines].sort(),
    );
    assert.deepEqual(page.jsxText, [], "draft text appeared as JSX text");
    for (const key of ["lead", "ctaTitle", "ctaBody"]) assert.ok(page.identifiers.has(`MISSING_REQUIRED_FIELD_${key}`), key);

    const record = walk(asRegistry(run.registry.content), "blog.ts");
    assert.deepEqual(record.strings, [SLUG]);
    for (const key of ["title", "metaTitle", "description", "excerpt", "category", "published", "readingTime", "keywords"]) {
      assert.ok(record.identifiers.has(`MISSING_REQUIRED_FIELD_${key}`), key);
    }
    // Both files say what they are, in their first lines.
    assert.match(run.page.content, /^\/\/ Nexra SEO Command Center: website artifact dry-run\. NOT PUBLISHED\./);
    assert.ok(run.page.content.includes(`// ${INCOMPLETE_LABEL}. Missing required fields: title, metaTitle, description, excerpt, category, published, readingTime, keywords, lead, ctaTitle, ctaBody.`));
    assert.ok(run.registry.content.includes(`  // ${INCOMPLETE_LABEL}.`));
  });

  test("a complete envelope renders as a complete dry-run — still not published — with every value a string literal and no missing identifier", () => {
    const run = dryRunOf(COMPLETE);
    assert.equal(run.status, "complete");
    assert.equal(run.statusLabel, COMPLETE_LABEL);
    assert.equal(COMPLETE_LABEL, "COMPLETE DRY-RUN — STILL NOT PUBLISHED");
    assert.deepEqual(run.missingRequired, []);
    assert.doesNotMatch(run.page.content + run.registry.content, /MISSING_REQUIRED_FIELD_/);
    assert.ok(run.registry.content.includes('    published: "2026-10-01",'));
    assert.ok(run.registry.content.includes('    keywords: [\n      "missed call text back",\n    ],'));
    assert.deepEqual(syntaxErrors(run.page.content, "page.tsx"), []);
    assert.deepEqual(syntaxErrors(asRegistry(run.registry.content), "blog.ts"), []);
  });

  test("blank text and a malformed date count as missing, never as present", () => {
    const run = dryRunOf({ ...COMPLETE, metaTitle: "   ", published: "1 October 2026", keywords: [] });
    assert.deepEqual(run.missingRequired, ["Meta title", "Published date", "Keywords"]);
    assert.equal(run.status, "incomplete");
  });
});

describe("escaping and injection", () => {
  const HOSTILE = [
    'He said "hello" and left.',
    "Back\\slash and `backtick` and ${template} and */ comment end",
    "</P>}{alert(1)}{<script>alert(document.cookie)</script>",
    "<img src=x onerror=alert(1)> &amp; <!-- note -->",
    "{\"__proto__\": 1} {constructor} <A href=\"javascript:alert(1)\">x</A>",
    `line${String.fromCharCode(0x2028)}separator${String.fromCharCode(0x2029)}done 🙂`,
  ];
  const hostile: ArticleEnvelope = {
    ...COMPLETE,
    title: HOSTILE[2],
    metaTitle: HOSTILE[0],
    description: HOSTILE[1],
    lead: HOSTILE[3],
    ctaTitle: HOSTILE[4],
    ctaBody: HOSTILE[5],
    keywords: HOSTILE,
    sections: [{ title: HOSTILE[2], paragraphs: HOSTILE }],
  };

  test("every hostile string is a single string literal that decodes to itself; none becomes JSX, an identifier, a call or a comment", () => {
    const run = dryRunOf(hostile);
    assert.deepEqual(syntaxErrors(run.page.content, "page.tsx"), []);
    assert.deepEqual(syntaxErrors(asRegistry(run.registry.content), "blog.ts"), []);
    const page = walk(run.page.content, "page.tsx");
    const record = walk(asRegistry(run.registry.content), "blog.ts");
    for (const text of HOSTILE) {
      assert.ok(page.strings.includes(text) || record.strings.includes(text), `not a literal: ${text}`);
    }
    assert.deepEqual(page.jsxText, []);
    assert.deepEqual(page.calls.sort(), ["articleUrl", "getArticle"], "a call other than the template's own appeared");
    for (const name of ["alert", "document", "constructor", "__proto__", "template"]) {
      assert.ok(!page.identifiers.has(name) && !record.identifiers.has(name), `identifier from content: ${name}`);
    }
    // The comment lines are only the fixed provenance header.
    assert.equal(page.comments.length, 4);
    assert.ok(page.comments.every((line) => !/alert|script|hello/.test(line)));
  });

  test("no markup, script or line separator from the content appears literally in either file", () => {
    const run = dryRunOf(hostile);
    for (const content of [run.page.content, run.registry.content]) {
      // Raw markup from the content never appears: every `<` in it is `<`, every quote `\"`.
      // (Words such as "alert(1)" may appear as data inside a literal; the syntax-tree test above
      // proves no literal is ever anything but a string.)
      assert.doesNotMatch(content, /<script|<img|<!--|<\/P>\}|<A href|href="javascript/);
      assert.ok(!content.includes(String.fromCharCode(0x2028)) && !content.includes(String.fromCharCode(0x2029)));
    }
    // The JSX the template itself writes is still there, untouched.
    assert.ok(run.page.content.includes("<ArticleBody>"));
  });

  test("tsString escapes markup and separators and still round-trips any string", () => {
    for (const text of [...HOSTILE, "", "\u0000", "\ud800 lone surrogate", "tab\tnewline\n"]) {
      const literal = tsString(text);
      assert.equal(JSON.parse(literal), text);
      assert.doesNotMatch(literal, /[<>&]/);
    }
  });

  test("unsafe provenance or slugs are refused before anything is rendered", () => {
    assert.throws(() => renderPage(NEXRA_AI_BLOG_TEMPLATE, { ...SECTION_ONLY, slug: "../../etc" }, PROVENANCE), /unsafe input: slug/);
    assert.throws(() => renderRegistryRecord(NEXRA_AI_BLOG_TEMPLATE, SECTION_ONLY, { ...PROVENANCE, proposalId: "*/ evil" }), /proposal id/);
    assert.throws(() => renderPage(NEXRA_AI_BLOG_TEMPLATE, SECTION_ONLY, { ...PROVENANCE, contentSha256: "x" }), /content hash/);
  });
});

describe("the topic-overlap warning", () => {
  test("the current lead follow-up draft warns about /blog/ai-lead-follow-up-automation, and a different slug is not called safe", () => {
    const run = dryRunOf(SECTION_ONLY);
    assert.equal(run.noOverlapDetected, false);
    const warning = run.warnings.find((w) => w.kind === "topic-overlap");
    assert.ok(warning && warning.kind === "topic-overlap");
    assert.equal(warning.existingSlug, "ai-lead-follow-up-automation");
    assert.equal(warning.existingRoute, "/blog/ai-lead-follow-up-automation");
    assert.ok(warning.matchedPhrases.includes("lead follow up"));
    assert.ok(warning.matchedPhrases.includes("automated lead follow up"));
    assert.match(warning.message, /A different slug does not make a new page safe/);
    assert.ok(warning.message.endsWith(OVERLAP_DECISION));
    assert.match(OVERLAP_DECISION, /update the existing article, take a materially different angle, or create a new article is an operator decision for a later milestone/);
  });

  test("the warning does not block rendering on its own: a complete envelope that overlaps is still a complete dry-run", () => {
    const run = dryRunOf({ ...COMPLETE, sections: [{ title: "Automated lead follow-up", paragraphs: ["Lead response automation."] }] });
    assert.equal(run.status, "complete");
    assert.equal(run.warnings.filter((w) => w.kind === "topic-overlap").length, 1);
  });

  test("the live article's own slug is a collision that keeps the dry-run incomplete", () => {
    const run = dryRunOf({ ...COMPLETE, slug: "ai-lead-follow-up-automation" });
    assert.ok(run.warnings.some((w) => w.kind === "slug-collision"));
    assert.equal(run.status, "incomplete");
    assert.equal(run.statusLabel, INCOMPLETE_LABEL);
  });

  test("unrelated text raises no warning, and says only that the fixed check found nothing", () => {
    const run = dryRunOf(COMPLETE);
    assert.deepEqual(run.warnings, []);
    assert.equal(run.noOverlapDetected, true);
  });
});

describe("websiteDryRunService", () => {
  async function proposed(w: World) {
    const publications = createPublicationService({ drafts: memoryDraftStore(w), proposals: memoryProposalStore(w) });
    const result = await publications.propose({
      projectId: PROJECT,
      draftId: DRAFT_ID,
      version: 2,
      destination: "nexra-agency-website",
      slug: SLUG,
      expectedContentSha256: VERSION_2_SQL_HASH,
      operatorId: OPERATOR,
    });
    assert.ok(result.ok && result.created);
    return { publications, proposalId: w.proposals[0].id, service: createWebsiteDryRunService({ publications }) };
  }

  test("renders the active, current, verified proposal from its bound version, and changes nothing", async () => {
    const w = world();
    const { service, proposalId } = await proposed(w);
    const before = JSON.stringify(w);
    const calls = w.calls.length;
    const result = await service.getDryRun(PROJECT, DRAFT_ID, proposalId);
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.dryRun.proposal.id, proposalId);
    assert.equal(result.dryRun.proposal.versionId, VERSION_2_ID);
    assert.equal(result.dryRun.proposal.contentSha256, VERSION_2_SQL_HASH);
    assert.equal(result.dryRun.status, "incomplete");
    assert.equal(result.dryRun.missingRequired.length, 11);
    assert.equal(result.dryRun.page.content, dryRunOf({ ...SECTION_ONLY }).page.content.replace(PROVENANCE.proposalId, proposalId));
    const written = w.calls.slice(calls).filter((c) => /create|withdraw/.test(c));
    assert.deepEqual(written, [], "the dry-run wrote");
    assert.equal(JSON.stringify({ ...w, calls: [] }), JSON.stringify({ ...JSON.parse(before), calls: [] }), "state changed");
  });

  test("a withdrawn proposal is refused", async () => {
    const w = world();
    const { publications, service, proposalId } = await proposed(w);
    assert.ok((await publications.withdraw({ projectId: PROJECT, draftId: DRAFT_ID, proposalId, operatorId: OPERATOR })).ok);
    assert.deepEqual(await service.getDryRun(PROJECT, DRAFT_ID, proposalId), { ok: false, reason: "withdrawn" });
  });

  test("a stale proposal — the draft edited, or re-approved at another moment — is refused", async () => {
    const edited = world();
    const a = await proposed(edited);
    edited.versions.push({ ...VERSION_2, id: "00000000-0000-4000-8000-0000000000e3", version: 3, body: "Edited.", factCheck: null });
    edited.drafts[0] = { ...edited.drafts[0], currentVersion: 3, status: "drafting" };
    assert.deepEqual(await a.service.getDryRun(PROJECT, DRAFT_ID, a.proposalId), { ok: false, reason: "stale" });

    const reapproved = world();
    const b = await proposed(reapproved);
    reapproved.drafts[0] = { ...reapproved.drafts[0], approvedAt: "2026-09-22T18:00:00.000000+00:00" };
    assert.deepEqual(await b.service.getDryRun(PROJECT, DRAFT_ID, b.proposalId), { ok: false, reason: "stale" });
  });

  test("a preview or hash mismatch is refused as unverified", async () => {
    const w = world();
    const { service, proposalId } = await proposed(w);
    w.proposals[0] = { ...w.proposals[0], previewSha256: "f".repeat(64) };
    assert.deepEqual(await service.getDryRun(PROJECT, DRAFT_ID, proposalId), { ok: false, reason: "unverified" });
    w.proposals[0] = { ...w.proposals[0], previewSha256: w.proposals[0].previewSha256, contentSha256: "e".repeat(64) };
    assert.deepEqual(await service.getDryRun(PROJECT, DRAFT_ID, proposalId), { ok: false, reason: "unverified" });
  });

  test("the wrong project, the wrong draft, an unknown proposal and malformed ids are refused", async () => {
    const w = world();
    const { service, proposalId } = await proposed(w);
    assert.deepEqual(await service.getDryRun("other-client", DRAFT_ID, proposalId), { ok: false, reason: "not-found" });
    assert.deepEqual(await service.getDryRun(PROJECT, "00000000-0000-4000-8000-0000000000ff", proposalId), { ok: false, reason: "not-found" });
    assert.deepEqual(await service.getDryRun(PROJECT, DRAFT_ID, "00000000-0000-4000-8000-0000000000aa"), { ok: false, reason: "not-found" });
    assert.deepEqual(await service.getDryRun(PROJECT, DRAFT_ID, "not-a-uuid"), { ok: false, reason: "invalid" });
    assert.deepEqual(await service.getDryRun("Bad Project", DRAFT_ID, proposalId), { ok: false, reason: "invalid" });
  });

  test("offers one read and nothing else: no branch, commit, pull request, deploy or publish method", async () => {
    const { service } = await proposed(world());
    assert.deepEqual(Object.keys(service), ["getDryRun"]);
  });
});

const PINNED_PAGE_SHA256 = "95dc23176e3800251cd104cb242bc1129771ddb175d33299bc4dcd8cf8c6ea41";
const PINNED_REGISTRY_SHA256 = "3b1633dbdd0e4bbeaaca3c1f3a4deb7fdf16e3cc5ab63f7341067ec7405ba0b6";
