import "server-only";

import { unavailableAgentRunStore } from "@/lib/agent-runs/contract";
import { mockAgentExecutor } from "@/lib/agent-runs/mock-executor";
import { createAgentRunService, type AgentRunService } from "@/lib/agent-runs/service";
import type { AgentRunsDatabase } from "@/lib/agent-runs/supabase/schema";
import { createSupabaseAgentRunStore } from "@/lib/agent-runs/supabase/store";
import { selectProjectDataSource } from "@/lib/projects/data-source";
import { projectRepository } from "@/lib/projects/repository";
import { createSupabaseServerClient, readSupabaseServerConfig } from "@/lib/supabase/server";

/**
 * The server's agent runtime — the one place that wires it together.
 *
 * Runs live beside projects: with `PROJECTS_DATA_SOURCE=supabase` they are
 * kept in the `agent_runs` table, whose rows reference stored projects. With
 * the mock roster there is nowhere to keep them, and every call answers
 * `unavailable` rather than pretending.
 *
 * The executor is the mock executor, always, in this milestone. Nothing here
 * reaches a model, a crawler, or a third party. Each server process gets one
 * random worker label and the default lease: 60 seconds, renewed every 15
 * (`@/lib/agent-runs/worker`).
 *
 * Server-only: route handlers call it after confirming the operator.
 */
function configuredService(): AgentRunService {
  const store =
    selectProjectDataSource(process.env) === "supabase"
      ? createSupabaseAgentRunStore(
          createSupabaseServerClient<AgentRunsDatabase>(readSupabaseServerConfig(process.env)),
        )
      : unavailableAgentRunStore;

  return createAgentRunService({
    store,
    executor: mockAgentExecutor,
    projects: projectRepository,
  });
}

let service: AgentRunService | null = null;

export function agentRunService(): AgentRunService {
  service ??= configuredService();
  return service;
}
