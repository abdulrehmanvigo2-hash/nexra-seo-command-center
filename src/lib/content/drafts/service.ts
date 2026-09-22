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
import { isUnchanged, normaliseVersionText, type VersionTextRefusal } from "@/lib/content/drafts/edit-rules";
import {
  writerRunEligibility,
  type DraftEligibilityRefusal,
} from "@/lib/content/drafts/eligibility";
import type { WriterOutputRefusal } from "@/lib/content/drafts/parse-writer-output";
import type { AgentRun } from "@/types/agent-run";
import type { DraftHistory, DraftWithCurrentVersion } from "@/types/content-draft";

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
  | { readonly ok: true; readonly created: boolean; readonly saved: DraftHistory }
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
  | { readonly ok: true; readonly saved: DraftHistory | null }
  | { readonly ok: false; readonly reason: "invalid" | "unavailable" };

export type SaveVersionRequest = {
  readonly projectId: string;
  readonly draftId: string;
  /** The version the operator started editing from. */
  readonly expectedVersion: number;
  readonly title: string;
  readonly body: string;
  /** The operator's Supabase Auth user id, confirmed by the caller. */
  readonly operatorId: string;
};

export type SaveVersionResult =
  /** A new version was written and is now current. */
  | { readonly ok: true; readonly created: true; readonly saved: DraftHistory }
  /** The edit is the saved text again: nothing was written. */
  | { readonly ok: true; readonly created: false; readonly saved: DraftHistory }
  | { readonly ok: false; readonly reason: "invalid" }
  | { readonly ok: false; readonly reason: "unavailable" }
  /** No such draft in this project. */
  | { readonly ok: false; readonly reason: "not-found" }
  /** The text is empty or over its bound; nothing was written. */
  | { readonly ok: false; readonly reason: "text"; readonly refusal: VersionTextRefusal }
  /** Another save advanced the draft first; nothing was written. */
  | { readonly ok: false; readonly reason: "stale"; readonly currentVersion: number }
  | { readonly ok: false; readonly reason: "archived" }
  /** The store wrote the version but its history could not then be read. */
  | { readonly ok: false; readonly reason: "failed" };

export type DraftService = {
  saveWriterRun(request: SaveWriterRunRequest): Promise<SaveWriterRunResult>;
  findForWriterRun(projectId: string, writerRunId: string): Promise<FindDraftResult>;
  /** Saves an operator's edit as the draft's next immutable version. */
  saveVersion(request: SaveVersionRequest): Promise<SaveVersionResult>;
  /** One draft with every version, by project and id, or null. */
  getHistory(projectId: string, draftId: string): Promise<FindDraftResult>;
};

/** How many versions are read back for the history list. */
export const HISTORY_LIMIT = 100;

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

  /** The draft with every version, ascending, for the panel and its history list. */
  async function history(saved: DraftWithCurrentVersion): Promise<DraftHistory> {
    const versions = await store.listVersions(saved.draft.id, HISTORY_LIMIT);
    return { ...saved, versions: [...versions].sort((a, b) => a.version - b.version) };
  }

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
      if (existing !== null) return { ok: true, created: false, saved: await history(existing) };

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
      if (outcome.status === "created") return { ok: true, created: true, saved: { ...outcome.saved, versions: [outcome.saved.version] } };

      // Another save won the race on the unique key: the draft is theirs and ours.
      const winner = await store.findByWriterRunId(projectId, writerRunId);
      return winner === null ? { ok: false, reason: "failed" } : { ok: true, created: false, saved: await history(winner) };
    },

    async findForWriterRun(projectId, writerRunId) {
      if (!isProjectId(projectId) || !isUuid(writerRunId)) return { ok: false, reason: "invalid" };
      if (!store.storesDrafts) return { ok: false, reason: "unavailable" };
      const saved = await store.findByWriterRunId(projectId, writerRunId.toLowerCase());
      return { ok: true, saved: saved === null ? null : await history(saved) };
    },

    async saveVersion(request) {
      if (
        !isProjectId(request.projectId) ||
        !isUuid(request.draftId) ||
        !isUuid(request.operatorId) ||
        !Number.isInteger(request.expectedVersion) ||
        request.expectedVersion < 1
      ) {
        return { ok: false, reason: "invalid" };
      }
      // The text is judged before anything is read: an empty or oversized
      // edit is refused whatever the draft's state.
      const text = normaliseVersionText(request.title, request.body);
      if (!text.ok) return { ok: false, reason: "text", refusal: text.refusal };
      if (!store.storesDrafts) return { ok: false, reason: "unavailable" };
      const projectId = request.projectId;
      const draftId = request.draftId.toLowerCase();

      // Ownership: the draft is read by project and id together, so another
      // project's draft is not found and nothing about it is disclosed.
      const existing = await store.getByProjectAndId(projectId, draftId);
      if (existing === null) return { ok: false, reason: "not-found" };
      if (existing.draft.status === "archived") return { ok: false, reason: "archived" };
      if (existing.draft.currentVersion !== request.expectedVersion) {
        return { ok: false, reason: "stale", currentVersion: existing.draft.currentVersion };
      }
      // The saved text again is not a new version.
      if (isUnchanged(text.value, existing.version)) return { ok: true, created: false, saved: await history(existing) };

      // The store decides atomically; the checks above only spare it a round
      // trip, and a save that lost a race in between is answered stale here.
      const outcome = await store.saveVersion({
        projectId,
        draftId,
        expectedVersion: request.expectedVersion,
        title: text.value.title,
        body: text.value.body,
        createdBy: request.operatorId.toLowerCase(),
      });
      if (outcome.status === "stale") return { ok: false, reason: "stale", currentVersion: outcome.currentVersion };
      if (outcome.status === "not-found") return { ok: false, reason: "not-found" };
      if (outcome.status === "archived") return { ok: false, reason: "archived" };
      return { ok: true, created: true, saved: await history(outcome.saved) };
    },

    async getHistory(projectId, draftId) {
      if (!isProjectId(projectId) || !isUuid(draftId)) return { ok: false, reason: "invalid" };
      if (!store.storesDrafts) return { ok: false, reason: "unavailable" };
      const saved = await store.getByProjectAndId(projectId, draftId.toLowerCase());
      return { ok: true, saved: saved === null ? null : await history(saved) };
    },
  };
}
