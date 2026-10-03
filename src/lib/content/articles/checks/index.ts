import "server-only";

import { agentRunService, evidencePackReadersForRuntime } from "@/lib/agent-runs";
import { unavailableArticleCheckStore } from "@/lib/content/articles/checks/contract";
import { createArticleCheckService, type ArticleCheckService } from "@/lib/content/articles/checks/service";
import type { ArticleChecksDatabase } from "@/lib/content/articles/checks/supabase/schema";
import { createSupabaseArticleCheckStore } from "@/lib/content/articles/checks/supabase/store";
import { selectProjectDataSource } from "@/lib/projects/data-source";
import { createSupabaseServerClient, readSupabaseServerConfig } from "@/lib/supabase/server";

/**
 * The server's article check service — the one place that wires it.
 *
 * Check units live beside the articles they check: with
 * `PROJECTS_DATA_SOURCE=supabase` in `nexra_article_check_units`, read with
 * the same server-only client as the articles and written only through its
 * one database function. With the fixture roster there is nowhere to keep
 * them, and every call answers `unavailable`. Research & Evidence runs are
 * read through the agent-run service, and the evidence pack (for the carry's
 * fingerprint) through the runtime's own readers. Nothing in this module can reach a
 * repository, a website or a model.
 */

function configuredService(): ArticleCheckService {
  const store =
    selectProjectDataSource(process.env) === "supabase"
      ? createSupabaseArticleCheckStore(createSupabaseServerClient<ArticleChecksDatabase>(readSupabaseServerConfig(process.env)))
      : unavailableArticleCheckStore;

  return createArticleCheckService({
    store,
    runs: {
      async getById(id) {
        const result = await agentRunService().getRun(id);
        return result.ok ? result.run : null;
      },
    },
    // Fix F8: a carry whose source rests on a record re-reads the same evidence pack a check reads, to compare.
    evidencePack: evidencePackReadersForRuntime(),
    // M4: and the admitted outside units linked to the article, as checker v4's grounding reads them.
    admittedEvidence: async (projectId, articleId) => (await import("@/lib/evidence")).admittedEvidenceForArticle(projectId, articleId),
  });
}

let service: ArticleCheckService | null = null;

export function articleCheckService(): ArticleCheckService {
  service ??= configuredService();
  return service;
}
