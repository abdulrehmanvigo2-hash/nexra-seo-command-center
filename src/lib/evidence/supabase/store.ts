import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { EvidenceStoreNotSetUpError, type EvidenceStore } from "@/lib/evidence/store-contract";
import { EVIDENCE_NOT_SET_UP_CODES, recordSourceResultToOutcome, SOURCE_READ_COLUMNS, sourceRowToSource, type EvidenceDatabase } from "@/lib/evidence/supabase/schema";

/**
 * The evidence store over migration 20261025120000. A database without it answers every call with
 * `EvidenceStoreNotSetUpError`, which the service turns into "not set up".
 */

export class EvidenceStoreError extends Error {
  constructor(operation: string, cause: PostgrestError) {
    super(`Evidence store: ${operation} failed (${cause.code}): ${cause.message}`);
    this.name = "EvidenceStoreError";
  }
}

export function refuseEvidence(operation: string, error: PostgrestError): never {
  if (EVIDENCE_NOT_SET_UP_CODES.includes(error.code) || /schema cache|does not exist/i.test(error.message)) throw new EvidenceStoreNotSetUpError(operation);
  throw new EvidenceStoreError(operation, error);
}

export function createSupabaseEvidenceStore(client: SupabaseClient<EvidenceDatabase>): EvidenceStore {
  return {
    storesEvidence: true,

    async serpResultUrl(projectId, opportunityId, serpResultId) {
      const { data, error } = await client.from("nexra_serp_results").select("id, project_id, opportunity_id, result_type, url").eq("id", serpResultId).eq("project_id", projectId).eq("opportunity_id", opportunityId).eq("result_type", "organic").maybeSingle();
      if (error) refuseEvidence("read SERP result", error);
      return data?.url ?? null;
    },

    async sourcesToday(opportunityId, at) {
      const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())).toISOString();
      const { count, error } = await client.from("nexra_evidence_sources").select("id", { count: "exact", head: true }).eq("opportunity_id", opportunityId).gte("fetched_at", start);
      if (error) refuseEvidence("count sources", error);
      return count ?? 0;
    },

    async recordSource({ projectId, opportunityId, serpResultId, fetched, operatorId }) {
      const { data, error } = await client.rpc("nexra_evidence_source_record", {
        p_project_id: projectId,
        p_opportunity_id: opportunityId,
        p_serp_result_id: serpResultId,
        p_requested_url: fetched.requestedUrl,
        p_final_url: fetched.finalUrl,
        p_fetch_state: fetched.state,
        p_http_status: fetched.httpStatus,
        p_robots: fetched.robots,
        p_title: fetched.title,
        p_page_text: fetched.state === "fetched" ? fetched.text : null,
        p_operator: operatorId,
      });
      if (error) refuseEvidence("record source", error);
      return recordSourceResultToOutcome(data);
    },

    async listSources(projectId, opportunityId, limit) {
      const { data, error } = await client.from("nexra_evidence_sources").select(SOURCE_READ_COLUMNS).eq("project_id", projectId).eq("opportunity_id", opportunityId).order("fetched_at", { ascending: false }).order("id", { ascending: false }).limit(limit);
      if (error) refuseEvidence("list sources", error);
      return (data ?? []).map(sourceRowToSource);
    },
  };
}
