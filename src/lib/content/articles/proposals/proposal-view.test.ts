import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { RECORD_PROPOSAL_CONFIRMATION, RECORD_PROPOSAL_CONFIRMATION_TEXT, WITHDRAW_PROPOSAL_CONFIRMATION, WITHDRAW_PROPOSAL_CONFIRMATION_TEXT } from "@/lib/content/articles/proposals/confirmation";
import { PROPOSE_REFUSALS } from "@/lib/content/articles/proposals/contract";
import { createArticleProposalService, type ArticleProposalStateView } from "@/lib/content/articles/proposals/service";
import { APPROVAL_ID, APPROVED_AT, APPROVER, ARTICLE_ID, DESTINATION, PROJECT_ID, VERSION_ID, approvedArticle, approvedContent, canonicalOf } from "@/lib/content/articles/proposals/test-support/fixtures";
import { memoryDb, memoryStores } from "@/lib/content/articles/proposals/test-support/memory-db";
import {
  HEADLINE_LABEL,
  LOAD_MESSAGE,
  PROPOSAL_EXPLANATION,
  PROPOSAL_ONLY_BANNER,
  canRecord,
  canWithdraw,
  proposalHeadline,
  proposalLoadFromResponse,
  proposalStanding,
  recordNote,
  withdrawNote,
  type ProposalLoad,
} from "@/lib/content/articles/proposals/view";
import { NEXRA_AI_BLOG_TEMPLATE } from "@/lib/content/publications/website/template";
import type { ValidatedArticleContent } from "@/types/content-article";
import type { Article } from "@/types/content-article-record";

/**
 * Stage 5, milestone C6, Checkpoint 4: what the proposal section shows and
 * offers, decided from real service states over the memory database, and
 * the component's source: the notice, the controls, the confirmations and
 * the absence of any publishing control.
 */

const OPERATOR = "00000000-0000-4000-8000-0000000000cc";
const root = new URL("../../../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const SECTION = read("src/components/content/article-proposal-section.tsx");
const PANEL = read("src/components/content/article-panel.tsx");
const DRAFT_SECTION = read("src/components/content/publication-proposal-section.tsx");

async function stateOf(options: { readonly content?: ValidatedArticleContent; readonly article?: Partial<Article>; readonly approved?: boolean; readonly record?: boolean; readonly withdraw?: boolean; readonly newVersion?: boolean } = {}) {
  const content = options.content ?? approvedContent();
  const { text, sha256 } = canonicalOf(content);
  const approved = options.approved ?? true;
  const db = memoryDb({
    articles: [approvedArticle(approved ? options.article : { status: "drafting", approvedVersion: null, approvedBy: null, approvedAt: null, ...options.article })],
    versions: [{ id: VERSION_ID, articleId: ARTICLE_ID, version: 2, origin: "operator", canonicalContent: text, contentSha256: sha256, createdBy: OPERATOR, createdAt: APPROVED_AT }],
    approvals: approved ? [{ id: APPROVAL_ID, articleId: ARTICLE_ID, articleVersion: 2, articleVersionId: VERSION_ID, contentSha256: sha256, unitCount: 4, unitsSha256: "e".repeat(64), approvedBy: APPROVER, approvedAt: APPROVED_AT }] : [],
  });
  const service = createArticleProposalService(memoryStores(db));
  if (options.record) {
    const recorded = await service.record({ projectId: PROJECT_ID, articleId: ARTICLE_ID, articleVersion: 2, destination: DESTINATION, operatorId: OPERATOR });
    assert.ok(recorded.ok);
    if (options.withdraw && recorded.ok) await service.withdraw({ projectId: PROJECT_ID, articleId: ARTICLE_ID, proposalId: recorded.proposal.id, operatorId: OPERATOR });
  }
  if (options.newVersion) db.articles[0] = { ...db.articles[0], status: "drafting", currentVersion: 3 };
  const result = await service.getState(PROJECT_ID, ARTICLE_ID);
  assert.ok(result.ok);
  return result.ok ? result.state : (null as unknown as ArticleProposalStateView);
}

const ready = (state: ArticleProposalStateView): ProposalLoad => ({ status: "ready", state });

describe("the read state", () => {
  test("only a 200 with a state body is ready; 401, 503, 404 and anything else are their own states", async () => {
    const state = await stateOf();
    assert.deepEqual(proposalLoadFromResponse(200, { proposal: state }), { status: "ready", state });
    assert.deepEqual(proposalLoadFromResponse(401, null), { status: "unauthorized" });
    assert.deepEqual(proposalLoadFromResponse(503, null), { status: "unavailable" });
    assert.deepEqual(proposalLoadFromResponse(404, null), { status: "not-found" });
    assert.deepEqual(proposalLoadFromResponse(500, null), { status: "failed" });
    assert.deepEqual(proposalLoadFromResponse(200, {}), { status: "failed" });
    assert.deepEqual(proposalLoadFromResponse(200, { proposal: { history: [] } }), { status: "failed" }, "no eligibility: not a state");
  });

  test("unauthorized, unavailable and failed never offer a control or claim an empty history", () => {
    for (const load of [{ status: "loading" }, { status: "unauthorized" }, { status: "unavailable" }, { status: "not-found" }, { status: "failed" }] as ProposalLoad[]) {
      assert.equal(canRecord(load), false);
      assert.equal(canWithdraw(load), false);
      if (load.status !== "ready") assert.doesNotMatch(LOAD_MESSAGE[load.status], /has been recorded|eligible for a proposal/i);
    }
    assert.match(LOAD_MESSAGE.failed, /Nothing is shown as eligible or empty/);
  });
});

describe("headline and controls from real states", () => {
  test("eligible: Record offered, no Withdraw", async () => {
    const state = await stateOf();
    assert.equal(proposalHeadline(state), "eligible");
    assert.equal(canRecord(ready(state)), true);
    assert.equal(canWithdraw(ready(state)), false);
  });

  test("the Version 2 shape (drafting, no approval): Not eligible, no Record, every reason present", async () => {
    const state = await stateOf({ content: approvedContent((raw) => (raw.topicDecision = "unset")), approved: false });
    assert.equal(proposalHeadline(state), "not-eligible");
    assert.equal(canRecord(ready(state)), false);
    assert.deepEqual(state.eligibility.status === "blocked" && state.eligibility.blocks, ["not-approved", "approval-missing"]);
  });

  test("active proposal: headline active, Withdraw offered, no Record", async () => {
    const state = await stateOf({ record: true });
    assert.equal(proposalHeadline(state), "active");
    assert.equal(HEADLINE_LABEL.active, "Proposal recorded — not published");
    assert.equal(canRecord(ready(state)), false);
    assert.equal(canWithdraw(ready(state)), true);
    assert.equal(proposalStanding(state.history[0], state), "Active — names the current approved version");
  });

  test("withdrawn: history keeps it as Withdrawn, and Record is offered again", async () => {
    const state = await stateOf({ record: true, withdraw: true });
    assert.equal(state.history.length, 1);
    assert.equal(proposalStanding(state.history[0], state), "Withdrawn");
    assert.equal(canRecord(ready(state)), true);
    assert.equal(canWithdraw(ready(state)), false);
  });

  test("stale: after a new version the active proposal is labelled stale, never current or published", async () => {
    const state = await stateOf({ record: true, newVersion: true });
    assert.equal(proposalHeadline(state), "active-stale");
    assert.match(HEADLINE_LABEL["active-stale"], /not published/);
    assert.match(proposalStanding(state.history[0], state), /stale/);
    assert.equal(canRecord(ready(state)), false);
    assert.equal(canWithdraw(ready(state)), true, "a stale proposal can still be withdrawn");
  });

  test("D2: update-existing on a live slug is eligible with its warning; a new article on it is refused", async () => {
    const live = NEXRA_AI_BLOG_TEMPLATE.existingArticles[0].slug;
    const warned = await stateOf({ content: approvedContent((raw) => ((raw.slug = live), (raw.topicDecision = "update-existing"))) });
    assert.equal(canRecord(ready(warned)), true);
    assert.deepEqual(warned.eligibility.warnings, ["live-slug-update-existing"]);
    const refused = await stateOf({ content: approvedContent((raw) => (raw.slug = live)) });
    assert.equal(canRecord(ready(refused)), false);
    assert.ok(refused.eligibility.status === "blocked" && refused.eligibility.blocks.includes("slug-live-collision"));
  });
});

describe("answers in the operator's words", () => {
  test("created versus exists: only created says recorded", async () => {
    const state = await stateOf({ record: true });
    const proposal = state.history[0];
    assert.match(recordNote({ ok: true, recorded: true, proposal, state }).text, /^Proposal recorded for version 2\. Nothing was published\.$/);
    assert.match(recordNote({ ok: true, recorded: false, proposal, state }).text, /already recorded.*nothing new was written/);
  });

  test("every database refusal names the outcome (D3's slug-taken covers drafts and articles), and says nothing was written", () => {
    for (const outcome of [...PROPOSE_REFUSALS, "active-exists"] as const) {
      const note = recordNote({ ok: false, reason: "refused", outcome, proposal: null });
      assert.equal(note.tone, "critical");
      assert.match(note.text, /Nothing was written\.$/, outcome);
    }
    assert.match(recordNote({ ok: false, reason: "refused", outcome: "slug-taken", proposal: null }).text, /an article's or a draft's/);
  });

  test("failed, unauthorized, unconfirmed, rate-limited and unavailable are critical, never success", () => {
    for (const reason of ["failed", "unauthorized", "unconfirmed", "invalid", "unavailable", "not-found"] as const) {
      assert.equal(recordNote({ ok: false, reason }).tone, "critical", reason);
      assert.equal(withdrawNote({ ok: false, reason }).tone, "critical", reason);
    }
    assert.equal(recordNote({ ok: false, reason: "rate-limited", retryAfterSeconds: 1 }).tone, "critical");
  });

  test("withdrawn versus already-withdrawn", async () => {
    const state = await stateOf({ record: true, withdraw: true });
    assert.match(withdrawNote({ ok: true, withdrawn: true, proposal: state.history[0], state }).text, /stays in the history; nothing was published or removed/);
    assert.match(withdrawNote({ ok: true, withdrawn: false, proposal: state.history[0], state }).text, /already withdrawn; nothing new was written/);
  });
});

describe("the component", () => {
  test("says what it is: the title, PROPOSAL ONLY — NOT PUBLISHED, and the explanation", () => {
    assert.equal(PROPOSAL_ONLY_BANNER, "PROPOSAL ONLY — NOT PUBLISHED");
    assert.equal(PROPOSAL_EXPLANATION, "Recording a proposal does not publish the article, write to any website or repository, or create a GitHub pull request.");
    assert.match(SECTION, /\{PROPOSAL_ONLY_BANNER\}<\/span> \{PROPOSAL_EXPLANATION\}/);
    assert.match(SECTION, /aria-label=\{PROPOSAL_SECTION_TITLE\}/);
  });

  test("reads the Checkpoint 3 GET API only, and sends only project, article, version, destination key / proposal id and the token", () => {
    assert.match(SECTION, /\/api\/content-article-proposals\?project=/);
    assert.match(SECTION, /recordArticleProposal\(projectId, state\.articleId, state\.currentVersion, state\.destination\.key, RECORD_PROPOSAL_CONFIRMATION\)/);
    assert.match(SECTION, /withdrawArticleProposal\(projectId, state\.articleId, state\.activeProposal\.id, WITHDRAW_PROPOSAL_CONFIRMATION\)/);
    assert.equal(RECORD_PROPOSAL_CONFIRMATION, "record-proposal-only");
    assert.equal(WITHDRAW_PROPOSAL_CONFIRMATION, "withdraw-proposal-only");
    assert.equal((SECTION.match(/recordArticleProposal\(/g) ?? []).length, 1);
    assert.equal((SECTION.match(/withdrawArticleProposal\(/g) ?? []).length, 1);
  });

  test("Record and Withdraw render only when allowed, open a confirmation dialog, and are guarded against double submission", () => {
    assert.match(SECTION, /\{canRecord\(load\) && \(\s*<Button onClick=\{\(\) => setDialog\("record"\)\}/);
    assert.match(SECTION, /\{canWithdraw\(load\) && \(\s*<Button variant="secondary" onClick=\{\(\) => setDialog\("withdraw"\)\}/);
    const record = SECTION.slice(SECTION.indexOf("async function record()"), SECTION.indexOf("async function withdraw()"));
    assert.match(record, /if \(busy \|\| state === null \|\| !canRecord\(load\)/);
    assert.match(SECTION, /description=\{RECORD_PROPOSAL_CONFIRMATION_TEXT\}/);
    assert.match(SECTION, /description=\{WITHDRAW_PROPOSAL_CONFIRMATION_TEXT\}/);
    assert.match(RECORD_PROPOSAL_CONFIRMATION_TEXT, /does not publish the article/);
    assert.match(WITHDRAW_PROPOSAL_CONFIRMATION_TEXT, /nothing is removed from any website/);
    for (const label of ["Article version", "Destination", "Proposed route (not written)", "Canonical content SHA-256", "Preview SHA-256"]) assert.ok(SECTION.includes(`label="${label}"`), label);
    assert.match(SECTION, /Cancel/);
  });

  test("shows every refusal reason, warnings, completeness, the preview read-only, and the history", () => {
    assert.match(SECTION, /state\.eligibility\.blocks\.map\(\(block\) =>/);
    assert.match(SECTION, /articleProposalWarningMessage\(warning\)/);
    assert.match(SECTION, /<Completeness report=/);
    assert.match(SECTION, /<pre className="[^"]*overflow-auto[^"]*break-all/);
    assert.match(SECTION, /Proposal history \(/);
    assert.equal(/dangerouslySetInnerHTML|contentEditable/.test(SECTION), false);
  });

  test("no publishing, pull request, merge, deploy, schedule or approval control, and no approval call", () => {
    for (const forbidden of [/>\s*(Publish|Publish now|Create PR|Merge|Deploy|Schedule)/i, /approveArticleVersion|nexra-ai|github\.com|vercel/i, /override/i]) {
      assert.equal(forbidden.test(SECTION), false, String(forbidden));
    }
  });

  test("mounted in the article panel beside approval, re-read when the article's status or approval changes", () => {
    assert.match(PANEL, /<ArticleProposalSection\s+key=\{`proposal:\$\{article\.id\}:\$\{article\.currentVersion\}:\$\{article\.status\}:\$\{article\.approvedVersion \?\? ""\}`\}\s+projectId=\{projectId\}\s+articleId=\{article\.id\}\s+\/>/);
    assert.ok(PANEL.indexOf("<ArticleApprovalSection") < PANEL.indexOf("<ArticleProposalSection"));
  });
});

describe("the draft section's slug-taken wording", () => {
  test("covers an active draft or article proposal; the old draft-only wording is gone", () => {
    assert.ok(DRAFT_SECTION.includes('"slug-taken": "Another active publication proposal — a draft\'s or an article\'s — already uses this destination and slug. Choose another slug."'));
    assert.equal(DRAFT_SECTION.includes("Another draft's active proposal"), false);
  });
});
