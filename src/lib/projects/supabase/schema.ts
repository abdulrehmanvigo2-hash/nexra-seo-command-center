import {
  initialsOf,
  isProjectGoal,
  isProjectStatus,
  isProjectType,
  type ValidNewProject,
} from "@/lib/projects/intake-rules";
import type {
  ProjectGoal,
  ProjectRecord,
  ProjectStatus,
  ProjectType,
} from "@/types/project";

/**
 * The `projects` table as the application sees it, and the translation to and
 * from the domain shapes.
 *
 * Snake-case rows exist only in this folder. Everything above it — the
 * repository contract, the routes, the screens — receives `ProjectRecord`,
 * `Project`, and the shapes built from them. The column list mirrors
 * supabase/migrations/20260913120000_create_projects.sql; once a Supabase
 * project exists, `supabase gen types typescript` can replace the hand-written
 * `ProjectsDatabase` below without anything else changing.
 */

/** A full row of `public.projects`. */
export type ProjectRow = {
  id: string;
  name: string;
  client: string;
  domain: string;
  initials: string;
  industry: string;
  type: ProjectType;
  status: ProjectStatus;
  goal: ProjectGoal;
  market: string;
  language: string;
  target_location: string;
  summary: string;
  competitor_domains: string[];
  intake_notes: string;
  /** `date`, serialised as YYYY-MM-DD. */
  started_on: string;
  /** `timestamptz`, serialised as ISO 8601. */
  created_at: string;
  updated_at: string;
};

/** Columns with a database default may be omitted on insert. */
export type ProjectInsert = Omit<
  ProjectRow,
  | "status"
  | "summary"
  | "competitor_domains"
  | "intake_notes"
  | "started_on"
  | "created_at"
  | "updated_at"
> &
  Partial<
    Pick<
      ProjectRow,
      | "status"
      | "summary"
      | "competitor_domains"
      | "intake_notes"
      | "started_on"
      | "created_at"
      | "updated_at"
    >
  >;

/** The schema type the Supabase client is parameterised with. */
export type ProjectsDatabase = {
  public: {
    Tables: {
      projects: {
        Row: ProjectRow;
        Insert: ProjectInsert;
        Update: Partial<ProjectInsert>;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
  };
};

/** The columns a read needs. Intake-only columns are not read back yet. */
export const PROJECT_READ_COLUMNS =
  "id,name,client,domain,initials,industry,type,status,goal,market,language,target_location,summary,started_on,created_at,updated_at";

export type ProjectReadRow = Omit<ProjectRow, "competitor_domains" | "intake_notes">;

/** Raised when a row does not have the shape the migration defines. */
export class ProjectRowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectRowError";
  }
}

function requireText(row: Record<string, unknown>, column: string): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw new ProjectRowError(`projects.${column} is ${value === null ? "null" : typeof value}, expected text`);
  }
  return value;
}

/**
 * An ISO 8601 instant in the form the rest of the product writes: UTC, and no
 * fractional seconds when there are none. Postgres serialises `timestamptz` as
 * `2026-09-09T07:20:00+00:00`; the fixtures and every formatter expect
 * `2026-09-09T07:20:00Z`.
 */
function instant(value: string, column: string): string {
  const time = Date.parse(value);
  if (Number.isNaN(time)) {
    throw new ProjectRowError(`projects.${column} is not a timestamp: ${value}`);
  }
  const iso = new Date(time).toISOString();
  return iso.endsWith(".000Z") ? `${iso.slice(0, -5)}Z` : iso;
}

/** A `date` column as the midnight-UTC instant `Project.startedAt` carries. */
function dateInstant(value: string, column: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ProjectRowError(`projects.${column} is not a date: ${value}`);
  }
  return `${value}T00:00:00Z`;
}

/**
 * A stored row as a `ProjectRecord`.
 *
 * Checks every column rather than trusting the row, so a schema that has
 * drifted from the migration fails loudly here instead of rendering a project
 * with an undefined status.
 */
export function projectRowToRecord(input: unknown): ProjectRecord {
  if (typeof input !== "object" || input === null) {
    throw new ProjectRowError("projects row is not an object");
  }
  const row: Record<string, unknown> = { ...input };

  const type = row.type;
  const status = row.status;
  const goal = row.goal;
  if (!isProjectType(type)) throw new ProjectRowError(`projects.type is not a project type: ${String(type)}`);
  if (!isProjectStatus(status)) throw new ProjectRowError(`projects.status is not a project status: ${String(status)}`);
  if (!isProjectGoal(goal)) throw new ProjectRowError(`projects.goal is not a project goal: ${String(goal)}`);

  return {
    id: requireText(row, "id"),
    name: requireText(row, "name"),
    domain: requireText(row, "domain"),
    industry: requireText(row, "industry"),
    initials: requireText(row, "initials"),
    client: requireText(row, "client"),
    type,
    status,
    market: requireText(row, "market"),
    language: requireText(row, "language"),
    goal,
    targetLocation: requireText(row, "target_location"),
    startedAt: dateInstant(requireText(row, "started_on"), "started_on"),
    updatedAt: instant(requireText(row, "updated_at"), "updated_at"),
    summary: requireText(row, "summary"),
  };
}

/**
 * The row a validated intake submission is stored as.
 *
 * A new engagement starts onboarding, today, with no summary yet. Timestamps
 * are left to the database defaults so they record when the row was written.
 */
export function newProjectInsert(
  project: ValidNewProject,
  id: string,
  today: Date,
): ProjectInsert {
  return {
    id,
    name: project.name,
    client: project.client,
    domain: project.domain,
    initials: initialsOf(project.name),
    industry: project.industry,
    type: project.type,
    status: "onboarding",
    goal: project.goal,
    market: project.market,
    language: project.language,
    target_location: project.targetLocation,
    summary: "",
    competitor_domains: [...project.competitorDomains],
    intake_notes: project.notes,
    started_on: today.toISOString().slice(0, 10),
  };
}
