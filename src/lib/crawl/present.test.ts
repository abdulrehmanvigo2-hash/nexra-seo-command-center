import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { duplicateTitleGroups, summariseSignals } from "@/lib/crawl/present";
import type { StoredPageSignals } from "@/types/crawl";

/**
 * The arithmetic behind the signals panel.
 *
 * Every figure the panel shows is counted here, so the rules that decide what
 * counts — which pages are eligible, and what makes two titles the same — are
 * tested once rather than re-derived inside a component. Two of them matter
 * beyond arithmetic: a page nobody parsed has no missing title, and a title
 * observation is a count and never a verdict.
 */

function page(overrides: Partial<StoredPageSignals> & { url: string }): StoredPageSignals {
  return {
    state: "parsed",
    title: null,
    metaDescription: null,
    canonicalUrl: null,
    metaRobots: null,
    h1: [],
    h2: [],
    wordCount: null,
    internalLinks: null,
    externalLinks: null,
    otherLinks: null,
    parsedAt: "2026-09-21T10:00:00Z",
    ...overrides,
  };
}

describe("summariseSignals", () => {
  test("an empty crawl reads as zero, not as nothing to report", () => {
    const summary = summariseSignals([]);
    assert.equal(summary.pages, 0);
    assert.deepEqual(summary.states, { parsed: 0, "not-html": 0, empty: 0, failed: 0 });
    assert.equal(summary.missingTitle, 0);
    assert.equal(summary.duplicateTitlePages, 0);
    assert.equal(summary.duplicateTitles, 0);
  });

  test("counts one page per stored row, split by state", () => {
    const summary = summariseSignals([
      page({ url: "https://e.com/a", title: "A" }),
      page({ url: "https://e.com/b", title: "B" }),
      page({ url: "https://e.com/c.pdf", state: "not-html" }),
      page({ url: "https://e.com/d", state: "empty" }),
      page({ url: "https://e.com/e", state: "failed" }),
    ]);
    assert.equal(summary.pages, 5);
    assert.deepEqual(summary.states, { parsed: 2, "not-html": 1, empty: 1, failed: 1 });
  });

  test("a parsed page with no title counts as missing one", () => {
    const summary = summariseSignals([
      page({ url: "https://e.com/a", title: null }),
      page({ url: "https://e.com/b", title: "   " }),
      page({ url: "https://e.com/c", title: "Kept" }),
    ]);
    assert.equal(summary.missingTitle, 2, "null and blank are both no title");
  });

  test("a page nobody parsed is not a page missing a title", () => {
    // A PDF has no <title> element to be missing. Counting it would report a
    // fact about the file format as a fault on the page.
    const summary = summariseSignals([
      page({ url: "https://e.com/a.pdf", state: "not-html" }),
      page({ url: "https://e.com/b", state: "empty" }),
      page({ url: "https://e.com/c", state: "failed" }),
    ]);
    assert.equal(summary.missingTitle, 0);
  });

  test("duplicate titles count the pages and the titles they share", () => {
    const summary = summariseSignals([
      page({ url: "https://e.com/a", title: "Home" }),
      page({ url: "https://e.com/b", title: "Home" }),
      page({ url: "https://e.com/c", title: "Home" }),
      page({ url: "https://e.com/d", title: "Contact" }),
      page({ url: "https://e.com/e", title: "Contact" }),
      page({ url: "https://e.com/f", title: "Unique" }),
    ]);
    assert.equal(summary.duplicateTitlePages, 5, "three plus two pages, not two groups");
    assert.equal(summary.duplicateTitles, 2);
  });

  test("a title shared by nobody is not a duplicate", () => {
    const summary = summariseSignals([
      page({ url: "https://e.com/a", title: "One" }),
      page({ url: "https://e.com/b", title: "Two" }),
    ]);
    assert.equal(summary.duplicateTitlePages, 0);
    assert.equal(summary.duplicateTitles, 0);
  });

  test("titles match on case and surrounding space", () => {
    // What a browser tab and a SERP show is the trimmed text, and neither is
    // case-sensitive to a reader.
    const summary = summariseSignals([
      page({ url: "https://e.com/a", title: "  Home  " }),
      page({ url: "https://e.com/b", title: "HOME" }),
    ]);
    assert.equal(summary.duplicateTitlePages, 2);
    assert.equal(summary.duplicateTitles, 1);
  });

  test("missing titles are not counted as a shared title", () => {
    const summary = summariseSignals([
      page({ url: "https://e.com/a", title: null }),
      page({ url: "https://e.com/b", title: "" }),
    ]);
    assert.equal(summary.missingTitle, 2);
    assert.equal(summary.duplicateTitlePages, 0);
  });

  test("an unparsed page sharing a title with a parsed one is not a duplicate", () => {
    const summary = summariseSignals([
      page({ url: "https://e.com/a", title: "Home" }),
      page({ url: "https://e.com/b", title: "Home", state: "failed" }),
    ]);
    assert.equal(summary.duplicateTitlePages, 0);
  });
});

describe("duplicateTitleGroups", () => {
  test("returns only shared titles, most shared first", () => {
    const groups = duplicateTitleGroups([
      page({ url: "https://e.com/a", title: "Contact" }),
      page({ url: "https://e.com/b", title: "Contact" }),
      page({ url: "https://e.com/c", title: "Home" }),
      page({ url: "https://e.com/d", title: "Home" }),
      page({ url: "https://e.com/e", title: "Home" }),
      page({ url: "https://e.com/f", title: "Alone" }),
    ]);
    assert.deepEqual(groups, [
      { title: "Home", pages: 3 },
      { title: "Contact", pages: 2 },
    ]);
  });

  test("reports the title as the page wrote it, trimmed", () => {
    const [group] = duplicateTitleGroups([
      page({ url: "https://e.com/a", title: "  Home  " }),
      page({ url: "https://e.com/b", title: "home" }),
    ]);
    assert.equal(group.title, "Home", "the first spelling seen, not the folded key");
  });
});
