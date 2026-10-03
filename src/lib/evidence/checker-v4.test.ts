import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";
import {
  ADMITTED_EVIDENCE_RULE,
  ADMITTED_LIMITS_LINE,
  ARTICLE_CHECK_UNIT_INSTRUCTIONS,
  ARTICLE_CHECK_UNIT_INSTRUCTIONS_V3,
} from "@/lib/content/article-check-prompt";
import { evidenceFingerprint } from "@/lib/content/articles/checks/carry";
import { ARTICLE_CHECK_INSTRUCTIONS_SHA256, formatArticleCheckGrounding, resolveArticleUnit } from "@/lib/content/articles/checks/grounding";
import { ARTICLE_ID, content, evidencePack, memoryCheckStore, PROJECT_ID, storedVersion } from "@/lib/content/articles/checks/test-support/fixtures";
import { tagNamesRecord } from "@/lib/content/drafts/parse-fact-check-output";
import { parseFactCheckLine } from "@/lib/content/drafts/parse-fact-check-output";
import { checkEvidenceText, formatAdmittedBlock, linkedOpportunityIds, MAX_ADMITTED_BYTES, MAX_ADMITTED_UNITS, type AdmittedUnit } from "@/lib/evidence/admitted";
import { readEvidencePackGrounding } from "@/lib/research/evidence-pack";

/** M4, PR 8: checker version 4, the admitted outside units it reads, and the F8 fingerprint over them. */

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const unit = (n: number, overrides: Partial<AdmittedUnit> = {}): AdmittedUnit => ({
  id: `u${n}`, claim: `Claim ${n}`, quote: `Quote ${n} as the page states it`, url: `https://alpha.example/${n}`, fetchedAt: "2026-10-03T12:05:00Z", decidedAt: `2026-10-03T12:${String(10 + n).padStart(2, "0")}:00Z`, ...overrides,
});

describe("checker instructions version 4", () => {
  test("version 3 word for word plus one sentence after the SUPPORTED rule; hash-pinned", () => {
    assert.equal(sha256(ARTICLE_CHECK_UNIT_INSTRUCTIONS_V3), "6299e78325deb3cb116ac92cdba7d8f9b9eec7b0b1f9a324ff668353e6309136", "version 3 kept");
    assert.equal(sha256(ARTICLE_CHECK_UNIT_INSTRUCTIONS), "ae79553331452dba8896011007bce0d90ee9e621988c9a589c5d768508ce678f");
    assert.equal(ARTICLE_CHECK_INSTRUCTIONS_SHA256, sha256(ARTICLE_CHECK_UNIT_INSTRUCTIONS), "new runs record the version 4 hash");
    assert.equal(ARTICLE_CHECK_UNIT_INSTRUCTIONS.replace(` ${ADMITTED_EVIDENCE_RULE}`, ""), ARTICLE_CHECK_UNIT_INSTRUCTIONS_V3);
    assert.ok(ARTICLE_CHECK_UNIT_INSTRUCTIONS.includes(`a line without such a tag is forbidden here. ${ADMITTED_EVIDENCE_RULE}`));
    assert.match(ADMITTED_EVIDENCE_RULE, /\[evidence E<n>\]/);
    assert.match(ADMITTED_EVIDENCE_RULE, /never what its claim adds; outside evidence never supports a statement about the site/);
    assert.ok(ARTICLE_CHECK_UNIT_INSTRUCTIONS.includes("Keep the whole answer under 1,800 characters."), "the length rule is unchanged");
  });
});

describe("the admitted block", () => {
  test("E1 upward in decision order; none is no block", () => {
    assert.equal(formatAdmittedBlock([]), null);
    const block = formatAdmittedBlock([unit(2), unit(1)]);
    assert.ok(block);
    assert.deepEqual(block.labels, ["E1", "E2"]);
    assert.deepEqual(block.unitIds, ["u1", "u2"]);
    assert.match(block.text, /^=== ADMITTED OUTSIDE EVIDENCE/);
    assert.ok(block.text.includes('E1 — claim: "Claim 1" — quote: "Quote 1 as the page states it" — page: https://alpha.example/1 — retrieved 2026-10-03'));
  });

  test("bounded by count and bytes, saying how many were left out", () => {
    const many = formatAdmittedBlock(Array.from({ length: 50 }, (_, i) => unit(i + 1)));
    assert.ok(many && many.labels.length === MAX_ADMITTED_UNITS && many.omitted === 10);
    const big = formatAdmittedBlock(Array.from({ length: 30 }, (_, i) => unit(i + 1, { quote: "q".repeat(290) })));
    assert.ok(big && new TextEncoder().encode(big.text).length <= MAX_ADMITTED_BYTES + 80 && big.omitted > 0);
    assert.match(big.text, /more admitted units not shown/);
  });

  test("the article's opportunities: the task's newest link decides", () => {
    const events = [
      { taskId: "t1", articleId: "A", seq: 1 },
      { taskId: "t2", articleId: "A", seq: 2 },
      { taskId: "t2", articleId: "B", seq: 5 },
      { taskId: "t3", articleId: "A", seq: 3 },
    ];
    const tasks = [
      { taskId: "t1", sourceKind: "opportunity", sourceRef: "O1" },
      { taskId: "t2", sourceKind: "opportunity", sourceRef: "O2" },
      { taskId: "t3", sourceKind: "keyword", sourceRef: "ai sdr" },
    ];
    assert.deepEqual(linkedOpportunityIds(events, tasks, "a"), ["o1"]);
    assert.deepEqual(linkedOpportunityIds(events, tasks, "B"), ["o2"]);
  });
});

describe("tags and grounding", () => {
  test("[evidence E<n>] names a unit only when the check was given it", () => {
    const line = parseFactCheckLine('- "S2: AI SDRs reply within a minute" [evidence E1]');
    assert.equal(line.evidence, "evidence E1");
    const records = { crawlId: "c", searchWindow: null, recordPaths: ["/"] };
    assert.equal(tagNamesRecord("evidence E1", { ...records, admittedUnits: ["E1", "E2"] }), true);
    assert.equal(tagNamesRecord("evidence E3", { ...records, admittedUnits: ["E1", "E2"] }), false);
    assert.equal(tagNamesRecord("evidence E1", records), false, "a check given no units verifies no evidence tag");
  });

  test("without admitted units the grounding is exactly as before; with them the block, the limits line and the fingerprint change", async () => {
    const version = storedVersion(1, content());
    const store = memoryCheckStore({ runs: [], versions: [version] });
    const resolved = await resolveArticleUnit(store, { projectId: PROJECT_ID, articleId: ARTICLE_ID, articleVersion: 1, articleVersionId: version.id, unitIndex: 0 });
    assert.ok(resolved.ok);
    const records = await readEvidencePackGrounding(evidencePack(), { projectId: PROJECT_ID });
    assert.ok(records.ok);
    const plain = formatArticleCheckGrounding(resolved.resolved, records.grounding);
    assert.deepEqual(formatArticleCheckGrounding(resolved.resolved, records.grounding, null), plain);
    assert.deepEqual(plain.summary.admittedUnits, []);
    assert.equal(plain.summary.evidenceSha256, evidenceFingerprint(records.grounding.text));
    assert.ok(!plain.text.includes("ADMITTED OUTSIDE EVIDENCE"));

    const block = formatAdmittedBlock([unit(1)]);
    const withUnits = formatArticleCheckGrounding(resolved.resolved, records.grounding, block);
    assert.ok(withUnits.text.includes(block!.text));
    assert.ok(withUnits.text.includes(ADMITTED_LIMITS_LINE));
    assert.ok(withUnits.text.indexOf("=== END RECORDED PROJECT EVIDENCE ===") < withUnits.text.indexOf("=== ADMITTED OUTSIDE EVIDENCE"));
    assert.deepEqual(withUnits.summary.admittedUnits, ["E1"]);
    assert.deepEqual(withUnits.summary.admittedUnitIds, ["u1"]);
    assert.equal(withUnits.summary.evidenceSha256, evidenceFingerprint(checkEvidenceText(records.grounding.text, block)));
    assert.notEqual(withUnits.summary.evidenceSha256, plain.summary.evidenceSha256, "admitting a unit changes the fingerprint, so a carry resting on records stops");
  });
});
