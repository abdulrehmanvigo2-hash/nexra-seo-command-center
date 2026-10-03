import { SOURCE_READ_LIMIT, SOURCES_PER_OPPORTUNITY_PER_DAY, type EvidenceSource } from "@/lib/evidence/contract";
import type { FetchedSource } from "@/lib/evidence/fetch";
import { EvidenceStoreNotSetUpError, type EvidenceStore } from "@/lib/evidence/store-contract";

/**
 * The evidence service, sources part (M4, PR 5). Fetching a source: the target is an organic SERP result of the
 * opportunity (its URL read from the record, never from the request) or a URL the owner typed; the day's limit is read
 * first so nothing is fetched in vain; the page is fetched under the crawler's rules and recorded whatever happened —
 * a refused or failed fetch is a record too, with no text.
 */

export type FetchSourceResult =
  | { readonly status: "recorded"; readonly source: EvidenceSource }
  | { readonly status: "not-set-up" | "project-not-found" | "opportunity-not-found" | "serp-result-not-found" | "source-limit" };

export type EvidenceService = {
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

    async listSources(projectId, opportunityId) {
      return guarded(async () => ({ status: "read" as const, sources: (await store.listSources(projectId, opportunityId, SOURCE_READ_LIMIT)).filter((source) => source.projectId === projectId && source.opportunityId === opportunityId) }));
    },
  };
}
