import "server-only";

import { projectRepository } from "@/lib/projects/repository";
import { searchConsoleProperties } from "@/lib/search-console";
import { brandTokensOf } from "@/lib/search-console/keywords/intent";
import { buildKeywordInventory, type KeywordIntelligence } from "@/lib/search-console/keywords/inventory";
import { searchConsoleQueryPageStore } from "@/lib/search-console/query-pages";
import { QUERY_PAGE_LIST_LIMIT, QUERY_PAGE_RANGE_ID, type StoredQueryPage } from "@/lib/search-console/query-pages/contract";
import { SNAPSHOT_LIST_LIMIT, SNAPSHOT_RANGE_ID } from "@/lib/search-console/snapshots/contract";
import { searchConsoleSnapshotStore } from "@/lib/search-console/snapshots";

/**
 * The server's observed-query inventory reader for one project (milestone
 * M4): the project's own stored snapshots and pairs, read through the two
 * existing bounded store reads, derived by fixed rules for the property the
 * server's private mapping names now. No new store and no Google call. Null
 * when this deployment keeps no snapshots (fixture data source), so the
 * caller can say so without inventing an inventory. The project id is
 * always the caller's own, handed in by the runtime or the route; nothing
 * here takes a property from a request.
 */
export async function readKeywordIntelligence(projectId: string): Promise<KeywordIntelligence | null> {
  const snapshots = searchConsoleSnapshotStore();
  if (!snapshots.storesSnapshots) return null;
  const property = searchConsoleProperties().get(projectId) ?? "";
  const project = await projectRepository.getProjectById(projectId);
  const rows = await snapshots.listSnapshots(projectId, SNAPSHOT_RANGE_ID, SNAPSHOT_LIST_LIMIT);
  const pairStore = searchConsoleQueryPageStore();
  const pairs: readonly StoredQueryPage[] = pairStore.storesQueryPages ? await pairStore.listQueryPages(projectId, QUERY_PAGE_RANGE_ID, QUERY_PAGE_LIST_LIMIT) : [];
  return buildKeywordInventory({
    snapshots: rows,
    pairs,
    pairsReadLimit: QUERY_PAGE_LIST_LIMIT,
    // An unmapped project has no current property: every stored row is under another name.
    currentProperty: property,
    brandTokens: brandTokensOf(project?.name ?? "", property || project?.domain || ""),
  });
}
