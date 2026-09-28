import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { approvalUnitsSha256 } from "./units-digest.ts";
import { approvableContent, approvalSetup, APPROVER } from "./test-support/fixtures.ts";
import { ARTICLE_ID, OTHER_PROJECT_ID, PROJECT_ID, storedVersion, unitsOf } from "../checks/test-support/fixtures.ts";
import { unitSha256 } from "../checks/unit-hash.ts";

/**
 * Stage 5, milestone C5: approving one exact article version through the
 * real check and approval services over the memory stores, which apply the
 * database function's rules (the function itself was run against
 * PostgreSQL 16 separately, with concurrent sessions).
 */

const V1 = storedVersion(1, approvableContent());

describe("approving the current, exact version", () => {
  test("every unit passed: approved, bound to the version row, content hash, unit count and unit-set digest", async () => {
    const setup = approvalSetup({ versions: [V1] });
    await setup.passAll(V1);
    assert.equal(setup.store.articles[0].status, "checked");
    const before = await setup.service.getState(PROJECT_ID, ARTICLE_ID);
    assert.ok(before.ok && before.state.eligibility.status === "eligible");

    const result = await setup.approve(1);
    assert.ok(result.ok && result.approved, JSON.stringify(result));
    const units = unitsOf(V1).map((u) => ({ index: u.index, key: u.key, sha256: unitSha256(u) }));
    assert.deepEqual(
      {
        version: result.approval.articleVersion,
        versionId: result.approval.articleVersionId,
        hash: result.approval.contentSha256,
        count: result.approval.unitCount,
        units: result.approval.unitsSha256,
        by: result.approval.approvedBy,
      },
      { version: 1, versionId: V1.id, hash: V1.contentSha256, count: units.length, units: approvalUnitsSha256(units), by: APPROVER },
    );
    const parent = setup.store.articles[0];
    assert.deepEqual([parent.status, parent.approvedVersion, parent.approvedBy, parent.approvedAt], ["approved", 1, APPROVER, result.approval.approvedAt]);
    assert.equal(result.state.eligibility.status, "approved");
    assert.equal(result.state.history.length, 1);
  });

  test("the server sends its own version row id, hash and regenerated units — the browser names only the version number", async () => {
    const setup = approvalSetup({ versions: [V1] });
    await setup.passAll(V1);
    await setup.approve(1);
    const call = setup.approvals.calls[0];
    assert.equal(call.articleVersionId, V1.id);
    assert.equal(call.contentSha256, V1.contentSha256);
    assert.deepEqual(call.units.map((u) => u.index), unitsOf(V1).map((u) => u.index));
    assert.equal(call.unitsSha256, approvalUnitsSha256(call.units));
  });

  test("a repeated request returns the existing approval and writes nothing", async () => {
    const setup = approvalSetup({ versions: [V1] });
    await setup.passAll(V1);
    const first = await setup.approve(1);
    const again = await setup.approve(1);
    assert.ok(first.ok && again.ok && again.approved === false);
    assert.equal(again.approval.id, first.approval.id);
    assert.equal(setup.approvals.approvals.length, 1);
    assert.equal(setup.approvals.calls.length, 1, "the rule answered before the database was called again");
  });

  test("a stale request (the operator saw an older version) is refused before anything is sent", async () => {
    const V2 = storedVersion(2, approvableContent("different-angle", (raw) => (raw.lead = "An edited lead.")));
    const setup = approvalSetup({ versions: [V1, V2] });
    await setup.passAll(V2);
    const stale = await setup.approve(1);
    assert.ok(!stale.ok && stale.reason === "stale");
    assert.equal(setup.approvals.calls.length, 0);
  });
});

describe("every refusal, with every reason", () => {
  async function blocked(setup: ReturnType<typeof approvalSetup>, version = 1) {
    const result = await setup.approve(version);
    assert.ok(!result.ok && result.reason === "ineligible", JSON.stringify(result));
    assert.equal(setup.approvals.calls.length, 0, "the database is not asked");
    return result.blocks;
  }

  test("one unit unchecked", async () => {
    const setup = approvalSetup({ versions: [V1] });
    for (const u of unitsOf(V1).slice(1)) await setup.recordUnit(V1, u.index, "passed");
    assert.deepEqual(await blocked(setup), ["units-unchecked", "status-unexpected"]);
  });

  test("one unit checking", async () => {
    const setup = approvalSetup({ versions: [V1] });
    for (const u of unitsOf(V1).slice(1)) await setup.recordUnit(V1, u.index, "passed");
    await setup.recordUnit(V1, 0, "pending");
    assert.deepEqual(await blocked(setup), ["units-checking", "status-unexpected"]);
  });

  test("one unit failed", async () => {
    const setup = approvalSetup({ versions: [V1] });
    for (const u of unitsOf(V1).slice(1)) await setup.recordUnit(V1, u.index, "passed");
    await setup.recordUnit(V1, 0, "failed");
    assert.deepEqual(await blocked(setup), ["units-failed", "status-unexpected"]);
  });

  test("one unit needs review", async () => {
    const setup = approvalSetup({ versions: [V1] });
    for (const u of unitsOf(V1).slice(1)) await setup.recordUnit(V1, u.index, "passed");
    await setup.recordUnit(V1, 0, "needs-review");
    assert.deepEqual(await blocked(setup), ["units-needs-review", "status-unexpected"]);
  });

  test("a stored row with a hash that matches no regenerated unit", async () => {
    const setup = approvalSetup({ versions: [V1] });
    await setup.passAll(V1);
    setup.store.rows[0] = { ...setup.store.rows[0], unitSha256: "0".repeat(64) };
    assert.deepEqual(await blocked(setup), ["units-mismatch", "units-unchecked"]);
  });

  test("a missing unit and a duplicate row", async () => {
    const setup = approvalSetup({ versions: [V1] });
    await setup.passAll(V1);
    const removed = setup.store.rows.splice(1, 1)[0];
    assert.deepEqual(await blocked(setup), ["units-unchecked"]);
    setup.store.rows.push(removed, { ...removed, id: "f0000000-0000-4000-8000-00000000ffff" });
    assert.deepEqual(await blocked(setup), ["units-mismatch"]);
  });

  test("an archived article", async () => {
    const setup = approvalSetup({ versions: [V1] });
    await setup.passAll(V1);
    setup.store.articles[0] = { ...setup.store.articles[0], status: "archived" };
    assert.deepEqual(await blocked(setup), ["archived"]);
  });

  test("unset and do-not-create topic decisions", async () => {
    for (const topic of ["unset", "do-not-create"] as const) {
      const V = storedVersion(1, approvableContent(topic));
      const setup = approvalSetup({ versions: [V] });
      await setup.passAll(V);
      assert.deepEqual(await blocked(setup), ["topic-decision"], topic);
    }
  });

  test("an unresolved placeholder", async () => {
    const V = storedVersion(1, approvableContent("update-existing", (raw) => (raw.lead = "A lead [NEEDS EVIDENCE: a figure].")));
    const setup = approvalSetup({ versions: [V] });
    await setup.passAll(V);
    assert.deepEqual(await blocked(setup), ["unresolved-placeholder"]);
  });

  test("a cross-project request finds nothing", async () => {
    const setup = approvalSetup({ versions: [V1] });
    await setup.passAll(V1);
    const result = await setup.service.approve({ projectId: OTHER_PROJECT_ID, articleId: ARTICLE_ID, articleVersion: 1, operatorId: APPROVER });
    assert.deepEqual(result, { ok: false, reason: "not-found" });
  });

  test("ids and numbers of the wrong shape are refused before anything is read", async () => {
    const setup = approvalSetup({ versions: [V1] });
    for (const bad of [
      { projectId: "", articleId: ARTICLE_ID, articleVersion: 1, operatorId: APPROVER },
      { projectId: PROJECT_ID, articleId: "x", articleVersion: 1, operatorId: APPROVER },
      { projectId: PROJECT_ID, articleId: ARTICLE_ID, articleVersion: 0, operatorId: APPROVER },
      { projectId: PROJECT_ID, articleId: ARTICLE_ID, articleVersion: 1.5, operatorId: APPROVER },
      { projectId: PROJECT_ID, articleId: ARTICLE_ID, articleVersion: 1, operatorId: "someone" },
    ]) {
      assert.deepEqual(await setup.service.approve(bad), { ok: false, reason: "invalid" });
    }
  });
});

describe("concurrency and history", () => {
  test("an edit that lands between the rule and the database write: refused stale by the database, nothing written", async () => {
    const V2 = storedVersion(2, approvableContent("different-angle", (raw) => (raw.lead = "Edited concurrently.")));
    const setup = approvalSetup({ versions: [V1] });
    await setup.passAll(V1);
    setup.approvals.beforeApprove = () => {
      setup.store.versions.push(V2);
      setup.store.articles[0] = { ...setup.store.articles[0], currentVersion: 2, status: "drafting" };
    };
    const result = await setup.approve(1);
    assert.deepEqual(result, { ok: false, reason: "refused", outcome: "stale" });
    assert.equal(setup.approvals.approvals.length, 0);
  });

  test("a concurrent approval that lands first: the second answers with the existing approval", async () => {
    const setup = approvalSetup({ versions: [V1] });
    await setup.passAll(V1);
    const [a, b] = await Promise.all([setup.approve(1), setup.approve(1)]);
    assert.ok(a.ok && b.ok);
    assert.deepEqual([a.approved, b.approved].sort(), [false, true]);
    assert.equal(setup.approvals.approvals.length, 1);
  });

  test("a later version inherits nothing; the earlier approval stays as history", async () => {
    const V2 = storedVersion(2, approvableContent("different-angle", (raw) => (raw.lead = "An edited lead.")));
    const setup = approvalSetup({ versions: [V1] });
    await setup.passAll(V1);
    assert.ok((await setup.approve(1)).ok);
    // What nexra_article_save_version does: a new version, drafting, the pointer left as history.
    setup.store.versions.push(V2);
    setup.store.articles[0] = { ...setup.store.articles[0], currentVersion: 2, status: "drafting" };

    const state = await setup.service.getState(PROJECT_ID, ARTICLE_ID);
    assert.ok(state.ok);
    assert.equal(state.state.eligibility.status, "blocked");
    assert.equal(state.state.approvedVersion, 1);
    assert.deepEqual(state.state.history.map((h) => h.articleVersion), [1]);
    assert.equal((await setup.approve(1)).ok, false, "the old version is stale");

    await setup.passAll(V2);
    const second = await setup.approve(2);
    assert.ok(second.ok && second.approved);
    assert.deepEqual(second.state.history.map((h) => h.articleVersion), [2, 1]);
  });
});

describe("the current production article: version 2, metadata needs review, three units unchecked", () => {
  // Shaped like the production article: one H2 section, no FAQs — four units.
  const productionShaped = (lead: string) =>
    approvableContent("different-angle", (raw) => {
      raw.lead = lead;
      raw.sections = [(raw.sections as unknown[])[0]];
      raw.faqs = [];
      raw.internalLinks = [];
    });

  test("NOT ELIGIBLE FOR APPROVAL; nothing is sent to the database and nothing changes", async () => {
    const P1 = storedVersion(1, productionShaped("The first lead."));
    const P2 = storedVersion(2, productionShaped("The second lead."));
    assert.deepEqual(unitsOf(P2).map((u) => u.kind), ["metadata", "lead-introduction", "section", "cta"]);
    const setup = approvalSetup({ versions: [P1, P2] });
    await setup.recordUnit(P2, 0, "needs-review");
    const rowsBefore = JSON.stringify(setup.store.rows);

    const state = await setup.service.getState(PROJECT_ID, ARTICLE_ID);
    assert.ok(state.ok);
    assert.equal(state.state.articleStatus, "drafting");
    assert.deepEqual(
      { total: state.state.unitCounts.total, needsReview: state.state.unitCounts.needsReview, unchecked: state.state.unitCounts.unchecked },
      { total: 4, needsReview: 1, unchecked: 3 },
    );
    assert.equal(state.state.eligibility.status, "blocked");
    assert.ok(state.state.eligibility.status === "blocked");
    assert.deepEqual(state.state.eligibility.blocks, ["units-unchecked", "units-needs-review", "status-unexpected"]);

    const result = await setup.approve(2);
    assert.ok(!result.ok && result.reason === "ineligible");
    assert.equal(setup.approvals.calls.length, 0);
    assert.equal(setup.store.articles[0].status, "drafting");
    assert.equal(setup.store.articles[0].approvedVersion, null);
    assert.equal(JSON.stringify(setup.store.rows), rowsBefore, "the recorded metadata result is unchanged");
  });
});

describe("no publication side effects", () => {
  test("approval writes one approval row and the parent's pointer — nothing else", async () => {
    const setup = approvalSetup({ versions: [V1] });
    await setup.passAll(V1);
    const writesBefore = setup.store.writes.length;
    const rowsBefore = JSON.stringify(setup.store.rows);
    await setup.approve(1);
    assert.equal(setup.store.writes.length, writesBefore, "no check unit was recorded");
    assert.equal(JSON.stringify(setup.store.rows), rowsBefore, "no check result changed");
    for (const name of ["publish", "propose", "createPullRequest", "merge", "deploy", "delete"]) {
      assert.equal(name in setup.approvals, false, name);
      assert.equal(name in setup.service, false, name);
    }
    assert.deepEqual(Object.keys(setup.service).sort(), ["approve", "getState"]);
  });
});

describe("a version with operator-attested paragraphs (6.8b)", () => {
  const ATTESTED = storedVersion(1, approvableContent("different-angle", (raw) => (raw.attestations = [{ locator: "what-it-does/1", basis: "experience" }])));

  test("without the operator's attestation tick: refused attestation-unconfirmed, nothing sent to the database", async () => {
    const setup = approvalSetup({ versions: [ATTESTED] });
    await setup.passAll(ATTESTED);
    const state = await setup.service.getState(PROJECT_ID, ARTICLE_ID);
    assert.ok(state.ok && state.state.attestedCount === 1 && state.state.eligibility.status === "eligible", JSON.stringify(state));
    for (const attestationConfirmed of [undefined, false]) {
      const result = await setup.service.approve({ projectId: PROJECT_ID, articleId: ARTICLE_ID, articleVersion: 1, operatorId: APPROVER, attestationConfirmed });
      assert.ok(!result.ok && result.reason === "attestation-unconfirmed", JSON.stringify(result));
    }
    assert.equal(setup.approvals.calls.length, 0);
    assert.equal(setup.approvals.approvals.length, 0);
  });

  test("with the tick: the tick is sent to the database, which stores it with the count; a format 1 version never sends one", async () => {
    const setup = approvalSetup({ versions: [ATTESTED] });
    await setup.passAll(ATTESTED);
    const result = await setup.service.approve({ projectId: PROJECT_ID, articleId: ARTICLE_ID, articleVersion: 1, operatorId: APPROVER, attestationConfirmed: true });
    assert.ok(result.ok && result.approved, JSON.stringify(result));
    assert.equal(setup.approvals.calls[0].attestationConfirmed, true);

    const plain = approvalSetup({ versions: [V1] });
    await plain.passAll(V1);
    await plain.service.approve({ projectId: PROJECT_ID, articleId: ARTICLE_ID, articleVersion: 1, operatorId: APPROVER, attestationConfirmed: true });
    assert.equal("attestationConfirmed" in plain.approvals.calls[0], false);
  });
});
