"use client";

import { useEffect, useRef, useState } from "react";
import { SaveDraftControl } from "@/components/content/draft-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  PRIORITY_REVIEW,
  RUN_STATUS,
  SECTION_DRAFT,
  executability,
  executeOutcome,
  draftRequest,
  handoffRequest,
  hasResult,
  offersDraft,
  offersHandoff,
  outputProvenance,
  queueRefusal,
  queuedNote,
  reconciledNote,
  restoreReviewRun,
  type Queueability,
  type QueueState,
  type ReviewInput,
  type ReviewSpec,
  type Tone,
} from "@/lib/crawl/review-request";
import { offersSaveAsDraft } from "@/lib/content/drafts/eligibility";
import type { AgentRun } from "@/types/agent-run";

/**
 * The operator control for queueing one agent's review and, separately,
 * starting it.
 *
 * Shared by every panel that shows recorded evidence an agent can read — the
 * crawl panel's two reviews and the Search Console panel's one. The rules it
 * enforces are the ones that keep a queued run from reading as a result:
 * queueing and executing are two buttons, every answer is reconciled against
 * the persisted run, and a simulated or ungrounded result is labelled on the
 * result itself.
 */

/**
 * One agent's review of the evidence on screen: its queue state, and the two
 * requests an operator can make about it.
 *
 * Owned per review, so each control holds its own run and cannot show one
 * agent's result under another's heading. Everything below is the same for
 * every review: the caller decides whether a review can be queued (`request`),
 * the server decides whether it is, and the persisted run — re-read after
 * every request — decides what is shown. `resetKey` names the evidence the
 * review belongs to; when it changes, the run shown is dropped, because a
 * finding beside the wrong evidence is a lie.
 */
export function useQueuedReview(
  request: Queueability,
  resetKey: string | null,
  review: ReviewSpec,
  /**
   * The project the review belongs to. With it, the control reads the
   * persisted runs after the page loads and restores this review's newest run
   * over the evidence on screen; without it, nothing is restored.
   */
  projectId: string | null = null,
) {
  const [state, setState] = useState<QueueState>({ status: "idle" });
  /** A ref refuses the second click of a pair before React has re-rendered. */
  const queueing = useRef(false);
  const [executing, setExecuting] = useState(false);
  const runningNow = useRef(false);
  const [executeNote, setExecuteNote] = useState<{ text: string; tone: Tone } | null>(null);

  /**
   * The evidence the request names, as a stable key. The request object is
   * rebuilt every render, so the effect below keys on this string instead and
   * reads the input back from it; it changes only when the evidence does,
   * which is exactly when a restored run would belong to something else.
   */
  const inputKey = request.ok ? JSON.stringify(request.payload.input) : null;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing state that belongs to different evidence
    setState({ status: "idle" });
    setExecuteNote(null);

    // Restore this review's newest persisted run over the evidence on screen.
    // A read only: it GETs the list the Run History panel reads and never
    // queues or executes. Anything that goes wrong leaves the control idle.
    if (projectId === null || resetKey === null || inputKey === null) return;
    const input = JSON.parse(inputKey) as ReviewInput;
    const controller = new AbortController();
    void restoreReviewRun(projectId, review, input, fetch, controller.signal).then((run) => {
      if (controller.signal.aborted || run === null) return;
      // Only fill an idle control: an operator who queued before the read
      // came back is looking at that run, not this one.
      setState((existing) =>
        existing.status === "idle" ? { status: "queued", run, duplicate: false, restored: true } : existing,
      );
    });
    return () => controller.abort();
  }, [resetKey, projectId, review, inputKey]);

  const reviewable = request;

  /**
   * Queues the agent to review the evidence on screen.
   *
   * It queues and stops there. The run is executed later by the scheduled
   * worker or by Run Now below, through the same service an operator's own
   * request would use — nothing here executes an agent, and the button never
   * claims it did. A matching run already queued or running comes back as a
   * duplicate rather than as a second run.
   */
  const queue = async () => {
    if (queueing.current || !reviewable.ok) return;
    queueing.current = true;
    setState({ status: "queuing" });

    try {
      const response = await fetch("/api/agent-runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reviewable.payload),
        cache: "no-store",
      });
      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setState({ status: "refused", message: queueRefusal(response.status, body, review) });
        return;
      }

      const parsed = body as { run?: AgentRun; duplicate?: boolean } | null;
      setState(
        parsed?.run
          ? { status: "queued", run: parsed.run, duplicate: parsed.duplicate === true }
          : { status: "refused", message: "The server accepted the request but returned no run." },
      );
    } catch {
      setState({
        status: "refused",
        message: "The request did not complete. Refresh before asking again — it may have been queued.",
      });
    } finally {
      queueing.current = false;
    }
  };

  /**
   * Runs the queued review now, instead of waiting for the scheduled worker.
   *
   * The request names the run on screen — `/api/agent-runs/<id>` with
   * `{action:"execute"}` — so the attempt it claims is provably this one. The
   * deployment-wide `run-next` worker action is deliberately not used: it
   * claims the oldest queued run anywhere, which could belong to another
   * project entirely.
   *
   * Whatever the POST answers, the run is read back afterwards and the panel
   * shows the persisted state. An HTTP 200 says the request was accepted, not
   * that anything was analysed, and a 409 means something else claimed the run
   * first — which is the lease working, not a failure.
   */
  const runNow = async () => {
    const current = state.status === "queued" ? state.run : null;
    if (runningNow.current || current === null || !executability(current).ok) return;
    runningNow.current = true;
    setExecuting(true);
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

    if (persisted) setState({ status: "queued", run: persisted, duplicate: false });
    setExecuteNote(reconciledNote(outcome, persisted));
    runningNow.current = false;
    setExecuting(false);
  };

  return {
    state,
    blockedWhy: reviewable.ok ? null : reviewable.why,
    busy: state.status === "queuing",
    onQueue: queue,
    executing,
    executeNote,
    onRunNow: runNow,
  };
}

/**
 * One agent's review, as a section under the evidence it reads.
 *
 * Queueing is all the first button does. The run is carried out later by the
 * scheduled worker or by Run Now, through the agent-run service an operator's
 * own request would use, so there is one execution path and the browser is
 * not on it. Until a run finishes there is nothing to read, and the wording
 * says so rather than showing a tick for work that has not started.
 */
export function QueuedReview({
  review,
  state,
  blockedWhy,
  busy,
  onQueue,
  executing,
  executeNote,
  onRunNow,
  projectId = null,
  nested = false,
}: {
  review: ReviewSpec;
  state: QueueState;
  /** Why the control is unavailable, or null when it can be used. */
  blockedWhy: string | null;
  busy: boolean;
  onQueue: () => void;
  executing: boolean;
  /** What the last execute attempt adds to the badge, or null. */
  executeNote: { text: string; tone: Tone } | null;
  onRunNow: () => void;
  /**
   * The project the review belongs to. With it, a completed review that the
   * Director may read gets the hand-off control beneath its result; without
   * it, none is offered.
   */
  projectId?: string | null;
  /** Rendered under another review's result, so it indents rather than rules off. */
  nested?: boolean;
}) {
  const queued = state.status === "queued" ? state : null;
  const run = queued?.run ?? null;
  const provenance = run ? outputProvenance(run, review.groundedIn) : null;
  const runnable = executability(run);

  return (
    <section
      className={nested ? "space-y-2 border-l-2 border-border pl-3" : "space-y-2 border-t border-border pt-4"}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-xs font-medium text-fg">{review.agentName} agent</h4>
          <p className="text-xs text-fg-subtle">{review.summary}</p>
        </div>
        <Button
          variant="secondary"
          icon="agents"
          onClick={onQueue}
          disabled={blockedWhy !== null || busy}
          title={blockedWhy ?? undefined}
          aria-busy={busy}
        >
          {busy ? "Queueing…" : review.action}
        </Button>
      </div>

      {blockedWhy !== null && state.status === "idle" && (
        <p className="text-xs text-fg-subtle">{blockedWhy}</p>
      )}

      {state.status === "refused" && (
        <p className="text-sm text-warning" role="status">
          <span className="font-medium">Not queued.</span> {state.message}
        </p>
      )}

      {queued && run && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              tone={RUN_STATUS[run.status].tone}
              dot
              pulse={run.status === "running"}
              title={RUN_STATUS[run.status].title}
            >
              {RUN_STATUS[run.status].label}
            </Badge>
            <span className="text-xs text-fg-subtle">
              {queuedNote({ run, duplicate: queued.duplicate, restored: queued.restored })}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              icon="bolt"
              onClick={onRunNow}
              disabled={!runnable.ok || executing}
              title={runnable.why ?? undefined}
              aria-busy={executing}
            >
              {executing ? "Running…" : "Run Now"}
            </Button>
            <span className="text-xs text-fg-subtle">
              {runnable.ok
                ? "Runs this run through the operator worker now, instead of waiting for the scheduled one."
                : (runnable.why ?? "")}
            </span>
          </div>

          {executeNote && (
            <p
              className={
                executeNote.tone === "warning" ? "text-sm text-warning" : "text-sm text-fg-muted"
              }
              role="status"
            >
              {executeNote.text}
            </p>
          )}

          {run.error && (
            <p className="text-sm text-critical">
              <span className="font-medium">{run.error.code}</span> — {run.error.message}
            </p>
          )}

          {provenance && (
            <p
              className={provenance.tone === "warning" ? "text-xs text-warning" : "text-xs text-fg-subtle"}
            >
              {provenance.text}
            </p>
          )}

          {hasResult(run) && (
            <p className="text-sm whitespace-pre-wrap text-fg-muted">{run.resultSummary}</p>
          )}

          <p className="text-xs text-fg-subtle">
            Full run history, including attempts, is on the Agents screen.
          </p>

          {projectId !== null && offersHandoff(run) && <DirectorHandoff projectId={projectId} source={run} />}
          {projectId !== null && offersDraft(run) && <WriterDraft projectId={projectId} plan={run} />}
          {projectId !== null && offersSaveAsDraft(run) && <SaveDraftControl key={run.id} projectId={projectId} run={run} />}
        </div>
      )}
    </section>
  );
}

/**
 * The hand-off from a completed specialist review to the SEO Director.
 *
 * The same control as every other review, with the completed run on screen as
 * its evidence: it queues, it runs now, and it reconciles against the
 * persisted Director run. It is offered under a review the Director may read
 * and refuses, with the runtime's own reason, for one it may not — a
 * simulated or ungrounded result is named as such rather than hidden. The
 * Director's own result never offers a further hand-off: one upstream run,
 * one prioritisation, and nothing queues on its own.
 */
function DirectorHandoff({ projectId, source }: { projectId: string; source: AgentRun }) {
  const handoff = useQueuedReview(handoffRequest(projectId, source), source.id, PRIORITY_REVIEW, projectId);
  return <QueuedReview review={PRIORITY_REVIEW} nested {...handoff} />;
}

/**
 * The Writer's section draft from a completed content plan.
 *
 * The same control as every other review, nested beneath the completed plan
 * that is its input: it queues, it runs now, and it reconciles against the
 * persisted Writer run for this plan. It is offered under a plan the Writer
 * may draft from and refuses, with the reader's own reason, for one it may
 * not. The draft's own result offers nothing further — no publish, no edit,
 * no approval, because the product has no such action — and nothing queues
 * on its own.
 */
function WriterDraft({ projectId, plan }: { projectId: string; plan: AgentRun }) {
  const draft = useQueuedReview(draftRequest(projectId, plan), plan.id, SECTION_DRAFT, projectId);
  // The project goes with it: the Writer's own result carries the Save-as-draft
  // control, and that control renders only for a run whose project is known.
  return <QueuedReview review={SECTION_DRAFT} nested projectId={projectId} {...draft} />;
}
