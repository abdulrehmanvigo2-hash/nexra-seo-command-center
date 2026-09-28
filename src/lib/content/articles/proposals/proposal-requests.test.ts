import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { RECORD_PROPOSAL_CONFIRMATION, WITHDRAW_PROPOSAL_CONFIRMATION } from "@/lib/content/articles/proposals/confirmation";
import {
  articleProposalStateRequest,
  recordArticleProposalRequest,
  withdrawArticleProposalRequest,
  type ProposalWriteDependencies,
} from "@/lib/content/articles/proposals/requests";
import { createArticleProposalService, type ArticleProposalService } from "@/lib/content/articles/proposals/service";
import { APPROVAL_ID, APPROVED_AT, APPROVER, ARTICLE_ID, DESTINATION, PROJECT_ID, VERSION_ID, approvedArticle, approvedContent, canonicalOf } from "@/lib/content/articles/proposals/test-support/fixtures";
import { memoryDb, memoryStores, type MemoryDb } from "@/lib/content/articles/proposals/test-support/memory-db";

/**
 * Stage 5, milestone C6, Checkpoint 3: the GET route's and the Server
 * Actions' request handling, through the real service over the memory
 * database. The order of checks is the point: no operator, no service.
 */

const OPERATOR = { id: "00000000-0000-4000-8000-0000000000cc" };

function world(options: { readonly approved?: boolean } = {}) {
  const content = approvedContent();
  const { text, sha256 } = canonicalOf(content);
  const approved = options.approved ?? true;
  const db: MemoryDb = memoryDb({
    articles: [approved ? approvedArticle() : approvedArticle({ status: "drafting", approvedVersion: null, approvedBy: null, approvedAt: null })],
    versions: [{ id: VERSION_ID, articleId: ARTICLE_ID, version: 2, origin: "operator", canonicalContent: text, contentSha256: sha256, createdBy: OPERATOR.id, createdAt: APPROVED_AT }],
    approvals: approved ? [{ id: APPROVAL_ID, articleId: ARTICLE_ID, articleVersion: 2, articleVersionId: VERSION_ID, contentSha256: sha256, unitCount: 4, unitsSha256: "e".repeat(64), approvedBy: APPROVER, approvedAt: APPROVED_AT, attestedCount: 0, attestedConfirmed: false }] : [],
  });
  const real = createArticleProposalService(memoryStores(db));
  let serviceCalls = 0;
  const logs: string[] = [];
  const service = (): ArticleProposalService => {
    serviceCalls += 1;
    return real;
  };
  const deps = (operator: { id: string } | null = OPERATOR, allowed = true): ProposalWriteDependencies => ({
    operator,
    service,
    allow: async () => (allowed ? { ok: true } : { ok: false, reason: "rate-limited", retryAfterSeconds: 60 }),
    inFlight: new Set(),
    log: (message) => logs.push(message),
  });
  return { db, deps, logs, serviceCalls: () => serviceCalls, readDeps: (operator: { id: string } | null = OPERATOR) => ({ operator, service, log: (m: string) => logs.push(m) }) };
}

describe("GET: the read-only state", () => {
  test("no operator: 401, and the service is never touched", async () => {
    const w = world();
    assert.deepEqual(await articleProposalStateRequest(w.readDeps(null), { project: PROJECT_ID, article: ARTICLE_ID, destination: null }), { status: 401, error: "unauthorized" });
    assert.equal(w.serviceCalls(), 0);
  });

  test("missing or malformed input: 400", async () => {
    const w = world();
    assert.equal((await articleProposalStateRequest(w.readDeps(), { project: null, article: ARTICLE_ID, destination: null })).status, 400);
    assert.equal((await articleProposalStateRequest(w.readDeps(), { project: PROJECT_ID, article: "not-a-uuid", destination: null })).status, 400);
    assert.equal((await articleProposalStateRequest(w.readDeps(), { project: PROJECT_ID, article: ARTICLE_ID, destination: "Bad Key" })).status, 400);
  });

  test("another project, or no such article: 404 with nothing disclosed", async () => {
    const w = world();
    assert.deepEqual(await articleProposalStateRequest(w.readDeps(), { project: "verdant-home", article: ARTICLE_ID, destination: null }), { status: 404, error: "not-found" });
    assert.deepEqual(await articleProposalStateRequest(w.readDeps(), { project: PROJECT_ID, article: "a6000000-0000-4000-8000-00000000ffff", destination: null }), { status: 404, error: "not-found" });
  });

  test("eligible and ineligible states, with no write", async () => {
    const eligible = world();
    const a = await articleProposalStateRequest(eligible.readDeps(), { project: PROJECT_ID, article: ARTICLE_ID, destination: null });
    assert.equal(a.status, 200);
    assert.ok(a.status === 200 && a.body.proposal.eligibility.status === "eligible" && a.body.proposal.preview !== null);
    const blocked = world({ approved: false });
    const b = await articleProposalStateRequest(blocked.readDeps(), { project: PROJECT_ID, article: ARTICLE_ID, destination: DESTINATION });
    assert.ok(b.status === 200 && b.body.proposal.eligibility.status === "blocked" && b.body.proposal.preview === null);
    assert.equal(eligible.db.calls.propose.length + blocked.db.calls.propose.length + eligible.db.calls.withdraw.length, 0);
  });

  test("a failed read is 500 failed, never an empty history; the detail stays in the log", async () => {
    const w = world();
    w.db.failReads.add("proposals");
    assert.deepEqual(await articleProposalStateRequest(w.readDeps(), { project: PROJECT_ID, article: ARTICLE_ID, destination: null }), { status: 500, error: "failed" });
    assert.match(w.logs[0], /read failed/);
  });
});

describe("the Record Proposal action", () => {
  test("no operator: unauthorized, and the service is never touched", async () => {
    const w = world();
    assert.deepEqual(await recordArticleProposalRequest(w.deps(null), PROJECT_ID, ARTICLE_ID, 2, DESTINATION, RECORD_PROPOSAL_CONFIRMATION), { ok: false, reason: "unauthorized" });
    assert.equal(w.serviceCalls(), 0);
  });

  test("malformed arguments: invalid, before the confirmation and the service", async () => {
    const w = world();
    assert.deepEqual(await recordArticleProposalRequest(w.deps(), PROJECT_ID, ARTICLE_ID, "2", DESTINATION, RECORD_PROPOSAL_CONFIRMATION), { ok: false, reason: "invalid" });
    assert.deepEqual(await recordArticleProposalRequest(w.deps(), PROJECT_ID, ARTICLE_ID, 2, { key: DESTINATION }, RECORD_PROPOSAL_CONFIRMATION), { ok: false, reason: "invalid" });
    assert.equal(w.serviceCalls(), 0);
  });

  test("without the exact confirmation: unconfirmed, nothing touched", async () => {
    const w = world();
    for (const confirmation of [undefined, true, "yes", "withdraw-proposal-only", "RECORD-PROPOSAL-ONLY"]) {
      assert.deepEqual(await recordArticleProposalRequest(w.deps(), PROJECT_ID, ARTICLE_ID, 2, DESTINATION, confirmation), { ok: false, reason: "unconfirmed" }, String(confirmation));
    }
    assert.equal(w.serviceCalls(), 0);
  });

  test("created, with the server's operator and the server's binding", async () => {
    const w = world();
    const result = await recordArticleProposalRequest(w.deps(), PROJECT_ID, ARTICLE_ID, 2, DESTINATION, RECORD_PROPOSAL_CONFIRMATION);
    assert.ok(result.ok && result.recorded, JSON.stringify(result));
    assert.equal(w.db.calls.propose[0].requestedBy, OPERATOR.id);
    assert.equal(w.db.calls.propose[0].approvalId, APPROVAL_ID);
    assert.equal(w.db.articles[0].status, "approved", "nothing approved or changed on the article");
  });

  test("a stale browser version: stale, nothing written", async () => {
    const w = world();
    const result = await recordArticleProposalRequest(w.deps(), PROJECT_ID, ARTICLE_ID, 1, DESTINATION, RECORD_PROPOSAL_CONFIRMATION);
    assert.ok(!result.ok && result.reason === "stale");
    assert.equal(w.db.calls.propose.length, 0);
  });

  test("denied eligibility: ineligible with every reason, nothing written", async () => {
    const w = world({ approved: false });
    const result = await recordArticleProposalRequest(w.deps(), PROJECT_ID, ARTICLE_ID, 2, DESTINATION, RECORD_PROPOSAL_CONFIRMATION);
    assert.ok(!result.ok && result.reason === "ineligible");
    assert.deepEqual(!result.ok && result.reason === "ineligible" && result.blocks, ["not-approved", "approval-missing"]);
    assert.equal(w.db.calls.propose.length, 0);
  });

  test("exists (an identical concurrent write) and slug-taken (D3) are the database's answers", async () => {
    const a = world();
    a.db.proposeAnswer = null;
    a.db.beforePropose = () => {
      a.db.beforePropose = null;
      void memoryStores(a.db).proposals.propose(a.db.calls.propose[0]);
    };
    const exists = await recordArticleProposalRequest(a.deps(), PROJECT_ID, ARTICLE_ID, 2, DESTINATION, RECORD_PROPOSAL_CONFIRMATION);
    assert.ok(exists.ok && !exists.recorded);
    const b = world();
    b.db.beforePropose = () => b.db.drafts.push({ proposalId: "d6000000-0000-4000-8000-000000000001", draftId: "d6200000-0000-4000-8000-000000000001", destination: DESTINATION, slug: "missed-call-text-back", status: "proposed" });
    assert.deepEqual(await recordArticleProposalRequest(b.deps(), PROJECT_ID, ARTICLE_ID, 2, DESTINATION, RECORD_PROPOSAL_CONFIRMATION), { ok: false, reason: "refused", outcome: "slug-taken", proposal: null });
  });

  test("rate-limited and one-at-a-time", async () => {
    const w = world();
    assert.equal((await recordArticleProposalRequest(w.deps(OPERATOR, false), PROJECT_ID, ARTICLE_ID, 2, DESTINATION, RECORD_PROPOSAL_CONFIRMATION)).ok, false);
    const busy = w.deps();
    busy.inFlight.add(OPERATOR.id);
    assert.deepEqual(await recordArticleProposalRequest(busy, PROJECT_ID, ARTICLE_ID, 2, DESTINATION, RECORD_PROPOSAL_CONFIRMATION), { ok: false, reason: "rate-limited", retryAfterSeconds: 1 });
    assert.equal(w.db.calls.propose.length, 0);
  });

  test("a failed database call: failed, logged, never success", async () => {
    const w = world();
    w.db.beforePropose = () => {
      throw new Error("connection reset");
    };
    assert.deepEqual(await recordArticleProposalRequest(w.deps(), PROJECT_ID, ARTICLE_ID, 2, DESTINATION, RECORD_PROPOSAL_CONFIRMATION), { ok: false, reason: "failed" });
    assert.match(w.logs.join("\n"), /recordArticleProposal: Error: connection reset/);
  });
});

describe("the Withdraw Proposal action", () => {
  async function recorded() {
    const w = world();
    const result = await recordArticleProposalRequest(w.deps(), PROJECT_ID, ARTICLE_ID, 2, DESTINATION, RECORD_PROPOSAL_CONFIRMATION);
    assert.ok(result.ok);
    return { ...w, proposalId: result.ok ? result.proposal.id : "" };
  }

  test("no operator, bad arguments or no confirmation: refused before the service", async () => {
    const w = await recorded();
    const before = w.serviceCalls();
    assert.deepEqual(await withdrawArticleProposalRequest(w.deps(null), PROJECT_ID, ARTICLE_ID, w.proposalId, WITHDRAW_PROPOSAL_CONFIRMATION), { ok: false, reason: "unauthorized" });
    assert.deepEqual(await withdrawArticleProposalRequest(w.deps(), PROJECT_ID, ARTICLE_ID, 7, WITHDRAW_PROPOSAL_CONFIRMATION), { ok: false, reason: "invalid" });
    assert.deepEqual(await withdrawArticleProposalRequest(w.deps(), PROJECT_ID, ARTICLE_ID, w.proposalId, RECORD_PROPOSAL_CONFIRMATION), { ok: false, reason: "unconfirmed" });
    assert.equal(w.serviceCalls(), before);
  });

  test("withdrawn by the server's operator, then already-withdrawn; history kept, nothing deleted", async () => {
    const w = await recorded();
    const first = await withdrawArticleProposalRequest(w.deps(), PROJECT_ID, ARTICLE_ID, w.proposalId, WITHDRAW_PROPOSAL_CONFIRMATION);
    assert.ok(first.ok && first.withdrawn);
    assert.equal(w.db.calls.withdraw[0].withdrawnBy, OPERATOR.id);
    const second = await withdrawArticleProposalRequest(w.deps(), PROJECT_ID, ARTICLE_ID, w.proposalId, WITHDRAW_PROPOSAL_CONFIRMATION);
    assert.ok(second.ok && !second.withdrawn);
    assert.equal(w.db.proposals.length, 1);
    assert.equal(w.db.articles[0].status, "approved");
  });

  test("another project's proposal: not-found", async () => {
    const w = await recorded();
    assert.deepEqual(await withdrawArticleProposalRequest(w.deps(), "verdant-home", ARTICLE_ID, w.proposalId, WITHDRAW_PROPOSAL_CONFIRMATION), { ok: false, reason: "not-found" });
    assert.equal(w.db.calls.withdraw.length, 0);
  });
});
