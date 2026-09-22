import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ContentDraft, ContentDraftVersion } from "../../../types/content-draft.ts";
import { approvalEligibility, approvalRefusalMessage, isApprovedVersion } from "./approval-rules.ts";

/**
 * The explicit policy, and nothing implicit: only a current version whose
 * recorded check passed, on a live fact-checked draft, is eligible. Every
 * other state has its own refusal, and "needs review" is never a pass.
 */

const DRAFT: ContentDraft = {
  id: "00000000-0000-4000-8000-0000000000d1",
  projectId: "nexra-agency",
  sourceWriterRunId: "11111111-0000-4000-8000-000000000070",
  sourcePlanRunId: null,
  sectionIndex: null,
  sectionLabel: "Section",
  status: "fact-checked",
  currentVersion: 2,
  approvedVersion: null,
  approvedBy: null,
  approvedAt: null,
  publishedVersion: null,
  publishedAt: null,
  remoteContentId: null,
  remoteTarget: null,
  createdBy: "00000000-0000-4000-8000-00000000000a",
  createdAt: "2026-09-22T12:00:00.000Z",
  updatedAt: "2026-09-22T12:00:00.000Z",
};

const CHECK = {
  status: "passed",
  draftId: DRAFT.id,
  version: 2,
  checkedAt: "2026-09-22T14:00:00.000Z",
  checkedByRunId: "11111111-0000-4000-8000-000000000080",
  recordedAt: "2026-09-22T14:05:00.000Z",
  recordedBy: "00000000-0000-4000-8000-00000000000a",
  crawlId: "8f1c0d2e-0000-4000-8000-000000000001",
  searchWindow: null,
  summary: "One supported.",
  supported: [{ text: "Claim", evidence: "crawl /", note: null }],
  partial: [],
  unsupported: [],
  unverifiable: [],
  editorial: [],
};

const VERSION: ContentDraftVersion = {
  id: "00000000-0000-4000-8000-0000000000e2",
  draftId: DRAFT.id,
  version: 2,
  origin: "operator",
  title: "Section",
  body: "Text.",
  claims: [],
  placeholders: [],
  factCheck: CHECK,
  createdBy: "00000000-0000-4000-8000-00000000000a",
  createdAt: "2026-09-22T12:30:00.000Z",
};

describe("approvalEligibility", () => {
  test("a current version with a passed check on a fact-checked draft is eligible", () => {
    assert.deepEqual(approvalEligibility(DRAFT, VERSION), { ok: true });
  });

  test("needs-review and failed are not passes, an unchecked version is not eligible, and a malformed check counts as none", () => {
    assert.deepEqual(approvalEligibility({ ...DRAFT, status: "drafting" }, { ...VERSION, factCheck: { ...CHECK, status: "needs-review" } }), { ok: false, reason: "fact-check-needs-review" });
    assert.deepEqual(approvalEligibility({ ...DRAFT, status: "drafting" }, { ...VERSION, factCheck: { ...CHECK, status: "failed" } }), { ok: false, reason: "fact-check-failed" });
    assert.deepEqual(approvalEligibility({ ...DRAFT, status: "drafting" }, { ...VERSION, factCheck: null }), { ok: false, reason: "not-fact-checked" });
    assert.deepEqual(approvalEligibility(DRAFT, { ...VERSION, factCheck: { status: "passed" } }), { ok: false, reason: "not-fact-checked" });
    assert.deepEqual(approvalEligibility(DRAFT, { ...VERSION, factCheck: { ...CHECK, status: "approved" } }), { ok: false, reason: "not-fact-checked" });
  });

  test("only the current version of a live, fact-checked draft: historical, archived, published, already approved and out-of-state parents are refused in that order", () => {
    assert.deepEqual(approvalEligibility({ ...DRAFT, currentVersion: 3 }, VERSION), { ok: false, reason: "not-current" });
    assert.deepEqual(approvalEligibility({ ...DRAFT, status: "archived" }, VERSION), { ok: false, reason: "draft-archived" });
    assert.deepEqual(approvalEligibility({ ...DRAFT, status: "published", publishedVersion: 2, publishedAt: "2026-09-22T17:00:00.000Z" }, VERSION), { ok: false, reason: "draft-published" });
    assert.deepEqual(approvalEligibility({ ...DRAFT, status: "approved", approvedVersion: 2, approvedBy: "x", approvedAt: "t" }, VERSION), { ok: false, reason: "already-approved" });
    assert.deepEqual(approvalEligibility({ ...DRAFT, status: "drafting" }, VERSION), { ok: false, reason: "status-unexpected" });
    // An approved earlier version does not make the new current version approved.
    assert.deepEqual(approvalEligibility({ ...DRAFT, status: "drafting", currentVersion: 3, approvedVersion: 2, approvedBy: "x", approvedAt: "t" }, { ...VERSION, version: 3, factCheck: null }), { ok: false, reason: "not-fact-checked" });
  });

  test("isApprovedVersion names the recorded approved version whatever the parent's status is now, and the messages say why each refusal stands", () => {
    assert.equal(isApprovedVersion({ ...DRAFT, approvedVersion: 2 }, VERSION), true);
    assert.equal(isApprovedVersion({ ...DRAFT, status: "drafting", currentVersion: 3, approvedVersion: 2 }, VERSION), true);
    assert.equal(isApprovedVersion(DRAFT, VERSION), false);
    assert.match(approvalRefusalMessage("fact-check-needs-review"), /That is not a pass, so this version is not eligible/);
    assert.match(approvalRefusalMessage("fact-check-failed"), /held by no record/);
    assert.match(approvalRefusalMessage("not-fact-checked"), /Run and record a fact-check first/);
    assert.match(approvalRefusalMessage("not-current"), /Only the current version/);
    for (const reason of ["draft-archived", "draft-published", "already-approved", "status-unexpected"] as const) {
      assert.ok(approvalRefusalMessage(reason).length > 0, reason);
    }
  });
});
