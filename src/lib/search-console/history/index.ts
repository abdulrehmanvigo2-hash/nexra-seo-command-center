import "server-only";

import { compareSnapshotHistory, type SnapshotHistoryComparison } from "@/lib/search-console/history/compare";
import { searchConsoleProperties } from "@/lib/search-console";
import { SNAPSHOT_LIST_LIMIT, SNAPSHOT_RANGE_ID } from "@/lib/search-console/snapshots/contract";
import { searchConsoleSnapshotStore } from "@/lib/search-console/snapshots";

/**
 * The server's stored-history reader for one project: the project's own
 * snapshots, read through the one bounded store read, compared for the
 * property the server's private mapping names now. Null when this
 * deployment keeps no snapshots (fixture data source), so the caller can
 * say so without inventing history. The project id is always the run's
 * own, handed in by the runtime; nothing here takes a property from a
 * caller.
 */
export async function readSearchConsoleHistory(projectId: string): Promise<SnapshotHistoryComparison | null> {
  const store = searchConsoleSnapshotStore();
  if (!store.storesSnapshots) return null;
  const property = searchConsoleProperties().get(projectId);
  const snapshots = await store.listSnapshots(projectId, SNAPSHOT_RANGE_ID, SNAPSHOT_LIST_LIMIT);
  // An unmapped project has no current property: every stored row is history under another name.
  return compareSnapshotHistory(snapshots, property ?? "");
}
