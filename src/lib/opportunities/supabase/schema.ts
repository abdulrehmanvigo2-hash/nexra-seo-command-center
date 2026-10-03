import type { AcceptedOpportunity } from "@/lib/opportunities/contract";
import { ACTIONS, type Signal } from "@/lib/opportunities/score";
import type { AcceptOutcome } from "@/lib/opportunities/store-contract";

/**
 * The shape of `nexra_opportunities`, what `nexra_opportunity_accept` answers, and the translation into the
 * application's types (migration 20261021120000). The table grants no INSERT, UPDATE or DELETE: the function is the
 * only way in. A row that does not match what the migration declares is refused at read time rather than passed on.
 */

export class OpportunityRowError extends Error {
  constructor(message: string) {
    super(`Opportunity row: ${message}`);
    this.name = "OpportunityRowError";
  }
}

export type OpportunityRow = {
  id: string;
  project_id: string;
  map_id: string;
  cluster_id: string;
  action: string;
  finding_key: string | null;
  title: string;
  score: number;
  rules_version: number;
  priority: string;
  signals: unknown;
  gsc_end_date: string | null;
  crawl_id: string | null;
  task_id: string;
  accepted_by: string;
  accepted_at: string;
};

type ReadOnly<Row> = { Row: Row; Insert: never; Update: never; Relationships: [] };

export type OpportunitiesDatabase = {
  public: {
    Tables: { nexra_opportunities: ReadOnly<OpportunityRow> };
    Views: { [_ in never]: never };
    Functions: {
      nexra_opportunity_accept: { Args: { p_project_id: string; p_opportunity: unknown; p_operator: string }; Returns: unknown };
    };
  };
};

export const OPPORTUNITY_READ_COLUMNS =
  "id, project_id, map_id, cluster_id, action, finding_key, title, score, rules_version, priority, signals, gsc_end_date, crawl_id, task_id, accepted_by, accepted_at";

/** The Postgres error codes a database without the migration answers (missing relation or function, or not in PostgREST's schema cache). */
export const NOT_SET_UP_CODES: readonly string[] = ["PGRST202", "PGRST205", "42P01", "42883"];

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new OpportunityRowError(`${what} is not an object.`);
  return value as Record<string, unknown>;
}
function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new OpportunityRowError(`${key} is not text.`);
  return value;
}
function optionalText(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new OpportunityRowError(`${key} is not text.`);
  return value;
}
function integer(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isInteger(value)) throw new OpportunityRowError(`${key} is not a whole number.`);
  return value;
}
function oneOf<T extends string>(row: Record<string, unknown>, key: string, values: readonly T[]): T {
  const value = row[key];
  const found = values.find((candidate) => candidate === value);
  if (found === undefined) throw new OpportunityRowError(`${key} is "${String(value)}", which this product does not recognise.`);
  return found;
}

function signalsOf(value: unknown): Signal[] {
  if (!Array.isArray(value)) throw new OpportunityRowError("signals is not a list.");
  return value.map((entry, index) => {
    const row = record(entry, `signal ${index}`);
    return {
      label: text(row, "label"),
      points: integer(row, "points"),
      source: oneOf(row, "source", ["observed", "provider-estimate", "derived"] as const),
      detail: text(row, "detail"),
    };
  });
}

export function opportunityRowToOpportunity(data: unknown): AcceptedOpportunity {
  const row = record(data, "an opportunity row");
  return {
    id: text(row, "id"),
    projectId: text(row, "project_id"),
    mapId: text(row, "map_id"),
    clusterId: text(row, "cluster_id"),
    action: oneOf(row, "action", ACTIONS),
    findingKey: optionalText(row, "finding_key"),
    title: text(row, "title"),
    score: integer(row, "score"),
    rulesVersion: integer(row, "rules_version"),
    priority: oneOf(row, "priority", ["high", "medium", "low"] as const),
    signals: signalsOf(row.signals),
    gscEndDate: optionalText(row, "gsc_end_date"),
    crawlId: optionalText(row, "crawl_id"),
    taskId: text(row, "task_id"),
    acceptedBy: text(row, "accepted_by"),
    acceptedAt: text(row, "accepted_at"),
  };
}

export function acceptResultToOutcome(data: unknown): AcceptOutcome {
  const result = record(data, "the accept answer");
  switch (result.outcome) {
    case "accepted":
    case "exists":
      return { status: result.outcome, opportunity: opportunityRowToOpportunity(result.opportunity) };
    case "project-not-found":
    case "map-not-approved":
    case "cluster-not-found":
      return { status: result.outcome };
    case "invalid":
      return { status: "invalid", reason: typeof result.reason === "string" ? result.reason : "unknown" };
    default:
      throw new OpportunityRowError(`the accept function answered "${String(result.outcome)}", which this product does not recognise.`);
  }
}
