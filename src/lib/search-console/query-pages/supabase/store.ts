import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { QUERY_PAGE_LIST_LIMIT, type RecordQueryPagesOutcome, type SearchConsoleQueryPageStore } from "@/lib/search-console/query-pages/contract";
import { QUERY_PAGE_READ_COLUMNS, queryPageRowToStored, recordResultToOutcome, type SearchConsoleQueryPagesDatabase } from "@/lib/search-console/query-pages/supabase/schema";

/**
 * The query × page store over `nexra_search_console_query_pages`.
 *
 * A thin translation into one Supabase call: the capture holds the rules,
 * and the one database function and the table's constraints enforce the
 * rows' shape again for any caller. The only write is that function — the
 * table grants service_role SELECT and nothing else — and the one read is
 * a bounded, project- and range-scoped SELECT of that table.
 */

export class SearchConsoleQueryPageStoreError extends Error {
  readonly code: string | null;

  constructor(operation: string, cause: PostgrestError | Error) {
    const code = "code" in cause && typeof cause.code === "string" ? cause.code : null;
    // The cause's message names a constraint or a status, never a row.
    super(`Search Console query × page store: ${operation} failed${code ? ` (${code})` : ""}: ${cause.message}`);
    this.name = "SearchConsoleQueryPageStoreError";
    this.code = code;
  }
}

export function createSupabaseSearchConsoleQueryPageStore(
  client: SupabaseClient<SearchConsoleQueryPagesDatabase>,
): SearchConsoleQueryPageStore {
  return {
    storesQueryPages: true,

    // One function, one transaction; the advisory lock and the unique key serialise two captures of one window.
    async record(input): Promise<RecordQueryPagesOutcome> {
      const { data, error } = await client.rpc("nexra_search_console_query_pages_record", {
        p_project_id: input.projectId,
        p_property: input.property,
        p_range_id: input.window.rangeId,
        p_start_date: input.window.startDate,
        p_end_date: input.window.endDate,
        p_pairs: input.pairs.map((row) => ({ query: row.query, page: row.page, clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position })),
        p_fetched_at: input.fetchedAt,
      });
      if (error) throw new SearchConsoleQueryPageStoreError("record query pages", error);
      return recordResultToOutcome(data);
    },

    // The project's rows only, newest window first, never more than the ceiling.
    async listQueryPages(projectId, rangeId, limit) {
      if (!Number.isInteger(limit) || limit < 1 || limit > QUERY_PAGE_LIST_LIMIT) {
        throw new Error(`Search Console query × page store: a list reads 1 to ${QUERY_PAGE_LIST_LIMIT} rows.`);
      }
      const { data, error } = await client
        .from("nexra_search_console_query_pages")
        .select(QUERY_PAGE_READ_COLUMNS)
        .eq("project_id", projectId)
        .eq("range_id", rangeId)
        .order("end_date", { ascending: false })
        .order("property", { ascending: true })
        .order("impressions", { ascending: false })
        .order("query", { ascending: true })
        .order("page", { ascending: true })
        .limit(limit);
      if (error) throw new SearchConsoleQueryPageStoreError("list query pages", error);
      return data.map(queryPageRowToStored);
    },
  };
}
