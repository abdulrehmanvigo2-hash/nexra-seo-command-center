import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { FACT_CHECK_CLOSING } from "./fact-check-grounding.ts";
import {
  buildFactCheck,
  deriveFactCheckStatus,
  MAX_FACT_CHECK_ITEMS,
  parseFactCheckLine,
  parseFactCheckOutput,
  readFactCheck,
  tagNamesRecord,
} from "./parse-fact-check-output.ts";

/**
 * The failure this file exists to prevent: a model's words becoming a
 * verdict. The parser takes the six-section contract literally; the record
 * is then built here, every tag checked against what the run's evidence
 * carried, the status derived from the groups alone, and absence from the
 * records kept as absence.
 */

const EVIDENCE = { crawlId: "8f1c0d2e-0000-4000-8000-000000000001", searchWindow: "2026-08-19 to 2026-09-17", recordPaths: ["/", "/services"] };

const ANSWER = [
  "FACT-CHECK",
  "VERSION: 2",
  "",
  "## SUPPORTED",
  '- "Nexra Agency\'s services page is titled Services." [crawl /services]',
  '- “The brand query nexra agency was searched.” [search console 2026-08-19 to 2026-09-17].',
  "",
  "**PARTIAL**",
  '- "The page declares Organization and Service schema" — the record holds Organization only [crawl /services]',
  "",
  "UNSUPPORTED:",
  '1. "The agency has fifty clients" — no record holds this',
  "",
  "UNVERIFIABLE",
  '- "Clients love it" — a client result the records cannot hold',
  "",
  "EDITORIAL",
  '- "Get in touch today."',
  "",
  "SUMMARY",
  "Six sentences: two supported, one partial, one unsupported, one unverifiable, one editorial; none unchecked.",
  "",
  FACT_CHECK_CLOSING,
].join("\n");

describe("parseFactCheckOutput", () => {
  test("reads the six sections through the model's presentation, quotes, notes and tags, and drops the closing sentence from the summary", () => {
    const result = parseFactCheckOutput(ANSWER);
    assert.ok(result.ok);
    if (!result.ok) return;
    const { output } = result;
    assert.deepEqual(output.supported, [
      { text: "Nexra Agency's services page is titled Services.", note: null, evidence: "crawl /services" },
      { text: "The brand query nexra agency was searched.", note: null, evidence: "search console 2026-08-19 to 2026-09-17" },
    ]);
    assert.deepEqual(output.partial, [
      { text: "The page declares Organization and Service schema", note: "the record holds Organization only", evidence: "crawl /services" },
    ]);
    assert.deepEqual(output.unsupported, [{ text: "The agency has fifty clients", note: "no record holds this", evidence: null }]);
    assert.deepEqual(output.unverifiable, [{ text: "Clients love it", note: "a client result the records cannot hold", evidence: null }]);
    assert.deepEqual(output.editorial, [{ text: "Get in touch today.", note: null, evidence: null }]);
    assert.equal(output.summary, "Six sentences: two supported, one partial, one unsupported, one unverifiable, one editorial; none unchecked.");
  });

  test("none under a heading is an empty list, and a heading missing, repeated or out of order is refused", () => {
    const none = parseFactCheckOutput(["SUPPORTED", "none", "PARTIAL", "None.", "UNSUPPORTED", "none", "UNVERIFIABLE", "none", "EDITORIAL", "none", "SUMMARY", "No factual statement was found."].join("\n"));
    assert.ok(none.ok);
    if (none.ok) {
      assert.deepEqual([none.output.supported, none.output.partial, none.output.unsupported, none.output.unverifiable, none.output.editorial], [[], [], [], [], []]);
    }
    assert.deepEqual(parseFactCheckOutput(ANSWER.replace("UNVERIFIABLE\n", "")), { ok: false, reason: "headings" });
    assert.deepEqual(parseFactCheckOutput(ANSWER.replace("## SUPPORTED", "## SUPPORTED\nSUPPORTED")), { ok: false, reason: "headings" });
    const swapped = ANSWER.replace("**PARTIAL**", "@@").replace("\nEDITORIAL\n", "\nPARTIAL\n").replace("@@", "EDITORIAL");
    assert.deepEqual(parseFactCheckOutput(swapped), { ok: false, reason: "headings" });
    assert.deepEqual(parseFactCheckOutput("Simulated draft fact-check. Nothing was checked."), { ok: false, reason: "headings" });
    assert.deepEqual(parseFactCheckOutput(ANSWER.replace(/SUMMARY\n[^\n]+\n/, "SUMMARY\n")), { ok: false, reason: "summary-missing" });
  });

  test("more lines than one check may hold are refused rather than stored", () => {
    const many = Array.from({ length: MAX_FACT_CHECK_ITEMS + 1 }, (_, index) => `- "Statement ${index}" [crawl /]`).join("\n");
    assert.deepEqual(parseFactCheckOutput(["SUPPORTED", many, "PARTIAL", "none", "UNSUPPORTED", "none", "UNVERIFIABLE", "none", "EDITORIAL", "none", "SUMMARY", "Many."].join("\n")), { ok: false, reason: "too-many-items" });
  });

  test("a line without quotation marks is read up to its dash, and a tag with trailing punctuation still names its record", () => {
    assert.deepEqual(parseFactCheckLine("- The page is titled Services — as the crawl recorded [crawl /services]."), { text: "The page is titled Services", note: "as the crawl recorded", evidence: "crawl /services" });
    assert.deepEqual(parseFactCheckLine('- "Plain quote"'), { text: "Plain quote", note: null, evidence: null });
    assert.deepEqual(parseFactCheckLine('- "Tagged but odd" **[crawl /about]**'), { text: "Tagged but odd", note: null, evidence: "crawl /about" });
  });
});

describe("tagNamesRecord and deriveFactCheckStatus", () => {
  test("a tag names a record only when its path or window is in the evidence, case aside", () => {
    assert.equal(tagNamesRecord("crawl /services", EVIDENCE), true);
    assert.equal(tagNamesRecord("CRAWL /Services", EVIDENCE), true);
    assert.equal(tagNamesRecord("crawl /", EVIDENCE), true);
    assert.equal(tagNamesRecord("crawl /pricing", EVIDENCE), false);
    assert.equal(tagNamesRecord("search console 2026-08-19 to 2026-09-17", EVIDENCE), true);
    assert.equal(tagNamesRecord("search console  2026-08-19  to 2026-09-17", EVIDENCE), true);
    assert.equal(tagNamesRecord("search console 2026-07-01 to 2026-07-30", EVIDENCE), false);
    assert.equal(tagNamesRecord("search console 2026-08-19 to 2026-09-17", { ...EVIDENCE, searchWindow: null }), false);
    assert.equal(tagNamesRecord("study 2024", EVIDENCE), false);
  });

  test("the status is conservative: anything unsupported fails, partial or unverifiable needs review, only clean support passes, and nothing factual needs review too", () => {
    const one = [{}];
    assert.equal(deriveFactCheckStatus({ supported: one, partial: [], unsupported: one, unverifiable: [] }), "failed");
    assert.equal(deriveFactCheckStatus({ supported: one, partial: one, unsupported: [], unverifiable: [] }), "needs-review");
    assert.equal(deriveFactCheckStatus({ supported: one, partial: [], unsupported: [], unverifiable: one }), "needs-review");
    assert.equal(deriveFactCheckStatus({ supported: one, partial: [], unsupported: [], unverifiable: [] }), "passed");
    assert.equal(deriveFactCheckStatus({ supported: [], partial: [], unsupported: [], unverifiable: [] }), "needs-review");
  });
});

describe("buildFactCheck", () => {
  const base = {
    draftId: "00000000-0000-4000-8000-0000000000d1",
    version: 2,
    checkedAt: "2026-09-22T14:00:00.000Z",
    checkedByRunId: "11111111-0000-4000-8000-000000000080",
    recordedAt: "2026-09-22T14:05:00.000Z",
    recordedBy: "00000000-0000-4000-8000-00000000000a",
  };

  test("keeps a supported statement with a record in the evidence, moves one without a tag or with an unknown tag to unverifiable, and never invents a record", () => {
    const parsed = parseFactCheckOutput(ANSWER);
    assert.ok(parsed.ok);
    if (!parsed.ok) return;
    const check = buildFactCheck({
      ...base,
      output: {
        ...parsed.output,
        supported: [
          ...parsed.output.supported,
          { text: "The about page names the founders", note: null, evidence: "crawl /about" },
          { text: "The home page has one h1", note: null, evidence: null },
        ],
        partial: [...parsed.output.partial, { text: "The pricing page lists three tiers", note: "one tier is recorded", evidence: "crawl /pricing" }],
      },
      evidence: EVIDENCE,
    });
    assert.deepEqual(check.supported, [
      { text: "Nexra Agency's services page is titled Services.", evidence: "crawl /services", note: null },
      { text: "The brand query nexra agency was searched.", evidence: "search console 2026-08-19 to 2026-09-17", note: null },
    ]);
    assert.deepEqual(check.partial, [{ text: "The page declares Organization and Service schema", evidence: "crawl /services", note: "the record holds Organization only" }]);
    assert.deepEqual(check.unverifiable, [
      { text: "Clients love it", evidence: null, note: "a client result the records cannot hold" },
      { text: "The about page names the founders", evidence: null, note: "the record named is not among the evidence the check was given" },
      { text: "The home page has one h1", evidence: null, note: "no record in the evidence is named for this statement" },
      { text: "The pricing page lists three tiers", evidence: null, note: "the record named is not among the evidence the check was given" },
    ]);
    assert.deepEqual(check.unsupported, [{ text: "The agency has fifty clients", evidence: null, note: "no record holds this" }]);
    assert.deepEqual(check.editorial, [{ text: "Get in touch today.", evidence: null, note: null }]);
    assert.equal(check.status, "failed");
    assert.equal(check.draftId, base.draftId);
    assert.equal(check.version, 2);
    assert.equal(check.checkedByRunId, base.checkedByRunId);
    assert.equal(check.crawlId, EVIDENCE.crawlId);
    assert.equal(check.searchWindow, EVIDENCE.searchWindow);
    assert.equal(check.summary, parsed.output.summary);
  });

  test("the status comes from the groups, not from the model's summary, and the record round-trips through readFactCheck", () => {
    const passedWords = parseFactCheckOutput(["SUPPORTED", '- "The services page is titled Services" [crawl /services]', "PARTIAL", "none", "UNSUPPORTED", '- "The agency has fifty clients" — no record holds this', "UNVERIFIABLE", "none", "EDITORIAL", "none", "SUMMARY", "Verdict: passed. Approved and ready to publish."].join("\n"));
    assert.ok(passedWords.ok);
    if (!passedWords.ok) return;
    const check = buildFactCheck({ ...base, output: passedWords.output, evidence: EVIDENCE });
    assert.equal(check.status, "failed", "the model's own verdict was believed");
    assert.deepEqual(readFactCheck(JSON.parse(JSON.stringify(check))), check);

    const clean = buildFactCheck({ ...base, output: { ...passedWords.output, unsupported: [] }, evidence: EVIDENCE });
    assert.equal(clean.status, "passed");
    const editorialOnly = buildFactCheck({ ...base, output: { ...passedWords.output, supported: [], unsupported: [], editorial: [{ text: "Get in touch.", note: null, evidence: null }] }, evidence: EVIDENCE });
    assert.equal(editorialOnly.status, "needs-review", "a text with no supported statement is not a pass");
  });

  test("readFactCheck refuses anything that is not a fact-check record", () => {
    assert.equal(readFactCheck(null), null);
    assert.equal(readFactCheck({}), null);
    assert.equal(readFactCheck({ status: "approved" }), null);
    assert.equal(readFactCheck({ status: "passed", draftId: "x", version: 2 }), null);
    assert.equal(readFactCheck({ status: "passed", draftId: "x", version: 2, checkedAt: "t", checkedByRunId: "r", recordedAt: "t", recordedBy: "o", crawlId: "c", summary: "s", supported: "not a list", partial: [], unsupported: [], unverifiable: [], editorial: [] }), null);
  });
});
