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
import { DEEP_PAGE_DEPTH, META_DESCRIPTION_MAX_LENGTH, RULES, TITLE_MAX_LENGTH, TITLE_MIN_LENGTH, metaForbidsIndexing, normaliseText, robotsDirectives } from "./rules.ts";

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
      link("/", "https://other.example/dead", { isInternal: false }),
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
    assert.deepEqual(two.map((f) => f.observed.toUrl), ["https://nexraagency.com/gone", "https://nexraagency.com/gone-too"]);
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
    assert.equal(rules.length, 27);
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
