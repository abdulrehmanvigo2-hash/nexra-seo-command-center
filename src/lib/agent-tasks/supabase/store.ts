import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { TASK_READ_DEFAULT_LIMIT, TASK_READ_LIMIT } from "@/lib/agent-tasks/contract";
import type { AgentTaskStore } from "@/lib/agent-tasks/store-contract";
import { createResultToOutcome, TASK_READ_COLUMNS, taskRowToTask, type AgentTasksDatabase } from "@/lib/agent-tasks/supabase/schema";

/**
 * The task store over `nexra_agent_tasks`. A thin translation into Supabase
 * calls: the one database function and the table's constraints enforce the
 * provenance, the agent set, the status and priority sets and the title
 * length again for any caller. The only write is that function; the read is
 * bounded and scoped to one project.
 */

export class AgentTaskStoreError extends Error {
  readonly code: string | null;

  constructor(operation: string, cause: PostgrestError | Error) {
    const code = "code" in cause && typeof cause.code === "string" ? cause.code : null;
    super(`Agent task store: ${operation} failed${code ? ` (${code})` : ""}: ${cause.message}`);
    this.name = "AgentTaskStoreError";
    this.code = code;
  }
}

export function createSupabaseAgentTaskStore(client: SupabaseClient<AgentTasksDatabase>): AgentTaskStore {
  return {
    storesTasks: true,

    async listForProject(filter) {
      const requested = filter.limit ?? TASK_READ_DEFAULT_LIMIT;
      const bounded = Number.isInteger(requested) && requested > 0 ? Math.min(requested, TASK_READ_LIMIT) : TASK_READ_DEFAULT_LIMIT;
      let query = client.from("nexra_agent_tasks").select(TASK_READ_COLUMNS).eq("project_id", filter.projectId);
      if (filter.status !== undefined) query = query.eq("status", filter.status);
      const { data, error } = await query
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(bounded);
      if (error) throw new AgentTaskStoreError("list tasks", error);
      return data.map(taskRowToTask);
    },

    async create(input) {
      const { data, error } = await client.rpc("nexra_agent_task_create", {
        p_project_id: input.projectId,
        p_title: input.title,
        p_source_kind: input.sourceKind,
        p_source_ref: input.sourceRef,
        p_owning_agent: input.owningAgent,
        p_priority: input.priority,
        p_operator: input.operatorId,
      });
      if (error) throw new AgentTaskStoreError("create task", error);
      return createResultToOutcome(data);
    },
  };
}
