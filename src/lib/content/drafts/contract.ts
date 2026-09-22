/**
 * What the draft service needs from wherever drafts are kept.
 *
 * Storage-agnostic, like the crawl and agent-run contracts: the service holds
 * the rules, a store holds rows. Every read names the project as well as the
 * id, so a draft of one client can never be reached through another's page.
 */

import type {
  ContentDraft,
  ContentDraftVersion,
  CreateDraftFromWriterInput,
  DraftFactCheck,
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

export type RecordFactCheckOutcome =
  | { readonly status: "recorded"; readonly version: ContentDraftVersion }
  /** The version already carries a fact-check. Nothing was written. */
  | { readonly status: "already-checked"; readonly version: ContentDraftVersion }
  /** No such version. */
  | { readonly status: "not-found" };

export type MarkFactCheckedOutcome =
  /** The parent moved from `drafting` to `fact-checked`, because the checked version was still current. */
  | { readonly status: "updated"; readonly draft: ContentDraft }
  /** The checked version is no longer current, or the parent was not in `drafting`. Nothing was written. */
  | { readonly status: "unchanged" };

export type ApproveVersionOutcome =
  /** The parent now records this exact version as approved. */
  | { readonly status: "approved"; readonly draft: ContentDraft }
  /** The one conditional statement matched no row: the version is no longer current, or the parent is not fact-checked. Nothing was written. */
  | { readonly status: "unchanged" };

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
  /** One exact version by draft id and number, or null. */
  getVersion(draftId: string, version: number): Promise<ContentDraftVersion | null>;
  /**
   * Writes the fact-check onto one exact version, only while that version's
   * `factCheck` is still null: a version is checked once, and its text and
   * every other column are untouched.
   */
  recordFactCheck(input: {
    readonly draftId: string;
    readonly version: number;
    readonly factCheck: DraftFactCheck;
  }): Promise<RecordFactCheckOutcome>;
  /**
   * Moves the parent from `drafting` to `fact-checked`, only if the checked
   * version is still its current version. One conditional statement: a
   * draft that advanced meanwhile is left exactly as it is.
   */
  markFactChecked(input: {
    readonly projectId: string;
    readonly draftId: string;
    readonly version: number;
  }): Promise<MarkFactCheckedOutcome>;
  /**
   * Records the exact version as approved on the parent, in one statement
   * conditional on that version still being current and the parent still
   * being `fact-checked`. No version row is touched, and nothing is
   * published.
   */
  approveVersion(input: {
    readonly projectId: string;
    readonly draftId: string;
    readonly version: number;
    readonly approvedBy: string;
    readonly approvedAt: string;
  }): Promise<ApproveVersionOutcome>;
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
  async getVersion() {
    return null;
  },
  async recordFactCheck() {
    return { status: "not-found" };
  },
  async markFactChecked() {
    return { status: "unchanged" };
  },
  async approveVersion() {
    return { status: "unchanged" };
  },
};
