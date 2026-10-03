import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { EvidenceStoreNotSetUpError, type EvidenceStore } from "@/lib/evidence/store-contract";
import {
  decideResultToOutcome,
  EVIDENCE_NOT_SET_UP_CODES,
  recordSourceResultToOutcome,
  recordUnitsResultToOutcome,
  SOURCE_READ_COLUMNS,
  sourceRowToSource,
  UNIT_READ_COLUMNS,
  unitRowToUnit,
  type EvidenceDatabase,
} from "@/lib/evidence/supabase/schema";

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

    async sourceForExtraction(projectId, sourceId) {
      const { data, error } = await client.from("nexra_evidence_sources").select(SOURCE_READ_COLUMNS).eq("id", sourceId).eq("project_id", projectId).maybeSingle();
      if (error) refuseEvidence("read source", error);
      if (data === null || data.page_text === null) return null;
      const opportunity = await client.from("nexra_opportunities").select("id, project_id, cluster_id, title").eq("id", data.opportunity_id).eq("project_id", projectId).maybeSingle();
      if (opportunity.error) refuseEvidence("read opportunity", opportunity.error);
      if (opportunity.data === null) return null;
      const cluster = await client.from("nexra_topic_clusters").select("id, primary_keyword").eq("id", opportunity.data.cluster_id).maybeSingle();
      if (cluster.error) refuseEvidence("read cluster", cluster.error);
      const topic = cluster.data === null ? opportunity.data.title : `${opportunity.data.title} — ${cluster.data.primary_keyword}`;
      return { source: sourceRowToSource(data), text: data.page_text, topic };
    },

    async extractRun(projectId, runId) {
      const { data, error } = await client.from("agent_runs").select("id, project_id, agent_id, task_type, status, executor, input, result_summary").eq("id", runId).eq("project_id", projectId).maybeSingle();
      if (error) refuseEvidence("read run", error);
      if (data === null) return null;
      const input = typeof data.input === "object" && data.input !== null ? (data.input as Record<string, unknown>) : {};
      return {
        id: data.id, projectId: data.project_id, agentId: data.agent_id, taskType: data.task_type, status: data.status, executor: data.executor,
        sourceId: typeof input.sourceId === "string" ? input.sourceId : null, summary: data.result_summary,
      };
    },

    async recordUnits(projectId, sourceId, runId, units, operatorId) {
      const { data, error } = await client.rpc("nexra_evidence_units_record", { p_project_id: projectId, p_source_id: sourceId, p_run_id: runId, p_units: units, p_operator: operatorId });
      if (error) refuseEvidence("record units", error);
      return recordUnitsResultToOutcome(data);
    },

    async listUnits(projectId, sourceId, limit) {
      const { data, error } = await client.from("nexra_evidence_units").select(UNIT_READ_COLUMNS).eq("project_id", projectId).eq("source_id", sourceId).order("recorded_at", { ascending: false }).order("position", { ascending: true }).limit(limit);
      if (error) refuseEvidence("list units", error);
      return (data ?? []).map(unitRowToUnit);
    },

    async decideUnit(projectId, unitId, decision, operatorId) {
      const { data, error } = await client.rpc("nexra_evidence_unit_decide", { p_project_id: projectId, p_unit_id: unitId, p_decision: decision, p_operator: operatorId });
      if (error) refuseEvidence("decide unit", error);
      return decideResultToOutcome(data);
    },
  };
}
