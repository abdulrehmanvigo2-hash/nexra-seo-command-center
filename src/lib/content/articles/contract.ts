/**
 * What the article service needs from wherever articles are kept.
 *
 * Storage-agnostic, like the draft and proposal contracts: the service holds
 * the rules, the store holds rows, and the two database functions behind
 * `create` and `saveVersion` re-check every rule in one transaction. Every
 * read names the project as well as the id, so an article of one client is
 * never reached through another's page.
 *
 * Nothing here fact-checks, approves, proposes or publishes, and no method
 * reaches anything outside the store.
 */

import type { ArticleSourceReference } from "@/types/content-article";
import type { Article, ArticleSourceRefusal, ArticleVersion } from "@/types/content-article-record";

/** A draft version as stored, for citing as a source. The service computes its hash. */
export type StoredSourceVersion = {
  readonly draftId: string;
  readonly projectId: string;
  readonly sectionLabel: string;
  readonly sourcePlanRunId: string | null;
  readonly version: number;
  readonly versionId: string;
  readonly title: string;
  readonly body: string;
};

export type CreateArticleInput = {
  readonly projectId: string;
  readonly sourcePlanRunId: string;
  /** The C1 canonical text, computed by the server. */
  readonly canonicalContent: string;
  /** Its SHA-256, computed by the server; the database recomputes and compares it. */
  readonly contentSha256: string;
  readonly sources: readonly ArticleSourceReference[];
  readonly createdBy: string;
};

export type SaveArticleVersionInput = {
  readonly projectId: string;
  readonly articleId: string;
  /** The version the operator started editing from; refused when no longer current. */
  readonly expectedVersion: number;
  readonly canonicalContent: string;
  readonly contentSha256: string;
  readonly sources: readonly ArticleSourceReference[];
  readonly createdBy: string;
};

/** Refusals both write functions share. Nothing was written. */
export type ArticleWriteRefusal =
  /** The database's hash of the text differs from the one given. */
  | { readonly status: "content-mismatch" }
  /** The text is not in the canonical format. */
  | { readonly status: "invalid-content" }
  /** A source does not match an immutable draft version of this project; `index` is 0-based, null for the list as a whole. */
  | { readonly status: "source-invalid"; readonly index: number | null; readonly reason: ArticleSourceRefusal };

export type CreateArticleOutcome =
  | { readonly status: "created"; readonly article: Article; readonly version: ArticleVersion }
  /** An article for this plan run already exists. Nothing was written. */
  | { readonly status: "exists"; readonly article: Article }
  | { readonly status: "project-not-found" }
  /** The plan run is not a completed content plan of this project. Nothing was written. */
  | { readonly status: "plan-run-invalid" }
  | ArticleWriteRefusal;

export type SaveArticleVersionOutcome =
  | { readonly status: "created"; readonly article: Article; readonly version: ArticleVersion }
  /** No such article in this project. */
  | { readonly status: "not-found" }
  /** An archived article is not edited. */
  | { readonly status: "archived" }
  /** The article's current version is not the one the operator started from. Nothing was written. */
  | { readonly status: "stale"; readonly currentVersion: number }
  | ArticleWriteRefusal;

export type ArticleStore = {
  /** Whether this store keeps articles. The fixture data source does not. */
  readonly storesArticles: boolean;
  /** The project's articles, newest first, at most `limit`. */
  listForProject(projectId: string, limit: number): Promise<readonly Article[]>;
  /** One article by project and id together, or null. */
  getByProjectAndId(projectId: string, articleId: string): Promise<Article | null>;
  /** An article's versions with their sources, oldest first, at most `limit`. */
  listVersions(articleId: string, limit: number): Promise<readonly ArticleVersion[]>;
  /** The project's draft versions, newest draft first, at most `limit` drafts. */
  listSourceVersions(projectId: string, limit: number): Promise<readonly StoredSourceVersion[]>;
  /** One draft version by project, draft and number, or null. */
  getSourceVersion(projectId: string, draftId: string, version: number): Promise<StoredSourceVersion | null>;
  /** The article, version 1 and its sources, in one database transaction. */
  create(input: CreateArticleInput): Promise<CreateArticleOutcome>;
  /** Version N+1 and its sources, in one database transaction under the parent's lock. */
  saveVersion(input: SaveArticleVersionInput): Promise<SaveArticleVersionOutcome>;
};

/** The store used when articles are not persisted anywhere. It refuses rather than pretends. */
export const unavailableArticleStore: ArticleStore = {
  storesArticles: false,
  async listForProject() {
    return [];
  },
  async getByProjectAndId() {
    return null;
  },
  async listVersions() {
    return [];
  },
  async listSourceVersions() {
    return [];
  },
  async getSourceVersion() {
    return null;
  },
  async create() {
    return { status: "project-not-found" };
  },
  async saveVersion() {
    return { status: "not-found" };
  },
};
