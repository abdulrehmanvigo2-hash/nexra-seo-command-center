import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  ARTICLE_CHECK_SECTIONS,
  ARTICLE_CHECK_UNIT_INSTRUCTIONS_V1,
  ARTICLE_CHECK_UNIT_INSTRUCTIONS_V2,
  ATTESTED_RULE,
} from "@/lib/content/article-check-prompt";
import { approvalBlockMessage, articleApprovalEligibility } from "@/lib/content/articles/approvals/eligibility";
import { approvalUnitsSha256 } from "@/lib/content/articles/approvals/units-digest";
import { ATTESTATION_LABELS, attestedParagraphs, labelledParagraph } from "@/lib/content/articles/attestations";
import { ARTICLE_CANONICAL_FORMAT, ARTICLE_CANONICAL_FORMAT_ATTESTED, canonicalArticleJson, readCanonicalArticle } from "@/lib/content/articles/canonical";
import { buildUnitVerdict, deriveUnitStatus, statementCoverage } from "@/lib/content/articles/checks/result";
import { unitSha256 } from "@/lib/content/articles/checks/unit-hash";
import { ARTICLE_CHECK_UNIT_FORMAT, ARTICLE_CHECK_UNIT_FORMAT_ATTESTED, articleCheckPlan } from "@/lib/content/articles/checks/units";
import { attestableParagraphChoices, contentFromForm, emptyForm, formFromContent, issueMessage } from "@/lib/content/articles/editor-form";
import {
  ARTICLE_PROPOSAL_PREVIEW_FORMAT,
  ARTICLE_PROPOSAL_PREVIEW_FORMAT_ATTESTED,
  buildArticleProposalPreview,
} from "@/lib/content/articles/proposals/preview";
import { articleProposalPreviewSha256, hashedArticleProposalPreview } from "@/lib/content/articles/proposals/preview-hash";
import { eligibleBinding, LIVE_ARTICLES } from "@/lib/content/articles/proposals/test-support/fixtures";
import { completeArticle } from "@/lib/content/articles/test-support/fixtures";
import { statesAttestedNumber, validateArticleContent } from "@/lib/content/articles/validate";
import { FACT_CHECK_CLOSING } from "@/lib/content/drafts/fact-check-grounding";
import { parseFactCheckOutput } from "@/lib/content/drafts/parse-fact-check-output";
import { utf8Sha256 } from "@/lib/content/publications/content-hash";
import type { ArticleIssue, ValidatedArticleContent } from "@/types/content-article";

/**
 * Phase 6, checkpoint 6.8b: operator-attested paragraphs. First the
 * regression pin — production article c89182f9… Version 4, read read-only,
 * must keep every byte and hash (content, the four units, their digest and
 * the proposal preview) — then the new format 2 contract, units, checker
 * instructions, parser, pass rule, preview labels and approval rule.
 * Offline and pure apart from the hashes.
 */

type Pin = {
  canonical: string;
  contentSha256: string;
  units: { index: number; key: string; sha256: string }[];
  unitsSha256: string;
  articleId: string;
  versionId: string;
  approvalId: string;
  approvedBy: string;
  approvedAt: string;
  previewFormat: string;
  previewSha256: string;
  previewSha256WithPlaceholderApprover: string;
  destination: string;
  slug: string;
};

const PIN: Pin = JSON.parse(readFileSync(new URL("./test-support/v4-pin.json", import.meta.url), "utf8"));

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** The C1 fixture with one attested paragraph (1 of 4 body sentences; 1 of 3 in its section). */
function attestedRaw(change: (raw: Record<string, unknown>) => void = () => {}): Record<string, unknown> {
  const raw = completeArticle();
  raw.topicDecision = "different-angle";
  raw.attestations = [{ locator: "what-it-does/1", basis: "experience" }];
  change(raw);
  return raw;
}

function valid(raw: Record<string, unknown>): ValidatedArticleContent {
  const checked = validateArticleContent(raw);
  assert.ok(checked.ok, JSON.stringify(checked));
  return checked.article;
}

function issues(raw: Record<string, unknown>): readonly ArticleIssue[] {
  const checked = validateArticleContent(raw);
  assert.equal(checked.ok, false, "refused");
  return checked.ok ? [] : checked.issues;
}

describe("the V4 regression pin (production, never rewritten)", () => {
  const article = readCanonicalArticle(PIN.canonical);

  test("the stored text reads back as format 1 and hashes to e9db287f…", () => {
    assert.equal(sha256(PIN.canonical), PIN.contentSha256);
    assert.equal(PIN.contentSha256.slice(0, 8), "e9db287f");
    assert.ok(article !== null);
    assert.deepEqual(article.attestations, []);
    assert.ok(PIN.canonical.startsWith(`{"format":"${ARTICLE_CANONICAL_FORMAT}",`));
    assert.ok(!PIN.canonical.includes("attestations"));
    assert.equal(canonicalArticleJson(article), PIN.canonical, "re-serialised byte for byte");
  });

  test("its four check units regenerate as format 1 with the stored hashes and unit-set digest", () => {
    assert.ok(article !== null);
    const plan = articleCheckPlan(article);
    assert.equal(plan.refusal, null);
    assert.deepEqual(
      plan.units.map((u) => ({ index: u.index, key: u.key, sha256: unitSha256(u) })),
      PIN.units,
    );
    for (const unit of plan.units) {
      assert.ok(unit.text.startsWith(`{"format":"${ARTICLE_CHECK_UNIT_FORMAT}",`));
      assert.ok(!unit.text.includes('"attested"'));
      assert.ok(unit.statements.every((s) => s.attested === undefined));
    }
    assert.equal(approvalUnitsSha256(PIN.units), PIN.unitsSha256);
  });

  // The pin keeps no user id: approvedBy is a placeholder. With the stored approver this preview hashes to the
  // production bbf3fae3… (checked once, read-only, on 28 Sep); with the placeholder, master's code before 6.8b
  // (4a8b5562) gives 7a232c68…, and the preview must still give exactly that.
  test("its proposal preview is still article-proposal-text/1, byte for byte as before 6.8b", () => {
    const hashed = hashedArticleProposalPreview({
      liveArticles: LIVE_ARTICLES, binding: {
        projectId: "nexra-agency",
        articleId: PIN.articleId,
        articleVersion: 4,
        articleVersionId: PIN.versionId,
        contentSha256: PIN.contentSha256,
        approvalId: PIN.approvalId,
        approvedBy: PIN.approvedBy,
        approvedAt: PIN.approvedAt,
        destination: PIN.destination,
        slug: PIN.slug,
      },
      canonicalContent: PIN.canonical,
    });
    assert.ok(hashed.ok, JSON.stringify(hashed));
    assert.equal(hashed.preview.format, PIN.previewFormat);
    assert.equal(hashed.preview.format, ARTICLE_PROPOSAL_PREVIEW_FORMAT);
    assert.ok(!hashed.preview.document.includes("ATTESTED PARAGRAPHS"));
    assert.equal(hashed.previewSha256, PIN.previewSha256WithPlaceholderApprover);
    assert.equal(PIN.previewSha256.slice(0, 8), "bbf3fae3", "the production value, recorded");
  });
});

describe("canonical format 2", () => {
  test("no attestations: format 1, the same bytes as before; attestations: format 2 with the list last", () => {
    const plain = valid(attestedRaw((raw) => delete raw.attestations));
    const attested = valid(attestedRaw());
    const one = canonicalArticleJson(plain);
    const two = canonicalArticleJson(attested);
    assert.ok(one.startsWith(`{"format":"${ARTICLE_CANONICAL_FORMAT}",`));
    assert.ok(!one.includes("attestations"));
    assert.ok(two.startsWith(`{"format":"${ARTICLE_CANONICAL_FORMAT_ATTESTED}",`));
    assert.ok(two.endsWith(',"attestations":[{"locator":"what-it-does/1","basis":"experience"}]}'));
    // Apart from the format and the final member, the bytes are format 1's.
    assert.equal(
      two.replace(ARTICLE_CANONICAL_FORMAT_ATTESTED, ARTICLE_CANONICAL_FORMAT).replace(',"attestations":[{"locator":"what-it-does/1","basis":"experience"}]}', "}"),
      one,
    );
    assert.deepEqual(readCanonicalArticle(two), attested);
    assert.equal(canonicalArticleJson(readCanonicalArticle(two)!), two);
  });

  test("an explicit empty list validates to format 1", () => {
    assert.equal(canonicalArticleJson(valid(attestedRaw((raw) => (raw.attestations = [])))), canonicalArticleJson(valid(attestedRaw((raw) => delete raw.attestations))));
  });

  test("a format that does not match the attestations is not read", () => {
    const one = canonicalArticleJson(valid(attestedRaw((raw) => delete raw.attestations)));
    const two = canonicalArticleJson(valid(attestedRaw()));
    assert.equal(readCanonicalArticle(one.replace(ARTICLE_CANONICAL_FORMAT, ARTICLE_CANONICAL_FORMAT_ATTESTED)), null, "format 2 without a list");
    assert.equal(readCanonicalArticle(two.replace(ARTICLE_CANONICAL_FORMAT_ATTESTED, ARTICLE_CANONICAL_FORMAT)), null, "format 1 with a list");
    assert.equal(readCanonicalArticle(one.replace(/\}$/, ',"attestations":[]}').replace(ARTICLE_CANONICAL_FORMAT, ARTICLE_CANONICAL_FORMAT_ATTESTED)), null, "format 2 with an empty list");
  });
});

describe("the validator's attestation rules", () => {
  const codes = (raw: Record<string, unknown>) => issues(raw).map((i) => `${i.path} ${i.code}`);

  test("a paragraph under an H2 or an H3, either basis, is accepted", () => {
    assert.deepEqual(valid(attestedRaw()).attestations, [{ locator: "what-it-does/1", basis: "experience" }]);
    assert.deepEqual(valid(attestedRaw((raw) => (raw.attestations = [{ locator: "timing/0", basis: "opinion" }]))).attestations, [{ locator: "timing/0", basis: "opinion" }]);
  });

  test("only H2 and H3 body paragraphs: anything else names no target", () => {
    for (const locator of ["where-it-stops/1", "missing/0", "lead/0", "introduction/0", "faqs/0", "cta/0"]) {
      assert.deepEqual(codes(attestedRaw((raw) => (raw.attestations = [{ locator, basis: "opinion" }]))), ["attestations[0].locator attestation-target"], locator);
    }
    assert.deepEqual(codes(attestedRaw((raw) => (raw.attestations = [{ locator: "what-it-does", basis: "opinion" }]))), ["attestations[0].locator format"]);
    assert.deepEqual(codes(attestedRaw((raw) => (raw.attestations = [{ locator: "what-it-does/01", basis: "opinion" }]))), ["attestations[0].locator format"]);
  });

  test("the basis is experience or opinion; the entry holds nothing else; a locator is attested once", () => {
    assert.deepEqual(codes(attestedRaw((raw) => (raw.attestations = [{ locator: "what-it-does/1", basis: "fact" }]))), ["attestations[0].basis unsupported-value"]);
    assert.deepEqual(codes(attestedRaw((raw) => (raw.attestations = [{ locator: "what-it-does/1" }]))), ["attestations[0].basis required"]);
    assert.deepEqual(codes(attestedRaw((raw) => (raw.attestations = [{ locator: "what-it-does/1", basis: "opinion", note: "x" }]))), ["attestations[0].note unsupported-field"]);
    assert.ok(codes(attestedRaw((raw) => (raw.attestations = [{ locator: "what-it-does/1", basis: "opinion" }, { locator: "what-it-does/1", basis: "experience" }]))).includes("attestations[1].locator duplicate"));
  });

  test("an attested paragraph states no number, except one and first", () => {
    const paragraph = (text: string) =>
      attestedRaw((raw) => {
        const sections = raw.sections as { paragraphs: string[] }[];
        sections[0].paragraphs[1] = text;
      });
    for (const text of ["We saw 3 replies.", "Replies rose 40% for us.", "It cost $ less.", "It took two weeks.", "The second client agreed.", "Half of them replied.", "Dozens replied.", "It rose ٣ times."]) {
      assert.deepEqual(codes(paragraph(text)), ["attestations[0] attestation-number"], text);
    }
    for (const text of ["One client told us the reply felt personal.", "The first reply mattered most in our work.", "Someone replied."]) {
      assert.ok(valid(paragraph(text)), text);
    }
    assert.equal(statesAttestedNumber("Once, we saw a pattern."), false, "a word containing a count word is not one");
    // The ban applies to attested paragraphs only.
    assert.ok(valid(attestedRaw((raw) => ((raw.sections as { paragraphs: string[] }[])[0].paragraphs[0] = "It sends 1 text."))));
  });

  test("at most 40% of the body's sentences, and at most half of any one section's", () => {
    assert.deepEqual(
      codes(attestedRaw((raw) => (raw.attestations = ["what-it-does/0", "what-it-does/1"].map((locator) => ({ locator, basis: "opinion" }))))),
      ["attestations attestation-limit", "sections[0] attestation-limit"],
      "2 of 4 body sentences, 2 of 3 in the section",
    );
    const bigger = (locators: string[]) =>
      attestedRaw((raw) => {
        (raw.sections as unknown[]).push({ id: "why", heading: "Why it helps", paragraphs: ["It keeps the lead. It answers fast. It names the business. It asks a question. It waits for a reply. It hands over."], subsections: [] });
        raw.attestations = locators.map((locator) => ({ locator, basis: "opinion" }));
      });
    assert.deepEqual(codes(bigger(["what-it-does/0", "what-it-does/1"])), ["sections[0] attestation-limit"], "2 of 10 body sentences, but 2 of 3 in one section");
    assert.ok(valid(bigger(["what-it-does/1", "why/0"].slice(0, 1))), "1 of 10 body sentences, 1 of 3 in its section");
  });

  test("a section's whole body may not be attested", () => {
    assert.deepEqual(codes(attestedRaw((raw) => (raw.attestations = [{ locator: "where-it-stops/0", basis: "opinion" }]))), ["sections[1] attestation-limit"]);
  });

  test("the editor form offers only body paragraphs and round-trips the list", () => {
    const form = formFromContent(valid(attestedRaw()));
    assert.deepEqual(form.attestations, [{ locator: "what-it-does/1", basis: "experience" }]);
    assert.deepEqual(
      attestableParagraphChoices(form).map((c) => c.locator),
      ["what-it-does/0", "what-it-does/1", "timing/0", "where-it-stops/0"],
    );
    assert.deepEqual((contentFromForm(form) as { attestations: unknown }).attestations, [{ locator: "what-it-does/1", basis: "experience" }]);
    assert.equal("attestations" in contentFromForm(emptyForm()), false, "no list, no member: the content stays format 1");
    assert.match(issueMessage({ path: "attestations[0]", code: "attestation-number" }), /^Attested paragraphs 1 states a number/);
  });
});

describe("check units of an attesting version", () => {
  test("only the unit holding an attested statement is format 2; the statement carries its basis", () => {
    const plain = articleCheckPlan(valid(attestedRaw((raw) => delete raw.attestations)));
    const attested = articleCheckPlan(valid(attestedRaw()));
    assert.equal(attested.units.length, plain.units.length);
    attested.units.forEach((unit, i) => {
      if (unit.block === "section:what-it-does") {
        assert.ok(unit.text.startsWith(`{"format":"${ARTICLE_CHECK_UNIT_FORMAT_ATTESTED}",`));
        assert.deepEqual(unit.statements.filter((s) => s.attested !== undefined), [{ n: 3, field: "paragraphs[1]", text: "The text names the business and asks how it can help.", attested: "experience" }]);
        assert.ok(unit.text.includes('"text":"The text names the business and asks how it can help.","attested":"experience"}'));
        assert.equal(
          unit.text.replace(ARTICLE_CHECK_UNIT_FORMAT_ATTESTED, ARTICLE_CHECK_UNIT_FORMAT).replace(',"attested":"experience"', ""),
          plain.units[i].text,
          "otherwise the format 1 bytes",
        );
      } else {
        assert.equal(unit.text, plain.units[i].text, `${unit.key} unchanged`);
      }
    });
  });
});

/** A seven-heading answer; each list is the raw lines under its heading. */
function sevenHeadings(lines: Partial<Record<(typeof ARTICLE_CHECK_SECTIONS)[number], readonly string[]>>): string {
  return [
    ...ARTICLE_CHECK_SECTIONS.filter((h) => h !== "SUMMARY").flatMap((h) => [h, ...(lines[h]?.length ? lines[h]! : ["none"])]),
    "SUMMARY",
    "Counted lines under each heading.",
    FACT_CHECK_CLOSING,
  ].join("\n");
}

const EVIDENCE = { crawlId: "8f1c0d2e-0000-4000-8000-000000000001", searchWindow: null, recordPaths: ["/services"] };

function verdictOf(text: string, statements: { n: number; attested?: "experience" | "opinion" }[]) {
  const parsed = parseFactCheckOutput(text, ARTICLE_CHECK_SECTIONS);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return buildUnitVerdict({
    output: parsed.output,
    evidence: EVIDENCE,
    statementCount: statements.length,
    statements,
    checkedByRunId: "c0000000-0000-4000-8000-000000000001",
    checkedAt: "2026-09-28T12:05:00.000Z",
    recordedBy: "op",
    recordedAt: "2026-09-28T12:06:00.000Z",
  });
}

describe("the checker's seventh heading", () => {
  test("instructions version 2 is version 1 plus the ATTESTED rule and the seven-heading form, and hash-pinned", () => {
    // Fix F8 made version 3 current; version 2 is kept, word for word, under its own name.
    const back = ARTICLE_CHECK_UNIT_INSTRUCTIONS_V2.replace(` ${ATTESTED_RULE}`, "")
      .replace("exactly seven sections, headed SUPPORTED, PARTIAL, UNSUPPORTED, UNVERIFIABLE, EDITORIAL, ATTESTED, and SUMMARY", "exactly six sections, headed SUPPORTED, PARTIAL, UNSUPPORTED, UNVERIFIABLE, EDITORIAL, and SUMMARY")
      .replace("outside the seven sections", "outside the six sections");
    assert.equal(back, ARTICLE_CHECK_UNIT_INSTRUCTIONS_V1, "every other sentence word for word");
    assert.ok(ARTICLE_CHECK_UNIT_INSTRUCTIONS_V2.includes("Keep the whole answer under 1,800 characters."), "the length rule is kept");
    assert.deepEqual(ARTICLE_CHECK_SECTIONS, ["SUPPORTED", "PARTIAL", "UNSUPPORTED", "UNVERIFIABLE", "EDITORIAL", "ATTESTED", "SUMMARY"]);
    assert.equal(utf8Sha256(ARTICLE_CHECK_UNIT_INSTRUCTIONS_V2), "8788932b34dad3f17a92ffcc6dbac7de4bab9121ac445e7f270dbd2db84a91c7");
  });

  test("the parser reads ATTESTED under the seven headings; a six-heading answer still parses the old way", () => {
    const seven = parseFactCheckOutput(sevenHeadings({ SUPPORTED: ['- "S1: A." [crawl /services]'], ATTESTED: ['- "S2: B." — experience'] }), ARTICLE_CHECK_SECTIONS);
    assert.ok(seven.ok);
    assert.equal(seven.output.attested?.length, 1);
    const six = parseFactCheckOutput(["SUPPORTED", '- "S1: A." [crawl /services]', "PARTIAL", "none", "UNSUPPORTED", "none", "UNVERIFIABLE", "none", "EDITORIAL", "none", "SUMMARY", "One.", FACT_CHECK_CLOSING].join("\n"));
    assert.ok(six.ok);
    assert.equal(six.output.attested, undefined, "the draft path's five headings are unchanged");
  });

  test("an attested statement under ATTESTED with its basis passes; the verdict counts it apart", () => {
    const verdict = verdictOf(sevenHeadings({ SUPPORTED: ['- "S1: A." [crawl /services]'], EDITORIAL: ['- "S3: C."'], ATTESTED: ['- "S2: B." — experience'] }), [{ n: 1 }, { n: 2, attested: "experience" }, { n: 3 }]);
    assert.equal(verdict.status, "passed", JSON.stringify(verdict));
    assert.equal(verdict.counts.attested, 1);
    assert.equal(verdict.classifiedCount, 3);
    assert.deepEqual(verdict.attested, [{ text: "S2: B.", evidence: null, note: "experience" }]);
  });

  test("an attested statement may still be classified as any other — and then it counts as that", () => {
    const verdict = verdictOf(sevenHeadings({ SUPPORTED: ['- "S1: A." [crawl /services]'], UNVERIFIABLE: ['- "S2: B." — a result these records cannot hold'] }), [{ n: 1 }, { n: 2, attested: "opinion" }]);
    assert.equal(verdict.status, "needs-review");
  });

  test("ATTESTED on an unmarked statement, or with another basis, is coverage-incomplete", () => {
    const unmarked = verdictOf(sevenHeadings({ ATTESTED: ['- "S1: A." — experience'] }), [{ n: 1 }]);
    assert.equal(unmarked.status, "failed");
    const mismatch = verdictOf(sevenHeadings({ ATTESTED: ['- "S1: A." — opinion'] }), [{ n: 1, attested: "experience" }]);
    assert.equal(mismatch.status, "failed");
    const noBasis = verdictOf(sevenHeadings({ ATTESTED: ['- "S1: A."'] }), [{ n: 1, attested: "experience" }]);
    assert.equal(noBasis.status, "failed");
    if (mismatch.status === "failed") assert.equal(mismatch.reason, "coverage-incomplete");
  });

  test("a unit with no attested statement keeps its format 1 verdict: no attested count or list", () => {
    const verdict = verdictOf(sevenHeadings({ SUPPORTED: ['- "S1: A." [crawl /services]'] }), [{ n: 1 }]);
    assert.equal(verdict.status, "passed");
    assert.equal("attested" in verdict.counts, false);
    assert.equal("attested" in verdict, false);
  });

  test("the pass rule: attested lines never block; partial, unsupported and unverifiable still do", () => {
    const coverage = statementCoverage({ supported: [], partial: [], unsupported: [], unverifiable: [], editorial: [], attested: [{ text: "S1: A.", evidence: null, note: "experience" }] }, 1, ["experience"]);
    assert.equal(coverage.complete, true);
    assert.equal(deriveUnitStatus({ partial: [], unsupported: [], unverifiable: [], coverageComplete: true }), "passed");
    assert.equal(deriveUnitStatus({ partial: [], unsupported: [], unverifiable: [1], coverageComplete: true }), "needs-review");
  });
});

describe("the proposal preview of an attesting version", () => {
  test("article-proposal-text/2: each attested paragraph listed with its label before the exact canonical text", () => {
    const content = valid(
      attestedRaw((raw) => {
        (raw.sections as unknown[]).push({ id: "why", heading: "Why it helps", paragraphs: ["It keeps the lead. It answers fast.", "Clients tell us it feels attentive."], subsections: [] });
        raw.attestations = [{ locator: "why/1", basis: "opinion" }, { locator: "what-it-does/1", basis: "experience" }];
        raw.slug = "missed-call-text-reply"; // the shared fixture's slug went live on 3 Oct 2026 (article 3)
      }),
    );
    const canonical = canonicalArticleJson(content);
    const result = buildArticleProposalPreview({ liveArticles: LIVE_ARTICLES, binding: eligibleBinding(content), canonicalContent: canonical });
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.preview.format, ARTICLE_PROPOSAL_PREVIEW_FORMAT_ATTESTED);
    const doc = result.preview.document;
    assert.ok(doc.startsWith("ARTICLE PUBLICATION PROPOSAL PREVIEW (article-proposal-text/2)\n"));
    const start = doc.indexOf("ATTESTED PARAGRAPHS (");
    assert.equal(
      doc.slice(start, doc.indexOf("\n", doc.indexOf("APPROVED CANONICAL CONTENT"))),
        [
          "ATTESTED PARAGRAPHS (2) — operator-attested, not checked against the records; each shown with its label",
          "what-it-does/1 (What a text-back does): [From our client work — first-hand, not independently verified] The text names the business and asks how it can help.",
          "why/1 (Why it helps): [Our view] Clients tell us it feels attentive.",
          "",
          "APPROVED CANONICAL CONTENT (nexra-article-content/2, exact stored text)",
        ].join("\n"),
      "in article order, labelled",
    );
    assert.ok(doc.endsWith(`\n${canonical}`));
    assert.equal(articleProposalPreviewSha256(doc), utf8Sha256(doc));
  });

  test("the labels are fixed", () => {
    assert.deepEqual(ATTESTATION_LABELS, { experience: "From our client work — first-hand, not independently verified", opinion: "Our view" });
    const [p] = attestedParagraphs(valid(attestedRaw()));
    assert.equal(labelledParagraph(p), "[From our client work — first-hand, not independently verified] The text names the business and asks how it can help.");
  });
});

describe("the approval rule for an attesting version", () => {
  const facts = {
    articleStatus: "checked" as const,
    currentVersion: 2,
    version: 2,
    contentReadable: true,
    planRefusal: null,
    unitStatuses: ["passed" as const, "passed" as const],
    mismatchedRows: 0,
    topicDecision: "different-angle" as const,
    hasPlaceholder: false,
    approval: null,
  };

  test("at least three supported statements when anything is attested; format 1 is unaffected", () => {
    assert.deepEqual(articleApprovalEligibility({ ...facts, attestedCount: 1, supportedCount: 3 }), { status: "eligible" });
    assert.deepEqual(articleApprovalEligibility({ ...facts, attestedCount: 1, supportedCount: 2 }), { status: "blocked", blocks: ["too-few-supported"] });
    assert.deepEqual(articleApprovalEligibility({ ...facts, attestedCount: 0, supportedCount: 0 }), { status: "eligible" });
    assert.deepEqual(articleApprovalEligibility(facts), { status: "eligible" });
    assert.match(approvalBlockMessage("too-few-supported"), /at least 3 supported statements/);
  });
});
