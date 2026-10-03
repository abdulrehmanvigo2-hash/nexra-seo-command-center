import type { Confirmation } from "@/lib/agent-runs/spend-confirm";
import { STAGE_LABEL, type CalendarItem, type Stage, type SuggestedDate } from "@/lib/calendar/calendar";
import type { CalendarView } from "@/lib/calendar/contract";

/**
 * The Calendar tab (M3, PR 4): what the screen says, in words, for every answer the route gives. Pure and client-safe.
 * The stage is derived from records; the tab writes only planned dates and article links, each one database function.
 */

export const NOT_SET_UP_TITLE = "Not set up yet";
export const NOT_SET_UP_COPY =
  "The calendar needs its planned dates and article links in this deployment's database (migration 20261022120000). Nothing here is broken: the other tabs read their records as before.";
export const CALENDAR_NOTE =
  "Accepted work by planned date, each with the stage its task and linked article have reached. Setting a date or linking an article records an event on the task; nothing here runs an agent or publishes.";
export const SUGGEST_LABEL = "Suggest dates…";
export const NO_TASKS_TITLE = "Nothing to plan yet";
export const NO_TASKS_COPY = "Accept an opportunity on Keyword Intelligence, or record a task, and it appears here to plan.";

export type TabState =
  | { readonly status: "loading" }
  | { readonly status: "not-set-up" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "ready"; readonly view: CalendarView };

export const READ_FAILED: TabState = { status: "failed", message: "The calendar could not be read. Nothing is shown in its place." };

export function tabState(httpStatus: number, body: unknown): TabState {
  if (httpStatus === 503) return { status: "not-set-up" };
  if (httpStatus === 401 || httpStatus === 403) return { status: "failed", message: "Sign in again as an operator to read the calendar." };
  if (httpStatus === 429) return { status: "failed", message: "Too many reads just now; try again in a few minutes." };
  const view = typeof body === "object" && body !== null ? (body as { view?: CalendarView }).view : undefined;
  if (httpStatus < 200 || httpStatus >= 300 || !view || !Array.isArray(view.items) || !Array.isArray(view.linkable)) return READ_FAILED;
  return { status: "ready", view };
}

export function stageTone(stage: Stage): "neutral" | "accent" | "positive" | "warning" {
  switch (stage) {
    case "published":
    case "ready":
      return "positive";
    case "proposal":
    case "review":
    case "draft":
      return "accent";
    case "cancelled":
      return "neutral";
    default:
      return "neutral";
  }
}

export function stageLabel(item: CalendarItem): string {
  return `${STAGE_LABEL[item.stage]}${item.blocked ? " · blocked" : ""}`;
}

/** The line under an item: its kind, score, article and any read that failed. */
export function itemDetail(item: CalendarItem): string {
  const parts = [item.contentType];
  if (item.score !== null) parts.push(`score ${item.score}`);
  if (item.article !== null) parts.push(item.article.slug === null ? `article ${item.article.id.slice(0, 8)}` : `/blog/${item.article.slug}`);
  if (item.articleUnread) parts.push("linked article not read");
  return parts.join(" · ");
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function monthLabel(month: string): string {
  const [year, number] = month.split("-");
  return `${MONTHS[Number(number) - 1] ?? "?"} ${year}`;
}

export function dayLabel(date: string): string {
  const [, number, day] = date.split("-");
  return `${Number(day)} ${(MONTHS[Number(number) - 1] ?? "?").slice(0, 3)}`;
}

export function viewNotes(view: CalendarView): readonly string[] {
  const notes: string[] = [];
  if (view.articlesUnread) notes.push("The project's articles could not be read: linked items show their task's stage, not the article's.");
  if (view.liveUnread) notes.push("The live articles could not be read: no item is shown as published.");
  return notes;
}

export function suggestConfirmation(projectId: string, suggestions: readonly SuggestedDate[]): Confirmation {
  return {
    title: "Plan these dates?",
    facts: [{ label: "Project", value: projectId }, ...suggestions.map((s) => ({ label: dayLabel(s.date), value: s.title }))],
    consequence: "Records one planned date on each task (one event each), one item a week from next Monday, by score. You can move or clear any of them afterwards. Nothing runs or publishes.",
    confirmLabel: `Plan ${suggestions.length} date${suggestions.length === 1 ? "" : "s"}`,
    dismissLabel: "Go back",
    usage: null,
    tone: "primary",
  };
}

/** A POST's answer in words. */
export function writeOutcome(httpStatus: number, body: unknown): { readonly text: string; readonly tone: "neutral" | "warning" } {
  const status = typeof body === "object" && body !== null ? ((body as { status?: unknown; error?: unknown }).status ?? (body as { error?: unknown }).error) : null;
  if (httpStatus === 200 && status === "plan-date-changed") return { text: "Planned date saved.", tone: "neutral" };
  if (httpStatus === 200 && status === "article-linked") return { text: "Article linked.", tone: "neutral" };
  if (httpStatus === 200 && status === "same-date") return { text: "That date was already planned. Nothing changed.", tone: "neutral" };
  if (httpStatus === 200 && status === "same-article") return { text: "That article is already linked. Nothing changed.", tone: "neutral" };
  if (httpStatus === 503) return { text: NOT_SET_UP_COPY, tone: "warning" };
  if (status === "terminal") return { text: "A completed or cancelled task is not planned or linked. Nothing changed.", tone: "warning" };
  if (status === "task-not-found") return { text: "That task is not this project's. Nothing changed.", tone: "warning" };
  if (status === "article-not-found") return { text: "That article is not this project's, or it is archived. Nothing changed.", tone: "warning" };
  if (httpStatus === 429) return { text: "Too many requests just now; try again in a few minutes.", tone: "warning" };
  if (httpStatus === 401 || httpStatus === 403) return { text: "Sign in again as an operator.", tone: "warning" };
  return { text: "The request failed. Nothing is known to have been recorded.", tone: "warning" };
}

// ---------------------------------------------------------------------------
// *Link to a task…* on the article pages (M3, PR 5).

export const LINK_TASK_TITLE = "Planned task";
export const LINK_TASK_NOT_SET_UP = "Linking this article to a planned task needs migration 20261022120000 in this deployment's database.";

/** The tasks linked to this article now, and the open tasks it could be linked to. */
export function linkChoices(view: CalendarView, articleId: string): { readonly linked: readonly CalendarItem[]; readonly open: readonly CalendarItem[] } {
  const linked = view.items.filter((item) => item.article?.id === articleId);
  const open = view.items.filter((item) => item.task.status !== "completed" && item.task.status !== "cancelled" && item.article?.id !== articleId);
  return { linked, open };
}
