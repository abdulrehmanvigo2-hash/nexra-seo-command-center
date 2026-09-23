import "server-only";

import { unavailableArticleApprovalStore } from "@/lib/content/articles/approvals/contract";
import { createArticleApprovalService, type ArticleApprovalService } from "@/lib/content/articles/approvals/service";
import type { ArticleApprovalsDatabase } from "@/lib/content/articles/approvals/supabase/schema";
import { createSupabaseArticleApprovalStore } from "@/lib/content/articles/approvals/supabase/store";
import { articleCheckService } from "@/lib/content/articles/checks";
import { unavailableArticleCheckStore } from "@/lib/content/articles/checks/contract";
import type { ArticleChecksDatabase } from "@/lib/content/articles/checks/supabase/schema";
import { createSupabaseArticleCheckStore } from "@/lib/content/articles/checks/supabase/store";
import { selectProjectDataSource } from "@/lib/projects/data-source";
import { createSupabaseServerClient, readSupabaseServerConfig } from "@/lib/supabase/server";

/**
 * The server's article approval service — the one place that wires it.
 *
 * Approvals live beside the articles and check units they bind: with
 * `PROJECTS_DATA_SOURCE=supabase` in `nexra_article_approvals`, read with
 * the same server-only client and written only through its one database
 * function. With the fixture roster there is nowhere to keep them, and
 * every call answers `unavailable`. Nothing in this module can reach a
 * repository, a website or a model.
 */

function configuredService(): ArticleApprovalService {
  const supabase = selectProjectDataSource(process.env) === "supabase";
  const config = supabase ? readSupabaseServerConfig(process.env) : null;
  return createArticleApprovalService({
    store: config ? createSupabaseArticleCheckStore(createSupabaseServerClient<ArticleChecksDatabase>(config)) : unavailableArticleCheckStore,
    checks: articleCheckService(),
    approvals: config ? createSupabaseArticleApprovalStore(createSupabaseServerClient<ArticleApprovalsDatabase>(config)) : unavailableArticleApprovalStore,
  });
}

let service: ArticleApprovalService | null = null;

export function articleApprovalService(): ArticleApprovalService {
  service ??= configuredService();
  return service;
}
