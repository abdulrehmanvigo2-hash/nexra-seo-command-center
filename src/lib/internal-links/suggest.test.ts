import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { validateArticleContent } from "@/lib/content/articles/validate";
import { findPhrase, MAX_PER_TARGET, phrasesFor, suggestArticleLinks, suggestSiteLinks, titleSegment, type SuggestPage } from "@/lib/internal-links/suggest";

/** M8, PR 4: internal-link suggestions by fixed rules. */

const page = (path: string, over: Partial<SuggestPage> = {}): SuggestPage => ({ url: `https://nexraagency.com${path}`, title: null, firstH1: null, ok: true, noindex: false, inbound: 1, text: null, ...over });

const PAGES: SuggestPage[] = [
  page("/", { title: "Nexra Agency | AI automation", text: "We build AI receptionist systems and missed call text back for small business owners.", inbound: 5 }),
  page("/blog/missed-call-text-back", { title: "Missed call text back: how it works — Nexra", firstH1: "Missed Call Text Back", text: "A missed call text back reply goes out in seconds.", inbound: 0 }),
  page("/blog/ai-sdr-tool", { firstH1: "What an AI SDR tool does", text: "An AI receptionist answers the phone; an AI SDR qualifies leads.", inbound: 1 }),
  page("/contact", { title: "Contact", text: "Write to us.", inbound: 3 }),
  page("/hidden", { firstH1: "Hidden page here", noindex: true, text: "AI receptionist", inbound: 0 }),
  page("/broken", { ok: false, firstH1: "Broken page here", inbound: 0 }),
];
const PHRASES = [
  { path: "/blog/missed-call-text-back", phrase: "missed call text back", source: "live-article-keyword" as const },
  { path: "/blog/ai-sdr-tool", phrase: "AI receptionist", source: "curated-keyword" as const },
  { path: "/blog/ai-sdr-tool", phrase: "sdr", source: "curated-keyword" as const },
];

describe("phrases", () => {
  test("rule order, two to eight words, no repeats, the title's first segment", () => {
    assert.equal(titleSegment("Missed call text back: how it works — Nexra"), "Missed call text back: how it works");
    assert.equal(titleSegment("Nexra Agency | AI automation"), "Nexra Agency");
    assert.deepEqual(phrasesFor(PAGES[1]!, PHRASES).map((p) => `${p.source}:${p.phrase}`), ["live-article-keyword:missed call text back", "title:Missed call text back: how it works"],
      "the h1 repeats the keyword (case ignored) and is left out");
    assert.deepEqual(phrasesFor(PAGES[2]!, PHRASES).map((p) => p.source), ["curated-keyword", "h1"], "a one-word keyword is too vague and is left out");
    assert.deepEqual(phrasesFor(page("/x", { firstH1: "One" }), []), []);
  });

  test("whole words only, case ignored, across whitespace; the anchor as written, with context", () => {
    assert.equal(findPhrase("Our AI   Receptionist works.", "ai receptionist")?.anchor, "AI Receptionist");
    assert.equal(findPhrase("the email inbox", "ai"), null, "never inside a word");
    assert.match(findPhrase(`${"x ".repeat(40)}missed call text back${" y".repeat(40)}`, "missed call text back")!.context, /^….*missed call text back.*…$/);
    assert.equal(findPhrase("costs (a lot)", "(a lot)")?.anchor, "(a lot)", "regex characters are escaped");
  });
});

describe("site suggestions", () => {
  const suggestions = suggestSiteLinks({ pages: PAGES, edges: [{ from: "https://nexraagency.com/", to: "https://nexraagency.com/blog/ai-sdr-tool" }], phrases: PHRASES });

  test("fewest-inbound targets first; a phrase found in another page's text, where no link exists", () => {
    assert.deepEqual(suggestions.map((s) => `${s.fromPath}→${s.toPath}:${s.anchor}`), ["/→/blog/missed-call-text-back:missed call text back"]);
    assert.equal(suggestions[0]!.source, "live-article-keyword");
    assert.equal(suggestions[0]!.targetInbound, 0);
  });

  test("never to itself, an existing link, a noindex or failed page; at most three per target", () => {
    assert.ok(!suggestions.some((s) => s.toPath === "/blog/ai-sdr-tool" && s.fromPath === "/"), "the home page already links there");
    assert.ok(!suggestions.some((s) => s.toPath === "/hidden" || s.fromPath === "/hidden" || s.toPath === "/broken"));
    const many = Array.from({ length: 6 }, (_, i) => page(`/p${i}`, { text: "missed call text back", inbound: 2 }));
    const capped = suggestSiteLinks({ pages: [...many, PAGES[1]!], edges: [], phrases: PHRASES }).filter((s) => s.toPath === "/blog/missed-call-text-back");
    assert.equal(capped.length, MAX_PER_TARGET);
  });

  test("no text kept means no suggestion, never a guess", () => {
    assert.deepEqual(suggestSiteLinks({ pages: PAGES.map((p) => ({ ...p, text: null })), edges: [], phrases: PHRASES }), []);
  });
});

describe("article suggestions", () => {
  const content = {
    topic: "AI receptionist", searchIntent: "commercial", slug: "ai-receptionist", title: "AI receptionist for small business", metaTitle: "AI receptionist", metaDescription: "What it does.",
    excerpt: "What it does.", category: "AI Automation", keywords: ["ai receptionist"], lead: "Lead.", introduction: [],
    sections: [{ id: "what-it-does", heading: "What it does", paragraphs: ["It answers calls.", "With missed call text back, nobody waits."], subsections: [] }],
    faqs: [], internalLinks: [] as { path: string; anchorText: string; sectionId: string }[], ctaTitle: "Talk", ctaBody: "Book.", topicDecision: "different-angle", attestations: [], citations: [],
  };

  test("a phrase in one paragraph of a section, for a page the article does not link to and is not", () => {
    const found = suggestArticleLinks({ sections: content.sections, existing: [], ownPath: "/blog/ai-receptionist", pages: PAGES, phrases: PHRASES });
    assert.deepEqual(found.map((s) => `${s.path}|${s.anchorText}|${s.sectionId}`), ["/blog/missed-call-text-back|missed call text back|what-it-does"]);
    const withLink = { ...content, internalLinks: found.map((s) => ({ path: s.path, anchorText: s.anchorText, sectionId: s.sectionId })) };
    assert.ok(validateArticleContent(withLink).ok, "an accepted suggestion is a valid internal link");
    assert.deepEqual(suggestArticleLinks({ sections: content.sections, existing: withLink.internalLinks, ownPath: null, pages: PAGES, phrases: PHRASES }), [], "a linked page is not suggested again");
  });

  test("a phrase split across two paragraphs is not an anchor", () => {
    const sections = [{ id: "s", paragraphs: ["missed call", "text back"] }];
    assert.deepEqual(suggestArticleLinks({ sections, existing: [], ownPath: null, pages: PAGES, phrases: PHRASES }), []);
  });
});
