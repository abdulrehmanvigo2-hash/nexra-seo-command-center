import "server-only";

import { selectProjectDataSource } from "@/lib/projects/data-source";
import { projectRepository } from "@/lib/projects/repository";
import { searchConsoleProperties, searchConsoleProvider } from "@/lib/search-console";
import { searchConsoleQueryPageStore } from "@/lib/search-console/query-pages";
import { createSnapshotCapture, type SnapshotCapture } from "@/lib/search-console/snapshots/capture";
import { unavailableSearchConsoleSnapshotStore, type SearchConsoleSnapshotStore } from "@/lib/search-console/snapshots/contract";
import type { SearchConsoleSnapshotsDatabase } from "@/lib/search-console/snapshots/supabase/schema";
import { createSupabaseSearchConsoleSnapshotStore } from "@/lib/search-console/snapshots/supabase/store";
import { createSupabaseServerClient, readSupabaseServerConfig } from "@/lib/supabase/server";

/**
 * The server's Search Console snapshot capture — the one place that wires
 * it. It reads through the same cached provider the panel and the agent
 * tasks use, resolves properties from the same private configuration, lists
 * projects through the project repository, and writes with
 * `PROJECTS_DATA_SOURCE=supabase` through the one database function; with
 * the fixture roster there is nowhere to keep a snapshot and every project
 * answers `store-unavailable`. The scheduled worker's `process` job
 * (checkpoint 1c) is the one caller.
 */

function configuredStore(): SearchConsoleSnapshotStore {
  const supabase = selectProjectDataSource(process.env) === "supabase";
  const config = supabase ? readSupabaseServerConfig(process.env) : null;
  return config
    ? createSupabaseSearchConsoleSnapshotStore(createSupabaseServerClient<SearchConsoleSnapshotsDatabase>(config))
    : unavailableSearchConsoleSnapshotStore;
}

let store: SearchConsoleSnapshotStore | null = null;

/** The one snapshot store of this process: the capture writes through it, the history reader reads through it. */
export function searchConsoleSnapshotStore(): SearchConsoleSnapshotStore {
  store ??= configuredStore();
  return store;
}

function configuredCapture(): SnapshotCapture {
  return createSnapshotCapture({
    provider: searchConsoleProvider(),
    properties: searchConsoleProperties(),
    projects: projectRepository,
    store: searchConsoleSnapshotStore(),
    // The P4c pair store, over the same Supabase configuration; the capture skips the pair step when it stores nothing.
    queryPages: searchConsoleQueryPageStore(),
  });
}

let capture: SnapshotCapture | null = null;

export function searchConsoleSnapshotCapture(): SnapshotCapture {
  capture ??= configuredCapture();
  return capture;
}
