"use client";

import { useEffect, useState } from "react";
import { useCheckAll } from "@/components/content/use-check-all";
import { SpendConfirmDialog } from "@/components/spend/spend-confirm";
import { Button } from "@/components/ui/button";
import { fetchDailyUsage, type Confirmation } from "@/lib/agent-runs/spend-confirm";
import { checkAllConfirmation, planCheckAll, refusalMessage, type CheckAllPlan } from "@/lib/content/articles/checks/check-all";
import type { CheckAllHalt, CheckAllOutcome } from "@/lib/content/articles/checks/check-all-loop";
import type { ArticleVersionChecks } from "@/types/content-article-check";

/**
 * "Check all units" — the button (step 3). One press, one confirmation (fix
 * F3's dialog, from the planner's facts: units to carry, units to check,
 * estimated runs, the cost range, today's usage), then the loop runs in this
 * tab: carries first, then one paid run per unit, each recorded on its unit.
 * While it runs, one progress line and a Stop; when it ends, one summary —
 * the units needing review (opened from their rows, as today), or where and
 * why it stopped. A refused press (the cap, nothing to do, more runs than
 * the queue accepts) is said here, before any dialog. Pressing again resumes
 * from the unchecked rows.
 */

export const CHECK_ALL_LABEL = "Check all units…";
export const CHECK_ALL_STOP_LABEL = "Stop after this unit";

export function CheckAllControl({
  projectId,
  article,
  checks,
  onChecks,
  onArticleChanged,
}: {
  projectId: string;
  article: { readonly id: string; readonly status: string; readonly currentVersion: number };
  checks: ArticleVersionChecks;
  /** The table as the loop re-reads or records it. */
  onChecks: (checks: ArticleVersionChecks) => void;
  /** Called once when the loop ends with every unit passed, so the panel re-reads the article's own status. */
  onArticleChanged: () => void;
}) {
  const { state, start, stop, reset } = useCheckAll(
    { projectId, article, version: { version: checks.version, versionId: checks.versionId, refusal: checks.refusal } },
    onChecks,
  );
  const [planning, setPlanning] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ plan: CheckAllPlan; confirmation: Confirmation } | null>(null);

  // The article's own status moves to Checked on the server when the last unit passes; the panel re-reads it once.
  useEffect(() => {
    if (state.phase === "ended" && state.outcome.checks?.state === "passed") onArticleChanged();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per ended outcome
  }, [state.phase]);

  async function press() {
    if (planning || state.phase === "running") return;
    setPlanning(true);
    setRefused(null);
    try {
      const usage = await fetchDailyUsage(projectId, fetch).catch(() => ({ status: "failed" as const }));
      const plan = planCheckAll(checks, usage);
      const message = refusalMessage(plan.refusal);
      if (message !== null) {
        setRefused(message);
        return;
      }
      setConfirming({ plan, confirmation: checkAllConfirmation(plan, { projectId, version: checks.version }) });
    } finally {
      setPlanning(false);
    }
  }

  return (
    <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">
      {state.phase !== "running" && (
        <Button variant="secondary" icon="agents" onClick={() => void press()} disabled={planning} aria-busy={planning}>
          {planning ? "Planning…" : CHECK_ALL_LABEL}
        </Button>
      )}
      {state.phase === "running" && (
        <>
          <span className="text-xs text-fg-muted" role="status" aria-live="polite">
            {progressLine(state)}
          </span>
          <Button variant="ghost" onClick={stop} disabled={state.stopping}>
            {state.stopping ? "Stopping after this unit…" : CHECK_ALL_STOP_LABEL}
          </Button>
        </>
      )}
      {refused !== null && state.phase !== "running" && (
        <p className="basis-full text-xs text-warning" role="status">
          Not started. {refused}
        </p>
      )}
      {state.phase === "ended" && (
        <div className="basis-full space-y-1 rounded border border-border bg-surface-raised px-3 py-2 text-xs" role="status">
          <p className={state.outcome.ended === "halted" ? "text-warning" : "text-fg"}>{summaryLine(state.outcome)}</p>
          <p className="text-fg-subtle">{needsReviewLine(state.outcome)}</p>
          <div>
            <Button variant="ghost" onClick={reset}>
              Dismiss
            </Button>
          </div>
        </div>
      )}
      {confirming !== null && (
        <SpendConfirmDialog
          confirmation={confirming.confirmation}
          projectId={projectId}
          onClose={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null);
            void start();
          }}
        />
      )}
    </div>
  );
}

function progressLine(state: { readonly progress: { readonly type: string; readonly index: number; readonly runId?: string } | null; readonly carried: number; readonly checked: number }): string {
  const counts = `${state.carried} carried · ${state.checked} recorded`;
  const p = state.progress;
  if (p === null) return `Starting… · ${counts}`;
  const run = p.runId ? ` (run ${p.runId.slice(0, 8)})` : "";
  switch (p.type) {
    case "carrying":
      return `Carrying unit ${p.index}… · ${counts}`;
    case "carried":
      return `Carried unit ${p.index} · ${counts}`;
    case "queued":
      return `Checking unit ${p.index}: queued${run} · ${counts}`;
    case "running":
      return `Checking unit ${p.index}: running${run} · ${counts}`;
    case "recorded":
      return `Recorded unit ${p.index}${run} · ${counts}`;
    default:
      return counts;
  }
}

function haltLine(halt: CheckAllHalt): string {
  const run = "runId" in halt ? ` (run ${halt.runId.slice(0, 8)})` : "";
  switch (halt.kind) {
    case "run-failed":
      return `Stopped at unit ${halt.index}: its run failed${run}${halt.code ? ` — ${halt.code}` : ""}: ${halt.message} Nothing after it was started; no automatic re-run.`;
    case "check-failed":
      return `Stopped at unit ${halt.index}: the answer could not be read as a verdict${run} (recorded as Check failed). Nothing after it was started; no automatic re-run.`;
    case "refused":
      return `Stopped at unit ${halt.index} (${halt.step === "carry" ? "carry" : halt.step === "record-pending" ? "recording an earlier run" : "check"}): ${halt.message} Nothing after it was started.`;
    case "timed-out":
      return `Stopped at unit ${halt.index}: its run${run} did not finish within the wait. It may still finish on its own; record it from its row, then press again. Nothing after it was started.`;
    case "unreadable":
      return halt.index === null ? `Stopped: ${halt.message} Reload the page and press again.` : `Stopped at unit ${halt.index}: ${halt.message} Reload the page and press again.`;
  }
}

function summaryLine(outcome: CheckAllOutcome): string {
  const counts = `${outcome.carried.length} carried, ${outcome.checked.length} checked and recorded`;
  if (outcome.ended === "done") {
    return outcome.checks?.state === "passed" ? `Done: ${counts}. Every unit of this version passed — the article is now Checked (not approved).` : `Done: ${counts}.`;
  }
  if (outcome.ended === "stopped") return `Stopped on your request after the unit in flight: ${counts}. Press again to continue from the unchecked rows.`;
  return `${outcome.halt ? haltLine(outcome.halt) : "Stopped."} So far: ${counts}. Press again to resume from the unchecked rows.`;
}

function needsReviewLine(outcome: CheckAllOutcome): string {
  if (outcome.needsReview.length === 0) return "No unit needs review.";
  const list = outcome.needsReview.join(", ");
  return `${outcome.needsReview.length === 1 ? "Unit" : "Units"} needing review: ${list}. Open each row to read the agent's answer; nothing was edited or re-run.`;
}
