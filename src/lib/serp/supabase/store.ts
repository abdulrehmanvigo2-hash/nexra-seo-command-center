import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { finishResultToOutcome, REQUEST_READ_COLUMNS, requestResultToOutcome, requestRowToRequest, RUN_READ_COLUMNS, runRowToRun, type SnapshotsDatabase } from "@/lib/keyword-snapshots/supabase/schema";
import { SnapshotStoreError } from "@/lib/keyword-snapshots/supabase/store";
import { SerpStoreNotSetUpError, type SerpStore } from "@/lib/serp/store-contract";
import {
  resultRowToResult,
  SERP_NOT_SET_UP_CODES,
  SERP_RESULT_READ_COLUMNS,
  SERP_RUN_READ_COLUMNS,
  serpRecordResultToOutcome,
  serpReserveResultToOutcome,
  serpRunRowToRun,
  type SerpDatabase,
} from "@/lib/serp/supabase/schema";

/**
 * The SERP store over migrations 20261016120000 and 20261024120000: the SERP reserve and record functions, F0's
 * request record and finish, and bounded reads. A database without 20261024120000 answers every call with
 * `SerpStoreNotSetUpError`, which the service turns into "not set up".
 */

function refuse(operation: string, error: PostgrestError): never {
  if (SERP_NOT_SET_UP_CODES.includes(error.code) || /schema cache|does not exist/i.test(error.message)) throw new SerpStoreNotSetUpError(operation);
  throw new SnapshotStoreError(operation, error);
}

export function createSupabaseSerpStore(client: SupabaseClient<SerpDatabase>): SerpStore {
  const base = client as unknown as SupabaseClient<SnapshotsDatabase>;
  return {
    storesSerp: true,

    async reserve(input) {
      const { data, error } = await client.rpc("nexra_provider_serp_reserve", {
        p_project_id: input.projectId,
        p_opportunity_id: input.opportunityId,
        p_location_code: input.locationCode,
        p_language_code: input.languageCode,
        p_mode: input.mode,
        p_api_host: input.apiHost,
        p_estimate_usd: input.estimateUsd,
        p_cap_usd: input.capUsd,
        p_requested_by: input.operatorId,
      });
      if (error) refuse("reserve SERP run", error);
      return serpReserveResultToOutcome(data);
    },

    async recordRequest(input) {
      const { data, error } = await base.rpc("nexra_provider_request_record", {
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
      if (typeof data === "object" && data !== null && (data as { outcome?: unknown }).outcome === "endpoint-not-for-kind") return { status: "endpoint-not-for-kind" };
      return requestResultToOutcome(data);
    },

    async recordResults(runId, requestId, rows) {
      const { data, error } = await client.rpc("nexra_provider_serp_record", { p_run_id: runId, p_request_id: requestId, p_rows: rows });
      if (error) refuse("record SERP results", error);
      return serpRecordResultToOutcome(data);
    },

    async finish(input) {
      const { data, error } = await base.rpc("nexra_provider_run_finish", {
        p_run_id: input.runId,
        p_status: input.status,
        p_cost_usd: input.costUsd,
        p_unknown_cost_usd: input.unknownCostUsd,
        p_error_code: input.errorCode,
      });
      if (error) refuse("finish run", error);
      return finishResultToOutcome(data);
    },

    async listRuns(projectId, opportunityId, limit) {
      let query = client.from("nexra_provider_runs").select(SERP_RUN_READ_COLUMNS).eq("project_id", projectId).eq("kind", "serp");
      if (opportunityId !== null) query = query.eq("opportunity_id", opportunityId);
      const { data, error } = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit);
      if (error) refuse("list SERP runs", error);
      return (data ?? []).map(serpRunRowToRun);
    },

    async listRequests(runId) {
      const { data, error } = await base.from("nexra_provider_requests").select(REQUEST_READ_COLUMNS).eq("run_id", runId).order("seq", { ascending: true }).limit(21);
      if (error) refuse("list requests", error);
      return (data ?? []).map(requestRowToRequest);
    },

    async listResults(runId, limit) {
      const { data, error } = await client.from("nexra_serp_results").select(SERP_RESULT_READ_COLUMNS).eq("run_id", runId).order("result_type", { ascending: true }).order("rank", { ascending: true }).limit(limit);
      if (error) refuse("list SERP results", error);
      return (data ?? []).map(resultRowToResult);
    },

    async openRun(projectId) {
      const { data, error } = await base.from("nexra_provider_runs").select(RUN_READ_COLUMNS).eq("project_id", projectId).eq("status", "reserved").order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) refuse("open run", error);
      return data === null ? null : runRowToRun(data);
    },

    async liveSpendToday(at) {
      const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())).toISOString();
      const end = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1)).toISOString();
      const { data, error } = await base.from("nexra_provider_runs").select("estimate_usd, cost_usd, unknown_cost_usd").eq("mode", "live").gte("created_at", start).lt("created_at", end).limit(1_000);
      if (error) refuse("live spend today", error);
      let total = 0;
      for (const row of data ?? []) total += (row.cost_usd === null ? Number(row.estimate_usd) : Number(row.cost_usd)) + Number(row.unknown_cost_usd);
      return Math.round(total * 10_000) / 10_000;
    },
  };
}
