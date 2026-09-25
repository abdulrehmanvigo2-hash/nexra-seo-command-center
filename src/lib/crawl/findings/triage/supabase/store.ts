import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { TRIAGE_READ_LIMIT, type CrawlFindingTriageStore } from "@/lib/crawl/findings/triage/store-contract";
import {
  setResultToOutcome,
  TRIAGE_READ_COLUMNS,
  triageRowToTriage,
  type CrawlFindingTriageDatabase,
} from "@/lib/crawl/findings/triage/supabase/schema";

/**
 * The triage store over `nexra_crawl_finding_triage`. A thin translation
 * into Supabase calls: the one database function and the table's triggers
 * enforce the binding, the status set and the note length again for any
 * caller. The only write is that function; the read is bounded and scoped
 * to one project.
 */

export class CrawlFindingTriageStoreError extends Error {
  readonly code: string | null;

  constructor(operation: string, cause: PostgrestError | Error) {
    const code = "code" in cause && typeof cause.code === "string" ? cause.code : null;
    super(`Crawl finding triage store: ${operation} failed${code ? ` (${code})` : ""}: ${cause.message}`);
    this.name = "CrawlFindingTriageStoreError";
    this.code = code;
  }
}

export function createSupabaseCrawlFindingTriageStore(client: SupabaseClient<CrawlFindingTriageDatabase>): CrawlFindingTriageStore {
  return {
    storesTriage: true,

    async listForProject(projectId, limit) {
      const bounded = Number.isInteger(limit) && limit > 0 ? Math.min(limit, TRIAGE_READ_LIMIT) : TRIAGE_READ_LIMIT;
      const { data, error } = await client
        .from("nexra_crawl_finding_triage")
        .select(TRIAGE_READ_COLUMNS)
        .eq("project_id", projectId)
        .order("set_at", { ascending: false })
        .limit(bounded);
      if (error) throw new CrawlFindingTriageStoreError("list finding triage", error);
      return data.map(triageRowToTriage);
    },

    async set(input) {
      const { data, error } = await client.rpc("nexra_crawl_finding_triage_set", {
        p_project_id: input.projectId,
        p_crawl_id: input.crawlId,
        p_finding_key: input.findingKey,
        p_status: input.status,
        p_note: input.note,
        p_operator: input.operatorId,
      });
      if (error) throw new CrawlFindingTriageStoreError("set finding triage", error);
      return setResultToOutcome(data);
    },
  };
}
