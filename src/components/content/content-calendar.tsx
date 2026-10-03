"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SpendConfirmDialog } from "@/components/spend/spend-confirm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Select, TextInput } from "@/components/ui/field";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { monthGrid, shiftMonth, suggestDates, type CalendarItem, type SuggestedDate } from "@/lib/calendar/calendar";
import { calendarUrl, type CalendarView } from "@/lib/calendar/contract";
import {
  CALENDAR_NOTE,
  NO_TASKS_COPY,
  NO_TASKS_TITLE,
  NOT_SET_UP_COPY,
  NOT_SET_UP_TITLE,
  READ_FAILED,
  SUGGEST_LABEL,
  dayLabel,
  itemDetail,
  monthLabel,
  stageLabel,
  stageTone,
  suggestConfirmation,
  tabState,
  viewNotes,
  writeOutcome,
  type TabState,
} from "@/lib/calendar/presenter";

/**
 * The *Calendar* tab in Content Studio (M3, PR 4). One read of its own, `GET /api/calendar`; a deployment without the
 * migration reads "Not set up yet" and the other tabs are untouched (the F0 rule). The stage of each item is derived
 * from its task and linked article. The only writes are a planned date and an article link — one database function
 * each, recording an event on the task; *Suggest dates…* shows its proposal first and saves nothing until confirmed.
 */

type Note = { readonly text: string; readonly tone: "neutral" | "warning" };

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ContentCalendar({ projectId }: { projectId: string }) {
  const [state, setState] = useState<TabState>({ status: "loading" });
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const [month, setMonth] = useState(() => todayUtc().slice(0, 7));
  const [note, setNote] = useState<Note | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [suggesting, setSuggesting] = useState<readonly SuggestedDate[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loading state belongs to this read
    setState((current) => (current.status === "ready" ? current : { status: "loading" }));
    fetch(calendarUrl(projectId), { cache: "no-store", signal: controller.signal })
      .then(async (response) => setState(tabState(response.status, await response.json().catch(() => null))))
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setState(READ_FAILED);
      });
    return () => controller.abort();
  }, [projectId, version]);

  const view = state.status === "ready" ? state.view : null;
  const grid = useMemo(() => (view === null ? null : monthGrid(month, view.items)), [view, month]);

  /** One or more writes in order; each answer in words; then the calendar is read again. */
  const send = async (bodies: readonly Record<string, unknown>[]) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setNote(null);
    let last: Note = { text: "", tone: "neutral" };
    let saved = 0;
    for (const body of bodies) {
      try {
        const response = await fetch("/api/calendar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project: projectId, ...body }), cache: "no-store" });
        last = writeOutcome(response.status, await response.json().catch(() => null));
      } catch {
        last = writeOutcome(0, null);
      }
      if (last.tone === "warning") break;
      saved += 1;
    }
    setNote(bodies.length > 1 ? { text: `${saved} of ${bodies.length} dates planned.${last.tone === "warning" ? ` Stopped: ${last.text}` : ""}`, tone: last.tone } : last);
    inFlight.current = false;
    setBusy(false);
    reload();
  };

  const planDate = (taskId: string, date: string | null) => void send([{ action: "set-date", taskId, date }]);
  const linkArticle = (taskId: string, articleId: string) => void send([{ action: "link-article", taskId, articleId }]);

  return (
    <Panel>
      <PanelHeader
        eyebrow="Derived from tasks and articles"
        title="Calendar"
        description={CALENDAR_NOTE}
        actions={
          view !== null && grid !== null ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" icon="arrow-left" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Previous month">
                {""}
              </Button>
              <span className="min-w-[8rem] text-center text-sm font-medium text-fg" aria-live="polite">
                {monthLabel(month)}
              </span>
              <Button variant="ghost" icon="arrow-right" onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label="Next month">
                {""}
              </Button>
              <Button variant="secondary" icon="calendar" disabled={busy || grid.unscheduled.length === 0} onClick={() => setSuggesting(suggestDates(view.items, todayUtc()))}>
                {SUGGEST_LABEL}
              </Button>
            </div>
          ) : undefined
        }
      />
      <PanelBody>
        {state.status === "loading" && (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-64 w-full" />
          </div>
        )}
        {state.status === "not-set-up" && <EmptyState size="sm" icon="calendar" title={NOT_SET_UP_TITLE} description={NOT_SET_UP_COPY} />}
        {state.status === "failed" && (
          <p className="text-sm text-critical" role="status">
            {state.message}
          </p>
        )}
        {view !== null && grid !== null && (
          <div className="space-y-4">
            {viewNotes(view).map((line) => (
              <p key={line} className="text-xs text-warning" role="status">
                {line}
              </p>
            ))}
            {note && (
              <p className={note.tone === "warning" ? "text-xs text-warning" : "text-xs text-fg-muted"} role="status">
                {note.text}
              </p>
            )}
            {view.items.length === 0 ? (
              <EmptyState size="sm" icon="calendar" title={NO_TASKS_TITLE} description={NO_TASKS_COPY} />
            ) : (
              <>
                <MonthGridView grid={grid} />
                <ItemList
                  title={`Planned in ${monthLabel(month)}`}
                  empty="Nothing is planned in this month."
                  items={grid.weeks.flat().filter((day) => day.inMonth).flatMap((day) => day.items)}
                  view={view}
                  busy={busy}
                  onDate={planDate}
                  onLink={linkArticle}
                />
                <ItemList title="Not planned yet" empty="Every open item has a date." items={grid.unscheduled} view={view} busy={busy} onDate={planDate} onLink={linkArticle} />
                <p className="text-xs text-fg-muted">
                  {grid.elsewhere > 0 ? `${grid.elsewhere} planned item${grid.elsewhere === 1 ? "" : "s"} fall outside this view. ` : ""}
                  {grid.cancelled.length > 0 ? `${grid.cancelled.length} cancelled task${grid.cancelled.length === 1 ? "" : "s"} not shown.` : ""}
                </p>
              </>
            )}
          </div>
        )}
      </PanelBody>
      {view !== null && (
        <PanelFooter>
          <span>Stages are derived on read: the task&apos;s status and the linked article&apos;s check, approval, proposal and live records. Dates are planned in UTC.</span>
        </PanelFooter>
      )}
      {suggesting !== null && suggesting.length > 0 && (
        <SpendConfirmDialog
          confirmation={suggestConfirmation(projectId, suggesting)}
          projectId={null}
          busy={busy}
          onClose={() => setSuggesting(null)}
          onConfirm={() => {
            const chosen = suggesting;
            setSuggesting(null);
            void send(chosen.map((s) => ({ action: "set-date", taskId: s.taskId, date: s.date })));
          }}
        />
      )}
    </Panel>
  );
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function MonthGridView({ grid }: { grid: ReturnType<typeof monthGrid> }) {
  return (
    <div className="hidden overflow-hidden rounded-md border border-border md:block" role="grid" aria-label="Month">
      <div className="grid grid-cols-7 border-b border-border bg-surface-raised text-[11px] font-medium uppercase tracking-wide text-fg-subtle" role="row">
        {WEEKDAYS.map((day) => (
          <div key={day} className="px-2 py-1.5" role="columnheader">
            {day}
          </div>
        ))}
      </div>
      {grid.weeks.map((week) => (
        <div key={week[0]!.date} className="grid grid-cols-7 border-b border-border last:border-b-0" role="row">
          {week.map((day) => (
            <div key={day.date} className={`min-h-[5.5rem] border-r border-border p-1.5 last:border-r-0 ${day.inMonth ? "" : "bg-surface-raised/40 text-fg-subtle"}`} role="gridcell">
              <div className="text-[11px] text-fg-subtle">{Number(day.date.slice(8))}</div>
              <ul className="mt-1 space-y-1">
                {day.items.map((item) => (
                  <li key={item.task.id} className="rounded border border-border px-1.5 py-1 text-[11px] leading-snug" title={`${item.task.title} — ${stageLabel(item)}`}>
                    <div className="line-clamp-2 text-fg">{item.task.title}</div>
                    <Badge tone={stageTone(item.stage)}>{stageLabel(item)}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ItemList({
  title,
  empty,
  items,
  view,
  busy,
  onDate,
  onLink,
}: {
  title: string;
  empty: string;
  items: readonly CalendarItem[];
  view: CalendarView;
  busy: boolean;
  onDate: (taskId: string, date: string | null) => void;
  onLink: (taskId: string, articleId: string) => void;
}) {
  return (
    <section className="space-y-2" aria-label={title}>
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-fg-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {items.map((item) => (
            <ItemRow key={item.task.id} item={item} view={view} busy={busy} onDate={onDate} onLink={onLink} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ItemRow({ item, view, busy, onDate, onLink }: { item: CalendarItem; view: CalendarView; busy: boolean; onDate: (taskId: string, date: string | null) => void; onLink: (taskId: string, articleId: string) => void }) {
  const [date, setDate] = useState(item.task.plannedFor ?? "");
  const [article, setArticle] = useState("");
  const open = item.task.status !== "completed" && item.task.status !== "cancelled";
  const options = view.linkable.filter((entry) => entry.id !== item.article?.id);
  return (
    <li className="flex flex-col gap-2 p-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={stageTone(item.stage)}>{stageLabel(item)}</Badge>
          <span className="break-words text-sm font-medium text-fg">{item.task.title}</span>
        </div>
        <div className="mt-1 break-words text-xs text-fg-muted [overflow-wrap:anywhere]">
          {item.task.plannedFor === null ? "No planned date" : `Planned for ${dayLabel(item.task.plannedFor)} ${item.task.plannedFor.slice(0, 4)}`} · {itemDetail(item)}
        </div>
      </div>
      {open && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-40">
            <TextInput type="date" size="sm" value={date} min="2020-01-01" max="2099-12-31" onChange={(event) => setDate(event.target.value)} aria-label={`Planned date for ${item.task.title}`} />
          </div>
          <Button size="sm" variant="secondary" disabled={busy || date === "" || date === item.task.plannedFor} onClick={() => onDate(item.task.id, date)}>
            Save date
          </Button>
          {item.task.plannedFor !== null && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDate(item.task.id, null)}>
              Clear
            </Button>
          )}
          {options.length > 0 && (
            <>
              <div className="w-52">
                <Select size="sm" value={article} onChange={(event) => setArticle(event.target.value)} aria-label={`Article for ${item.task.title}`} options={[{ value: "", label: item.article === null ? "Link an article…" : "Link another article…" }, ...options.map((entry) => ({ value: entry.id, label: entry.label }))]} />
              </div>
              <Button size="sm" variant="secondary" disabled={busy || article === ""} onClick={() => onLink(item.task.id, article)}>
                Link
              </Button>
            </>
          )}
        </div>
      )}
    </li>
  );
}
