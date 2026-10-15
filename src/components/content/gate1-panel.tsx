"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Gate1ArticleStep } from "@/components/content/gate1-article";
import { SpendConfirmDialog } from "@/components/spend/spend-confirm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import type { DailyUsage } from "@/lib/agent-runs/daily-usage";
import type { ParsedBrief } from "@/lib/briefs/brief";
import { draftParts, partLabel, partsToQueue } from "@/lib/briefs/draft-presenter";
import { executeOutcome } from "@/lib/crawl/review-request";
import { evidenceUnitsUrl, type EvidenceSource, type EvidenceUnit } from "@/lib/evidence/contract";
import { GATE1_LABEL, gate1Confirmation, gate1Requests, gate1State, partsEstimate, runGate1, writingConfirmation, type Gate1Outcome } from "@/lib/pipeline/gate1";
import { runWriting, writingCounts, writingNote, type WritingIo, type WritingProgress } from "@/lib/pipeline/write-parts";
import { confirmTicks, gate1Evidence } from "@/lib/pipeline/stage-a";
import { runHistoryListUrl } from "@/lib/agent-runs/run-history-view";
import type { AgentRun } from "@/types/agent-run";

/**
 * Gate 1 — *Approve the plan* (OC1, PR 4; docs/roadmap/OC1-one-click-article.md). Beneath the brief on the Evidence tab:
 * the claims the database would admit, ticked; the others counted, never ticked; the parts the Writer will draft and an
 * estimate. One button opens one confirmation, then admits the ticked claims, queues every part and (PR 5) runs them one
 * by one through `runWriting` while the page is open. Once a part run names the brief, the panel shows the plan as
 * approved with the parts drafted, and *Continue writing* resumes any still queued. Nothing here writes an article.
 */

type UnitsRead = { readonly status: "loading" } | { readonly status: "failed" } | { readonly status: "ready"; readonly units: readonly EvidenceUnit[] };

function useUnits(projectId: string, sources: readonly EvidenceSource[], version: number): UnitsRead {
  const [state, setState] = useState<UnitsRead>({ status: "loading" });
  const key = sources.filter((s) => s.fetchState === "fetched").map((s) => s.id).join(",");
  useEffect(() => {
    const controller = new AbortController();
    const ids = key === "" ? [] : key.split(",");
    Promise.all(
      ids.map(async (id) => {
        const response = await fetch(evidenceUnitsUrl(projectId, id), { cache: "no-store", signal: controller.signal });
        const body = (await response.json().catch(() => null)) as { units?: unknown } | null;
        if (!response.ok || !Array.isArray(body?.units)) throw new Error("unreadable");
        return body.units as EvidenceUnit[];
      }),
    )
      .then((lists) => setState({ status: "ready", units: lists.flat() }))
      .catch((error: unknown) => {
        if (!(error instanceof Error && error.name === "AbortError")) setState({ status: "failed" });
      });
    return () => controller.abort();
  }, [projectId, key, version]);
  return state;
}

function writingIo(projectId: string, stop: { current: boolean }, onProgress: (event: WritingProgress) => void): WritingIo {
  const readRun = async (runId: string): Promise<AgentRun | null> => {
    try {
      const response = await fetch(`/api/agent-runs/${encodeURIComponent(runId)}`, { cache: "no-store" });
      if (!response.ok) return null;
      return ((await response.json()) as { run?: AgentRun }).run ?? null;
    } catch {
      return null;
    }
  };
  return {
    readRuns: async () => {
      try {
        const response = await fetch(runHistoryListUrl({ projectId, agentId: "writer", limit: 50, offset: 0 }), { cache: "no-store" });
        if (!response.ok) return null;
        const body = (await response.json().catch(() => null)) as { runs?: unknown } | null;
        return Array.isArray(body?.runs) ? (body.runs as AgentRun[]) : null;
      } catch {
        return null;
      }
    },
    execute: async (runId) => {
      try {
        const response = await fetch(`/api/agent-runs/${encodeURIComponent(runId)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "execute" }), cache: "no-store" });
        return executeOutcome(response.status, await response.json().catch(() => null));
      } catch {
        // The attempt may or may not have started; the read-back decides, as Run now's does.
        return executeOutcome(0, null);
      }
    },
    readRun,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    stopRequested: () => stop.current,
    onProgress,
  };
}

export function Gate1Panel({
  projectId,
  sources,
  briefRun,
  brief,
  writerRuns,
  version,
  onChanged,
}: {
  projectId: string;
  sources: readonly EvidenceSource[];
  briefRun: AgentRun;
  brief: ParsedBrief;
  writerRuns: readonly AgentRun[] | "loading" | "failed";
  version: number;
  onChanged: () => void;
}) {
  const units = useUnits(projectId, sources, version);
  const offered = useMemo(() => gate1Evidence(units.status === "ready" ? units.units : []), [units]);
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Gate1Outcome | null>(null);
  const inFlight = useRef(false);
  const stopRef = useRef(false);
  const [writing, setWriting] = useState<{ readonly running: boolean; readonly progress: WritingProgress | null; readonly note: { readonly text: string; readonly tone: "neutral" | "warning" } | null }>({ running: false, progress: null, note: null });
  const [confirmWriting, setConfirmWriting] = useState(false);
  /** The writing finished in this tab: the article is saved without a further press (PR 6b). */
  const [justWrote, setJustWrote] = useState(false);

  const write = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    stopRef.current = false;
    setWriting({ running: true, progress: null, note: null });
    const result = await runWriting(writingIo(projectId, stopRef, (event) => setWriting((current) => ({ ...current, progress: event }))), brief, briefRun.id);
    setWriting({ running: false, progress: null, note: writingNote(result, (part) => partLabel(part, brief)) });
    if (result.ended === "done") setJustWrote(true);
    inFlight.current = false;
    onChanged();
  };

  if (writerRuns === "loading" || units.status === "loading") {
    return (
      <Panel>
        <PanelHeader title="Approve the plan" description="Gate 1 of the one-click article." />
        <PanelBody><Skeleton className="h-16 w-full" /></PanelBody>
      </Panel>
    );
  }
  if (writerRuns === "failed" || units.status === "failed") {
    return (
      <Panel>
        <PanelHeader title="Approve the plan" description="Gate 1 of the one-click article." />
        <PanelBody><p className="text-sm text-warning">{"The claims or the Writer's runs could not be read, so the plan cannot be approved from here. Nothing is shown in their place."}</p></PanelBody>
      </Panel>
    );
  }

  const state = gate1State(briefRun.id, writerRuns);
  const parts = partsToQueue(draftParts(brief, writerRuns, briefRun.id));
  const ticked = offered.preTicked.filter((id) => !unticked.has(id));
  const byId = new Map(units.units.map((unit) => [unit.id, unit]));
  const titleOf = new Map(sources.map((source) => [source.id, source.title ?? source.finalUrl ?? source.requestedUrl]));
  const estimate = partsEstimate(parts.length);
  const counts = writingCounts(draftParts(brief, writerRuns, briefRun.id));

  const approve = async () => {
    const check = confirmTicks(offered, ticked);
    if (!check.ok || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setOutcome(null);
    const result = await runGate1(
      {
        usage: async () => {
          const response = await fetch(`/api/agent-runs/daily-usage?project=${encodeURIComponent(projectId)}`, { cache: "no-store" });
          return response.ok ? ((await response.json().catch(() => null)) as { usage?: DailyUsage } | null)?.usage ?? null : null;
        },
        post: async (url, body) => {
          const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
          return { status: response.status, body: await response.json().catch(() => null) };
        },
      },
      gate1Requests(projectId, briefRun.id, check.admit, parts),
    );
    setOutcome(result);
    inFlight.current = false;
    setBusy(false);
    onChanged();
    if (result.refusal === null && result.queued > 0) await write();
  };

  return (
    <Panel>
      <PanelHeader
        title="Approve the plan"
        description="Gate 1 of the one-click article: the evidence the Writer may use, and the parts it will draft from the brief above."
        actions={
          state.approved ? undefined : (
            <Button variant="primary" icon="check" disabled={busy || parts.length === 0} aria-busy={busy} onClick={() => setConfirming(true)}>
              {GATE1_LABEL}
            </Button>
          )
        }
      />
      <PanelBody className="space-y-3 text-sm">
        {outcome !== null && (
          <p className={outcome.tone === "warning" ? "text-xs text-warning" : "text-xs text-fg-muted"} role="status">{outcome.text}</p>
        )}
        {state.approved ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="positive">Plan approved</Badge>
              <span className="text-xs text-fg-subtle">
                {state.at.slice(0, 16).replace("T", " ")} UTC · {counts.drafted} of {counts.total} parts drafted{counts.waiting > 0 ? ` · ${counts.waiting} queued` : ""}
              </span>
            </div>
            {writing.running ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-fg-muted" role="status" aria-live="polite">
                  {writing.progress === null ? "Starting the writing…" : `${writing.progress.type === "running" ? "Writing" : "Drafted"} ${partLabel(writing.progress.part, brief)} · ${writing.progress.done} of ${writing.progress.total} done`}
                </span>
                <Button size="sm" variant="ghost" icon="close" onClick={() => { stopRef.current = true; }}>Stop after this part</Button>
              </div>
            ) : (
              counts.waiting > 0 && (
                <Button size="sm" variant="primary" icon="edit" onClick={() => setConfirmWriting(true)}>
                  {`Continue writing (${counts.waiting} queued)…`}
                </Button>
              )
            )}
            {writing.note !== null && (
              <p className={writing.note.tone === "warning" ? "text-xs text-warning" : "text-xs text-fg-muted"} role="status">{writing.note.text}</p>
            )}
            {!writing.running && counts.total > 0 && counts.drafted === counts.total && (
              <Gate1ArticleStep projectId={projectId} briefRunId={briefRun.id} autoSave={justWrote} onSaved={onChanged} />
            )}
          </div>
        ) : (
          <>
            {offered.preTicked.length === 0 ? (
              <p className="text-fg-muted">No claim can be admitted yet: none is supported with its quote found on the page. The Writer will draft from the brief and the site&apos;s own records only.</p>
            ) : (
              <fieldset className="space-y-2">
                <legend className="text-xs font-medium text-fg">Claims to admit ({ticked.length} of {offered.preTicked.length} ticked)</legend>
                {offered.preTicked.map((id) => {
                  const unit = byId.get(id);
                  if (unit === undefined) return null;
                  const checked = !unticked.has(id);
                  return (
                    <label key={id} className="flex cursor-pointer items-start gap-2 border-t border-border pt-2">
                      <input
                        type="checkbox"
                        className="mt-1 size-4 accent-[var(--color-accent)]"
                        checked={checked}
                        disabled={busy}
                        onChange={() => setUnticked((current) => {
                          const next = new Set(current);
                          if (checked) next.add(id);
                          else next.delete(id);
                          return next;
                        })}
                      />
                      <span className="min-w-0 space-y-0.5">
                        <span className="block font-medium text-fg">{unit.claim}</span>
                        <span className="block border-l-2 border-border pl-2 text-xs text-fg-muted">{unit.quote}</span>
                        <span className="block break-all text-xs text-fg-subtle">{titleOf.get(unit.sourceId) ?? "Outside page"}</span>
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            )}
            <p className="text-xs text-fg-muted">
              Not offered: {offered.quoteNotFound} quote not found on its page · {offered.needsReview} need review · {offered.unsupported} unsupported. Already decided: {offered.admitted} admitted · {offered.rejected} rejected.
            </p>
            <p className="text-xs text-fg-muted">
              {parts.length === 0
                ? "Every part of this brief already has a run."
                : `${parts.length} ${parts.length === 1 ? "part" : "parts"} to draft · writing estimate about $${estimate.low.toFixed(2)}–$${estimate.high.toFixed(2)}, before the checks.`}
            </p>
          </>
        )}
      </PanelBody>
      <PanelFooter>
        <span>Approving admits the ticked claims and queues the Writer&apos;s runs. Nothing is published; the article still needs its check and Gate 2.</span>
      </PanelFooter>
      {confirmWriting && (
        <SpendConfirmDialog confirmation={writingConfirmation(projectId, counts.waiting)} projectId={projectId} busy={writing.running} onClose={() => setConfirmWriting(false)}
          onConfirm={() => {
            setConfirmWriting(false);
            void write();
          }} />
      )}
      {confirming && (
        <SpendConfirmDialog confirmation={gate1Confirmation(projectId, brief, parts, ticked.length, offered)} projectId={projectId} busy={busy} onClose={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            void approve();
          }} />
      )}
    </Panel>
  );
}
