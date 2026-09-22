import type { JsonObject } from "@/types/agent-run";
import type {
  ContentDraft,
  ContentDraftStatus,
  ContentDraftVersion,
  CreateDraftFromWriterInput,
  DraftVersionOrigin,
} from "@/types/content-draft";

/**
 * The shape of `public.nexra_content_drafts` and
 * `public.nexra_content_draft_versions`, and the translation between them and
 * the application's types. Rows are typed here so the client refuses any
 * other table at compile time, and a row that does not match what the
 * migration declares is refused at read time rather than passed on.
 */

export class ContentDraftRowError extends Error {
  constructor(message: string) {
    super(`Content draft row: ${message}`);
    this.name = "ContentDraftRowError";
  }
}

export type ContentDraftRow = {
  id: string;
  project_id: string;
  source_writer_run_id: string;
  source_plan_run_id: string | null;
  section_index: number | null;
  section_label: string;
  status: string;
  current_version: number;
  approved_version: number | null;
  approved_by: string | null;
  approved_at: string | null;
  published_version: number | null;
  published_at: string | null;
  remote_content_id: string | null;
  remote_target: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type ContentDraftVersionRow = {
  id: string;
  draft_id: string;
  version: number;
  origin: string;
  title: string;
  body: string;
  claims: unknown;
  placeholders: unknown;
  fact_check: unknown;
  created_by: string;
  created_at: string;
};

/** What creating a draft sets. Every other column has a default or belongs to a later milestone. */
export type ContentDraftInsert = Pick<
  ContentDraftRow,
  "project_id" | "source_writer_run_id" | "source_plan_run_id" | "section_index" | "section_label" | "created_by"
>;

export type ContentDraftVersionInsert = Pick<
  ContentDraftVersionRow,
  "draft_id" | "version" | "origin" | "title" | "body" | "claims" | "placeholders" | "created_by"
>;

export type ContentDraftsDatabase = {
  public: {
    Tables: {
      nexra_content_drafts: {
        Row: ContentDraftRow;
        Insert: ContentDraftInsert;
        // State transitions belong to later milestones; this one only creates.
        Update: { [_ in never]: never };
        Relationships: [];
      };
      nexra_content_draft_versions: {
        Row: ContentDraftVersionRow;
        Insert: ContentDraftVersionInsert;
        // Versions are immutable; fact_check is written by a later milestone.
        Update: { [_ in never]: never };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
  };
};

export const CONTENT_DRAFT_READ_COLUMNS =
  "id, project_id, source_writer_run_id, source_plan_run_id, section_index, section_label, status, current_version, approved_version, approved_by, approved_at, published_version, published_at, remote_content_id, remote_target, created_by, created_at, updated_at";

export const CONTENT_DRAFT_VERSION_READ_COLUMNS =
  "id, draft_id, version, origin, title, body, claims, placeholders, fact_check, created_by, created_at";

const STATUSES: readonly ContentDraftStatus[] = ["drafting", "fact-checked", "approved", "published", "archived"];
const ORIGINS: readonly DraftVersionOrigin[] = ["writer", "operator"];

function oneOf<T extends string>(allowed: readonly T[], value: string, field: string): T {
  const found = allowed.find((entry) => entry === value);
  if (found === undefined) throw new ContentDraftRowError(`${field} is "${value}", which this product does not recognise.`);
  return found;
}

function stringArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new ContentDraftRowError(`${field} is not an array of strings.`);
  }
  return value as string[];
}

function jsonObjectOrNull(value: unknown, field: string): JsonObject | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new ContentDraftRowError(`${field} is not an object.`);
  return value as JsonObject;
}

export function draftRowToDraft(row: ContentDraftRow): ContentDraft {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceWriterRunId: row.source_writer_run_id,
    sourcePlanRunId: row.source_plan_run_id,
    sectionIndex: row.section_index,
    sectionLabel: row.section_label,
    status: oneOf(STATUSES, row.status, "status"),
    currentVersion: row.current_version,
    approvedVersion: row.approved_version,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    publishedVersion: row.published_version,
    publishedAt: row.published_at,
    remoteContentId: row.remote_content_id,
    remoteTarget: row.remote_target,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function versionRowToVersion(row: ContentDraftVersionRow): ContentDraftVersion {
  return {
    id: row.id,
    draftId: row.draft_id,
    version: row.version,
    origin: oneOf(ORIGINS, row.origin, "origin"),
    title: row.title,
    body: row.body,
    claims: stringArray(row.claims, "claims"),
    placeholders: stringArray(row.placeholders, "placeholders"),
    factCheck: jsonObjectOrNull(row.fact_check, "fact_check"),
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export function draftToInsert(input: CreateDraftFromWriterInput): ContentDraftInsert {
  return {
    project_id: input.projectId,
    source_writer_run_id: input.sourceWriterRunId,
    source_plan_run_id: input.sourcePlanRunId,
    section_index: input.sectionIndex,
    section_label: input.sectionLabel,
    created_by: input.createdBy,
  };
}

/** Version 1: the Writer's output as generated. */
export function firstVersionInsert(draftId: string, input: CreateDraftFromWriterInput): ContentDraftVersionInsert {
  return {
    draft_id: draftId,
    version: 1,
    origin: "writer",
    title: input.title,
    body: input.body,
    claims: [...input.claims],
    placeholders: [...input.placeholders],
    created_by: input.createdBy,
  };
}
