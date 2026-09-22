import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ContentDraftVersion } from "../../../types/content-draft.ts";
import type { PublicationProposal } from "../../../types/content-publication.ts";
import { destinationsForProject, findDestination, NEXRA_AGENCY_WEBSITE, PUBLICATION_DESTINATIONS } from "./destinations.ts";
import {
  hasUnresolvedPlaceholders,
  isProposalCurrent,
  proposalEligibility,
  proposalRefusalMessage,
  slugRefusalMessage,
  suggestSlug,
  validateSlug,
  type ProposalRefusal,
} from "./proposal-rules.ts";
import { APPROVED_DRAFT, APPROVED_AT, APPROVER, factCheck, VERSION_1, VERSION_2 } from "./test-support/fixtures.ts";

/**
 * The explicit policy: only the approved current version, whose recorded
 * check passed and was recorded for it, with no placeholder left, and no
 * active proposal for the draft. Every other state has its own refusal,
 * and "needs review" is never a pass.
 */

const check = (status: "passed" | "needs-review" | "failed", version = 2) =>
  factCheck(status, version) as unknown as ContentDraftVersion["factCheck"];

const ACTIVE: PublicationProposal = {
  id: "00000000-0000-4000-8000-0000000000f1",
  projectId: "nexra-agency",
  draftId: APPROVED_DRAFT.id,
  version: 2,
  versionId: VERSION_2.id,
  contentSha256: "a".repeat(64),
  approvedBy: APPROVER,
  approvedAt: APPROVED_AT,
  destination: "nexra-agency-website",
  slug: "lead-follow-up",
  previewFormat: "draft-section-text/1",
  previewSha256: "b".repeat(64),
  status: "proposed",
  requestedBy: APPROVER,
  withdrawnBy: null,
  withdrawnAt: null,
  createdAt: "2026-09-22T16:00:00.000Z",
  updatedAt: "2026-09-22T16:00:00.000Z",
};

describe("proposalEligibility", () => {
  test("the approved current version with a passed check recorded for it, and no placeholder or active proposal, is eligible", () => {
    assert.deepEqual(proposalEligibility(APPROVED_DRAFT, VERSION_2, null), { ok: true });
  });

  test("the live Nexra Agency state — current version 2, check needs review, parent drafting — is refused as needs-review", () => {
    const live = { ...APPROVED_DRAFT, status: "drafting" as const, approvedVersion: null, approvedBy: null, approvedAt: null };
    assert.deepEqual(proposalEligibility(live, { ...VERSION_2, factCheck: check("needs-review") }, null), { ok: false, reason: "fact-check-needs-review" });
  });

  test("needs-review, failed, unchecked, malformed and wrong-version checks are refused, whatever the parent says", () => {
    assert.deepEqual(proposalEligibility(APPROVED_DRAFT, { ...VERSION_2, factCheck: check("needs-review") }, null), { ok: false, reason: "fact-check-needs-review" });
    assert.deepEqual(proposalEligibility(APPROVED_DRAFT, { ...VERSION_2, factCheck: check("failed") }, null), { ok: false, reason: "fact-check-failed" });
    assert.deepEqual(proposalEligibility(APPROVED_DRAFT, { ...VERSION_2, factCheck: null }, null), { ok: false, reason: "not-fact-checked" });
    assert.deepEqual(proposalEligibility(APPROVED_DRAFT, { ...VERSION_2, factCheck: { status: "passed" } }, null), { ok: false, reason: "not-fact-checked" });
    // A passed check recorded for another version, or another draft, is not this version's.
    assert.deepEqual(proposalEligibility(APPROVED_DRAFT, { ...VERSION_2, factCheck: check("passed", 1) }, null), { ok: false, reason: "not-fact-checked" });
    const otherDraft = factCheck("passed", 2, "00000000-0000-4000-8000-0000000000ff") as unknown as ContentDraftVersion["factCheck"];
    assert.deepEqual(proposalEligibility(APPROVED_DRAFT, { ...VERSION_2, factCheck: otherDraft }, null), { ok: false, reason: "not-fact-checked" });
  });

  test("historical versions, archived and published drafts, unapproved and wrongly-approved parents are refused", () => {
    assert.deepEqual(proposalEligibility(APPROVED_DRAFT, VERSION_1, null), { ok: false, reason: "not-current" });
    assert.deepEqual(proposalEligibility({ ...APPROVED_DRAFT, currentVersion: 3 }, VERSION_2, null), { ok: false, reason: "not-current" });
    assert.deepEqual(proposalEligibility({ ...APPROVED_DRAFT, status: "archived" }, VERSION_2, null), { ok: false, reason: "draft-archived" });
    assert.deepEqual(proposalEligibility({ ...APPROVED_DRAFT, status: "published" }, VERSION_2, null), { ok: false, reason: "draft-published" });
    assert.deepEqual(proposalEligibility({ ...APPROVED_DRAFT, status: "fact-checked" }, VERSION_2, null), { ok: false, reason: "not-approved" });
    assert.deepEqual(proposalEligibility({ ...APPROVED_DRAFT, status: "drafting" }, VERSION_2, null), { ok: false, reason: "not-approved" });
    assert.deepEqual(proposalEligibility({ ...APPROVED_DRAFT, approvedVersion: 1 }, VERSION_2, null), { ok: false, reason: "approval-not-current" });
    assert.deepEqual(proposalEligibility({ ...APPROVED_DRAFT, approvedAt: null }, VERSION_2, null), { ok: false, reason: "approval-not-current" });
    // A version of another draft is never this draft's current one.
    assert.deepEqual(proposalEligibility(APPROVED_DRAFT, { ...VERSION_2, draftId: "00000000-0000-4000-8000-0000000000ff" }, null), { ok: false, reason: "not-current" });
  });

  test("unresolved placeholders are refused, listed or left in the text in any case", () => {
    assert.deepEqual(proposalEligibility(APPROVED_DRAFT, { ...VERSION_2, placeholders: ["[NEEDS EVIDENCE: speed]"] }, null), { ok: false, reason: "unresolved-placeholders" });
    assert.deepEqual(proposalEligibility(APPROVED_DRAFT, { ...VERSION_2, body: "Leads are answered [needs evidence: a figure]." }, null), { ok: false, reason: "unresolved-placeholders" });
    assert.deepEqual(proposalEligibility(APPROVED_DRAFT, { ...VERSION_2, title: "Title [Needs Evidence: x]" }, null), { ok: false, reason: "unresolved-placeholders" });
    assert.equal(hasUnresolvedPlaceholders(VERSION_1), true);
    assert.equal(hasUnresolvedPlaceholders(VERSION_2), false);
  });

  test("an active proposal for the draft refuses another", () => {
    assert.deepEqual(proposalEligibility(APPROVED_DRAFT, VERSION_2, ACTIVE), { ok: false, reason: "proposal-exists" });
  });

  test("every refusal has the operator's words, and needs-review says plainly it is not a pass", () => {
    const reasons: readonly ProposalRefusal[] = [
      "draft-archived", "draft-published", "not-current", "not-fact-checked", "fact-check-needs-review", "fact-check-failed",
      "unresolved-placeholders", "not-approved", "approval-not-current", "proposal-exists", "no-destination",
    ];
    for (const reason of reasons) assert.ok(proposalRefusalMessage(reason).length > 0, reason);
    assert.match(proposalRefusalMessage("fact-check-needs-review"), /That is not a pass/);
    assert.match(proposalRefusalMessage("proposal-exists"), /Withdraw it/);
  });
});

describe("isProposalCurrent", () => {
  test("a proposal is current only while it names the approved current version at the same approval", () => {
    assert.equal(isProposalCurrent(APPROVED_DRAFT, ACTIVE), true);
    // An edit: version 3 is current and the parent is drafting; the approval history still names version 2.
    assert.equal(isProposalCurrent({ ...APPROVED_DRAFT, status: "drafting", currentVersion: 3 }, ACTIVE), false);
    assert.equal(isProposalCurrent({ ...APPROVED_DRAFT, approvedAt: "2026-09-22T18:00:00.000000+00:00" }, ACTIVE), false);
    assert.equal(isProposalCurrent(APPROVED_DRAFT, { ...ACTIVE, status: "withdrawn" }), false);
  });
});

describe("slugs", () => {
  test("a slug is lowercase letters, digits and single hyphens, 3 to 80 characters, and is never corrected", () => {
    assert.deepEqual(validateSlug("lead-follow-up"), { ok: true, slug: "lead-follow-up" });
    assert.deepEqual(validateSlug("abc"), { ok: true, slug: "abc" });
    assert.deepEqual(validateSlug(""), { ok: false, refusal: "empty" });
    assert.deepEqual(validateSlug(undefined), { ok: false, refusal: "empty" });
    assert.deepEqual(validateSlug("ab"), { ok: false, refusal: "too-short" });
    assert.deepEqual(validateSlug("a".repeat(81)), { ok: false, refusal: "too-long" });
    for (const bad of ["Lead", "lead--up", "-lead", "lead-", "lead_up", "lead up", "../etc", "lead/up", "léad", "lead.html"]) {
      assert.deepEqual(validateSlug(bad), { ok: false, refusal: "format" }, bad);
    }
    for (const refusal of ["empty", "too-short", "too-long", "format"] as const) assert.ok(slugRefusalMessage(refusal).length > 0);
  });

  test("the suggestion folds accents and punctuation into a valid slug, cut at a word boundary", () => {
    assert.equal(suggestSlug("Automated lead follow-up — how it works"), "automated-lead-follow-up-how-it-works");
    assert.equal(suggestSlug("Café naïve: 2026 guide!"), "cafe-naive-2026-guide");
    const long = suggestSlug("word ".repeat(40));
    assert.ok(long.length <= 80 && validateSlug(long).ok, long);
  });
});

describe("the destination registry", () => {
  test("one entry, the Nexra Agency website, offered only to the Nexra Agency project, with no content path or format assumed", () => {
    assert.equal(PUBLICATION_DESTINATIONS.length, 1);
    assert.equal(NEXRA_AGENCY_WEBSITE.key, "nexra-agency-website");
    assert.equal(NEXRA_AGENCY_WEBSITE.host, "nexraagency.com");
    assert.equal(NEXRA_AGENCY_WEBSITE.contentPath, null);
    assert.equal(NEXRA_AGENCY_WEBSITE.contentFormat, null);
    assert.deepEqual(destinationsForProject("nexra-agency"), [NEXRA_AGENCY_WEBSITE]);
    assert.deepEqual(destinationsForProject("halcyon-fintech"), []);
    assert.equal(findDestination("nexra-agency-website", "nexra-agency"), NEXRA_AGENCY_WEBSITE);
    assert.equal(findDestination("nexra-agency-website", "halcyon-fintech"), null, "another project cannot name this site");
    assert.equal(findDestination("https://nexraagency.com", "nexra-agency"), null);
    assert.equal(findDestination(undefined, "nexra-agency"), null);
  });

  test("the registry carries no credential", () => {
    assert.doesNotMatch(JSON.stringify(PUBLICATION_DESTINATIONS), /token|secret|password|key=|ghp_|github_pat_|Bearer/i);
  });
});
