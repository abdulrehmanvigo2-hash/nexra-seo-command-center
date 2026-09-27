import "server-only";

import { agentTaskService } from "@/lib/agent-tasks";
import { observedHistoryFor } from "@/lib/keywords/observed";
import { createKeywordService, type KeywordService } from "@/lib/keywords/service";
import { unavailableKeywordStore } from "@/lib/keywords/store-contract";
import type { KeywordsDatabase } from "@/lib/keywords/supabase/schema";
import { createSupabaseKeywordStore } from "@/lib/keywords/supabase/store";
import { selectProjectDataSource } from "@/lib/projects/data-source";
import { projectRepository } from "@/lib/projects/repository";
import { searchConsoleProperties } from "@/lib/search-console";
import { readKeywordIntelligence } from "@/lib/search-console/keywords";
import { searchConsoleQueryPageStore } from "@/lib/search-console/query-pages";
import { QUERY_PAGE_LIST_LIMIT, QUERY_PAGE_RANGE_ID } from "@/lib/search-console/query-pages/contract";
import { searchConsoleSnapshotStore } from "@/lib/search-console/snapshots";
import { SNAPSHOT_LIST_LIMIT, SNAPSHOT_RANGE_ID } from "@/lib/search-console/snapshots/contract";
import { appRateLimiter } from "@/lib/security/app-rate-limit";
import type { AsyncRateLimiter } from "@/lib/security/shared-rate-limit";
import { createSupabaseServerClient, readSupabaseServerConfig } from "@/lib/supabase/server";

/**
 * The server's curated keyword service — the one place that wires it. With
 * `PROJECTS_DATA_SOURCE=supabase` keywords are kept in `nexra_keywords`; with
 * the fixture roster there is nowhere to keep them and every call answers
 * `unavailable`. The observed rows are read through the existing bounded
 * Search Console stores, the tasks through the task service; neither is
 * written. Nothing here is read by an agent (decision Q6).
 */

let service: KeywordService | null = null;

export function keywordService(): KeywordService {
  const inSupabase = selectProjectDataSource(process.env) === "supabase";
  service ??= createKeywordService(
    inSupabase ? createSupabaseKeywordStore(createSupabaseServerClient<KeywordsDatabase>(readSupabaseServerConfig(process.env))) : unavailableKeywordStore,
    {
      observed: {
        inventory: (projectId) => readKeywordIntelligence(projectId),
        async history(projectId, query) {
          const snapshots = searchConsoleSnapshotStore();
          if (!snapshots.storesSnapshots) return null;
          const pairStore = searchConsoleQueryPageStore();
          const [rows, pairs] = await Promise.all([
            snapshots.listSnapshots(projectId, SNAPSHOT_RANGE_ID, SNAPSHOT_LIST_LIMIT),
            pairStore.storesQueryPages ? pairStore.listQueryPages(projectId, QUERY_PAGE_RANGE_ID, QUERY_PAGE_LIST_LIMIT) : Promise.resolve([]),
          ]);
          return observedHistoryFor(query, { snapshots: rows, pairs, pairsReadLimit: QUERY_PAGE_LIST_LIMIT, currentProperty: searchConsoleProperties().get(projectId) ?? "" });
        },
      },
      tasks: {
        async tasksForQuery(projectId, query) {
          const result = await agentTaskService().listTasks({ projectId, limit: 100 });
          if (result.status === "unavailable") return null;
          return result.tasks.filter((task) => task.sourceKind === "keyword" && task.sourceRef === query);
        },
      },
      projects: {
        async get(projectId) {
          const project = await projectRepository.getProjectById(projectId);
          return project === null ? null : { id: project.id, name: project.name, domain: project.domain };
        },
      },
    },
  );
  return service;
}

type LimitName = "read" | "write";

/** Curating is an operator's deliberate act: sixty writes per operator per ten minutes, as for task actions. */
const LIMITS: Record<LimitName, { readonly limit: number; readonly windowSeconds: number }> = {
  read: { limit: 120, windowSeconds: 600 },
  write: { limit: 60, windowSeconds: 600 },
};

export function keywordLimiter(name: LimitName): AsyncRateLimiter {
  return appRateLimiter(`keywords.${name}`, LIMITS[name]);
}
