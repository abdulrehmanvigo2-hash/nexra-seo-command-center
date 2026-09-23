import type { ArticleWriteRefusal } from "@/lib/content/articles/contract";
import type { Article, ArticleSourceRefusal, ArticleStatus, ArticleVersion, ArticleVersionSource } from "@/types/content-article-record";

/**
 * The shape of the three article tables, of the two draft tables as the
 * article store reads them, and of what `nexra_article_create` and
 * `nexra_article_save_version` answer — and the translation into the
 * application's types. The article tables grant no INSERT, UPDATE or
 * DELETE: the functions are the only way in, so no write type exists here.
 * A row that does not match what the migration declares is refused at read
 * time rather than passed on.
 */

export class ArticleRowError extends Error {
  constructor(message: string) {
    super(`Article row: ${message}`);
    this.name = "ArticleRowError";
  }
}

export type ArticleRow = {
  id: string;
  project_id: string;
  source_plan_run_id: string;
  status: string;
  current_version: number;
  approved_version: number | null;
  approved_by: string | null;
  approved_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type ArticleVersionRow = {
  id: string;
  article_id: string;
  version: number;
  origin: string;
  canonical_content: string;
  content_sha256: string;
  created_by: string;
  created_at: string;
};

export type ArticleVersionSourceRow = {
  id: string;
  article_version_id: string;
  position: number;
  source_draft_id: string;
  source_version: number;
  source_version_id: string;
  source_content_sha256: string;
  created_at: string;
};

/** The draft columns the article store reads; the draft tables are never written from here. */
export type SourceDraftRow = {
  id: string;
  project_id: string;
  section_label: string;
  source_plan_run_id: string | null;
};

export type SourceDraftVersionRow = {
  id: string;
  draft_id: string;
  version: number;
  title: string;
  body: string;
};

type ReadOnly<Row> = { Row: Row; Insert: never; Update: never; Relationships: [] };

export type ContentArticlesDatabase = {
  public: {
    Tables: {
      nexra_articles: ReadOnly<ArticleRow>;
      nexra_article_versions: ReadOnly<ArticleVersionRow>;
      nexra_article_version_sources: ReadOnly<ArticleVersionSourceRow>;
      nexra_content_drafts: ReadOnly<SourceDraftRow>;
      nexra_content_draft_versions: ReadOnly<SourceDraftVersionRow>;
    };
    Views: { [_ in never]: never };
    Functions: {
      nexra_article_create: {
        Args: {
          p_project_id: string;
          p_source_plan_run_id: string;
          p_canonical_content: string;
          p_content_sha256: string;
          p_sources: SourceReferenceArg[];
          p_created_by: string;
        };
        Returns: unknown;
      };
      nexra_article_save_version: {
        Args: {
          p_project_id: string;
          p_article_id: string;
          p_expected_version: number;
          p_canonical_content: string;
          p_content_sha256: string;
          p_sources: SourceReferenceArg[];
          p_created_by: string;
        };
        Returns: unknown;
      };
    };
  };
};

/** One source reference as the database functions take it. */
export type SourceReferenceArg = {
  draft_id: string;
  version: number;
  version_id: string;
  content_sha256: string;
};

export const ARTICLE_READ_COLUMNS =
  "id, project_id, source_plan_run_id, status, current_version, approved_version, approved_by, approved_at, created_by, created_at, updated_at";
export const ARTICLE_VERSION_READ_COLUMNS = "id, article_id, version, origin, canonical_content, content_sha256, created_by, created_at";
export const ARTICLE_SOURCE_READ_COLUMNS =
  "id, article_version_id, position, source_draft_id, source_version, source_version_id, source_content_sha256, created_at";
export const SOURCE_DRAFT_READ_COLUMNS = "id, project_id, section_label, source_plan_run_id";
export const SOURCE_DRAFT_VERSION_READ_COLUMNS = "id, draft_id, version, title, body";

const STATUSES: readonly ArticleStatus[] = ["drafting", "checked", "approved", "archived"];
const SOURCE_REFUSALS: readonly ArticleSourceRefusal[] = ["shape", "count", "duplicate", "not-found", "version-mismatch", "hash-mismatch"];

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ArticleRowError(`${what} is not an object.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string") throw new ArticleRowError(`${field} is not a string.`);
  return value;
}

function textOrNull(value: unknown, field: string): string | null {
  return value === null || value === undefined ? null : text(value, field);
}

function integer(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) throw new ArticleRowError(`${field} is not an integer.`);
  return value;
}

function integerOrNull(value: unknown, field: string): number | null {
  return value === null || value === undefined ? null : integer(value, field);
}

export function articleRowToArticle(row: unknown): Article {
  const r = record(row, "the article row");
  const status = STATUSES.find((entry) => entry === r.status);
  if (status === undefined) throw new ArticleRowError(`status is "${String(r.status)}", which this product does not recognise.`);
  return {
    id: text(r.id, "id"),
    projectId: text(r.project_id, "project_id"),
    sourcePlanRunId: text(r.source_plan_run_id, "source_plan_run_id"),
    status,
    currentVersion: integer(r.current_version, "current_version"),
    approvedVersion: integerOrNull(r.approved_version, "approved_version"),
    approvedBy: textOrNull(r.approved_by, "approved_by"),
    approvedAt: textOrNull(r.approved_at, "approved_at"),
    createdBy: text(r.created_by, "created_by"),
    createdAt: text(r.created_at, "created_at"),
    updatedAt: text(r.updated_at, "updated_at"),
  };
}

export function sourceRowToSource(row: unknown): ArticleVersionSource {
  const r = record(row, "the source row");
  return {
    position: integer(r.position, "position"),
    draftId: text(r.source_draft_id, "source_draft_id"),
    version: integer(r.source_version, "source_version"),
    versionId: text(r.source_version_id, "source_version_id"),
    contentSha256: text(r.source_content_sha256, "source_content_sha256"),
  };
}

export function versionRowToVersion(row: unknown, sources: readonly unknown[]): ArticleVersion {
  const r = record(row, "the version row");
  if (r.origin !== "operator") throw new ArticleRowError(`origin is "${String(r.origin)}", which this product does not recognise.`);
  return {
    id: text(r.id, "id"),
    articleId: text(r.article_id, "article_id"),
    version: integer(r.version, "version"),
    origin: "operator",
    canonicalContent: text(r.canonical_content, "canonical_content"),
    contentSha256: text(r.content_sha256, "content_sha256"),
    sources: sources.map(sourceRowToSource).sort((a, b) => a.position - b.position),
    createdBy: text(r.created_by, "created_by"),
    createdAt: text(r.created_at, "created_at"),
  };
}

export type ArticleRpcOutcome =
  | { readonly outcome: "created"; readonly article: Article; readonly version: ArticleVersion }
  | { readonly outcome: "exists"; readonly article: Article }
  | { readonly outcome: "project-not-found" | "plan-run-invalid" | "not-found" | "archived" }
  | { readonly outcome: "stale"; readonly currentVersion: number }
  | ArticleWriteRefusalOutcome;

type ArticleWriteRefusalOutcome = { readonly outcome: ArticleWriteRefusal["status"]; readonly index?: number | null; readonly reason?: ArticleSourceRefusal };

/** What either function answers, checked field by field: a shape it did not promise is an error, not a guess. */
export function articleResultToOutcome(data: unknown): ArticleRpcOutcome {
  const result = record(data, "the function's answer");
  switch (result.outcome) {
    case "created": {
      const sources = result.sources;
      if (!Array.isArray(sources)) throw new ArticleRowError("created without its source rows.");
      return { outcome: "created", article: articleRowToArticle(result.article), version: versionRowToVersion(result.version, sources) };
    }
    case "exists":
      return { outcome: "exists", article: articleRowToArticle(result.article) };
    case "project-not-found":
    case "plan-run-invalid":
    case "not-found":
    case "archived":
    case "content-mismatch":
    case "invalid-content":
      return { outcome: result.outcome };
    case "stale":
      return { outcome: "stale", currentVersion: integer(result.current_version, "current_version") };
    case "source-invalid": {
      const reason = SOURCE_REFUSALS.find((entry) => entry === result.reason);
      if (reason === undefined) throw new ArticleRowError(`a source was refused for "${String(result.reason)}", which this product does not recognise.`);
      return { outcome: "source-invalid", index: integerOrNull(result.index, "index"), reason };
    }
    default:
      throw new ArticleRowError(`the function answered "${String(result.outcome)}", which this product does not recognise.`);
  }
}
