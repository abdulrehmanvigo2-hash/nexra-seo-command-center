import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  CONTENT_TABS,
  HIDDEN_CONTENT_TABS,
  approvalSummary,
  articleDetailHref,
  checkProgressLine,
  contentUrls,
  draftIdsOf,
  groupArticles,
  groupDrafts,
  isArticleId,
  ok,
  presentArticleDetail,
  presentArticleRow,
  presentDraftRow,
  presentUnits,
  proposalSummary,
  resolveContentTab,
} from "./studio.ts";
import type { ArticleApprovalState } from "../../types/content-article-approval.ts";
import type { ArticleVersionChecks } from "../../types/content-article-check.ts";
import type { ArticleHistory, ArticleWorkspace } from "../../types/content-article-record.ts";
import type { DraftHistory } from "../../types/content-draft.ts";
import type { ArticleProposalStateView } from "./articles/proposals/service.ts";
import type { ProposalState } from "./publications/service.ts";

/**
 * Checkpoint 5.2: the observed Content Studio, over fixtures mirroring
 * production on 27 Sep — article c89182f9 at Version 2 (one section, topic
 * decision different-angle), units metadata:1 and lead-introduction:1 needs
 * review and two more unchecked; drafts 489a191a (2 versions, Version 2
 * fact-check needs review) and ce474811 (1 version, 2 placeholders); no
 * approval and no proposal anywhere.
 */

const PROJECT = "nexra-agency";
const ARTICLE = "c89182f9-4954-4834-8446-a831fc3c42d0";
const V1 = "85576358-118c-4bef-9308-e74fc6f4768b";
const V2 = "4f3ed414-ae5d-4bbb-b220-934851f3dfc8";
const DRAFT_A = "489a191a-6966-4077-8b3d-5ce7fdd4d677";
const DRAFT_B = "ce474811-ee21-494b-a54a-1f796c345ae0";

const content = { title: "AI Lead Follow-Up Automation for Small Businesses", slug: "ai-lead-follow-up-automation-small-businesses", topicDecision: "different-angle", sections: [{ id: "how-ai-lead-follow-up-works" }], attestations: [] };
const version = (n: number, id: string, sha: string) => ({
  id,
  articleId: ARTICLE,
  version: n,
  origin: "operator",
  canonicalContent: "{}",
  contentSha256: sha,
  sources: [
    { position: 1, draftId: DRAFT_A, version: 2, versionId: "6273daad-210e-4d8b-8c8e-092426639e3d", contentSha256: "a".repeat(64) },
    { position: 2, draftId: DRAFT_B, version: 1, versionId: "afe64fd2-13a7-4f3c-8cab-20c47fbd810c", contentSha256: "b".repeat(64) },
  ],
  createdBy: "operator",
  createdAt: n === 1 ? "2026-09-23T05:25:03Z" : "2026-09-23T05:32:08Z",
  content,
  verified: true,
});

const HISTORY = {
  article: {
    id: ARTICLE,
    projectId: PROJECT,
    sourcePlanRunId: "7898fd70-dc31-4e9d-8e50-9c014a7bdd2b",
    status: "drafting",
    currentVersion: 2,
    approvedVersion: null,
    approvedBy: null,
    approvedAt: null,
    createdBy: "operator",
    createdAt: "2026-09-23T05:25:03Z",
    updatedAt: "2026-09-23T05:32:08Z",
  },
  versions: [version(1, V1, "f8421dd1".padEnd(64, "0")), version(2, V2, "bd6bd57f".padEnd(64, "0"))],
} as unknown as ArticleHistory;

const WORKSPACE = {
  articles: [HISTORY],
  planCandidates: [],
  sourceCandidates: [
    { draftId: DRAFT_B, version: 1 },
    { draftId: DRAFT_A, version: 2 },
    { draftId: DRAFT_A, version: 1 },
  ],
} as unknown as ArticleWorkspace;

const unit = (index: number, key: string, status: "needs-review" | null) => ({
  index,
  kind: key.split(":")[0],
  block: key.split(":")[0],
  key,
  part: 1,
  partCount: 1,
  label: key,
  sha256: "c".repeat(64),
  statementCount: index === 0 ? 8 : 2,
  bytes: 100,
  record:
    status === null
      ? null
      : {
          status,
          checkedByRunId: index === 0 ? "e322fc1d-01b4-478e-9b4e-7726dc5b8644" : "6e2e9659-3467-4429-a57b-126a656883fa",
          result: { status, counts: { supported: 0, partial: 0, unsupported: 0, unverifiable: 2, editorial: 0 }, statementCount: 2 },
        },
});

const CHECKS = {
  articleId: ARTICLE,
  articleStatus: "drafting",
  currentVersion: 2,
  version: 2,
  versionId: V2,
  contentSha256: "bd6bd57f".padEnd(64, "0"),
  refusal: null,
  units: [unit(0, "metadata:1", "needs-review"), unit(1, "lead-introduction:1", "needs-review"), unit(2, "section:1", null), unit(3, "cta:1", null)],
  state: "unchecked",
  counts: { total: 4, passed: 0, needsReview: 2, failed: 0, pending: 0, unchecked: 2 },
} as unknown as ArticleVersionChecks;

const PROPOSAL = {
  articleId: ARTICLE,
  articleStatus: "drafting",
  currentVersion: 2,
  destination: null,
  eligibility: { status: "blocked", blocks: ["status-not-approved"], warnings: [], activeProposal: null },
  preview: null,
  activeProposal: null,
  activeProposalCurrent: null,
  history: [],
} as unknown as ArticleProposalStateView;

const APPROVAL = {
  eligibility: { status: "blocked", blocks: ["units-unchecked", "units-needs-review", "status-unexpected"] },
  approvedVersion: null,
  history: [],
} as unknown as ArticleApprovalState;

const draft = (id: string, status: string, current: number, versions: number, factCheck: object | null, placeholders: number): DraftHistory => {
  const v = { id: `${id}-v${current}`, draftId: id, version: current, origin: "operator", title: `Draft ${id.slice(0, 4)}`, body: "", claims: [], placeholders: Array.from({ length: placeholders }, () => "[NEEDS EVIDENCE: x]"), factCheck, createdBy: "o", createdAt: "2026-09-22T00:00:00Z" };
  return {
    draft: { id, projectId: PROJECT, sectionLabel: "Where a person still belongs", status, currentVersion: current, approvedVersion: null },
    version: v,
    versions: Array.from({ length: versions }, () => v),
  } as unknown as DraftHistory;
};

const DRAFT_ROWS = [
  presentDraftRow(draft(DRAFT_A, "drafting", 2, 2, { status: "needs-review" }, 0), ok({ active: null, history: [], candidate: null, refusal: "not-approved" } as unknown as ProposalState)),
  presentDraftRow(draft(DRAFT_B, "drafting", 1, 1, null, 2), ok({ active: null, history: [], candidate: null, refusal: "not-approved" } as unknown as ProposalState)),
];

describe("the tabs (decision Q1)", () => {
  test("Articles, Drafts, Pipeline and (M3) Calendar; the ten modelled tabs are hidden and a deep link to one opens Articles", () => {
    assert.deepEqual(
      CONTENT_TABS.map((t) => [t.id, t.label]),
      [
        ["articles", "Articles"],
        ["drafts", "Drafts"],
        ["pipeline", "Pipeline"],
        ["calendar", "Calendar"],
      ],
    );
    assert.equal(HIDDEN_CONTENT_TABS.length, 10);
    for (const hidden of HIDDEN_CONTENT_TABS) {
      assert.equal(CONTENT_TABS.some((t) => t.id === hidden), false);
      assert.equal(resolveContentTab(hidden), "articles");
    }
    assert.equal(resolveContentTab("pipeline"), "pipeline");
    assert.equal(resolveContentTab(null), "articles");
  });
});

describe("Articles", () => {
  test("c89182f9: drafting, version 2 of 2, 0 passed · 2 need review · 2 unchecked of 4, not approved, no proposal", () => {
    const row = presentArticleRow(HISTORY, ok(CHECKS), ok(PROPOSAL));
    assert.equal(row.title, "AI Lead Follow-Up Automation for Small Businesses");
    assert.equal(row.slug, "ai-lead-follow-up-automation-small-businesses");
    assert.deepEqual([row.status, row.currentVersion, row.versionCount], ["drafting", 2, 2]);
    assert.ok(typeof row.checks === "object");
    assert.equal(checkProgressLine(row.checks as Exclude<typeof row.checks, string>), "0 passed · 2 need review · 2 unchecked of 4");
    assert.equal(row.approval, "Not approved");
    assert.equal(row.proposal, "No proposal");
  });

  test("a read that failed says so, never zero or none", () => {
    const row = presentArticleRow(HISTORY, { status: "failed" }, { status: "unavailable" });
    assert.equal(row.checks, "not-read");
    assert.equal(row.proposal, "Proposal state not read");
  });

  test("an active proposal is a record, never a publication; an approval of an older version is not the current one's", () => {
    const proposed = { ...PROPOSAL, activeProposal: { articleVersion: 3, destination: "nexra-agency-website", slug: "s" } } as unknown as ArticleProposalStateView;
    assert.match(presentArticleRow(HISTORY, ok(CHECKS), ok(proposed)).proposal, /^Proposed · version 3 to nexra-agency-website \(s\) — not published$/);
    const stale = { ...HISTORY, article: { ...HISTORY.article, approvedVersion: 1 } } as ArticleHistory;
    assert.equal(presentArticleRow(stale, ok(CHECKS), ok(PROPOSAL)).approval, "Version 1 approved earlier; not the current version");
  });
});

describe("Drafts", () => {
  test("two drafts from three candidate versions, each once, in the workspace's order", () => {
    assert.deepEqual(draftIdsOf(WORKSPACE), [DRAFT_B, DRAFT_A]);
  });

  test("489a191a: version 2 of 2, fact-check needs review; ce474811: version 1 of 1, not fact-checked, 2 placeholders; neither approved nor proposed", () => {
    const [a, b] = DRAFT_ROWS;
    assert.deepEqual([a.currentVersion, a.versionCount, a.factCheck, a.placeholders], [2, 2, "Needs review (version 2)", 0]);
    assert.deepEqual([b.currentVersion, b.versionCount, b.factCheck, b.placeholders], [1, 1, "Not fact-checked", 2]);
    for (const row of DRAFT_ROWS) assert.deepEqual([row.approval, row.proposal], ["Not approved", "No proposal"]);
  });
});

describe("Pipeline", () => {
  test("every status in its fixed order, empty stages included", () => {
    const articles = groupArticles([presentArticleRow(HISTORY, ok(CHECKS), ok(PROPOSAL))]);
    assert.deepEqual(
      articles.map((g) => [g.status, g.items.length]),
      [
        ["drafting", 1],
        ["checked", 0],
        ["approved", 0],
        ["archived", 0],
      ],
    );
    assert.deepEqual(
      groupDrafts(DRAFT_ROWS).map((g) => [g.status, g.items.length]),
      [
        ["drafting", 2],
        ["fact-checked", 0],
        ["approved", 0],
        ["published", 0],
        ["archived", 0],
      ],
    );
  });
});

describe("the article detail (decision Q2)", () => {
  test("header, versions newest first with their source drafts, units with verdicts, approval and proposal blocked", () => {
    const detail = presentArticleDetail(HISTORY);
    assert.deepEqual(
      detail.versions.map((v) => [v.version, v.current, v.topicDecision, v.sources.map((s) => `${s.draftId.slice(0, 8)} v${s.version}`).join(", ")]),
      [
        [2, true, "different-angle", "489a191a v2, ce474811 v1"],
        [1, false, "different-angle", "489a191a v2, ce474811 v1"],
      ],
    );
    assert.deepEqual(
      presentUnits(CHECKS).map((u) => [u.key, u.status, u.runId?.slice(0, 8) ?? null]),
      [
        ["metadata:1", "needs-review", "e322fc1d"],
        ["lead-introduction:1", "needs-review", "6e2e9659"],
        ["section:1", "unchecked", null],
        ["cta:1", "unchecked", null],
      ],
    );
    const approval = approvalSummary(APPROVAL);
    assert.equal(approval.headline, "Not eligible for approval");
    assert.deepEqual(approval.reasons, ["units unchecked", "units need review", "the article is not checked"]);
    assert.equal(proposalSummary(PROPOSAL).headline, "Not eligible for a proposal");
  });

  test("an article id is a uuid; every fixture content id is not, so the old detail links are not found", () => {
    assert.equal(isArticleId(ARTICLE), true);
    // The modelled inventory's ids are `<project>--<path slug>`, `<project>--new-<keyword>` and `<cluster>--pillar` (lib/mock/content/records.ts).
    for (const id of ["nexra-agency--services", "nexra-agency--new-ai-lead-follow-up", "cluster-ai--pillar", "", "not-a-uuid"]) assert.equal(isArticleId(id), false, id);
    assert.equal(articleDetailHref(ARTICLE, PROJECT), `/content/${ARTICLE}?project=nexra-agency`);
  });

  test("the reads are the existing content GET routes, and no other", () => {
    const urls = [
      contentUrls.workspace(PROJECT),
      contentUrls.checks(PROJECT, ARTICLE, 2),
      contentUrls.approval(PROJECT, ARTICLE),
      contentUrls.proposal(PROJECT, ARTICLE),
      contentUrls.draft(PROJECT, DRAFT_A),
      contentUrls.publication(PROJECT, DRAFT_A),
    ].map((u) => u.split("?")[0]);
    assert.deepEqual(urls, ["/api/content-articles", "/api/content-article-checks", "/api/content-article-approvals", "/api/content-article-proposals", "/api/content-drafts", "/api/content-publications"]);
  });
});

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const SCREEN = read("src/components/content/observed-content.tsx");
const PAGE = read("src/app/(app)/content/page.tsx");
const DETAIL = read("src/app/(app)/content/[articleId]/page.tsx");
const STATUS = read("src/config/build-status.ts");

describe("the screens", () => {
  test("import no fixture and no modelled content view, carry no Modelled tag, show the Observed badge", () => {
    for (const file of [SCREEN, PAGE, DETAIL]) {
      assert.doesNotMatch(file, /@\/lib\/mock|components\/content\/(content-studio|content-workspace|overview-view|content-table|workflow-board|briefs-view|mapping-view|coverage-view|intent-view|recommendations-view|aeo-view|links-view|gaps-view|ai-visibility-panel)"/);
      assert.doesNotMatch(file, /Modelled/);
    }
    assert.match(SCREEN, />\s*Observed\s*</);
    assert.doesNotMatch(SCREEN, /\/keywords\/clusters/);
  });

  test("read only: no Server Action, no POST, no write control; the controls are linked on the project screen", () => {
    assert.doesNotMatch(SCREEN, /-actions"|method: "POST"|recordArticle|approveArticle|saveArticleVersion|createArticle|useQueuedReview/);
    assert.match(SCREEN, /projectHref\(projectId\)/);
  });

  test("the detail route: uuid shape, then the operator, then the project-scoped read; nothing prerendered", () => {
    const order = ["isArticleId(articleId)", "await getOperator()", "articleService().getWorkspace(project.id)"].map((s) => DETAIL.indexOf(s));
    assert.ok(order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1])), `order ${order}`);
    assert.doesNotMatch(DETAIL, /generateStaticParams/);
    // An article no stored project holds is not found (since F7 the reads are wrapped, so the page ends in the view).
    assert.match(DETAIL, /if \(found === null\) notFound\(\);\n  return <ArticleDetailView projectId=\{found\.id\}/);
  });

  test("the sidebar note names Content as observed", () => {
    assert.match(STATUS, /Technical, Keywords, Content, Analytics/);
    assert.match(STATUS, /Content Studio, Analytics/);
  });
});
