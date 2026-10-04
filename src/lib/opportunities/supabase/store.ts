import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { ACCEPTED_READ_LIMIT } from "@/lib/opportunities/contract";
import { OpportunityStoreNotSetUpError, type OpportunityStore } from "@/lib/opportunities/store-contract";
import { acceptResultToOutcome, NOT_SET_UP_CODES, OPPORTUNITY_READ_COLUMNS, opportunityRowToOpportunity, type OpportunitiesDatabase } from "@/lib/opportunities/supabase/schema";

/**
 * The opportunity store over `nexra_opportunities` and `nexra_opportunity_accept` (migration 20261021120000). A thin
 * translation into Supabase calls: the function and the table's guards enforce the checks and the immutability for
 * any caller. A database on which the migration is not yet applied answers every call with
 * `OpportunityStoreNotSetUpError`, which the service turns into "not set up", never a crash.
 */

export class OpportunityStoreError extends Error {
  readonly code: string | null;

  constructor(operation: string, cause: PostgrestError | Error) {
    const code = "code" in cause && typeof cause.code === "string" ? cause.code : null;
    super(`Opportunity store: ${operation} failed${code ? ` (${code})` : ""}: ${cause.message}`);
    this.name = "OpportunityStoreError";
    this.code = code;
  }
}

function refuse(operation: string, error: PostgrestError): never {
  if (NOT_SET_UP_CODES.includes(error.code) || /schema cache|does not exist/i.test(error.message)) throw new OpportunityStoreNotSetUpError(operation);
  throw new OpportunityStoreError(operation, error);
}

export function createSupabaseOpportunityStore(client: SupabaseClient<OpportunitiesDatabase>): OpportunityStore {
  return {
    storesOpportunities: true,

    async accept(projectId, payload, operatorId) {
      const { data, error } = await client.rpc("nexra_opportunity_accept", { p_project_id: projectId, p_opportunity: payload, p_operator: operatorId });
      if (error) refuse("accept opportunity", error);
      return acceptResultToOutcome(data);
    },

    async listAccepted(projectId, mapId) {
      const { data, error } = await client
        .from("nexra_opportunities")
        .select(OPPORTUNITY_READ_COLUMNS)
        .eq("project_id", projectId)
        .eq("map_id", mapId)
        .order("accepted_at", { ascending: false })
        .limit(ACCEPTED_READ_LIMIT);
      if (error) refuse("list accepted opportunities", error);
      return (data ?? []).map(opportunityRowToOpportunity);
    },

    async getAccepted(projectId, opportunityId) {
      const { data, error } = await client.from("nexra_opportunities").select(OPPORTUNITY_READ_COLUMNS).eq("project_id", projectId).eq("id", opportunityId).maybeSingle();
      if (error) refuse("get accepted opportunity", error);
      return data === null ? null : opportunityRowToOpportunity(data);
    },
  };
}
