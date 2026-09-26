import "server-only";

import { createAgentTaskService, type AgentTaskService } from "@/lib/agent-tasks/service";
import { unavailableAgentTaskStore } from "@/lib/agent-tasks/store-contract";
import type { AgentTasksDatabase } from "@/lib/agent-tasks/supabase/schema";
import { createSupabaseAgentTaskStore } from "@/lib/agent-tasks/supabase/store";
import { selectProjectDataSource } from "@/lib/projects/data-source";
import { appRateLimiter } from "@/lib/security/app-rate-limit";
import type { AsyncRateLimiter } from "@/lib/security/shared-rate-limit";
import { createSupabaseServerClient, readSupabaseServerConfig } from "@/lib/supabase/server";

/**
 * The server's task service — the one place that wires it together. Tasks
 * live beside projects and runs: with `PROJECTS_DATA_SOURCE=supabase` they
 * are kept in `nexra_agent_tasks`; with the fixture roster there is nowhere
 * to keep them and every call answers `unavailable` rather than pretending.
 */

function storesInSupabase(): boolean {
  return selectProjectDataSource(process.env) === "supabase";
}

let service: AgentTaskService | null = null;

export function agentTaskService(): AgentTaskService {
  service ??= createAgentTaskService(
    storesInSupabase()
      ? createSupabaseAgentTaskStore(createSupabaseServerClient<AgentTasksDatabase>(readSupabaseServerConfig(process.env)))
      : unavailableAgentTaskStore,
  );
  return service;
}

type LimitName = "create" | "read";

/** Recording a task is an operator's deliberate act: thirty per operator per ten minutes, as for runs. */
const LIMITS: Record<LimitName, { readonly limit: number; readonly windowSeconds: number }> = {
  create: { limit: 30, windowSeconds: 600 },
  read: { limit: 120, windowSeconds: 600 },
};

export function agentTaskLimiter(name: LimitName): AsyncRateLimiter {
  return appRateLimiter(`agent-tasks.${name}`, LIMITS[name]);
}
