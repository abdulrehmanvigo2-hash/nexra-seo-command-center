import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { approvalBlockMessage, articleApprovalEligibility, hasArticlePlaceholder, type ArticleApprovalFacts } from "./eligibility.ts";
import { approvalUnitsSha256, approvalUnitsText } from "./units-digest.ts";
import type { ArticleApproval, ArticleApprovalBlock } from "../../../../types/content-article-approval.ts";

/**
 * Stage 5, milestone C5: the pure approval rule — every refusal, all
 * reasons reported together, no override — and the unit-set digest the
 * database recomputes. Offline and pure.
 */

const APPROVAL: ArticleApproval = {
  id: "e0000000-0000-4000-8000-000000000001",
  articleId: "a0000000-0000-4000-8000-000000000001",
  articleVersion: 2,
  articleVersionId: "b0000000-0000-4000-8000-000000000002",
  contentSha256: "a".repeat(64),
  unitCount: 4,
  unitsSha256: "b".repeat(64),
  approvedBy: "00000000-0000-4000-8000-0000000000bb",
  approvedAt: "2026-09-24T12:00:00.000Z",
};

function facts(overrides: Partial<ArticleApprovalFacts> = {}): ArticleApprovalFacts {
  return {
    articleStatus: "checked",
    currentVersion: 2,
    version: 2,
    contentReadable: true,
    planRefusal: null,
    unitStatuses: ["passed", "passed", "passed", "passed"],
    mismatchedRows: 0,
    topicDecision: "different-angle",
    hasPlaceholder: false,
    approval: null,
    ...overrides,
  };
}

function blocks(overrides: Partial<ArticleApprovalFacts>): readonly ArticleApprovalBlock[] {
  const result = articleApprovalEligibility(facts(overrides));
  assert.equal(result.status, "blocked", JSON.stringify(result));
  return result.status === "blocked" ? result.blocks : [];
}

describe("the approval rule", () => {
  test("every unit passed, checked, approvable topic, no placeholder: eligible", () => {
    assert.deepEqual(articleApprovalEligibility(facts()), { status: "eligible" });
    assert.deepEqual(articleApprovalEligibility(facts({ topicDecision: "update-existing" })), { status: "eligible" });
  });

  test("one unit unchecked, checking, failed or needs-review: refused, whatever else holds", () => {
    assert.deepEqual(blocks({ unitStatuses: ["passed", null, "passed", "passed"] }), ["units-unchecked"]);
    assert.deepEqual(blocks({ unitStatuses: ["passed", "pending", "passed", "passed"] }), ["units-checking"]);
    assert.deepEqual(blocks({ unitStatuses: ["passed", "failed", "passed", "passed"] }), ["units-failed"]);
    assert.deepEqual(blocks({ unitStatuses: ["needs-review", "passed", "passed", "passed"] }), ["units-needs-review"]);
    assert.deepEqual(blocks({ unitStatuses: [] }), ["units-unchecked"], "no units at all is not a pass");
  });

  test("a stored row that matches no regenerated unit (missing, duplicate or wrong hash): refused", () => {
    assert.deepEqual(blocks({ mismatchedRows: 1 }), ["units-mismatch"]);
  });

  test("a version that cannot be cut into units: refused", () => {
    assert.deepEqual(blocks({ planRefusal: "too-many-units", unitStatuses: [] }), ["checks-refused"]);
    assert.deepEqual(blocks({ planRefusal: "statement-too-large", unitStatuses: [] }), ["checks-refused"]);
  });

  test("an earlier or later version, an archived article, an unreadable text: refused", () => {
    assert.ok(blocks({ version: 1 }).includes("not-current"));
    assert.deepEqual(blocks({ articleStatus: "archived" }), ["archived"]);
    assert.deepEqual(blocks({ contentReadable: false, unitStatuses: [] }), ["content-unreadable"]);
  });

  test("a parent not in the checked state: refused, even with every unit passed", () => {
    assert.deepEqual(blocks({ articleStatus: "drafting" }), ["status-unexpected"]);
  });

  test("unset or do-not-create topic decision: refused", () => {
    assert.deepEqual(blocks({ topicDecision: "unset" }), ["topic-decision"]);
    assert.deepEqual(blocks({ topicDecision: "do-not-create" }), ["topic-decision"]);
    assert.deepEqual(blocks({ topicDecision: null }), ["topic-decision"]);
  });

  test("an unresolved placeholder: refused; detected case-insensitively anywhere in the stored text", () => {
    assert.deepEqual(blocks({ hasPlaceholder: true }), ["unresolved-placeholder"]);
    assert.equal(hasArticlePlaceholder('{"lead":"A lead [NEEDS EVIDENCE: a figure]."}'), true);
    assert.equal(hasArticlePlaceholder('{"lead":"a lead [needs evidence: lower]."}'), true);
    assert.equal(hasArticlePlaceholder('{"lead":"Needs evidence is a phrase, not a marker."}'), false);
  });

  test("every applicable reason is reported together, in a fixed order", () => {
    assert.deepEqual(blocks({ articleStatus: "drafting", unitStatuses: ["needs-review", null, null, null], topicDecision: "unset", hasPlaceholder: true, mismatchedRows: 2 }), [
      "units-mismatch",
      "units-unchecked",
      "units-needs-review",
      "status-unexpected",
      "topic-decision",
      "unresolved-placeholder",
    ]);
  });

  test("the current production article, version 2: metadata needs review, three unchecked, drafting — NOT ELIGIBLE", () => {
    const result = articleApprovalEligibility(facts({ articleStatus: "drafting", unitStatuses: ["needs-review", null, null, null] }));
    assert.equal(result.status, "blocked");
    assert.ok(result.status === "blocked" && result.blocks.includes("units-needs-review") && result.blocks.includes("units-unchecked") && result.blocks.includes("status-unexpected"));
  });

  test("this exact version already approved: reported as approved, not eligible again", () => {
    assert.deepEqual(articleApprovalEligibility(facts({ articleStatus: "approved", approval: APPROVAL })), { status: "approved", approval: APPROVAL });
    // An approval of an older version on a newer, drafting article is history only.
    assert.equal(articleApprovalEligibility(facts({ articleStatus: "drafting", currentVersion: 3, version: 3, approval: null })).status, "blocked");
  });

  test("every block has an operator message", () => {
    const all: ArticleApprovalBlock[] = ["archived", "not-current", "content-unreadable", "checks-refused", "units-mismatch", "units-unchecked", "units-checking", "units-failed", "units-needs-review", "status-unexpected", "topic-decision", "unresolved-placeholder"];
    for (const block of all) assert.ok(approvalBlockMessage(block).length > 20, block);
    assert.match(approvalBlockMessage("units-needs-review"), /final for this version/);
  });
});

describe("the unit-set digest", () => {
  const units = [
    { index: 1, key: "lead-introduction:1", sha256: "1".repeat(64) },
    { index: 0, key: "metadata:1", sha256: "0".repeat(64) },
  ];

  test("is SHA-256 over the fixed text, in index order, whatever order it is given in", () => {
    assert.equal(approvalUnitsText(units), `nexra-article-approval-units/1\n0 metadata:1 ${"0".repeat(64)}\n1 lead-introduction:1 ${"1".repeat(64)}\n`);
    assert.equal(approvalUnitsSha256(units), approvalUnitsSha256([...units].reverse()));
    assert.match(approvalUnitsSha256(units), /^[0-9a-f]{64}$/);
  });

  test("matches the value PostgreSQL computes from the same rows (pinned vector)", () => {
    // `encode(sha256(convert_to('nexra-article-approval-units/1' || chr(10) || '0 metadata:1 ' || repeat('0',64) || chr(10) || '1 lead-introduction:1 ' || repeat('1',64) || chr(10), 'UTF8')), 'hex')`
    assert.equal(approvalUnitsSha256(units), PINNED_DIGEST);
  });

  test("changes when any key, hash or index changes", () => {
    const base = approvalUnitsSha256(units);
    assert.notEqual(approvalUnitsSha256([{ ...units[0], sha256: "2".repeat(64) }, units[1]]), base);
    assert.notEqual(approvalUnitsSha256([{ ...units[0], key: "lead-introduction:2" }, units[1]]), base);
    assert.notEqual(approvalUnitsSha256([units[0]]), base);
  });
});

const PINNED_DIGEST = "70daacc054602970412822bcf9f396ce23762f2ff9469e29c25737318506f7e4";
