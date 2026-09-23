import type { ApproveVersionInput, ApproveVersionOutcome, ArticleApprovalStore } from "@/lib/content/articles/approvals/contract";
import { createArticleApprovalService } from "@/lib/content/articles/approvals/service";
import { approvalUnitsSha256 } from "@/lib/content/articles/approvals/units-digest";
import type { StoredArticleVersion } from "@/lib/content/articles/checks/contract";
import { createArticleCheckService } from "@/lib/content/articles/checks/service";
import {
  answer,
  article,
  ARTICLE_ID,
  checkRun,
  content,
  memoryCheckStore,
  OPERATOR,
  PROJECT_ID,
  storedVersion,
  unitsOf,
  versionComplete,
  type MemoryCheckStore,
} from "@/lib/content/articles/checks/test-support/fixtures";
import { utf8Sha256 } from "@/lib/content/publications/content-hash";
import type { AgentRun } from "@/types/agent-run";
import type { ArticleApproval } from "@/types/content-article-approval";
import type { ArticleTopicDecision, ValidatedArticleContent } from "@/types/content-article";
import type { Article } from "@/types/content-article-record";

/**
 * Fixtures for the C5 article approval tests: an in-memory approval store
 * that applies — in one synchronous step, beside the C4 memory check store
 * — the same rules `nexra_article_approve_version` applies in one
 * transaction (the migration itself was run against PostgreSQL 16
 * separately), and a builder that wires the real check and approval
 * services over them. Test support only.
 */

export const APPROVER = "00000000-0000-4000-8000-0000000000bb";

/** C1 fixture content with an approvable topic decision unless another is given. */
export function approvableContent(topicDecision: ArticleTopicDecision = "different-angle", change: (raw: Record<string, unknown>) => void = () => {}): ValidatedArticleContent {
  return content((raw) => {
    raw.topicDecision = topicDecision;
    change(raw);
  });
}

export type MemoryApprovalStore = ArticleApprovalStore & {
  readonly approvals: ArticleApproval[];
  readonly calls: ApproveVersionInput[];
  /** Runs just before the store applies its rules: a concurrent writer, as a test needs one. */
  beforeApprove: (() => void) | null;
};

export function memoryApprovalStore(checks: MemoryCheckStore): MemoryApprovalStore {
  const approvals: ArticleApproval[] = [];
  const calls: ApproveVersionInput[] = [];
  let sequence = 0;

  const store: MemoryApprovalStore = {
    storesApprovals: true,
    approvals,
    calls,
    beforeApprove: null,

    async listApprovals(articleId) {
      return approvals.filter((a) => a.articleId === articleId).sort((a, b) => b.articleVersion - a.articleVersion);
    },

    async approve(input): Promise<ApproveVersionOutcome> {
      calls.push(input);
      store.beforeApprove?.();
      const index = checks.articles.findIndex((a) => a.projectId === input.projectId && a.id === input.articleId);
      if (index < 0) return { status: "not-found" };
      const parent = checks.articles[index];
      if (parent.status === "archived") return { status: "archived" };
      if (parent.currentVersion !== input.articleVersion) return { status: "stale" };
      const version = checks.versions.find((v) => v.articleId === input.articleId && v.version === input.articleVersion);
      if (version === undefined) return { status: "version-not-found" };
      if (version.id !== input.articleVersionId) return { status: "version-mismatch" };
      if (version.contentSha256 !== input.contentSha256 || utf8Sha256(version.canonicalContent) !== input.contentSha256) return { status: "content-mismatch" };

      const existing = approvals.find((a) => a.articleId === input.articleId && a.articleVersion === input.articleVersion);
      if (existing !== undefined) return { status: "exists", approval: existing, article: parent };
      if (parent.status !== "checked") return { status: "status-unexpected" };

      const rows = checks.rows.filter((r) => r.articleVersionId === version.id).sort((a, b) => a.unitIndex - b.unitIndex);
      const unitCount = input.units.length;
      if (
        unitCount < 1 ||
        unitCount > 150 ||
        rows.length !== unitCount ||
        input.units.some((u, i) => u.index !== i) ||
        rows.some((r, i) => r.unitIndex !== input.units[i].index || r.unitKey !== input.units[i].key || r.unitSha256 !== input.units[i].sha256 || r.unitCount !== unitCount)
      ) {
        return { status: "units-mismatch" };
      }
      const digest = approvalUnitsSha256(rows.map((r) => ({ index: r.unitIndex, key: r.unitKey, sha256: r.unitSha256 })));
      if (digest !== input.unitsSha256) return { status: "units-mismatch" };
      if (rows.some((r) => r.status !== "passed")) return { status: "units-not-passed" };
      if (!versionComplete(rows, version, unitCount)) return { status: "units-incomplete" };

      const topic = (JSON.parse(version.canonicalContent) as { topicDecision?: unknown }).topicDecision;
      if (topic !== "update-existing" && topic !== "different-angle") return { status: "topic-decision" };
      if (version.canonicalContent.toLowerCase().includes("[needs evidence")) return { status: "unresolved-placeholder" };

      sequence += 1;
      const approvedAt = `2026-09-24T12:00:${String(sequence).padStart(2, "0")}.000Z`;
      const approval: ArticleApproval = {
        id: `e0000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
        articleId: input.articleId,
        articleVersion: input.articleVersion,
        articleVersionId: version.id,
        contentSha256: version.contentSha256,
        unitCount,
        unitsSha256: digest,
        approvedBy: input.approvedBy,
        approvedAt,
      };
      approvals.push(approval);
      const next: Article = { ...parent, status: "approved", approvedVersion: input.articleVersion, approvedBy: input.approvedBy, approvedAt, updatedAt: approvedAt };
      checks.articles[index] = next;
      return { status: "approved", approval, article: next };
    },
  };
  return store;
}

/** The real check and approval services over the memory stores, for one article. */
export function approvalSetup(options: { readonly versions?: StoredArticleVersion[]; readonly article?: Partial<Article> } = {}) {
  const runs: AgentRun[] = [];
  const versions = options.versions ?? [storedVersion(1, approvableContent())];
  const store = memoryCheckStore({ articles: [article({ currentVersion: versions.length, ...options.article })], versions, runs });
  const checkService = createArticleCheckService({
    store,
    runs: {
      async getById(id) {
        return runs.find((run) => run.id === id) ?? null;
      },
    },
  });
  const approvals = memoryApprovalStore(store);
  const service = createArticleApprovalService({ store, checks: checkService, approvals });

  /** Records one unit of the version with the given outcome through the real C4 service. */
  async function recordUnit(version: StoredArticleVersion, unitIndex: number, outcome: "passed" | "needs-review" | "failed" | "pending") {
    const unit = unitsOf(version)[unitIndex];
    const run =
      outcome === "pending"
        ? checkRun({ version, unitIndex, status: "queued" })
        : outcome === "failed"
          ? checkRun({ version, unitIndex, status: "failed" })
          : checkRun({ version, unitIndex, summary: outcome === "passed" ? answer({ supported: unit.statementCount }) : answer({ supported: unit.statementCount - 1, unsupported: 1 }) });
    runs.push(run);
    const result = await checkService.record({ projectId: PROJECT_ID, articleId: version.articleId, articleVersion: version.version, unitIndex, runId: run.id, operatorId: OPERATOR });
    if (!result.ok) throw new Error(`fixture record failed: ${JSON.stringify(result)}`);
    return result;
  }

  async function passAll(version: StoredArticleVersion) {
    for (const unit of unitsOf(version)) await recordUnit(version, unit.index, "passed");
  }

  function approve(articleVersion = store.articles[0].currentVersion, operatorId = APPROVER) {
    return service.approve({ projectId: PROJECT_ID, articleId: ARTICLE_ID, articleVersion, operatorId });
  }

  return { store, runs, checkService, approvals, service, recordUnit, passAll, approve };
}
