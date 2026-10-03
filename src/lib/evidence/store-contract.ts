import type { EvidenceSource, EvidenceUnit } from "@/lib/evidence/contract";
import type { ExtractedUnit, SourceForExtraction } from "@/lib/evidence/extract";
import type { AdmittedUnit } from "@/lib/evidence/admitted";
import type { FetchedSource } from "@/lib/evidence/fetch";

/**
 * What the evidence service needs from where sources are kept (migration 20261025120000). The one write is the
 * database's record function (which checks the opportunity, the SERP result and the daily limit); reads are bounded
 * and project-scoped.
 */

export type RecordSourceOutcome =
  | { readonly status: "recorded"; readonly source: EvidenceSource }
  | { readonly status: "project-not-found" | "opportunity-not-found" | "serp-result-not-found" | "source-limit" };

export type ExtractRun = { readonly id: string; readonly projectId: string; readonly agentId: string; readonly taskType: string; readonly status: string; readonly executor: string | null; readonly sourceId: string | null; readonly summary: string | null };

export type RecordUnitsOutcome =
  | { readonly status: "recorded"; readonly units: number; readonly found: number; readonly supported: number }
  | { readonly status: "source-not-found" | "source-not-fetched" | "run-not-accepted" | "exists" | "invalid-unit" };

export type DecideOutcome =
  | { readonly status: "admitted" | "rejected"; readonly unit: EvidenceUnit }
  | { readonly status: "already-decided"; readonly unit: EvidenceUnit }
  | { readonly status: "not-admissible" | "unit-not-found" };

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
  /** One source with its stored text and its opportunity's topic, for the extraction's grounding; null when not the project's or holding no text. */
  sourceForExtraction(projectId: string, sourceId: string): Promise<SourceForExtraction | null>;
  /** One agent run of the project, as the record step reads it. */
  extractRun(projectId: string, runId: string): Promise<ExtractRun | null>;
  recordUnits(projectId: string, sourceId: string, runId: string, units: readonly ExtractedUnit[], operatorId: string): Promise<RecordUnitsOutcome>;
  listUnits(projectId: string, sourceId: string, limit: number): Promise<readonly EvidenceUnit[]>;
  decideUnit(projectId: string, unitId: string, decision: "admitted" | "rejected", operatorId: string): Promise<DecideOutcome>;
  /** M4, checker v4: the admitted units of the opportunities whose task is linked to the article (M3), with their pages. */
  admittedForArticle(projectId: string, articleId: string): Promise<readonly AdmittedUnit[]>;
  /** M5: the admitted units of one opportunity, with their pages, oldest decision first. */
  admittedForOpportunity(projectId: string, opportunityId: string): Promise<readonly AdmittedUnit[]>;
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
  async sourceForExtraction() {
    return null;
  },
  async extractRun() {
    return null;
  },
  async recordUnits() {
    return { status: "source-not-found" };
  },
  async listUnits() {
    return [];
  },
  async decideUnit() {
    return { status: "unit-not-found" };
  },
  async admittedForArticle() {
    return [];
  },
  async admittedForOpportunity() {
    return [];
  },
};
