import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ArticleProposalStore } from "@/lib/content/articles/proposals/contract";
import {
  ARTICLE_RESERVATION_COLUMNS,
  DRAFT_RESERVATION_COLUMNS,
  PROPOSAL_READ_COLUMNS,
  articleReservationRow,
  draftReservationRow,
  proposalRowToProposal,
  proposeResultToOutcome,
  withdrawResultToOutcome,
  type ArticleProposalsDatabase,
} from "@/lib/content/articles/proposals/supabase/schema";
import { parseLiveArticles } from "@/lib/content/articles/proposals/live-slugs";
import { ArticleStoreError } from "@/lib/content/articles/supabase/store";

/**
 * The article proposal store over `nexra_article_publication_proposals`
 * (Stage 5, milestone C6, Checkpoint 3).
 *
 * A thin translation into Supabase calls: the rules live in the service, and
 * the two database functions, the guard triggers and the D3 trigger enforce
 * them again for any caller. The only writes are those two functions — the
 * table grants service_role SELECT and nothing else. The draft proposal
 * table is read (active reservations, D3) and never written. Every article
 * proposal read names the project. A failed read throws; it never becomes
 * an empty list.
 */

const HISTORY_LIMIT = 100;

export function createSupabaseArticleProposalStore(client: SupabaseClient<ArticleProposalsDatabase>): ArticleProposalStore {
  return {
    storesProposals: true,

    async listProposals(projectId, articleId) {
      const { data, error } = await client
        .from("nexra_article_publication_proposals")
        .select(PROPOSAL_READ_COLUMNS)
        .eq("project_id", projectId)
        .eq("article_id", articleId)
        .order("created_at", { ascending: false })
        .limit(HISTORY_LIMIT);
      if (error) throw new ArticleStoreError("list article proposals", error);
      return data.map(proposalRowToProposal);
    },

    async getProposal(projectId, proposalId) {
      const { data, error } = await client
        .from("nexra_article_publication_proposals")
        .select(PROPOSAL_READ_COLUMNS)
        .eq("project_id", projectId)
        .eq("id", proposalId)
        .maybeSingle();
      if (error) throw new ArticleStoreError("read article proposal", error);
      return data === null ? null : proposalRowToProposal(data);
    },

    // A destination and slug are one reservation across projects and across both tables (D3).
    async listSlugHolders(destination, slug) {
      const articles = await client
        .from("nexra_article_publication_proposals")
        .select(ARTICLE_RESERVATION_COLUMNS)
        .eq("destination", destination)
        .eq("slug", slug)
        .eq("status", "proposed");
      if (articles.error) throw new ArticleStoreError("list article slug reservations", articles.error);
      const drafts = await client
        .from("nexra_content_publication_proposals")
        .select(DRAFT_RESERVATION_COLUMNS)
        .eq("destination", destination)
        .eq("slug", slug)
        .eq("status", "proposed");
      if (drafts.error) throw new ArticleStoreError("list draft slug reservations", drafts.error);
      return [...articles.data.map(articleReservationRow), ...drafts.data.map(draftReservationRow)];
    },

    // Fix F9: the one list of live articles is the database's; a failed read throws, and the caller blocks.
    async listLiveArticles(destination) {
      const { data, error } = await client.rpc("nexra_article_publication_live_articles", { p_destination: destination });
      if (error) throw new ArticleStoreError("read live articles", error);
      return parseLiveArticles(data);
    },

    // One function, one transaction under the article's row lock and the D3 slug lock.
    async propose(input) {
      const { data, error } = await client.rpc("nexra_article_publication_propose", {
        p_project_id: input.projectId,
        p_article_id: input.articleId,
        p_article_version: input.articleVersion,
        p_article_version_id: input.articleVersionId,
        p_content_sha256: input.contentSha256,
        p_approval_id: input.approvalId,
        p_destination: input.destination,
        p_slug: input.slug,
        p_preview_format: input.previewFormat,
        p_preview_sha256: input.previewSha256,
        p_requested_by: input.requestedBy,
      });
      if (error) throw new ArticleStoreError("propose article publication", error);
      return proposeResultToOutcome(data);
    },

    // One function, under the article's row lock; proposed to withdrawn, never a delete.
    async withdraw(input) {
      const { data, error } = await client.rpc("nexra_article_publication_withdraw", {
        p_project_id: input.projectId,
        p_proposal_id: input.proposalId,
        p_withdrawn_by: input.withdrawnBy,
      });
      if (error) throw new ArticleStoreError("withdraw article publication proposal", error);
      return withdrawResultToOutcome(data);
    },
  };
}
