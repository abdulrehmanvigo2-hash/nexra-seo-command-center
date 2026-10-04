"use client";

import { useRef, useState } from "react";
import { CancelRunControl, SpendConfirmDialog } from "@/components/spend/spend-confirm";
import { Button } from "@/components/ui/button";
import { runNowConfirmation } from "@/lib/agent-runs/spend-confirm";
import { executability, executeOutcome, reconciledNote, type Tone } from "@/lib/crawl/review-request";
import type { AgentRun } from "@/types/agent-run";

/**
 * Run Now for one queued run: shared by the review panels
 * (`queued-review.tsx`) and an agent page's Run History (checkpoint 6.6b).
 *
 * The request names the run itself — `POST /api/agent-runs/<id>` with
 * `{action:"execute"}` — so the attempt it claims is provably this one; the
 * route re-checks the operator, the daily caps and the run's state. Whatever
 * it answers, the run is read back and the persisted state is what is shown:
 * a 200 means accepted, not analysed, and a 409 means something else claimed
 * the run first. Only a queued run is offered the control.
 */
export function useRunNow(onPersisted: (run: AgentRun) => void) {
  const [executing, setExecuting] = useState(false);
  /** The run whose execute request is in flight: in a list, only its button shows running. */
  const [executingId, setExecutingId] = useState<string | null>(null);
  const runningNow = useRef(false);
  const [executeNote, setExecuteNote] = useState<{ text: string; tone: Tone } | null>(null);

  const runNow = async (current: AgentRun | null) => {
    if (runningNow.current || current === null || !executability(current).ok) return;
    runningNow.current = true;
    setExecuting(true);
    setExecutingId(current.id);
    setExecuteNote(null);

    const runId = current.id;
    let outcome;
    try {
      const response = await fetch(`/api/agent-runs/${encodeURIComponent(runId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "execute" }),
        cache: "no-store",
      });
      const body: unknown = await response.json().catch(() => null);
      outcome = executeOutcome(response.status, body);
    } catch {
      // The attempt may or may not have started. The read below decides.
      outcome = executeOutcome(0, null);
    }

    // Always reconcile, including after a success: the POST body is not the
    // authority on what was stored.
    let persisted: AgentRun | null = null;
    try {
      const read = await fetch(`/api/agent-runs/${encodeURIComponent(runId)}`, { cache: "no-store" });
      if (read.ok) {
        const body = (await read.json()) as { run?: AgentRun };
        persisted = body.run ?? null;
      }
    } catch {
      persisted = null;
    }

    if (persisted) onPersisted(persisted);
    setExecuteNote(reconciledNote(outcome, persisted));
    runningNow.current = false;
    setExecuting(false);
    setExecutingId(null);
  };

  return { executing, executingId, executeNote, setExecuteNote, runNow };
}

/**
 * The Run Now button and the line beside it, for one run. The button opens a
 * confirmation (fix F3): the task, project and record, today's use of the
 * daily caps, and that it calls the model now. Only its confirm sends the
 * execute request; beside it, a queued run can be cancelled instead.
 */
export function RunNowButton({
  run,
  executing,
  blocked = false,
  onRunNow,
  onPersisted,
}: {
  run: AgentRun | null;
  /** This run's execute request is in flight. */
  executing: boolean;
  /** Another run of the same list is executing: held, not shown as running. */
  blocked?: boolean;
  onRunNow: () => void;
  /** Receives the run read back after a cancel; without it, no Cancel is offered here. */
  onPersisted?: (run: AgentRun) => void;
}) {
  const runnable = executability(run);
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" icon="bolt" onClick={() => setConfirming(true)} disabled={!runnable.ok || executing || blocked} title={runnable.why ?? undefined} aria-busy={executing}>
        {executing ? "Running…" : "Run now"}
      </Button>
      {onPersisted && <CancelRunControl run={run} onPersisted={onPersisted} />}
      <span className="text-xs text-fg-subtle">
        {runnable.ok ? "Queued, not started. Run now calls the model immediately instead of waiting for the scheduled worker." : (runnable.why ?? "")}
      </span>
      {confirming && run !== null && (
        <SpendConfirmDialog
          confirmation={runNowConfirmation(run)}
          projectId={run.projectId}
          onClose={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            onRunNow();
          }}
        />
      )}
    </div>
  );
}

/** What the last Run Now request adds to the run's state, or nothing. */
export function RunNowNote({ note }: { note: { text: string; tone: Tone } | null }) {
  if (note === null) return null;
  return (
    <p className={note.tone === "warning" ? "text-sm text-warning" : "text-sm text-fg-muted"} role="status">
      {note.text}
    </p>
  );
}
