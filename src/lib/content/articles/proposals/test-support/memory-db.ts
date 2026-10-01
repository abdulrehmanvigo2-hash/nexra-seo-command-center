import type { ArticleApprovalStore } from "@/lib/content/articles/approvals/contract";
import { readCanonicalArticle } from "@/lib/content/articles/canonical";
import type { ArticleCheckStore, StoredArticleVersion } from "@/lib/content/articles/checks/contract";
import type { ArticleProposalStore, ProposeArticleInput, ProposeArticleOutcome, WithdrawArticleInput, WithdrawArticleOutcome } from "@/lib/content/articles/proposals/contract";
import { liveSlugOutcome, type LiveArticle } from "@/lib/content/articles/proposals/live-slugs";
import { utf8Sha256 } from "@/lib/content/publications/content-hash";
import { findDestination } from "@/lib/content/publications/destinations";
import type { ArticleApproval } from "@/types/content-article-approval";
import type { ArticlePublicationProposal } from "@/types/content-article-proposal";
import type { Article } from "@/types/content-article-record";

/**
 * An in-memory database for the C6 Checkpoint 3 service tests.
 *
 * `propose` and `withdraw` apply — in one synchronous step — the same rules,
 * in the same order, that `nexra_article_publication_propose` and
 * `nexra_article_publication_withdraw` (20260925120000) apply under the
 * article's row lock, plus the D3 cross-table slug rule (20260926120000).
 * The functions themselves are exercised against PostgreSQL 16 by
 * `supabase/tests/run.sh`. `beforePropose` / `beforeWithdraw` run just
 * before the rules, as a concurrent writer would; `failReads` makes a read
 * throw, as a failed database call does. Test support only.
 */

export type DraftHolder = { readonly proposalId: string; readonly draftId: string; readonly destination: string; readonly slug: string; status: "proposed" | "withdrawn" };

export type MemoryDb = {
  articles: Article[];
  versions: StoredArticleVersion[];
  approvals: ArticleApproval[];
  proposals: ArticlePublicationProposal[];
  drafts: DraftHolder[];
  readonly calls: { propose: ProposeArticleInput[]; withdraw: WithdrawArticleInput[]; reads: string[] };
  beforePropose: (() => void) | null;
  beforeWithdraw: (() => void) | null;
  failReads: Set<"article" | "version" | "approvals" | "proposals" | "proposal" | "holders" | "live">;
  /** The database's live-slug list (20260925120000 + 20261011120000), per destination: slug and owning article. */
  liveSlugs: { readonly destination: string; readonly slug: string; readonly articleId: string | null }[];
  /** Replaces the propose function's answer entirely, as a database answer the product must map. */
  proposeAnswer: ProposeArticleOutcome | null;
};

let sequence = 0;
function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

export function memoryDb(initial: Partial<Pick<MemoryDb, "articles" | "versions" | "approvals" | "proposals" | "drafts">> = {}): MemoryDb {
  return {
    articles: initial.articles ?? [],
    versions: initial.versions ?? [],
    approvals: initial.approvals ?? [],
    proposals: initial.proposals ?? [],
    drafts: initial.drafts ?? [],
    calls: { propose: [], withdraw: [], reads: [] },
    beforePropose: null,
    beforeWithdraw: null,
    failReads: new Set(),
    proposeAnswer: null,
    liveSlugs: DATABASE_LIVE_SLUGS.map((entry) => ({ ...entry })),
  };
}

/**
 * The live slugs the migrations put in the database (test support: a model of
 * `nexra_article_publication_live_slugs` and `_live_slug_article`). The
 * application holds no such list; it reads `liveArticles` below.
 */
export const DATABASE_LIVE_SLUGS: readonly { readonly destination: string; readonly slug: string; readonly articleId: string | null }[] = [
  { destination: "nexra-agency-website", slug: "ai-lead-follow-up-automation", articleId: null },
  { destination: "nexra-agency-website", slug: "ai-dead-lead-reactivation", articleId: "1003104c-6b25-456f-9304-eefa2ba88e7d" },
];

/** `nexra_article_publication_live_articles` (20261015120000): each live slug with its owner's proposed version and keywords. */
export function liveArticles(db: MemoryDb, destination: string): readonly LiveArticle[] {
  return db.liveSlugs
    .filter((entry) => entry.destination === destination)
    .map((entry) => {
      const owned = entry.articleId === null ? [] : db.proposals.filter((p) => p.articleId === entry.articleId && p.destination === destination && p.slug === entry.slug);
      const chosen = owned.find((p) => p.status === "proposed") ?? owned[owned.length - 1] ?? null;
      const version = chosen === null ? undefined : db.versions.find((v) => v.articleId === chosen.articleId && v.version === chosen.articleVersion);
      const keywords = version === undefined ? null : ((JSON.parse(version.canonicalContent) as { keywords?: string[] }).keywords ?? null);
      return { slug: entry.slug, articleId: entry.articleId, articleVersion: chosen?.articleVersion ?? null, keywords };
    });
}

function fail(db: MemoryDb, read: MemoryDb["failReads"] extends Set<infer R> ? R : never): void {
  db.calls.reads.push(read);
  if (db.failReads.has(read)) throw new Error(`memory store: ${read} read failed`);
}

function propose(db: MemoryDb, input: ProposeArticleInput): ProposeArticleOutcome {
  db.calls.propose.push(input);
  db.beforePropose?.();
  if (db.proposeAnswer !== null) return db.proposeAnswer;

  const article = db.articles.find((a) => a.id === input.articleId && a.projectId === input.projectId);
  if (article === undefined) return { status: "not-found" };
  if (article.status === "archived") return { status: "archived" };
  if (findDestination(input.destination, input.projectId) === null) return { status: "destination-unavailable" };
  if (article.status !== "approved") return { status: "not-approved" };
  if (article.currentVersion !== input.articleVersion || article.approvedVersion !== input.articleVersion) return { status: "stale" };
  const version = db.versions.find((v) => v.articleId === input.articleId && v.version === input.articleVersion);
  if (version === undefined) return { status: "version-not-found" };
  if (version.id !== input.articleVersionId) return { status: "version-mismatch" };
  if (version.contentSha256 !== input.contentSha256 || utf8Sha256(version.canonicalContent) !== input.contentSha256) return { status: "content-mismatch" };
  const approval = db.approvals.find((a) => a.id === input.approvalId);
  if (
    approval === undefined ||
    approval.articleId !== input.articleId ||
    approval.articleVersion !== input.articleVersion ||
    approval.articleVersionId !== input.articleVersionId ||
    approval.contentSha256 !== input.contentSha256 ||
    approval.approvedBy !== article.approvedBy ||
    approval.approvedAt !== article.approvedAt
  ) {
    return { status: "approval-mismatch" };
  }
  const content = readCanonicalArticle(version.canonicalContent);
  if (content === null || content.slug !== input.slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(input.slug) || input.slug.length < 3 || input.slug.length > 80) {
    return { status: "slug-mismatch" };
  }
  if (version.canonicalContent.toLowerCase().includes("[needs evidence")) return { status: "unresolved-placeholder" };
  if (input.previewFormat !== "article-proposal-text/1" || !/^[0-9a-f]{64}$/.test(input.previewSha256)) return { status: "invalid-preview" };
  if (liveSlugOutcome(liveArticles(db, input.destination), input.slug, input.articleId, content.topicDecision) === "collision") return { status: "slug-live-collision" };

  const active = db.proposals.find((p) => p.articleId === input.articleId && p.status === "proposed");
  if (active !== undefined) {
    const identical =
      active.articleVersion === input.articleVersion &&
      active.articleVersionId === input.articleVersionId &&
      active.contentSha256 === input.contentSha256 &&
      active.approvalId === input.approvalId &&
      active.destination === input.destination &&
      active.slug === input.slug &&
      active.previewFormat === input.previewFormat &&
      active.previewSha256 === input.previewSha256;
    return { status: identical ? "exists" : "active-exists", proposal: active };
  }
  const held =
    db.proposals.some((p) => p.status === "proposed" && p.destination === input.destination && p.slug === input.slug) ||
    db.drafts.some((d) => d.status === "proposed" && d.destination === input.destination && d.slug === input.slug);
  if (held) return { status: "slug-taken" };

  sequence += 1;
  const at = `2026-09-25T10:00:${String(sequence % 60).padStart(2, "0")}.000000+00:00`;
  const proposal: ArticlePublicationProposal = {
    id: nextId("f6000000"),
    projectId: input.projectId,
    articleId: input.articleId,
    articleVersion: input.articleVersion,
    articleVersionId: input.articleVersionId,
    contentSha256: version.contentSha256,
    approvalId: approval.id,
    approvedBy: approval.approvedBy,
    approvedAt: approval.approvedAt,
    destination: input.destination,
    slug: input.slug,
    previewFormat: input.previewFormat,
    previewSha256: input.previewSha256,
    status: "proposed",
    requestedBy: input.requestedBy,
    withdrawnBy: null,
    withdrawnAt: null,
    createdAt: at,
    updatedAt: at,
  };
  db.proposals.unshift(proposal);
  return { status: "created", proposal };
}

function withdraw(db: MemoryDb, input: WithdrawArticleInput): WithdrawArticleOutcome {
  db.calls.withdraw.push(input);
  db.beforeWithdraw?.();
  const index = db.proposals.findIndex((p) => p.id === input.proposalId && p.projectId === input.projectId);
  if (index < 0) return { status: "not-found" };
  const proposal = db.proposals[index];
  if (proposal.status === "withdrawn") return { status: "already-withdrawn", proposal };
  const at = "2026-09-25T11:00:00.000000+00:00";
  const withdrawn: ArticlePublicationProposal = { ...proposal, status: "withdrawn", withdrawnBy: input.withdrawnBy, withdrawnAt: at, updatedAt: at };
  db.proposals[index] = withdrawn;
  return { status: "withdrawn", proposal: withdrawn };
}

/** The three stores the service reads and writes, over one memory database. */
export function memoryStores(db: MemoryDb): {
  readonly store: Pick<ArticleCheckStore, "storesChecks" | "getArticle" | "getVersion">;
  readonly approvals: Pick<ArticleApprovalStore, "storesApprovals" | "listApprovals">;
  readonly proposals: ArticleProposalStore;
} {
  return {
    store: {
      storesChecks: true,
      async getArticle(projectId, articleId) {
        fail(db, "article");
        return db.articles.find((a) => a.projectId === projectId && a.id === articleId) ?? null;
      },
      async getVersion(articleId, version) {
        fail(db, "version");
        return db.versions.find((v) => v.articleId === articleId && v.version === version) ?? null;
      },
    },
    approvals: {
      storesApprovals: true,
      async listApprovals(articleId) {
        fail(db, "approvals");
        return db.approvals.filter((a) => a.articleId === articleId).sort((a, b) => b.articleVersion - a.articleVersion);
      },
    },
    proposals: {
      storesProposals: true,
      async listProposals(projectId, articleId) {
        fail(db, "proposals");
        return db.proposals.filter((p) => p.projectId === projectId && p.articleId === articleId);
      },
      async getProposal(projectId, proposalId) {
        fail(db, "proposal");
        return db.proposals.find((p) => p.projectId === projectId && p.id === proposalId) ?? null;
      },
      async listSlugHolders(destination, slug) {
        fail(db, "holders");
        return [
          ...db.proposals.filter((p) => p.status === "proposed" && p.destination === destination && p.slug === slug).map((p) => ({ kind: "article" as const, proposalId: p.id, articleId: p.articleId, destination, slug })),
          ...db.drafts.filter((d) => d.status === "proposed" && d.destination === destination && d.slug === slug).map((d) => ({ kind: "draft" as const, proposalId: d.proposalId, draftId: d.draftId, destination, slug })),
        ];
      },
      async propose(input) {
        return propose(db, input);
      },
      async withdraw(input) {
        return withdraw(db, input);
      },
      async listLiveArticles(destination) {
        fail(db, "live");
        return liveArticles(db, destination);
      },
    },
  };
}
