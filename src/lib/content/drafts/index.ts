import "server-only";

import { agentRunService } from "@/lib/agent-runs";
import { unavailableDraftStore } from "@/lib/content/drafts/contract";
import { createDraftService, type DraftService } from "@/lib/content/drafts/service";
import type { ContentDraftsDatabase } from "@/lib/content/drafts/supabase/schema";
import { createSupabaseDraftStore } from "@/lib/content/drafts/supabase/store";
import { selectProjectDataSource } from "@/lib/projects/data-source";
import { createSupabaseServerClient, readSupabaseServerConfig } from "@/lib/supabase/server";

/**
 * The server's draft service — the one place that wires it together.
 *
 * Drafts live beside projects, crawls and agent runs: with
 * `PROJECTS_DATA_SOURCE=supabase` they are kept in the two draft tables,
 * whose rows reference stored projects and runs. With the fixture roster
 * there is nowhere to keep them and every call answers `unavailable` rather
 * than holding a draft that would vanish. The Writer run is read through
 * the agent-run service, from the same store the runtime keeps its runs in.
 */

function configuredService(): DraftService {
  const store =
    selectProjectDataSource(process.env) === "supabase"
      ? createSupabaseDraftStore(
          createSupabaseServerClient<ContentDraftsDatabase>(readSupabaseServerConfig(process.env)),
        )
      : unavailableDraftStore;

  return createDraftService({
    store,
    runs: {
      async getById(id) {
        const result = await agentRunService().getRun(id);
        return result.ok ? result.run : null;
      },
    },
  });
}

let service: DraftService | null = null;

export function draftService(): DraftService {
  service ??= configuredService();
  return service;
}
