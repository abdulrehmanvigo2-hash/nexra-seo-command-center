import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { SNAPSHOT_LIST_LIMIT, type RecordSnapshotOutcome, type SearchConsoleSnapshotStore } from "@/lib/search-console/snapshots/contract";
import { recordResultToOutcome, SNAPSHOT_READ_COLUMNS, snapshotRowToSnapshot, type SearchConsoleSnapshotsDatabase } from "@/lib/search-console/snapshots/supabase/schema";

/**
 * The snapshot store over `nexra_search_console_snapshots`.
 *
 * A thin translation into one Supabase call: the capture holds the rules,
 * and the one database function and the table's constraints enforce the
 * row's shape again for any caller. The only write is that function — the
 * table grants service_role SELECT and nothing else — and the one read is
 * a bounded, project- and range-scoped SELECT of that table.
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

    // The project's rows only, newest window first, never more than the ceiling.
    async listSnapshots(projectId, rangeId, limit) {
      if (!Number.isInteger(limit) || limit < 1 || limit > SNAPSHOT_LIST_LIMIT) {
        throw new Error(`Search Console snapshot store: a list reads 1 to ${SNAPSHOT_LIST_LIMIT} snapshots.`);
      }
      const { data, error } = await client
        .from("nexra_search_console_snapshots")
        .select(SNAPSHOT_READ_COLUMNS)
        .eq("project_id", projectId)
        .eq("range_id", rangeId)
        .order("end_date", { ascending: false })
        .order("property", { ascending: true })
        .limit(limit);
      if (error) throw new SearchConsoleSnapshotStoreError("list snapshots", error);
      return data.map(snapshotRowToSnapshot);
    },
  };
}
