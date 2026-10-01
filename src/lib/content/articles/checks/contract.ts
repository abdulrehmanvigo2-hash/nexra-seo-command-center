/**
 * What the article check service and the runtime's article-check reader
 * need from wherever articles and their check units are kept.
 *
 * Storage-agnostic, like the article contract: the service holds the rules,
 * the store holds rows, and the one database function behind `record`
 * re-checks every rule in one transaction under the parent article's lock.
 * Every article read names the project as well as the id.
 *
 * Nothing here approves, proposes or publishes, and nothing writes article
 * text: a check unit row stores a unit's identity, hash and result only.
 */

import type { Article, ArticleVersion } from "@/types/content-article-record";
import type { ArticleCheckUnitKind, ArticleCheckUnitRecord, ArticleCheckUnitResult, ArticleCheckUnitStatus } from "@/types/content-article-check";

/** A stored version without its source rows: the check reads only the text and its hash. */
export type StoredArticleVersion = Omit<ArticleVersion, "sources">;

export type RecordUnitInput = {
  readonly projectId: string;
  readonly articleId: string;
  readonly articleVersion: number;
  /** The version's immutable row id, as the server read it. */
  readonly articleVersionId: string;
  readonly unitIndex: number;
  readonly unitKind: ArticleCheckUnitKind;
  readonly unitKey: string;
  /** The unit's part within its block, the block's part count, and the version's unit count — all computed by the server. */
  readonly part: number;
  readonly partCount: number;
  readonly unitCount: number;
  /** Computed by the server from the stored version's text. */
  readonly unitSha256: string;
  readonly status: ArticleCheckUnitStatus;
  /** Null exactly when pending. */
  readonly result: ArticleCheckUnitResult | null;
  readonly runId: string;
  readonly recordedBy: string;
};

export type RecordUnitOutcome =
  /** Written: inserted, or moved forward. */
  | { readonly status: "recorded"; readonly record: ArticleCheckUnitRecord; readonly article: Article; readonly articleStatusAdvanced: boolean }
  /** The same run's same status was already recorded; nothing was written. */
  | { readonly status: "exists"; readonly record: ArticleCheckUnitRecord; readonly article: Article }
  /** The unit already carries a final result, or a pending one from another run; nothing was written. */
  | { readonly status: "already-recorded"; readonly record: ArticleCheckUnitRecord }
  | {
      readonly status:
        | "not-found"
        | "archived"
        | "version-not-found"
        | "version-mismatch"
        | "unit-mismatch"
        /** The part count or unit count disagrees with the version's other rows. */
        | "count-mismatch"
        | "run-mismatch"
        | "run-state-mismatch"
        | "invalid-result";
    };

/** Fix F8: carry an earlier pass of the identical unit onto the current version (`nexra_article_check_unit_carry`). */
export type CarryUnitInput = {
  readonly projectId: string;
  readonly articleId: string;
  readonly articleVersion: number;
  readonly articleVersionId: string;
  readonly unitIndex: number;
  readonly unitKind: ArticleCheckUnitKind;
  readonly unitKey: string;
  readonly part: number;
  readonly partCount: number;
  readonly unitCount: number;
  readonly unitSha256: string;
  /** The earlier, run-checked passed row to carry. */
  readonly sourceUnitId: string;
  /** The SHA-256 of the instructions the server checks with now. */
  readonly instructionsSha256: string;
  /** The evidence fingerprint read now, or null when the source holds no SUPPORTED statement and none was read. */
  readonly evidenceSha256: string | null;
  readonly recordedBy: string;
};

export type CarryUnitOutcome =
  | { readonly status: "carried"; readonly record: ArticleCheckUnitRecord; readonly article: Article; readonly articleStatusAdvanced: boolean }
  | {
      readonly status:
        | "not-found"
        | "archived"
        | "version-not-found"
        | "version-mismatch"
        | "not-current"
        | "unit-mismatch"
        | "count-mismatch"
        | "already-recorded"
        /** The database found no eligible source under its own rule; it never says which condition failed. */
        | "source-not-eligible";
    };

/** Fix F8: clear a carried unit of the current, unapproved version so a fresh run may check it (`nexra_article_check_unit_fresh`). */
export type FreshUnitInput = {
  readonly projectId: string;
  readonly articleId: string;
  readonly articleVersionId: string;
  readonly unitIndex: number;
  readonly recordedBy: string;
};

export type FreshUnitOutcome =
  | { readonly status: "cleared"; readonly record: ArticleCheckUnitRecord; readonly article: Article; readonly articleStatusReverted: boolean }
  | { readonly status: "not-found" | "archived" | "unit-not-found" | "not-current" | "approved" | "not-carried" };

export type ArticleCheckStore = {
  /** Whether this store keeps articles and checks. The fixture data source does not. */
  readonly storesChecks: boolean;
  /** One article by project and id together, or null. */
  getArticle(projectId: string, articleId: string): Promise<Article | null>;
  /** One version of an article by number, or null. */
  getVersion(articleId: string, version: number): Promise<StoredArticleVersion | null>;
  /** Every check unit row of one exact version, by unit index. */
  listUnitRecords(articleVersionId: string): Promise<readonly ArticleCheckUnitRecord[]>;
  /** One unit's status and result, in one database transaction under the parent's lock. */
  record(input: RecordUnitInput): Promise<RecordUnitOutcome>;
  /** Every check unit row of every version of one article (fix F8: the earlier passes a unit may carry). */
  listArticleUnitRecords(articleId: string): Promise<readonly ArticleCheckUnitRecord[]>;
  /** Carries an earlier pass, under the parent's lock; the database re-checks every rule. */
  carry(input: CarryUnitInput): Promise<CarryUnitOutcome>;
  /** Clears a carried unit for a fresh check, under the parent's lock. */
  fresh(input: FreshUnitInput): Promise<FreshUnitOutcome>;
};

/** The store used when articles are not persisted anywhere. It refuses rather than pretends. */
export const unavailableArticleCheckStore: ArticleCheckStore = {
  storesChecks: false,
  async getArticle() {
    return null;
  },
  async getVersion() {
    return null;
  },
  async listUnitRecords() {
    return [];
  },
  async record() {
    return { status: "not-found" };
  },
  async listArticleUnitRecords() {
    return [];
  },
  async carry() {
    return { status: "not-found" };
  },
  async fresh() {
    return { status: "not-found" };
  },
};
