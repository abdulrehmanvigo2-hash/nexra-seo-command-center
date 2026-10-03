# M3 — Content calendar: design note

**Status (3 Oct 2026):** merged (PR #123–#127) and live — migration `20261022120000` applied to production and
recorded after manual backup run `37128565711` (45 history rows). No date is set and no article is linked yet.

The third milestone of `docs/roadmap/NEXT-FOUR-PLAN.md` (approved 3 Oct 2026 with every default accepted). It turns
accepted work (M2's opportunity tasks, and any other task) into a dated plan the owner can see month by month, each
item showing the stage it has reached — read from the task and the article linked to it. It never publishes, queues
no agent run and calls no provider.

## Decisions (from the plan's table, accepted)

- **No new lifecycle.** The stage is derived on read from the task's status and its linked article's records; no
  calendar table and no calendar status exist.
- **The owner sets dates.** *Suggest dates* proposes one item a week by score; nothing is saved until the owner
  confirms.
- **Location:** a *Calendar* tab in Content Studio.
- **No AI step.**

## The stage (derived on read, in this order)

| Records | Stage |
|---|---|
| The linked article's slug is live and the records name this article as its owner | **Published** |
| The linked article has an active publication proposal | **Publication proposal** |
| The linked article is `approved` | **Ready** |
| The linked article is `checked` | **Review** |
| The linked article is `drafting` | **Draft** |
| No article linked; task `backlog` | **Proposed** |
| No article linked; task `ready` | **Approved** |
| No article linked; task `in-progress`, `blocked` or `review` | **Research** (blocked is flagged) |
| No article linked; task `completed` | **Done** |
| Task `cancelled` | **Cancelled** (listed apart) |

An archived linked article reads as not linked. A link whose article cannot be read says so; it is never guessed.

## Data model (migration `20261022120000_content_calendar.sql`, PR 1)

- `nexra_agent_tasks.planned_for date` (nullable; 2020-01-01 to 2099-12-31). The update guard is unchanged in rule —
  any change needs the functions' transaction flag — and its message names the new function.
- `nexra_agent_task_events` gains `from_date`, `to_date` (dates) and `article_id` (a foreign key to
  `nexra_articles`), and two event types:
  - `plan-date-changed` — `from_date` and `to_date`, at least one set and the two different (setting, moving or
    clearing a date);
  - `article-linked` — `article_id`.
  Every earlier type keeps its shape with the three new columns null.
- `nexra_agent_task_set_plan_date(p_project_id, p_task_id, p_planned_for date, p_operator)` — `security definer`,
  empty `search_path`, the task row lock: `plan-date-changed`, `task-not-found`, `same-date`, `terminal` (completed or
  cancelled); a null date clears it; a date outside the range raises 22023.
- `nexra_agent_task_link_article(p_project_id, p_task_id, p_article_id, p_operator)` — the same shape:
  `article-linked`, `task-not-found`, `article-not-found` (another project's, unknown or archived — never which),
  `same-article` (the newest link already names it), `terminal`. A later link replaces an earlier one (the newest
  event wins); the task row itself does not change.
- `service_role`: EXECUTE on the two functions; no table grant changes. Harness suites `calendar` and
  `calendar-upgrade`; the security definer inventory names both.

## Library (PR 2)

`src/lib/calendar/`: pure and client-safe — the stage of a task from its records (the table above), a month's grid
(weeks Monday-first, items on their dates, the unscheduled and cancelled apart), and *Suggest dates*: the unscheduled,
open items by score (an opportunity task's accepted score; others after, by priority then age), one a week on the
Monday of each week from the next Monday on, skipping weeks that already hold a planned item, at most twelve.

## Routes (PR 3)

- `GET /api/calendar?project=&month=YYYY-MM` (operator, read limit): the project's tasks with their planned dates,
  the newest article link of each, the linked articles' status, active proposals and live slugs, and the accepted
  opportunities' scores and actions — as one view with every item's stage. A database without the migration answers
  503 `not-set-up`.
- `POST /api/calendar { project, action: "set-date", taskId, date | null }` and `{ project, action: "link-article",
  taskId, articleId }` (operator, same origin, the task routes' write limit).
- The task contract learns the two event types; the task history shows them ("Planned for 12 Oct", "Linked article
  …").

## Screen (PR 4)

A *Calendar* tab in Content Studio: a month grid on desktop (a list on phones), the month's items on their dates with
their stage, the unscheduled items beneath with *Set date* and *Link article*, and *Suggest dates…* (a preview of the
proposed dates; confirming saves each through the set-date action). Before the migration is applied the tab reads
**Not set up yet** and the other tabs are untouched.

## Link article from the article (PR 5)

On the article detail page (`/content/[articleId]`) and the article editor: *Link to a task…* lists the project's open
tasks and links the article to the one chosen (the same POST). The calendar then shows the article's stage on that
task.

## Pull requests (stacked drafts on M2 PR 6, one change each)

1. This note, migration `20261022120000` and its harness suites.
2. The calendar library.
3. Routes, the store and the task contract's two event types.
4. The Calendar tab.
5. *Link to a task…* on the article detail and the editor.
