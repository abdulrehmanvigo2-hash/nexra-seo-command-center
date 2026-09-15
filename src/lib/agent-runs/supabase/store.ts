import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { AgentRunStore } from "@/lib/agent-runs/contract";
import {
  AGENT_RUN_READ_COLUMNS,
  agentRunRowToRun,
  newAgentRunInsert,
  runPatchToUpdate,
  type AgentRunsDatabase,
} from "@/lib/agent-runs/supabase/schema";

/**
 * The agent run store over the Postgres `agent_runs` table.
 *
 * A thin translation into Supabase calls. The rules — what may be asked,
 * which transitions are allowed, what an executor may report — live in the
 * service; the table's constraints and trigger enforce the same rules again
 * for any writer that skips it.
 */

/**
 * A query the store could not answer. The message is for server logs only, and
 * leaves out Postgres's `details`, which can quote the offending row's values.
 */
export class AgentRunStoreError extends Error {
  constructor(operation: string, cause: PostgrestError) {
    super(`Agent runs store: ${operation} failed (${cause.code}): ${cause.message}`);
    this.name = "AgentRunStoreError";
  }
}

/** Postgres `unique_violation` and `foreign_key_violation`. */
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

function isDuplicateRequest(error: PostgrestError): boolean {
  return (
    error.code === UNIQUE_VIOLATION &&
    `${error.message} ${error.details ?? ""}`.includes("agent_runs_one_active_request")
  );
}

export function createSupabaseAgentRunStore(
  client: SupabaseClient<AgentRunsDatabase>,
): AgentRunStore {
  const table = () => client.from("agent_runs");

  return {
    storesRuns: true,

    async insert(run) {
      const { data, error } = await table()
        .insert(newAgentRunInsert(run))
        .select(AGENT_RUN_READ_COLUMNS)
        .single();
      if (error) {
        if (isDuplicateRequest(error)) return { status: "duplicate" };
        if (error.code === FOREIGN_KEY_VIOLATION) return { status: "missing-project" };
        throw new AgentRunStoreError("create run", error);
      }
      return { status: "inserted", run: agentRunRowToRun(data) };
    },

    async getById(id) {
      const { data, error } = await table()
        .select(AGENT_RUN_READ_COLUMNS)
        .eq("id", id)
        .maybeSingle();
      if (error) throw new AgentRunStoreError("read run", error);
      return data ? agentRunRowToRun(data) : null;
    },

    async findActiveDuplicate(run) {
      const { data, error } = await table()
        .select(AGENT_RUN_READ_COLUMNS)
        .eq("project_id", run.projectId)
        .eq("agent_id", run.agentId)
        .eq("task_type", run.taskType)
        .eq("input_hash", run.inputHash)
        .in("status", ["queued", "running"])
        .maybeSingle();
      if (error) throw new AgentRunStoreError("find duplicate run", error);
      return data ? agentRunRowToRun(data) : null;
    },

    async listByProject(projectId, limit) {
      const { data, error } = await table()
        .select(AGENT_RUN_READ_COLUMNS)
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw new AgentRunStoreError("list project runs", error);
      return data.map(agentRunRowToRun);
    },

    async listByAgent(agentId, limit) {
      const { data, error } = await table()
        .select(AGENT_RUN_READ_COLUMNS)
        .eq("agent_id", agentId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw new AgentRunStoreError("list agent runs", error);
      return data.map(agentRunRowToRun);
    },

    async transition(id, from, patch) {
      // Conditional on the state the caller last saw: if another request moved
      // the run first, no row matches and nothing changes.
      const { data, error } = await table()
        .update(runPatchToUpdate(patch))
        .eq("id", id)
        .eq("status", from)
        .select(AGENT_RUN_READ_COLUMNS)
        .maybeSingle();
      if (error) {
        if (isDuplicateRequest(error)) return { status: "duplicate" };
        throw new AgentRunStoreError(`move run from ${from} to ${patch.status}`, error);
      }
      return data ? { status: "updated", run: agentRunRowToRun(data) } : { status: "stale" };
    },
  };
}
