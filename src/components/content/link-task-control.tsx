"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { calendarUrl } from "@/lib/calendar/contract";
import { LINK_TASK_NOT_SET_UP, LINK_TASK_TITLE, READ_FAILED, linkChoices, stageLabel, stageTone, tabState, writeOutcome, type TabState } from "@/lib/calendar/presenter";

/**
 * *Link to a task…* on an article's pages (M3, PR 5): the tasks this article carries out, and a choice of the project's
 * open tasks to link it to. One read of the calendar route; one write, the calendar's `link-article` action, which
 * records an event on the task and changes no article. Before migration 20261022120000 it says linking is not set up.
 */
export function LinkTaskControl({ projectId, articleId }: { projectId: string; articleId: string }) {
  const [state, setState] = useState<TabState>({ status: "loading" });
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [note, setNote] = useState<{ text: string; tone: "neutral" | "warning" } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(calendarUrl(projectId), { cache: "no-store", signal: controller.signal })
      .then(async (response) => setState(tabState(response.status, await response.json().catch(() => null))))
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setState(READ_FAILED);
      });
    return () => controller.abort();
  }, [projectId, version]);

  const link = async () => {
    if (inFlight.current || choice === "") return;
    inFlight.current = true;
    setBusy(true);
    try {
      const response = await fetch("/api/calendar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project: projectId, action: "link-article", taskId: choice, articleId }), cache: "no-store" });
      setNote(writeOutcome(response.status, await response.json().catch(() => null)));
    } catch {
      setNote(writeOutcome(0, null));
    }
    inFlight.current = false;
    setBusy(false);
    setChoice("");
    reload();
  };

  return (
    <div className="space-y-2 text-xs" aria-label={LINK_TASK_TITLE}>
      <div className="font-medium text-fg">{LINK_TASK_TITLE}</div>
      {state.status === "loading" && <p className="text-fg-muted">Reading the project&apos;s tasks…</p>}
      {state.status === "not-set-up" && <p className="text-fg-muted">{LINK_TASK_NOT_SET_UP}</p>}
      {state.status === "failed" && <p className="text-critical">{state.message}</p>}
      {state.status === "ready" &&
        (() => {
          const { linked, open } = linkChoices(state.view, articleId);
          return (
            <>
              {linked.length === 0 ? (
                <p className="text-fg-muted">No task is linked to this article.</p>
              ) : (
                <ul className="space-y-1">
                  {linked.map((item) => (
                    <li key={item.task.id} className="flex flex-wrap items-center gap-2">
                      <Badge tone={stageTone(item.stage)}>{stageLabel(item)}</Badge>
                      <span className="text-fg">{item.task.title}</span>
                      <span className="text-fg-muted">{item.task.plannedFor === null ? "no planned date" : `planned for ${item.task.plannedFor}`}</span>
                    </li>
                  ))}
                </ul>
              )}
              {open.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <div className="w-72 max-w-full">
                    <Select size="sm" value={choice} onChange={(event) => setChoice(event.target.value)} aria-label="Task to link this article to" options={[{ value: "", label: "Link to a task…" }, ...open.map((item) => ({ value: item.task.id, label: item.task.title }))]} />
                  </div>
                  <Button size="sm" variant="secondary" disabled={busy || choice === ""} onClick={() => void link()}>
                    Link
                  </Button>
                </div>
              )}
              {note && (
                <p className={note.tone === "warning" ? "text-warning" : "text-fg-muted"} role="status">
                  {note.text}
                </p>
              )}
            </>
          );
        })()}
    </div>
  );
}
