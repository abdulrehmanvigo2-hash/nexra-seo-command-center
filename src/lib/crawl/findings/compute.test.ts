import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Crawl, CrawlLink, CrawlPage } from "../../../types/crawl.ts";
import { computeCrawlFindings } from "./compute.ts";
import {
  FINDINGS_LIMITATIONS,
  FINDINGS_RULE_VERSION,
  MAX_FINDINGS_PER_RULE,
  MAX_URLS_PER_FINDING,
  type CrawlFinding,
  type FindingRuleId,
} from "./contract.ts";
import { DEEP_PAGE_DEPTH, META_DESCRIPTION_MAX_LENGTH, RULES, TITLE_MAX_LENGTH, TITLE_MIN_LENGTH, isGenericAnchorText, metaForbidsIndexing, normaliseAnchorText, normaliseText, robotsDirectives } from "./rules.ts";

/**
 * Checkpoint T1. On trial: that every rule fires on exactly the observed
 * field it names and on nothing unknown; that duplicates are found within
 * one crawl only; that a broken link is reported only when its target was
 * fetched; that the output is ordered and its ids are stable; and that no
 * finding claims indexation, a site-wide total or an orphan.
 */

const CRAWL: Crawl = {
  id: "8f1c0d2e-0000-4000-8000-000000000001",
  projectId: "nexra-agency",
  startUrl: "https://nexraagency.com/",
  hostScope: "nexraagency.com",
  status: "partial",
  stopReason: "page-budget",
  budget: { maxPages: 50, maxDepth: 3, maxDurationMs: 60_000 },
  userAgent: "NexraBot/0.1 (+https://nexraagency.com/bot)",
  robotsState: "fetched",
  sitemapState: "fetched",
  pagesDiscovered: 7,
  pagesFetched: 5,
  pagesFailed: 1,
  error: null,
  createdBy: "00000000-0000-4000-8000-00000000000a",
  startedAt: "2026-09-20T10:00:00.000Z",
  finishedAt: "2026-09-20T10:00:04.500Z",
};

let n = 0;
/** A healthy fetched page; every rule's trigger is one override away. */
function page(path: string, overrides: Partial<CrawlPage> = {}): CrawlPage {
  n += 1;
  const url = `https://nexraagency.com${path}`;
  return {
    id: `page-${n}`,
    crawlId: CRAWL.id,
    url,
    finalUrl: url,
    fetchState: "fetched",
    httpStatus: 200,
    redirectHops: 0,
    redirectChain: [],
    contentType: "text/html; charset=utf-8",
    contentBytes: 20_000,
    robotsMeta: null,
    robotsTxtAllowed: true,
    canonicalHref: url,
    canonicalResolved: url,
    canonicalIsSelf: true,
    title: `Nexra Agency — ${path} page title here`,
    titleLength: 40,
    metaDescription: `A meta description of a sensible length for the ${path} page.`,
    metaDescriptionLength: 55,
    h1Count: 1,
    firstH1: "Heading",
    h2Count: null, h3Count: null, imageCount: null, imagesWithoutAlt: null, xRobotsTag: null, robotsNoindex: null, robotsNofollow: null,
    schemaTypes: ["WebPage"],
    schemaBlocks: 1,
    schemaParseFailed: false,
    inSitemap: true,
    depth: path === "/" ? 0 : 1,
    internalLinksIn: path === "/" ? 0 : 2,
    internalLinksOut: 3,
    fetchedAt: "2026-09-20T10:00:01.000Z",
    errorCode: null,
    ...overrides,
  };
}

const link = (from: string, to: string, extra: Partial<CrawlLink> = {}): CrawlLink => ({
  crawlId: CRAWL.id,
  fromUrl: `https://nexraagency.com${from}`,
  toUrl: to.startsWith("http") ? to : `https://nexraagency.com${to}`,
  rel: null,
  isInternal: true,
  anchorText: null,
  ...extra,
});

const run = (pages: CrawlPage[], links: CrawlLink[] = []) => computeCrawlFindings({ crawl: CRAWL, pages, links });
const rulesOf = (findings: readonly CrawlFinding[]) => findings.map((f) => f.rule);
const only = (pages: CrawlPage[], rule: FindingRuleId, links: CrawlLink[] = []) => run(pages, links).findings.filter((f) => f.rule === rule);

describe("a healthy crawl", () => {
  test("yields no findings, full coverage and the limitations", () => {
    const report = run([page("/"), page("/about")], [link("/", "/about")]);
    assert.deepEqual(report.findings, []);
    assert.deepEqual(report.counts, {});
    assert.deepEqual(report.truncatedRules, []);
    assert.equal(report.ruleVersion, FINDINGS_RULE_VERSION);
    assert.equal(report.limitations, FINDINGS_LIMITATIONS);
    assert.deepEqual(report.coverage, {
      crawlId: CRAWL.id,
      hostScope: "nexraagency.com",
      status: "partial",
      stopReason: "page-budget",
      robotsState: "fetched",
      sitemapState: "fetched",
      pagesTotal: 2,
      pagesFetched: 2,
      pagesNotFetched: 0,
      pagesNotReached: 0,
      linksTotal: 1,
      fetchStates: { fetched: 2 },
    });
  });
});

describe("titles and descriptions", () => {
  test("missing, short and long titles, by the recorded length", () => {
    const pages = [
      page("/none", { title: null, titleLength: null }),
      page("/empty", { title: "   ", titleLength: 3 }),
      page("/short", { title: "Short", titleLength: TITLE_MIN_LENGTH - 1 }),
      page("/edge-low", { titleLength: TITLE_MIN_LENGTH }),
      page("/edge-high", { titleLength: TITLE_MAX_LENGTH }),
      page("/long", { title: "x".repeat(70), titleLength: TITLE_MAX_LENGTH + 1 }),
    ];
    const report = run(pages);
    assert.deepEqual(report.findings.filter((f) => f.rule.startsWith("title-")).map((f) => [f.rule, f.urls[0].replace("https://nexraagency.com", "")]), [
      ["title-missing", "/empty"],
      ["title-long", "/long"],
      ["title-short", "/short"],
    ]);
    // A page whose title was never read (null title and null length) is unknown, not missing.
    assert.equal(report.findings.some((f) => f.urls[0].endsWith("/none")), false);
    const missing = report.findings.find((f) => f.rule === "title-missing")!;
    assert.deepEqual([missing.category, missing.severity, missing.observed], ["metadata", "high", { title: "   " }]);
  });

  test("missing and long meta descriptions; a null description with null length is unknown", () => {
    const pages = [
      page("/unknown", { metaDescription: null, metaDescriptionLength: null }),
      page("/missing", { metaDescription: "", metaDescriptionLength: 0 }),
      page("/long", { metaDescriptionLength: META_DESCRIPTION_MAX_LENGTH + 1 }),
      page("/edge", { metaDescriptionLength: META_DESCRIPTION_MAX_LENGTH }),
    ];
    assert.deepEqual(rulesOf(run(pages).findings), ["meta-description-missing", "meta-description-long"]);
  });

  test("duplicate titles and descriptions within one crawl, exact after whitespace collapse, excluding canonicalised and noindex pages", () => {
    const pages = [
      page("/a", { title: "Same  Title", metaDescription: "Same description" }),
      page("/b", { title: " Same Title ", metaDescription: "Same description" }),
      page("/c", { title: "same title" }),
      page("/canon", { title: "Same Title", canonicalHref: "https://nexraagency.com/a", canonicalResolved: "https://nexraagency.com/a", canonicalIsSelf: false }),
      page("/noindex", { title: "Same Title", robotsMeta: "noindex, follow" }),
    ];
    const report = run(pages);
    const dup = report.findings.find((f) => f.rule === "title-duplicate")!;
    assert.deepEqual(dup.urls, ["https://nexraagency.com/a", "https://nexraagency.com/b"]);
    assert.deepEqual(dup.observed, { title: "Same Title", pages: 2 });
    assert.equal(dup.urlCount, 2);
    const meta = report.findings.find((f) => f.rule === "meta-description-duplicate")!;
    assert.deepEqual(meta.urls, ["https://nexraagency.com/a", "https://nexraagency.com/b"]);
    assert.deepEqual(meta.observed, { metaDescription: "Same description", pages: 2 });
  });

  test("a page from another crawl never joins a duplicate group", () => {
    const foreign = { ...page("/x", { title: "Same Title" }), crawlId: "other-crawl" };
    const report = run([page("/a", { title: "Same Title" }), foreign]);
    assert.equal(report.findings.some((f) => f.rule === "title-duplicate"), false);
    assert.equal(report.coverage.pagesTotal, 1);
  });
});

describe("headings, canonicals and schema", () => {
  test("H1 missing and multiple; null count is unknown", () => {
    const report = run([page("/none", { h1Count: 0 }), page("/two", { h1Count: 2, firstH1: "First" }), page("/unknown", { h1Count: null })]);
    assert.deepEqual(rulesOf(report.findings), ["h1-missing", "h1-multiple"]);
    assert.deepEqual(report.findings[1].observed, { h1Count: 2, firstH1: "First" });
  });

  test("canonical unresolvable, elsewhere, and a canonical target that answered an error in this crawl", () => {
    const target = page("/gone", { fetchState: "http-error", httpStatus: 404, title: null, titleLength: null, metaDescription: null, metaDescriptionLength: null, h1Count: null, schemaBlocks: 0 });
    const pages = [
      page("/bad", { canonicalHref: "http://[", canonicalResolved: null, canonicalIsSelf: null }),
      page("/alias", { canonicalHref: "/gone", canonicalResolved: "https://nexraagency.com/gone", canonicalIsSelf: false }),
      page("/none", { canonicalHref: null, canonicalResolved: null, canonicalIsSelf: null }),
      target,
    ];
    const report = run(pages);
    const canonical = report.findings.filter((f) => f.category === "canonical").map((f) => [f.rule, f.urls[0].replace("https://nexraagency.com", "")]);
    assert.deepEqual(canonical, [
      ["canonical-target-error", "/alias"],
      ["canonical-unresolvable", "/bad"],
      ["canonical-elsewhere", "/alias"],
    ]);
    assert.deepEqual(report.findings.find((f) => f.rule === "canonical-target-error")!.observed, { canonicalResolved: "https://nexraagency.com/gone", targetHttpStatus: 404, targetFetchState: "http-error" });
    // A canonical to a page this crawl did not fetch says nothing about the target.
    const unfetched = run([page("/alias", { canonicalHref: "/elsewhere", canonicalResolved: "https://nexraagency.com/elsewhere", canonicalIsSelf: false })]);
    assert.deepEqual(rulesOf(unfetched.findings), ["canonical-elsewhere", "sitemap-lists-canonicalised"]);
  });

  test("JSON-LD missing and parse failures", () => {
    const report = run([page("/none", { schemaBlocks: 0, schemaTypes: [] }), page("/broken", { schemaParseFailed: true, schemaBlocks: 2 })]);
    assert.deepEqual(rulesOf(report.findings), ["schema-parse-failed", "schema-missing"]);
  });

  test("content rules look only at fetched HTML pages", () => {
    const pdf = page("/file.pdf", { fetchState: "non-html", contentType: "application/pdf", title: null, titleLength: null, h1Count: 0, schemaBlocks: 0 });
    const skipped = page("/later", { fetchState: "budget-skipped", httpStatus: null, title: null, titleLength: null, h1Count: 0, schemaBlocks: 0, depth: 4, inSitemap: null });
    assert.deepEqual(run([pdf, skipped]).findings, []);
  });
});

describe("HTTP, redirects and links", () => {
  test("4xx and 5xx by status; a null status is unknown", () => {
    const report = run([
      page("/404", { fetchState: "http-error", httpStatus: 404 }),
      page("/500", { fetchState: "http-error", httpStatus: 503 }),
      page("/timeout", { fetchState: "timeout", httpStatus: null }),
    ]);
    const http = report.findings.filter((f) => f.category === "http").map((f) => [f.rule, f.severity, f.observed.httpStatus]);
    assert.deepEqual(http, [["http-server-error", "critical", 503], ["http-client-error", "high", 404]]);
  });

  test("redirect chains from two hops; loops and exhausted redirects from the fetch state", () => {
    const report = run([
      page("/one-hop", { redirectHops: 1, redirectChain: ["https://nexraagency.com/one-hop"], finalUrl: "https://nexraagency.com/target" }),
      page("/chain", { redirectHops: 2, redirectChain: ["https://nexraagency.com/chain", "https://nexraagency.com/mid"], finalUrl: "https://nexraagency.com/end" }),
      page("/loop", { fetchState: "redirect-loop", httpStatus: null, redirectHops: 3, redirectChain: ["a", "b", "c"] }),
      page("/many", { fetchState: "too-many-redirects", httpStatus: null, redirectHops: 10, redirectChain: Array.from({ length: 10 }, (_, i) => `h${i}`) }),
    ]);
    const redirects = report.findings.filter((f) => f.category === "redirects").map((f) => [f.rule, f.urls[0].replace("https://nexraagency.com", "")]);
    assert.deepEqual(redirects, [["redirect-loop", "/loop"], ["redirect-loop", "/many"], ["redirect-chain", "/chain"]]);
    assert.deepEqual(report.findings.find((f) => f.rule === "redirect-chain")!.observed, { redirectHops: 2, redirectChain: "https://nexraagency.com/chain -> https://nexraagency.com/mid", finalUrl: "https://nexraagency.com/end" });
  });

  test("a broken internal link is reported only when the target was fetched with an error; unfetched and external targets never are", () => {
    const gone = page("/gone", { fetchState: "http-error", httpStatus: 410 });
    const pages = [page("/"), page("/about"), gone];
    const links = [
      link("/", "/gone"),
      link("/about", "/gone"),
      link("/", "/never-fetched"),
      link("/", "https://other.example/dead", { isInternal: false, anchorText: null }),
      link("/about", "/about"),
    ];
    const broken = only(pages, "internal-link-broken", links);
    assert.equal(broken.length, 1);
    assert.deepEqual(broken[0].urls, ["https://nexraagency.com/", "https://nexraagency.com/about"]);
    assert.deepEqual(broken[0].observed, { toUrl: "https://nexraagency.com/gone", targetHttpStatus: 410, targetFetchState: "http-error", linkingPages: 2 });
    assert.match(broken[0].message, /which answered 410/);
    // Two broken targets linked from the same pages are two findings with two ids.
    const gone2 = page("/gone-too", { fetchState: "http-error", httpStatus: 404 });
    const two = only([...pages, gone2], "internal-link-broken", [link("/", "/gone"), link("/", "/gone-too")]);
    assert.equal(two.length, 2);
    assert.notEqual(two[0].id, two[1].id);
    assert.deepEqual(two.map((f) => f.observed.toUrl).sort(), ["https://nexraagency.com/gone", "https://nexraagency.com/gone-too"]);
    // A target that failed without a status (timeout) is unknown, not broken.
    const timedOut = page("/slow", { fetchState: "timeout", httpStatus: null });
    assert.deepEqual(only([page("/"), timedOut], "internal-link-broken", [link("/", "/slow")]), []);
    // Edges from another crawl are ignored.
    assert.deepEqual(only(pages, "internal-link-broken", [{ ...link("/", "/gone"), crawlId: "other" }]), []);
  });
});

describe("indexability, sitemap and structure", () => {
  test("robots.txt disallow and robots-meta noindex; null robots fields are unknown", () => {
    const report = run([
      page("/blocked", { fetchState: "blocked-by-robots", httpStatus: null, robotsTxtAllowed: false, inSitemap: false }),
      page("/noindex", { robotsMeta: "NOINDEX,follow", inSitemap: false }),
      page("/none", { robotsMeta: "none", inSitemap: false }),
      page("/unknown", { robotsTxtAllowed: null, robotsMeta: null, inSitemap: null }),
    ]);
    assert.deepEqual(report.findings.map((f) => [f.rule, f.urls[0].replace("https://nexraagency.com", "")]), [
      ["robots-meta-noindex", "/noindex"],
      ["robots-meta-noindex", "/none"],
      ["robots-txt-disallowed", "/blocked"],
    ]);
    assert.deepEqual(robotsDirectives(" NOINDEX , nofollow"), ["noindex", "nofollow"]);
    assert.equal(metaForbidsIndexing(null), false);
    assert.equal(metaForbidsIndexing("index, follow"), false);
  });

  test("sitemap conflicts: noindex, error, blocked, canonicalised; only when inSitemap is true", () => {
    const report = run([
      page("/s-noindex", { robotsMeta: "noindex" }),
      page("/s-error", { fetchState: "http-error", httpStatus: 404 }),
      page("/s-blocked", { fetchState: "blocked-by-robots", httpStatus: null, robotsTxtAllowed: false }),
      page("/s-canon", { canonicalHref: "/other", canonicalResolved: "https://nexraagency.com/other", canonicalIsSelf: false }),
      page("/unknown-sitemap", { robotsMeta: "noindex", inSitemap: null }),
      page("/not-listed", { robotsMeta: "noindex", inSitemap: false }),
    ]);
    const sitemap = report.findings.filter((f) => f.category === "sitemap").map((f) => [f.rule, f.urls[0].replace("https://nexraagency.com", "")]);
    assert.deepEqual(sitemap, [
      ["sitemap-lists-error", "/s-error"],
      ["sitemap-lists-blocked", "/s-blocked"],
      ["sitemap-lists-noindex", "/s-noindex"],
      ["sitemap-lists-canonicalised", "/s-canon"],
    ]);
  });

  test("deep pages and pages with no observed inbound link; the start page and unknown depth are exempt", () => {
    const report = run([
      page("/", { internalLinksIn: 0 }),
      page("/deep", { depth: DEEP_PAGE_DEPTH + 1 }),
      page("/edge", { depth: DEEP_PAGE_DEPTH }),
      page("/from-sitemap", { depth: 1, internalLinksIn: 0 }),
      page("/unknown", { depth: null, internalLinksIn: 0 }),
    ]);
    assert.deepEqual(report.findings.map((f) => [f.rule, f.urls[0].replace("https://nexraagency.com", "")]), [
      ["no-inbound-links-in-crawl", "/from-sitemap"],
      ["page-deep", "/deep"],
    ]);
    assert.match(report.findings[0].message, /does not prove it is orphaned/);
  });
});

describe("output discipline", () => {
  test("ordered by severity, then rule, then URL; identical for shuffled input; ids stable and rule-prefixed", () => {
    const pages = [page("/b", { h1Count: 0 }), page("/a", { h1Count: 0 }), page("/e", { fetchState: "http-error", httpStatus: 500 }), page("/t", { title: "", titleLength: 0 })];
    const one = run(pages);
    const two = run([...pages].reverse());
    assert.deepEqual(one, two);
    assert.deepEqual(one.findings.map((f) => [f.severity, f.rule, f.urls[0].slice(-2)]), [
      ["critical", "http-server-error", "/e"],
      ["high", "sitemap-lists-error", "/e"],
      ["high", "title-missing", "/t"],
      ["medium", "h1-missing", "/a"],
      ["medium", "h1-missing", "/b"],
    ]);
    for (const f of one.findings) assert.match(f.id, new RegExp(`^${f.rule}:[0-9a-f]{16}$`));
    assert.notEqual(one.findings[3].id, one.findings[4].id);
    assert.equal(one.findings[3].id, run([page("/a", { h1Count: 0 })]).findings[0].id, "the same rule on the same URL has the same id in any crawl run");
  });

  test("per-rule cut with true counts, and URL lists cut with the true URL count", () => {
    const many = Array.from({ length: MAX_FINDINGS_PER_RULE + 5 }, (_, i) => page(`/p${String(i).padStart(3, "0")}`, { h1Count: 0, title: "Same", titleLength: 4 }));
    const report = run(many);
    assert.equal(report.counts["h1-missing"], MAX_FINDINGS_PER_RULE + 5);
    assert.equal(report.findings.filter((f) => f.rule === "h1-missing").length, MAX_FINDINGS_PER_RULE);
    assert.deepEqual(report.truncatedRules, ["h1-missing", "title-short"]);
    const dup = report.findings.find((f) => f.rule === "title-duplicate")!;
    assert.deepEqual([dup.urls.length, dup.urlCount], [MAX_URLS_PER_FINDING, MAX_FINDINGS_PER_RULE + 5]);
  });

  test("every rule has a category, a severity and a label, and the wording never claims indexation, ranking, vitals or orphans", () => {
    const rules = Object.keys(RULES) as FindingRuleId[];
    assert.equal(rules.length, 32);
    for (const rule of rules) assert.ok(RULES[rule].label.length > 0 && RULES[rule].category && RULES[rule].severity);
    const pages = [
      page("/", { internalLinksIn: 0 }),
      page("/x", { title: "", titleLength: 0, metaDescription: "", metaDescriptionLength: 0, h1Count: 2, robotsMeta: "noindex", schemaBlocks: 0, depth: 5, internalLinksIn: 0, canonicalHref: "/y", canonicalResolved: "https://nexraagency.com/y", canonicalIsSelf: false }),
      page("/y", { fetchState: "http-error", httpStatus: 500, redirectHops: 3, redirectChain: ["a", "b", "c"] }),
    ];
    const report = run(pages, [link("/", "/y")]);
    const text = JSON.stringify({ findings: report.findings, counts: report.counts }).toLowerCase();
    for (const word of ["indexed by google", "ranking", "core web vitals", "orphan page", "site-wide", "search volume"]) assert.ok(!text.includes(word), word);
    assert.ok(report.findings.length >= 8);
    assert.equal(normaliseText("  a \n b "), "a b");
  });
});

describe("T5 signals (rule version 2)", () => {
  test("the report is rule version 2, and a page recorded before the signals were kept yields none of the new findings", () => {
    const report = run([page("/", { h2Count: null, h3Count: null, imageCount: null, imagesWithoutAlt: null, xRobotsTag: null, robotsNoindex: null, robotsNofollow: null })], [link("/", "/a", { anchorText: null })]);
    assert.equal(report.ruleVersion, 2);
    assert.equal(FINDINGS_RULE_VERSION, 2);
    assert.deepEqual(report.findings, []);
  });

  test("heading-h3-without-h2 fires only when both counts are known, h2 is zero and h3 is positive", () => {
    assert.equal(only([page("/a", { h2Count: 0, h3Count: 2 })], "heading-h3-without-h2").length, 1);
    const [found] = only([page("/a", { h2Count: 0, h3Count: 2 })], "heading-h3-without-h2");
    assert.deepEqual(found.observed, { h1Count: 1, h2Count: 0, h3Count: 2 });
    assert.equal(found.message, "The page has 2 H3 heading(s) and no H2.");
    for (const over of [{ h2Count: 1, h3Count: 2 }, { h2Count: 0, h3Count: 0 }, { h2Count: null, h3Count: 2 }, { h2Count: 0, h3Count: null }]) {
      assert.equal(only([page("/b", over)], "heading-h3-without-h2").length, 0, JSON.stringify(over));
    }
  });

  test("image-alt-missing reports the images with no alt attribute against the page's image count, and nothing on zero or unknown", () => {
    const [found] = only([page("/a", { imageCount: 6, imagesWithoutAlt: 2 })], "image-alt-missing");
    assert.deepEqual(found.observed, { imageCount: 6, imagesWithoutAlt: 2 });
    assert.equal(found.message, "2 of 6 images on the page have no alt attribute.");
    assert.equal(found.category, "images");
    for (const over of [{ imageCount: 6, imagesWithoutAlt: 0 }, { imageCount: null, imagesWithoutAlt: 2 }, { imageCount: 6, imagesWithoutAlt: null }]) {
      assert.equal(only([page("/b", over)], "image-alt-missing").length, 0, JSON.stringify(over));
    }
  });

  test("robots-header-noindex reads the X-Robots-Tag of a page that answered, not an error page's, never null, and the sitemap rule sees it", () => {
    const [found] = only([page("/a", { xRobotsTag: "noindex, nofollow", inSitemap: false })], "robots-header-noindex");
    assert.deepEqual(found.observed, { xRobotsTag: "noindex, nofollow", robotsMeta: null, httpStatus: 200 });
    assert.equal(only([page("/pdf", { fetchState: "non-html", contentType: "application/pdf", xRobotsTag: "googlebot: noindex", inSitemap: false })], "robots-header-noindex").length, 1, "a non-HTML resource's header counts");
    assert.equal(only([page("/gone", { fetchState: "http-error", httpStatus: 404, xRobotsTag: "noindex" })], "robots-header-noindex").length, 0, "an error page saying noindex is unremarkable");
    assert.equal(only([page("/old", { xRobotsTag: null })], "robots-header-noindex").length, 0);
    assert.equal(only([page("/ok", { xRobotsTag: "index, follow" })], "robots-header-noindex").length, 0);
    const listed = only([page("/s", { xRobotsTag: "noindex", inSitemap: true })], "sitemap-lists-noindex");
    assert.equal(listed.length, 1);
    assert.equal(listed[0].message, "The sitemap lists a page whose X-Robots-Tag header says noindex.");
    assert.deepEqual(listed[0].observed, { inSitemap: true, robotsMeta: null, xRobotsTag: "noindex" });
    const meta = only([page("/m", { robotsMeta: "noindex", inSitemap: true })], "sitemap-lists-noindex");
    assert.equal(meta[0].message, "The sitemap lists a page whose robots meta says noindex.");
  });

  test("duplicate titles exclude a page whose derived robots reading says noindex", () => {
    const pages = [page("/a", { title: "Same", titleLength: 4 }), page("/b", { title: "Same", titleLength: 4, robotsNoindex: true }), page("/c", { title: "Same", titleLength: 4 })];
    const [dup] = only(pages, "title-duplicate");
    assert.deepEqual(dup.urls, ["https://nexraagency.com/a", "https://nexraagency.com/c"]);
  });

  test("anchor-text findings are per source page, over internal edges whose text was recorded, from pages this crawl recorded", () => {
    const pages = [page("/"), page("/a"), page("/b")];
    const links = [
      link("/", "/a", { anchorText: "" }),
      link("/", "/b", { anchorText: "   " }),
      link("/", "/x", { anchorText: "Click here!" }),
      link("/", "/y", { anchorText: "read more" }),
      link("/", "/z", { anchorText: "Our services" }),
      link("/a", "/b", { anchorText: null }),
      link("/a", "https://other.example/", { anchorText: "", isInternal: false }),
      link("/nowhere", "/b", { anchorText: "" }),
    ];
    const empty = only(pages, "link-anchor-empty", links);
    assert.equal(empty.length, 1);
    assert.deepEqual(empty[0].urls, ["https://nexraagency.com/"]);
    assert.deepEqual(empty[0].observed, { emptyAnchors: 2, internalLinksChecked: 5 });
    assert.equal(empty[0].message, "2 of 5 internal link(s) on the page have no anchor text and no image alt.");
    const generic = only(pages, "link-anchor-generic", links);
    assert.equal(generic.length, 1);
    assert.deepEqual(generic[0].observed, { genericAnchors: 2, internalLinksChecked: 5, examples: "click here, read more" });
    assert.equal(generic[0].message, "2 of 5 internal link(s) on the page use generic anchor text.");
    assert.equal(run(pages, [link("/a", "/b", { anchorText: null })]).findings.length, 0, "an edge with unknown text yields nothing");
  });

  test("generic anchor matching normalises case, whitespace and trailing punctuation, and empty is never generic", () => {
    for (const text of ["Click here", "CLICK  HERE.", " here ", "Read more »", "Learn more…", "More info:"]) assert.equal(isGenericAnchorText(text), true, text);
    for (const text of ["", "  ", "Pricing", "Read more about pricing", "here and now"]) assert.equal(isGenericAnchorText(text), false, text);
    assert.equal(normaliseAnchorText("  Read   More! "), "read more");
  });

  test("the new rules carry a category, severity and label, and the version-2 limitation is stated", () => {
    for (const rule of ["robots-header-noindex", "heading-h3-without-h2", "image-alt-missing", "link-anchor-empty", "link-anchor-generic"] as const) {
      assert.ok(RULES[rule].label.length > 0 && RULES[rule].severity && RULES[rule].category, rule);
    }
    assert.ok(FINDINGS_LIMITATIONS.some((line) => /an empty alt is a deliberate marker/.test(line) && /review prompts, not measurements/.test(line)));
  });
});
