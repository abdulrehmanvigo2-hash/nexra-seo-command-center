import "server-only";

import { unavailableArticleApprovalStore } from "@/lib/content/articles/approvals/contract";
import type { ArticleApprovalsDatabase } from "@/lib/content/articles/approvals/supabase/schema";
import { createSupabaseArticleApprovalStore } from "@/lib/content/articles/approvals/supabase/store";
import { unavailableArticleCheckStore } from "@/lib/content/articles/checks/contract";
import type { ArticleChecksDatabase } from "@/lib/content/articles/checks/supabase/schema";
import { createSupabaseArticleCheckStore } from "@/lib/content/articles/checks/supabase/store";
import { unavailableArticleProposalStore } from "@/lib/content/articles/proposals/contract";
import { createArticleProposalService, type ArticleProposalService } from "@/lib/content/articles/proposals/service";
import type { ArticleProposalsDatabase } from "@/lib/content/articles/proposals/supabase/schema";
import { createSupabaseArticleProposalStore } from "@/lib/content/articles/proposals/supabase/store";
import { selectProjectDataSource } from "@/lib/projects/data-source";
import { createSupabaseServerClient, readSupabaseServerConfig } from "@/lib/supabase/server";

/**
 * The server's article proposal service — the one place that wires it.
 *
 * Proposals live beside the articles and approvals they bind: with
 * `PROJECTS_DATA_SOURCE=supabase` in `nexra_article_publication_proposals`,
 * read with the same server-only client and written only through its two
 * database functions. With the fixture roster there is nowhere to keep
 * them, and every call answers `unavailable`. Nothing in this module can
 * reach a repository, a website or a model.
 */

function configuredService(): ArticleProposalService {
  const supabase = selectProjectDataSource(process.env) === "supabase";
  const config = supabase ? readSupabaseServerConfig(process.env) : null;
  return createArticleProposalService({
    store: config ? createSupabaseArticleCheckStore(createSupabaseServerClient<ArticleChecksDatabase>(config)) : unavailableArticleCheckStore,
    approvals: config ? createSupabaseArticleApprovalStore(createSupabaseServerClient<ArticleApprovalsDatabase>(config)) : unavailableArticleApprovalStore,
    proposals: config ? createSupabaseArticleProposalStore(createSupabaseServerClient<ArticleProposalsDatabase>(config)) : unavailableArticleProposalStore,
  });
}

let service: ArticleProposalService | null = null;

export function articleProposalService(): ArticleProposalService {
  service ??= configuredService();
  return service;
}
