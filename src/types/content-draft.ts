/**
 * Shapes for content drafts: one Writer section draft and the versions a
 * person makes of it.
 *
 * A draft is the one thing in this product that a person owns after an agent
 * produced it. The parent row says whose it is and where it stands; a version
 * row is text written once and never changed. Version 1 is always the
 * Writer's own output, exactly as generated, so the model-generated original
 * can always be recovered beside whatever an operator later saves.
 *
 * Nothing here is a publication. `publishedVersion`, `publishedAt`,
 * `remoteContentId` and `remoteTarget` exist for a later milestone and stay
 * null until an explicit, operator-triggered publish records them; the same
 * holds for the approval fields.
 */

import type { JsonObject } from "@/types/agent-run";

export type ContentDraftStatus = "drafting" | "fact-checked" | "approved" | "published" | "archived";

/** `writer`: the model's output, saved once. `operator`: a person's edit. */
export type DraftVersionOrigin = "writer" | "operator";

export type ContentDraft = {
  readonly id: string;
  readonly projectId: string;
  /** The completed, grounded Writer run whose output is version 1. */
  readonly sourceWriterRunId: string;
  /** The content plan that run drafted from, as the run's own metadata recorded it. */
  readonly sourcePlanRunId: string | null;
  /** Which outline line of the plan was drafted (1-based), when the run recorded one. */
  readonly sectionIndex: number | null;
  readonly sectionLabel: string;
  readonly status: ContentDraftStatus;
  readonly currentVersion: number;
  readonly approvedVersion: number | null;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly publishedVersion: number | null;
  readonly publishedAt: string | null;
  readonly remoteContentId: string | null;
  readonly remoteTarget: string | null;
  /** The Supabase Auth user id of the operator who saved it. */
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type ContentDraftVersion = {
  readonly id: string;
  readonly draftId: string;
  readonly version: number;
  readonly origin: DraftVersionOrigin;
  readonly title: string;
  /** The prose, exactly as generated or saved apart from surrounding whitespace. */
  readonly body: string;
  /** The CLAIMS USED lines, each ending with the record it rests on. */
  readonly claims: readonly string[];
  /** The PLACEHOLDERS lines, each a `[NEEDS EVIDENCE: …]` marker. */
  readonly placeholders: readonly string[];
  /** Null until a later milestone checks this exact version. Never "passed". */
  readonly factCheck: JsonObject | null;
  readonly createdBy: string;
  readonly createdAt: string;
};

/** What creating a draft from a Writer run records. The store adds ids and times. */
export type CreateDraftFromWriterInput = {
  readonly projectId: string;
  readonly sourceWriterRunId: string;
  readonly sourcePlanRunId: string | null;
  readonly sectionIndex: number | null;
  readonly sectionLabel: string;
  readonly title: string;
  readonly body: string;
  readonly claims: readonly string[];
  readonly placeholders: readonly string[];
  readonly createdBy: string;
};

export type DraftWithCurrentVersion = {
  readonly draft: ContentDraft;
  readonly version: ContentDraftVersion;
};

/** A draft, its current version, and every version in ascending order. */
export type DraftHistory = DraftWithCurrentVersion & {
  readonly versions: readonly ContentDraftVersion[];
};

/** What saving an operator's edit records. The store numbers it and adds ids and times. */
export type SaveVersionInput = {
  readonly projectId: string;
  readonly draftId: string;
  /** The version the operator started editing from; the save is refused when it is no longer current. */
  readonly expectedVersion: number;
  readonly title: string;
  readonly body: string;
  readonly createdBy: string;
};
