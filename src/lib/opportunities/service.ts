import { opportunityKey, type AcceptedOpportunity, type OpportunitiesView } from "@/lib/opportunities/contract";
import { acceptPayload, findOpportunity, scoreOpportunities, type FindingInput, type OpportunityAction, type PairInput } from "@/lib/opportunities/score";
import { OpportunityStoreNotSetUpError, type OpportunityStore } from "@/lib/opportunities/store-contract";
import type { TopicMapView } from "@/lib/topic-maps/contract";
import { TopicMapStoreNotSetUpError } from "@/lib/topic-maps/store-contract";

/**
 * The opportunity service (M2, PR 5). A read scores the project's approved topic map against the latest stored Search
 * Console window and the newest crawl findings (`score.ts`), and lists what was already accepted from that map. An
 * accept recomputes the list on the server, finds the one the owner named by cluster, action and finding, and records
 * exactly what was computed through the database function — never a score or a line from the browser. Nothing here
 * runs an agent, calls a provider or pays for anything; a database without migration 20261021120000 (or without the
 * topic-map tables) answers "not set up", never a crash.
 */

export type OpportunityReaders = {
  /** The project's approved topic map with its clusters, or null when none is approved. */
  readonly approvedMap: (projectId: string) => Promise<TopicMapView | null>;
  /** The latest stored query × page window, or null when none is stored. */
  readonly pairs: (projectId: string) => Promise<{ readonly endDate: string; readonly rows: readonly PairInput[] } | null>;
  /** The newest own-site crawl's recorded findings, or null when none are recorded. */
  readonly findings: (projectId: string) => Promise<{ readonly crawlId: string; readonly rows: readonly FindingInput[] } | null>;
};

export type ReadResult = { readonly status: "not-set-up" } | { readonly status: "read"; readonly view: OpportunitiesView };

export type AcceptRequestKey = { readonly clusterId: string; readonly action: OpportunityAction; readonly findingKey: string | null };

export type AcceptResult =
  | { readonly status: "not-set-up" | "no-approved-map" | "opportunity-not-found" | "project-not-found" | "map-not-approved" | "cluster-not-found" }
  | { readonly status: "invalid"; readonly reason: string }
  | { readonly status: "accepted" | "exists"; readonly opportunity: AcceptedOpportunity };

export type OpportunityService = {
  read(projectId: string): Promise<ReadResult>;
  accept(projectId: string, key: AcceptRequestKey, operatorId: string): Promise<AcceptResult>;
};

export function createOpportunityService(store: OpportunityStore, readers: OpportunityReaders): OpportunityService {
  async function notSetUp<T>(work: () => Promise<T>): Promise<T | { readonly status: "not-set-up" }> {
    if (!store.storesOpportunities) return { status: "not-set-up" };
    try {
      return await work();
    } catch (error) {
      if (error instanceof OpportunityStoreNotSetUpError || error instanceof TopicMapStoreNotSetUpError) return { status: "not-set-up" };
      throw error;
    }
  }

  async function score(projectId: string) {
    const map = await readers.approvedMap(projectId);
    if (map === null || map.map.projectId !== projectId || map.map.status !== "approved") return null;
    const [pairs, findings] = await Promise.all([readers.pairs(projectId), readers.findings(projectId)]);
    return { map, result: scoreOpportunities({ map, pairs, findings }) };
  }

  return {
    async read(projectId) {
      return (await notSetUp(async (): Promise<ReadResult> => {
        const scored = await score(projectId);
        if (scored === null) {
          // Without an approved map, one bounded read of the table still says whether the migration is applied, so the
          // screen reads "Not set up yet" rather than "approve a map first" on a database without it.
          await store.listAccepted(projectId, "00000000-0000-0000-0000-000000000000");
          return { status: "read", view: { projectId, state: "no-approved-map" } };
        }
        const accepted = (await store.listAccepted(projectId, scored.map.map.id)).filter((row) => row.projectId === projectId && row.mapId === scored.map.map.id);
        return {
          status: "read",
          view: {
            projectId,
            state: "scored",
            map: { id: scored.map.map.id, approvedAt: scored.map.map.approvedAt, clusters: scored.map.clusters.length },
            result: scored.result,
            accepted,
          },
        };
      })) as ReadResult;
    },

    async accept(projectId, key, operatorId) {
      return (await notSetUp(async (): Promise<AcceptResult> => {
        const scored = await score(projectId);
        if (scored === null) return { status: "no-approved-map" };
        const opportunity = findOpportunity(scored.result, key.clusterId, key.action, key.findingKey);
        if (opportunity === null) {
          // Already accepted but no longer scored the same way (the window or findings moved): answer what is recorded.
          const accepted = await store.listAccepted(projectId, scored.map.map.id);
          const earlier = accepted.find((row) => opportunityKey(row) === opportunityKey(key));
          return earlier ? { status: "exists", opportunity: earlier } : { status: "opportunity-not-found" };
        }
        return store.accept(projectId, acceptPayload(opportunity, scored.result), operatorId);
      })) as AcceptResult;
    },
  };
}
