import { PROPOSE_REFUSALS, type ProposeArticleOutcome, type WithdrawArticleOutcome } from "@/lib/content/articles/proposals/contract";
import { ArticleRowError } from "@/lib/content/articles/supabase/schema";
import type { ArticleProposalReservation, ArticlePublicationProposal } from "@/types/content-article-proposal";

/**
 * The shape of `nexra_article_publication_proposals`, of the active draft
 * proposals read for D3, and of what `nexra_article_publication_propose` and
 * `nexra_article_publication_withdraw` answer — and the translation into the
 * application's types. Both tables grant no INSERT and no DELETE to
 * service_role, and the article proposal table no UPDATE either: the two
 * functions are the only way in, so no write type exists here. A row or an
 * answer that does not match what the migration declares is refused, never
 * passed on.
 */

export type ArticleProposalRow = {
  id: string;
  project_id: string;
  article_id: string;
  article_version: number;
  article_version_id: string;
  content_sha256: string;
  approval_id: string;
  approved_by: string;
  approved_at: string;
  destination: string;
  slug: string;
  preview_format: string;
  preview_sha256: string;
  status: string;
  requested_by: string;
  withdrawn_by: string | null;
  withdrawn_at: string | null;
  created_at: string;
  updated_at: string;
};

/** The draft proposal columns read for a D3 reservation; the draft table is never written from here. */
export type DraftReservationRow = { id: string; draft_id: string; destination: string; slug: string; status: string };
export type ArticleReservationRow = { id: string; article_id: string; destination: string; slug: string };

type ReadOnly<Row> = { Row: Row; Insert: never; Update: never; Relationships: [] };

export type ArticleProposalsDatabase = {
  public: {
    Tables: {
      nexra_article_publication_proposals: ReadOnly<ArticleProposalRow>;
      nexra_content_publication_proposals: ReadOnly<DraftReservationRow>;
    };
    Views: { [_ in never]: never };
    Functions: {
      nexra_article_publication_propose: {
        Args: {
          p_project_id: string;
          p_article_id: string;
          p_article_version: number;
          p_article_version_id: string;
          p_content_sha256: string;
          p_approval_id: string;
          p_destination: string;
          p_slug: string;
          p_preview_format: string;
          p_preview_sha256: string;
          p_requested_by: string;
        };
        Returns: unknown;
      };
      nexra_article_publication_withdraw: {
        Args: { p_project_id: string; p_proposal_id: string; p_withdrawn_by: string };
        Returns: unknown;
      };
    };
  };
};

export const PROPOSAL_READ_COLUMNS =
  "id, project_id, article_id, article_version, article_version_id, content_sha256, approval_id, approved_by, approved_at, destination, slug, preview_format, preview_sha256, status, requested_by, withdrawn_by, withdrawn_at, created_at, updated_at";
export const ARTICLE_RESERVATION_COLUMNS = "id, article_id, destination, slug";
export const DRAFT_RESERVATION_COLUMNS = "id, draft_id, destination, slug";

const SHA256 = /^[0-9a-f]{64}$/;

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ArticleRowError(`${what} is not an object.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new ArticleRowError(`${field} is not a non-empty string.`);
  return value;
}

function nullableText(value: unknown, field: string): string | null {
  return value === null ? null : text(value, field);
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

export function proposalRowToProposal(row: unknown): ArticlePublicationProposal {
  const r = record(row, "the proposal row");
  if (r.preview_format !== "article-proposal-text/1" && r.preview_format !== "article-proposal-text/2") throw new ArticleRowError("preview_format is not article-proposal-text/1 or /2.");
  if (r.status !== "proposed" && r.status !== "withdrawn") throw new ArticleRowError("status is not proposed or withdrawn.");
  const withdrawnBy = nullableText(r.withdrawn_by, "withdrawn_by");
  const withdrawnAt = nullableText(r.withdrawn_at, "withdrawn_at");
  if ((r.status === "withdrawn") !== (withdrawnBy !== null && withdrawnAt !== null) || (withdrawnBy === null) !== (withdrawnAt === null)) {
    throw new ArticleRowError("the withdrawal fields do not match the status.");
  }
  return {
    id: text(r.id, "id"),
    projectId: text(r.project_id, "project_id"),
    articleId: text(r.article_id, "article_id"),
    articleVersion: integer(r.article_version, "article_version"),
    articleVersionId: text(r.article_version_id, "article_version_id"),
    contentSha256: hash(r.content_sha256, "content_sha256"),
    approvalId: text(r.approval_id, "approval_id"),
    approvedBy: text(r.approved_by, "approved_by"),
    approvedAt: text(r.approved_at, "approved_at"),
    destination: text(r.destination, "destination"),
    slug: text(r.slug, "slug"),
    previewFormat: r.preview_format,
    previewSha256: hash(r.preview_sha256, "preview_sha256"),
    status: r.status,
    requestedBy: text(r.requested_by, "requested_by"),
    withdrawnBy,
    withdrawnAt,
    createdAt: text(r.created_at, "created_at"),
    updatedAt: text(r.updated_at, "updated_at"),
  };
}

export function articleReservationRow(row: unknown): ArticleProposalReservation {
  const r = record(row, "the article proposal reservation");
  return { kind: "article", proposalId: text(r.id, "id"), articleId: text(r.article_id, "article_id"), destination: text(r.destination, "destination"), slug: text(r.slug, "slug") };
}

export function draftReservationRow(row: unknown): ArticleProposalReservation {
  const r = record(row, "the draft proposal reservation");
  return { kind: "draft", proposalId: text(r.id, "id"), draftId: text(r.draft_id, "draft_id"), destination: text(r.destination, "destination"), slug: text(r.slug, "slug") };
}

const REFUSALS: ReadonlySet<string> = new Set(PROPOSE_REFUSALS);

/** What the propose function answers, checked field by field: an outcome it did not promise is an error, not a guess. */
export function proposeResultToOutcome(data: unknown): ProposeArticleOutcome {
  const result = record(data, "the function's answer");
  const outcome = result.outcome;
  if (outcome === "created" || outcome === "exists" || outcome === "active-exists") {
    return { status: outcome, proposal: proposalRowToProposal(result.proposal) };
  }
  if (typeof outcome === "string" && REFUSALS.has(outcome)) return { status: outcome as (typeof PROPOSE_REFUSALS)[number] };
  throw new ArticleRowError(`the propose function answered "${String(outcome)}", which this product does not recognise.`);
}

/** What the withdraw function answers. */
export function withdrawResultToOutcome(data: unknown): WithdrawArticleOutcome {
  const result = record(data, "the function's answer");
  switch (result.outcome) {
    case "withdrawn":
    case "already-withdrawn": {
      const proposal = proposalRowToProposal(result.proposal);
      if (proposal.status !== "withdrawn") throw new ArticleRowError("a withdrawal answered a proposal that is not withdrawn.");
      return { status: result.outcome, proposal };
    }
    case "not-found":
      return { status: "not-found" };
    default:
      throw new ArticleRowError(`the withdraw function answered "${String(result.outcome)}", which this product does not recognise.`);
  }
}
