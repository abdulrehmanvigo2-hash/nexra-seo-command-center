import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  addDays,
  calendarItems,
  isDate,
  isMonth,
  mondayOf,
  monthGrid,
  nextMonday,
  shiftMonth,
  STAGE_LABEL,
  suggestDates,
  type CalendarInput,
  type CalendarTask,
} from "@/lib/calendar/calendar";

/** M3, PR 2: the stage of every record combination, the month grid and the date suggestions. Pure; no store. */

const task = (id: string, over: Partial<CalendarTask> = {}): CalendarTask => ({
  id,
  title: `Task ${id}`,
  status: "backlog",
  priority: "medium",
  owningAgent: "content-strategist",
  sourceKind: "keyword",
  sourceRef: "ai lead follow up",
  plannedFor: null,
  createdAt: `2026-10-0${Math.min(9, Number(id.slice(1)) || 1)}T00:00:00Z`,
  ...over,
});

const INPUT: CalendarInput = {
  tasks: [
    task("t1", { sourceKind: "opportunity", sourceRef: "o-1", title: "Expand /blog/ai-lead-follow-up-automation for AI lead follow-up" }),
    task("t2", { sourceKind: "opportunity", sourceRef: "o-2", status: "ready", plannedFor: "2026-10-12" }),
    task("t3", { status: "in-progress" }),
    task("t4", { status: "in-progress" }),
    task("t5", { status: "completed", plannedFor: "2026-10-01" }),
    task("t6", { status: "blocked", priority: "high" }),
    task("t7", { status: "cancelled", plannedFor: "2026-10-20" }),
    task("t8", { status: "completed" }),
    task("t9", { status: "review" }),
    task("t10", { status: "in-progress" }),
    task("t11", {}),
  ],
  links: { t2: "a-draft", t4: "a-proposed", t5: "a-live", t9: "a-checked", t10: "a-approved", t11: "a-archived" },
  articles: [
    { id: "a-draft", slug: "ai-receptionist-for-small-business", title: "AI receptionist", status: "drafting" },
    { id: "a-proposed", slug: "ai-leads", title: null, status: "approved" },
    { id: "a-live", slug: "ai-sdr-tool", title: null, status: "approved" },
    { id: "a-checked", slug: "x", title: null, status: "checked" },
    { id: "a-approved", slug: "y", title: null, status: "approved" },
    { id: "a-archived", slug: "z", title: null, status: "archived" },
  ],
  proposedArticleIds: ["a-proposed", "a-live"],
  liveOwners: [{ slug: "ai-sdr-tool", articleId: "a-live" }],
  opportunities: { "o-1": { score: 75, action: "expand" }, "o-2": { score: 60, action: "write" } },
};

describe("the stage, derived on read", () => {
  const items = calendarItems(INPUT);
  const by = (id: string) => items.find((item) => item.task.id === id)!;

  test("every row of the design note's table", () => {
    assert.deepEqual(
      items.map((item) => [item.task.id, item.stage]),
      [
        ["t1", "proposed"],
        ["t2", "draft"],
        ["t3", "research"],
        ["t4", "proposal"],
        ["t5", "published"],
        ["t6", "research"],
        ["t7", "cancelled"],
        ["t8", "done"],
        ["t9", "review"],
        ["t10", "ready"],
        ["t11", "proposed"],
      ],
    );
  });

  test("a live slug wins over an active proposal; an archived article reads as not linked; blocked is flagged", () => {
    assert.equal(by("t5").stage, "published");
    assert.equal(by("t11").article, null);
    assert.equal(by("t6").blocked, true);
    assert.equal(by("t3").blocked, false);
  });

  test("an opportunity task carries its score and content type; another task is a Task with no score", () => {
    assert.deepEqual([by("t1").score, by("t1").contentType], [75, "Article expansion"]);
    assert.deepEqual([by("t2").score, by("t2").contentType], [60, "New article"]);
    assert.deepEqual([by("t3").score, by("t3").contentType], [null, "Task"]);
  });

  test("articles unread: a linked task's stage is its own, flagged, never guessed from the article", () => {
    const unread = calendarItems({ ...INPUT, articles: null });
    const t2 = unread.find((item) => item.task.id === "t2")!;
    assert.deepEqual([t2.stage, t2.articleUnread, t2.article], ["approved", true, null]);
    assert.equal(unread.find((item) => item.task.id === "t3")!.articleUnread, false);
    assert.equal(STAGE_LABEL.proposal, "Publication proposal");
  });
});

describe("dates", () => {
  test("validation, Mondays and month shifts in UTC", () => {
    assert.ok(isDate("2026-10-12") && !isDate("2026-02-30") && !isDate("2026-10-1") && !isDate(20261012));
    assert.ok(isMonth("2026-10") && !isMonth("2026-13") && !isMonth("2026-1"));
    assert.equal(mondayOf("2026-10-03"), "2026-09-28", "a Saturday's Monday");
    assert.equal(mondayOf("2026-10-05"), "2026-10-05", "a Monday is its own");
    assert.equal(mondayOf("2026-10-11"), "2026-10-05", "a Sunday belongs to the week before");
    assert.equal(nextMonday("2026-10-03"), "2026-10-05");
    assert.equal(nextMonday("2026-10-05"), "2026-10-12", "strictly after");
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    assert.deepEqual([shiftMonth("2026-12", 1), shiftMonth("2026-01", -1)], ["2027-01", "2025-12"]);
  });

  test("October 2026: five Monday-first weeks from 28 Sep to 1 Nov; items on their dates; unscheduled, elsewhere and cancelled apart", () => {
    const grid = monthGrid("2026-10", calendarItems(INPUT));
    assert.equal(grid.weeks.length, 5);
    assert.deepEqual([grid.weeks[0]![0]!.date, grid.weeks[4]![6]!.date], ["2026-09-28", "2026-11-01"]);
    assert.equal(grid.weeks[0]![0]!.inMonth, false);
    assert.equal(grid.weeks.flat().find((day) => day.date === "2026-10-12")!.items[0]!.task.id, "t2");
    assert.equal(grid.weeks.flat().find((day) => day.date === "2026-10-20")!.items.length, 0, "a cancelled item is not on the grid");
    assert.deepEqual(grid.unscheduled.map((item) => item.task.id), ["t1", "t6", "t3", "t4", "t10", "t11", "t9"], "open and unscheduled, by score, priority, age, then id");
    assert.deepEqual(grid.cancelled.map((item) => item.task.id), ["t7"]);
    assert.equal(grid.elsewhere, 0);
    assert.equal(monthGrid("2026-12", calendarItems(INPUT)).elsewhere, 2, "October's two planned items are elsewhere when December is shown");
  });
});

describe("Suggest dates", () => {
  const items = calendarItems(INPUT);

  test("one a week on Mondays from the next Monday, by score, skipping the week already holding a planned item", () => {
    const out = suggestDates(items, "2026-10-03");
    assert.deepEqual(out.slice(0, 4).map((s) => [s.taskId, s.date]), [
      ["t1", "2026-10-05"],
      ["t6", "2026-10-19"],
      ["t3", "2026-10-26"],
      ["t4", "2026-11-02"],
    ]);
    assert.equal(out.length, 7, "every open unscheduled item: t1, t6, t3, t4, t9, t10, t11");
    assert.ok(!out.some((s) => ["t2", "t5", "t7", "t8"].includes(s.taskId)), "never a planned, published, cancelled or completed one");
  });

  test("two a week and a limit", () => {
    assert.deepEqual(suggestDates(items, "2026-10-03", { perWeek: 2 }).slice(0, 3).map((s) => s.date), ["2026-10-05", "2026-10-05", "2026-10-12"]);
    assert.equal(suggestDates(items, "2026-10-03", { limit: 2 }).length, 2);
    assert.deepEqual(suggestDates([], "2026-10-03"), []);
  });

  test("deterministic and pure", () => {
    assert.deepEqual(suggestDates(items, "2026-10-03"), suggestDates(calendarItems(INPUT), "2026-10-03"));
    const source = readFileSync(new URL("./calendar.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /server-only|supabase|fetch\(|Date\.now\(|new Date\(\)/);
  });
});
