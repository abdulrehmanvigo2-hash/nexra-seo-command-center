import type { AgentTaskPriority, AgentTaskStatus, TaskOwningAgent, TaskSourceKind } from "@/lib/agent-tasks/contract";
import type { OpportunityAction } from "@/lib/opportunities/score";

/**
 * M3 — the content calendar's rules (docs/roadmap/M3-content-calendar.md, PR 2). Pure and client-safe. The stage of an
 * item is derived on read from its task's status and the records of the article linked to it — no calendar status is
 * stored. A month is laid out Monday first; *Suggest dates* proposes one open, unscheduled item a week by score, and
 * nothing is saved until the owner confirms each date.
 */

export type ArticleStatus = "drafting" | "checked" | "approved" | "archived";

/** One task as the calendar reads it. */
export type CalendarTask = {
  readonly id: string;
  readonly title: string;
  readonly status: AgentTaskStatus;
  readonly priority: AgentTaskPriority;
  readonly owningAgent: TaskOwningAgent;
  readonly sourceKind: TaskSourceKind;
  readonly sourceRef: string;
  /** The planned date, `YYYY-MM-DD`, or null. */
  readonly plannedFor: string | null;
  readonly createdAt: string;
};

/** One article of the project, as its records hold it. */
export type CalendarArticle = {
  readonly id: string;
  readonly slug: string | null;
  readonly title: string | null;
  readonly status: ArticleStatus;
};

export type CalendarInput = {
  readonly tasks: readonly CalendarTask[];
  /** The newest article link of each task, by task id. */
  readonly links: Readonly<Record<string, string>>;
  /** The project's articles; null when they could not be read. */
  readonly articles: readonly CalendarArticle[] | null;
  /** The articles with an active publication proposal. */
  readonly proposedArticleIds: readonly string[];
  /** The live slugs the records name an owning article for. */
  readonly liveOwners: readonly { readonly slug: string; readonly articleId: string }[];
  /** The accepted opportunities behind `opportunity` tasks, by opportunity id. */
  readonly opportunities: Readonly<Record<string, { readonly score: number; readonly action: OpportunityAction }>>;
};

export const STAGES = ["proposed", "approved", "research", "draft", "review", "ready", "proposal", "published", "done", "cancelled"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Readonly<Record<Stage, string>> = {
  proposed: "Proposed",
  approved: "Approved",
  research: "Research",
  draft: "Draft",
  review: "Review",
  ready: "Ready",
  proposal: "Publication proposal",
  published: "Published",
  done: "Done",
  cancelled: "Cancelled",
};

export const CONTENT_TYPE_LABEL: Readonly<Record<OpportunityAction, string>> = {
  write: "New article",
  expand: "Article expansion",
  refresh: "Refresh",
  fix: "Page fix",
};

export type CalendarItem = {
  readonly task: CalendarTask;
  readonly stage: Stage;
  /** The linked article as its records read; null when none is linked (or the linked one is archived). */
  readonly article: CalendarArticle | null;
  /** A link exists but its article could not be read: the stage is the task's own, never guessed from the article. */
  readonly articleUnread: boolean;
  readonly blocked: boolean;
  /** The accepted opportunity's score and action, for an opportunity task. */
  readonly score: number | null;
  readonly contentType: string;
};

// ---------------------------------------------------------------------------
// The stage (the design note's table, in order).

export function itemOf(task: CalendarTask, input: CalendarInput): CalendarItem {
  const linkedId = input.links[task.id] ?? null;
  const article = linkedId === null || input.articles === null ? null : (input.articles.find((entry) => entry.id === linkedId) ?? null);
  const usable = article !== null && article.status !== "archived" ? article : null;
  const articleUnread = linkedId !== null && input.articles === null;
  const opportunity = task.sourceKind === "opportunity" ? (input.opportunities[task.sourceRef] ?? null) : null;

  let stage: Stage;
  if (task.status === "cancelled") stage = "cancelled";
  else if (usable !== null) {
    if (input.liveOwners.some((entry) => entry.articleId === usable.id)) stage = "published";
    else if (input.proposedArticleIds.includes(usable.id)) stage = "proposal";
    else if (usable.status === "approved") stage = "ready";
    else if (usable.status === "checked") stage = "review";
    else stage = "draft";
  } else if (task.status === "backlog") stage = "proposed";
  else if (task.status === "ready") stage = "approved";
  else if (task.status === "completed") stage = "done";
  else stage = "research";

  return {
    task,
    stage,
    article: usable,
    articleUnread,
    blocked: task.status === "blocked",
    score: opportunity?.score ?? null,
    contentType: opportunity === null ? "Task" : CONTENT_TYPE_LABEL[opportunity.action],
  };
}

export function calendarItems(input: CalendarInput): CalendarItem[] {
  return input.tasks.map((task) => itemOf(task, input));
}

// ---------------------------------------------------------------------------
// Dates (UTC, `YYYY-MM-DD`).

const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

export function isMonth(value: unknown): value is string {
  return typeof value === "string" && MONTH.test(value);
}

function toTime(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

function toDate(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return toDate(toTime(date) + days * DAY_MS);
}

/** The Monday of the week holding `date`. */
export function mondayOf(date: string): string {
  const day = new Date(toTime(date)).getUTCDay(); // 0 Sunday … 6 Saturday
  return addDays(date, -((day + 6) % 7));
}

/** The first Monday strictly after `date`. */
export function nextMonday(date: string): string {
  return addDays(mondayOf(date), 7);
}

export type GridDay = { readonly date: string; readonly inMonth: boolean; readonly items: readonly CalendarItem[] };
export type MonthGrid = {
  readonly month: string;
  readonly weeks: readonly (readonly GridDay[])[];
  /** Open items with no planned date. */
  readonly unscheduled: readonly CalendarItem[];
  /** Planned items outside the month shown, counted. */
  readonly elsewhere: number;
  readonly cancelled: readonly CalendarItem[];
};

/** A month laid out Monday first: whole weeks from the Monday on or before the 1st to the Sunday on or after the last day. */
export function monthGrid(month: string, items: readonly CalendarItem[]): MonthGrid {
  const match = MONTH.exec(month);
  if (match === null) throw new RangeError(`Not a month: ${month}`);
  const first = `${month}-01`;
  const next = toDate(Date.UTC(Number(match[1]), Number(match[2]), 1));
  const last = addDays(next, -1);
  const start = mondayOf(first);
  const end = addDays(mondayOf(last), 6);
  const live = items.filter((item) => item.stage !== "cancelled");
  const weeks: GridDay[][] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) {
    if (weeks.length === 0 || weeks[weeks.length - 1]!.length === 7) weeks.push([]);
    weeks[weeks.length - 1]!.push({ date: day, inMonth: day >= first && day <= last, items: live.filter((item) => item.task.plannedFor === day).sort(byRank) });
  }
  return {
    month,
    weeks,
    unscheduled: live.filter((item) => item.task.plannedFor === null && isOpen(item)).sort(byRank),
    elsewhere: live.filter((item) => item.task.plannedFor !== null && (item.task.plannedFor < start || item.task.plannedFor > end)).length,
    cancelled: items.filter((item) => item.stage === "cancelled"),
  };
}

export function shiftMonth(month: string, by: number): string {
  const match = MONTH.exec(month);
  if (match === null) throw new RangeError(`Not a month: ${month}`);
  return toDate(Date.UTC(Number(match[1]), Number(match[2]) - 1 + by, 1)).slice(0, 7);
}

// ---------------------------------------------------------------------------
// Suggest dates.

const PRIORITY_RANK: Readonly<Record<AgentTaskPriority, number>> = { critical: 0, high: 1, medium: 2, low: 3 };
export const SUGGEST_LIMIT = 12;

function isOpen(item: CalendarItem): boolean {
  return item.task.status !== "completed" && item.task.status !== "cancelled" && item.stage !== "published";
}

/** Score first (unknown last), then priority, then the oldest task, then id. */
function byRank(a: CalendarItem, b: CalendarItem): number {
  return (b.score ?? -1) - (a.score ?? -1) || PRIORITY_RANK[a.task.priority] - PRIORITY_RANK[b.task.priority] || a.task.createdAt.localeCompare(b.task.createdAt) || a.task.id.localeCompare(b.task.id);
}

export type SuggestedDate = { readonly taskId: string; readonly title: string; readonly date: string };

/**
 * One open, unscheduled item a week (by default) on the Monday of each week from the first Monday after `today`,
 * skipping weeks whose open planned items already fill them; at most `limit`. A proposal only: nothing is saved here.
 */
export function suggestDates(items: readonly CalendarItem[], today: string, options: { readonly perWeek?: number; readonly limit?: number } = {}): SuggestedDate[] {
  const perWeek = Math.max(1, Math.floor(options.perWeek ?? 1));
  const limit = Math.max(0, Math.floor(options.limit ?? SUGGEST_LIMIT));
  const candidates = items.filter((item) => item.task.plannedFor === null && item.stage !== "cancelled" && isOpen(item)).sort(byRank).slice(0, limit);
  const taken = new Map<string, number>();
  for (const item of items) {
    if (item.task.plannedFor === null || !isOpen(item) || item.stage === "cancelled") continue;
    const week = mondayOf(item.task.plannedFor);
    taken.set(week, (taken.get(week) ?? 0) + 1);
  }
  const out: SuggestedDate[] = [];
  let week = nextMonday(today);
  for (const item of candidates) {
    while ((taken.get(week) ?? 0) >= perWeek) week = addDays(week, 7);
    out.push({ taskId: item.task.id, title: item.task.title, date: week });
    taken.set(week, (taken.get(week) ?? 0) + 1);
  }
  return out;
}
