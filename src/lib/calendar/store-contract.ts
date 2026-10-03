import type { CalendarTask } from "@/lib/calendar/calendar";
import type { OpportunityAction } from "@/lib/opportunities/score";

/**
 * What the calendar service needs from the task records (migration 20261022120000). The two writes are the database's
 * functions, which lock the task and append the event; the reads are bounded and scoped to one project.
 */

export type SetDateOutcome = { readonly status: "plan-date-changed" | "task-not-found" | "same-date" | "terminal" };
export type LinkArticleOutcome = { readonly status: "article-linked" | "task-not-found" | "article-not-found" | "same-article" | "terminal" };

/** The store cannot reach the migration's objects: the column, event types or functions do not exist yet. */
export class CalendarStoreNotSetUpError extends Error {
  constructor(operation: string) {
    super(`Calendar store: ${operation} found no calendar schema (migration 20261022120000 not applied).`);
    this.name = "CalendarStoreNotSetUpError";
  }
}

export type CalendarStore = {
  /** Whether this deployment keeps tasks at all. The fixture data source does not. */
  readonly storesCalendar: boolean;
  /** The project's tasks with their planned dates, newest first, bounded. */
  listTasks(projectId: string): Promise<readonly CalendarTask[]>;
  /** The newest article link of each of the project's tasks, by task id. */
  listLinks(projectId: string): Promise<Readonly<Record<string, string>>>;
  /** The accepted opportunities behind the given ids (an empty record when M2's table is not there). */
  opportunities(projectId: string, ids: readonly string[]): Promise<Readonly<Record<string, { readonly score: number; readonly action: OpportunityAction }>>>;
  setPlanDate(projectId: string, taskId: string, date: string | null, operatorId: string): Promise<SetDateOutcome>;
  linkArticle(projectId: string, taskId: string, articleId: string, operatorId: string): Promise<LinkArticleOutcome>;
};

export const unavailableCalendarStore: CalendarStore = {
  storesCalendar: false,
  async listTasks() {
    return [];
  },
  async listLinks() {
    return {};
  },
  async opportunities() {
    return {};
  },
  async setPlanDate() {
    return { status: "task-not-found" };
  },
  async linkArticle() {
    return { status: "task-not-found" };
  },
};
