/**
 * The rules around saving a Writer run as a draft: which run, for which
 * project, by whom, and exactly once.
 *
 * The service re-reads the run from the runtime's own store and applies the
 * eligibility rule in full before the draft store is touched; nothing the
 * caller sends about the draft's text is used, because the text comes from
 * the run. Saving is idempotent on the Writer run: a draft that already
 * exists is returned, a concurrent save that loses the race on the unique
 * key re-reads the winner, and no second parent or second version is ever
 * written. Nothing here calls a provider, queues a run, crawls, or
 * publishes.
 */

import type { ContentDraftStore } from "@/lib/content/drafts/contract";
import {
  writerRunEligibility,
  type DraftEligibilityRefusal,
} from "@/lib/content/drafts/eligibility";
import type { WriterOutputRefusal } from "@/lib/content/drafts/parse-writer-output";
import type { AgentRun } from "@/types/agent-run";
import type { DraftWithCurrentVersion } from "@/types/content-draft";

/** The run store itself satisfies this; a test hands in a map. */
export type DraftRunReader = {
  getById(id: string): Promise<AgentRun | null>;
};

export type SaveWriterRunRequest = {
  readonly projectId: string;
  readonly writerRunId: string;
  /** The operator's Supabase Auth user id, confirmed by the caller. */
  readonly operatorId: string;
};

export type SaveWriterRunResult =
  | { readonly ok: true; readonly created: boolean; readonly saved: DraftWithCurrentVersion }
  /** An id is not the shape it must be; nothing was read. */
  | { readonly ok: false; readonly reason: "invalid" }
  /** Drafts are not persisted on this data source; nothing was written. */
  | { readonly ok: false; readonly reason: "unavailable" }
  /** No run with that id. */
  | { readonly ok: false; readonly reason: "not-found" }
  | { readonly ok: false; readonly reason: "ineligible"; readonly refusal: DraftEligibilityRefusal; readonly detail?: WriterOutputRefusal }
  /** The store answered `exists` but the draft could not then be read. */
  | { readonly ok: false; readonly reason: "failed" };

export type FindDraftResult =
  | { readonly ok: true; readonly saved: DraftWithCurrentVersion | null }
  | { readonly ok: false; readonly reason: "invalid" | "unavailable" };

export type DraftService = {
  saveWriterRun(request: SaveWriterRunRequest): Promise<SaveWriterRunResult>;
  findForWriterRun(projectId: string, writerRunId: string): Promise<FindDraftResult>;
};

const PROJECT_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isProjectId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 2 && value.length <= 64 && PROJECT_ID.test(value);
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function createDraftService(dependencies: {
  readonly store: ContentDraftStore;
  readonly runs: DraftRunReader;
}): DraftService {
  const { store, runs } = dependencies;

  return {
    async saveWriterRun(request) {
      if (!isProjectId(request.projectId) || !isUuid(request.writerRunId) || !isUuid(request.operatorId)) {
        return { ok: false, reason: "invalid" };
      }
      if (!store.storesDrafts) return { ok: false, reason: "unavailable" };
      const projectId = request.projectId;
      const writerRunId = request.writerRunId.toLowerCase();

      // Already saved: the same draft, and nothing written or re-read.
      const existing = await store.findByWriterRunId(projectId, writerRunId);
      if (existing !== null) return { ok: true, created: false, saved: existing };

      const run = await runs.getById(writerRunId);
      if (run === null) return { ok: false, reason: "not-found" };
      const eligibility = writerRunEligibility(run, projectId);
      if (!eligibility.ok) {
        return { ok: false, reason: "ineligible", refusal: eligibility.reason, ...(eligibility.detail ? { detail: eligibility.detail } : {}) };
      }
      const { source } = eligibility;

      const outcome = await store.createFromWriterRun({
        projectId,
        sourceWriterRunId: run.id,
        sourcePlanRunId: source.planRunId,
        sectionIndex: source.sectionIndex,
        sectionLabel: source.output.sectionLabel,
        title: source.output.sectionLabel,
        body: source.output.body,
        claims: source.output.claims,
        placeholders: source.output.placeholders,
        createdBy: request.operatorId.toLowerCase(),
      });
      if (outcome.status === "created") return { ok: true, created: true, saved: outcome.saved };

      // Another save won the race on the unique key: the draft is theirs and ours.
      const winner = await store.findByWriterRunId(projectId, writerRunId);
      return winner === null ? { ok: false, reason: "failed" } : { ok: true, created: false, saved: winner };
    },

    async findForWriterRun(projectId, writerRunId) {
      if (!isProjectId(projectId) || !isUuid(writerRunId)) return { ok: false, reason: "invalid" };
      if (!store.storesDrafts) return { ok: false, reason: "unavailable" };
      return { ok: true, saved: await store.findByWriterRunId(projectId, writerRunId.toLowerCase()) };
    },
  };
}
