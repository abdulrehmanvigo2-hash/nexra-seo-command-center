"use client";

import { useRef, useState } from "react";
import { executeRun, readRun } from "@/components/content/writer-io";
import { ProviderUsageBlock } from "@/components/keywords/provider-estimates";
import { SpendConfirmDialog } from "@/components/spend/spend-confirm";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import type { DailyUsage } from "@/lib/agent-runs/daily-usage";
import { runHistoryListUrl } from "@/lib/agent-runs/run-history-view";
import { capRoom } from "@/lib/briefs/draft-presenter";
import { BRIEF_REQUEST } from "@/lib/briefs/presenter";
import { evidenceSourcesUrl, evidenceUnitsUrl, type EvidenceSource, type EvidenceUnit } from "@/lib/evidence/contract";
import { serpEstimateUsd, writeOutcome } from "@/lib/evidence/presenter";
import type { AcceptedOpportunity } from "@/lib/opportunities/contract";
import { runPipeline, type PipelineIo } from "@/lib/pipeline/driver";
import {
  RESEARCH_LABEL,
  isFinalRecordRefusal,
  researchConfirmation,
  researchNote,
  researchRequest,
  researchRuns,
  researchSnapshot,
  researchStepText,
  researchWork,
  type ResearchSnapshot,
} from "@/lib/pipeline/research";
import { serpUrl, type SerpView } from "@/lib/serp/contract";
import type { AgentRun } from "@/types/agent-run";

/**
 * *Start research…* (OC1, PR 8; `src/lib/pipeline/research.ts`). At the top of the Evidence tab for one accepted
 * opportunity: one confirmation, then Google's results, the top pages fetched, their claims extracted and recorded and
 * the brief drafted, one step at a time while the page is open, stopping at Gate 1 below. The panels beneath still show
 * every step and keep their own buttons.
 */

async function readJson(url: string): Promise<{ ok: boolean; body: Record<string, unknown> | null }> {
  const response = await fetch(url, { cache: "no-store" });
  return { ok: response.ok, body: (await response.json().catch(() => null)) as Record<string, unknown> | null };
}

async function readResearch(projectId: string, projectDomain: string, opportunityId: string, settledRuns?: ReadonlySet<string>): Promise<ResearchSnapshot | null> {
  try {
    const [serp, sources, research, strategist] = await Promise.all([
      readJson(serpUrl(projectId, opportunityId)),
      readJson(evidenceSourcesUrl(projectId, opportunityId)),
      readJson(runHistoryListUrl({ projectId, agentId: "research-evidence", limit: 50, offset: 0 })),
      readJson(runHistoryListUrl({ projectId, agentId: BRIEF_REQUEST.agentId, limit: 50, offset: 0 })),
    ]);
    if (!serp.ok || !sources.ok || !research.ok || !strategist.ok) return null;
    const sourceList = Array.isArray(sources.body?.sources) ? (sources.body.sources as EvidenceSource[]) : null;
    const researchRunsList = Array.isArray(research.body?.runs) ? (research.body.runs as AgentRun[]) : null;
    const strategistRuns = Array.isArray(strategist.body?.runs) ? (strategist.body.runs as AgentRun[]) : null;
    const view = (serp.body?.view as SerpView | undefined) ?? null;
    if (sourceList === null || researchRunsList === null || strategistRuns === null) return null;
    const unitLists = await Promise.all(
      sourceList
        .filter((source) => source.fetchState === "fetched")
        .map(async (source) => {
          const read = await readJson(evidenceUnitsUrl(projectId, source.id));
          if (!read.ok || !Array.isArray(read.body?.units)) throw new Error("units unreadable");
          return read.body.units as EvidenceUnit[];
        }),
    );
    return researchSnapshot({ projectDomain, opportunityId, serp: view, sources: sourceList, researchRuns: researchRunsList, strategistRuns, units: unitLists.flat(), settledRuns });
  } catch {
    return null;
  }
}

export function ResearchPanel({ projectId, projectDomain, opportunity, serp, onChanged }: { projectId: string; projectDomain: string; opportunity: AcceptedOpportunity; serp: SerpView | null; onChanged: () => void }) {
  const [confirm, setConfirm] = useState<{ snapshot: ResearchSnapshot } | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; tone: "neutral" | "warning" } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const stopRef = useRef(false);
  const inFlight = useRef(false);
  const mode = serp?.provider.mode ?? "sandbox";
  const providerReady = serp !== null && serp.provider.status === "ready";

  const open = async () => {
    setPreparing(true);
    setNote(null);
    const snapshot = await readResearch(projectId, projectDomain, opportunity.id);
    setPreparing(false);
    if (snapshot === null) return setNote({ text: "What is recorded for this opportunity could not be read, so nothing was started.", tone: "warning" });
    setConfirm({ snapshot });
  };

  const start = async (snapshot: ResearchSnapshot) => {
    if (inFlight.current) return;
    inFlight.current = true;
    stopRef.current = false;
    setNote(null);
    const usageResponse = await fetch(`/api/agent-runs/daily-usage?project=${encodeURIComponent(projectId)}`, { cache: "no-store" }).catch(() => null);
    const usage = usageResponse?.ok ? ((await usageResponse.json().catch(() => null)) as { usage?: DailyUsage } | null)?.usage ?? null : null;
    const room = capRoom(usage, researchRuns(researchWork(snapshot)));
    if (!room.ok) {
      setNote({ text: room.why, tone: "warning" });
      inFlight.current = false;
      return;
    }
    setRunning("Starting…");
    let latest: ResearchSnapshot | null = snapshot;
    const settled = new Set<string>();
    const io: PipelineIo = {
      readSnapshot: async () => {
        latest = await readResearch(projectId, projectDomain, opportunity.id, settled);
        return latest;
      },
      perform: async (action) => {
        if (action.kind === "pick-sources") return { ok: true };
        const request = latest === null ? null : researchRequest(action, latest, projectId, opportunity.id);
        if (request === null) return { ok: false, message: "This step has nothing to send." };
        try {
          const response = await fetch(request.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request.body), cache: "no-store" });
          const body = (await response.json().catch(() => null)) as { run?: AgentRun } | null;
          if (action.kind === "record-units" && isFinalRecordRefusal(response.status, body)) {
            settled.add(action.runId);
            return { ok: true };
          }
          if (!response.ok) return { ok: false, message: writeOutcome(response.status, body, "").text || `HTTP ${response.status}` };
          return request.url === "/api/agent-runs" && body?.run ? { ok: true, run: body.run } : { ok: true };
        } catch {
          return { ok: false, message: "The request could not be sent. Check your connection." };
        }
      },
      execute: executeRun,
      readRun,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      stopRequested: () => stopRef.current,
      onProgress: (event) => {
        if (event.type === "acting") setRunning(researchStepText(event.action, latest));
        if (event.type === "waiting-serp") setRunning("Waiting for Google's results");
      },
    };
    const outcome = await runPipeline(io);
    setNote(researchNote(outcome));
    setRunning(null);
    inFlight.current = false;
    onChanged();
  };

  const work = confirm === null ? null : researchWork(confirm.snapshot);

  return (
    <Panel>
      <PanelHeader
        title="Research"
        description={`From "${opportunity.title}" to a brief in one press: Google's results, the top pages (your site left out), their claims and the brief. Then Gate 1 below.`}
        actions={
          running === null ? (
            <Button variant="primary" icon="sparkles" disabled={!providerReady || preparing} aria-busy={preparing} onClick={() => void open()}>
              {RESEARCH_LABEL}
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => { stopRef.current = true; }}>Stop after this step</Button>
          )
        }
      />
      <PanelBody className="space-y-2">
        {!providerReady && <p className="text-xs text-fg-muted">DataForSEO is not usable on this deployment, so the research cannot start from here.</p>}
        {running !== null && <p className="text-xs text-fg-muted" role="status">{running}. Keep this page open.</p>}
        {note !== null && <p className={note.tone === "warning" ? "text-xs text-warning" : "text-xs text-fg-muted"} role="status">{note.text}</p>}
      </PanelBody>
      {confirm !== null && work !== null && (
        <SpendConfirmDialog
          projectId={projectId}
          confirmation={researchConfirmation(projectId, opportunity, work, mode === "live")}
          busy={running !== null}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            const chosen = confirm;
            setConfirm(null);
            void start(chosen.snapshot);
          }}
        >
          {work.serp ? <ProviderUsageBlock projectId={projectId} estimateUsd={serpEstimateUsd(mode)} mode={mode} /> : null}
        </SpendConfirmDialog>
      )}
    </Panel>
  );
}
