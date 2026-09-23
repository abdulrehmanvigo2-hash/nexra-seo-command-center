import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { ArticleStore, CreateArticleOutcome, SaveArticleVersionOutcome, StoredSourceVersion } from "@/lib/content/articles/contract";
import {
  ARTICLE_READ_COLUMNS,
  ARTICLE_SOURCE_READ_COLUMNS,
  ARTICLE_VERSION_READ_COLUMNS,
  articleResultToOutcome,
  articleRowToArticle,
  SOURCE_DRAFT_READ_COLUMNS,
  SOURCE_DRAFT_VERSION_READ_COLUMNS,
  versionRowToVersion,
  type ContentArticlesDatabase,
  type SourceDraftRow,
  type SourceReferenceArg,
} from "@/lib/content/articles/supabase/schema";
import type { ArticleSourceReference } from "@/types/content-article";

/**
 * The article store over `nexra_articles`, `nexra_article_versions` and
 * `nexra_article_version_sources`.
 *
 * A thin translation into Supabase calls: the rules live in the service,
 * and the two database functions and the guard triggers enforce them again
 * for any caller. Writes are the functions alone — the tables grant
 * service_role SELECT and nothing else. The draft tables are read, never
 * written. Every read names the project. Nothing here reaches anything
 * outside the database.
 */

export class ArticleStoreError extends Error {
  constructor(operation: string, cause: PostgrestError | Error) {
    const detail = "code" in cause ? `(${cause.code}): ${cause.message}` : cause.message;
    super(`Article store: ${operation} failed ${detail}`);
    this.name = "ArticleStoreError";
  }
}

function sourceArgs(sources: readonly ArticleSourceReference[]): SourceReferenceArg[] {
  return sources.map((source) => ({
    draft_id: source.draftId,
    version: source.version,
    version_id: source.versionId,
    content_sha256: source.contentSha256,
  }));
}

function draftVersion(draft: SourceDraftRow, row: { id: string; draft_id: string; version: number; title: string; body: string }): StoredSourceVersion {
  return {
    draftId: draft.id,
    projectId: draft.project_id,
    sectionLabel: draft.section_label,
    sourcePlanRunId: draft.source_plan_run_id,
    version: row.version,
    versionId: row.id,
    title: row.title,
    body: row.body,
  };
}

export function createSupabaseArticleStore(client: SupabaseClient<ContentArticlesDatabase>): ArticleStore {
  return {
    storesArticles: true,

    async listForProject(projectId, limit) {
      const { data, error } = await client
        .from("nexra_articles")
        .select(ARTICLE_READ_COLUMNS)
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw new ArticleStoreError("list articles", error);
      return data.map(articleRowToArticle);
    },

    async getByProjectAndId(projectId, articleId) {
      const { data, error } = await client
        .from("nexra_articles")
        .select(ARTICLE_READ_COLUMNS)
        .eq("project_id", projectId)
        .eq("id", articleId)
        .maybeSingle();
      if (error) throw new ArticleStoreError("read article", error);
      return data === null ? null : articleRowToArticle(data);
    },

    async listVersions(articleId, limit) {
      const { data: versions, error } = await client
        .from("nexra_article_versions")
        .select(ARTICLE_VERSION_READ_COLUMNS)
        .eq("article_id", articleId)
        .order("version", { ascending: true })
        .limit(limit);
      if (error) throw new ArticleStoreError("list article versions", error);
      if (versions.length === 0) return [];
      const { data: sources, error: sourcesError } = await client
        .from("nexra_article_version_sources")
        .select(ARTICLE_SOURCE_READ_COLUMNS)
        .in(
          "article_version_id",
          versions.map((v) => v.id),
        );
      if (sourcesError) throw new ArticleStoreError("list article sources", sourcesError);
      return versions.map((row) =>
        versionRowToVersion(
          row,
          sources.filter((s) => s.article_version_id === row.id),
        ),
      );
    },

    async listSourceVersions(projectId, limit) {
      const { data: drafts, error } = await client
        .from("nexra_content_drafts")
        .select(SOURCE_DRAFT_READ_COLUMNS)
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw new ArticleStoreError("list source drafts", error);
      if (drafts.length === 0) return [];
      const { data: rows, error: rowsError } = await client
        .from("nexra_content_draft_versions")
        .select(SOURCE_DRAFT_VERSION_READ_COLUMNS)
        .in(
          "draft_id",
          drafts.map((d) => d.id),
        )
        .order("version", { ascending: false });
      if (rowsError) throw new ArticleStoreError("list source draft versions", rowsError);
      return drafts.flatMap((draft) => rows.filter((row) => row.draft_id === draft.id).map((row) => draftVersion(draft, row)));
    },

    async getSourceVersion(projectId, draftId, version) {
      const { data: draft, error } = await client
        .from("nexra_content_drafts")
        .select(SOURCE_DRAFT_READ_COLUMNS)
        .eq("project_id", projectId)
        .eq("id", draftId)
        .maybeSingle();
      if (error) throw new ArticleStoreError("read source draft", error);
      if (draft === null) return null;
      const { data: row, error: rowError } = await client
        .from("nexra_content_draft_versions")
        .select(SOURCE_DRAFT_VERSION_READ_COLUMNS)
        .eq("draft_id", draftId)
        .eq("version", version)
        .maybeSingle();
      if (rowError) throw new ArticleStoreError("read source draft version", rowError);
      return row === null ? null : draftVersion(draft, row);
    },

    // One function, one transaction: the parent, version 1 and its sources,
    // after the database re-checks the project, the plan run, the text and
    // every source.
    async create(input): Promise<CreateArticleOutcome> {
      const { data, error } = await client.rpc("nexra_article_create", {
        p_project_id: input.projectId,
        p_source_plan_run_id: input.sourcePlanRunId,
        p_canonical_content: input.canonicalContent,
        p_content_sha256: input.contentSha256,
        p_sources: sourceArgs(input.sources),
        p_created_by: input.createdBy,
      });
      if (error) throw new ArticleStoreError("create article", error);
      const outcome = articleResultToOutcome(data);
      switch (outcome.outcome) {
        case "created":
          return { status: "created", article: outcome.article, version: outcome.version };
        case "exists":
          return { status: "exists", article: outcome.article };
        case "project-not-found":
        case "plan-run-invalid":
        case "content-mismatch":
        case "invalid-content":
          return { status: outcome.outcome };
        case "source-invalid":
          return { status: "source-invalid", index: outcome.index ?? null, reason: outcome.reason ?? "shape" };
        default:
          throw new ArticleStoreError("create article", new Error(`unexpected outcome "${outcome.outcome}"`));
      }
    },

    // One function, one transaction under the parent's row lock.
    async saveVersion(input): Promise<SaveArticleVersionOutcome> {
      const { data, error } = await client.rpc("nexra_article_save_version", {
        p_project_id: input.projectId,
        p_article_id: input.articleId,
        p_expected_version: input.expectedVersion,
        p_canonical_content: input.canonicalContent,
        p_content_sha256: input.contentSha256,
        p_sources: sourceArgs(input.sources),
        p_created_by: input.createdBy,
      });
      if (error) throw new ArticleStoreError("save article version", error);
      const outcome = articleResultToOutcome(data);
      switch (outcome.outcome) {
        case "created":
          return { status: "created", article: outcome.article, version: outcome.version };
        case "not-found":
        case "archived":
        case "content-mismatch":
        case "invalid-content":
          return { status: outcome.outcome };
        case "stale":
          return { status: "stale", currentVersion: outcome.currentVersion };
        case "source-invalid":
          return { status: "source-invalid", index: outcome.index ?? null, reason: outcome.reason ?? "shape" };
        default:
          throw new ArticleStoreError("save article version", new Error(`unexpected outcome "${outcome.outcome}"`));
      }
    },
  };
}
