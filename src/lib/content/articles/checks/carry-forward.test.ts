import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { AgentRun } from "../../../../types/agent-run.ts";
import type { ArticleCheckUnitRecord } from "../../../../types/content-article-check.ts";
import {
  ARTICLE_CHECK_UNIT_INSTRUCTIONS,
  ARTICLE_CHECK_UNIT_INSTRUCTIONS_V2,
  SELF_DESCRIPTION_RULE,
} from "../../article-check-prompt.ts";
import { readEvidencePackGrounding } from "../../../research/evidence-pack.ts";
import { utf8Sha256 } from "../../publications/content-hash.ts";
import { approvalRowToApproval } from "../approvals/supabase/schema.ts";
import { buildArticleProposalPreview } from "../proposals/preview.ts";
import { approvedContent, canonicalOf, eligibleBinding } from "../proposals/test-support/fixtures.ts";
import { carryDecision, evidenceFingerprint, sourceRunHashes, type SourceRunHashes } from "./carry.ts";
import { CARRY_REFUSAL_COPY, carriedLabel } from "./carry-copy.ts";
import { ARTICLE_CHECK_INSTRUCTIONS_SHA256, formatArticleCheckGrounding, resolveArticleUnit } from "./grounding.ts";
import { readUnitResult } from "./result.ts";
import { createArticleCheckService } from "./service.ts";
import { carryResultToOutcome, freshResultToOutcome, unitRowToRecord } from "./supabase/schema.ts";
import { answer, ARTICLE_ID, article, checkRun, content, evidencePack, memoryCheckStore, OPERATOR, PROJECT_ID, storedVersion, unitsOf } from "./test-support/fixtures.ts";

/**
 * Fix F8 (audit A5-02, A3-03): checker instructions version 3, the hashes a
 * check run records, and carrying a passed result to a later version's
 * identical unit — visibly, and only under the same instructions and, when
 * the result rests on a record, unchanged evidence. The store applies the
 * carry and fresh functions' rules in memory; the functions themselves are
 * tested on PostgreSQL by the harness (`carry`, `carry-upgrade`).
 */

const V2_SHA256 = "8788932b34dad3f17a92ffcc6dbac7de4bab9121ac445e7f270dbd2db84a91c7";
const V3_SHA256 = "6299e78325deb3cb116ac92cdba7d8f9b9eec7b0b1f9a324ff668353e6309136";
const MIGRATION = readFileSync(new URL("../../../../../supabase/migrations/20261014120000_check_unit_carry_forward.sql", import.meta.url), "utf8");
const read = (path: string) => readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");

describe("checker instructions version 3", () => {
  test("version 3 is version 2 plus one sentence, and both are hash-pinned", () => {
    assert.equal(utf8Sha256(ARTICLE_CHECK_UNIT_INSTRUCTIONS_V2), V2_SHA256, "version 2 is kept word for word");
    assert.equal(utf8Sha256(ARTICLE_CHECK_UNIT_INSTRUCTIONS), V3_SHA256);
    assert.equal(ARTICLE_CHECK_INSTRUCTIONS_SHA256, V3_SHA256, "new runs record the version 3 hash");
    assert.equal(ARTICLE_CHECK_UNIT_INSTRUCTIONS.replace(` ${SELF_DESCRIPTION_RULE}`, ""), ARTICLE_CHECK_UNIT_INSTRUCTIONS_V2);
    assert.equal(ARTICLE_CHECK_UNIT_INSTRUCTIONS.split(SELF_DESCRIPTION_RULE).length, 2, "the rule appears once");
  });

  test("the one rule: the article's own title, meta description, excerpt, headings and labels describing itself are EDITORIAL; a checkable claim about the site is not", () => {
    assert.match(SELF_DESCRIPTION_RULE, /^An article's own title, meta description, excerpt, headings and labels that describe what this article covers or says state no fact about the site: place them under EDITORIAL\./);
    assert.match(SELF_DESCRIPTION_RULE, /One that says something checkable about the site or its pages is still a factual statement\.$/);
    assert.ok(ARTICLE_CHECK_UNIT_INSTRUCTIONS.includes(`goes under EDITORIAL. ${SELF_DESCRIPTION_RULE}`), "placed right after the EDITORIAL sorting sentence");
    assert.ok(ARTICLE_CHECK_UNIT_INSTRUCTIONS.includes("Keep the whole answer under 1,800 characters."), "the length rule is unchanged");
    assert.ok(ARTICLE_CHECK_UNIT_INSTRUCTIONS.length < 5_000, String(ARTICLE_CHECK_UNIT_INSTRUCTIONS.length));
  });
});

describe("what a check run records (the summary in its metadata)", () => {
  test("the instructions hash and the evidence fingerprint of the records it read", async () => {
    const version = storedVersion(1, content());
    const store = memoryCheckStore({ runs: [], versions: [version] });
    const resolved = await resolveArticleUnit(store, { projectId: PROJECT_ID, articleId: ARTICLE_ID, articleVersion: 1, articleVersionId: version.id, unitIndex: 0 });
    assert.ok(resolved.ok);
    const records = await readEvidencePackGrounding(evidencePack(), { projectId: PROJECT_ID });
    assert.ok(records.ok);
    const grounding = formatArticleCheckGrounding(resolved.resolved, records.grounding);
    assert.equal(grounding.summary.instructionsSha256, V3_SHA256);
    assert.equal(grounding.summary.evidenceSha256, evidenceFingerprint(records.grounding.text));
  });

  test("the fingerprint ignores only the read-time line; any other change in the records changes it", () => {
    const text = ["RECORDED PAGE EVIDENCE", "/services · title: AI Automation", "Read from Google at: 2026-09-29T10:00:00.000Z", "Window 2026-08-28..2026-09-26"].join("\n");
    assert.equal(evidenceFingerprint(text), evidenceFingerprint(text.replace("2026-09-29T10:00:00.000Z", "2026-09-30T03:00:00.000Z")));
    assert.notEqual(evidenceFingerprint(text), evidenceFingerprint(text.replace("AI Automation", "AI automation")));
    assert.notEqual(evidenceFingerprint(text), evidenceFingerprint(text.replace("2026-09-26", "2026-09-27")));
    assert.match(evidenceFingerprint(text), /^[0-9a-f]{64}$/);
  });

  test("source run hashes are read only when well formed; a run before F8 recorded none", () => {
    assert.deepEqual(sourceRunHashes({ evidence: { instructionsSha256: V3_SHA256, evidenceSha256: "a".repeat(64) } }), { instructionsSha256: V3_SHA256, evidenceSha256: "a".repeat(64) });
    assert.deepEqual(sourceRunHashes({ evidence: { unitSha256: "b".repeat(64) } }), { instructionsSha256: null, evidenceSha256: null });
    assert.deepEqual(sourceRunHashes({ evidence: { instructionsSha256: "not-a-hash" } }), { instructionsSha256: null, evidenceSha256: null });
    assert.deepEqual(sourceRunHashes(null), { instructionsSha256: null, evidenceSha256: null });
  });
});

describe("the carry decision", () => {
  const SHA = "c".repeat(64);
  const EVIDENCE = "e".repeat(64);
  const target = { unitKey: "metadata:1", unitKind: "metadata", unitSha256: SHA, articleVersion: 6 };

  function source(version: number, supported: number, overrides: Partial<ArticleCheckUnitRecord> = {}): ArticleCheckUnitRecord {
    const runId = `c0000000-0000-4000-8000-00000000000${version}`;
    return {
      id: `f0000000-0000-4000-8000-00000000000${version}`,
      articleId: ARTICLE_ID,
      articleVersionId: `b0000000-0000-4000-8000-00000000000${version}`,
      articleVersion: version,
      unitIndex: 0,
      unitKind: "metadata",
      unitKey: "metadata:1",
      part: 1,
      partCount: 1,
      unitCount: 7,
      unitSha256: SHA,
      status: "passed",
      result: { status: "passed", counts: { supported, partial: 0, unsupported: 0, unverifiable: 0, editorial: 8 - supported } } as unknown as ArticleCheckUnitRecord["result"],
      checkedByRunId: runId,
      carriedFrom: null,
      createdAt: "x",
      updatedAt: "x",
      ...overrides,
    };
  }
  const runs = (entries: [ArticleCheckUnitRecord, SourceRunHashes][]) => new Map(entries.map(([record, hashes]) => [record.checkedByRunId, hashes]));
  const decide = (earlier: ArticleCheckUnitRecord[], hashes: Map<string, SourceRunHashes>, evidenceSha256: string | null | "unread" = EVIDENCE) =>
    carryDecision({ target, earlier, runs: hashes, instructionsSha256: V3_SHA256, evidenceSha256 });

  test("no earlier pass of the identical unit: nothing to carry", () => {
    assert.deepEqual(decide([], new Map()), { ok: false, reason: "no-earlier-pass", fromVersion: null });
    const other = source(5, 0, { unitSha256: "d".repeat(64) });
    assert.deepEqual(decide([other], runs([[other, { instructionsSha256: V3_SHA256, evidenceSha256: null }]])), { ok: false, reason: "no-earlier-pass", fromVersion: null });
    const needsReview = source(5, 0, { status: "needs-review" });
    assert.equal(decide([needsReview], new Map()).ok, false);
    const later = source(7, 0);
    assert.equal(decide([later], runs([[later, { instructionsSha256: V3_SHA256, evidenceSha256: null }]])).ok, false, "only an earlier version");
  });

  test("a pass recorded before F8 names no instructions and is never carried — V4 and V6 stay bound to version 2", () => {
    const old = source(5, 0);
    assert.deepEqual(decide([old], runs([[old, { instructionsSha256: null, evidenceSha256: null }]])), { ok: false, reason: "instructions-not-recorded", fromVersion: 5 });
    const v2 = source(5, 0);
    assert.deepEqual(decide([v2], runs([[v2, { instructionsSha256: V2_SHA256, evidenceSha256: EVIDENCE }]])), { ok: false, reason: "instructions-changed", fromVersion: 5 });
  });

  test("no SUPPORTED statement: carried whatever the evidence", () => {
    const zero = source(5, 0);
    const decision = decide([zero], runs([[zero, { instructionsSha256: V3_SHA256, evidenceSha256: null }]]), null);
    assert.ok(decision.ok);
    assert.equal(decision.candidate.basis, "no-supported");
    assert.equal(decision.candidate.source.id, zero.id);
  });

  test("a SUPPORTED statement: carried only with the same evidence fingerprint", () => {
    const one = source(5, 1);
    const same = decide([one], runs([[one, { instructionsSha256: V3_SHA256, evidenceSha256: EVIDENCE }]]));
    assert.ok(same.ok && same.candidate.basis === "evidence-unchanged");
    assert.deepEqual(decide([one], runs([[one, { instructionsSha256: V3_SHA256, evidenceSha256: "f".repeat(64) }]])), { ok: false, reason: "evidence-changed", fromVersion: 5 });
    assert.deepEqual(decide([one], runs([[one, { instructionsSha256: V3_SHA256, evidenceSha256: null }]])), { ok: false, reason: "evidence-not-recorded", fromVersion: 5 });
    const unread = decide([one], runs([[one, { instructionsSha256: V3_SHA256, evidenceSha256: EVIDENCE }]]), "unread");
    assert.ok(unread.ok && unread.candidate.basis === "evidence-to-compare", "a screen read offers it; the carry compares");
  });

  test("the newest eligible source is chosen; a carried row is never a source", () => {
    const v2 = source(2, 0);
    const v3 = source(3, 0);
    const carried = source(5, 0, { carriedFrom: { unitId: v3.id, version: 3, basis: "no-supported", instructionsSha256: V3_SHA256, evidenceSha256: null } });
    const hashes = runs([
      [v2, { instructionsSha256: V3_SHA256, evidenceSha256: null }],
      [v3, { instructionsSha256: V3_SHA256, evidenceSha256: null }],
    ]);
    const decision = decide([v2, carried, v3], hashes);
    assert.ok(decision.ok);
    assert.equal(decision.candidate.source.articleVersion, 3);
  });

  test("every refusal has words for the operator", () => {
    for (const reason of ["no-earlier-pass", "instructions-not-recorded", "instructions-changed", "evidence-not-recorded", "evidence-changed"] as const) {
      assert.ok(CARRY_REFUSAL_COPY[reason].length > 10, reason);
    }
    assert.equal(carriedLabel({ fromVersion: 5, runId: "861ec511-0000-4000-8000-000000000000" }), "Carried from v5, run 861ec511");
  });
});

describe("carrying through the service", () => {
  const V1 = storedVersion(1, content());

  async function fingerprint(): Promise<string> {
    const records = await readEvidencePackGrounding(evidencePack(), { projectId: PROJECT_ID });
    assert.ok(records.ok);
    return evidenceFingerprint(records.grounding.text);
  }

  /** Version 1 fully passed by F8-era runs; unit 3 (the CTA) holds no SUPPORTED statement, the others one each. */
  async function setup(options: { evidenceSha256?: string; instructionsSha256?: string } = {}) {
    const runs: AgentRun[] = [];
    const store = memoryCheckStore({ articles: [article({ currentVersion: 1 })], versions: [V1], runs });
    const evidence = { instructionsSha256: options.instructionsSha256 ?? V3_SHA256, evidenceSha256: options.evidenceSha256 ?? (await fingerprint()) };
    const service = createArticleCheckService({
      store,
      runs: { getById: async (id) => runs.find((run) => run.id === id) ?? null },
      evidencePack: evidencePack(),
    });
    for (const unit of unitsOf(V1)) {
      const summary = unit.index === 3 ? answer({ editorial: unit.statementCount }) : answer({ supported: 1, editorial: unit.statementCount - 1 });
      const run = checkRun({ version: V1, unitIndex: unit.index, summary, evidence });
      runs.push(run);
      const recorded = await service.record({ projectId: PROJECT_ID, articleId: ARTICLE_ID, articleVersion: 1, unitIndex: unit.index, runId: run.id, operatorId: OPERATOR });
      assert.ok(recorded.ok && recorded.record.status === "passed", JSON.stringify(recorded));
    }
    const v2 = store.saveVersion(content());
    return { store, runs, service, v2 };
  }

  const request = (unitIndex: number) => ({ projectId: PROJECT_ID, articleId: ARTICLE_ID, articleVersion: 2, unitIndex, operatorId: OPERATOR });

  test("an identical later version is offered each earlier pass; carrying makes no run and marks every carried unit", async () => {
    const { service, store, runs } = await setup();
    const before = await service.getVersionChecks(PROJECT_ID, ARTICLE_ID, 2);
    assert.ok(before.ok);
    for (const unit of before.checks.units) {
      assert.ok(unit.carryOffer?.available, `unit ${unit.index}`);
      assert.equal(unit.carryOffer.fromVersion, 1);
      assert.equal(unit.carryOffer.basis, unit.index === 3 ? "no-supported" : "evidence-to-compare");
    }
    const runCount = runs.length;
    let last;
    for (const unit of before.checks.units) {
      last = await service.carry(request(unit.index));
      assert.ok(last.ok, JSON.stringify(last));
      assert.equal(last.record.carriedFrom?.version, 1);
      assert.equal(last.record.carriedFrom?.basis, unit.index === 3 ? "no-supported" : "evidence-unchanged");
      assert.equal(last.record.carriedFrom?.instructionsSha256, V3_SHA256);
      assert.equal(last.record.carriedFrom?.evidenceSha256 === null, unit.index === 3);
    }
    assert.equal(runs.length, runCount, "no run was made");
    assert.ok(last?.ok && last.articleStatusAdvanced, "a complete carried set marks the article Checked, as a recorded one does");
    assert.equal(store.articles[0]?.status, "checked");
    assert.ok(last.checks.units.every((unit) => unit.record?.carriedFrom !== null));
  });

  test("evidence that changed since the pass: a unit resting on a record is not carried; the one resting on none still is", async () => {
    const { service, store } = await setup({ evidenceSha256: "f".repeat(64) });
    const offered = await service.getVersionChecks(PROJECT_ID, ARTICLE_ID, 2);
    assert.ok(offered.ok && offered.checks.units[0]?.carryOffer?.available, "the screen offers it: the evidence is compared on carry");
    assert.deepEqual(await service.carry(request(0)), { ok: false, reason: "not-carryable", refusal: "evidence-changed" });
    assert.equal(store.carries.length, 0, "nothing reached the store");
    const cta = await service.carry(request(3));
    assert.ok(cta.ok && cta.record.carriedFrom?.basis === "no-supported");
  });

  test("passes checked under other instructions (V4 and V6 under version 2) are not carried, and the screen says why", async () => {
    const { service } = await setup({ instructionsSha256: V2_SHA256 });
    const checks = await service.getVersionChecks(PROJECT_ID, ARTICLE_ID, 2);
    assert.ok(checks.ok);
    assert.deepEqual(checks.checks.units[0]?.carryOffer, { available: false, fromVersion: 1, reason: "instructions-changed" });
    assert.deepEqual(await service.carry(request(0)), { ok: false, reason: "not-carryable", refusal: "instructions-changed" });
  });

  test("only the current version's unrecorded unit; an earlier version is offered nothing", async () => {
    const { service } = await setup();
    const v1 = await service.getVersionChecks(PROJECT_ID, ARTICLE_ID, 1);
    assert.ok(v1.ok && v1.checks.units.every((unit) => unit.carryOffer === undefined));
    assert.deepEqual(await service.carry({ ...request(0), articleVersion: 1 }), { ok: false, reason: "not-current" });
    assert.ok((await service.carry(request(0))).ok);
    assert.deepEqual(await service.carry(request(0)), { ok: false, reason: "already-recorded" });
  });

  test("a fresh check clears a carried unit: failed, carry kept in the result, the article back to Drafting", async () => {
    const { service, store } = await setup();
    for (const unit of unitsOf(V1)) assert.ok((await service.carry(request(unit.index))).ok);
    assert.equal(store.articles[0]?.status, "checked");
    const cleared = await service.fresh(request(1));
    assert.ok(cleared.ok, JSON.stringify(cleared));
    assert.equal(cleared.record.status, "failed");
    assert.equal(cleared.record.carriedFrom, null);
    const result = cleared.record.result;
    assert.ok(result !== null && result.status === "failed" && result.reason === "fresh-check-requested");
    assert.equal(result.carriedFrom?.version, 1);
    assert.ok(cleared.articleStatusReverted);
    assert.equal(store.articles[0]?.status, "drafting");
    assert.deepEqual(await service.fresh(request(1)), { ok: false, reason: "refused", outcome: "not-carried" });
  });

  test("a cleared unit is checked by a new run through the ordinary record path", async () => {
    const { service, runs, v2 } = await setup();
    assert.ok((await service.carry(request(3))).ok);
    assert.ok((await service.fresh(request(3))).ok);
    const run = checkRun({ version: v2, unitIndex: 3, summary: answer({ editorial: unitsOf(v2)[3]?.statementCount ?? 1 }) });
    runs.push(run);
    const recorded = await service.record({ ...request(3), runId: run.id });
    assert.ok(recorded.ok && recorded.record.status === "passed" && recorded.record.checkedByRunId === run.id && recorded.record.carriedFrom === null);
  });

  test("an approved version's carried units cannot be cleared", async () => {
    const { service, store } = await setup();
    for (const unit of unitsOf(V1)) assert.ok((await service.carry(request(unit.index))).ok);
    store.articles[0] = { ...store.articles[0]!, status: "approved", approvedVersion: 2 };
    assert.deepEqual(await service.fresh(request(0)), { ok: false, reason: "refused", outcome: "approved" });
  });

  test("without the evidence reader a carry that needs the evidence is refused, never guessed", async () => {
    const { store, runs } = await setup();
    const bare = createArticleCheckService({ store, runs: { getById: async (id) => runs.find((run) => run.id === id) ?? null } });
    assert.deepEqual(await bare.carry(request(0)), { ok: false, reason: "evidence-unread", refusal: "no-reader" });
    assert.ok((await bare.carry(request(3))).ok, "a unit resting on no record needs no evidence");
  });
});

describe("rows and answers", () => {
  const row = {
    id: "f0000000-0000-4000-8000-000000000009",
    article_id: ARTICLE_ID,
    article_version_id: "b0000000-0000-4000-8000-000000000006",
    article_version: 6,
    unit_index: 0,
    unit_kind: "metadata",
    unit_key: "metadata:1",
    part: 1,
    part_count: 1,
    unit_count: 7,
    unit_sha256: "c".repeat(64),
    status: "passed",
    result: null as unknown,
    checked_by_run_id: "c0000000-0000-4000-8000-000000000005",
    recorded_by: OPERATOR,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  };

  async function passedResult(): Promise<unknown> {
    const version = storedVersion(1, content());
    const runs: AgentRun[] = [];
    const store = memoryCheckStore({ runs, versions: [version] });
    const service = createArticleCheckService({ store, runs: { getById: async (id) => runs.find((run) => run.id === id) ?? null } });
    const run = checkRun({ version, unitIndex: 3, summary: answer({ editorial: unitsOf(version)[3]?.statementCount ?? 1 }) });
    runs.push(run);
    const recorded = await service.record({ projectId: PROJECT_ID, articleId: ARTICLE_ID, articleVersion: 1, unitIndex: 3, runId: run.id, operatorId: OPERATOR });
    assert.ok(recorded.ok);
    return JSON.parse(JSON.stringify(recorded.record.result));
  }

  test("a row before the migration (no carry columns) and an uncarried row read as not carried; a carried row names its source; a half-set carry is refused", async () => {
    const base = { ...row, result: await passedResult() };
    assert.equal(unitRowToRecord(base).carriedFrom, null, "before the migration");
    const empty = { carried_from_unit_id: null, carried_from_version: null, carry_basis: null, carried_instructions_sha256: null, carried_evidence_sha256: null };
    assert.equal(unitRowToRecord({ ...base, ...empty }).carriedFrom, null);
    const carry = { carried_from_unit_id: "f0000000-0000-4000-8000-000000000005", carried_from_version: 5, carry_basis: "no-supported", carried_instructions_sha256: V3_SHA256, carried_evidence_sha256: null };
    assert.deepEqual(unitRowToRecord({ ...base, ...carry }).carriedFrom, { unitId: carry.carried_from_unit_id, version: 5, basis: "no-supported", instructionsSha256: V3_SHA256, evidenceSha256: null });
    assert.throws(() => unitRowToRecord({ ...base, ...carry, carry_basis: null }));
    assert.throws(() => unitRowToRecord({ ...base, ...carry, carry_basis: "evidence-unchanged" }), "evidence-unchanged needs the evidence hash");
  });

  test("the carry and fresh answers are read field by field; an unknown outcome is an error", () => {
    for (const outcome of ["not-found", "archived", "version-not-found", "version-mismatch", "not-current", "unit-mismatch", "count-mismatch", "already-recorded", "source-not-eligible"]) {
      assert.deepEqual(carryResultToOutcome({ outcome }), { status: outcome });
    }
    for (const outcome of ["not-found", "archived", "unit-not-found", "not-current", "approved", "not-carried"]) {
      assert.deepEqual(freshResultToOutcome({ outcome }), { status: outcome });
    }
    assert.throws(() => carryResultToOutcome({ outcome: "carried-anyway" }));
    assert.throws(() => freshResultToOutcome({ outcome: "deleted" }));
  });

  test("a fresh-check failure keeps the carry it cleared; no other failure may carry one", () => {
    const failure = {
      status: "failed",
      reason: "fresh-check-requested",
      checkedByRunId: "c0000000-0000-4000-8000-000000000005",
      recordedBy: OPERATOR,
      recordedAt: "2026-10-01T00:00:00Z",
      carriedFrom: { unitId: "f0000000-0000-4000-8000-000000000005", version: 5, basis: "evidence-unchanged", instructionsSha256: V3_SHA256, evidenceSha256: "e".repeat(64) },
    };
    const parsed = readUnitResult(failure);
    assert.ok(parsed !== null && parsed.status === "failed" && parsed.carriedFrom?.version === 5);
    assert.equal(readUnitResult({ ...failure, reason: "run-failed" }), null);
  });
});

describe("the approval and the preview name carried results (never silent)", () => {
  const approvalRow = {
    id: "98195295-0000-4000-8000-000000000000",
    article_id: ARTICLE_ID,
    article_version: 6,
    article_version_id: "a84cf5c8-0000-4000-8000-000000000000",
    content_sha256: "5".repeat(64),
    unit_count: 7,
    units_sha256: "6".repeat(64),
    approved_by: OPERATOR,
    approved_at: "2026-09-30T03:13:00Z",
    attested_count: 3,
    attested_confirmed: true,
  };

  test("an approval before the migration or with none carried lists none; a carried one lists each", () => {
    assert.deepEqual(approvalRowToApproval(approvalRow).carriedUnits, []);
    assert.deepEqual(approvalRowToApproval({ ...approvalRow, carried_units: [] }).carriedUnits, []);
    const carried = [{ unitIndex: 0, unitKey: "metadata:1", fromVersion: 5, fromUnitId: "f0000000-0000-4000-8000-000000000005", runId: "861ec511-0000-4000-8000-000000000000", basis: "no-supported" }];
    assert.deepEqual(approvalRowToApproval({ ...approvalRow, carried_units: carried }).carriedUnits, carried);
    assert.throws(() => approvalRowToApproval({ ...approvalRow, carried_units: [{ ...carried[0], basis: "trust-me" }] }));
  });

  test("a binding with no carried unit builds the preview byte for byte as before; one with a carried unit lists it, format unchanged", () => {
    const value = approvedContent();
    const { text } = canonicalOf(value);
    const plain = buildArticleProposalPreview({ binding: eligibleBinding(value), canonicalContent: text });
    const empty = buildArticleProposalPreview({ binding: eligibleBinding(value, { carriedUnits: [] }), canonicalContent: text });
    assert.ok(plain.ok && empty.ok);
    assert.equal(empty.preview.document, plain.preview.document);
    assert.doesNotMatch(plain.preview.document, /CARRIED CHECK RESULTS/);

    const carried = buildArticleProposalPreview({
      binding: eligibleBinding(value, { carriedUnits: [{ unitIndex: 2, unitKey: "section:x:1", fromVersion: 5, fromUnitId: "f0000000-0000-4000-8000-000000000005", runId: "d9d3b975-0000-4000-8000-000000000000", basis: "evidence-unchanged" }] }),
      canonicalContent: text,
    });
    assert.ok(carried.ok);
    assert.equal(carried.preview.format, plain.preview.format);
    assert.match(
      carried.preview.document,
      /\nCARRIED CHECK RESULTS \(1\) — passed on an earlier version's identical unit and carried, not checked again on this version\nUnit 2 \(section:x:1\): Carried from v5, run d9d3b975 — run d9d3b975-0000-4000-8000-000000000000, source unit f0000000-0000-4000-8000-000000000005; the evidence it rested on is unchanged\n/,
    );
  });
});

describe("screens", () => {
  test("the check section marks a carried unit, offers the carry with its basis, and confirms a fresh check", () => {
    const section = read("components/content/article-check-section.tsx");
    assert.match(section, /<Badge tone="accent">Carried<\/Badge>/);
    assert.match(section, /carriedLabel\(\{ fromVersion: unit\.record\.carriedFrom\.version, runId: unit\.record\.checkedByRunId \}\)/);
    assert.match(section, /Check again \(fresh\)/);
    assert.match(section, /Clear the carried result\?/);
    assert.match(section, /freshArticleCheckUnit\(projectId, checks\.articleId, checks\.version, unit\.index, true\)/);
    assert.match(section, /carryArticleCheckUnit\(projectId, checks\.articleId, checks\.version, unit\.index\)/);
    assert.doesNotMatch(section, /never carry to a later one/);
  });

  test("the approval history and the Studio detail name carried results", () => {
    assert.match(read("components/content/article-approval-section.tsx"), /entry\.carriedUnits\.map/);
    assert.match(read("components/content/observed-content.tsx"), /unit\.carried !== null/);
    assert.match(read("lib/content/studio.ts"), /eligibility\.approval\.carriedUnits/);
  });
});

describe("the migration", () => {
  test("adds the carry and fresh functions for service_role only, and leaves the record and approve functions alone", () => {
    assert.match(MIGRATION, /create function public\.nexra_article_check_unit_carry\(/);
    assert.match(MIGRATION, /create function public\.nexra_article_check_unit_fresh\(/);
    assert.doesNotMatch(MIGRATION, /function public\.nexra_article_check_unit_record\(/);
    assert.doesNotMatch(MIGRATION, /function public\.nexra_article_approve_version\(/);
    assert.match(MIGRATION, /grant execute on function public\.nexra_article_check_unit_carry\([^)]*\) to service_role;/);
    assert.match(MIGRATION, /grant execute on function public\.nexra_article_check_unit_fresh\([^)]*\) to service_role;/);
    assert.doesNotMatch(MIGRATION, /to (anon|authenticated)\b/);
    assert.doesNotMatch(MIGRATION, /\b(drop table|truncate|delete from|update public\.nexra_article_versions)\b/i);
  });

  test("the database's basis rule is the application's: no SUPPORTED statement, or the same evidence fingerprint; the instructions hash always", () => {
    assert.match(MIGRATION, /v_run\.result_metadata -> 'evidence' ->> 'instructionsSha256' is distinct from p_instructions_sha256/);
    assert.match(MIGRATION, /coalesce\(\(v_source\.result -> 'counts' ->> 'supported'\)::integer, -1\) = 0/);
    assert.match(MIGRATION, /v_run\.result_metadata -> 'evidence' ->> 'evidenceSha256' = p_evidence_sha256/);
    assert.match(MIGRATION, /and carried_from_unit_id is null/);
  });
});
