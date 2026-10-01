import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { SnapshotStoreNotSetUpError, type SnapshotStore } from "@/lib/keyword-snapshots/store-contract";
import {
  finishResultToOutcome,
  METRIC_READ_COLUMNS,
  metricRowToMetric,
  metricsResultToOutcome,
  NOT_SET_UP_CODES,
  REQUEST_READ_COLUMNS,
  requestResultToOutcome,
  requestRowToRequest,
  reserveResultToOutcome,
  resumeResultToOutcome,
  RUN_READ_COLUMNS,
  runRowToRun,
  type SnapshotsDatabase,
} from "@/lib/keyword-snapshots/supabase/schema";

/**
 * The provider snapshot store over the three tables of migration
 * 20261016120000. A thin translation into Supabase calls: the five functions
 * and the tables' guards enforce the cap, the one-open-run rule, the shapes
 * and the immutability for any caller. A database on which the migration is
 * not yet applied answers every call with `SnapshotStoreNotSetUpError`, which
 * the service turns into "not set up", never a crash.
 */

export class SnapshotStoreError extends Error {
  readonly code: string | null;

  constructor(operation: string, cause: PostgrestError | Error) {
    const code = "code" in cause && typeof cause.code === "string" ? cause.code : null;
    super(`Keyword snapshot store: ${operation} failed${code ? ` (${code})` : ""}: ${cause.message}`);
    this.name = "SnapshotStoreError";
    this.code = code;
  }
}

function refuse(operation: string, error: PostgrestError): never {
  if (NOT_SET_UP_CODES.includes(error.code) || /schema cache|does not exist/i.test(error.message)) throw new SnapshotStoreNotSetUpError(operation);
  throw new SnapshotStoreError(operation, error);
}

export function createSupabaseSnapshotStore(client: SupabaseClient<SnapshotsDatabase>): SnapshotStore {
  return {
    storesSnapshots: true,

    async reserve(input) {
      const { data, error } = await client.rpc("nexra_provider_run_reserve", {
        p_project_id: input.projectId,
        p_seeds: [...input.seeds],
        p_location_code: input.locationCode,
        p_language_code: input.languageCode,
        p_mode: input.mode,
        p_api_host: input.apiHost,
        p_estimate_usd: input.estimateUsd,
        p_cap_usd: input.capUsd,
        p_requested_by: input.operatorId,
      });
      if (error) refuse("reserve run", error);
      return reserveResultToOutcome(data);
    },

    async recordRequest(input) {
      const { data, error } = await client.rpc("nexra_provider_request_record", {
        p_run_id: input.runId,
        p_seq: input.seq,
        p_endpoint: input.endpoint,
        p_params: input.params,
        p_outcome: input.outcome,
        p_provider_status_code: input.providerStatusCode,
        p_provider_task_id: input.providerTaskId,
        p_cost_usd: input.costUsd,
        p_items: input.items,
        p_response_sha256: input.responseSha256,
        p_sent_at: input.sentAt,
        p_received_at: input.receivedAt,
      });
      if (error) refuse("record request", error);
      return requestResultToOutcome(data);
    },

    async recordMetrics(runId, requestId, rows) {
      const { data, error } = await client.rpc("nexra_provider_metrics_record", { p_run_id: runId, p_request_id: requestId, p_rows: rows });
      if (error) refuse("record metrics", error);
      return metricsResultToOutcome(data);
    },

    async finish(input) {
      const { data, error } = await client.rpc("nexra_provider_run_finish", {
        p_run_id: input.runId,
        p_status: input.status,
        p_cost_usd: input.costUsd,
        p_unknown_cost_usd: input.unknownCostUsd,
        p_error_code: input.errorCode,
      });
      if (error) refuse("finish run", error);
      return finishResultToOutcome(data);
    },

    async resume(runId, estimateUsd, capUsd, operatorId) {
      const { data, error } = await client.rpc("nexra_provider_run_resume", { p_run_id: runId, p_estimate_usd: estimateUsd, p_cap_usd: capUsd, p_requested_by: operatorId });
      if (error) refuse("resume run", error);
      return resumeResultToOutcome(data);
    },

    async getRun(runId) {
      const { data, error } = await client.from("nexra_provider_runs").select(RUN_READ_COLUMNS).eq("id", runId).maybeSingle();
      if (error) refuse("get run", error);
      return data === null ? null : runRowToRun(data);
    },

    async listRuns(projectId, limit) {
      const { data, error } = await client.from("nexra_provider_runs").select(RUN_READ_COLUMNS).eq("project_id", projectId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit);
      if (error) refuse("list runs", error);
      return (data ?? []).map(runRowToRun);
    },

    async listRequests(runId) {
      const { data, error } = await client.from("nexra_provider_requests").select(REQUEST_READ_COLUMNS).eq("run_id", runId).order("seq", { ascending: true }).limit(21);
      if (error) refuse("list requests", error);
      return (data ?? []).map(requestRowToRequest);
    },

    async listMetrics(runId, limit) {
      const { data, error } = await client.from("nexra_keyword_metrics").select(METRIC_READ_COLUMNS).eq("run_id", runId).order("seed", { ascending: true }).order("relation", { ascending: false }).order("keyword", { ascending: true }).limit(limit);
      if (error) refuse("list metrics", error);
      return (data ?? []).map(metricRowToMetric);
    },

    async openRun(projectId) {
      const { data, error } = await client.from("nexra_provider_runs").select(RUN_READ_COLUMNS).eq("project_id", projectId).eq("status", "reserved").order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) refuse("open run", error);
      return data === null ? null : runRowToRun(data);
    },

    async liveSpendToday(at) {
      const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())).toISOString();
      const end = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1)).toISOString();
      const { data, error } = await client.from("nexra_provider_runs").select("estimate_usd, cost_usd, unknown_cost_usd").eq("mode", "live").gte("created_at", start).lt("created_at", end).limit(1_000);
      if (error) refuse("live spend today", error);
      let total = 0;
      for (const row of data ?? []) {
        const estimate = Number(row.estimate_usd), cost = row.cost_usd === null ? null : Number(row.cost_usd), unknown = Number(row.unknown_cost_usd);
        total += (cost ?? estimate) + unknown;
      }
      return Math.round(total * 10_000) / 10_000;
    },
  };
}
