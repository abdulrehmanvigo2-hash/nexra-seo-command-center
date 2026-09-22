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
  /**
   * The fact-check recorded for this exact version, or null while none has
   * been. Written once, by the operator's explicit recording of one completed
   * Research & Evidence check bound to this version (`DraftFactCheck`); never
   * copied from or to another version.
   */
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

/**
 * How a fact-check of one version came out, derived by the server from the
 * groups below and never taken from the model's own verdict.
 *
 * `passed`: at least one statement rests on a named record and nothing is
 * partial, unsupported or unverifiable. `failed`: at least one statement no
 * record holds. `needs-review`: everything else — partial support, statements
 * the records cannot reach, or no factual statement matched at all. None of
 * these is an approval, and a failed statement is one the records do not
 * hold, not one shown to be false.
 */
export type FactCheckStatus = "passed" | "needs-review" | "failed";

/** One statement of the checked text, as the check placed it. */
export type FactCheckItem = {
  /** The statement, quoted from the version's text. */
  readonly text: string;
  /** The record it rests on, as `crawl /path` or `search console <window>`, where one was named and exists in the evidence. */
  readonly evidence: string | null;
  /** What the record establishes, or why the statement cannot be checked, in the check's words. */
  readonly note: string | null;
};

/**
 * The fact-check stored on one version. Bound to that version by draft id,
 * version number and the run that checked it; the text it judged is the
 * version's own, which never changes.
 */
export type DraftFactCheck = {
  readonly status: FactCheckStatus;
  readonly draftId: string;
  readonly version: number;
  /** When the check's run finished. */
  readonly checkedAt: string;
  /** The completed Research & Evidence run whose output this is. */
  readonly checkedByRunId: string;
  /** When and by whom the result was recorded on the version. */
  readonly recordedAt: string;
  readonly recordedBy: string;
  /** The own-site crawl the records were read from, and the Search Console window where one was included. */
  readonly crawlId: string;
  readonly searchWindow: string | null;
  readonly summary: string;
  readonly supported: readonly FactCheckItem[];
  readonly partial: readonly FactCheckItem[];
  readonly unsupported: readonly FactCheckItem[];
  readonly unverifiable: readonly FactCheckItem[];
  readonly editorial: readonly FactCheckItem[];
};
