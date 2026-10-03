import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { TASK_EVENT_META, TASK_EVENT_TYPES } from "@/lib/agent-tasks/contract";
import { eventRowToEvent } from "@/lib/agent-tasks/supabase/schema";
import type { CalendarTask } from "@/lib/calendar/calendar";
import { calendarUrl, parseCalendarRequest } from "@/lib/calendar/contract";
import { createCalendarService, type CalendarReaders } from "@/lib/calendar/service";
import { CalendarStoreNotSetUpError, unavailableCalendarStore, type CalendarStore } from "@/lib/calendar/store-contract";
import { calendarTaskRow } from "@/lib/calendar/supabase/store";

/** M3, PR 3: the calendar service over memory stores, the request shapes, the task events' new types and the route's boundaries. */

const OPERATOR = "00000000-0000-4000-8000-0000000000aa";
const TASK = "d0000000-0000-4000-8000-000000000001";
const ARTICLE = "a0000000-0000-4000-8000-000000000001";
const root = new URL("../../../", import.meta.url);

const task = (id: string, over: Partial<CalendarTask> = {}): CalendarTask => ({
  id, title: `Task ${id}`, status: "ready", priority: "medium", owningAgent: "content-strategist", sourceKind: "keyword", sourceRef: "q", plannedFor: null, createdAt: "2026-10-03T00:00:00Z", ...over,
});

function memoryStore(options: { setUp?: boolean } = {}) {
  const calls: string[] = [];
  const guard = () => {
    if (options.setUp === false) throw new CalendarStoreNotSetUpError("test");
  };
  const store: CalendarStore = {
    storesCalendar: true,
    async listTasks() {
      guard();
      return [task("t1", { sourceKind: "opportunity", sourceRef: "o-1", plannedFor: "2026-10-12" }), task("t2", { status: "in-progress" }), task("t3")];
    },
    async listLinks() {
      guard();
      return { t2: ARTICLE, t3: "a-other" };
    },
    async opportunities(_projectId, ids) {
      calls.push(`opportunities:${ids.join(",")}`);
      return { "o-1": { score: 75, action: "expand" } };
    },
    async setPlanDate(projectId, taskId, date, operatorId) {
      guard();
      calls.push(`set:${projectId}:${taskId}:${date}:${operatorId}`);
      return { status: "plan-date-changed" };
    },
    async linkArticle(projectId, taskId, articleId, operatorId) {
      guard();
      calls.push(`link:${projectId}:${taskId}:${articleId}:${operatorId}`);
      return { status: "article-linked" };
    },
  };
  return { store, calls };
}

const readers = (over: Partial<CalendarReaders> = {}): CalendarReaders => ({
  articles: async () => [
    { id: ARTICLE, status: "approved", createdAt: "2026-10-02T00:00:00Z" },
    { id: "a-other", status: "drafting", createdAt: "2026-10-03T00:00:00Z" },
    { id: "a-archived", status: "archived", createdAt: "2026-10-01T00:00:00Z" },
  ],
  activeProposalSlug: async (_p, articleId) => (articleId === ARTICLE ? "ai-leads" : null),
  liveOwners: async () => [{ slug: "ai-sdr-tool", articleId: "a-live" }],
  ...over,
});

describe("the calendar service", () => {
  test("a read: every task an item with its derived stage, score and article; the linkable articles, archived left out", async () => {
    const { store, calls } = memoryStore();
    const result = await createCalendarService(store, readers()).read("nexra-agency");
    if (result.status !== "read") return assert.fail("read");
    assert.deepEqual(result.view.items.map((item) => [item.task.id, item.stage, item.score, item.article?.slug ?? null]), [
      ["t1", "approved", 75, null],
      ["t2", "proposal", null, "ai-leads"],
      ["t3", "draft", null, null],
    ]);
    assert.deepEqual([result.view.articlesUnread, result.view.liveUnread], [false, false]);
    assert.deepEqual(result.view.linkable.map((entry) => entry.label), ["Article a-other · drafting", "ai-leads · approved"]);
    assert.deepEqual(calls, ["opportunities:o-1"], "the opportunities read names only the opportunity tasks' sources");
  });

  test("a failed article or live read is said, never guessed: the linked items keep their task's stage", async () => {
    const articles = await createCalendarService(memoryStore().store, readers({ articles: async () => { throw new Error("down"); } })).read("nexra-agency");
    if (articles.status !== "read") return assert.fail("read");
    assert.equal(articles.view.articlesUnread, true);
    assert.deepEqual(articles.view.items.map((item) => [item.stage, item.articleUnread]), [["approved", false], ["research", true], ["approved", true]]);
    const live = await createCalendarService(memoryStore().store, readers({ liveOwners: async () => { throw new Error("down"); } })).read("nexra-agency");
    if (live.status !== "read") return assert.fail("read");
    assert.equal(live.view.liveUnread, true);
  });

  test("not set up: no store, or the migration missing", async () => {
    assert.deepEqual(await createCalendarService(unavailableCalendarStore, readers()).read("nexra-agency"), { status: "not-set-up" });
    assert.deepEqual(await createCalendarService(memoryStore({ setUp: false }).store, readers()).read("nexra-agency"), { status: "not-set-up" });
    assert.deepEqual(await createCalendarService(memoryStore({ setUp: false }).store, readers()).setDate("nexra-agency", TASK, "2026-10-12", OPERATOR), { status: "not-set-up" });
    assert.deepEqual(await createCalendarService(memoryStore({ setUp: false }).store, readers()).linkArticle("nexra-agency", TASK, ARTICLE, OPERATOR), { status: "not-set-up" });
  });

  test("the writes pass project, task, value and operator to the database's functions", async () => {
    const { store, calls } = memoryStore();
    const service = createCalendarService(store, readers());
    assert.deepEqual(await service.setDate("nexra-agency", TASK, null, OPERATOR), { status: "plan-date-changed" });
    assert.deepEqual(await service.linkArticle("nexra-agency", TASK, ARTICLE, OPERATOR), { status: "article-linked" });
    assert.deepEqual(calls, [`set:nexra-agency:${TASK}:null:${OPERATOR}`, `link:nexra-agency:${TASK}:${ARTICLE}:${OPERATOR}`]);
  });
});

describe("the request shapes and rows", () => {
  test("set-date takes a date in range or null; link-article an article id; nothing else", () => {
    assert.deepEqual(parseCalendarRequest({ project: "nexra-agency", action: "set-date", taskId: TASK, date: "2026-10-12" }), { ok: true, action: "set-date", projectId: "nexra-agency", taskId: TASK, date: "2026-10-12" });
    assert.deepEqual(parseCalendarRequest({ project: "nexra-agency", action: "set-date", taskId: TASK, date: null }), { ok: true, action: "set-date", projectId: "nexra-agency", taskId: TASK, date: null });
    assert.deepEqual(parseCalendarRequest({ project: "nexra-agency", action: "link-article", taskId: TASK, articleId: ARTICLE }), { ok: true, action: "link-article", projectId: "nexra-agency", taskId: TASK, articleId: ARTICLE });
    for (const body of [
      null, {}, { project: "nexra-agency", action: "set-date", taskId: TASK }, { project: "nexra-agency", action: "set-date", taskId: TASK, date: "2026-02-30" },
      { project: "nexra-agency", action: "set-date", taskId: TASK, date: "2101-01-01" }, { project: "nexra-agency", action: "set-date", taskId: "x", date: null },
      { project: "nexra-agency", action: "link-article", taskId: TASK, articleId: "x" }, { project: "nexra-agency", action: "publish", taskId: TASK },
      { project: "nexra-agency", action: "set-date", taskId: TASK, date: null, articleId: ARTICLE }, { project: "Bad", action: "set-date", taskId: TASK, date: null },
    ]) assert.equal(parseCalendarRequest(body).ok, false, JSON.stringify(body));
    assert.equal(calendarUrl("nexra-agency"), "/api/calendar?project=nexra-agency");
  });

  test("a task row with its planned date; an unknown field value is refused", () => {
    const row = { id: TASK, title: "T", status: "ready", priority: "high", owning_agent: "writer", source_kind: "opportunity", source_ref: "o-1", planned_for: "2026-10-12", created_at: "2026-10-03T00:00:00Z" };
    assert.equal(calendarTaskRow(row).plannedFor, "2026-10-12");
    assert.equal(calendarTaskRow({ ...row, planned_for: null }).plannedFor, null);
    assert.throws(() => calendarTaskRow({ ...row, status: "published" }));
  });

  test("the task history reads the two new event types with their dates and article", () => {
    assert.deepEqual(TASK_EVENT_TYPES.slice(-2), ["plan-date-changed", "article-linked"]);
    assert.equal(TASK_EVENT_META["plan-date-changed"], "Planned date changed");
    const base = { id: "e", seq: 3, task_id: TASK, project_id: "nexra-agency", from_status: null, to_status: null, from_agent: null, to_agent: null, run_id: null, from_priority: null, to_priority: null, actor: OPERATOR, created_at: "2026-10-03T00:00:00Z" };
    const planned = eventRowToEvent({ ...base, event_type: "plan-date-changed", from_date: null, to_date: "2026-10-12", article_id: null });
    assert.deepEqual([planned.type, planned.fromDate, planned.toDate], ["plan-date-changed", null, "2026-10-12"]);
    assert.equal(eventRowToEvent({ ...base, event_type: "article-linked", from_date: null, to_date: null, article_id: ARTICLE }).articleId, ARTICLE);
    assert.equal(eventRowToEvent({ ...base, event_type: "created" }).articleId, null, "a row from before the migration has no such columns");
  });
});

describe("the boundaries", () => {
  const route = readFileSync(new URL("src/app/api/calendar/route.ts", root), "utf8");
  const wiring = readFileSync(new URL("src/lib/calendar/index.ts", root), "utf8");
  const store = readFileSync(new URL("src/lib/calendar/supabase/store.ts", root), "utf8");

  test("the route checks the operator, the request and the project; writes are same-origin and limited; not set up is a 503", () => {
    assert.match(route, /export async function GET[\s\S]*getOperator\(\)[\s\S]*isCalendarProjectId[\s\S]*calendarLimiter\("read"\)/);
    assert.match(route, /export async function POST[\s\S]*isSameOrigin\(request\)[\s\S]*getOperator\(\)[\s\S]*parseCalendarRequest[\s\S]*calendarLimiter\("write"\)[\s\S]*projectRepository\.getProjectById/);
    assert.match(route, /errorResponse\("not-set-up", 503\)/);
  });

  test("nothing here runs an agent, writes an article or publishes; the server modules are server-only", () => {
    for (const source of [route, wiring, store]) assert.doesNotMatch(source, /agent-runs\/(worker|lifecycle|index)|\.propose\(|\.withdraw\(|saveVersion|fetch\(/);
    assert.match(wiring, /^import "server-only";/);
    assert.match(store, /^import "server-only";/);
    assert.match(store, /"42703"/, "a missing planned_for column reads as not set up");
  });
});
