import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { calendarItems, type CalendarInput } from "@/lib/calendar/calendar";
import { linkChoices, LINK_TASK_NOT_SET_UP } from "@/lib/calendar/presenter";

/** M3, PR 5: *Link to a task…* on the article detail and the editor. */

const root = new URL("../../../", import.meta.url);
const base = { priority: "medium", owningAgent: "content-strategist", sourceKind: "keyword", sourceRef: "q", plannedFor: null, createdAt: "2026-10-03T00:00:00Z" } as const;
const INPUT: CalendarInput = {
  tasks: [
    { ...base, id: "t1", title: "Linked here", status: "in-progress", plannedFor: "2026-10-12" },
    { ...base, id: "t2", title: "Open, not linked", status: "ready" },
    { ...base, id: "t3", title: "Linked elsewhere", status: "backlog" },
    { ...base, id: "t4", title: "Done", status: "completed" },
    { ...base, id: "t5", title: "Cancelled", status: "cancelled" },
  ],
  links: { t1: "a-1", t3: "a-2" },
  articles: [
    { id: "a-1", slug: null, title: null, status: "drafting" },
    { id: "a-2", slug: null, title: null, status: "checked" },
  ],
  proposedArticleIds: [],
  liveOwners: [],
  opportunities: {},
};
const view = { projectId: "nexra-agency", items: calendarItems(INPUT), articlesUnread: false, liveUnread: false, linkable: [] };

describe("Link to a task", () => {
  test("the tasks linked to this article, and the open tasks it could be linked to (another article's included; completed and cancelled not)", () => {
    const { linked, open } = linkChoices(view, "a-1");
    assert.deepEqual(linked.map((item) => item.task.id), ["t1"]);
    assert.deepEqual(open.map((item) => item.task.id), ["t2", "t3"]);
    assert.match(LINK_TASK_NOT_SET_UP, /20261022120000/);
  });

  test("mounted on the article detail and in the editor's edit mode; its one write is link-article", () => {
    const control = readFileSync(new URL("src/components/content/link-task-control.tsx", root), "utf8");
    const detail = readFileSync(new URL("src/components/content/observed-content.tsx", root), "utf8");
    const editor = readFileSync(new URL("src/components/content/article-panel.tsx", root), "utf8");
    assert.match(detail, /<LinkTaskControl projectId=\{projectId\} articleId=\{articleId\} \/>/);
    assert.match(editor, /mode\.kind === "edit" && \([\s\S]{0,120}<LinkTaskControl projectId=\{projectId\} articleId=\{mode\.history\.article\.id\} \/>/);
    assert.equal((control.match(/method: "POST"/g) ?? []).length, 1);
    assert.match(control, /action: "link-article"/);
    assert.doesNotMatch(control, /set-date|propose|approve|saveVersion/);
    assert.doesNotMatch(detail, /method: "POST"/, "the detail page itself still writes nothing; the control does");
  });
});
