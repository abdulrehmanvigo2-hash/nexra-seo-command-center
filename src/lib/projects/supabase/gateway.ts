import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import {
  PROJECT_INTAKE_COLUMNS,
  PROJECT_READ_COLUMNS,
  type ProjectInsert,
  type ProjectIntakeRow,
  type ProjectReadRow,
  type ProjectsDatabase,
} from "@/lib/projects/supabase/schema";

/**
 * The five queries the Projects repository makes, and nothing else.
 *
 * Kept apart from the repository so the repository's own logic — ordering, the
 * analytics join, validation, id allocation — can be exercised against an
 * in-memory table, while this file stays a thin, readable translation into
 * Supabase calls.
 */

export type InsertOutcome =
  | { readonly status: "inserted"; readonly row: ProjectReadRow }
  /** A unique constraint rejected the row: the id or the domain is taken. */
  | { readonly status: "conflict"; readonly on: "id" | "domain" };

export type ProjectTableGateway = {
  /** Every row, oldest first. */
  selectAll(): Promise<readonly ProjectReadRow[]>;
  selectById(id: string): Promise<ProjectReadRow | null>;
  /** The intake-only columns of one row, or null when there is no such row. */
  selectIntakeById(id: string): Promise<ProjectIntakeRow | null>;
  insert(row: ProjectInsert): Promise<InsertOutcome>;
  /**
   * Writes one column of one row — `competitor_domains` — and returns the
   * row's intake columns, or null when no row has that id. No other column
   * is named in the patch, so nothing else on the row can change here.
   */
  updateCompetitorDomains(id: string, competitorDomains: readonly string[]): Promise<ProjectIntakeRow | null>;
};

/** A query the store could not answer. The message is for server logs only. */
export class ProjectStoreError extends Error {
  constructor(operation: string, cause: PostgrestError) {
    super(`Projects store: ${operation} failed (${cause.code}): ${cause.message}`);
    this.name = "ProjectStoreError";
  }
}

/** Postgres `unique_violation`. */
const UNIQUE_VIOLATION = "23505";

function conflictColumn(error: PostgrestError): "id" | "domain" | null {
  if (error.code !== UNIQUE_VIOLATION) return null;
  const text = `${error.message} ${error.details ?? ""}`;
  if (text.includes("projects_domain_key")) return "domain";
  if (text.includes("projects_pkey")) return "id";
  return null;
}

export function createSupabaseProjectGateway(
  client: SupabaseClient<ProjectsDatabase>,
): ProjectTableGateway {
  return {
    async selectAll() {
      const { data, error } = await client
        .from("projects")
        .select(PROJECT_READ_COLUMNS)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
      if (error) throw new ProjectStoreError("list projects", error);
      return data;
    },

    async selectById(id) {
      const { data, error } = await client
        .from("projects")
        .select(PROJECT_READ_COLUMNS)
        .eq("id", id)
        .maybeSingle();
      if (error) throw new ProjectStoreError("read project", error);
      return data;
    },

    async selectIntakeById(id) {
      const { data, error } = await client
        .from("projects")
        .select(PROJECT_INTAKE_COLUMNS)
        .eq("id", id)
        .maybeSingle();
      if (error) throw new ProjectStoreError("read project intake", error);
      return data;
    },

    async updateCompetitorDomains(id, competitorDomains) {
      const { data, error } = await client
        .from("projects")
        .update({ competitor_domains: [...competitorDomains] })
        .eq("id", id)
        .select(PROJECT_INTAKE_COLUMNS)
        .maybeSingle();
      if (error) throw new ProjectStoreError("update project competitors", error);
      return data;
    },

    async insert(row) {
      const { data, error } = await client
        .from("projects")
        .insert(row)
        .select(PROJECT_READ_COLUMNS)
        .single();
      if (error) {
        const on = conflictColumn(error);
        if (on) return { status: "conflict", on };
        throw new ProjectStoreError("create project", error);
      }
      return { status: "inserted", row: data };
    },
  };
}
