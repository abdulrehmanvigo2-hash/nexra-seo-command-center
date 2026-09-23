import "server-only";

import { agentRunService } from "@/lib/agent-runs";
import { unavailableArticleStore } from "@/lib/content/articles/contract";
import { createArticleService, type ArticleService } from "@/lib/content/articles/service";
import type { ContentArticlesDatabase } from "@/lib/content/articles/supabase/schema";
import { createSupabaseArticleStore } from "@/lib/content/articles/supabase/store";
import { selectProjectDataSource } from "@/lib/projects/data-source";
import { createSupabaseServerClient, readSupabaseServerConfig } from "@/lib/supabase/server";

/**
 * The server's article service — the one place that wires it.
 *
 * Articles live beside the drafts they cite: with
 * `PROJECTS_DATA_SOURCE=supabase` in the three `nexra_article` tables, read
 * with the same server-only client and secret key as the drafts, and written
 * only through their two database functions. With the fixture roster there
 * is nowhere to keep them, and every call answers `unavailable`. Content plan
 * runs are read through the agent-run service. No other credential exists
 * here: nothing in this module can reach a repository, a website or a model.
 */

function configuredService(): ArticleService {
  const store =
    selectProjectDataSource(process.env) === "supabase"
      ? createSupabaseArticleStore(createSupabaseServerClient<ContentArticlesDatabase>(readSupabaseServerConfig(process.env)))
      : unavailableArticleStore;

  return createArticleService({
    store,
    runs: {
      async getById(id) {
        const result = await agentRunService().getRun(id);
        return result.ok ? result.run : null;
      },
      async listStrategistRuns(projectId, limit) {
        const result = await agentRunService().listRuns({ projectId, agentId: "content-strategist", limit });
        return result.ok ? result.runs : [];
      },
    },
  });
}

let service: ArticleService | null = null;

export function articleService(): ArticleService {
  service ??= configuredService();
  return service;
}
