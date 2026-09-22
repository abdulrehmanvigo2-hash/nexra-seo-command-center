import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { ContentDraftVersion } from "../../../types/content-draft.ts";
import { contentSha256, previewSha256 } from "./content-hash.ts";
import { unavailableProposalStore } from "./contract.ts";
import { buildPublicationPreview } from "./preview.ts";
import { createPublicationService, type ProposeRequest } from "./service.ts";
import {
  APPROVED_AT,
  APPROVER,
  DRAFT_ID,
  factCheck,
  memoryDraftStore,
  memoryProposalStore,
  OPERATOR,
  PROJECT,
  VERSION_2,
  VERSION_2_ID,
  VERSION_2_SQL_HASH,
  world,
  type World,
} from "./test-support/fixtures.ts";

/**
 * The service over in-memory stores. The proposal store answers the way the
 * database function does, so each test can see what is written and — for
 * every refusal — that nothing is. `fetch` is replaced by a trap for the
 * whole file: nothing here may reach the network, GitHub included.
 */

const realFetch = globalThis.fetch;
let fetchCalls = 0;
beforeEach(() => {
  fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("no network call is allowed from the publication service");
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  assert.equal(fetchCalls, 0, "the publication service made a network call");
});

function serviceOver(w: World, options: Parameters<typeof memoryProposalStore>[1] = {}) {
  return createPublicationService({ drafts: memoryDraftStore(w), proposals: memoryProposalStore(w, options) });
}

const ask = (overrides: Partial<ProposeRequest> = {}): ProposeRequest => ({
  projectId: PROJECT,
  draftId: DRAFT_ID,
  version: 2,
  destination: "nexra-agency-website",
  slug: "lead-follow-up",
  expectedContentSha256: VERSION_2_SQL_HASH,
  operatorId: OPERATOR,
  ...overrides,
});

const check = (status: "passed" | "needs-review" | "failed") => factCheck(status) as unknown as ContentDraftVersion["factCheck"];

/** A deep copy of what must never change: the drafts and the versions. */
const snapshot = (w: World) => JSON.stringify({ drafts: w.drafts, versions: w.versions });

describe("publicationService.propose", () => {
  test("the approved current version with a passed check is proposed, bound to the exact row, the server's hash, the approval and the operator", async () => {
    const w = world();
    const before = snapshot(w);
    const result = await serviceOver(w).propose(ask());
    assert.ok(result.ok && result.created, JSON.stringify(result));
    assert.equal(w.proposals.length, 1);
    const [proposal] = w.proposals;
    assert.equal(proposal.status, "proposed");
    assert.equal(proposal.projectId, PROJECT);
    assert.equal(proposal.draftId, DRAFT_ID);
    assert.equal(proposal.version, 2);
    assert.equal(proposal.versionId, VERSION_2_ID);
    assert.equal(proposal.contentSha256, VERSION_2_SQL_HASH);
    assert.equal(proposal.approvedBy, APPROVER);
    assert.equal(proposal.approvedAt, APPROVED_AT);
    assert.equal(proposal.requestedBy, OPERATOR);
    assert.equal(proposal.destination, "nexra-agency-website");
    assert.equal(proposal.slug, "lead-follow-up");
    // The stored preview hash is the hash of the preview rebuilt from the row.
    const preview = buildPublicationPreview({
      destination: result.state.active!.destination!,
      slug: "lead-follow-up",
      projectId: PROJECT,
      draftId: DRAFT_ID,
      version: 2,
      versionId: VERSION_2_ID,
      contentSha256: VERSION_2_SQL_HASH,
      approvedBy: APPROVER,
      approvedAt: APPROVED_AT,
      title: VERSION_2.title,
      body: VERSION_2.body,
    });
    assert.equal(proposal.previewSha256, previewSha256(preview.document));
    // The answer carries the verified preview of the exact approved text.
    const active = result.state.active!;
    assert.equal(active.verified, true);
    assert.equal(active.current, true);
    assert.equal(active.preview?.title, VERSION_2.title);
    assert.equal(active.preview?.body, VERSION_2.body);
    assert.equal(result.state.candidate, null);
    assert.equal(result.state.refusal, "proposal-exists");
    // Nothing about the draft or its versions changed.
    assert.equal(snapshot(w), before);
  });

  test("the live Nexra Agency state (version 2, needs review, drafting) is refused and nothing is written", async () => {
    const w = world({ draft: { status: "drafting", approvedVersion: null, approvedBy: null, approvedAt: null }, version2: { factCheck: check("needs-review") } });
    assert.deepEqual(await serviceOver(w).propose(ask()), { ok: false, reason: "ineligible", refusal: "fact-check-needs-review" });
    assert.equal(w.proposals.length, 0);
    assert.ok(!w.calls.includes("proposals.create"));
  });

  test("needs-review, failed and unchecked versions are refused even on an approved parent; nothing reaches the store's write", async () => {
    for (const [factCheckValue, refusal] of [
      [check("needs-review"), "fact-check-needs-review"],
      [check("failed"), "fact-check-failed"],
      [null, "not-fact-checked"],
    ] as const) {
      const w = world({ version2: { factCheck: factCheckValue } });
      assert.deepEqual(await serviceOver(w).propose(ask()), { ok: false, reason: "ineligible", refusal }, refusal);
      assert.equal(w.proposals.length, 0);
      assert.ok(!w.calls.includes("proposals.create"), refusal);
    }
  });

  test("a historical version is refused as stale: only the current version is proposed", async () => {
    const w = world();
    assert.deepEqual(await serviceOver(w).propose(ask({ version: 1 })), { ok: false, reason: "stale", currentVersion: 2 });
    assert.equal(w.proposals.length, 0);
  });

  test("unresolved placeholders are refused", async () => {
    const w = world({ version2: { body: "Leads are answered [NEEDS EVIDENCE: how fast]." } });
    const hash = contentSha256({ title: VERSION_2.title, body: "Leads are answered [NEEDS EVIDENCE: how fast]." });
    assert.deepEqual(await serviceOver(w).propose(ask({ expectedContentSha256: hash })), { ok: false, reason: "ineligible", refusal: "unresolved-placeholders" });
    assert.equal(w.proposals.length, 0);
  });

  test("cross-project access is refused: another project cannot reach or name this draft", async () => {
    const w = world();
    // Another project with no destination: refused before anything is read.
    assert.deepEqual(await serviceOver(w).propose(ask({ projectId: "halcyon-fintech" })), { ok: false, reason: "destination-unknown" });
    // The draft moved to another project in the store (as another client's draft would be): not found.
    w.drafts[0] = { ...w.drafts[0], projectId: "other-client" };
    assert.deepEqual(await serviceOver(w).propose(ask()), { ok: false, reason: "not-found" });
    assert.equal(w.proposals.length, 0);
  });

  test("an unknown destination, an invalid slug and malformed identifiers are refused before anything is read", async () => {
    const w = world();
    const service = serviceOver(w);
    assert.deepEqual(await service.propose(ask({ destination: "https://nexraagency.com" })), { ok: false, reason: "destination-unknown" });
    assert.deepEqual(await service.propose(ask({ slug: "../etc/passwd" })), { ok: false, reason: "slug", refusal: "format" });
    assert.deepEqual(await service.propose(ask({ slug: "Lead" })), { ok: false, reason: "slug", refusal: "format" });
    assert.deepEqual(await service.propose(ask({ draftId: "not-a-uuid" })), { ok: false, reason: "invalid" });
    assert.deepEqual(await service.propose(ask({ operatorId: "someone" })), { ok: false, reason: "invalid" });
    assert.deepEqual(await service.propose(ask({ version: 1.5 })), { ok: false, reason: "invalid" });
    assert.deepEqual(await service.propose(ask({ expectedContentSha256: "browser-says-so" })), { ok: false, reason: "invalid" });
    assert.deepEqual(w.calls, [], "nothing was read");
  });

  test("a content hash the operator was not shown by the server is refused, never stored", async () => {
    const w = world();
    assert.deepEqual(await serviceOver(w).propose(ask({ expectedContentSha256: "0".repeat(64) })), { ok: false, reason: "content-changed" });
    assert.equal(w.proposals.length, 0);
  });

  test("stale approval: the draft is edited between the service's read and the database write, and nothing is proposed", async () => {
    const w = world();
    const service = serviceOver(w, {
      beforeCreate: () => {
        // Stage 2's save, as it lands: version 3 current, the parent back to drafting, the approval history kept.
        w.versions.push({ ...VERSION_2, id: "00000000-0000-4000-8000-0000000000e3", version: 3, body: "Edited.", factCheck: null });
        w.drafts[0] = { ...w.drafts[0], currentVersion: 3, status: "drafting" };
      },
    });
    assert.deepEqual(await service.propose(ask()), { ok: false, reason: "stale", currentVersion: 3 });
    assert.equal(w.proposals.length, 0);
    assert.equal(w.drafts[0].approvedVersion, 2, "the approval history is untouched");
  });

  test("stale approval: a re-approval at a different moment between read and write is refused", async () => {
    const w = world();
    const service = serviceOver(w, { beforeCreate: () => void (w.drafts[0] = { ...w.drafts[0], approvedAt: "2026-09-22T18:00:00.000000+00:00" }) });
    assert.deepEqual(await service.propose(ask()), { ok: false, reason: "stale", currentVersion: 2 });
    assert.equal(w.proposals.length, 0);
  });

  test("a duplicate is refused: a different second proposal for the same draft while one is active", async () => {
    const w = world();
    const service = serviceOver(w);
    assert.ok((await service.propose(ask())).ok);
    assert.deepEqual(await service.propose(ask({ slug: "another-name" })), { ok: false, reason: "ineligible", refusal: "proposal-exists" });
    assert.equal(w.proposals.filter((p) => p.status === "proposed").length, 1);
  });

  test("the same proposal asked for twice writes once: the second answer is created: false with the same record", async () => {
    const w = world();
    const service = serviceOver(w);
    const first = await service.propose(ask());
    const creates = w.calls.filter((call) => call === "proposals.create").length;
    const second = await service.propose(ask());
    assert.ok(first.ok && first.created);
    assert.ok(second.ok && !second.created);
    assert.equal(second.state.active?.proposal.id, first.state.active?.proposal.id);
    assert.equal(w.calls.filter((call) => call === "proposals.create").length, creates, "the repeat reached the store's write");
    assert.equal(w.proposals.length, 1);
  });

  test("concurrent requests cannot create two active proposals: both pass the service's checks, the database answers the second", async () => {
    const w = world();
    const service = serviceOver(w);
    const [a, b] = await Promise.all([service.propose(ask()), service.propose(ask({ slug: "a-different-slug" }))]);
    assert.equal(w.calls.filter((call) => call === "proposals.create").length, 2, "both requests reached the database function");
    assert.equal(w.proposals.filter((p) => p.status === "proposed").length, 1);
    const outcomes = [a, b].map((r) => (r.ok ? `created:${r.created}` : `${r.reason}:${"refusal" in r ? r.refusal : ""}`)).sort();
    assert.deepEqual(outcomes, ["created:true", "ineligible:proposal-exists"]);
  });

  test("a double click races itself and still writes one proposal", async () => {
    const w = world();
    const service = serviceOver(w);
    const results = await Promise.all([service.propose(ask()), service.propose(ask()), service.propose(ask())]);
    assert.ok(results.every((r) => r.ok));
    assert.equal(results.filter((r) => r.ok && r.created).length, 1);
    assert.equal(w.proposals.length, 1);
  });

  test("a slug another draft's active proposal holds at the destination is refused", async () => {
    const w = world();
    w.proposals.push({
      id: "00000000-0000-4000-8000-0000000000f9",
      projectId: PROJECT,
      draftId: "00000000-0000-4000-8000-0000000000d9",
      version: 1,
      versionId: "00000000-0000-4000-8000-0000000000e9",
      contentSha256: "a".repeat(64),
      approvedBy: APPROVER,
      approvedAt: APPROVED_AT,
      destination: "nexra-agency-website",
      slug: "lead-follow-up",
      previewFormat: "draft-section-text/1",
      previewSha256: "b".repeat(64),
      status: "proposed",
      requestedBy: OPERATOR,
      withdrawnBy: null,
      withdrawnAt: null,
      createdAt: "2026-09-22T15:30:00.000Z",
      updatedAt: "2026-09-22T15:30:00.000Z",
    });
    assert.deepEqual(await serviceOver(w).propose(ask()), { ok: false, reason: "slug-taken" });
  });

  test("with no store, nothing is proposed", async () => {
    const w = world();
    const service = createPublicationService({ drafts: memoryDraftStore(w), proposals: unavailableProposalStore });
    assert.deepEqual(await service.propose(ask()), { ok: false, reason: "unavailable" });
  });
});

describe("publicationService.getState", () => {
  test("an eligible draft offers a candidate: the server's reading of the current version, its hash, the destination and a suggested slug", async () => {
    const w = world();
    const result = await serviceOver(w).getState(PROJECT, DRAFT_ID);
    assert.ok(result.ok);
    const { candidate, refusal, active } = result.state;
    assert.equal(refusal, null);
    assert.equal(active, null);
    assert.equal(candidate?.version, 2);
    assert.equal(candidate?.versionId, VERSION_2_ID);
    assert.equal(candidate?.contentSha256, VERSION_2_SQL_HASH);
    assert.equal(candidate?.title, VERSION_2.title);
    assert.equal(candidate?.body, VERSION_2.body);
    assert.deepEqual(candidate?.destinations.map((d) => d.key), ["nexra-agency-website"]);
    assert.equal(candidate?.suggestedSlug, "automated-lead-follow-up-how-it-works");
  });

  test("an ineligible draft offers no candidate and says why; another project's draft is not found", async () => {
    const w = world({ draft: { status: "drafting" }, version2: { factCheck: check("needs-review") } });
    const result = await serviceOver(w).getState(PROJECT, DRAFT_ID);
    assert.ok(result.ok);
    assert.equal(result.state.candidate, null);
    assert.equal(result.state.refusal, "fact-check-needs-review");
    assert.deepEqual(await serviceOver(w).getState("other-client", DRAFT_ID), { ok: false, reason: "not-found" });
  });

  test("after an edit the active proposal is shown stale but still verified against its own bound row", async () => {
    const w = world();
    const service = serviceOver(w);
    assert.ok((await service.propose(ask())).ok);
    w.versions.push({ ...VERSION_2, id: "00000000-0000-4000-8000-0000000000e3", version: 3, body: "Edited.", factCheck: null });
    w.drafts[0] = { ...w.drafts[0], currentVersion: 3, status: "drafting" };
    const result = await service.getState(PROJECT, DRAFT_ID);
    assert.ok(result.ok);
    assert.equal(result.state.active?.current, false);
    assert.equal(result.state.active?.verified, true);
    assert.equal(result.state.active?.preview?.body, VERSION_2.body, "the preview is the bound version's text, not the newer one");
  });

  test("a proposal whose stored preview hash does not match its bound row is reported unverified", async () => {
    const w = world();
    const service = serviceOver(w);
    assert.ok((await service.propose(ask())).ok);
    w.proposals[0] = { ...w.proposals[0], previewSha256: "f".repeat(64) };
    const result = await service.getState(PROJECT, DRAFT_ID);
    assert.ok(result.ok);
    assert.equal(result.state.active?.verified, false);
  });
});

describe("publicationService.withdraw", () => {
  test("withdraw changes the proposal's status and withdrawer only: no draft, version, fact-check or approval changes", async () => {
    const w = world();
    const service = serviceOver(w);
    const proposed = await service.propose(ask());
    assert.ok(proposed.ok);
    const before = snapshot(w);
    const binding = { ...w.proposals[0] };
    const result = await service.withdraw({ projectId: PROJECT, draftId: DRAFT_ID, proposalId: binding.id, operatorId: OPERATOR });
    assert.ok(result.ok && result.withdrawn, JSON.stringify(result));
    assert.equal(snapshot(w), before, "a draft or version changed on withdrawal");
    const after = w.proposals[0];
    assert.equal(after.status, "withdrawn");
    assert.equal(after.withdrawnBy, OPERATOR);
    for (const key of ["id", "projectId", "draftId", "version", "versionId", "contentSha256", "approvedBy", "approvedAt", "destination", "slug", "previewFormat", "previewSha256", "requestedBy", "createdAt"] as const) {
      assert.equal(after[key], binding[key], key);
    }
    // The draft may be proposed again afterwards.
    assert.equal(result.state.active, null);
    assert.equal(result.state.history.length, 1);
    assert.equal(result.state.candidate?.version, 2);
  });

  test("withdrawing twice writes once; another draft's or project's proposal is not found", async () => {
    const w = world();
    const service = serviceOver(w);
    assert.ok((await service.propose(ask())).ok);
    const id = w.proposals[0].id;
    assert.ok((await service.withdraw({ projectId: PROJECT, draftId: DRAFT_ID, proposalId: id, operatorId: OPERATOR })).ok);
    const again = await service.withdraw({ projectId: PROJECT, draftId: DRAFT_ID, proposalId: id, operatorId: OPERATOR });
    assert.ok(again.ok && !again.withdrawn);
    assert.equal(w.calls.filter((call) => call === "proposals.withdraw").length, 1);
    assert.deepEqual(await service.withdraw({ projectId: "other-client", draftId: DRAFT_ID, proposalId: id, operatorId: OPERATOR }), { ok: false, reason: "not-found" });
    assert.deepEqual(await service.withdraw({ projectId: PROJECT, draftId: "00000000-0000-4000-8000-0000000000ff", proposalId: id, operatorId: OPERATOR }), { ok: false, reason: "not-found" });
    assert.deepEqual(await service.withdraw({ projectId: PROJECT, draftId: DRAFT_ID, proposalId: "x", operatorId: OPERATOR }), { ok: false, reason: "invalid" });
  });
});

describe("the service's surface", () => {
  test("offers reading, proposing and withdrawing only: no publish, pull request, merge or deploy method exists", () => {
    const service = serviceOver(world());
    assert.deepEqual(Object.keys(service).sort(), ["getState", "propose", "withdraw"]);
  });
});
