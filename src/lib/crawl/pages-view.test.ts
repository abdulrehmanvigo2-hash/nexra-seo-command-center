import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { CrawlPage } from "../../types/crawl.ts";
import {
  COLUMNS,
  GROUP_HEADING,
  PROVENANCE_NOTE,
  UNKNOWN,
  canonicalCell,
  countCell,
  depthCell,
  groupPages,
  httpStatusCell,
  inSitemapCell,
  pageRow,
  pathOf,
  redirectCell,
  robotsMetaCell,
  robotsTxtCell,
  schemaCell,
} from "./pages-view.ts";

/**
 * Every case here is a way a table of crawl readings could tell a lie: an
 * absent value shown as a zero, a URL nobody looked at shown as healthy, a
 * count from five pages read as a site-wide figure, or a 200 read as proof of
 * indexation. The wording is the feature, so the wording is what is asserted.
 */

const FETCHED: CrawlPage = {
  id: "page-1",
  crawlId: "crawl-1",
  url: "https://nexraagency.com/services",
  finalUrl: "https://nexraagency.com/services",
  fetchState: "fetched",
  httpStatus: 200,
  redirectHops: 0,
  redirectChain: [],
  contentType: "text/html; charset=utf-8",
  contentBytes: 40_000,
  robotsMeta: null,
  robotsTxtAllowed: true,
  canonicalHref: "https://nexraagency.com/services",
  canonicalResolved: "https://nexraagency.com/services",
  canonicalIsSelf: true,
  title: "Services",
  titleLength: 8,
  metaDescription: null,
  metaDescriptionLength: null,
  h1Count: 1,
  firstH1: "Services",
  h2Count: null, h3Count: null, imageCount: null, imagesWithoutAlt: null, xRobotsTag: null, robotsNoindex: null, robotsNofollow: null,
  wordCount: null, htmlLang: null, hreflangCount: null, hreflangMalformed: null, ogTagCount: null, ogTitle: null, ogImage: null, twitterCard: null, responseMs: null,
  schemaTypes: ["Organization"],
  schemaBlocks: 1,
  schemaParseFailed: false,
  inSitemap: null,
  depth: 1,
  internalLinksIn: 3,
  internalLinksOut: 9,
  fetchedAt: "2026-09-20T10:00:02.000Z",
  errorCode: null,
};

/** A URL discovered and never tried, as /privacy and /terms were. */
const SKIPPED: CrawlPage = {
  ...FETCHED,
  id: "page-2",
  url: "https://nexraagency.com/privacy",
  finalUrl: null,
  fetchState: "budget-skipped",
  httpStatus: null,
  contentType: null,
  robotsMeta: null,
  canonicalHref: null,
  canonicalResolved: null,
  canonicalIsSelf: null,
  title: null,
  titleLength: null,
  metaDescriptionLength: null,
  h1Count: null,
  schemaTypes: [],
  schemaBlocks: 0,
  depth: null,
  internalLinksOut: 0,
  fetchedAt: null,
};

const FAILED: CrawlPage = {
  ...FETCHED,
  id: "page-3",
  url: "https://nexraagency.com/old",
  fetchState: "http-error",
  httpStatus: 404,
  errorCode: "http-error",
};

const texts = (page: CrawlPage) => pageRow(page).cells.map((entry) => entry.cell.text);

describe("groupPages", () => {
  test("separates fetched, failed, and never-tried URLs", () => {
    const groups = groupPages([FETCHED, SKIPPED, FAILED]);
    assert.deepEqual(groups.fetched.map((p) => p.id), ["page-1"]);
    assert.deepEqual(groups.notFetched.map((p) => p.id), ["page-3"]);
    assert.deepEqual(groups.notReached.map((p) => p.id), ["page-2"]);
  });

  test("the verified crawl's shape: five fetched, two never reached", () => {
    const pages = [
      ...Array.from({ length: 5 }, (_, i) => ({ ...FETCHED, id: `f${i}` })),
      { ...SKIPPED, id: "s1" },
      { ...SKIPPED, id: "s2" },
    ];
    const groups = groupPages(pages);
    assert.equal(groups.fetched.length, 5);
    assert.equal(groups.notReached.length, 2);
    assert.equal(groups.notFetched.length, 0);
    // Seven rows in, seven rows out. Nothing is dropped on the floor.
    assert.equal(
      groups.fetched.length + groups.notReached.length + groups.notFetched.length,
      pages.length,
    );
  });

  test("a never-reached URL is not described as a clean result", () => {
    assert.match(GROUP_HEADING.notReached.note, /not a clean result/i);
    assert.match(GROUP_HEADING.notReached.title, /not reached within the budget/i);
  });
});

describe("a null is never a zero, a false, or an OK", () => {
  const forbidden = /^(0|no|false|ok|none|healthy|pass(ed)?)$/i;

  test("every unknown cell on a never-reached page reads as unknown", () => {
    for (const text of texts(SKIPPED)) {
      if (text === UNKNOWN) continue;
      // The only non-unknown cell on a skipped row is the crawl-scoped link
      // count, which is a real recorded zero rather than an absent reading.
      assert.equal(text, "0");
    }
    assert.equal(httpStatusCell(SKIPPED).text, UNKNOWN);
    assert.equal(depthCell(SKIPPED).text, UNKNOWN);
    assert.equal(canonicalCell(SKIPPED).text, UNKNOWN);
    assert.equal(schemaCell(SKIPPED).text, UNKNOWN);
    assert.equal(robotsMetaCell(SKIPPED).text, UNKNOWN);
    assert.equal(redirectCell(SKIPPED).text, UNKNOWN);
  });

  test("an absent status is not reported as anything passable", () => {
    const cell = httpStatusCell(SKIPPED);
    assert.doesNotMatch(cell.text, forbidden);
    assert.match(cell.title ?? "", /not established/i);
  });

  test("an unreadable sitemap leaves membership unknown, not 'No'", () => {
    assert.equal(inSitemapCell({ ...FETCHED, inSitemap: null }).text, UNKNOWN);
    assert.equal(inSitemapCell({ ...FETCHED, inSitemap: false }).text, "No");
    assert.equal(inSitemapCell({ ...FETCHED, inSitemap: true }).text, "Yes");
  });

  test("an unreadable robots.txt is never treated as permission", () => {
    const cell = robotsTxtCell({ ...FETCHED, robotsTxtAllowed: null });
    assert.equal(cell.text, UNKNOWN);
    assert.doesNotMatch(cell.text, /allow/i);
    assert.match(cell.title ?? "", /never treated as permission/i);
  });

  test("an absent meta description is unknown, not length zero", () => {
    assert.equal(countCell(null, "meta description").text, UNKNOWN);
    assert.equal(countCell(0, "meta description").text, "0");
  });
});

describe("readings that are easy to over-read", () => {
  test("a 200 is described as a server response, never as indexation", () => {
    const cell = httpStatusCell(FETCHED);
    assert.equal(cell.text, "200");
    assert.doesNotMatch(cell.title ?? "", /index/i);
  });

  test("no robots meta tag is not reported as index,follow", () => {
    const cell = robotsMetaCell(FETCHED);
    assert.equal(cell.text, "No directive");
    assert.match(cell.title ?? "", /not the same as index,follow/i);
  });

  test("no canonical declared is distinct from one pointing elsewhere", () => {
    assert.equal(canonicalCell({ ...FETCHED, canonicalIsSelf: null }).text, "None declared");
    assert.equal(canonicalCell({ ...FETCHED, canonicalIsSelf: false }).text, "Points elsewhere");
    assert.equal(canonicalCell(FETCHED).text, "Self");
  });

  test("schema is never called complete or partial", () => {
    assert.equal(schemaCell({ ...FETCHED, schemaBlocks: 0, schemaTypes: [] }).text, "None found");
    assert.equal(schemaCell({ ...FETCHED, schemaParseFailed: true }).text, "Unparseable");
    assert.equal(schemaCell(FETCHED).text, "1 block");
    for (const page of [FETCHED, { ...FETCHED, schemaBlocks: 0 }]) {
      assert.doesNotMatch(schemaCell(page).text, /complete|partial/i);
    }
  });

  test("internal link counts carry their crawl scope and never imply orphan status", () => {
    const column = COLUMNS.find((entry) => entry.key === "linksOut");
    assert.match(column?.title ?? "", /within this crawl only, never site-wide/i);
    assert.equal(
      COLUMNS.some((entry) => /orphan/i.test(entry.label)),
      false,
    );
  });

  test("no column claims indexation or Core Web Vitals", () => {
    for (const column of COLUMNS) {
      assert.doesNotMatch(column.label, /index|lcp|inp|cls|vital|score/i);
    }
  });

  test("the provenance note names what was not measured", () => {
    assert.match(PROVENANCE_NOTE, /Search Console/);
    assert.match(PROVENANCE_NOTE, /Core Web Vitals/);
    assert.match(PROVENANCE_NOTE, /200 is not an index entry/);
  });
});

describe("rows", () => {
  test("a row carries one cell per column, in order", () => {
    const row = pageRow(FETCHED);
    assert.deepEqual(
      row.cells.map((entry) => entry.key),
      COLUMNS.map((column) => column.key),
    );
  });

  test("redirects are reported as hops, and none is a real answer for a fetched page", () => {
    assert.equal(redirectCell(FETCHED).text, "None");
    assert.equal(
      redirectCell({ ...FETCHED, redirectHops: 1, finalUrl: "https://www.nexraagency.com/" }).text,
      "1 hop",
    );
    assert.equal(redirectCell({ ...FETCHED, redirectHops: 2 }).text, "2 hops");
  });

  test("the path is shown, with the whole URL kept", () => {
    assert.equal(pathOf("https://nexraagency.com/services"), "/services");
    assert.equal(pathOf("https://nexraagency.com/"), "/");
    assert.equal(pathOf("not a url"), "not a url");
    assert.equal(pageRow(FETCHED).url, FETCHED.url);
  });

  test("a failed fetch keeps its observed status and its own label", () => {
    assert.equal(httpStatusCell(FAILED).text, "404");
    assert.equal(pageRow(FAILED).state, "HTTP error");
  });
});
