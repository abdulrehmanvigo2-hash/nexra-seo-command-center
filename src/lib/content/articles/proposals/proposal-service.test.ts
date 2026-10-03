import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { unavailableArticleApprovalStore } from "@/lib/content/articles/approvals/contract";
import { unavailableArticleCheckStore } from "@/lib/content/articles/checks/contract";
import { unavailableArticleProposalStore } from "@/lib/content/articles/proposals/contract";
import { articleProposalPreviewSha256 } from "@/lib/content/articles/proposals/preview-hash";
import { createArticleProposalService } from "@/lib/content/articles/proposals/service";
import {
  APPROVAL_ID,
  APPROVED_AT,
  APPROVER,
  ARTICLE_ID,
  DESTINATION,
  OTHER_ARTICLE_ID,
  PROJECT_ID,
  VERSION_ID,
  approvedArticle,
  approvedContent,
  canonicalOf,
} from "@/lib/content/articles/proposals/test-support/fixtures";
import { memoryDb, memoryStores, type MemoryDb } from "@/lib/content/articles/proposals/test-support/memory-db";
import { NEXRA_AI_BLOG_TEMPLATE } from "@/lib/content/publications/website/template";
import type { ValidatedArticleContent } from "@/types/content-article";
import type { Article } from "@/types/content-article-record";

/**
 * Stage 5, milestone C6, Checkpoint 3: the proposal service over a memory
 * database that applies the SQL functions' rules (the functions themselves
 * are run against PostgreSQL 16 by `supabase/tests/run.sh`). Concurrent
 * writers are simulated at the one point they matter: between the
 * service's reads and the database call.
 */

const OPERATOR = "00000000-0000-4000-8000-0000000000cc";

function setup(options: { readonly content?: ValidatedArticleContent; readonly article?: Partial<Article>; readonly approval?: boolean } = {}) {
  const content = options.content ?? approvedContent();
  const { text, sha256 } = canonicalOf(content);
  const db: MemoryDb = memoryDb({
    articles: [approvedArticle(options.article)],
    versions: [{ id: VERSION_ID, articleId: ARTICLE_ID, version: 2, origin: "operator", canonicalContent: text, contentSha256: sha256, createdBy: OPERATOR, createdAt: "2026-09-24T10:00:00+00:00" }],
    approvals:
      options.approval === false
        ? []
        : [{ id: APPROVAL_ID, articleId: ARTICLE_ID, articleVersion: 2, articleVersionId: VERSION_ID, contentSha256: sha256, unitCount: 4, unitsSha256: "e".repeat(64), approvedBy: APPROVER, approvedAt: APPROVED_AT, attestedCount: 0, attestedConfirmed: false }],
  });
  const service = createArticleProposalService(memoryStores(db));
  const record = (overrides: Partial<{ projectId: string; articleId: string; articleVersion: number; destination: string; operatorId: string }> = {}) =>
    service.record({ projectId: PROJECT_ID, articleId: ARTICLE_ID, articleVersion: 2, destination: DESTINATION, operatorId: OPERATOR, ...overrides });
  return { db, service, record, content, text, sha256 };
}

describe("the read-only state", () => {
  test("an approved current version: eligible, bound to the C5 approval, with preview, hash, route and completeness", async () => {
    const { service, sha256, db } = setup();
    const result = await service.getState(PROJECT_ID, ARTICLE_ID);
    assert.ok(result.ok);
    if (!result.ok) return;
    const { state } = result;
    assert.equal(state.eligibility.status, "eligible");
    if (state.eligibility.status !== "eligible") return;
    assert.deepEqual(
      [state.eligibility.binding.approvalId, state.eligibility.binding.articleVersionId, state.eligibility.binding.contentSha256, state.eligibility.binding.approvedBy, state.eligibility.binding.approvedAt],
      [APPROVAL_ID, VERSION_ID, sha256, APPROVER, APPROVED_AT],
    );
    assert.equal(state.destination?.key, DESTINATION);
    assert.equal(state.eligibility.route, "/blog/missed-call-text-reply");
    assert.deepEqual(state.eligibility.completeness.missingRequired.map((f) => f.key), ["readingTime"]);
    assert.ok(state.preview !== null);
    assert.equal(state.preview?.format, "article-proposal-text/1");
    assert.equal(state.preview?.previewSha256, articleProposalPreviewSha256(state.preview?.document ?? ""));
    assert.match(state.preview?.previewSha256 ?? "", /^[0-9a-f]{64}$/);
    assert.notEqual(state.preview?.previewSha256, sha256);
    assert.deepEqual([state.activeProposal, state.activeProposalCurrent, state.history], [null, null, []]);
    assert.deepEqual(db.calls.propose, [], "reading writes nothing");
  });

  test("the production Version 2 shape (local fixture): drafting, no approval — not eligible, no preview", async () => {
    const { service } = setup({ content: approvedContent((raw) => (raw.topicDecision = "unset")), article: { status: "drafting", approvedVersion: null, approvedBy: null, approvedAt: null }, approval: false });
    const result = await service.getState(PROJECT_ID, ARTICLE_ID);
    assert.ok(result.ok && result.state.eligibility.status === "blocked");
    assert.deepEqual(result.ok && result.state.eligibility.status === "blocked" && result.state.eligibility.blocks, ["not-approved", "approval-missing"]);
    assert.equal(result.ok && result.state.preview, null);
  });

  test("another project's article is not found, and nothing about it is disclosed", async () => {
    const { service } = setup();
    assert.deepEqual(await service.getState("verdant-home", ARTICLE_ID), { ok: false, reason: "not-found" });
  });

  test("malformed input is invalid; a store that keeps nothing is unavailable, never empty", async () => {
    const { service } = setup();
    assert.deepEqual(await service.getState("Bad", ARTICLE_ID), { ok: false, reason: "invalid" });
    assert.deepEqual(await service.getState(PROJECT_ID, "x"), { ok: false, reason: "invalid" });
    assert.deepEqual(await service.getState(PROJECT_ID, ARTICLE_ID, "Bad Destination"), { ok: false, reason: "invalid" });
    const unavailable = createArticleProposalService({ store: unavailableArticleCheckStore, approvals: unavailableArticleApprovalStore, proposals: unavailableArticleProposalStore });
    assert.deepEqual(await unavailable.getState(PROJECT_ID, ARTICLE_ID), { ok: false, reason: "unavailable" });
    const noProposals = createArticleProposalService({ ...memoryStores(setup().db), proposals: unavailableArticleProposalStore });
    assert.deepEqual(await noProposals.getState(PROJECT_ID, ARTICLE_ID), { ok: false, reason: "unavailable" });
  });

  test("a failed read throws: never an empty history or an empty reservation list", async () => {
    for (const read of ["article", "version", "approvals", "proposals", "holders"] as const) {
      const { service, db } = setup();
      db.failReads.add(read);
      await assert.rejects(service.getState(PROJECT_ID, ARTICLE_ID), /read failed/, read);
    }
  });

  test("an unregistered destination, a stored hash mismatch, D2 and D3 are reported", async () => {
    const a = setup();
    const unregistered = await a.service.getState(PROJECT_ID, ARTICLE_ID, "other-site");
    assert.ok(unregistered.ok && unregistered.state.eligibility.status === "blocked" && unregistered.state.eligibility.blocks.includes("destination-unavailable"));
    assert.equal(unregistered.ok && unregistered.state.destination, null);

    const b = setup();
    b.db.versions[0] = { ...b.db.versions[0], contentSha256: "f".repeat(64) };
    const mismatch = await b.service.getState(PROJECT_ID, ARTICLE_ID);
    assert.ok(mismatch.ok && mismatch.state.eligibility.status === "blocked" && mismatch.state.eligibility.blocks.includes("content-hash-mismatch"));

    const live = NEXRA_AI_BLOG_TEMPLATE.existingArticles[0].slug;
    const c = setup({ content: approvedContent((raw) => (raw.slug = live)) });
    const collision = await c.service.getState(PROJECT_ID, ARTICLE_ID);
    assert.ok(collision.ok && collision.state.eligibility.status === "blocked" && collision.state.eligibility.blocks.includes("slug-live-collision"));
    const d = setup({ content: approvedContent((raw) => ((raw.slug = live), (raw.topicDecision = "update-existing"))) });
    const warned = await d.service.getState(PROJECT_ID, ARTICLE_ID);
    assert.ok(warned.ok && warned.state.eligibility.status === "eligible");
    assert.deepEqual(warned.ok && warned.state.eligibility.warnings, ["live-slug-update-existing"]);
    assert.match(warned.ok ? (warned.state.preview?.document ?? "") : "", /not permission to overwrite the live article/);

    const e = setup();
    e.db.drafts.push({ proposalId: "d6000000-0000-4000-8000-000000000001", draftId: "d6200000-0000-4000-8000-000000000001", destination: DESTINATION, slug: "missed-call-text-reply", status: "proposed" });
    const draftHeld = await e.service.getState(PROJECT_ID, ARTICLE_ID);
    assert.ok(draftHeld.ok && draftHeld.state.eligibility.status === "blocked" && draftHeld.state.eligibility.blocks.includes("slug-taken-by-draft"));
  });
});

describe("recording a proposal", () => {
  test("created: the database binding is the server's own; the stored proposal is re-read and returned", async () => {
    const { record, db, sha256 } = setup();
    const result = await record();
    assert.ok(result.ok && result.recorded, JSON.stringify(result));
    if (!result.ok) return;
    assert.equal(db.calls.propose.length, 1);
    const sent = db.calls.propose[0];
    assert.deepEqual(
      { ...sent, previewSha256: "·" },
      {
        projectId: PROJECT_ID,
        articleId: ARTICLE_ID,
        articleVersion: 2,
        articleVersionId: VERSION_ID,
        contentSha256: sha256,
        approvalId: APPROVAL_ID,
        destination: DESTINATION,
        slug: "missed-call-text-reply",
        previewFormat: "article-proposal-text/1",
        previewSha256: "·",
        requestedBy: OPERATOR,
      },
    );
    assert.match(sent.previewSha256, /^[0-9a-f]{64}$/);
    assert.equal(result.proposal.status, "proposed");
    assert.equal(result.state.activeProposal?.id, result.proposal.id);
    assert.equal(result.state.activeProposalCurrent, true);
    assert.deepEqual(result.state.history.map((p) => p.id), [result.proposal.id]);
    assert.equal(result.state.eligibility.status, "blocked", "an active proposal blocks another");
  });

  test("the preview hash sent is the server's hash of the preview the state shows", async () => {
    const { service, record, db } = setup();
    const before = await service.getState(PROJECT_ID, ARTICLE_ID);
    await record();
    assert.ok(before.ok);
    assert.equal(db.calls.propose[0].previewSha256, before.ok ? before.state.preview?.previewSha256 : "");
  });

  test("a second identical request is refused by the rule (proposal-exists) and writes nothing", async () => {
    const { record, db } = setup();
    await record();
    const second = await record();
    assert.deepEqual(second.ok === false && second.reason === "ineligible" && second.blocks, ["proposal-exists"]);
    assert.equal(db.calls.propose.length, 1);
    assert.equal(db.proposals.length, 1);
  });

  test("ineligible and stale requests never reach the database", async () => {
    const drafting = setup({ article: { status: "drafting", approvedVersion: null, approvedBy: null, approvedAt: null }, approval: false });
    const refused = await drafting.record();
    assert.ok(!refused.ok && refused.reason === "ineligible");
    const stale = setup();
    const old = await stale.record({ articleVersion: 1 });
    assert.ok(!old.ok && old.reason === "stale");
    const noApproval = setup({ approval: false });
    const missing = await noApproval.record();
    assert.ok(!missing.ok && missing.reason === "ineligible" && missing.blocks.includes("approval-missing"));
    const unregistered = setup();
    assert.ok(!(await unregistered.record({ destination: "other-site" })).ok);
    assert.equal(drafting.db.calls.propose.length + stale.db.calls.propose.length + noApproval.db.calls.propose.length + unregistered.db.calls.propose.length, 0);
  });

  test("invalid requests and an unavailable store are refused before any read", async () => {
    const { record, db } = setup();
    for (const bad of [{ projectId: "Bad" }, { articleId: "x" }, { articleVersion: 0 }, { destination: "" }, { operatorId: "someone" }]) {
      assert.deepEqual(await record(bad), { ok: false, reason: "invalid" }, JSON.stringify(bad));
    }
    assert.deepEqual(db.calls.reads, []);
  });

  describe("the database decides, after the service's reads", () => {
    test("an identical concurrent proposal: exists, nothing written, not reported as recorded", async () => {
      const { record, db } = setup();
      db.beforePropose = () => {
        db.beforePropose = null;
        void memoryStores(db).proposals.propose(db.calls.propose[0]);
      };
      const result = await record();
      assert.ok(result.ok && !result.recorded, JSON.stringify(result));
      assert.equal(db.proposals.length, 1);
    });

    test("a conflicting concurrent proposal: active-exists, refused with the active one", async () => {
      const { record, db } = setup();
      db.beforePropose = () => {
        db.beforePropose = null;
        void memoryStores(db).proposals.propose({ ...db.calls.propose[0], previewSha256: "b".repeat(64) });
      };
      const result = await record();
      assert.ok(!result.ok && result.reason === "refused" && result.outcome === "active-exists" && result.proposal !== null);
    });

    test("a new version saved meanwhile: refused (not-approved), nothing written", async () => {
      const { record, db } = setup();
      db.beforePropose = () => {
        db.articles[0] = { ...db.articles[0], status: "drafting", currentVersion: 3 };
      };
      const result = await record();
      assert.deepEqual(result, { ok: false, reason: "refused", outcome: "not-approved", proposal: null });
      assert.equal(db.proposals.length, 0);
    });

    test("archived meanwhile: refused (archived)", async () => {
      const { record, db } = setup();
      db.beforePropose = () => {
        db.articles[0] = { ...db.articles[0], status: "archived" };
      };
      assert.deepEqual(await record(), { ok: false, reason: "refused", outcome: "archived", proposal: null });
    });

    test("a draft proposal takes the slug meanwhile (D3): refused (slug-taken)", async () => {
      const { record, db } = setup();
      db.beforePropose = () => {
        db.drafts.push({ proposalId: "d6000000-0000-4000-8000-000000000002", draftId: "d6200000-0000-4000-8000-000000000002", destination: DESTINATION, slug: "missed-call-text-reply", status: "proposed" });
      };
      assert.deepEqual(await record(), { ok: false, reason: "refused", outcome: "slug-taken", proposal: null });
    });

    test("another article takes the slug meanwhile: refused (slug-taken)", async () => {
      const { record, db } = setup();
      db.beforePropose = () => {
        db.proposals.push({ ...db.calls.propose[0], id: "f6000000-0000-4000-8000-00000000abcd", articleId: OTHER_ARTICLE_ID, approvedBy: APPROVER, approvedAt: APPROVED_AT, status: "proposed", withdrawnBy: null, withdrawnAt: null, createdAt: APPROVED_AT, updatedAt: APPROVED_AT });
      };
      assert.deepEqual(await record(), { ok: false, reason: "refused", outcome: "slug-taken", proposal: null });
    });

    test("the approval pointer changed meanwhile: refused (approval-mismatch)", async () => {
      const { record, db } = setup();
      db.beforePropose = () => {
        db.articles[0] = { ...db.articles[0], approvedAt: "2026-09-24T12:00:01+00:00" };
      };
      assert.deepEqual(await record(), { ok: false, reason: "refused", outcome: "approval-mismatch", proposal: null });
    });

    test("every other documented refusal is passed through as refused, never as success", async () => {
      for (const outcome of ["stale", "content-mismatch", "version-mismatch", "invalid-preview", "slug-mismatch", "unresolved-placeholder", "destination-unavailable", "not-found"] as const) {
        const { record, db } = setup();
        db.proposeAnswer = { status: outcome };
        assert.deepEqual(await record(), { ok: false, reason: "refused", outcome, proposal: null }, outcome);
      }
    });

    test("a failed database call throws; nothing is reported as created", async () => {
      const { record, db } = setup();
      db.beforePropose = () => {
        throw new Error("database unavailable");
      };
      await assert.rejects(record(), /database unavailable/);
      assert.equal(db.proposals.length, 0);
    });
  });
});

describe("withdrawing a proposal", () => {
  async function recorded() {
    const s = setup();
    const result = await s.record();
    assert.ok(result.ok);
    return { ...s, proposalId: result.ok ? result.proposal.id : "" };
  }

  test("withdrawn by the server's operator; history keeps it; nothing else changes", async () => {
    const { service, db, proposalId } = await recorded();
    const articleBefore = structuredClone(db.articles[0]);
    const approvalsBefore = structuredClone(db.approvals);
    const result = await service.withdraw({ projectId: PROJECT_ID, articleId: ARTICLE_ID, proposalId, operatorId: OPERATOR });
    assert.ok(result.ok && result.withdrawn, JSON.stringify(result));
    assert.deepEqual(db.calls.withdraw, [{ projectId: PROJECT_ID, proposalId, withdrawnBy: OPERATOR }]);
    assert.equal(result.ok && result.proposal.status, "withdrawn");
    assert.equal(result.ok && result.state.activeProposal, null);
    assert.deepEqual(result.ok && result.state.history.map((p) => [p.id, p.status]), [[proposalId, "withdrawn"]]);
    assert.deepEqual(db.articles[0], articleBefore);
    assert.deepEqual(db.approvals, approvalsBefore);
    assert.equal(result.ok && result.state.eligibility.status, "eligible", "the version may be proposed again");
  });

  test("a repeated withdrawal: already-withdrawn, per the database", async () => {
    const { service, proposalId } = await recorded();
    await service.withdraw({ projectId: PROJECT_ID, articleId: ARTICLE_ID, proposalId, operatorId: OPERATOR });
    const again = await service.withdraw({ projectId: PROJECT_ID, articleId: ARTICLE_ID, proposalId, operatorId: OPERATOR });
    assert.ok(again.ok && !again.withdrawn);
  });

  test("withdrawal racing withdrawal: the second is already-withdrawn", async () => {
    const { service, db, proposalId } = await recorded();
    db.beforeWithdraw = () => {
      db.beforeWithdraw = null;
      void memoryStores(db).proposals.withdraw({ projectId: PROJECT_ID, proposalId, withdrawnBy: OPERATOR });
    };
    const result = await service.withdraw({ projectId: PROJECT_ID, articleId: ARTICLE_ID, proposalId, operatorId: OPERATOR });
    assert.ok(result.ok && !result.withdrawn);
  });

  test("another project's or another article's proposal is not found; the database is not called", async () => {
    const { service, db, proposalId } = await recorded();
    assert.deepEqual(await service.withdraw({ projectId: "verdant-home", articleId: ARTICLE_ID, proposalId, operatorId: OPERATOR }), { ok: false, reason: "not-found" });
    assert.deepEqual(await service.withdraw({ projectId: PROJECT_ID, articleId: OTHER_ARTICLE_ID, proposalId, operatorId: OPERATOR }), { ok: false, reason: "not-found" });
    assert.deepEqual(await service.withdraw({ projectId: PROJECT_ID, articleId: ARTICLE_ID, proposalId: "f6000000-0000-4000-8000-00000000ffff", operatorId: OPERATOR }), { ok: false, reason: "not-found" });
    assert.equal(db.calls.withdraw.length, 0);
  });

  test("invalid input is refused before any read", async () => {
    const { service } = setup();
    assert.deepEqual(await service.withdraw({ projectId: PROJECT_ID, articleId: ARTICLE_ID, proposalId: "x", operatorId: OPERATOR }), { ok: false, reason: "invalid" });
    assert.deepEqual(await service.withdraw({ projectId: PROJECT_ID, articleId: ARTICLE_ID, proposalId: "f6000000-0000-4000-8000-00000000ffff", operatorId: "someone" }), { ok: false, reason: "invalid" });
  });

  test("a stale active proposal is reported as not current after a new version", async () => {
    const { service, db } = await recorded();
    db.articles[0] = { ...db.articles[0], status: "drafting", currentVersion: 3 };
    db.versions.push({ ...db.versions[0], id: "b6000000-0000-4000-8000-000000000003", version: 3 });
    const state = await service.getState(PROJECT_ID, ARTICLE_ID);
    assert.ok(state.ok);
    assert.equal(state.ok && state.state.activeProposalCurrent, false);
    assert.ok(state.ok && state.state.eligibility.status === "blocked");
  });
});
