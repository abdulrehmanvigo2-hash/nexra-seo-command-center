import "server-only";

import { selectProjectDataSource } from "@/lib/projects/data-source";
import { unavailableSearchConsoleQueryPageStore, type SearchConsoleQueryPageStore } from "@/lib/search-console/query-pages/contract";
import type { SearchConsoleQueryPagesDatabase } from "@/lib/search-console/query-pages/supabase/schema";
import { createSupabaseSearchConsoleQueryPageStore } from "@/lib/search-console/query-pages/supabase/store";
import { createSupabaseServerClient, readSupabaseServerConfig } from "@/lib/supabase/server";

/**
 * The server's query × page store (milestone M1, phase 4, P4c), wired here
 * once over the same Supabase configuration the snapshot store uses; with
 * the fixture roster there is nowhere to keep a pair and the capture skips
 * the step.
 */

function configuredStore(): SearchConsoleQueryPageStore {
  const supabase = selectProjectDataSource(process.env) === "supabase";
  const config = supabase ? readSupabaseServerConfig(process.env) : null;
  return config
    ? createSupabaseSearchConsoleQueryPageStore(createSupabaseServerClient<SearchConsoleQueryPagesDatabase>(config))
    : unavailableSearchConsoleQueryPageStore;
}

let store: SearchConsoleQueryPageStore | null = null;

/** The one query × page store of this process: the capture writes through it. */
export function searchConsoleQueryPageStore(): SearchConsoleQueryPageStore {
  store ??= configuredStore();
  return store;
}
