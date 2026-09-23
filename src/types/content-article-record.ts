/**
 * Shapes for stored articles (Stage 5, milestone C2): an article parent,
 * its immutable versions, and each version's source provenance.
 *
 * A version's content is the C1 canonical text (`nexra-article-content/1`)
 * and its SHA-256, and nothing else: no second, editable copy of any
 * article field exists. The readable fields below are parsed from that text
 * on every read.
 *
 * Nothing here is a fact-check, an approval or a publication. `checked` and
 * `approved` are states a later milestone may set; C2 writes `drafting`
 * only, and the approval fields stay as history when a new version is saved.
 */

import type { ValidatedArticleContent } from "@/types/content-article";

export type ArticleStatus = "drafting" | "checked" | "approved" | "archived";

/** C2 writes operator versions only. */
export type ArticleVersionOrigin = "operator";

export type Article = {
  readonly id: string;
  readonly projectId: string;
  /** The completed content plan run this article was assembled for. One article per plan run. */
  readonly sourcePlanRunId: string;
  readonly status: ArticleStatus;
  readonly currentVersion: number;
  /** History for a later milestone; never an approval of any newer version. */
  readonly approvedVersion: number | null;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  /** The Supabase Auth user id of the operator who created it. */
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

/** One exact draft version an article version was assembled from. Provenance only. */
export type ArticleVersionSource = {
  /** 1-based, in the order the operator gave. */
  readonly position: number;
  readonly draftId: string;
  readonly version: number;
  readonly versionId: string;
  /** The draft version's `nexra-content-draft-version/1` hash. */
  readonly contentSha256: string;
};

export type ArticleVersion = {
  readonly id: string;
  readonly articleId: string;
  readonly version: number;
  readonly origin: ArticleVersionOrigin;
  /** Exactly the C1 canonical text, as stored. */
  readonly canonicalContent: string;
  readonly contentSha256: string;
  readonly sources: readonly ArticleVersionSource[];
  readonly createdBy: string;
  readonly createdAt: string;
};

/** A version as the server reads it back: the stored row, and what the stored text parses to. */
export type ArticleVersionView = ArticleVersion & {
  /** The content, when the stored text is exactly the canonical serialisation of valid content; null otherwise. */
  readonly content: ValidatedArticleContent | null;
  /** The stored text parses as canonical content and hashes to the stored value. */
  readonly verified: boolean;
};

/** An article and its versions, oldest first. */
export type ArticleHistory = {
  readonly article: Article;
  readonly versions: readonly ArticleVersionView[];
};

/** A completed content plan run of the project that has no article yet. */
export type ArticlePlanCandidate = {
  readonly runId: string;
  readonly summary: string | null;
  readonly finishedAt: string | null;
};

/** One draft version the operator may cite as a source, as the server reads it now. */
export type ArticleSourceCandidate = {
  readonly draftId: string;
  readonly sectionLabel: string;
  /** The content plan run the draft's Writer run drafted from, when recorded. */
  readonly sourcePlanRunId: string | null;
  readonly version: number;
  readonly versionId: string;
  readonly title: string;
  /** Computed by the server from the stored title and body. */
  readonly contentSha256: string;
};

export type ArticleWorkspace = {
  /** Newest first. */
  readonly articles: readonly ArticleHistory[];
  readonly planCandidates: readonly ArticlePlanCandidate[];
  readonly sourceCandidates: readonly ArticleSourceCandidate[];
};

/** Why a source reference was refused, by the service or by the database. */
export type ArticleSourceRefusal = "shape" | "count" | "duplicate" | "not-found" | "version-mismatch" | "hash-mismatch";

