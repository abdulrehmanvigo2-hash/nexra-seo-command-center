import type { EvidenceSource } from "@/lib/evidence/contract";
import type { FetchedSource } from "@/lib/evidence/fetch";

/**
 * What the evidence service needs from where sources are kept (migration 20261025120000). The one write is the
 * database's record function (which checks the opportunity, the SERP result and the daily limit); reads are bounded
 * and project-scoped.
 */

export type RecordSourceOutcome =
  | { readonly status: "recorded"; readonly source: EvidenceSource }
  | { readonly status: "project-not-found" | "opportunity-not-found" | "serp-result-not-found" | "source-limit" };

export class EvidenceStoreNotSetUpError extends Error {
  constructor(operation: string) {
    super(`Evidence store: ${operation} found no evidence schema (migration 20261025120000 not applied).`);
    this.name = "EvidenceStoreNotSetUpError";
  }
}

export type EvidenceStore = {
  readonly storesEvidence: boolean;
  /** The URL of an organic SERP result of this opportunity, or null. */
  serpResultUrl(projectId: string, opportunityId: string, serpResultId: string): Promise<string | null>;
  /** Today's sources for the opportunity (the database refuses a sixth; read first so nothing is fetched in vain). */
  sourcesToday(opportunityId: string, at: Date): Promise<number>;
  recordSource(input: { readonly projectId: string; readonly opportunityId: string; readonly serpResultId: string | null; readonly fetched: FetchedSource; readonly operatorId: string }): Promise<RecordSourceOutcome>;
  listSources(projectId: string, opportunityId: string, limit: number): Promise<readonly EvidenceSource[]>;
};

export const unavailableEvidenceStore: EvidenceStore = {
  storesEvidence: false,
  async serpResultUrl() {
    return null;
  },
  async sourcesToday() {
    return 0;
  },
  async recordSource() {
    return { status: "project-not-found" };
  },
  async listSources() {
    return [];
  },
};
