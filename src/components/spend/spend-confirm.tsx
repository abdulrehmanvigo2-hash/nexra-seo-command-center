"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  cancelConfirmation,
  cancelOffered,
  cancelOutcome,
  fetchDailyUsage,
  usageHeading,
  usageLines,
  type Confirmation,
  type UsageState,
} from "@/lib/agent-runs/spend-confirm";
import type { AgentRun } from "@/types/agent-run";

/**
 * The confirmation every spending control opens first (fix F3, audit A4-01,
 * A4-02): what will run, for which project and record, today's use of the
 * daily caps, and what the click costs. Confirm sends the control's own
 * request, unchanged; Go back, Escape or the backdrop send nothing.
 */

/** Today's cap usage for a project, read once each time a dialog opens. */
export function useDailyUsage(projectId: string | null, active: boolean): UsageState {
  const [state, setState] = useState<UsageState>({ status: "loading" });
  useEffect(() => {
    if (!active || projectId === null) return;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loading state belongs to this read
    setState({ status: "loading" });
    fetchDailyUsage(projectId, fetch, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setState(next);
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "failed" });
      });
    return () => controller.abort();
  }, [projectId, active]);
  return state;
}

export function SpendConfirmDialog({
  confirmation,
  projectId,
  busy = false,
  onConfirm,
  onClose,
  children,
}: {
  confirmation: Confirmation;
  /** The project whose usage is shown; the dialog reads it when the action spends a daily count. */
  projectId: string | null;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  /** An extra block beneath the consequence — a spend reading the action's own usage route (F0's provider spend). */
  children?: ReactNode;
}) {

  return (
    <Modal
      title={confirmation.title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {confirmation.dismissLabel}
          </Button>
          <Button variant={confirmation.tone === "danger" ? "danger" : "primary"} onClick={onConfirm} disabled={busy} aria-busy={busy}>
            {confirmation.confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-[12.5px]">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          {confirmation.facts.map((fact) => (
            <div key={fact.label} className="contents">
              <dt className="text-fg-subtle">{fact.label}</dt>
              <dd className="min-w-0 break-words text-fg">{fact.value}</dd>
            </div>
          ))}
        </dl>

        <p className="leading-relaxed text-fg-muted">{confirmation.consequence}</p>

        {children}

        {confirmation.usage !== null && projectId !== null && <DailyUsageBlock projectId={projectId} limit={confirmation.usage} />}
      </div>
    </Modal>
  );
}

/**
 * Today's use of the daily caps for one project, read when it mounts: shown
 * in every spending confirmation, and in the task handoff's own confirmation.
 */
export function DailyUsageBlock({ projectId, limit }: { projectId: string; limit: "created" | "started" }) {
  const usage = useDailyUsage(projectId, true);
  const shown = usageLines(usage, limit);
  return (
    <div className="space-y-1 rounded-md border border-border bg-surface-raised px-3 py-2.5 text-[12px]" aria-live="polite">
      <p className="text-[11px] font-medium tracking-wide text-fg-subtle uppercase">{usageHeading(usage)}</p>
      {shown.lines.map((line) => (
        <p key={line} className="text-fg-muted">
          {line}
        </p>
      ))}
      {shown.warning && (
        <p className="font-medium text-warning" role="status">
          {shown.warning}
        </p>
      )}
    </div>
  );
}

/**
 * Cancel for one queued run: a confirmation first, then the existing
 * `POST /api/agent-runs/<id> {action:"cancel"}` (the route re-checks the
 * operator and the run's state), then the run read back and shown as stored.
 * Offered only while the run is queued, i.e. has not started.
 */
export function useCancelRun(onPersisted: (run: AgentRun) => void) {
  const [cancelling, setCancelling] = useState(false);
  const inFlight = useRef(false);
  const [cancelNote, setCancelNote] = useState<{ text: string; tone: "neutral" | "warning" } | null>(null);

  const cancel = async (run: AgentRun) => {
    if (inFlight.current || !cancelOffered(run)) return;
    inFlight.current = true;
    setCancelling(true);
    setCancelNote(null);

    let note;
    try {
      const response = await fetch(`/api/agent-runs/${encodeURIComponent(run.id)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
        cache: "no-store",
      });
      note = cancelOutcome(response.status, await response.json().catch(() => null));
    } catch {
      note = cancelOutcome(0, null);
    }

    try {
      const read = await fetch(`/api/agent-runs/${encodeURIComponent(run.id)}`, { cache: "no-store" });
      if (read.ok) {
        const body = (await read.json()) as { run?: AgentRun };
        if (body.run) onPersisted(body.run);
      }
    } catch {
      /* The note says what the request answered; a refresh shows the stored state. */
    }

    setCancelNote(note);
    inFlight.current = false;
    setCancelling(false);
  };

  return { cancelling, cancelNote, cancel };
}

/** The Cancel button for one run, with its confirmation and the line it leaves behind. */
export function CancelRunControl({ run, onPersisted }: { run: AgentRun | null; onPersisted: (run: AgentRun) => void }) {
  const { cancelling, cancelNote, cancel } = useCancelRun(onPersisted);
  const [open, setOpen] = useState(false);

  return (
    <>
      {run !== null && cancelOffered(run) && (
        <Button variant="ghost" icon="close" onClick={() => setOpen(true)} disabled={cancelling} aria-busy={cancelling}>
          {cancelling ? "Cancelling…" : "Cancel run"}
        </Button>
      )}
      {cancelNote && (
        <span className={cancelNote.tone === "warning" ? "text-xs text-warning" : "text-xs text-fg-muted"} role="status">
          {cancelNote.text}
        </span>
      )}
      {open && run !== null && (
        <SpendConfirmDialog
          confirmation={cancelConfirmation(run)}
          projectId={run.projectId}
          busy={cancelling}
          onClose={() => setOpen(false)}
          onConfirm={() => {
            setOpen(false);
            void cancel(run);
          }}
        />
      )}
    </>
  );
}
