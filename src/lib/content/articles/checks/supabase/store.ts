import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ArticleCheckStore, CarryUnitOutcome, FreshUnitOutcome, RecordUnitOutcome, StoredArticleVersion } from "@/lib/content/articles/checks/contract";
import {
  CHECK_ARTICLE_READ_COLUMNS,
  CHECK_UNIT_READ_COLUMNS,
  CHECK_VERSION_READ_COLUMNS,
  carryResultToOutcome,
  freshResultToOutcome,
  recordResultToOutcome,
  unitRowToRecord,
  type ArticleChecksDatabase,
} from "@/lib/content/articles/checks/supabase/schema";
import { ArticleStoreError } from "@/lib/content/articles/supabase/store";
import { articleRowToArticle, versionRowToVersion } from "@/lib/content/articles/supabase/schema";

/**
 * The article check store over `nexra_article_check_units`, reading the
 * article tables beside it.
 *
 * A thin translation into Supabase calls: the rules live in the service,
 * and the one database function and the guard triggers enforce them again
 * for any caller. The only write is that function — the table grants
 * service_role SELECT and nothing else. The article tables are read, never
 * written from here (the function alone may move a parent to `checked`).
 * Every article read names the project.
 */

export function createSupabaseArticleCheckStore(client: SupabaseClient<ArticleChecksDatabase>): ArticleCheckStore {
  return {
    storesChecks: true,

    async getArticle(projectId, articleId) {
      const { data, error } = await client
        .from("nexra_articles")
        .select(CHECK_ARTICLE_READ_COLUMNS)
        .eq("project_id", projectId)
        .eq("id", articleId)
        .maybeSingle();
      if (error) throw new ArticleStoreError("read article for check", error);
      return data === null ? null : articleRowToArticle(data);
    },

    async getVersion(articleId, version): Promise<StoredArticleVersion | null> {
      const { data, error } = await client
        .from("nexra_article_versions")
        .select(CHECK_VERSION_READ_COLUMNS)
        .eq("article_id", articleId)
        .eq("version", version)
        .maybeSingle();
      if (error) throw new ArticleStoreError("read article version for check", error);
      if (data === null) return null;
      const row = versionRowToVersion(data, []);
      return {
        id: row.id,
        articleId: row.articleId,
        version: row.version,
        origin: row.origin,
        canonicalContent: row.canonicalContent,
        contentSha256: row.contentSha256,
        createdBy: row.createdBy,
        createdAt: row.createdAt,
      };
    },

    async listUnitRecords(articleVersionId) {
      const { data, error } = await client
        .from("nexra_article_check_units")
        .select(CHECK_UNIT_READ_COLUMNS)
        .eq("article_version_id", articleVersionId)
        .order("unit_index", { ascending: true })
        .limit(200);
      if (error) throw new ArticleStoreError("list article check units", error);
      return data.map(unitRowToRecord);
    },

    // One function, one transaction under the parent article's row lock.
    async record(input): Promise<RecordUnitOutcome> {
      const { data, error } = await client.rpc("nexra_article_check_unit_record", {
        p_project_id: input.projectId,
        p_article_id: input.articleId,
        p_article_version: input.articleVersion,
        p_article_version_id: input.articleVersionId,
        p_unit_index: input.unitIndex,
        p_unit_kind: input.unitKind,
        p_unit_key: input.unitKey,
        p_part: input.part,
        p_part_count: input.partCount,
        p_unit_count: input.unitCount,
        p_unit_sha256: input.unitSha256,
        p_status: input.status,
        p_result: input.result,
        p_run_id: input.runId,
        p_recorded_by: input.recordedBy,
      });
      if (error) throw new ArticleStoreError("record article check unit", error);
      return recordResultToOutcome(data);
    },

    // Every version's rows: at most 150 units a version, read in version order.
    async listArticleUnitRecords(articleId) {
      const { data, error } = await client
        .from("nexra_article_check_units")
        .select(CHECK_UNIT_READ_COLUMNS)
        .eq("article_id", articleId)
        .order("article_version", { ascending: true })
        .order("unit_index", { ascending: true })
        .limit(5000);
      if (error) throw new ArticleStoreError("list the article's check units", error);
      return data.map(unitRowToRecord);
    },

    // Fix F8: one function each, one transaction under the parent article's row lock.
    async carry(input): Promise<CarryUnitOutcome> {
      const { data, error } = await client.rpc("nexra_article_check_unit_carry", {
        p_project_id: input.projectId,
        p_article_id: input.articleId,
        p_article_version: input.articleVersion,
        p_article_version_id: input.articleVersionId,
        p_unit_index: input.unitIndex,
        p_unit_kind: input.unitKind,
        p_unit_key: input.unitKey,
        p_part: input.part,
        p_part_count: input.partCount,
        p_unit_count: input.unitCount,
        p_unit_sha256: input.unitSha256,
        p_source_unit_id: input.sourceUnitId,
        p_instructions_sha256: input.instructionsSha256,
        p_evidence_sha256: input.evidenceSha256,
        p_recorded_by: input.recordedBy,
      });
      if (error) throw new ArticleStoreError("carry article check unit", error);
      return carryResultToOutcome(data);
    },

    async fresh(input): Promise<FreshUnitOutcome> {
      const { data, error } = await client.rpc("nexra_article_check_unit_fresh", {
        p_project_id: input.projectId,
        p_article_id: input.articleId,
        p_article_version_id: input.articleVersionId,
        p_unit_index: input.unitIndex,
        p_recorded_by: input.recordedBy,
      });
      if (error) throw new ArticleStoreError("clear carried article check unit", error);
      return freshResultToOutcome(data);
    },
  };
}
