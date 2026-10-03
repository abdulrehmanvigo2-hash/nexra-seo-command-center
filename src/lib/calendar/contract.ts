import type { CalendarItem } from "@/lib/calendar/calendar";
import { isDate } from "@/lib/calendar/calendar";

/**
 * The content calendar (M3, PR 3): the shapes the route reads and answers. Pure and client-safe. The view carries
 * every task of the project as a calendar item with its derived stage; the screen lays out the month and the
 * suggestions itself (`calendar.ts`).
 */

export type CalendarView = {
  readonly projectId: string;
  readonly items: readonly CalendarItem[];
  /** The project's articles could not be read: linked items show their task's stage, flagged. */
  readonly articlesUnread: boolean;
  /** The live articles could not be read: no item reads Published. */
  readonly liveUnread: boolean;
  /** The articles the owner may link a task to: the project's articles that are not archived, newest first. */
  readonly linkable: readonly { readonly id: string; readonly label: string }[];
};

/** The most tasks one calendar read returns. */
export const CALENDAR_TASK_LIMIT = 200;
/** The most article-link events one read returns (newest first). */
export const CALENDAR_LINK_LIMIT = 1000;
/** The most articles one read returns. */
export const CALENDAR_ARTICLE_LIMIT = 100;

const PROJECT_ID = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCalendarProjectId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 2 && value.length <= 64 && PROJECT_ID.test(value);
}

export type CalendarWriteRequest =
  | { readonly ok: true; readonly action: "set-date"; readonly projectId: string; readonly taskId: string; readonly date: string | null }
  | { readonly ok: true; readonly action: "link-article"; readonly projectId: string; readonly taskId: string; readonly articleId: string }
  | { readonly ok: false; readonly error: "bad-request" };

/**
 * POST /api/calendar { project, action: "set-date", taskId, date: "YYYY-MM-DD" | null }
 *                  | { project, action: "link-article", taskId, articleId }
 */
export function parseCalendarRequest(body: unknown): CalendarWriteRequest {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "bad-request" };
  const fields = body as Record<string, unknown>;
  const { project, action, taskId } = fields;
  if (!isCalendarProjectId(project) || typeof taskId !== "string" || !UUID.test(taskId)) return { ok: false, error: "bad-request" };
  const keys = Object.keys(fields);
  if (action === "set-date") {
    if (keys.some((key) => !["project", "action", "taskId", "date"].includes(key)) || !("date" in fields)) return { ok: false, error: "bad-request" };
    const date = fields.date;
    if (date !== null && !(isDate(date) && date >= "2020-01-01" && date <= "2099-12-31")) return { ok: false, error: "bad-request" };
    return { ok: true, action, projectId: project, taskId: taskId.toLowerCase(), date };
  }
  if (action === "link-article") {
    const articleId = fields.articleId;
    if (keys.some((key) => !["project", "action", "taskId", "articleId"].includes(key)) || typeof articleId !== "string" || !UUID.test(articleId)) return { ok: false, error: "bad-request" };
    return { ok: true, action, projectId: project, taskId: taskId.toLowerCase(), articleId: articleId.toLowerCase() };
  }
  return { ok: false, error: "bad-request" };
}

export function calendarUrl(projectId: string): string {
  return `/api/calendar?${new URLSearchParams({ project: projectId }).toString()}`;
}
