import "server-only";

import { selectProjectDataSource } from "@/lib/projects/data-source";
import { projectRepository } from "@/lib/projects/repository";
import { searchConsoleProperties, searchConsoleProvider } from "@/lib/search-console";
import { createSnapshotCapture, type SnapshotCapture } from "@/lib/search-console/snapshots/capture";
import { unavailableSearchConsoleSnapshotStore } from "@/lib/search-console/snapshots/contract";
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
 * answers `store-unavailable`. Nothing calls this yet: the scheduled worker
 * step is checkpoint 1c and starts only with approval.
 */

function configuredCapture(): SnapshotCapture {
  const supabase = selectProjectDataSource(process.env) === "supabase";
  const config = supabase ? readSupabaseServerConfig(process.env) : null;
  return createSnapshotCapture({
    provider: searchConsoleProvider(),
    properties: searchConsoleProperties(),
    projects: projectRepository,
    store: config
      ? createSupabaseSearchConsoleSnapshotStore(createSupabaseServerClient<SearchConsoleSnapshotsDatabase>(config))
      : unavailableSearchConsoleSnapshotStore,
  });
}

let capture: SnapshotCapture | null = null;

export function searchConsoleSnapshotCapture(): SnapshotCapture {
  capture ??= configuredCapture();
  return capture;
}
