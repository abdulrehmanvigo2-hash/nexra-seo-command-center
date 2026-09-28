import "server-only";

import { selectProjectDataSource } from "@/lib/projects/data-source";
import { searchConsoleProperties } from "@/lib/search-console";
import { QUERY_PAGE_LIST_LIMIT, QUERY_PAGE_RANGE_ID, unavailableSearchConsoleQueryPageStore, type SearchConsoleQueryPageStore } from "@/lib/search-console/query-pages/contract";
import { buildQueryPageIntelligence, type QueryPageIntelligence } from "@/lib/search-console/query-pages/intelligence";
import { latestPagePairs, type PagePairInput } from "@/lib/search-console/query-pages/page-pairs";
import type { SearchConsoleQueryPagesDatabase } from "@/lib/search-console/query-pages/supabase/schema";
import { createSupabaseSearchConsoleQueryPageStore } from "@/lib/search-console/query-pages/supabase/store";
import { createSupabaseServerClient, readSupabaseServerConfig } from "@/lib/supabase/server";

/**
 * The server's query × page store and reader (milestone M1, phase 4, P4c).
 * The store is wired here once, over the same Supabase configuration the
 * snapshot store uses; with the fixture roster there is nowhere to keep a
 * pair and the capture skips the step. The reader is the one way a screen
 * or an agent run reaches stored pairs: the project's own rows, read
 * through the one bounded store read, analysed by fixed rules for the
 * property the server's private mapping names now. The project id is
 * always the caller's own, handed in by the runtime or the route; nothing
 * here takes a property from a request.
 */

function configuredStore(): SearchConsoleQueryPageStore {
  const supabase = selectProjectDataSource(process.env) === "supabase";
  const config = supabase ? readSupabaseServerConfig(process.env) : null;
  return config
    ? createSupabaseSearchConsoleQueryPageStore(createSupabaseServerClient<SearchConsoleQueryPagesDatabase>(config))
    : unavailableSearchConsoleQueryPageStore;
}

let store: SearchConsoleQueryPageStore | null = null;

/** The one query × page store of this process: the capture writes through it, the reader reads through it. */
export function searchConsoleQueryPageStore(): SearchConsoleQueryPageStore {
  store ??= configuredStore();
  return store;
}

/** Null when this deployment keeps no query × page rows (fixture data source), so the caller can say so. */
export async function readSearchConsoleQueryPages(projectId: string): Promise<QueryPageIntelligence | null> {
  const pairs = searchConsoleQueryPageStore();
  if (!pairs.storesQueryPages) return null;
  const property = searchConsoleProperties().get(projectId);
  const rows = await pairs.listQueryPages(projectId, QUERY_PAGE_RANGE_ID, QUERY_PAGE_LIST_LIMIT);
  // An unmapped project has no current property: every stored row is under another name.
  return buildQueryPageIntelligence(rows, property ?? "", QUERY_PAGE_LIST_LIMIT);
}

/**
 * The latest stored window of the project's current property, its rows
 * listed as stored (checkpoint 6.5: the page-level pairs two crawl reviews
 * read). The same one bounded read and property rule as the reader above;
 * null when this deployment keeps no query × page rows.
 */
export async function readLatestPagePairs(projectId: string): Promise<PagePairInput | null> {
  const pairs = searchConsoleQueryPageStore();
  if (!pairs.storesQueryPages) return null;
  const property = searchConsoleProperties().get(projectId);
  const rows = await pairs.listQueryPages(projectId, QUERY_PAGE_RANGE_ID, QUERY_PAGE_LIST_LIMIT);
  return latestPagePairs(rows, property ?? "", QUERY_PAGE_LIST_LIMIT);
}
