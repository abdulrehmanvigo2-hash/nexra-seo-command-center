/**
 * What the draft service needs from wherever drafts are kept.
 *
 * Storage-agnostic, like the crawl and agent-run contracts: the service holds
 * the rules, a store holds rows. Every read names the project as well as the
 * id, so a draft of one client can never be reached through another's page.
 */

import type {
  ContentDraftVersion,
  CreateDraftFromWriterInput,
  DraftWithCurrentVersion,
  SaveVersionInput,
} from "@/types/content-draft";

export type CreateDraftOutcome =
  | { readonly status: "created"; readonly saved: DraftWithCurrentVersion }
  /** The unique writer-run key was already taken: another save got there first. Nothing was written. */
  | { readonly status: "exists" };

export type SaveVersionOutcome =
  | { readonly status: "created"; readonly saved: DraftWithCurrentVersion }
  /** The draft's current version is not the one the operator started from. Nothing was written. */
  | { readonly status: "stale"; readonly currentVersion: number }
  /** No such draft in this project. */
  | { readonly status: "not-found" }
  /** An archived draft is not edited. */
  | { readonly status: "archived" };

export type ContentDraftStore = {
  /** Whether this store keeps drafts. The fixture data source does not. */
  readonly storesDrafts: boolean;

  /** The draft seeded by this Writer run, with its current version, or null. */
  findByWriterRunId(projectId: string, writerRunId: string): Promise<DraftWithCurrentVersion | null>;
  /** One draft by id, with its current version, or null — including when the project does not match. */
  getByProjectAndId(projectId: string, draftId: string): Promise<DraftWithCurrentVersion | null>;
  /**
   * Creates the parent and version 1 as one logical operation. A store that
   * cannot make that atomic must leave no parent without its version behind.
   */
  createFromWriterRun(input: CreateDraftFromWriterInput): Promise<CreateDraftOutcome>;
  /** The version the draft's `currentVersion` names, or null. */
  getCurrentVersion(draftId: string): Promise<ContentDraftVersion | null>;
  /** A draft's versions, newest first, at most `limit`. */
  listVersions(draftId: string, limit: number): Promise<readonly ContentDraftVersion[]>;
  /**
   * Saves an operator's edit as the next version and advances the parent's
   * pointer, atomically, only if the parent's current version is still the
   * one the operator started from. Never touches an earlier version.
   */
  saveVersion(input: SaveVersionInput): Promise<SaveVersionOutcome>;
};

/**
 * The store used when drafts are not persisted anywhere. It refuses rather
 * than pretends: nothing here returns an empty result that could be read as
 * "no draft exists" when the truth is "nothing can be kept".
 */
export const unavailableDraftStore: ContentDraftStore = {
  storesDrafts: false,
  async findByWriterRunId() {
    return null;
  },
  async getByProjectAndId() {
    return null;
  },
  async createFromWriterRun() {
    return { status: "exists" };
  },
  async getCurrentVersion() {
    return null;
  },
  async listVersions() {
    return [];
  },
  async saveVersion() {
    return { status: "not-found" };
  },
};
