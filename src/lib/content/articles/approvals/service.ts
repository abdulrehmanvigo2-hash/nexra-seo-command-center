import "server-only";

/**
 * The article approval gate (Stage 5, milestone C5): reading the current
 * version's approval state, and approving that one exact version.
 *
 * Everything is decided from the server's own records. The browser names a
 * project, an article and the version number it saw — never a hash, a
 * version row id, a unit, a status or an operator. The article is read by
 * project and id; the version by number; its stored text is re-read as C1
 * content and verified against its hash; its check units are regenerated
 * from that text and matched to the stored rows by the check service; the
 * rule in `./eligibility` decides, with every reason that applies. Only then
 * is the database function called, with the server's own version row id,
 * content hash and unit identities, and it checks all of it again in one
 * transaction under the article's row lock.
 *
 * Approval is not publication. Nothing here proposes, renders, publishes or
 * reaches a repository or a site, and no check result is written.
 */

import { readCanonicalArticle } from "@/lib/content/articles/canonical";
import type { ApproveVersionOutcome, ArticleApprovalStore } from "@/lib/content/articles/approvals/contract";
import { articleApprovalEligibility, hasArticlePlaceholder } from "@/lib/content/articles/approvals/eligibility";
import { approvalUnitsSha256, type ApprovalUnitIdentity } from "@/lib/content/articles/approvals/units-digest";
import type { ArticleCheckStore } from "@/lib/content/articles/checks/contract";
import type { ArticleCheckService } from "@/lib/content/articles/checks/service";
import { isProjectId, isUuid } from "@/lib/content/drafts/service";
import { utf8Sha256 } from "@/lib/content/publications/content-hash";
import type { ArticleApproval, ArticleApprovalBlock, ArticleApprovalState } from "@/types/content-article-approval";

export type GetApprovalStateResult =
  | { readonly ok: true; readonly state: ArticleApprovalState }
  | { readonly ok: false; readonly reason: "invalid" | "unavailable" | "not-found" | "version-not-found" | "failed" };

export type ApproveArticleRequest = {
  readonly projectId: string;
  readonly articleId: string;
  /** The version number the operator saw; it must still be the current one. */
  readonly articleVersion: number;
  /** The operator's Supabase Auth user id, confirmed by the caller. */
  readonly operatorId: string;
  /** The operator's attestation tick (6.8b); required when the version attests paragraphs. */
  readonly attestationConfirmed?: boolean;
};

export type ApproveArticleResult =
  /** `approved: false` means this exact version was already approved; nothing was written. */
  | { readonly ok: true; readonly approved: boolean; readonly approval: ArticleApproval; readonly state: ArticleApprovalState }
  | { readonly ok: false; readonly reason: "invalid" | "unavailable" | "not-found" | "version-not-found" | "failed" }
  /** The version asked about is no longer the current one. */
  | { readonly ok: false; readonly reason: "stale"; readonly state: ArticleApprovalState }
  /** The version attests paragraphs and the operator did not tick the attestation (6.8b). Nothing was written. */
  | { readonly ok: false; readonly reason: "attestation-unconfirmed"; readonly state: ArticleApprovalState }
  /** The rule refused, with every reason that applies. */
  | { readonly ok: false; readonly reason: "ineligible"; readonly blocks: readonly ArticleApprovalBlock[]; readonly state: ArticleApprovalState }
  /** The database refused on a rule it re-checked. */
  | { readonly ok: false; readonly reason: "refused"; readonly outcome: Exclude<ApproveVersionOutcome["status"], "approved" | "exists"> };

export type ArticleApprovalService = {
  getState(projectId: string, articleId: string): Promise<GetApprovalStateResult>;
  approve(request: ApproveArticleRequest): Promise<ApproveArticleResult>;
};

function isVersionNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 32_767;
}

type Computed = { readonly state: ArticleApprovalState; readonly units: readonly ApprovalUnitIdentity[] };

export function createArticleApprovalService(dependencies: {
  /** Reads the article, the version and the stored check rows. */
  readonly store: Pick<ArticleCheckStore, "storesChecks" | "getArticle" | "getVersion" | "listUnitRecords">;
  /** Regenerates the version's units and matches them to the stored rows. */
  readonly checks: Pick<ArticleCheckService, "getVersionChecks">;
  readonly approvals: ArticleApprovalStore;
}): ArticleApprovalService {
  const { store, checks, approvals } = dependencies;

  async function compute(projectId: string, articleId: string): Promise<{ readonly ok: true; readonly computed: Computed } | { readonly ok: false; readonly reason: "not-found" | "version-not-found" | "failed" }> {
    const article = await store.getArticle(projectId, articleId);
    if (article === null) return { ok: false, reason: "not-found" };
    const version = await store.getVersion(article.id, article.currentVersion);
    if (version === null) return { ok: false, reason: "version-not-found" };

    const content = readCanonicalArticle(version.canonicalContent);
    const contentReadable = content !== null && utf8Sha256(version.canonicalContent) === version.contentSha256;
    const history = await approvals.listApprovals(article.id);
    const approval = history.find((entry) => entry.articleVersion === version.version && entry.articleVersionId === version.id) ?? null;

    let checkState: ArticleApprovalState["checkState"] = null;
    let checkRefusal: ArticleApprovalState["checkRefusal"] = null;
    let unitStatuses: ("pending" | "passed" | "needs-review" | "failed" | null)[] = [];
    let units: ApprovalUnitIdentity[] = [];
    let mismatched = 0;
    let supportedCount: number | null = null;
    let attestedStatementCount = 0;
    let counts = { total: 0, passed: 0, needsReview: 0, failed: 0, pending: 0, unchecked: 0 };
    if (contentReadable) {
      const read = await checks.getVersionChecks(projectId, article.id, version.version);
      if (!read.ok) return { ok: false, reason: read.reason === "not-found" ? "not-found" : read.reason === "version-not-found" ? "version-not-found" : "failed" };
      const view = read.checks;
      if (view.versionId !== version.id || view.contentSha256 !== version.contentSha256) return { ok: false, reason: "failed" };
      checkState = view.state;
      checkRefusal = view.refusal;
      counts = view.counts;
      unitStatuses = view.units.map((unit) => unit.record?.status ?? null);
      units = view.units.map((unit) => ({ index: unit.index, key: unit.key, sha256: unit.sha256 }));
      // 6.8b: supported and attested statements across the recorded verdicts; unknown until every unit has one.
      const verdicts = view.units.map((unit) => (unit.record?.result && unit.record.result.status !== "failed" ? unit.record.result : null));
      supportedCount = verdicts.length > 0 && verdicts.every((v) => v !== null) ? verdicts.reduce((sum, v) => sum + (v?.counts.supported ?? 0), 0) : null;
      attestedStatementCount = verdicts.reduce((sum, v) => sum + (v?.counts.attested ?? 0), 0);
      const rows = await store.listUnitRecords(version.id);
      mismatched = rows.length - view.units.filter((unit) => unit.record !== null).length;
    }

    const eligibility = articleApprovalEligibility({
      articleStatus: article.status,
      currentVersion: article.currentVersion,
      version: version.version,
      contentReadable,
      planRefusal: checkRefusal,
      unitStatuses,
      mismatchedRows: mismatched,
      topicDecision: content?.topicDecision ?? null,
      hasPlaceholder: hasArticlePlaceholder(version.canonicalContent),
      attestedCount: content?.attestations.length ?? 0,
      supportedCount,
      approval,
    });

    return {
      ok: true,
      computed: {
        units,
        state: {
          articleId: article.id,
          articleStatus: article.status,
          currentVersion: article.currentVersion,
          versionId: version.id,
          contentSha256: version.contentSha256,
          topicDecision: content?.topicDecision ?? null,
          attestedCount: content?.attestations.length ?? 0,
          supportedCount,
          attestedStatementCount,
          checkState,
          checkRefusal,
          unitCounts: { ...counts, mismatched },
          eligibility,
          approvedVersion: article.approvedVersion,
          history,
        },
      },
    };
  }

  return {
    async getState(projectId, articleId) {
      if (!isProjectId(projectId) || !isUuid(articleId)) return { ok: false, reason: "invalid" };
      if (!store.storesChecks || !approvals.storesApprovals) return { ok: false, reason: "unavailable" };
      const result = await compute(projectId, articleId.toLowerCase());
      return result.ok ? { ok: true, state: result.computed.state } : { ok: false, reason: result.reason };
    },

    async approve(request) {
      if (!isProjectId(request.projectId) || !isUuid(request.articleId) || !isUuid(request.operatorId) || !isVersionNumber(request.articleVersion)) {
        return { ok: false, reason: "invalid" };
      }
      if (!store.storesChecks || !approvals.storesApprovals) return { ok: false, reason: "unavailable" };
      const projectId = request.projectId;
      const articleId = request.articleId.toLowerCase();

      const before = await compute(projectId, articleId);
      if (!before.ok) return { ok: false, reason: before.reason };
      const { state, units } = before.computed;
      if (state.currentVersion !== request.articleVersion) return { ok: false, reason: "stale", state };
      if (state.eligibility.status === "approved") return { ok: true, approved: false, approval: state.eligibility.approval, state };
      if (state.eligibility.status === "blocked") return { ok: false, reason: "ineligible", blocks: state.eligibility.blocks, state };
      if (state.attestedCount > 0 && request.attestationConfirmed !== true) return { ok: false, reason: "attestation-unconfirmed", state };

      const outcome = await approvals.approve({
        projectId,
        articleId,
        articleVersion: state.currentVersion,
        articleVersionId: state.versionId,
        contentSha256: state.contentSha256,
        units,
        unitsSha256: approvalUnitsSha256(units),
        approvedBy: request.operatorId.toLowerCase(),
        ...(state.attestedCount > 0 ? { attestationConfirmed: true } : {}),
      });

      switch (outcome.status) {
        case "approved":
        case "exists": {
          const after = await compute(projectId, articleId);
          if (!after.ok) return { ok: false, reason: "failed" };
          return { ok: true, approved: outcome.status === "approved", approval: outcome.approval, state: after.computed.state };
        }
        default:
          return { ok: false, reason: "refused", outcome: outcome.status };
      }
    },
  };
}
