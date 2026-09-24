import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { RecordSnapshotOutcome, SearchConsoleSnapshotStore } from "@/lib/search-console/snapshots/contract";
import { recordResultToOutcome, type SearchConsoleSnapshotsDatabase } from "@/lib/search-console/snapshots/supabase/schema";

/**
 * The snapshot store over `nexra_search_console_snapshots`.
 *
 * A thin translation into one Supabase call: the capture holds the rules,
 * and the one database function and the table's constraints enforce the
 * row's shape again for any caller. The only write is that function — the
 * table grants service_role SELECT and nothing else — and nothing here
 * reads the table.
 */

export class SearchConsoleSnapshotStoreError extends Error {
  readonly code: string | null;

  constructor(operation: string, cause: PostgrestError | Error) {
    const code = "code" in cause && typeof cause.code === "string" ? cause.code : null;
    // The cause's message names a constraint or a status, never a row.
    super(`Search Console snapshot store: ${operation} failed${code ? ` (${code})` : ""}: ${cause.message}`);
    this.name = "SearchConsoleSnapshotStoreError";
    this.code = code;
  }
}

export function createSupabaseSearchConsoleSnapshotStore(
  client: SupabaseClient<SearchConsoleSnapshotsDatabase>,
): SearchConsoleSnapshotStore {
  return {
    storesSnapshots: true,

    // One function, one transaction; the unique key serialises two captures of one window.
    async record(input): Promise<RecordSnapshotOutcome> {
      const { data, error } = await client.rpc("nexra_search_console_snapshot_record", {
        p_project_id: input.projectId,
        p_property: input.property,
        p_range_id: input.window.rangeId,
        p_start_date: input.window.startDate,
        p_end_date: input.window.endDate,
        p_state: input.state,
        p_clicks: input.totals?.clicks ?? null,
        p_impressions: input.totals?.impressions ?? null,
        p_ctr: input.totals?.ctr ?? null,
        p_position: input.totals?.position ?? null,
        p_queries: input.queries.map((row) => ({ key: row.key, clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position })),
        p_pages: input.pages.map((row) => ({ key: row.key, clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position })),
        p_partial: [...input.partial],
        p_fetched_at: input.fetchedAt,
      });
      if (error) throw new SearchConsoleSnapshotStoreError("record snapshot", error);
      return recordResultToOutcome(data);
    },
  };
}
