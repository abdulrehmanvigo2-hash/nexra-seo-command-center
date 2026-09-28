import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { AgentRunStore } from "@/lib/agent-runs/contract";
import type { AgentRun } from "@/types/agent-run";
import {
  AGENT_RUN_ATTEMPT_READ_COLUMNS,
  AGENT_RUN_READ_COLUMNS,
  agentRunAttemptRowToAttempt,
  agentRunRowToRun,
  claimResultToOutcome,
  finishResultToOutcome,
  heartbeatResultToOutcome,
  newAgentRunInsert,
  recoverResultToAttempts,
  runPatchToUpdate,
  scheduleResultToRetries,
  statusResultToStatus,
  type AgentRunsDatabase,
} from "@/lib/agent-runs/supabase/schema";

/**
 * The agent run store over the Postgres `agent_runs` and `agent_run_attempts`
 * tables and their lease functions.
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

    async listRuns(filter) {
      let query = table().select(AGENT_RUN_READ_COLUMNS);
      if (filter.projectId !== undefined) query = query.eq("project_id", filter.projectId);
      if (filter.agentId !== undefined) query = query.eq("agent_id", filter.agentId);
      const { data, error } = await query
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(filter.offset ?? 0, (filter.offset ?? 0) + filter.limit - 1);
      if (error) throw new AgentRunStoreError("list runs", error);
      return data.map(agentRunRowToRun);
    },

    async listDue(limit) {
      // The claim's own rule (queued, attempts left, due by now) and order
      // (due time, then id). PostgREST cannot order by coalesce or compare two
      // columns, so a bounded read of the oldest queued runs is filtered and
      // sorted here.
      const { data, error } = await table()
        .select(AGENT_RUN_READ_COLUMNS)
        .eq("status", "queued")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(Math.max(limit, 1) * 4);
      if (error) throw new AgentRunStoreError("list due runs", error);
      const nowMs = Date.now();
      const due = (run: AgentRun) => Date.parse(run.nextAttemptAt ?? run.createdAt);
      return data
        .map(agentRunRowToRun)
        .filter((run) => run.attemptCount < run.maxAttempts && due(run) <= nowMs)
        .sort((a, b) => due(a) - due(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .slice(0, limit);
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

    // Claiming, heartbeats, finishing, and recovery are Postgres functions:
    // each is one transaction, judged by the database clock.

    async claim(request) {
      const { data, error } = await client.rpc("agent_run_claim", {
        p_run_id: request.runId,
        p_executor: request.executor,
        p_worker_id: request.workerId,
        p_lease_seconds: request.leaseSeconds,
      });
      if (error) throw new AgentRunStoreError("claim run", error);
      return claimResultToOutcome(data);
    },

    async heartbeat(lease, leaseSeconds) {
      const { data, error } = await client.rpc("agent_run_heartbeat", {
        p_attempt_id: lease.attemptId,
        p_lease_token: lease.token,
        p_lease_seconds: leaseSeconds,
      });
      if (error) throw new AgentRunStoreError("renew lease", error);
      return heartbeatResultToOutcome(data);
    },

    async finish(lease, result) {
      const completed = result.outcome === "completed";
      const { data, error } = await client.rpc("agent_run_finish", {
        p_attempt_id: lease.attemptId,
        p_lease_token: lease.token,
        p_outcome: result.outcome,
        p_result_summary: completed ? result.summary : null,
        p_result_metadata: completed ? result.metadata : null,
        p_error_code: completed ? null : result.error.code,
        p_error_message: completed ? null : result.error.message,
      });
      if (error) throw new AgentRunStoreError(`finish attempt as ${result.outcome}`, error);
      return finishResultToOutcome(data);
    },

    async recoverExpired(limit) {
      const { data, error } = await client.rpc("agent_run_recover_expired", { p_limit: limit });
      if (error) throw new AgentRunStoreError("recover expired attempts", error);
      return recoverResultToAttempts(data);
    },

    async listAttempts(runId) {
      const { data, error } = await client
        .from("agent_run_attempts")
        .select(AGENT_RUN_ATTEMPT_READ_COLUMNS)
        .eq("run_id", runId)
        .order("attempt_number", { ascending: true });
      if (error) throw new AgentRunStoreError("list attempts", error);
      return data.map(agentRunAttemptRowToAttempt);
    },

    async scheduleRetries(limit) {
      const { data, error } = await client.rpc("agent_run_schedule_retries", { p_limit: limit });
      if (error) throw new AgentRunStoreError("schedule retries", error);
      return scheduleResultToRetries(data);
    },

    async runtimeStatus() {
      const { data, error } = await client.rpc("agent_runtime_status", {});
      if (error) throw new AgentRunStoreError("read runtime status", error);
      return statusResultToStatus(data);
    },
  };
}
