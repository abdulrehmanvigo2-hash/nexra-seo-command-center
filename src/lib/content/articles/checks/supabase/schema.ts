import type { RecordUnitOutcome } from "@/lib/content/articles/checks/contract";
import { readUnitResult } from "@/lib/content/articles/checks/result";
import { ArticleRowError, articleRowToArticle, type ArticleRow, type ArticleVersionRow } from "@/lib/content/articles/supabase/schema";
import type { ArticleCheckUnitKind, ArticleCheckUnitRecord, ArticleCheckUnitStatus } from "@/types/content-article-check";

/**
 * The shape of `nexra_article_check_units`, of the two article tables as the
 * check store reads them, and of what `nexra_article_check_unit_record`
 * answers — and the translation into the application's types. The table
 * grants no INSERT, UPDATE or DELETE: the function is the only way in, so no
 * write type exists here. A row that does not match what the migration
 * declares is refused at read time rather than passed on.
 */

export type ArticleCheckUnitRow = {
  id: string;
  article_id: string;
  article_version_id: string;
  article_version: number;
  unit_index: number;
  unit_kind: string;
  unit_key: string;
  unit_sha256: string;
  status: string;
  result: unknown;
  checked_by_run_id: string;
  recorded_by: string;
  created_at: string;
  updated_at: string;
};

type ReadOnly<Row> = { Row: Row; Insert: never; Update: never; Relationships: [] };

export type ArticleChecksDatabase = {
  public: {
    Tables: {
      nexra_articles: ReadOnly<ArticleRow>;
      nexra_article_versions: ReadOnly<ArticleVersionRow>;
      nexra_article_check_units: ReadOnly<ArticleCheckUnitRow>;
    };
    Views: { [_ in never]: never };
    Functions: {
      nexra_article_check_unit_record: {
        Args: {
          p_project_id: string;
          p_article_id: string;
          p_article_version: number;
          p_article_version_id: string;
          p_unit_index: number;
          p_unit_kind: string;
          p_unit_key: string;
          p_unit_sha256: string;
          p_status: string;
          p_result: unknown;
          p_run_id: string;
          p_recorded_by: string;
        };
        Returns: unknown;
      };
    };
  };
};

export const CHECK_ARTICLE_READ_COLUMNS =
  "id, project_id, source_plan_run_id, status, current_version, approved_version, approved_by, approved_at, created_by, created_at, updated_at";
export const CHECK_VERSION_READ_COLUMNS = "id, article_id, version, origin, canonical_content, content_sha256, created_by, created_at";
export const CHECK_UNIT_READ_COLUMNS =
  "id, article_id, article_version_id, article_version, unit_index, unit_kind, unit_key, unit_sha256, status, result, checked_by_run_id, recorded_by, created_at, updated_at";

const KINDS: readonly ArticleCheckUnitKind[] = ["metadata", "lead-introduction", "section", "faq", "cta"];
const STATUSES: readonly ArticleCheckUnitStatus[] = ["pending", "passed", "needs-review", "failed"];

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ArticleRowError(`${what} is not an object.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string") throw new ArticleRowError(`${field} is not a string.`);
  return value;
}

function integer(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) throw new ArticleRowError(`${field} is not an integer.`);
  return value;
}

export function unitRowToRecord(row: unknown): ArticleCheckUnitRecord {
  const r = record(row, "the check unit row");
  const kind = KINDS.find((entry) => entry === r.unit_kind);
  if (kind === undefined) throw new ArticleRowError(`unit_kind is "${String(r.unit_kind)}", which this product does not recognise.`);
  const status = STATUSES.find((entry) => entry === r.status);
  if (status === undefined) throw new ArticleRowError(`status is "${String(r.status)}", which this product does not recognise.`);
  let result = null;
  if (status !== "pending") {
    result = readUnitResult(r.result);
    if (result === null || result.status !== status) throw new ArticleRowError("the result does not match its status.");
  } else if (r.result !== null && r.result !== undefined) {
    throw new ArticleRowError("a pending row carries a result.");
  }
  return {
    id: text(r.id, "id"),
    articleId: text(r.article_id, "article_id"),
    articleVersionId: text(r.article_version_id, "article_version_id"),
    articleVersion: integer(r.article_version, "article_version"),
    unitIndex: integer(r.unit_index, "unit_index"),
    unitKind: kind,
    unitKey: text(r.unit_key, "unit_key"),
    unitSha256: text(r.unit_sha256, "unit_sha256"),
    status,
    result,
    checkedByRunId: text(r.checked_by_run_id, "checked_by_run_id"),
    createdAt: text(r.created_at, "created_at"),
    updatedAt: text(r.updated_at, "updated_at"),
  };
}

/** What the function answers, checked field by field: a shape it did not promise is an error, not a guess. */
export function recordResultToOutcome(data: unknown): RecordUnitOutcome {
  const result = record(data, "the function's answer");
  switch (result.outcome) {
    case "recorded":
      return {
        status: "recorded",
        record: unitRowToRecord(result.record),
        article: articleRowToArticle(result.article),
        articleStatusAdvanced: result.article_status_advanced === true,
      };
    case "exists":
      return { status: "exists", record: unitRowToRecord(result.record), article: articleRowToArticle(result.article) };
    case "already-recorded":
      return { status: "already-recorded", record: unitRowToRecord(result.record) };
    case "not-found":
    case "archived":
    case "version-not-found":
    case "version-mismatch":
    case "unit-mismatch":
    case "run-mismatch":
    case "run-state-mismatch":
    case "invalid-result":
      return { status: result.outcome };
    default:
      throw new ArticleRowError(`the function answered "${String(result.outcome)}", which this product does not recognise.`);
  }
}
