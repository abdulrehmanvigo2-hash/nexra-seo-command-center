import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { RULES } from "../rules.ts";
import type { StoredCrawlFinding, StoredCrawlFindingsReport, StoredCrawlFindingsReportHeader } from "../store-contract.ts";
import {
  TRIAGE_NOTE_MAX_LENGTH,
  TRIAGE_STATUSES,
  TRIAGE_STATUS_META,
  isTriageStatus,
  normaliseTriageNote,
  parseTriageSetRequest,
  type FindingTriage,
} from "./contract.ts";
import {
  LATEST_FINDINGS_UNAVAILABLE_WORDING,
  NO_RECORDED_FINDINGS_WORDING,
  TRIAGED_FINDINGS_PROVENANCE_NOTE,
  TRIAGE_LIST_LIMIT,
  presentTriagedFindings,
} from "./present.ts";
import { latestFindingsReadFailure, latestFindingsReadRequest, latestFindingsUrl, triageSaveFailure, triageUrl } from "./request.ts";
import { CrawlFindingTriageRowError, setResultToOutcome, triageRowToTriage } from "./supabase/schema.ts";
import type { Crawl } from "../../../../types/crawl.ts";

/**
 * Milestone M3: an operator's decision about a recorded finding, kept apart
 * from the finding. Every case here is a way the decision could be confused
 * with the observation, or a screen could misstate either: a finding with no
 * decision shown as anything but open, a decision made on an earlier crawl
 * shown as this crawl's, another project's decision applied here, a cut list
 * read as the whole, or wording that lets "resolved" read as "fixed".
 */

const CRAWL_ID = "c0000000-0000-4000-8000-000000000001";
const OLDER_CRAWL_ID = "c0000000-0000-4000-8000-000000000000";

const CRAWL: Crawl = {
  id: CRAWL_ID,
  projectId: "nexra-agency",
  startUrl: "https://nexraagency.com/",
  hostScope: "nexraagency.com",
  status: "partial",
  stopReason: "page-budget",
  budget: { maxPages: 5, maxDepth: 1, maxDurationMs: 60_000 },
  userAgent: "NexraBot/0.1",
  robotsState: "fetched",
  sitemapState: "fetched",
  pagesDiscovered: 7,
  pagesFetched: 5,
  pagesFailed: 0,
  error: null,
  createdBy: "00000000-0000-4000-8000-00000000000a",
  startedAt: "2026-09-25T11:07:53.000Z",
  finishedAt: "2026-09-25T11:07:56.000Z",
};

const HEADER: StoredCrawlFindingsReportHeader = {
  id: "rep-1",
  crawlId: CRAWL_ID,
  projectId: "nexra-agency",
  ruleVersion: 3,
  coverage: { pagesTotal: 7, pagesFetched: 5, pagesNotFetched: 0, pagesNotReached: 2 },
  linksRead: 46,
  linksCut: false,
  findingsTotal: 5,
  counts: { "h1-missing": 1, "title-duplicate": 1, "meta-description-long": 2, "meta-description-duplicate": 1 },
  truncatedRules: [],
  recordedAt: "2026-09-25T11:07:56.000Z",
};

function finding(over: Partial<StoredCrawlFinding> & Pick<StoredCrawlFinding, "rule" | "ordinal">): StoredCrawlFinding {
  const meta = RULES[over.rule];
  return {
    id: `${over.rule}:${String(over.ordinal).padStart(16, "0")}`,
    category: meta.category,
    severity: meta.severity,
    urls: ["https://nexraagency.com/contact"],
    urlCount: 1,
    observed: {},
    message: `${meta.label}.`,
    ...over,
  };
}

const FINDINGS: readonly StoredCrawlFinding[] = [
  finding({ rule: "h1-missing", ordinal: 0, observed: { h1Count: 0 } }),
  finding({ rule: "title-duplicate", ordinal: 1, urls: ["https://nexraagency.com/", "https://www.nexraagency.com/"], urlCount: 2 }),
  finding({ rule: "meta-description-long", ordinal: 2, urls: ["https://nexraagency.com/"], observed: { metaDescriptionLength: 169 } }),
  finding({ rule: "meta-description-long", ordinal: 3, urls: ["https://www.nexraagency.com/"], observed: { metaDescriptionLength: 169 } }),
  finding({ rule: "meta-description-duplicate", ordinal: 4, urls: ["https://nexraagency.com/", "https://www.nexraagency.com/"], urlCount: 2 }),
];

const REPORT: StoredCrawlFindingsReport = { header: HEADER, findings: FINDINGS, findingsTruncated: false };

function decision(over: Partial<FindingTriage> & Pick<FindingTriage, "findingKey" | "status">): FindingTriage {
  return {
    id: `t-${over.findingKey}`,
    projectId: "nexra-agency",
    rule: over.findingKey.split(":")[0] ?? "",
    findingId: `f-${over.findingKey}`,
    reportId: "rep-1",
    crawlId: CRAWL_ID,
    note: null,
    setBy: "00000000-0000-4000-8000-00000000000a",
    setAt: "2026-09-25T12:00:00.000Z",
    createdAt: "2026-09-25T12:00:00.000Z",
    ...over,
  };
}

const UNSUPPORTED = /\b(indexed|indexation|ranking|rankings|traffic|Core Web Vitals|penalty|penalised|fixed on the site|site-wide total)\b/i;

describe("the triage vocabulary", () => {
  test("is exactly the four statuses, each with a label, tone and description that describe a decision, not the site", () => {
    assert.deepEqual([...TRIAGE_STATUSES], ["open", "acknowledged", "resolved", "ignored"]);
    for (const status of TRIAGE_STATUSES) {
      assert.ok(isTriageStatus(status));
      assert.ok(TRIAGE_STATUS_META[status].label.length > 0);
      assert.doesNotMatch(TRIAGE_STATUS_META[status].description, UNSUPPORTED);
    }
    assert.match(TRIAGE_STATUS_META.resolved.description, /operator says/);
    assert.match(TRIAGE_STATUS_META.resolved.description, /next crawl/);
    for (const bad of ["in-progress", "closed", "", null, undefined, 1, "Open"]) assert.equal(isTriageStatus(bad), false, String(bad));
  });

  test("a note is trimmed, blank means none, non-text is refused, and the table's length is the limit", () => {
    assert.deepEqual(normaliseTriageNote(undefined), { ok: true, note: null });
    assert.deepEqual(normaliseTriageNote(null), { ok: true, note: null });
    assert.deepEqual(normaliseTriageNote("   "), { ok: true, note: null });
    assert.deepEqual(normaliseTriageNote("  seen  "), { ok: true, note: "seen" });
    assert.deepEqual(normaliseTriageNote("x".repeat(TRIAGE_NOTE_MAX_LENGTH)), { ok: true, note: "x".repeat(500) });
    assert.deepEqual(normaliseTriageNote("x".repeat(TRIAGE_NOTE_MAX_LENGTH + 1)), { ok: false, reason: "too-long" });
    assert.deepEqual(normaliseTriageNote(12), { ok: false, reason: "not-text" });
    assert.deepEqual(normaliseTriageNote(["a"]), { ok: false, reason: "not-text" });
  });
});

describe("a triage request", () => {
  const body = { project: "nexra-agency", findingKey: "h1-missing:0123456789abcdef", status: "acknowledged", note: " seen " };

  test("is accepted only with a uuid crawl, a slug project, a well-formed key, one of the four statuses and at most these fields", () => {
    const ok = parseTriageSetRequest(CRAWL_ID.toUpperCase(), body);
    assert.deepEqual(ok, { ok: true, projectId: "nexra-agency", crawlId: CRAWL_ID, findingKey: body.findingKey, status: "acknowledged", note: "seen" });
    assert.deepEqual(parseTriageSetRequest(CRAWL_ID, { ...body, note: undefined }), { ...ok, note: null });
    for (const bad of [
      parseTriageSetRequest("not-a-uuid", body),
      parseTriageSetRequest(CRAWL_ID, null),
      parseTriageSetRequest(CRAWL_ID, [body]),
      parseTriageSetRequest(CRAWL_ID, { ...body, extra: 1 }),
      parseTriageSetRequest(CRAWL_ID, { ...body, project: "Nexra Agency" }),
      parseTriageSetRequest(CRAWL_ID, { ...body, project: "a".repeat(65) }),
      parseTriageSetRequest(CRAWL_ID, { ...body, findingKey: "h1-missing" }),
      parseTriageSetRequest(CRAWL_ID, { ...body, findingKey: "h1-missing:0123456789ABCDEF" }),
      parseTriageSetRequest(CRAWL_ID, { ...body, status: "in-progress" }),
      parseTriageSetRequest(CRAWL_ID, { ...body, note: "x".repeat(501) }),
      parseTriageSetRequest(CRAWL_ID, { ...body, note: 7 }),
    ]) {
      assert.deepEqual(bad, { ok: false, error: "invalid" });
    }
  });

  test("the endpoints are scoped: the read by project, the write by crawl", () => {
    assert.equal(latestFindingsUrl("nexra-agency"), "/api/crawls/latest-findings?project=nexra-agency");
    assert.equal(triageUrl(CRAWL_ID), `/api/crawls/${CRAWL_ID}/findings/triage`);
    assert.deepEqual(latestFindingsReadRequest("nexra-agency"), { ok: true, projectId: "nexra-agency" });
    for (const bad of [null, "", "Nexra", "-x", "a".repeat(65)]) assert.equal(latestFindingsReadRequest(bad).ok, false, String(bad));
  });

  test("a failed read never reads as a project with no findings, and a failed save never reads as saved", () => {
    for (const status of [0, 401, 404, 429, 500, 503]) {
      assert.doesNotMatch(latestFindingsReadFailure(status), /no findings|clean|healthy/i);
      for (const code of [null, "not-found", "not-recorded"]) {
        const text = triageSaveFailure(status, code);
        assert.doesNotMatch(text, /(?<!no decision |nothing )(was|is|has been) saved\b/, "a failure never reads as a success");
        assert.match(text, /no decision was saved|nothing was saved|not accepted|could not be saved|not stored|sign in again|try again/);
        assert.doesNotMatch(text, UNSUPPORTED);
      }
    }
    assert.match(triageSaveFailure(404, "not-recorded"), /no longer among the crawl's recorded findings/);
    assert.match(triageSaveFailure(404, null), /not one of this project's/);
    assert.match(triageSaveFailure(400, null), /four statuses/);
  });
});

describe("the stored row and the function's answer", () => {
  const row = {
    id: "t1", project_id: "nexra-agency", finding_key: "h1-missing:0123456789abcdef", rule: "h1-missing", finding_id: "f1", report_id: "rep-1", crawl_id: CRAWL_ID,
    status: "resolved", note: null, set_by: "00000000-0000-4000-8000-00000000000a", set_at: "2026-09-25T12:00:00+00:00", created_at: "2026-09-25T11:00:00+00:00",
  };

  test("a row is read field by field; a status or key the product does not know is refused, never guessed", () => {
    const triage = triageRowToTriage(row);
    assert.equal(triage.status, "resolved");
    assert.equal(triage.findingKey, row.finding_key);
    assert.equal(triage.note, null);
    assert.throws(() => triageRowToTriage({ ...row, status: "in-progress" }), CrawlFindingTriageRowError);
    assert.throws(() => triageRowToTriage({ ...row, finding_key: "title-missing:0123456789abcdef" }), CrawlFindingTriageRowError);
    assert.throws(() => triageRowToTriage({ ...row, note: 5 }), CrawlFindingTriageRowError);
    assert.throws(() => triageRowToTriage(null), CrawlFindingTriageRowError);
  });

  test("the answer maps to set with its previous status, not-found or not-recorded, and anything else is an error", () => {
    assert.deepEqual(setResultToOutcome({ outcome: "set", previous: null, triage: row }), { status: "set", previous: null, triage: triageRowToTriage(row) });
    assert.equal(setResultToOutcome({ outcome: "set", previous: "open", triage: row }).status, "set");
    assert.deepEqual(setResultToOutcome({ outcome: "not-found" }), { status: "not-found" });
    assert.deepEqual(setResultToOutcome({ outcome: "not-recorded" }), { status: "not-recorded" });
    assert.throws(() => setResultToOutcome({ outcome: "set", previous: "closed", triage: row }), CrawlFindingTriageRowError);
    assert.throws(() => setResultToOutcome({ outcome: "deleted" }), CrawlFindingTriageRowError);
  });
});

describe("the latest findings with their decisions, presented", () => {
  test("a finding with no decision is open, a decision is shown as recorded, and the counts cover every finding read", () => {
    const view = presentTriagedFindings(CRAWL, REPORT, [
      decision({ findingKey: FINDINGS[0]!.id, status: "acknowledged", note: "seen" }),
      decision({ findingKey: FINDINGS[2]!.id, status: "resolved" }),
    ]);
    assert.equal(view.crawl.id, CRAWL_ID);
    assert.equal(view.total, 5);
    assert.equal(view.read, 5);
    assert.equal(view.listed, 5);
    assert.deepEqual(view.rows.map((row) => row.status), ["acknowledged", "open", "resolved", "open", "open"]);
    assert.equal(view.rows[0]!.note, "seen");
    assert.equal(view.rows[0]!.decidedAt, "2026-09-25T12:00:00.000Z");
    assert.equal(view.rows[1]!.decidedAt, null);
    assert.deepEqual(view.statuses.map((entry) => [entry.status, entry.count]), [["open", 3], ["acknowledged", 1], ["resolved", 1], ["ignored", 0]]);
    assert.deepEqual(view.severities.map((entry) => [entry.severity, entry.count]), [["critical", 0], ["high", 0], ["medium", 2], ["low", 3]]);
    assert.equal(view.rows[1]!.pages.length, 2);
    assert.equal(view.rows[1]!.morePages, 0);
    assert.deepEqual(view.notes, []);
  });

  test("a decision made on an earlier crawl's finding with the same key applies, and says so", () => {
    const view = presentTriagedFindings(CRAWL, REPORT, [decision({ findingKey: FINDINGS[0]!.id, status: "ignored", crawlId: OLDER_CRAWL_ID })]);
    assert.equal(view.rows[0]!.status, "ignored");
    assert.equal(view.rows[0]!.decidedOnEarlierCrawl, true);
    assert.equal(view.rows[1]!.decidedOnEarlierCrawl, false);
  });

  test("another project's decision never applies here, even with the same key", () => {
    const view = presentTriagedFindings(CRAWL, REPORT, [decision({ findingKey: FINDINGS[0]!.id, status: "resolved", projectId: "other-project" })]);
    assert.equal(view.rows[0]!.status, "open");
    assert.equal(view.statuses[0]!.count, 5);
  });

  test("the list is cut at its limit with the true totals kept and the cut named; a cut read is named too", () => {
    const view = presentTriagedFindings(CRAWL, REPORT, [], 2);
    assert.equal(view.listed, 2);
    assert.equal(view.read, 5);
    assert.equal(view.total, 5);
    assert.deepEqual(view.rows.map((row) => row.rule), ["h1-missing", "title-duplicate"]);
    assert.match(view.notes[0] ?? "", /2 most severe findings are listed; 3 more were read/);
    assert.equal(TRIAGE_LIST_LIMIT, 50);

    const truncated = presentTriagedFindings(CRAWL, { ...REPORT, header: { ...HEADER, findingsTotal: 900 }, findingsTruncated: true }, []);
    assert.equal(truncated.total, 900);
    assert.match(truncated.notes[0] ?? "", /Only the first 5 of 900 recorded findings were read/);
    assert.equal(truncated.statuses[0]!.count, 5, "status counts cover the findings read, never the unread");
  });

  test("the wording claims nothing the rules cannot observe and keeps a decision apart from the site", () => {
    const view = presentTriagedFindings(CRAWL, REPORT, []);
    assert.equal(view.provenance, TRIAGED_FINDINGS_PROVENANCE_NOTE);
    assert.match(view.provenance, /decisions are what an operator recorded, never what the site did/);
    assert.match(view.provenance, /within this crawl, not site-wide/);
    assert.match(view.provenance, /nothing here is fixture data/);
    assert.match(view.coverage, /5 of 7 recorded pages fetched/);
    // Checkpoint 3.2: the crawl's own outcome leads, so a partial crawl never reads as a full one.
    assert.match(view.coverage, /^Stopped on the page budget\. 5 of 7/);
    for (const text of [NO_RECORDED_FINDINGS_WORDING, LATEST_FINDINGS_UNAVAILABLE_WORDING]) {
      assert.doesNotMatch(text, /no issues|clean|healthy/i);
    }
    assert.match(NO_RECORDED_FINDINGS_WORDING, /says nothing about the site/);
  });
});
