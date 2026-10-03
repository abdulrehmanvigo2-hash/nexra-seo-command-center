"use client";

import { useRef, useState } from "react";
import { RunNowButton, RunNowNote, useRunNow } from "@/components/agent-runs/run-now";
import { SpendConfirmDialog } from "@/components/spend/spend-confirm";
import { AssembledDraftView } from "@/components/content/assembled-draft";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import type { DailyUsage } from "@/lib/agent-runs/daily-usage";
import type { ParsedBrief } from "@/lib/briefs/brief";
import { batchOutcome, capRoom, DRAFT_ARTICLE_LABEL, draftArticleConfirmation, draftParts, partLabel, partRequests, partStateLine, partsToQueue } from "@/lib/briefs/draft-presenter";
import { BRIEF_LABEL, BRIEF_NOTE, briefRunLine, latestBrief, supportLabel } from "@/lib/briefs/presenter";
import { writeOutcome } from "@/lib/evidence/presenter";
import type { AgentRun } from "@/types/agent-run";

/**
 * The *Brief* panel on the Evidence tab (M5, PR 3). Draft brief… opens the queue confirmation (the parent owns it and
 * the POST); a queued brief offers Run Now; the newest completed brief is read back into its sections and labelled a
 * model's proposal. Nothing here writes an article.
 */
type Note = { readonly text: string; readonly tone: "neutral" | "warning" } | null;
type RunsRead = readonly AgentRun[] | "loading" | "failed";

export function OpportunityBriefPanel({ projectId, runs, writerRuns, busy, note, onDraft, onChanged }: { projectId: string; runs: RunsRead; writerRuns: RunsRead; busy: boolean; note: Note; onDraft: () => void; onChanged: () => void }) {
  const { executing, executeNote, runNow } = useRunNow(() => onChanged());
  const list = Array.isArray(runs) ? (runs as readonly AgentRun[]) : [];
  const shown = latestBrief(list);

  return (
    <Panel>
      <PanelHeader
        title="Brief"
        description="The Content Strategist's outline for one article from this opportunity's records."
        actions={
          <Button variant="secondary" icon="brief" disabled={busy} onClick={onDraft}>
            {BRIEF_LABEL}
          </Button>
        }
      />
      <PanelBody className="space-y-3">
        {note !== null && (
          <p className={note.tone === "warning" ? "text-xs text-warning" : "text-xs text-fg-muted"} role="status">
            {note.text}
          </p>
        )}
        <RunNowNote note={executeNote} />
        {runs === "loading" ? (
          <Skeleton className="h-16 w-full" />
        ) : runs === "failed" ? (
          <p className="text-sm text-warning">Brief runs could not be read. Nothing is shown in their place.</p>
        ) : list.length === 0 ? (
          <p className="text-sm text-fg-muted">No brief drafted for this opportunity.</p>
        ) : (
          <ul className="space-y-1.5 text-xs">
            {list.slice(0, 5).map((run) => (
              <li key={run.id} className="flex flex-wrap items-center gap-2">
                <span className="text-fg-subtle">{briefRunLine(run)}</span>
                {run.status === "queued" && <RunNowButton run={run} executing={executing} onRunNow={() => void runNow(run)} />}
              </li>
            ))}
          </ul>
        )}
        {shown.state === "unparsed" && (
          <div className="space-y-1">
            <Badge tone="warning">Not in the brief format — shown as stored</Badge>
            <pre className="whitespace-pre-wrap break-words rounded-md border border-border p-3 text-xs text-fg-muted">{shown.text}</pre>
          </div>
        )}
        {shown.state === "brief" && (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral">Model proposal</Badge>
              <span className="text-xs text-fg-subtle">Run {shown.run.id.slice(0, 8)} · {(shown.run.finishedAt ?? shown.run.createdAt).slice(0, 10)}</span>
            </div>
            <p className="text-fg"><span className="font-medium">Angle:</span> {shown.brief.angle}</p>
            <ol className="list-decimal space-y-1 pl-5">
              {shown.brief.outline.map((h2, index) => {
                const support = shown.brief.evidence.filter((e) => e.heading === h2.heading).map((e) => supportLabel(e.support));
                return (
                  <li key={index}>
                    <span className="font-medium text-fg">{h2.heading}</span>
                    {h2.purpose !== "" && <span className="text-fg-muted"> — {h2.purpose}</span>}
                    {support.length > 0 && <div className="text-xs text-fg-subtle">{support.join(" · ")}</div>}
                  </li>
                );
              })}
            </ol>
            {shown.brief.faqs.length > 0 && (
              <div>
                <p className="text-xs font-medium text-fg">Questions</p>
                <ul className="list-disc pl-5 text-fg-muted">{shown.brief.faqs.map((faq, index) => <li key={index}>{faq}</li>)}</ul>
              </div>
            )}
            {shown.brief.links.length > 0 && (
              <p className="text-xs text-fg-muted">Links: {shown.brief.links.map((l) => `${l.path} under “${l.under}”`).join(" · ")}</p>
            )}
            <dl className="grid gap-1 text-xs text-fg-muted sm:grid-cols-[auto_1fr] sm:gap-x-3">
              <dt className="font-medium text-fg">Evidence needed</dt><dd>{shown.brief.evidenceNeeded}</dd>
              <dt className="font-medium text-fg">Limits</dt><dd>{shown.brief.limits}</dd>
              <dt className="font-medium text-fg">Next</dt><dd>{shown.brief.next}</dd>
            </dl>
            <ArticleDraftSection projectId={projectId} briefRun={shown.run} brief={shown.brief} writerRuns={writerRuns} onChanged={onChanged} />
          </div>
        )}
      </PanelBody>
      <PanelFooter>
        <span>{BRIEF_NOTE}</span>
      </PanelFooter>
    </Panel>
  );
}

/**
 * The article draft of one brief (M6, PR 4): each part's newest run in words, Run now on a queued one, and *Draft
 * article…* — one confirmation that queues every part not yet drafted, after checking today's caps leave room for all.
 */
function ArticleDraftSection({ projectId, briefRun, brief, writerRuns, onChanged }: { projectId: string; briefRun: AgentRun; brief: ParsedBrief; writerRuns: RunsRead; onChanged: () => void }) {
  const { executing, executeNote, runNow } = useRunNow(() => onChanged());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const inFlight = useRef(false);
  const list = Array.isArray(writerRuns) ? (writerRuns as readonly AgentRun[]) : [];
  const states = draftParts(brief, list, briefRun.id);
  const toQueue = partsToQueue(states);
  const byId = new Map(list.map((run) => [run.id, run]));

  const queueAll = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setNote(null);
    let queued = 0;
    let refusal: string | null = null;
    try {
      const usageResponse = await fetch(`/api/agent-runs/daily-usage?project=${encodeURIComponent(projectId)}`, { cache: "no-store" });
      const usage = usageResponse.ok ? ((await usageResponse.json().catch(() => null)) as { usage?: DailyUsage } | null)?.usage ?? null : null;
      const room = capRoom(usage, toQueue.length);
      if (!room.ok) refusal = room.why;
      else {
        for (const request of partRequests(projectId, briefRun.id, toQueue)) {
          const response = await fetch("/api/agent-runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request), cache: "no-store" });
          if (!response.ok) {
            refusal = writeOutcome(response.status, await response.json().catch(() => null), "").text;
            break;
          }
          queued += 1;
        }
      }
    } catch {
      refusal = "The request could not be sent. Check your connection.";
    }
    setNote(refusal !== null && queued === 0 ? { text: refusal, tone: "warning" } : batchOutcome(queued, toQueue.length, refusal));
    inFlight.current = false;
    setBusy(false);
    onChanged();
  };

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-fg">Article draft — the Writer, one run per part</p>
        <Button size="sm" variant="secondary" icon="edit" disabled={busy || toQueue.length === 0 || writerRuns === "loading"} onClick={() => setConfirming(true)}>
          {DRAFT_ARTICLE_LABEL}
        </Button>
      </div>
      {note !== null && (
        <p className={note.tone === "warning" ? "text-xs text-warning" : "text-xs text-fg-muted"} role="status">
          {note.text}
        </p>
      )}
      <RunNowNote note={executeNote} />
      {writerRuns === "failed" ? (
        <p className="text-xs text-warning">{"The Writer's runs could not be read. Nothing is shown in their place."}</p>
      ) : (
        <ul className="space-y-1 text-xs">
          {states.map((state) => {
            const run = state.state === "pending" ? byId.get(state.runId) : undefined;
            return (
              <li key={state.part} className="flex flex-wrap items-center gap-2">
                <span className="text-fg">{partLabel(state.part, brief)}</span>
                <span className="text-fg-subtle">{partStateLine(state)}</span>
                {run !== undefined && run.status === "queued" && <RunNowButton run={run} executing={executing} onRunNow={() => void runNow(run)} />}
              </li>
            );
          })}
        </ul>
      )}
      {states.length > 0 && states.every((state) => state.state === "used") && (
        <AssembledDraftView projectId={projectId} briefRunId={briefRun.id} version={states.map((state) => (state.state === "used" ? state.runId : "")).join(",")} />
      )}
      {confirming && (
        <SpendConfirmDialog confirmation={draftArticleConfirmation(projectId, briefRun.id, toQueue, brief)} projectId={projectId} busy={busy} onClose={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            void queueAll();
          }} />
      )}
    </div>
  );
}
