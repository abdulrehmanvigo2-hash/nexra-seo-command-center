import type { PublicationPreviewFormat, PublicationProposal, PublicationProposalStatus } from "@/types/content-publication";

/**
 * The shape of `public.nexra_content_publication_proposals` and of what
 * `nexra_content_publication_propose` answers, and the translation into the
 * application's types. The typed client refuses any other table at compile
 * time; a row that does not match what the migration declares is refused at
 * read time rather than passed on.
 */

export class PublicationProposalRowError extends Error {
  constructor(message: string) {
    super(`Publication proposal row: ${message}`);
    this.name = "PublicationProposalRowError";
  }
}

export type PublicationProposalRow = {
  id: string;
  project_id: string;
  draft_id: string;
  version: number;
  version_id: string;
  content_sha256: string;
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

export type ProposeArgs = {
  p_project_id: string;
  p_draft_id: string;
  p_version: number;
  p_version_id: string;
  p_content_sha256: string;
  p_approved_by: string;
  p_approved_at: string;
  p_destination: string;
  p_slug: string;
  p_preview_format: string;
  p_preview_sha256: string;
  p_requested_by: string;
};

export type ContentPublicationsDatabase = {
  public: {
    Tables: {
      nexra_content_publication_proposals: {
        Row: PublicationProposalRow;
        // No direct insert: the table grants none, and the function is the only way in.
        Insert: never;
        // Withdrawal only: the database sets the time, and the guard trigger refuses any change to the binding.
        Update: Pick<PublicationProposalRow, "status" | "withdrawn_by">;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      nexra_content_publication_propose: {
        Args: ProposeArgs;
        Returns: unknown;
      };
    };
  };
};

export const PUBLICATION_PROPOSAL_READ_COLUMNS =
  "id, project_id, draft_id, version, version_id, content_sha256, approved_by, approved_at, destination, slug, preview_format, preview_sha256, status, requested_by, withdrawn_by, withdrawn_at, created_at, updated_at";

const STATUSES: readonly PublicationProposalStatus[] = ["proposed", "withdrawn"];
const PREVIEW_FORMATS: readonly PublicationPreviewFormat[] = ["draft-section-text/1"];

function oneOf<T extends string>(allowed: readonly T[], value: unknown, field: string): T {
  const found = allowed.find((entry) => entry === value);
  if (found === undefined) throw new PublicationProposalRowError(`${field} is "${String(value)}", which this product does not recognise.`);
  return found;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string") throw new PublicationProposalRowError(`${field} is not a string.`);
  return value;
}

function textOrNull(value: unknown, field: string): string | null {
  return value === null || value === undefined ? null : text(value, field);
}

export function proposalRowToProposal(row: unknown): PublicationProposal {
  if (typeof row !== "object" || row === null || Array.isArray(row)) throw new PublicationProposalRowError("the row is not an object.");
  const r = row as Record<string, unknown>;
  if (typeof r.version !== "number" || !Number.isInteger(r.version)) throw new PublicationProposalRowError("version is not an integer.");
  return {
    id: text(r.id, "id"),
    projectId: text(r.project_id, "project_id"),
    draftId: text(r.draft_id, "draft_id"),
    version: r.version,
    versionId: text(r.version_id, "version_id"),
    contentSha256: text(r.content_sha256, "content_sha256"),
    approvedBy: text(r.approved_by, "approved_by"),
    approvedAt: text(r.approved_at, "approved_at"),
    destination: text(r.destination, "destination"),
    slug: text(r.slug, "slug"),
    previewFormat: oneOf(PREVIEW_FORMATS, r.preview_format, "preview_format"),
    previewSha256: text(r.preview_sha256, "preview_sha256"),
    status: oneOf(STATUSES, r.status, "status"),
    requestedBy: text(r.requested_by, "requested_by"),
    withdrawnBy: textOrNull(r.withdrawn_by, "withdrawn_by"),
    withdrawnAt: textOrNull(r.withdrawn_at, "withdrawn_at"),
    createdAt: text(r.created_at, "created_at"),
    updatedAt: text(r.updated_at, "updated_at"),
  };
}

export type ProposeRpcOutcome =
  | { readonly outcome: "created" | "exists"; readonly proposal: PublicationProposal }
  | { readonly outcome: "not-found" | "version-not-found" | "content-mismatch" | "slug-taken" }
  | { readonly outcome: "stale"; readonly currentVersion: number }
  | { readonly outcome: "ineligible"; readonly reason: "fact-check-not-passed" | "unresolved-placeholders" };

/** What the function answers, checked field by field: a shape it did not promise is an error, not a guess. */
export function proposeResultToOutcome(data: unknown): ProposeRpcOutcome {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new PublicationProposalRowError("propose answered with something other than an object.");
  }
  const result = data as Record<string, unknown>;
  switch (result.outcome) {
    case "created":
    case "exists":
      return { outcome: result.outcome, proposal: proposalRowToProposal(result.proposal) };
    case "not-found":
    case "version-not-found":
    case "content-mismatch":
    case "slug-taken":
      return { outcome: result.outcome };
    case "stale": {
      const current = result.current_version;
      if (typeof current !== "number") throw new PublicationProposalRowError("propose reported stale without the current version.");
      return { outcome: "stale", currentVersion: current };
    }
    case "ineligible":
      if (result.reason === "fact-check-not-passed" || result.reason === "unresolved-placeholders") {
        return { outcome: "ineligible", reason: result.reason };
      }
      throw new PublicationProposalRowError(`propose refused for "${String(result.reason)}", which this product does not recognise.`);
    default:
      throw new PublicationProposalRowError(`propose answered "${String(result.outcome)}", which this product does not recognise.`);
  }
}
