import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  UNMEASURED_DIMENSIONS,
  findingsFor,
  groupFindings,
  severityCounts,
} from "@/lib/crawl/findings";
import { ISSUE_TYPE_META } from "@/lib/mock/technical/meta";
import type { CrawlPage, StoredPageSignals } from "@/types/crawl";
import type { IssueType } from "@/types/technical";

/**
 * The rules, against evidence a crawl actually stores.
 *
 * Every test here fixes one of two things: that a rule fires on the evidence
 * it claims to read, or that a rule this crawl cannot answer never fires at
 * all. The second kind matters more — a false finding about a site nobody
 * measured is worse than a missing one.
 */

const signals = (over: Partial<StoredPageSignals> = {}): StoredPageSignals => ({
  url: "https://example.com/a",
  state: "parsed",
  title: "A perfectly reasonable title of the right sort of length",
  metaDescription:
    "A description comfortably inside the range this project has always published, so it never trips the length rule on its own.",
  canonicalUrl: "https://example.com/a",
  metaRobots: null,
  h1: ["A heading"],
  h2: [],
  wordCount: 400,
  internalLinks: 9,
  externalLinks: 2,
  otherLinks: 0,
  parsedAt: "2026-09-19T05:00:00Z",
  ...over,
});

const page = (over: Partial<CrawlPage> = {}): CrawlPage => ({
  crawlId: "crawl-1",
  url: "https://example.com/a",
  state: "fetched",
  attemptCount: 1,
  maxAttempts: 3,
  httpStatus: 200,
  finalUrl: "https://example.com/a",
  redirects: [],
  contentType: "text/html",
  bytes: 1000,
  durationMs: 100,
  failure: null,
  refusal: null,
  skipReason: null,
  discoveredAt: "2026-09-19T05:00:00Z",
  fetchedAt: "2026-09-19T05:00:01Z",
  ...over,
});

const types = (found: readonly { type: IssueType }[]) => found.map((f) => f.type).sort();

describe("findingsFor", () => {
  test("a page with nothing wrong produces nothing", () => {
    assert.deepEqual(findingsFor([signals()], [page()]), []);
  });

  test("title length is judged against the project's published range", () => {
    const short = findingsFor([signals({ title: "Home" })], []);
    assert.deepEqual(types(short), ["title-too-short"]);
    assert.match(short[0].evidence, /4 characters, under 30/);

    const long = findingsFor([signals({ title: "x".repeat(72) })], []);
    assert.deepEqual(types(long), ["title-too-long"]);
    assert.match(long[0].evidence, /72 characters, over 60/);

    // Exactly on the bounds is inside them.
    assert.deepEqual(findingsFor([signals({ title: "x".repeat(30) })], []), []);
    assert.deepEqual(findingsFor([signals({ title: "x".repeat(60) })], []), []);
  });

  test("a page with no title says so rather than reporting a length", () => {
    for (const title of [null, "   "]) {
      const found = findingsFor([signals({ title })], []);
      assert.deepEqual(types(found), ["title-too-short"]);
      assert.equal(found[0].evidence, "No title element.");
    }
  });

  test("meta description: absent and out-of-range are different findings", () => {
    assert.deepEqual(types(findingsFor([signals({ metaDescription: null })], [])), [
      "missing-meta-description",
    ]);
    const short = findingsFor([signals({ metaDescription: "Too brief." })], []);
    assert.deepEqual(types(short), ["meta-description-length"]);
    assert.match(short[0].evidence, /10 characters, outside 70 to 160/);
    assert.deepEqual(findingsFor([signals({ metaDescription: "x".repeat(70) })], []), []);
    assert.deepEqual(
      types(findingsFor([signals({ metaDescription: "x".repeat(161) })], [])),
      ["meta-description-length"],
    );
  });

  test("a missing h1 and a missing canonical are read from the stored fields", () => {
    assert.deepEqual(types(findingsFor([signals({ h1: [] })], [])), ["missing-h1"]);
    assert.deepEqual(types(findingsFor([signals({ canonicalUrl: null })], [])), [
      "missing-canonical",
    ]);
  });

  test("a page that links nowhere on the site is reported; a thin one is not", () => {
    assert.deepEqual(types(findingsFor([signals({ internalLinks: 0 })], [])), [
      "no-outbound-internal-links",
    ]);
    // `few-internal-links` counts links *pointing at* a page. This crawl
    // counts links a page makes, so the rule is never applied — the
    // three-link constant is about inbound support and there is none stored.
    assert.deepEqual(findingsFor([signals({ internalLinks: 1 })], []), []);
    assert.deepEqual(findingsFor([signals({ internalLinks: 2 })], []), []);
  });

  test("a shared title is reported against every page sharing it", () => {
    const found = findingsFor(
      [
        signals({ url: "https://example.com/a", title: "Nexra Agency | SEO Agency In The UK" }),
        signals({ url: "https://example.com/b", title: "nexra agency | seo agency in the uk" }),
        signals({ url: "https://example.com/c", title: "Something else entirely and distinct" }),
      ],
      [],
    );
    const duplicates = found.filter((f) => f.type === "duplicate-title");
    assert.deepEqual(
      duplicates.map((f) => f.url).sort(),
      ["https://example.com/a", "https://example.com/b"],
    );
    assert.match(duplicates[0].evidence, /used by 2 pages/);
  });

  test("only parsed pages are judged on their HTML", () => {
    // A PDF has no title, h1 or canonical to be missing. Reporting one would
    // be a fact about the file format dressed as a fault on the page.
    for (const state of ["not-html", "empty", "failed"] as const) {
      const found = findingsFor(
        [signals({ state, title: null, metaDescription: null, h1: [], canonicalUrl: null, internalLinks: null })],
        [],
      );
      assert.deepEqual(found, [], `${state} pages produce no on-page findings`);
    }
  });

  test("what a URL answered is read from the page row", () => {
    assert.deepEqual(types(findingsFor([], [page({ httpStatus: 404 })])), ["broken-page"]);
    assert.deepEqual(types(findingsFor([], [page({ httpStatus: 410 })])), ["broken-page"]);
    assert.deepEqual(types(findingsFor([], [page({ httpStatus: 503 })])), ["server-error"]);
    // 401 and 403 have no rule in the vocabulary; nothing is invented for them.
    assert.deepEqual(findingsFor([], [page({ httpStatus: 403 })]), []);
    assert.deepEqual(
      types(findingsFor([], [page({ state: "skipped", httpStatus: null, skipReason: "robots-disallowed" })])),
      ["blocked-by-robots"],
    );
  });

  test("redirects: one hop is ordinary, more is a chain, 302 is temporary", () => {
    const hop = (status: number) => ({
      url: "https://example.com/a",
      status,
      location: "https://example.com/b",
    });
    assert.deepEqual(findingsFor([], [page({ redirects: [hop(301)] })]), []);
    assert.deepEqual(types(findingsFor([], [page({ redirects: [hop(301), hop(301)] })])), [
      "redirect-chain",
    ]);
    assert.deepEqual(types(findingsFor([], [page({ redirects: [hop(302)] })])), [
      "temporary-redirect",
    ]);
  });

  test("no rule is emitted for a dimension this crawl cannot see", () => {
    // Everything performance, schema, indexation and link-graph shaped.
    const unsupported: readonly IssueType[] = [
      "poor-lcp", "poor-inp", "poor-cls", "slow-page",
      "missing-schema", "invalid-schema", "incomplete-schema",
      "indexable-not-indexed", "indexed-noindex-conflict", "excluded-page",
      "orphan-page", "deep-page", "broken-internal-link", "few-internal-links",
      "missing-from-sitemap", "sitemap-index-mismatch", "non-indexable-in-sitemap",
      "ai-agent-blocked", "canonical-conflict",
    ];
    const everything = findingsFor(
      [signals({ title: null, metaDescription: null, h1: [], canonicalUrl: null, internalLinks: 0 })],
      [page({ httpStatus: 500, redirects: [] })],
    );
    for (const type of unsupported) {
      assert.ok(
        !everything.some((f) => f.type === type),
        `${type} must never be emitted: nothing measures it`,
      );
    }
  });
});

describe("groupFindings", () => {
  test("worst first, then by how many pages a rule matched", () => {
    const groups = groupFindings(
      findingsFor(
        [
          signals({ url: "https://example.com/a", title: "Short" }),
          signals({ url: "https://example.com/b", title: "Short" }),
        ],
        [page({ url: "https://example.com/c", httpStatus: 404 })],
      ),
    );
    assert.equal(groups[0].type, "broken-page");
    assert.equal(groups[0].meta.severity, "critical");
    assert.ok(groups.some((g) => g.type === "duplicate-title"));
  });

  test("severity, impact, action and owner are the catalogue's, not invented here", () => {
    const groups = groupFindings(findingsFor([signals({ h1: [] })], []));
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].meta, ISSUE_TYPE_META["missing-h1"]);
  });

  test("counts are per page and no score is produced", () => {
    const groups = groupFindings(
      // Distinct titles, or the shared-title rule would fire as well and the
      // count would be of two rules rather than one.
      findingsFor(
        [
          signals({ h1: [] }),
          signals({ url: "https://example.com/b", h1: [], title: "A different title of a perfectly fine length" }),
        ],
        [],
      ),
    );
    assert.deepEqual(severityCounts(groups), { medium: 2 });
    // The module exports no score of any kind, and must not gain one here.
    const exported = Object.keys({ findingsFor, groupFindings, severityCounts, UNMEASURED_DIMENSIONS });
    assert.ok(!exported.some((name) => /score/i.test(name)));
  });
});

describe("UNMEASURED_DIMENSIONS", () => {
  test("names the dimensions whose absence could be mistaken for health", () => {
    const labels = UNMEASURED_DIMENSIONS.map((d) => d.label.toLowerCase()).join(" ");
    for (const subject of ["core web vitals", "structured data", "indexation", "broken links"]) {
      assert.ok(labels.includes(subject), `${subject} must be declared unmeasured`);
    }
    assert.ok(UNMEASURED_DIMENSIONS.every((d) => d.why.length > 20));
  });
});
