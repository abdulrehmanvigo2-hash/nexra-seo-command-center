import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { ArticleIssue, ValidatedArticleContent } from "../../../types/content-article.ts";
import { REQUIRED_FIELDS } from "../publications/website/article-contract.ts";
import { NEXRA_AI_BLOG_TEMPLATE } from "../publications/website/template.ts";
import { ARTICLE_CANONICAL_FORMAT, canonicalArticleJson, readCanonicalArticle } from "./canonical.ts";
import { articleContentSha256 } from "./content-hash.ts";
import { checkInternalLinks, isInternalPathSyntax } from "./internal-links.ts";
import { validateSourceReferences } from "./provenance.ts";
import { completeArticle, SOURCE_REFERENCE } from "./test-support/fixtures.ts";
import { ARTICLE_LIMITS, TOPIC_DECISIONS, validateArticleContent } from "./validate.ts";
import { websiteCompleteness } from "./website-completeness.ts";

/**
 * Stage 5, milestone C1: the pure article contract. Validation, canonical
 * serialisation, hashing, provenance, link syntax and the website
 * completeness mapping — all offline. `fetch` is a trap for the whole file.
 */

const realFetch = globalThis.fetch;
let fetchCalls = 0;
beforeEach(() => {
  fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("no network call is allowed from the article contract");
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  assert.equal(fetchCalls, 0, "the article contract made a network call");
});

function valid(input: unknown = completeArticle()): ValidatedArticleContent {
  const result = validateArticleContent(input);
  assert.ok(result.ok, `expected valid content, got ${JSON.stringify(result.ok ? [] : result.issues)}`);
  return result.article;
}

function issuesOf(input: unknown): readonly ArticleIssue[] {
  const result = validateArticleContent(input);
  assert.equal(result.ok, false, "expected the content to be refused");
  return result.ok ? [] : result.issues;
}

function assertIssue(input: unknown, path: string, code: ArticleIssue["code"]): void {
  const issues = issuesOf(input);
  assert.ok(
    issues.some((issue) => issue.path === path && issue.code === code),
    `expected ${code} at ${path}, got ${JSON.stringify(issues)}`,
  );
}

function withField(key: string, value: unknown): Record<string, unknown> {
  return { ...completeArticle(), [key]: value };
}

function withSections(sections: unknown): Record<string, unknown> {
  return withField("sections", sections);
}

const REQUIRED_TEXT = ["topic", "slug", "title", "metaTitle", "metaDescription", "excerpt", "category", "lead", "ctaTitle", "ctaBody"] as const;

describe("valid complete article", () => {
  test("is accepted as a fresh copy in contract order", () => {
    const input = completeArticle();
    const article = valid(input);
    assert.notEqual(article, input);
    assert.deepEqual(Object.keys(article), [
      "topic",
      "searchIntent",
      "slug",
      "title",
      "metaTitle",
      "metaDescription",
      "excerpt",
      "category",
      "keywords",
      "lead",
      "introduction",
      "sections",
      "faqs",
      "internalLinks",
      "ctaTitle",
      "ctaBody",
      "topicDecision",
    ]);
    assert.deepEqual(JSON.parse(JSON.stringify(article)), input);
  });

  test("accepts every topic decision, and none is chosen for the author", () => {
    for (const decision of TOPIC_DECISIONS) assert.equal(valid(withField("topicDecision", decision)).topicDecision, decision);
    assertIssue(withField("topicDecision", undefined), "topicDecision", "required");
  });
});

describe("required fields", () => {
  for (const key of [...REQUIRED_TEXT, "searchIntent", "keywords", "sections", "topicDecision"]) {
    test(`${key} is required`, () => {
      const input = completeArticle();
      delete input[key];
      assertIssue(input, key, "required");
    });
  }

  test("empty strings and empty required lists are missing", () => {
    for (const key of REQUIRED_TEXT) assertIssue(withField(key, ""), key, "required");
    assertIssue(withField("keywords", []), "keywords", "required");
    assertIssue(withSections([]), "sections", "required");
  });

  test("every missing field is reported at once, not just the first", () => {
    const issues = issuesOf({ topic: "A topic", searchIntent: "commercial" });
    const missing = issues.filter((issue) => issue.code === "required").map((issue) => issue.path);
    for (const key of ["slug", "title", "metaTitle", "metaDescription", "excerpt", "category", "keywords", "lead", "sections", "ctaTitle", "ctaBody", "topicDecision"]) {
      assert.ok(missing.includes(key), `${key} should be reported missing`);
    }
    assert.ok(!missing.includes("topic"));
    assert.ok(!missing.includes("introduction"), "optional lists are never reported missing");
  });

  test("wrong JSON types are refused", () => {
    assertIssue(withField("title", 42), "title", "type");
    assertIssue(withField("keywords", "a, b"), "keywords", "type");
    assertIssue(withField("sections", { id: "x" }), "sections", "type");
    assert.deepEqual(issuesOf("not an object"), [{ path: "", code: "type" }]);
    assert.deepEqual(issuesOf(null), [{ path: "", code: "required" }]);
    assert.deepEqual(issuesOf([completeArticle()]), [{ path: "", code: "type" }]);
  });

  test("length bounds are enforced, counted in code points", () => {
    assertIssue(withField("metaTitle", "x".repeat(ARTICLE_LIMITS.metaTitle + 1)), "metaTitle", "too-long");
    valid(withField("metaTitle", "x".repeat(ARTICLE_LIMITS.metaTitle)));
    // 120 emoji are 240 UTF-16 units but 120 code points.
    valid(withField("metaTitle", "😀".repeat(ARTICLE_LIMITS.metaTitle)));
    assertIssue(withField("keywords", Array.from({ length: ARTICLE_LIMITS.keywords + 1 }, (_, i) => `keyword ${i}`)), "keywords", "too-many");
  });

  test("keywords must be distinct text, compared without case", () => {
    assertIssue(withField("keywords", ["missed call", "Missed Call"]), "keywords[1]", "duplicate");
    assertIssue(withField("keywords", ["ok", ""]), "keywords[1]", "required");
  });
});

describe("optional fields", () => {
  test("omitted optional lists are valid and read as empty", () => {
    const input = completeArticle();
    delete input.introduction;
    delete input.faqs;
    delete input.internalLinks;
    const sections = input.sections as Record<string, unknown>[];
    delete sections[0].subsections;
    const article = valid(input);
    assert.deepEqual(article.introduction, []);
    assert.deepEqual(article.faqs, []);
    assert.deepEqual(article.internalLinks, []);
    assert.deepEqual(article.sections[0].subsections, []);
  });

  test("omission and an empty list are the same content", () => {
    const omitted = completeArticle();
    delete omitted.faqs;
    assert.equal(canonicalArticleJson(valid(omitted)), canonicalArticleJson(valid(withField("faqs", []))));
  });

  test("null is not omission", () => {
    assertIssue(withField("faqs", null), "faqs", "type");
    assertIssue(withField("introduction", null), "introduction", "type");
  });

  test("optional entries are validated like required ones", () => {
    assertIssue(withField("faqs", [{ question: "Q?" }]), "faqs[0].answer", "required");
    assertIssue(withField("faqs", [{ question: "Q?", answer: "A." }, { question: "Q?", answer: "B." }]), "faqs[1].question", "duplicate");
    assertIssue(withField("introduction", [" leading space"]), "introduction[0]", "surrounding-whitespace");
  });
});

describe("slug", () => {
  test("only lowercase kebab-case, 3 to 80 characters, is accepted", () => {
    for (const slug of ["Missed-Call", "missed call", "missed--call", "-missed", "missed-", "missed_call", "ab", "é-accent"]) {
      assertIssue(withField("slug", slug), "slug", "format");
    }
    assertIssue(withField("slug", "a".repeat(81)), "slug", "too-long");
    valid(withField("slug", "abc"));
    valid(withField("slug", "a".repeat(80)));
  });

  test("a slug is never corrected", () => {
    assertIssue(withField("slug", " missed-call"), "slug", "format");
  });
});

describe("section structure and heading hierarchy", () => {
  const section = (over: Record<string, unknown>) => ({ id: "one", heading: "One", paragraphs: ["Body."], ...over });

  test("a section needs an id, an H2 and at least one paragraph", () => {
    assertIssue(withSections([section({ id: undefined })]), "sections[0].id", "required");
    assertIssue(withSections([section({ heading: "" })]), "sections[0].heading", "required");
    assertIssue(withSections([section({ paragraphs: [] })]), "sections[0].paragraphs", "required");
    assertIssue(withSections([section({ paragraphs: ["Fine.", ""] })]), "sections[0].paragraphs[1]", "required");
    assertIssue(withSections(["just text"]), "sections[0]", "type");
  });

  test("H3 is the only level under H2", () => {
    const nested = section({ subsections: [{ id: "two", heading: "Two", paragraphs: ["Body."], subsections: [] }] });
    assertIssue(withSections([nested]), "sections[0].subsections[0].subsections", "unsupported-field");
    assertIssue(withSections([section({ level: 3 })]), "sections[0].level", "unsupported-field");
    assertIssue(withSections([section({ subsections: [{ id: "two", heading: "Two", paragraphs: [] }] })]), "sections[0].subsections[0].paragraphs", "required");
  });

  test("headings carry no markup", () => {
    assertIssue(withSections([section({ heading: "## One" })]), "sections[0].heading", "heading");
    assertIssue(withSections([section({ subsections: [{ id: "two", heading: "### Two", paragraphs: ["Body."] }] })]), "sections[0].subsections[0].heading", "heading");
  });

  test("section ids are kebab-case", () => {
    assertIssue(withSections([section({ id: "One" })]), "sections[0].id", "format");
    assertIssue(withSections([section({ id: "one two" })]), "sections[0].id", "format");
    assertIssue(withSections([section({ id: "a".repeat(81) })]), "sections[0].id", "too-long");
  });

  test("sibling headings are distinct", () => {
    assertIssue(withSections([section({}), section({ id: "two" })]), "sections[1].heading", "duplicate");
    const subs = [
      { id: "a", heading: "Same", paragraphs: ["x."] },
      { id: "b", heading: "Same", paragraphs: ["y."] },
    ];
    assertIssue(withSections([section({ subsections: subs })]), "sections[0].subsections[1].heading", "duplicate");
  });
});

describe("duplicate section ids", () => {
  test("are refused across H2 sections", () => {
    const sections = [
      { id: "one", heading: "One", paragraphs: ["a."] },
      { id: "one", heading: "Two", paragraphs: ["b."] },
    ];
    assertIssue(withSections(sections), "sections[1].id", "duplicate");
  });

  test("are refused between an H2 and an H3 anywhere in the article", () => {
    const sections = [
      { id: "one", heading: "One", paragraphs: ["a."] },
      { id: "two", heading: "Two", paragraphs: ["b."], subsections: [{ id: "one", heading: "Sub", paragraphs: ["c."] }] },
    ];
    assertIssue(withSections(sections), "sections[1].subsections[0].id", "duplicate");
  });
});

describe("internal links", () => {
  const link = (over: Record<string, unknown>) => withField("internalLinks", [{ path: "/services", anchorText: "services", sectionId: "what-it-does", ...over }]);

  test("syntax: site-relative lowercase kebab-case paths with an optional fragment", () => {
    for (const path of ["/", "/services", "/blog/ai-lead-follow-up-automation", "/services#automation"]) {
      assert.ok(isInternalPathSyntax(path), path);
      valid(link({ path }));
    }
    for (const path of [
      "https://nexraagency.com/services",
      "//nexraagency.com",
      "services",
      "/Services",
      "/services/",
      "/services?x=1",
      "/blog/../admin",
      "/./services",
      "/services%20x",
      "/services#",
      "/services#Top",
      "/services#a#b",
      "/ services",
      "javascript:alert(1)",
      `/${"a".repeat(200)}`,
    ]) {
      assert.equal(isInternalPathSyntax(path), false, path);
      assertIssue(link({ path }), "internalLinks[0].path", "format");
    }
  });

  test("a link belongs in a section the article has", () => {
    assertIssue(link({ sectionId: "nowhere" }), "internalLinks[0].sectionId", "unknown-section");
    valid(link({ sectionId: "timing" }));
    assertIssue(link({ anchorText: "" }), "internalLinks[0].anchorText", "required");
    assertIssue(link({ path: undefined }), "internalLinks[0].path", "required");
  });

  test("the same link in the same section is a duplicate", () => {
    const one = { path: "/services", anchorText: "services", sectionId: "timing" };
    assertIssue(withField("internalLinks", [one, { ...one, anchorText: "again" }]), "internalLinks[1]", "duplicate");
  });

  test("valid syntax is never reported as a verified destination", () => {
    const article = valid();
    assert.deepEqual(websiteCompleteness(article).internalLinks, [{ path: "/services#automation", sectionId: "where-it-stops", syntaxValid: true, issue: null, destination: "unverified" }]);
  });
});

describe("checkInternalLinks checks its own input", () => {
  const ids = new Set(["contact-us", "section-id"]);
  const check = (path: string, sectionId = "contact-us") => checkInternalLinks([{ path, anchorText: "text", sectionId }], ids)[0];

  test("an external URL, a protocol-relative URL and a relative path are not syntax-valid", () => {
    for (const path of ["https://evil.example/x", "//example.com", "relative/path"]) {
      assert.deepEqual(check(path), { path, sectionId: "contact-us", syntaxValid: false, issue: "path-format", destination: "unverified" }, path);
    }
  });

  test("an unknown section id is not syntax-valid", () => {
    assert.deepEqual(check("/contact", "nowhere"), { path: "/contact", sectionId: "nowhere", syntaxValid: false, issue: "unknown-section", destination: "unverified" });
    assert.equal(checkInternalLinks([{ path: "/contact", anchorText: "text", sectionId: "contact-us" }], new Set())[0].syntaxValid, false, "with no ids, nothing is placed");
  });

  test("valid paths in a known section are syntax-valid and still unverified", () => {
    assert.deepEqual(check("/contact"), { path: "/contact", sectionId: "contact-us", syntaxValid: true, issue: null, destination: "unverified" });
    assert.deepEqual(check("/blog/example#section-id", "section-id"), { path: "/blog/example#section-id", sectionId: "section-id", syntaxValid: true, issue: null, destination: "unverified" });
  });

  test("malformed runtime values are refused, not assumed", () => {
    const forged = [{ path: 42, anchorText: "x", sectionId: null }] as unknown as Parameters<typeof checkInternalLinks>[0];
    assert.deepEqual(checkInternalLinks(forged, ids), [{ path: "", sectionId: "", syntaxValid: false, issue: "path-format", destination: "unverified" }]);
  });
});

describe("unsupported extra fields", () => {
  test("record metadata never enters content", () => {
    for (const key of ["id", "articleId", "version", "factCheck", "factCheckStatus", "approved", "approvalStatus", "approvedBy", "createdAt", "updatedAt", "published", "publishedDate", "readingTime", "sources", "format"]) {
      assertIssue(withField(key, "x"), key, "unsupported-field");
    }
  });

  test("nested objects refuse unknown fields too", () => {
    assertIssue(withField("faqs", [{ question: "Q?", answer: "A.", approved: true }]), "faqs[0].approved", "unsupported-field");
    assertIssue(withField("internalLinks", [{ path: "/", anchorText: "home", sectionId: "timing", verified: true }]), "internalLinks[0].verified", "unsupported-field");
  });
});

describe("unsupported values", () => {
  test("topic decisions outside the fixed set are refused", () => {
    for (const decision of ["auto", "UNSET", "create-new", "update_existing", " unset"]) assertIssue(withField("topicDecision", decision), "topicDecision", "unsupported-value");
    assertIssue(withField("topicDecision", 1), "topicDecision", "type");
  });

  test("search intents outside the product's vocabulary are refused", () => {
    assertIssue(withField("searchIntent", "buying"), "searchIntent", "unsupported-value");
    valid(withField("searchIntent", "informational"));
  });
});

describe("text is never rewritten", () => {
  test("surrounding whitespace is refused, not trimmed", () => {
    assertIssue(withField("title", " Title"), "title", "surrounding-whitespace");
    assertIssue(withField("title", "Title "), "title", "surrounding-whitespace");
    assert.equal(valid(withField("title", "Two  spaces inside")).title, "Two  spaces inside");
  });

  test("line breaks and control characters are refused", () => {
    for (const bad of ["a\nb", "a\rb", "a\tb", "a\u0000b", "a\u007fb", "a\u0085b", "a\u2028b"]) assertIssue(withField("lead", bad), "lead", "control-character");
  });

  test("non-NFC text and unpaired surrogates are refused, not normalised", () => {
    assertIssue(withField("title", "Café"), "title", "not-nfc");
    assertIssue(withField("title", "bad \ud800 text"), "title", "invalid-unicode");
    assert.equal(valid(withField("title", "Café")).title, "Café");
  });
});

describe("invisible and direction-changing characters", () => {
  const FORMAT_CHARACTERS: readonly (readonly [name: string, char: string])[] = [
    ["U+00AD soft hyphen", "\u00ad"],
    ["U+200B zero-width space", "\u200b"],
    ["U+200C zero-width non-joiner", "\u200c"],
    ["U+200D zero-width joiner", "\u200d"],
    ["U+200E left-to-right mark", "\u200e"],
    ["U+200F right-to-left mark", "\u200f"],
    ["U+202A left-to-right embedding", "\u202a"],
    ["U+202B right-to-left embedding", "\u202b"],
    ["U+202C pop directional formatting", "\u202c"],
    ["U+202D left-to-right override", "\u202d"],
    ["U+202E right-to-left override", "\u202e"],
    ["U+2060 word joiner", "\u2060"],
    ["U+2061 function application", "\u2061"],
    ["U+2064 invisible plus", "\u2064"],
    ["U+2065 (unassigned, inside the refused range)", "\u2065"],
    ["U+2066 left-to-right isolate", "\u2066"],
    ["U+2069 pop directional isolate", "\u2069"],
    ["U+206F nominal digit shapes", "\u206f"],
    ["U+FEFF zero-width no-break space", "\ufeff"],
    ["U+034F combining grapheme joiner", "\u034f"],
    ["U+061C Arabic letter mark (Cf)", "\u061c"],
    ["U+E0041 tag Latin capital A (Cf)", "\u{e0041}"],
  ];

  test("are refused in titles, never stripped", () => {
    for (const [name, char] of FORMAT_CHARACTERS) {
      assert.deepEqual(issuesOf(withField("title", `Missed${char}call`)), [{ path: "title", code: "invisible-character" }], name);
    }
  });

  test("are refused in H2 and H3 headings", () => {
    for (const [, char] of FORMAT_CHARACTERS) {
      assertIssue(withSections([{ id: "one", heading: `One${char}`, paragraphs: ["Body."] }]), "sections[0].heading", "invisible-character");
      const withSub = [{ id: "one", heading: "One", paragraphs: ["Body."], subsections: [{ id: "two", heading: `T${char}wo`, paragraphs: ["Body."] }] }];
      assertIssue(withSections(withSub), "sections[0].subsections[0].heading", "invisible-character");
    }
  });

  test("are refused in keywords and FAQ text", () => {
    for (const [, char] of FORMAT_CHARACTERS) {
      assertIssue(withField("keywords", ["missed call", `text${char}back`]), "keywords[1]", "invisible-character");
      assertIssue(withField("faqs", [{ question: `Does it${char} work?`, answer: "Yes." }]), "faqs[0].question", "invisible-character");
      assertIssue(withField("faqs", [{ question: "Does it work?", answer: `Y${char}es.` }]), "faqs[0].answer", "invisible-character");
    }
  });

  test("are refused in every other text field, paragraphs and anchor text included", () => {
    assertIssue(withField("lead", "A\u200blead."), "lead", "invisible-character");
    assertIssue(withField("introduction", ["An\u202eintro."]), "introduction[0]", "invisible-character");
    assertIssue(withSections([{ id: "one", heading: "One", paragraphs: ["Bo\ufeffdy."] }]), "sections[0].paragraphs[0]", "invisible-character");
    assertIssue(withField("internalLinks", [{ path: "/", anchorText: "ho\u00adme", sectionId: "timing" }]), "internalLinks[0].anchorText", "invisible-character");
  });

  test("visible text is unaffected: single emoji, variation selectors, accents, other scripts", () => {
    for (const text of ["Ready \u2705", "Love \u2764\ufe0f", "Caf\u00e9", "\u0645\u0631\u062d\u0628\u0627", "\u4e2d\u6587"]) assert.equal(valid(withField("title", text)).title, text);
  });

  test("a hidden character cannot make a duplicate look distinct", () => {
    // Without the rule each pair would pass the duplicate check while looking identical.
    assertIssue(withField("keywords", ["lead follow up", "lead\u200b follow up"]), "keywords[1]", "invisible-character");
    const sections = [
      { id: "one", heading: "Pricing", paragraphs: ["a."] },
      { id: "two", heading: "Pri\u200dcing", paragraphs: ["b."] },
    ];
    assertIssue(withSections(sections), "sections[1].heading", "invisible-character");
    assertIssue(withField("faqs", [{ question: "Is it fast?", answer: "Yes." }, { question: "Is it\u2060 fast?", answer: "Yes." }]), "faqs[1].question", "invisible-character");
  });

  test("case and compatibility forms count as the same text in duplicate checks", () => {
    assertIssue(withField("keywords", ["lead", "\uff4c\uff45\uff41\uff44"]), "keywords[1]", "duplicate");
    assertIssue(withField("keywords", ["office", "o\ufb03ce"]), "keywords[1]", "duplicate");
    const sections = [
      { id: "one", heading: "Pricing", paragraphs: ["a."] },
      { id: "two", heading: "PRICING", paragraphs: ["b."] },
    ];
    assertIssue(withSections(sections), "sections[1].heading", "duplicate");
    assertIssue(withField("faqs", [{ question: "Is it fast?", answer: "A." }, { question: "IS IT FAST?", answer: "B." }]), "faqs[1].question", "duplicate");
  });

  test("the comparison key never rewrites content", () => {
    assert.deepEqual(valid(withField("keywords", ["\uff46\uff55\uff4c\uff4c width", "plain"])).keywords, ["\uff46\uff55\uff4c\uff4c width", "plain"]);
  });

  test("look-alike letters from another script are not detected (documented limit)", () => {
    // Cyrillic U+0430 in place of Latin "a": different code points, accepted as written.
    assert.deepEqual(valid(withField("keywords", ["lead", "le\u0430d"])).keywords, ["lead", "le\u0430d"]);
  });
});

describe("canonical serialisation", () => {
  test("starts with the format tag and has no whitespace between tokens", () => {
    const text = canonicalArticleJson(valid());
    assert.ok(text.startsWith(`{"format":"${ARTICLE_CANONICAL_FORMAT}","topic":`));
    assert.equal(JSON.stringify(JSON.parse(text)), text);
  });

  test("identical content gives identical bytes whatever the input's key order", () => {
    const input = completeArticle();
    const reversed = Object.fromEntries(Object.entries(input).reverse());
    const sections = (reversed.sections as Record<string, unknown>[]).map((s) => Object.fromEntries(Object.entries(s).reverse()));
    const a = canonicalArticleJson(valid(input));
    const b = canonicalArticleJson(valid({ ...reversed, sections }));
    assert.equal(a, b);
    assert.equal(canonicalArticleJson(valid(input)), a, "a second call gives the same bytes");
  });

  test("array order is content: it is kept, and changing it changes the bytes", () => {
    const article = valid();
    assert.deepEqual(article.keywords, ["missed call text back", "missed call automation"]);
    const swapped = canonicalArticleJson(valid(withField("keywords", ["missed call automation", "missed call text back"])));
    assert.notEqual(swapped, canonicalArticleJson(article));
  });

  test("round-trips through stored text, byte for byte", () => {
    const text = canonicalArticleJson(valid());
    const read = readCanonicalArticle(text);
    assert.ok(read);
    assert.equal(canonicalArticleJson(read), text);
    assert.equal(readCanonicalArticle(JSON.stringify(JSON.parse(text), null, 2)), null, "reformatted text is not canonical");
    assert.equal(readCanonicalArticle(text.replace(ARTICLE_CANONICAL_FORMAT, "nexra-article-content/2")), null, "another format is refused");
    assert.equal(readCanonicalArticle("not json"), null);
    const formatLast = JSON.parse(text) as Record<string, unknown>;
    delete formatLast.format;
    formatLast.format = ARTICLE_CANONICAL_FORMAT;
    assert.equal(readCanonicalArticle(JSON.stringify(formatLast)), null, "the format tag must come first");
  });

  test("refuses content that only claims to be validated", () => {
    const forged = { ...completeArticle(), slug: "Not A Slug" } as unknown as ValidatedArticleContent;
    assert.throws(() => canonicalArticleJson(forged));
    assert.throws(() => websiteCompleteness(forged));
  });

  test("carries no timestamp, id, status or publication date", () => {
    const text = canonicalArticleJson(valid());
    for (const key of ["published", "createdAt", "version", "approved", "factCheck", "draftId", "id\":\"0"]) assert.equal(text.includes(key), false, key);
    assert.equal(/\d{4}-\d{2}-\d{2}/.test(text), false, "no date appears");
  });
});

describe("Unicode and special characters", () => {
  test("are written as themselves and survive the round trip", () => {
    const tricky = `Quotes " and \\ backslash, <script>alert('x')</script> & emoji 😀, Arabic مرحبا, café, 中文, Hebrew \u05e9\u05dc\u05d5\u05dd`;
    const article = valid({ ...withField("lead", tricky), title: "Ünïcödé — “smart” quotes" });
    const text = canonicalArticleJson(article);
    assert.ok(text.includes("😀"));
    assert.ok(text.includes("مرحبا"));
    assert.ok(text.includes('\\"'), "a quote is escaped");
    assert.ok(text.includes("\\\\"), "a backslash is escaped");
    assert.equal(/\\u[0-9a-f]{4}/i.test(text), false, "no \\u escape appears");
    const read = readCanonicalArticle(text);
    assert.equal(read?.lead, tricky);
    assert.equal(read?.title, "Ünïcödé — “smart” quotes");
  });
});

describe("content hash", () => {
  test("is SHA-256 over the canonical text's UTF-8 bytes", () => {
    const article = valid();
    const expected = createHash("sha256").update(Buffer.from(canonicalArticleJson(article), "utf8")).digest("hex");
    assert.equal(articleContentSha256(article), expected);
    assert.match(expected, /^[0-9a-f]{64}$/);
  });

  test("is stable: the fixture's hash is pinned", () => {
    assert.equal(articleContentSha256(valid()), PINNED_FIXTURE_HASH);
  });

  test("changes when any content changes", () => {
    const base = articleContentSha256(valid());
    const sections = completeArticle().sections as Record<string, unknown>[];
    const edits: Record<string, unknown>[] = [
      withField("title", "Missed-Call Text-Back: Answering Every Lead You Could Not Pick Up!"),
      withField("topicDecision", "different-angle"),
      withField("searchIntent", "informational"),
      withField("faqs", []),
      withSections([{ ...sections[0], paragraphs: ["It sends one text when a call is not answered.", "The text names the business and asks how it can help"] }, sections[1]]),
      withSections([sections[1], sections[0]]),
    ];
    const hashes = new Set(edits.map((edit) => articleContentSha256(valid(edit))));
    assert.equal(hashes.size, edits.length);
    assert.ok(!hashes.has(base));
  });
});

describe("source provenance", () => {
  test("a well-formed reference is accepted as given", () => {
    const result = validateSourceReferences([SOURCE_REFERENCE]);
    assert.ok(result.ok);
    assert.deepEqual(result.references, [SOURCE_REFERENCE]);
  });

  test("every field is checked", () => {
    const cases: [Record<string, unknown>, string, ArticleIssue["code"]][] = [
      [{ draftId: "not-a-uuid" }, "sources[0].draftId", "format"],
      [{ draftId: SOURCE_REFERENCE.draftId.toUpperCase() }, "sources[0].draftId", "format"],
      [{ version: 0 }, "sources[0].version", "format"],
      [{ version: 1.5 }, "sources[0].version", "format"],
      [{ version: "2" }, "sources[0].version", "type"],
      [{ versionId: undefined }, "sources[0].versionId", "required"],
      [{ contentSha256: "A".repeat(64) }, "sources[0].contentSha256", "format"],
      [{ contentSha256: "a".repeat(63) }, "sources[0].contentSha256", "format"],
    ];
    for (const [over, path, code] of cases) {
      const result = validateSourceReferences([{ ...SOURCE_REFERENCE, ...over }]);
      assert.ok(!result.ok && result.issues.some((i) => i.path === path && i.code === code), `${path} ${code}: ${JSON.stringify(result)}`);
    }
  });

  test("a list needs at least one reference and names no version twice", () => {
    assert.ok(!validateSourceReferences([]).ok);
    assert.ok(!validateSourceReferences(undefined).ok);
    const twice = validateSourceReferences([SOURCE_REFERENCE, { ...SOURCE_REFERENCE }]);
    assert.ok(!twice.ok && twice.issues.some((i) => i.path === "sources[1]" && i.code === "duplicate"));
    const sameNumber = validateSourceReferences([SOURCE_REFERENCE, { ...SOURCE_REFERENCE, versionId: "00000000-0000-4000-8000-00000000e003" }]);
    assert.ok(!sameNumber.ok);
  });

  test("a source's fact-check or approval is refused, never inherited", () => {
    for (const key of ["factCheck", "factCheckStatus", "approved", "approvedVersion", "approvedBy", "status"]) {
      const result = validateSourceReferences([{ ...SOURCE_REFERENCE, [key]: "passed" }]);
      assert.ok(!result.ok && result.issues.some((i) => i.path === `sources[0].${key}` && i.code === "unsupported-field"), key);
    }
  });
});

describe("website completeness mapping", () => {
  test("is pinned to nexra-ai-blog-tsx/1: another template cannot get a report in its name", () => {
    assert.equal(websiteCompleteness.length, 1, "the function takes the article only");
    const other = { ...NEXRA_AI_BLOG_TEMPLATE, id: "other-site-blog/1", routeTemplate: "/articles/<slug>" };
    const loose = websiteCompleteness as unknown as (article: ValidatedArticleContent, template: unknown) => ReturnType<typeof websiteCompleteness>;
    const report = loose(valid(), other);
    assert.equal(report.templateId, "nexra-ai-blog-tsx/1");
    assert.ok(report.derived[0].source.endsWith("/blog/missed-call-text-back"));
    assert.equal(JSON.stringify(report).includes("other-site-blog"), false);
    assert.equal(JSON.stringify(report).includes("/articles/"), false);
  });

  test("covers every required field of the pinned contract exactly once", () => {
    const report = websiteCompleteness(valid());
    const covered = [...report.presentRequired, ...report.missingRequired, ...report.derived, ...report.publicationTime].map((f) => f.key).sort();
    assert.deepEqual(covered, REQUIRED_FIELDS.map((f) => f.key).sort());
    assert.equal(report.templateId, "nexra-ai-blog-tsx/1");
  });

  test("reports present, derived, publication-time and missing fields separately", () => {
    const report = websiteCompleteness(valid());
    assert.deepEqual(
      report.presentRequired.map((f) => f.key),
      ["slug", "title", "metaTitle", "description", "excerpt", "category", "keywords", "lead", "sections", "ctaTitle", "ctaBody"],
    );
    assert.deepEqual(
      report.derived.map((f) => f.key),
      ["canonical", "jsonLd"],
    );
    assert.ok(report.derived[0].source.endsWith("/blog/missed-call-text-back"));
    assert.deepEqual(
      report.publicationTime.map((f) => f.key),
      ["published"],
    );
    assert.deepEqual(
      report.missingRequired.map((f) => f.key),
      ["readingTime"],
    );
  });

  test("reports optional fields as present, derived or absent", () => {
    const full = Object.fromEntries(websiteCompleteness(valid()).optional.map((f) => [f.key, f.state]));
    assert.deepEqual(full, { intro: "present", toc: "derived", h3: "present", faq: "present", furtherReading: "absent", internalLinks: "present" });
    const bare = completeArticle();
    delete bare.introduction;
    delete bare.faqs;
    delete bare.internalLinks;
    bare.sections = (bare.sections as Record<string, unknown>[]).map((s) => ({ ...s, subsections: [] }));
    const sparse = Object.fromEntries(websiteCompleteness(valid(bare)).optional.map((f) => [f.key, f.state]));
    assert.deepEqual(sparse, { intro: "absent", toc: "derived", h3: "absent", faq: "absent", furtherReading: "absent", internalLinks: "absent" });
  });

  test("invents no metadata and no publication date", () => {
    const report = websiteCompleteness(valid());
    assert.equal(report.structurallyComplete, false, "reading time is not held, so the article is not structurally complete");
    assert.match(report.missingRequired[0].source, /never estimated/);
    assert.match(report.publicationTime[0].source, /never part of content/);
    assert.equal(/\d{4}-\d{2}-\d{2}/.test(JSON.stringify(report)), false, "no date appears anywhere in the report");
  });

  test("structural coverage is not a fact-check and not an approval", () => {
    for (const decision of TOPIC_DECISIONS) {
      const report = websiteCompleteness(valid(withField("topicDecision", decision)));
      assert.equal(report.factCheck, "not-established");
      assert.equal(report.approval, "not-established");
      assert.equal(report.topicDecision, decision);
    }
  });
});

/** Pinned so an accidental change to the canonical format is caught. Changing it means a new format version. */
const PINNED_FIXTURE_HASH = "a5ef8a00ec26954c1599c68a3a4b5b59bca6db95582a105db6ee5dcb647b4705";
