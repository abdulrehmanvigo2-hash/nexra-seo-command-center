import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ArticleApprovalStore, ApproveVersionOutcome } from "@/lib/content/articles/approvals/contract";
import { APPROVAL_READ_COLUMNS, approvalRowToApproval, approveResultToOutcome, type ArticleApprovalsDatabase } from "@/lib/content/articles/approvals/supabase/schema";
import { ArticleStoreError } from "@/lib/content/articles/supabase/store";

/**
 * The article approval store over `nexra_article_approvals`.
 *
 * A thin translation into Supabase calls: the rules live in the service,
 * and the one database function and the guard triggers enforce them again
 * for any caller. The only write is that function — the table grants
 * service_role SELECT and nothing else, and the article tables are never
 * written from here.
 */

export function createSupabaseArticleApprovalStore(client: SupabaseClient<ArticleApprovalsDatabase>): ArticleApprovalStore {
  return {
    storesApprovals: true,

    async listApprovals(articleId) {
      const { data, error } = await client
        .from("nexra_article_approvals")
        .select(APPROVAL_READ_COLUMNS)
        .eq("article_id", articleId)
        .order("article_version", { ascending: false })
        .limit(100);
      if (error) throw new ArticleStoreError("list article approvals", error);
      return data.map(approvalRowToApproval);
    },

    // One function, one transaction under the parent article's row lock.
    async approve(input): Promise<ApproveVersionOutcome> {
      const { data, error } = await client.rpc("nexra_article_approve_version", {
        p_project_id: input.projectId,
        p_article_id: input.articleId,
        p_article_version: input.articleVersion,
        p_article_version_id: input.articleVersionId,
        p_content_sha256: input.contentSha256,
        p_units: input.units.map((u) => ({ index: u.index, key: u.key, sha256: u.sha256 })),
        p_units_sha256: input.unitsSha256,
        p_approved_by: input.approvedBy,
        // Named only for a version that attests paragraphs: a database without
        // 20261010120000 has the eight-parameter function, which a call naming
        // the tick would not find, so every other approval works before and after it.
        ...(input.attestationConfirmed === undefined ? {} : { p_attestation_confirmed: input.attestationConfirmed }),
      });
      if (error) throw new ArticleStoreError("approve article version", error);
      return approveResultToOutcome(data);
    },
  };
}
