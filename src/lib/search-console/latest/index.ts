import "server-only";

import { searchConsoleProperties } from "@/lib/search-console";
import { presentLatestWindow, type LatestWindowView } from "@/lib/search-console/latest/view";
import { SNAPSHOT_LIST_LIMIT, SNAPSHOT_RANGE_ID } from "@/lib/search-console/snapshots/contract";
import { searchConsoleSnapshotStore } from "@/lib/search-console/snapshots";

/**
 * The server's latest-stored-window reader for one project (checkpoint 4.3):
 * the project's own snapshots through the one bounded store read, projected
 * for the property the server's private mapping names now. `not-kept` when
 * this deployment keeps no snapshots. Read-only; no Google call.
 */
export async function readLatestSearchConsoleWindow(projectId: string): Promise<LatestWindowView> {
  const store = searchConsoleSnapshotStore();
  if (!store.storesSnapshots) return { status: "not-kept" };
  const property = searchConsoleProperties().get(projectId);
  const snapshots = await store.listSnapshots(projectId, SNAPSHOT_RANGE_ID, SNAPSHOT_LIST_LIMIT);
  // An unmapped project has no current property: every stored row is history under another name.
  return presentLatestWindow(snapshots, property ?? "");
}
