import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { isTaskOwningAgent, isTaskPriority, isTaskSourceKind, isTaskStatus } from "@/lib/agent-tasks/contract";
import type { CalendarTask } from "@/lib/calendar/calendar";
import { CALENDAR_LINK_LIMIT, CALENDAR_TASK_LIMIT } from "@/lib/calendar/contract";
import { CalendarStoreNotSetUpError, type CalendarStore, type LinkArticleOutcome, type SetDateOutcome } from "@/lib/calendar/store-contract";
import { ACTIONS, type OpportunityAction } from "@/lib/opportunities/score";

/**
 * The calendar store over the task table, its events and the two functions of migration 20261022120000. A database on
 * which the migration is not yet applied answers with `CalendarStoreNotSetUpError` (the planned date column or the
 * functions are missing), which the service turns into "not set up", never a crash. A row this product does not
 * recognise is refused, never passed on.
 */

type Row = Record<string, unknown>;
type CalendarDatabase = {
  public: {
    Tables: {
      nexra_agent_tasks: { Row: Row; Insert: never; Update: never; Relationships: [] };
      nexra_agent_task_events: { Row: Row; Insert: never; Update: never; Relationships: [] };
      nexra_opportunities: { Row: Row; Insert: never; Update: never; Relationships: [] };
    };
    Views: { [_ in never]: never };
    Functions: {
      nexra_agent_task_set_plan_date: { Args: { p_project_id: string; p_task_id: string; p_planned_for: string | null; p_operator: string }; Returns: unknown };
      nexra_agent_task_link_article: { Args: { p_project_id: string; p_task_id: string; p_article_id: string; p_operator: string }; Returns: unknown };
    };
  };
};
export type { CalendarDatabase };

/** Missing relation, column or function, or not in PostgREST's schema cache. */
export const NOT_SET_UP_CODES: readonly string[] = ["PGRST202", "PGRST204", "PGRST205", "42P01", "42703", "42883"];

export class CalendarStoreError extends Error {
  constructor(operation: string, cause: PostgrestError) {
    super(`Calendar store: ${operation} failed (${cause.code}): ${cause.message}`);
    this.name = "CalendarStoreError";
  }
}

function notSetUp(error: PostgrestError): boolean {
  return NOT_SET_UP_CODES.includes(error.code) || /schema cache|does not exist/i.test(error.message);
}

function refuse(operation: string, error: PostgrestError): never {
  if (notSetUp(error)) throw new CalendarStoreNotSetUpError(operation);
  throw new CalendarStoreError(operation, error);
}

function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`Calendar row: ${key} is not text.`);
  return value;
}

export function calendarTaskRow(row: Row): CalendarTask {
  const status = text(row, "status");
  const priority = text(row, "priority");
  const owningAgent = text(row, "owning_agent");
  const sourceKind = text(row, "source_kind");
  if (!isTaskStatus(status) || !isTaskPriority(priority) || !isTaskOwningAgent(owningAgent) || !isTaskSourceKind(sourceKind)) throw new Error("Calendar row: a task field this product does not recognise.");
  const planned = row.planned_for;
  if (planned !== null && typeof planned !== "string") throw new Error("Calendar row: planned_for is not a date.");
  return { id: text(row, "id"), title: text(row, "title"), status, priority, owningAgent, sourceKind, sourceRef: text(row, "source_ref"), plannedFor: planned, createdAt: text(row, "created_at") };
}

function outcome<T extends string>(data: unknown, allowed: readonly T[], what: string): T {
  const value = typeof data === "object" && data !== null ? (data as { outcome?: unknown }).outcome : undefined;
  const found = allowed.find((candidate) => candidate === value);
  if (found === undefined) throw new Error(`Calendar store: ${what} answered "${String(value)}", which this product does not recognise.`);
  return found;
}

export function createSupabaseCalendarStore(client: SupabaseClient<CalendarDatabase>): CalendarStore {
  return {
    storesCalendar: true,

    async listTasks(projectId) {
      const { data, error } = await client
        .from("nexra_agent_tasks")
        .select("id, title, status, priority, owning_agent, source_kind, source_ref, planned_for, created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(CALENDAR_TASK_LIMIT);
      if (error) refuse("list tasks", error);
      return (data ?? []).map(calendarTaskRow);
    },

    async listLinks(projectId) {
      const { data, error } = await client
        .from("nexra_agent_task_events")
        .select("task_id, article_id, seq")
        .eq("project_id", projectId)
        .eq("event_type", "article-linked")
        .order("seq", { ascending: false })
        .limit(CALENDAR_LINK_LIMIT);
      if (error) refuse("list article links", error);
      const links: Record<string, string> = {};
      for (const row of data ?? []) {
        const task = text(row, "task_id");
        if (!(task in links)) links[task] = text(row, "article_id");
      }
      return links;
    },

    async opportunities(projectId, ids) {
      if (ids.length === 0) return {};
      const { data, error } = await client.from("nexra_opportunities").select("id, score, action").eq("project_id", projectId).in("id", [...ids]);
      if (error) {
        if (notSetUp(error)) return {};
        refuse("read opportunities", error);
      }
      const out: Record<string, { score: number; action: OpportunityAction }> = {};
      for (const row of data ?? []) {
        const action = ACTIONS.find((candidate) => candidate === row.action);
        if (action === undefined || typeof row.score !== "number") continue;
        out[text(row, "id")] = { score: row.score, action };
      }
      return out;
    },

    async setPlanDate(projectId, taskId, date, operatorId): Promise<SetDateOutcome> {
      const { data, error } = await client.rpc("nexra_agent_task_set_plan_date", { p_project_id: projectId, p_task_id: taskId, p_planned_for: date, p_operator: operatorId });
      if (error) refuse("set plan date", error);
      return { status: outcome(data, ["plan-date-changed", "task-not-found", "same-date", "terminal"] as const, "the set-date function") };
    },

    async linkArticle(projectId, taskId, articleId, operatorId): Promise<LinkArticleOutcome> {
      const { data, error } = await client.rpc("nexra_agent_task_link_article", { p_project_id: projectId, p_task_id: taskId, p_article_id: articleId, p_operator: operatorId });
      if (error) refuse("link article", error);
      return { status: outcome(data, ["article-linked", "task-not-found", "article-not-found", "same-article", "terminal"] as const, "the link function") };
    },
  };
}
