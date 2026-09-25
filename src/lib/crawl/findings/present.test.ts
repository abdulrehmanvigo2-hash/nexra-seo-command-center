import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { FINDINGS_LIMITATIONS, MAX_FINDINGS_PER_RULE } from "./contract.ts";
import {
  CATEGORY_LABEL,
  FINDINGS_PROVENANCE_NOTE,
  FINDINGS_UNAVAILABLE_WORDING,
  SEVERITY_LABEL,
  SEVERITY_ORDER,
  UNKNOWN,
  coverageLine,
  noFindingsWording,
  notRecordedWording,
  observedEntries,
  presentFindings,
} from "./present.ts";
import { RULES } from "./rules.ts";
import type { StoredCrawlFinding, StoredCrawlFindingsReport, StoredCrawlFindingsReportHeader } from "./store-contract.ts";

/**
 * Every case here is a way a panel of recorded findings could tell a lie: a
 * cut list read as the whole, the rows on screen read as the count, an
 * absent observed value shown as a zero, a report with no findings read as
 * a clean site, or a crawl with nothing recorded read as a crawl with
 * nothing wrong. The wording is the feature, so the wording is asserted.
 */

const HEADER: StoredCrawlFindingsReportHeader = {
  id: "rep-1",
  crawlId: "c0000000-0000-4000-8000-000000000001",
  projectId: "nexra-agency",
  ruleVersion: 1,
  coverage: { pagesTotal: 12, pagesFetched: 9, pagesNotFetched: 2, pagesNotReached: 1 },
  linksRead: 40,
  linksCut: false,
  findingsTotal: 4,
  counts: { "http-server-error": 1, "title-missing": 2, "page-deep": 1 },
  truncatedRules: [],
  recordedAt: "2026-09-24T10:00:00.000Z",
};

function finding(over: Partial<StoredCrawlFinding> & Pick<StoredCrawlFinding, "rule" | "ordinal">): StoredCrawlFinding {
  const meta = RULES[over.rule];
  return {
    id: `${over.rule}:${String(over.ordinal).padStart(16, "0")}`,
    category: meta.category,
    severity: meta.severity,
    urls: ["https://halcyon.example/a"],
    urlCount: 1,
    observed: {},
    message: `${meta.label}.`,
    ...over,
  };
}

const FINDINGS: readonly StoredCrawlFinding[] = [
  finding({ rule: "http-server-error", ordinal: 0, urls: ["https://halcyon.example/api"], observed: { httpStatus: 503 } }),
  finding({ rule: "title-missing", ordinal: 1, urls: ["https://halcyon.example/a"], observed: { title: null } }),
  finding({ rule: "title-missing", ordinal: 2, urls: ["https://halcyon.example/b?x=1"], observed: { title: null } }),
  finding({ rule: "page-deep", ordinal: 3, observed: { depth: 5, inSitemap: false } }),
];

const REPORT: StoredCrawlFindingsReport = { header: HEADER, findings: FINDINGS, findingsTruncated: false };

describe("presentFindings", () => {
  test("summarises every severity in fixed order, zeros included, from the true counts", () => {
    const view = presentFindings(REPORT);
    assert.deepEqual(view.summary.map((s) => s.severity), SEVERITY_ORDER);
    assert.deepEqual(view.summary.map((s) => s.count), [1, 2, 0, 1]);
    assert.equal(view.total, 4);
    assert.equal(view.shown, 4);
    assert.equal(view.ruleVersion, 1);
    assert.equal(view.recordedAt, HEADER.recordedAt);
    for (const entry of view.summary) assert.deepEqual({ label: entry.label, tone: entry.tone }, SEVERITY_LABEL[entry.severity]);
  });

  test("groups by severity then rule in recorded order, leaving empty severities out", () => {
    const view = presentFindings(REPORT);
    assert.deepEqual(view.groups.map((g) => g.severity), ["critical", "high", "low"]);
    assert.deepEqual(view.groups.map((g) => g.rules.map((r) => r.rule)), [["http-server-error"], ["title-missing"], ["page-deep"]]);
    const title = view.groups[1].rules[0];
    assert.equal(title.label, RULES["title-missing"].label);
    assert.equal(title.categoryLabel, CATEGORY_LABEL.metadata);
    assert.equal(title.count, 2);
    assert.equal(title.shown, 2);
    assert.equal(title.cut, false);
    assert.deepEqual(title.findings.map((f) => f.pages.map((p) => p.path)), [["/a"], ["/b?x=1"]]);
    assert.deepEqual(title.findings[0].pages[0], { path: "/a", url: "https://halcyon.example/a" });
  });

  test("a rule's count is the recorded total, not the rows on screen, and a cut rule says so", () => {
    const header = { ...HEADER, findingsTotal: 105, counts: { "title-missing": 103, "http-server-error": 1, "page-deep": 1 }, truncatedRules: ["title-missing"] };
    const view = presentFindings({ header, findings: FINDINGS, findingsTruncated: false });
    const title = view.groups[1].rules[0];
    assert.equal(title.count, 103);
    assert.equal(title.shown, 2);
    assert.equal(title.cut, true);
    assert.equal(view.groups[1].count, 103);
    assert.equal(view.summary[1].count, 103);
    assert.equal(view.total, 105);
    assert.equal(view.notes.length, 1);
    assert.match(view.notes[0], new RegExp(`Missing title: only the first ${MAX_FINDINGS_PER_RULE} findings per rule were recorded`));
    assert.match(view.notes[0], /true total within this crawl/);
  });

  test("a rule counted in the header with no row on screen is still listed, with its count and no rows", () => {
    const header = { ...HEADER, findingsTotal: 3004, counts: { ...HEADER.counts, "schema-missing": 3000 } };
    const view = presentFindings({ header, findings: FINDINGS, findingsTruncated: true });
    const low = view.groups.find((g) => g.severity === "low");
    assert.ok(low);
    assert.deepEqual(low.rules.map((r) => [r.rule, r.count, r.shown, r.cut]), [["page-deep", 1, 1, false], ["schema-missing", 3000, 0, true]]);
    assert.equal(low.count, 3001);
    assert.match(view.notes[0], /Only the first 4 of 3004 recorded findings were read/);
  });

  test("a header count below the rows on screen never hides a row: the rows win", () => {
    const header = { ...HEADER, counts: { ...HEADER.counts, "title-missing": 1 } };
    const view = presentFindings({ header, findings: FINDINGS, findingsTruncated: false });
    const title = view.groups[1].rules[0];
    assert.equal(title.count, 2);
    assert.equal(title.cut, false);
  });

  test("a finding about more URLs than it lists says how many more", () => {
    const wide = finding({ rule: "title-duplicate", ordinal: 9, urls: ["https://halcyon.example/a", "https://halcyon.example/b"], urlCount: 31 });
    const view = presentFindings({ header: { ...HEADER, counts: { "title-duplicate": 1 }, findingsTotal: 1 }, findings: [wide], findingsTruncated: false });
    assert.equal(view.groups[0].rules[0].findings[0].morePages, 29);
    assert.equal(presentFindings(REPORT).groups[0].rules[0].findings[0].morePages, 0);
  });

  test("notes name a cut link read; nothing cut means no notes", () => {
    assert.deepEqual(presentFindings(REPORT).notes, []);
    const view = presentFindings({ header: { ...HEADER, linksCut: true }, findings: FINDINGS, findingsTruncated: false });
    assert.deepEqual(view.notes, ["The link edges were cut at the read limit when the findings were computed, so link findings may be incomplete."]);
  });

  test("the coverage line names what was not looked at, and the provenance note says what the findings are not", () => {
    const view = presentFindings(REPORT);
    assert.equal(view.coverage, "9 of 12 recorded pages fetched; 2 not fetched and 1 not reached were not looked at. 40 link edges read.");
    assert.equal(coverageLine({ ...HEADER, linksRead: 1, linksCut: true }), "9 of 12 recorded pages fetched; 2 not fetched and 1 not reached were not looked at. 1 link edge read, cut at the read limit.");
    assert.equal(view.provenance, FINDINGS_PROVENANCE_NOTE);
    assert.match(view.provenance, /within this crawl, not site-wide/);
    assert.match(view.provenance, /nothing here is fixture data/);
    for (const claim of ["indexed", "ranks", "traffic"]) assert.match(view.provenance, new RegExp(claim));
    // The same things the library's own limitations refuse to claim.
    assert.ok(FINDINGS_LIMITATIONS.some((line) => /Indexation is Search Console's to report/.test(line)));
  });
});

describe("observedEntries", () => {
  test("a null is the unknown marker with an explanation, never a zero, a No or an empty string", () => {
    const [entry] = observedEntries({ title: null });
    assert.equal(entry.text, UNKNOWN);
    assert.match(entry.title ?? "", /Not established/);
  });

  test("booleans read as Yes and No, numbers and strings as written, keys as words", () => {
    assert.deepEqual(observedEntries({ inSitemap: true, robotsTxtAllowed: false, httpStatus: 404, title: "Home" }), [
      { key: "in sitemap", text: "Yes" },
      { key: "robots txt allowed", text: "No" },
      { key: "http status", text: "404" },
      { key: "title", text: "Home" },
    ]);
  });
});

describe("wording for a report or a crawl with nothing to show", () => {
  test("no findings is never a clean bill: it names what was fetched, what was not looked at, and what it cannot say", () => {
    const text = noFindingsWording(HEADER);
    assert.equal(text, `None of the ${Object.keys(RULES).length} rules matched within the 9 pages this crawl fetched. 3 recorded pages not fetched or not reached were not looked at. This is not a clean result for the site, and it says nothing about indexation or rankings.`);
    assert.doesNotMatch(noFindingsWording({ ...HEADER, coverage: { pagesTotal: 1, pagesFetched: 1, pagesNotFetched: 0, pagesNotReached: 0 } }), /not looked at/);
  });

  test("nothing recorded reads by the crawl's own status, and never as a crawl with nothing wrong", () => {
    assert.match(notRecordedWording("running"), /still running/);
    assert.match(notRecordedWording("failed"), /failed before it finished/);
    assert.match(notRecordedWording("cancelled"), /cancelled/);
    assert.match(notRecordedWording("completed"), /run a new crawl/);
    assert.equal(notRecordedWording("partial"), notRecordedWording("completed"));
    for (const status of ["running", "failed", "cancelled", "completed", "partial"] as const) {
      assert.doesNotMatch(notRecordedWording(status), /no issues|clean|healthy/i);
    }
    assert.match(FINDINGS_UNAVAILABLE_WORDING, /not stored on this deployment/);
  });
});
