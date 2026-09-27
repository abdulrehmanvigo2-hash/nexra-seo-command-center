import "server-only";

import { agentRunService } from "@/lib/agent-runs";
import { createAgentTaskService, type AgentTaskService, type HandoffRunCreator, type TaskRunReader } from "@/lib/agent-tasks/service";
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

/**
 * A handoff's one run goes through the same run service the agent-runs
 * routes use — same validation, same duplicate rule, same queue — with the
 * task id as provenance. Resolved lazily so the run service is built only
 * when a handoff happens.
 */
const handoffRuns: HandoffRunCreator = {
  createRun(operatorId, request, options) {
    return agentRunService().createRun(operatorId, request, options);
  },
};

/**
 * The outcome of a handed-off task is read from the same run service, by the
 * run id the task's history recorded (checkpoint 2.2). Read only.
 */
const outcomeRuns: TaskRunReader = {
  getRun(runId) {
    return agentRunService().getRun(runId);
  },
};

export function agentTaskService(): AgentTaskService {
  service ??= createAgentTaskService(
    storesInSupabase()
      ? createSupabaseAgentTaskStore(createSupabaseServerClient<AgentTasksDatabase>(readSupabaseServerConfig(process.env)))
      : unavailableAgentTaskStore,
    storesInSupabase() ? handoffRuns : null,
    storesInSupabase() ? outcomeRuns : null,
  );
  return service;
}

type LimitName = "create" | "read" | "action";

/** Recording or changing a task is an operator's deliberate act: thirty creates and sixty actions per operator per ten minutes, as for runs. */
const LIMITS: Record<LimitName, { readonly limit: number; readonly windowSeconds: number }> = {
  create: { limit: 30, windowSeconds: 600 },
  read: { limit: 120, windowSeconds: 600 },
  action: { limit: 60, windowSeconds: 600 },
};

export function agentTaskLimiter(name: LimitName): AsyncRateLimiter {
  return appRateLimiter(`agent-tasks.${name}`, LIMITS[name]);
}
