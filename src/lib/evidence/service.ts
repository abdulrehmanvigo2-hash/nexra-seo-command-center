import { SOURCE_READ_LIMIT, SOURCES_PER_OPPORTUNITY_PER_DAY, UNIT_READ_LIMIT, type EvidenceSource, type EvidenceUnit } from "@/lib/evidence/contract";
import { parseExtractAnswer } from "@/lib/evidence/extract";
import type { FetchedSource } from "@/lib/evidence/fetch";
import { EvidenceStoreNotSetUpError, type DecideOutcome, type EvidenceStore, type RecordUnitsOutcome } from "@/lib/evidence/store-contract";

/**
 * The evidence service, sources part (M4, PR 5). Fetching a source: the target is an organic SERP result of the
 * opportunity (its URL read from the record, never from the request) or a URL the owner typed; the day's limit is read
 * first so nothing is fetched in vain; the page is fetched under the crawler's rules and recorded whatever happened —
 * a refused or failed fetch is a record too, with no text.
 */

export type FetchSourceResult =
  | { readonly status: "recorded"; readonly source: EvidenceSource }
  | { readonly status: "not-set-up" | "project-not-found" | "opportunity-not-found" | "serp-result-not-found" | "source-limit" };

export type RecordUnitsResult =
  | RecordUnitsOutcome
  | { readonly status: "not-set-up" | "run-not-found" | "run-not-completed" | "answer-malformed" | "no-units" };

export type EvidenceService = {
  /** Reads a completed evidence-extract run's stored answer, parses it, and records the units (the database checks each quote). */
  recordUnits(projectId: string, sourceId: string, runId: string, operatorId: string): Promise<RecordUnitsResult>;
  listUnits(projectId: string, sourceId: string): Promise<{ readonly status: "not-set-up" } | { readonly status: "read"; readonly units: readonly EvidenceUnit[] }>;
  decide(projectId: string, unitId: string, decision: "admitted" | "rejected", operatorId: string): Promise<DecideOutcome | { readonly status: "not-set-up" }>;
  fetchSource(projectId: string, opportunityId: string, target: { readonly serpResultId: string } | { readonly url: string }, operatorId: string): Promise<FetchSourceResult>;
  listSources(projectId: string, opportunityId: string): Promise<{ readonly status: "not-set-up" } | { readonly status: "read"; readonly sources: readonly EvidenceSource[] }>;
};

export type EvidenceServiceOptions = {
  readonly fetch: (url: string) => Promise<FetchedSource>;
  readonly now?: () => Date;
};

export function createEvidenceService(store: EvidenceStore, options: EvidenceServiceOptions): EvidenceService {
  const { fetch, now = () => new Date() } = options;

  async function guarded<T>(work: () => Promise<T>): Promise<T | { readonly status: "not-set-up" }> {
    if (!store.storesEvidence) return { status: "not-set-up" };
    try {
      return await work();
    } catch (error) {
      if (error instanceof EvidenceStoreNotSetUpError) return { status: "not-set-up" };
      throw error;
    }
  }

  return {
    async fetchSource(projectId, opportunityId, target, operatorId) {
      return guarded(async (): Promise<FetchSourceResult> => {
        let url: string;
        let serpResultId: string | null = null;
        if ("serpResultId" in target) {
          const found = await store.serpResultUrl(projectId, opportunityId, target.serpResultId);
          if (found === null) return { status: "serp-result-not-found" };
          url = found;
          serpResultId = target.serpResultId;
        } else {
          url = target.url;
        }
        if ((await store.sourcesToday(opportunityId, now())) >= SOURCES_PER_OPPORTUNITY_PER_DAY) return { status: "source-limit" };
        const fetched = await fetch(url);
        return store.recordSource({ projectId, opportunityId, serpResultId, fetched, operatorId });
      });
    },

    async recordUnits(projectId, sourceId, runId, operatorId) {
      return guarded(async (): Promise<RecordUnitsResult> => {
        const run = await store.extractRun(projectId, runId);
        if (run === null || run.projectId !== projectId) return { status: "run-not-found" };
        if (run.taskType !== "evidence-extract" || run.agentId !== "research-evidence" || run.sourceId !== sourceId || run.executor !== "ai") return { status: "run-not-accepted" };
        if (run.status !== "completed" || run.summary === null) return { status: "run-not-completed" };
        const parsed = parseExtractAnswer(run.summary);
        if (!parsed.ok) return { status: parsed.reason };
        return store.recordUnits(projectId, sourceId, runId, parsed.units, operatorId);
      });
    },

    async listUnits(projectId, sourceId) {
      return guarded(async () => ({ status: "read" as const, units: (await store.listUnits(projectId, sourceId, UNIT_READ_LIMIT)).filter((unit) => unit.projectId === projectId && unit.sourceId === sourceId) }));
    },

    async decide(projectId, unitId, decision, operatorId) {
      return guarded(() => store.decideUnit(projectId, unitId, decision, operatorId));
    },

    async listSources(projectId, opportunityId) {
      return guarded(async () => ({ status: "read" as const, sources: (await store.listSources(projectId, opportunityId, SOURCE_READ_LIMIT)).filter((source) => source.projectId === projectId && source.opportunityId === opportunityId) }));
    },
  };
}
