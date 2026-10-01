import "server-only";

/**
 * The article publication proposal service (Stage 5, milestone C6,
 * Checkpoint 3): the read-only proposal state of an article, recording one
 * record-only proposal of its current approved version, and withdrawing
 * one.
 *
 * Everything is decided from the server's own records. The browser names a
 * project, an article, the version number it saw, a destination key — and,
 * to withdraw, a proposal id. Never a version row id, a hash, an approval,
 * a slug, a preview, a status or an operator. The article is read by
 * project and id; the version by number; the C5 approval row for that
 * version; the article's proposals by project; the destination and slug's
 * holders in both proposal tables (D3). The Checkpoint 2 rule decides, with
 * every reason; the preview is rebuilt and hashed here. Only then is the
 * database function called, with the server's binding, and it checks all of
 * it again under the article's row lock while the D3 trigger checks the
 * destination and slug under its own. Its answer is the answer: an eligible
 * result here is never reported as a recorded proposal.
 *
 * Fails closed. A store that keeps nothing answers `unavailable`, never an
 * empty history or an empty reservation list; a failed read throws, and the
 * caller reports `failed`.
 *
 * A proposal is not a publication. Nothing here approves, renders a website
 * file, reaches a repository or a site, or deletes anything.
 */

import { liveArticleOf, type LiveArticle } from "@/lib/content/articles/proposals/live-slugs";
import type { ArticleApprovalStore } from "@/lib/content/articles/approvals/contract";
import { readCanonicalArticle } from "@/lib/content/articles/canonical";
import type { ArticleCheckStore, StoredArticleVersion } from "@/lib/content/articles/checks/contract";
import type { ArticleProposalStore, ProposeArticleOutcome } from "@/lib/content/articles/proposals/contract";
import { articleProposalEligibility } from "@/lib/content/articles/proposals/eligibility";
import { hashedArticleProposalPreview } from "@/lib/content/articles/proposals/preview-hash";
import { isProjectId, isUuid } from "@/lib/content/drafts/service";
import { utf8Sha256 } from "@/lib/content/publications/content-hash";
import { destinationsForProject, findDestination } from "@/lib/content/publications/destinations";
import type { ArticleApproval } from "@/types/content-article-approval";
import type {
  ArticleProposalBlock,
  ArticleProposalEligibility,
  ArticleProposalPreview,
  ArticleProposalWarning,
  ArticlePublicationProposal,
} from "@/types/content-article-proposal";
import type { Article } from "@/types/content-article-record";
import type { PublicationDestination } from "@/types/content-publication";

/** The read-only proposal state of one article's current version. */
export type ArticleProposalStateView = {
  readonly articleId: string;
  readonly articleStatus: Article["status"];
  readonly currentVersion: number;
  /** The destination the state was computed for: the one asked for, or the project's registered one. Null when none is registered. */
  readonly destination: PublicationDestination | null;
  readonly eligibility: ArticleProposalEligibility;
  /** Built only when eligible: the document and the server's SHA-256 of it. Read-only; stored nowhere. */
  readonly preview: (ArticleProposalPreview & { readonly previewSha256: string }) | null;
  /** The article's active proposal, if any. */
  readonly activeProposal: ArticlePublicationProposal | null;
  /** Whether the active proposal still names the current approved version, row, hash and approval. Null without one. */
  readonly activeProposalCurrent: boolean | null;
  /** Every proposal of the article, active and withdrawn, newest first. Immutable history. */
  readonly history: readonly ArticlePublicationProposal[];
  /**
   * Fix F9: the slug this article is live under at the destination, as the records say; null when it is not live
   * there, or when the live articles could not be read (`liveArticlesRead` false).
   */
  readonly liveSlug: string | null;
  readonly liveArticlesRead: boolean;
};

type ReadFailure = "invalid" | "unavailable" | "not-found" | "failed";

export type GetProposalStateResult = { readonly ok: true; readonly state: ArticleProposalStateView } | { readonly ok: false; readonly reason: ReadFailure };

export type RecordArticleProposalRequest = {
  readonly projectId: string;
  readonly articleId: string;
  /** The version number the operator saw; it must still be the current one. */
  readonly articleVersion: number;
  /** A registered destination key. */
  readonly destination: string;
  /** The operator's Supabase Auth user id, confirmed by the caller. */
  readonly operatorId: string;
};

export type RecordArticleProposalResult =
  /** `recorded: false` means the database found this exact proposal already active; nothing was written. */
  | { readonly ok: true; readonly recorded: boolean; readonly proposal: ArticlePublicationProposal; readonly state: ArticleProposalStateView }
  | { readonly ok: false; readonly reason: ReadFailure }
  /** The version asked about is no longer the current one. Nothing was written. */
  | { readonly ok: false; readonly reason: "stale"; readonly state: ArticleProposalStateView }
  /** The rule refused, with every reason. Nothing was written. */
  | {
      readonly ok: false;
      readonly reason: "ineligible";
      readonly blocks: readonly ArticleProposalBlock[];
      readonly warnings: readonly ArticleProposalWarning[];
      readonly state: ArticleProposalStateView;
    }
  /** The database refused on a rule it re-checked under its locks. Nothing was written. */
  | {
      readonly ok: false;
      readonly reason: "refused";
      readonly outcome: Exclude<ProposeArticleOutcome["status"], "created" | "exists">;
      readonly proposal: ArticlePublicationProposal | null;
    };

export type WithdrawArticleProposalRequest = {
  readonly projectId: string;
  readonly articleId: string;
  readonly proposalId: string;
  /** The operator's Supabase Auth user id, confirmed by the caller. */
  readonly operatorId: string;
};

export type WithdrawArticleProposalResult =
  /** `withdrawn: false` means it was already withdrawn; the database wrote nothing. */
  | { readonly ok: true; readonly withdrawn: boolean; readonly proposal: ArticlePublicationProposal; readonly state: ArticleProposalStateView }
  | { readonly ok: false; readonly reason: ReadFailure };

export type ArticleProposalService = {
  getState(projectId: string, articleId: string, destination?: string): Promise<GetProposalStateResult>;
  record(request: RecordArticleProposalRequest): Promise<RecordArticleProposalResult>;
  withdraw(request: WithdrawArticleProposalRequest): Promise<WithdrawArticleProposalResult>;
};

function isVersionNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 32_767;
}

function isDestinationKey(value: unknown): value is string {
  return typeof value === "string" && value.length >= 2 && value.length <= 64 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value);
}

/**
 * Whether a proposal still names the article as it stands: active, the
 * article approved at that version, which is still current, with the same
 * version row, content hash, approval row, approver and time. A proposal
 * that no longer does stays on record; it is withdrawn by the operator,
 * never moved.
 */
export function isArticleProposalCurrent(
  proposal: ArticlePublicationProposal,
  article: Article,
  version: StoredArticleVersion | null,
  approval: ArticleApproval | null,
): boolean {
  return (
    proposal.status === "proposed" &&
    proposal.articleId === article.id &&
    article.status === "approved" &&
    article.currentVersion === proposal.articleVersion &&
    article.approvedVersion === proposal.articleVersion &&
    article.approvedBy === proposal.approvedBy &&
    article.approvedAt === proposal.approvedAt &&
    version !== null &&
    version.id === proposal.articleVersionId &&
    version.contentSha256 === proposal.contentSha256 &&
    approval !== null &&
    approval.id === proposal.approvalId
  );
}

export function createArticleProposalService(dependencies: {
  /** Reads the article and the version (the C4 store, as C5 reads them). */
  readonly store: Pick<ArticleCheckStore, "storesChecks" | "getArticle" | "getVersion">;
  /** Reads the C5 approval history. */
  readonly approvals: Pick<ArticleApprovalStore, "storesApprovals" | "listApprovals">;
  readonly proposals: ArticleProposalStore;
}): ArticleProposalService {
  const { store, approvals, proposals } = dependencies;

  function available(): boolean {
    return store.storesChecks && approvals.storesApprovals && proposals.storesProposals;
  }

  /** Every read the state needs, in one place. Throws when a read fails. */
  async function compute(projectId: string, articleId: string, requestedDestination: string | undefined): Promise<GetProposalStateResult> {
    const article = await store.getArticle(projectId, articleId);
    if (article === null || article.projectId !== projectId) return { ok: false, reason: "not-found" };
    const version = await store.getVersion(article.id, article.currentVersion);
    const approval = (await approvals.listApprovals(article.id)).find((a) => a.articleId === article.id && a.articleVersion === article.currentVersion) ?? null;
    const history = await proposals.listProposals(projectId, article.id);
    if (history.some((p) => p.projectId !== projectId || p.articleId !== article.id)) return { ok: false, reason: "failed" };
    const active = history.find((p) => p.status === "proposed") ?? null;

    const destinationKey = requestedDestination ?? destinationsForProject(projectId)[0]?.key ?? "";
    const destination = findDestination(destinationKey, projectId);
    const slug = version === null ? "" : (readCanonicalArticle(version.canonicalContent)?.slug ?? "");
    // The holders are read whenever there is a destination and slug to ask about; a failed read throws.
    const holders = destinationKey !== "" && slug !== "" ? await proposals.listSlugHolders(destinationKey, slug) : [];
    // The live articles are the records' (fix F9); a failed read blocks the proposal rather than failing the state.
    let liveArticles: readonly LiveArticle[] | null = null;
    if (destinationKey !== "") {
      try {
        liveArticles = await proposals.listLiveArticles(destinationKey);
      } catch (error) {
        console.error("article proposals: live articles not read:", error instanceof Error ? `${error.name}: ${error.message}` : "unknown error");
      }
    }

    const eligibility = articleProposalEligibility({
      projectId,
      articleId: article.id,
      articleVersion: article.currentVersion,
      destination: destinationKey,
      slug,
      article,
      version,
      computedContentSha256: version === null ? null : utf8Sha256(version.canonicalContent),
      approval,
      proposals: {
        activeForArticle: active === null ? null : { proposalId: active.id, articleVersion: active.articleVersion, destination: active.destination, slug: active.slug },
        holders,
      },
      liveArticles,
    });

    let preview: ArticleProposalStateView["preview"] = null;
    if (eligibility.status === "eligible" && version !== null) {
      const hashed = hashedArticleProposalPreview({ binding: eligibility.binding, canonicalContent: version.canonicalContent, liveArticles: liveArticles ?? [] });
      // An eligible version whose preview cannot be built is an inconsistency, never a silent success.
      if (!hashed.ok) return { ok: false, reason: "failed" };
      preview = { ...hashed.preview, previewSha256: hashed.previewSha256 };
    }

    return {
      ok: true,
      state: {
        articleId: article.id,
        articleStatus: article.status,
        currentVersion: article.currentVersion,
        destination,
        eligibility,
        preview,
        activeProposal: active,
        activeProposalCurrent: active === null ? null : isArticleProposalCurrent(active, article, version, approval),
        history,
        liveSlug: liveArticles === null ? null : (liveArticleOf(liveArticles, article.id)?.slug ?? null),
        liveArticlesRead: liveArticles !== null,
      },
    };
  }

  return {
    async getState(projectId, articleId, destination) {
      if (!isProjectId(projectId) || !isUuid(articleId) || (destination !== undefined && !isDestinationKey(destination))) return { ok: false, reason: "invalid" };
      if (!available()) return { ok: false, reason: "unavailable" };
      return compute(projectId, articleId.toLowerCase(), destination);
    },

    async record(request) {
      if (
        !isProjectId(request.projectId) ||
        !isUuid(request.articleId) ||
        !isUuid(request.operatorId) ||
        !isVersionNumber(request.articleVersion) ||
        !isDestinationKey(request.destination)
      ) {
        return { ok: false, reason: "invalid" };
      }
      if (!available()) return { ok: false, reason: "unavailable" };
      const projectId = request.projectId;
      const articleId = request.articleId.toLowerCase();

      const before = await compute(projectId, articleId, request.destination);
      if (!before.ok) return before;
      const state = before.state;
      if (state.currentVersion !== request.articleVersion) return { ok: false, reason: "stale", state };
      if (state.eligibility.status === "blocked") {
        return { ok: false, reason: "ineligible", blocks: state.eligibility.blocks, warnings: state.eligibility.warnings, state };
      }
      if (state.preview === null) return { ok: false, reason: "failed" };

      const binding = state.eligibility.binding;
      const outcome = await proposals.propose({
        projectId,
        articleId: binding.articleId,
        articleVersion: binding.articleVersion,
        articleVersionId: binding.articleVersionId,
        contentSha256: binding.contentSha256,
        approvalId: binding.approvalId,
        destination: binding.destination,
        slug: binding.slug,
        previewFormat: state.preview.format,
        previewSha256: state.preview.previewSha256,
        requestedBy: request.operatorId.toLowerCase(),
      });

      switch (outcome.status) {
        case "created":
        case "exists": {
          const after = await compute(projectId, articleId, request.destination);
          if (!after.ok) return { ok: false, reason: "failed" };
          return { ok: true, recorded: outcome.status === "created", proposal: outcome.proposal, state: after.state };
        }
        case "active-exists":
          return { ok: false, reason: "refused", outcome: outcome.status, proposal: outcome.proposal };
        default:
          return { ok: false, reason: "refused", outcome: outcome.status, proposal: null };
      }
    },

    async withdraw(request) {
      if (!isProjectId(request.projectId) || !isUuid(request.articleId) || !isUuid(request.proposalId) || !isUuid(request.operatorId)) {
        return { ok: false, reason: "invalid" };
      }
      if (!available()) return { ok: false, reason: "unavailable" };
      const projectId = request.projectId;
      const articleId = request.articleId.toLowerCase();

      // The proposal must be this project's and this article's; otherwise it does not exist for this request.
      const proposal = await proposals.getProposal(projectId, request.proposalId.toLowerCase());
      if (proposal === null || proposal.projectId !== projectId || proposal.articleId !== articleId) return { ok: false, reason: "not-found" };

      const outcome = await proposals.withdraw({ projectId, proposalId: proposal.id, withdrawnBy: request.operatorId.toLowerCase() });
      if (outcome.status === "not-found") return { ok: false, reason: "not-found" };
      if (outcome.proposal.id !== proposal.id) return { ok: false, reason: "failed" };

      const after = await compute(projectId, articleId, proposal.destination);
      if (!after.ok) return { ok: false, reason: "failed" };
      return { ok: true, withdrawn: outcome.status === "withdrawn", proposal: outcome.proposal, state: after.state };
    },
  };
}
