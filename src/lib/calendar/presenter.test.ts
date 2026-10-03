import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { calendarItems, type CalendarInput } from "@/lib/calendar/calendar";
import { dayLabel, itemDetail, monthLabel, stageLabel, suggestConfirmation, tabState, viewNotes, writeOutcome, NOT_SET_UP_TITLE } from "@/lib/calendar/presenter";

/** M3, PR 4: what the Calendar tab says for every answer, and where it is mounted. */

const root = new URL("../../../", import.meta.url);
const INPUT: CalendarInput = {
  tasks: [
    { id: "t1", title: "Expand the follow-up article", status: "blocked", priority: "high", owningAgent: "content-strategist", sourceKind: "opportunity", sourceRef: "o-1", plannedFor: "2026-10-12", createdAt: "2026-10-03T00:00:00Z" },
    { id: "t2", title: "Write the receptionist article", status: "ready", priority: "high", owningAgent: "content-strategist", sourceKind: "keyword", sourceRef: "q", plannedFor: null, createdAt: "2026-10-03T00:00:00Z" },
  ],
  links: { t2: "a-1" },
  articles: [{ id: "a-1", slug: "ai-receptionist-for-small-business", title: null, status: "drafting" }],
  proposedArticleIds: [],
  liveOwners: [],
  opportunities: { "o-1": { score: 75, action: "expand" } },
};
const [blocked, linked] = calendarItems(INPUT);

describe("the Calendar tab's words", () => {
  test("503 is not set up; failures in words; a good answer is ready", () => {
    assert.deepEqual(tabState(503, {}), { status: "not-set-up" });
    assert.equal(NOT_SET_UP_TITLE, "Not set up yet");
    assert.equal(tabState(500, {}).status, "failed");
    assert.equal(tabState(200, { view: { items: [] } }).status, "failed", "a view without linkable is refused");
    assert.equal(tabState(200, { view: { projectId: "x", items: [], linkable: [], articlesUnread: false, liveUnread: false } }).status, "ready");
  });

  test("stage, detail, month and day labels", () => {
    assert.equal(stageLabel(blocked!), "Research · blocked");
    assert.equal(itemDetail(blocked!), "Article expansion · score 75");
    assert.equal(itemDetail(linked!), "Task · /blog/ai-receptionist-for-small-business");
    assert.equal(monthLabel("2026-10"), "October 2026");
    assert.equal(dayLabel("2026-10-05"), "5 Oct");
    assert.deepEqual(viewNotes({ projectId: "x", items: [], linkable: [], articlesUnread: true, liveUnread: true }).length, 2);
  });

  test("the suggestion confirmation lists each date and task and says nothing runs", () => {
    const c = suggestConfirmation("nexra-agency", [{ taskId: "t2", title: "Write the receptionist article", date: "2026-10-05" }]);
    assert.deepEqual(c.facts, [{ label: "Project", value: "nexra-agency" }, { label: "5 Oct", value: "Write the receptionist article" }]);
    assert.equal(c.confirmLabel, "Plan 1 date");
    assert.match(c.consequence, /Nothing runs or publishes/);
    assert.equal(c.usage, null);
  });

  test("every write answer has words", () => {
    assert.match(writeOutcome(200, { status: "plan-date-changed" }).text, /saved/);
    assert.match(writeOutcome(200, { status: "article-linked" }).text, /linked/);
    assert.match(writeOutcome(200, { status: "same-date" }).text, /already/);
    assert.match(writeOutcome(409, { error: "terminal" }).text, /completed or cancelled/);
    assert.match(writeOutcome(404, { error: "article-not-found" }).text, /archived/);
    assert.match(writeOutcome(503, {}).text, /20261022120000/);
    assert.match(writeOutcome(0, null).text, /Nothing is known/);
  });
});

describe("the screen", () => {
  const component = readFileSync(new URL("src/components/content/content-calendar.tsx", root), "utf8");
  const studio = readFileSync(new URL("src/components/content/observed-content.tsx", root), "utf8");

  test("mounted as the Calendar tab on its own read, before the stored content's reads", () => {
    assert.match(studio, /if \(tab === "calendar"\) return <ContentCalendar projectId=\{projectId\} \/>;\n  return <StudioRecordsTab/);
    assert.match(component, /fetch\(calendarUrl\(projectId\)/);
    assert.match(component, /NOT_SET_UP_TITLE/);
  });

  test("the only writes are set-date and link-article; suggestions go through the confirmation first", () => {
    assert.equal((component.match(/method: "POST"/g) ?? []).length, 1);
    assert.match(component, /action: "set-date"/);
    assert.match(component, /action: "link-article"/);
    assert.doesNotMatch(component, /agent-runs\/|\/api\/content-article|propose|approve/);
    assert.match(component, /<SpendConfirmDialog[\s\S]*suggestConfirmation\(projectId, suggesting\)/);
  });
});
