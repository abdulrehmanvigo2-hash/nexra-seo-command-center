import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Crawl } from "../../../types/crawl.ts";
import { MAX_DESCRIBED_PER_RULE, MAX_FINDINGS_EVIDENCE_BYTES, FINDINGS_EVIDENCE_LIMITS_NOTE } from "./grounding.ts";
import { NO_RECORDED_FINDINGS_NOTE, NO_RECORDED_FINDING_FIRED_LINE, formatRecordedFindingsGrounding } from "./director-grounding.ts";
import type { StoredCrawlFinding, StoredCrawlFindingsReport } from "./store-contract.ts";

/**
 * The block the SEO Director reads beneath an upstream review: what this
 * product recorded, said as observations, bounded, and never as a clean bill
 * of health, a site-wide count, or a ranking effect.
 */

const CRAWL: Crawl = {
  id: "c0000000-0000-4000-8000-000000000001",
  projectId: "nexra-agency",
  startUrl: "https://nexraagency.com/",
  hostScope: "nexraagency.com",
  status: "partial",
  stopReason: "page-budget",
  budget: { maxPages: 50, maxDepth: 3, maxDurationMs: 60_000 },
  userAgent: "NexraBot/0.1",
  robotsState: "fetched",
  sitemapState: "absent",
  pagesDiscovered: 7,
  pagesFetched: 5,
  pagesFailed: 1,
  error: null,
  createdBy: "op",
  startedAt: "2026-09-20T10:00:00.000Z",
  finishedAt: "2026-09-20T10:00:04.500Z",
};

const bytes = (text: string) => new TextEncoder().encode(text).length;

function finding(i: number, rule: StoredCrawlFinding["rule"] = "h1-missing", urls: string[] = [`https://nexraagency.com/p${i}`]): StoredCrawlFinding {
  return { id: `${rule}:${String(i).padStart(16, "0")}`, rule, category: "headings", severity: "medium", urls, urlCount: urls.length, observed: { h1Count: 0 }, message: "The page has no H1.", ordinal: i };
}

function report(findings: readonly StoredCrawlFinding[], over: Partial<StoredCrawlFindingsReport["header"]> = {}, findingsTruncated = false): StoredCrawlFindingsReport {
  const counts: Record<string, number> = {};
  for (const f of findings) counts[f.rule] = (counts[f.rule] ?? 0) + 1;
  return {
    header: { id: "rep-1", crawlId: CRAWL.id, projectId: "nexra-agency", ruleVersion: 2, coverage: { pagesTotal: 7, pagesFetched: 5, pagesNotFetched: 1, pagesNotReached: 1 }, linksRead: 12, linksCut: false, findingsTotal: findings.length, counts, truncatedRules: [], recordedAt: "2026-09-20T10:00:05.000Z", ...over },
    findings,
    findingsTruncated,
  };
}

const recorded = (r: StoredCrawlFindingsReport) => formatRecordedFindingsGrounding(CRAWL.id, { status: "recorded", crawl: CRAWL, report: r });

describe("formatRecordedFindingsGrounding", () => {
  test("names the crawl, when and under which rule version the findings were recorded, the coverage, the counts per rule, and each finding by rule, URL, observed values and id", () => {
    const g = recorded(report([finding(0, "http-client-error", ["https://nexraagency.com/gone"]), finding(1)]));
    assert.match(g.text, /^RECORDED CRAWL FINDINGS \(observations by fixed rules this product applied when the crawl the review above was written from finished; read from this product's own records, not from the review, and not a model's reading\)\n/);
    assert.match(g.text, /Crawl: c0000000-0000-4000-8000-000000000001 of host nexraagency\.com, partial \(stopped on page-budget\), started 2026-09-20T10:00:00\.000Z, finished 2026-09-20T10:00:04\.500Z\./);
    assert.match(g.text, /Recorded: 2026-09-20T10:00:05\.000Z, report rep-1, rule version 2\./);
    assert.match(g.text, /Coverage: 7 pages recorded \(5 fetched and read, 1 not fetched, 1 not reached within the budget\); 12 link edges read\./);
    assert.match(g.text, /Findings: 2 in total across 2 rule\(s\) — h1-missing \(Missing H1\) ×1, http-client-error \(Client error \(4xx\)\) ×1\./);
    assert.ok(g.text.includes("- [http-client-error] medium · Client error (4xx) · https://nexraagency.com/gone · observed: h1Count=0 · The page has no H1. (id http-client-error:0000000000000000)"));
    assert.ok(g.text.endsWith(FINDINGS_EVIDENCE_LIMITS_NOTE));
    assert.deepEqual(g.summary, { status: "recorded", crawlId: CRAWL.id, reportId: "rep-1", ruleVersion: 2, recordedAt: "2026-09-20T10:00:05.000Z", findings: 2, described: 2, rules: 2, rulesCut: [], cutByBytes: 0, readCut: false, bytes: bytes(g.text) });
  });

  test("a report with no findings is one line that says no rule fired, and that this is not a clean bill of health", () => {
    const g = recorded(report([]));
    assert.ok(g.text.includes(NO_RECORDED_FINDING_FIRED_LINE));
    assert.match(NO_RECORDED_FINDING_FIRED_LINE, /not a clean bill of health/);
    assert.match(g.text, /Findings: 0 in total across 0 rule\(s\)\./);
    assert.equal(g.summary.findings, 0);
  });

  test("cuts each rule to MAX_DESCRIBED_PER_RULE, names the cut rules and a cut read, and keeps the true counts", () => {
    const many = Array.from({ length: MAX_DESCRIBED_PER_RULE + 4 }, (_, i) => finding(i));
    const g = recorded(report(many, { findingsTotal: 500, counts: { "h1-missing": 500 }, truncatedRules: ["h1-missing"] }, true));
    assert.equal(g.summary.described, MAX_DESCRIBED_PER_RULE);
    assert.deepEqual(g.summary.rulesCut, ["h1-missing"]);
    assert.equal(g.summary.readCut, true);
    assert.equal(g.summary.findings, 500);
    assert.match(g.text, /Findings: 500 in total across 1 rule\(s\) — h1-missing \(Missing H1\) ×500\. Rules shown at most 10 each: h1-missing\. Only the first 14 recorded findings were read; the counts are complete\./);
    assert.match(g.text, /link findings may be incomplete/.test(g.text) ? /never/ : /12 link edges read\./);
    const cut = recorded(report(many, { linksCut: true }));
    assert.match(cut.text, /cut at the read limit; link findings may be incomplete/);
  });

  test("stays under the byte ceiling, cutting findings with a note and always keeping the header and the limits", () => {
    const wide = Array.from({ length: 10 }, (_, i) => finding(i, "title-duplicate", Array.from({ length: 25 }, (_, j) => `https://nexraagency.com/${"x".repeat(800)}/${i}/${j}`)));
    const g = recorded(report(wide));
    assert.ok(g.summary.bytes <= MAX_FINDINGS_EVIDENCE_BYTES);
    assert.ok(g.summary.cutByBytes > 0);
    assert.equal(g.summary.described + g.summary.cutByBytes, 10);
    assert.match(g.text, /further recorded finding\(s\) were cut to keep this evidence within its size bound; the counts above are complete/);
    assert.ok(g.text.startsWith("RECORDED CRAWL FINDINGS"));
    assert.ok(g.text.endsWith(FINDINGS_EVIDENCE_LIMITS_NOTE));
  });

  test("nothing recorded is one fixed note per reason, each telling the Director to rank nothing on findings, with an empty summary", () => {
    for (const read of [{ status: "unavailable" }, { status: "not-found" }, { status: "not-recorded", crawl: CRAWL }] as const) {
      const g = formatRecordedFindingsGrounding(CRAWL.id, read);
      assert.equal(g.text, NO_RECORDED_FINDINGS_NOTE[read.status]);
      assert.match(g.text, /^RECORDED CRAWL FINDINGS: none/);
      assert.match(g.text, /Rank nothing on findings/);
      // The one mention of "no issues" is the negation itself; nothing else in the note reads as a clean result.
      assert.doesNotMatch(g.text.replace("not a statement that the site has no issues", ""), /no issues|clean/);
      assert.deepEqual(g.summary, { status: read.status, crawlId: CRAWL.id, reportId: null, ruleVersion: 0, recordedAt: null, findings: 0, described: 0, rules: 0, rulesCut: [], cutByBytes: 0, readCut: false, bytes: bytes(g.text) });
    }
    assert.match(NO_RECORDED_FINDINGS_NOTE["not-recorded"], /not a statement that the site has no issues/);
  });

  test("never claims a ranking, traffic or indexation effect, and says a finding is an observation, not a recommendation", () => {
    const g = recorded(report([finding(0)]));
    assert.doesNotMatch(g.text.replace(FINDINGS_EVIDENCE_LIMITS_NOTE, ""), /rank|traffic|index/i);
    assert.match(FINDINGS_EVIDENCE_LIMITS_NOTE, /A finding is an observation by a fixed rule\. What it means and what to do about it is the reviewer's inference and recommendation/);
  });
});
