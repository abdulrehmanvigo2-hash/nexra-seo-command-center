import type { AcceptedOpportunity } from "@/lib/opportunities/contract";

/**
 * What the opportunity service needs from wherever the records are kept (migration 20261021120000). The one write is
 * the database's accept function, which checks the map, cluster, action and scored lines and holds the guards for any
 * caller; the one read is bounded and scoped to one project and map.
 */

export type AcceptOutcome =
  | { readonly status: "accepted"; readonly opportunity: AcceptedOpportunity }
  | { readonly status: "exists"; readonly opportunity: AcceptedOpportunity }
  | { readonly status: "project-not-found" | "map-not-approved" | "cluster-not-found" }
  | { readonly status: "invalid"; readonly reason: string };

/** The store cannot reach the migration's objects: the table or function does not exist on this database yet. */
export class OpportunityStoreNotSetUpError extends Error {
  constructor(operation: string) {
    super(`Opportunity store: ${operation} found no opportunity schema (migration 20261021120000 not applied).`);
    this.name = "OpportunityStoreNotSetUpError";
  }
}

export type OpportunityStore = {
  /** Whether this deployment keeps opportunities at all. The fixture data source does not. */
  readonly storesOpportunities: boolean;
  accept(projectId: string, payload: Readonly<Record<string, unknown>>, operatorId: string): Promise<AcceptOutcome>;
  /** The project's accepted opportunities of one map, newest first, bounded. */
  listAccepted(projectId: string, mapId: string): Promise<readonly AcceptedOpportunity[]>;
};

export const unavailableOpportunityStore: OpportunityStore = {
  storesOpportunities: false,
  async accept() {
    return { status: "project-not-found" };
  },
  async listAccepted() {
    return [];
  },
};
