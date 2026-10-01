import type { ApproveVersionOutcome } from "@/lib/content/articles/approvals/contract";
import { ArticleRowError, articleRowToArticle } from "@/lib/content/articles/supabase/schema";
import type { ArticleApproval, ArticleApprovalCarriedUnit } from "@/types/content-article-approval";

/**
 * The shape of `nexra_article_approvals` and of what
 * `nexra_article_approve_version` answers, and the translation into the
 * application's types. The table grants no INSERT, UPDATE or DELETE: the
 * function is the only way in, so no write type exists here. A row that
 * does not match what the migration declares is refused at read time
 * rather than passed on.
 */

export type ArticleApprovalRow = {
  id: string;
  article_id: string;
  article_version: number;
  article_version_id: string;
  content_sha256: string;
  unit_count: number;
  units_sha256: string;
  approved_by: string;
  approved_at: string;
  /** Since 20261010120000 (6.8b); absent on a database the migration has not reached. */
  attested_count?: number;
  attested_confirmed?: boolean;
  /** Since 20261014120000 (F8); absent before it. */
  carried_units?: unknown;
};

type ReadOnly<Row> = { Row: Row; Insert: never; Update: never; Relationships: [] };

export type ArticleApprovalsDatabase = {
  public: {
    Tables: {
      nexra_article_approvals: ReadOnly<ArticleApprovalRow>;
    };
    Views: { [_ in never]: never };
    Functions: {
      nexra_article_approve_version: {
        Args: {
          p_project_id: string;
          p_article_id: string;
          p_article_version: number;
          p_article_version_id: string;
          p_content_sha256: string;
          p_units: unknown;
          p_units_sha256: string;
          p_approved_by: string;
          p_attestation_confirmed?: boolean;
        };
        Returns: unknown;
      };
    };
  };
};

/**
 * Every column: `*` rather than a list, so the same read works before and
 * after 20261010120000 adds the attestation columns (6.8b); a row without
 * them reads as count 0 and no tick.
 */
export const APPROVAL_READ_COLUMNS = "*";

const SHA256 = /^[0-9a-f]{64}$/;

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

function hash(value: unknown, field: string): string {
  const s = text(value, field);
  if (!SHA256.test(s)) throw new ArticleRowError(`${field} is not a SHA-256.`);
  return s;
}

export function approvalRowToApproval(row: unknown): ArticleApproval {
  const r = record(row, "the approval row");
  return {
    id: text(r.id, "id"),
    articleId: text(r.article_id, "article_id"),
    articleVersion: integer(r.article_version, "article_version"),
    articleVersionId: text(r.article_version_id, "article_version_id"),
    contentSha256: hash(r.content_sha256, "content_sha256"),
    unitCount: integer(r.unit_count, "unit_count"),
    unitsSha256: hash(r.units_sha256, "units_sha256"),
    approvedBy: text(r.approved_by, "approved_by"),
    approvedAt: text(r.approved_at, "approved_at"),
    attestedCount: r.attested_count === undefined ? 0 : integer(r.attested_count, "attested_count"),
    attestedConfirmed: r.attested_confirmed === undefined ? false : boolean(r.attested_confirmed, "attested_confirmed"),
    carriedUnits: r.carried_units === undefined ? [] : carriedUnits(r.carried_units),
  };
}

/** The approval's carried units (F8), each field checked; a shape the trigger does not write is an error. */
function carriedUnits(value: unknown): readonly ArticleApprovalCarriedUnit[] {
  if (!Array.isArray(value)) throw new ArticleRowError("carried_units is not an array.");
  return value.map((entry) => {
    const e = record(entry, "a carried unit");
    if (e.basis !== "no-supported" && e.basis !== "evidence-unchanged") throw new ArticleRowError("a carried unit's basis is not recognised.");
    return {
      unitIndex: integer(e.unitIndex, "carried_units.unitIndex"),
      unitKey: text(e.unitKey, "carried_units.unitKey"),
      fromVersion: integer(e.fromVersion, "carried_units.fromVersion"),
      fromUnitId: text(e.fromUnitId, "carried_units.fromUnitId"),
      runId: text(e.runId, "carried_units.runId"),
      basis: e.basis,
    };
  });
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new ArticleRowError(`${field} is not a boolean.`);
  return value;
}

/** What the function answers, checked field by field: a shape it did not promise is an error, not a guess. */
export function approveResultToOutcome(data: unknown): ApproveVersionOutcome {
  const result = record(data, "the function's answer");
  switch (result.outcome) {
    case "approved":
    case "exists":
      return { status: result.outcome, approval: approvalRowToApproval(result.approval), article: articleRowToArticle(result.article) };
    case "not-found":
    case "archived":
    case "stale":
    case "version-not-found":
    case "version-mismatch":
    case "content-mismatch":
    case "status-unexpected":
    case "units-mismatch":
    case "units-not-passed":
    case "units-incomplete":
    case "topic-decision":
    case "unresolved-placeholder":
    case "attestation-unconfirmed":
    case "too-few-supported":
      return { status: result.outcome };
    default:
      throw new ArticleRowError(`the function answered "${String(result.outcome)}", which this product does not recognise.`);
  }
}
