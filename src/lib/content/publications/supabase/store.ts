import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { PublicationProposalStore } from "@/lib/content/publications/contract";
import {
  PUBLICATION_PROPOSAL_READ_COLUMNS,
  proposalRowToProposal,
  proposeResultToOutcome,
  type ContentPublicationsDatabase,
} from "@/lib/content/publications/supabase/schema";

/**
 * The proposal store over `nexra_content_publication_proposals`.
 *
 * A thin translation into Supabase calls: the rules live in the service,
 * and the database function and guard triggers enforce them again for any
 * writer that skips it. Creation is the function alone — the table grants
 * no INSERT — and withdrawal is one conditional UPDATE of the status and
 * the withdrawer. Every read names the project and the draft as well as
 * the id. Nothing here reaches anything outside the database.
 */

export class PublicationProposalStoreError extends Error {
  constructor(operation: string, cause: PostgrestError | Error) {
    const detail = "code" in cause ? `(${cause.code}): ${cause.message}` : cause.message;
    super(`Publication proposal store: ${operation} failed ${detail}`);
    this.name = "PublicationProposalStoreError";
  }
}

const TABLE = "nexra_content_publication_proposals";

export function createSupabaseProposalStore(client: SupabaseClient<ContentPublicationsDatabase>): PublicationProposalStore {
  return {
    storesProposals: true,

    async findActiveForDraft(projectId, draftId) {
      const { data, error } = await client
        .from(TABLE)
        .select(PUBLICATION_PROPOSAL_READ_COLUMNS)
        .eq("project_id", projectId)
        .eq("draft_id", draftId)
        .eq("status", "proposed")
        .maybeSingle();
      if (error) throw new PublicationProposalStoreError("find active proposal", error);
      return data === null ? null : proposalRowToProposal(data);
    },

    async listForDraft(projectId, draftId, limit) {
      const { data, error } = await client
        .from(TABLE)
        .select(PUBLICATION_PROPOSAL_READ_COLUMNS)
        .eq("project_id", projectId)
        .eq("draft_id", draftId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw new PublicationProposalStoreError("list proposals", error);
      return data.map(proposalRowToProposal);
    },

    async getById(projectId, draftId, proposalId) {
      const { data, error } = await client
        .from(TABLE)
        .select(PUBLICATION_PROPOSAL_READ_COLUMNS)
        .eq("project_id", projectId)
        .eq("draft_id", draftId)
        .eq("id", proposalId)
        .maybeSingle();
      if (error) throw new PublicationProposalStoreError("read proposal", error);
      return data === null ? null : proposalRowToProposal(data);
    },

    // One function, one transaction, under the draft's row lock: every
    // condition is re-checked against the locked rows, and the hash is
    // recomputed from the stored text.
    async create(input) {
      const { data, error } = await client.rpc("nexra_content_publication_propose", {
        p_project_id: input.projectId,
        p_draft_id: input.draftId,
        p_version: input.version,
        p_version_id: input.versionId,
        p_content_sha256: input.contentSha256,
        p_approved_by: input.approvedBy,
        p_approved_at: input.approvedAt,
        p_destination: input.destination,
        p_slug: input.slug,
        p_preview_format: input.previewFormat,
        p_preview_sha256: input.previewSha256,
        p_requested_by: input.requestedBy,
      });
      if (error) throw new PublicationProposalStoreError("create proposal", error);
      const outcome = proposeResultToOutcome(data);
      switch (outcome.outcome) {
        case "created":
        case "exists":
          return { status: outcome.outcome, proposal: outcome.proposal };
        case "stale":
          return { status: "stale", currentVersion: outcome.currentVersion };
        case "ineligible":
          return { status: "ineligible", reason: outcome.reason };
        default:
          return { status: outcome.outcome };
      }
    },

    // One statement, conditional on the proposal still being active: a
    // second withdrawal, or a concurrent one, matches no row. The patch is
    // the status and the withdrawer; the time is the database's.
    async withdraw(input) {
      const { data, error } = await client
        .from(TABLE)
        .update({ status: "withdrawn", withdrawn_by: input.withdrawnBy })
        .eq("id", input.proposalId)
        .eq("project_id", input.projectId)
        .eq("draft_id", input.draftId)
        .eq("status", "proposed")
        .select(PUBLICATION_PROPOSAL_READ_COLUMNS);
      if (error) throw new PublicationProposalStoreError("withdraw proposal", error);
      return data.length === 1 ? { status: "withdrawn", proposal: proposalRowToProposal(data[0]) } : { status: "unchanged" };
    },
  };
}
