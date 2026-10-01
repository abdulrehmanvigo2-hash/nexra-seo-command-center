"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SpendConfirmDialog } from "@/components/spend/spend-confirm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import type { SnapshotRunView, SnapshotUsage } from "@/lib/keyword-snapshots/contract";
import { keywordSnapshotResumeUrl, keywordSnapshotsUrl, keywordSnapshotUsageUrl } from "@/lib/keyword-snapshots/contract";
import {
  FETCH_LABEL,
  NEVER_OBSERVED_NOTE,
  NO_RUN_COPY,
  PROVIDER_ESTIMATE_LABEL,
  READ_FAILED,
  RESUME_LABEL,
  costLine,
  fetchConfirmation,
  figure,
  modeBadge,
  providerUsageLines,
  resumeConfirmation,
  resumeEstimateUsd,
  resumeOffered,
  runDate,
  runOutcome,
  runStatusLine,
  sectionState,
  type ProviderUsageState,
  type SectionState,
} from "@/lib/keyword-snapshots/presenter";
import type { ProviderMode } from "@/lib/providers/dataforseo/constants";
import { estimateRun } from "@/lib/providers/dataforseo/estimate";
import { SEED_TOPICS } from "@/lib/providers/dataforseo/constants";

/**
 * *Provider estimates* on the Keyword Intelligence screen (F0, PR 5; design
 * note §5 and §8). One read of its own, `GET /api/keyword-snapshots`, kept
 * apart from the observed inventory: a deployment without the migration,
 * the credentials or the store reads "Not set up yet" and the rest of the
 * screen is untouched. Every figure carries the provider-estimate label; a
 * sandbox run is labelled dummy data. Fetch and Resume open the F3
 * confirmation first; the server recomputes the estimate and enforces the
 * cap. Nothing here is observed data and no agent reads it.
 */

export function ProviderEstimatesSection({ projectId }: { projectId: string }) {
  const [state, setState] = useState<SectionState>({ status: "loading" });
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loading state belongs to this read
    setState({ status: "loading" });
    fetch(keywordSnapshotsUrl(projectId), { cache: "no-store", signal: controller.signal })
      .then(async (response) => setState(sectionState(response.status, await response.json().catch(() => null))))
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setState(READ_FAILED);
      });
    return () => controller.abort();
  }, [projectId, version]);

  return (
    <Panel>
      <PanelHeader
        eyebrow="Provider estimates"
        title="DataForSEO keyword estimates"
        description="A provider's model estimates for the ten seed topics — search volume, cost per click, competition, difficulty and intent — recorded with their provenance. Not observed data: kept apart from the Search Console rows above."
        actions={state.status === "ready" ? <FetchControl projectId={projectId} mode={state.mode} onDone={reload} /> : undefined}
      />
      <PanelBody>
        {state.status === "loading" && (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}
        {state.status === "not-set-up" && <EmptyState size="sm" icon="search" title={state.title} description={state.copy} />}
        {state.status === "failed" && (
          <p className="text-sm text-critical" role="status">
            {state.message}
          </p>
        )}
        {(state.status === "not-configured" || state.status === "cap-invalid") && (
          <div className="space-y-4">
            <p className="text-[12.5px] text-fg-muted" role="status">
              {state.copy}
            </p>
            <RunList runs={state.runs} onChanged={reload} />
          </div>
        )}
        {state.status === "ready" && <RunList runs={state.runs} onChanged={reload} />}
      </PanelBody>
      <PanelFooter>
        <span>{NEVER_OBSERVED_NOTE}</span>
        {state.status === "ready" && <span>Mode on this deployment: {modeBadge(state.mode).label} · daily cap ${state.capUsd.toFixed(2)}.</span>}
      </PanelFooter>
    </Panel>
  );
}

/** Today's live spend against the cap, read once when a confirmation opens. */
function useProviderUsage(projectId: string, active: boolean): ProviderUsageState {
  const [state, setState] = useState<ProviderUsageState>({ status: "loading" });
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loading state belongs to this read
    setState({ status: "loading" });
    fetch(keywordSnapshotUsageUrl(projectId), { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (response.status === 503) return setState({ status: "not-set-up" });
        if (!response.ok) return setState({ status: "failed" });
        const body = (await response.json().catch(() => null)) as { usage?: SnapshotUsage } | null;
        const usage = body?.usage;
        if (!usage || typeof usage.day !== "string" || typeof usage.spentUsd !== "number") return setState({ status: "failed" });
        setState({ status: "loaded", usage });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "failed" });
      });
    return () => controller.abort();
  }, [projectId, active]);
  return state;
}

function ProviderUsageBlock({ projectId, estimateUsd, mode }: { projectId: string; estimateUsd: number; mode: ProviderMode }) {
  const usage = useProviderUsage(projectId, true);
  const shown = providerUsageLines(usage, estimateUsd, mode);
  return (
    <div className="space-y-1 rounded-md border border-border bg-surface-raised px-3 py-2.5 text-[12px]" aria-live="polite">
      <p className="text-[11px] font-medium tracking-wide text-fg-subtle uppercase">Today&apos;s provider spend</p>
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

/** One POST, its outcome in words, then the list re-read. */
function useRunRequest(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [note, setNote] = useState<{ text: string; tone: "neutral" | "warning" } | null>(null);
  const send = async (url: string, body: Record<string, unknown> | null) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setNote(null);
    try {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}), cache: "no-store" });
      setNote(runOutcome(response.status, await response.json().catch(() => null)));
    } catch {
      setNote(runOutcome(0, null));
    }
    inFlight.current = false;
    setBusy(false);
    onDone();
  };
  return { busy, note, send };
}

function FetchControl({ projectId, mode, onDone }: { projectId: string; mode: ProviderMode; onDone: () => void }) {
  const { busy, note, send } = useRunRequest(onDone);
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {note && (
        <span className={note.tone === "warning" ? "text-xs text-warning" : "text-xs text-fg-muted"} role="status">
          {note.text}
        </span>
      )}
      <Button variant="primary" icon="search" onClick={() => setOpen(true)} disabled={busy} aria-busy={busy}>
        {busy ? "Fetching…" : FETCH_LABEL}
      </Button>
      {open && (
        <SpendConfirmDialog
          confirmation={fetchConfirmation(projectId, mode)}
          projectId={null}
          busy={busy}
          onClose={() => setOpen(false)}
          onConfirm={() => {
            setOpen(false);
            void send("/api/keyword-snapshots", { project: projectId });
          }}
        >
          <ProviderUsageBlock projectId={projectId} estimateUsd={mode === "live" ? estimateRun(SEED_TOPICS.length).usd : 0} mode={mode} />
        </SpendConfirmDialog>
      )}
    </div>
  );
}

function ResumeControl({ view, onDone }: { view: SnapshotRunView; onDone: () => void }) {
  const { busy, note, send } = useRunRequest(onDone);
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {note && (
        <span className={note.tone === "warning" ? "text-xs text-warning" : "text-xs text-fg-muted"} role="status">
          {note.text}
        </span>
      )}
      <Button variant="secondary" onClick={() => setOpen(true)} disabled={busy} aria-busy={busy}>
        {busy ? "Resuming…" : RESUME_LABEL}
      </Button>
      {open && (
        <SpendConfirmDialog
          confirmation={resumeConfirmation(view)}
          projectId={null}
          busy={busy}
          onClose={() => setOpen(false)}
          onConfirm={() => {
            setOpen(false);
            void send(keywordSnapshotResumeUrl(view.run.id), null);
          }}
        >
          <ProviderUsageBlock projectId={view.run.projectId} estimateUsd={resumeEstimateUsd(view)} mode={view.run.mode} />
        </SpendConfirmDialog>
      )}
    </div>
  );
}

function RunList({ runs, onChanged }: { runs: readonly SnapshotRunView[]; onChanged: () => void }) {
  if (runs.length === 0) return <EmptyState size="sm" icon="search" title="No provider snapshot recorded" description={NO_RUN_COPY} />;
  return (
    <div className="space-y-5">
      {runs.map((view) => (
        <RunBlock key={view.run.id} view={view} onChanged={onChanged} />
      ))}
    </div>
  );
}

function RunBlock({ view, onChanged }: { view: SnapshotRunView; onChanged: () => void }) {
  const { run, metrics } = view;
  const badge = modeBadge(run.mode);
  const status = runStatusLine(view);
  return (
    <section className="space-y-3 rounded-md border border-border p-3" aria-label={`Provider snapshot ${run.id.slice(0, 8)}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={badge.tone} title={badge.title}>
            {badge.label}
          </Badge>
          <Badge tone={status.tone}>{status.label}</Badge>
          <span className="text-[12px] text-fg-muted">
            Run {run.id.slice(0, 8)} · {run.seeds.length} seeds · {costLine(run)}
          </span>
        </div>
        {resumeOffered(view) && <ResumeControl view={view} onDone={onChanged} />}
      </div>
      <p className="text-[12px] font-medium text-fg">{PROVIDER_ESTIMATE_LABEL(runDate(run))}</p>
      {status.detail && (
        <p className="text-[12px] text-fg-muted" role="status">
          {status.detail}
        </p>
      )}
      {metrics.length === 0 ? (
        <p className="text-[12.5px] text-fg-subtle">No keyword row recorded for this run.</p>
      ) : (
        <Table caption={`Provider estimates from run ${run.id.slice(0, 8)}`}>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Keyword</TableHeaderCell>
              <TableHeaderCell>Relation</TableHeaderCell>
              <TableHeaderCell align="right">Volume (est.)</TableHeaderCell>
              <TableHeaderCell align="right">CPC (est.)</TableHeaderCell>
              <TableHeaderCell align="right">Competition (est.)</TableHeaderCell>
              <TableHeaderCell align="right">Difficulty (est.)</TableHeaderCell>
              <TableHeaderCell>Intent (est.)</TableHeaderCell>
              <TableHeaderCell>Seed</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {metrics.map((metric) => (
              <TableRow key={metric.id}>
                <TableCell className="font-medium text-fg">{metric.keyword}</TableCell>
                <TableCell>{metric.relation}</TableCell>
                <TableCell align="right" className="tabular">{figure(metric.searchVolume, "volume")}</TableCell>
                <TableCell align="right" className="tabular">{figure(metric.cpc, "cpc")}</TableCell>
                <TableCell align="right" className="tabular">{figure(metric.competition, "competition")}</TableCell>
                <TableCell align="right" className="tabular">{figure(metric.keywordDifficulty, "difficulty")}</TableCell>
                <TableCell>{metric.intent ?? "not given"}</TableCell>
                <TableCell className="text-fg-muted">{metric.seed}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
