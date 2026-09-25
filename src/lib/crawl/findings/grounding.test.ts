import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Crawl, CrawlLink, CrawlPage } from "../../../types/crawl.ts";
import { CRAWL_REVIEW_INSTRUCTIONS, ON_PAGE_REVIEW_INSTRUCTIONS, ANSWER_READINESS_REVIEW_INSTRUCTIONS } from "../grounding.ts";
import { computeCrawlFindings } from "./compute.ts";
import { FINDINGS_LIMITATIONS, MAX_FINDINGS_PER_RULE } from "./contract.ts";
import {
  FINDINGS_EVIDENCE_LIMITS_NOTE,
  FINDINGS_LINK_LIMIT,
  MAX_DESCRIBED_PER_RULE,
  MAX_FINDINGS_EVIDENCE_BYTES,
  MAX_URLS_DESCRIBED,
  NO_FINDINGS_LINE,
  formatCrawlFindingsGrounding,
  unavailableCrawlFindingsGrounding,
} from "./grounding.ts";

/**
 * Checkpoint T2. On trial: that findings are serialised as citable
 * observations with rule ids and URLs, that the block is bounded per rule
 * and by bytes with honest cut notes, that an empty report is not called
 * clean, and that the limitations and the two instruction texts deny what
 * a crawl cannot show.
 */

const CRAWL: Crawl = {
  id: "8f1c0d2e-0000-4000-8000-000000000001",
  projectId: "nexra-agency",
  startUrl: "https://nexraagency.com/",
  hostScope: "nexraagency.com",
  status: "completed",
  stopReason: "completed",
  budget: { maxPages: 50, maxDepth: 3, maxDurationMs: 60_000 },
  userAgent: "NexraBot/0.1",
  robotsState: "fetched",
  sitemapState: "absent",
  pagesDiscovered: 3,
  pagesFetched: 3,
  pagesFailed: 0,
  error: null,
  createdBy: "00000000-0000-4000-8000-00000000000a",
  startedAt: "2026-09-20T10:00:00.000Z",
  finishedAt: "2026-09-20T10:00:04.500Z",
};

let n = 0;
function page(path: string, overrides: Partial<CrawlPage> = {}): CrawlPage {
  n += 1;
  const url = `https://nexraagency.com${path}`;
  return {
    id: `page-${n}`, crawlId: CRAWL.id, url, finalUrl: url, fetchState: "fetched", httpStatus: 200, redirectHops: 0, redirectChain: [],
    contentType: "text/html", contentBytes: 1000, robotsMeta: null, robotsTxtAllowed: true, canonicalHref: url, canonicalResolved: url, canonicalIsSelf: true,
    title: `Title for ${path} that is long enough to pass`, titleLength: 40, metaDescription: `Description for ${path}`, metaDescriptionLength: 30,
    h1Count: 1, firstH1: "H1", h2Count: null, h3Count: null, imageCount: null, imagesWithoutAlt: null, xRobotsTag: null, robotsNoindex: null, robotsNofollow: null, schemaTypes: ["WebPage"], schemaBlocks: 1, schemaParseFailed: false, inSitemap: null, depth: path === "/" ? 0 : 1,
    internalLinksIn: path === "/" ? 0 : 1, internalLinksOut: 1, fetchedAt: "2026-09-20T10:00:01.000Z", errorCode: null, ...overrides,
  };
}
const bytes = (text: string) => new TextEncoder().encode(text).length;
const format = (pages: CrawlPage[], links: CrawlLink[] = [], read = links.length, cut = false) =>
  formatCrawlFindingsGrounding(computeCrawlFindings({ crawl: CRAWL, pages, links }), { read, cut });

describe("the findings block", () => {
  test("names its coverage, the counts per rule, and each finding by rule id, severity, URL, observed values and id", () => {
    const g = format([page("/"), page("/a", { h1Count: 0 }), page("/b", { fetchState: "http-error", httpStatus: 404, inSitemap: true })]);
    assert.match(g.text, /^DETERMINISTIC CRAWL FINDINGS \(fixed rules this product applied[^\n]*observations, not a model's reading\)\n/);
    assert.match(g.text, /Coverage: 3 pages recorded \(2 fetched and read, 1 not fetched, 0 not reached within the budget\); 0 link edges read; crawl completed, stopped on completed; robots.txt fetched; sitemap absent; host nexraagency\.com; rule version 2\./);
    assert.match(g.text, /Findings: 3 in total across 3 rule\(s\) — h1-missing ×1, http-client-error ×1, sitemap-lists-error ×1\./);
    assert.ok(g.text.includes('- [http-client-error] high · Client error (4xx) · https://nexraagency.com/b · observed: httpStatus=404; fetchState="http-error" · The page answered 404. (id http-client-error:'));
    assert.ok(g.text.includes("- [h1-missing] medium · Missing H1 · https://nexraagency.com/a · observed: h1Count=0 · The page has no H1. (id h1-missing:"));
    assert.ok(g.text.endsWith(FINDINGS_EVIDENCE_LIMITS_NOTE));
    assert.deepEqual(g.summary, { status: "available", ruleVersion: 2, findings: 3, described: 3, rules: 3, rulesCut: [], cutByBytes: 0, linksRead: 0, linksCut: false, bytes: bytes(g.text) });
  });

  test("an empty report says no rule fired and is not a clean bill of health", () => {
    const g = format([page("/"), page("/a")]);
    assert.match(g.text, /Findings: 0 in total across 0 rule\(s\)\.\n\n/);
    assert.ok(g.text.includes(NO_FINDINGS_LINE));
    assert.match(NO_FINDINGS_LINE, /not a clean bill of health/);
    assert.deepEqual([g.summary.findings, g.summary.described], [0, 0]);
  });

  test("the same report always gives the same text, in severity, rule, URL order", () => {
    const pages = [page("/z", { h1Count: 0 }), page("/a", { h1Count: 0 }), page("/e", { fetchState: "http-error", httpStatus: 500 })];
    const one = format(pages);
    const two = format([...pages].reverse());
    assert.equal(one.text, two.text);
    const lines = one.text.split("\n").filter((l) => l.startsWith("- ["));
    assert.deepEqual(lines.map((l) => l.slice(0, l.indexOf("·") + 1).trim()), ["- [http-server-error] critical ·", "- [h1-missing] medium ·", "- [h1-missing] medium ·"]);
    assert.ok(lines[1].includes("/a") && lines[2].includes("/z"));
  });

  test("at most 10 findings per rule are described, with the rule named as cut and the true count kept", () => {
    const pages = Array.from({ length: 14 }, (_, i) => page(`/p${String(i).padStart(2, "0")}`, { h1Count: 0 }));
    const g = format(pages);
    assert.equal((g.text.match(/^- \[h1-missing\]/gm) ?? []).length, MAX_DESCRIBED_PER_RULE);
    assert.match(g.text, /h1-missing ×14\. Rules shown at most 10 each: h1-missing\./);
    assert.deepEqual([g.summary.findings, g.summary.described, g.summary.rulesCut], [14, 10, ["h1-missing"]]);
    assert.equal(MAX_DESCRIBED_PER_RULE, 10);
  });

  test("a finding naming many URLs shows five and the true count", () => {
    const pages = Array.from({ length: 8 }, (_, i) => page(`/d${i}`, { title: "Same Title", titleLength: 10 }));
    const g = format(pages);
    assert.match(g.text, /\[title-duplicate\] medium · Duplicate title · https:\/\/nexraagency\.com\/d0, https:\/\/nexraagency\.com\/d1, https:\/\/nexraagency\.com\/d2, https:\/\/nexraagency\.com\/d3, https:\/\/nexraagency\.com\/d4 \(\+3 more of 8\)/);
    assert.equal(MAX_URLS_DESCRIBED, 5);
  });

  test("the whole block stays under 16,000 bytes: findings are cut in order with a note, counts and the limits kept", () => {
    const long = "p".repeat(400);
    const pages = Array.from({ length: 60 }, (_, i) => page(`/${long}${String(i).padStart(2, "0")}`, { h1Count: 0, schemaBlocks: 0, metaDescription: "", metaDescriptionLength: 0, title: "", titleLength: 0, robotsMeta: "noindex" }));
    const g = format(pages);
    assert.ok(bytes(g.text) <= MAX_FINDINGS_EVIDENCE_BYTES, `${bytes(g.text)} bytes`);
    assert.equal(g.summary.bytes, bytes(g.text));
    assert.ok(g.summary.cutByBytes > 0);
    assert.match(g.text, /\(\d+ further finding\(s\) were cut to keep this evidence within its size bound; the counts above are complete\)/);
    assert.ok(g.text.endsWith(FINDINGS_EVIDENCE_LIMITS_NOTE));
    assert.match(g.text, /Findings: 300 in total across 5 rule\(s\)/);
    assert.equal(g.summary.described + g.summary.cutByBytes, 5 * MAX_DESCRIBED_PER_RULE);
    assert.equal(MAX_FINDINGS_EVIDENCE_BYTES, 16_000);
  });

  test("a link read at the limit is reported as cut in the coverage line", () => {
    const g = format([page("/")], [], FINDINGS_LINK_LIMIT, true);
    assert.match(g.text, /5000 link edges read \(cut at 5000; link findings may be incomplete\)/);
    assert.equal(g.summary.linksCut, true);
  });

  test("the per-rule cut of the report itself (100) is also named", () => {
    const pages = Array.from({ length: MAX_FINDINGS_PER_RULE + 1 }, (_, i) => page(`/q${String(i).padStart(3, "0")}`, { schemaBlocks: 0 }));
    const g = format(pages);
    assert.deepEqual(g.summary.rulesCut, ["schema-missing"]);
    assert.match(g.text, /schema-missing ×101/);
  });

  test("unavailable findings are one note that tells the model to infer nothing", () => {
    const g = unavailableCrawlFindingsGrounding();
    assert.match(g.text, /^DETERMINISTIC CRAWL FINDINGS: unavailable\./);
    assert.match(g.text, /do not infer findings in their place/);
    assert.deepEqual([g.summary.status, g.summary.findings, g.summary.described], ["unavailable", 0, 0]);
  });
});

describe("limits and instructions", () => {
  test("the limits note restates every T1 limitation and adds the observation/inference split and the no-cannibalisation line", () => {
    for (const line of FINDINGS_LIMITATIONS) assert.ok(FINDINGS_EVIDENCE_LIMITS_NOTE.includes(line));
    for (const phrase of ["Nothing here is a site-wide total", "No finding says whether Google has indexed", "not proven to be orphaned", "External links are never fetched and are never called broken", "no Core Web Vitals, no search volume, no rankings", "the reviewer's inference and recommendation", "no cannibalisation conclusion can be drawn"]) {
      assert.ok(FINDINGS_EVIDENCE_LIMITS_NOTE.includes(phrase), `missing: ${phrase}`);
    }
  });

  test("the Technical SEO and On-Page instructions tell the agent how to cite findings and what never to extend them to; the AI Visibility instructions are unchanged", () => {
    for (const instructions of [CRAWL_REVIEW_INSTRUCTIONS, ON_PAGE_REVIEW_INSTRUCTIONS]) {
      for (const phrase of [
        "Where a DETERMINISTIC CRAWL FINDINGS block follows the crawl evidence",
        "cite it by its rule id in square brackets and the exact URL or URLs it names",
        "treat it as OBSERVED",
        "State the coverage that block gives (pages fetched, link edges read, anything cut)",
        "never extend a finding to pages it does not name, to indexation, rankings",
        "If the block says findings are unavailable or no rule fired, say so and infer nothing in their place",
      ]) {
        assert.ok(instructions.includes(phrase), `missing: ${phrase}`);
      }
    }
    assert.ok(CRAWL_REVIEW_INSTRUCTIONS.includes("keep your own reading and next step as INFERENCE and RECOMMENDATION"));
    assert.ok(ON_PAGE_REVIEW_INSTRUCTIONS.includes("keep your proposed change as RECOMMENDATION"));
    assert.ok(ON_PAGE_REVIEW_INSTRUCTIONS.includes("You cannot edit, publish, or change any page"));
    assert.ok(!ANSWER_READINESS_REVIEW_INSTRUCTIONS.includes("DETERMINISTIC CRAWL FINDINGS"));
  });
});
