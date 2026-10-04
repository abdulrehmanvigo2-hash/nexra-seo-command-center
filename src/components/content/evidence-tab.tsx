"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ProviderUsageBlock } from "@/components/keywords/provider-estimates";
import { SpendConfirmDialog } from "@/components/spend/spend-confirm";
import { OpportunityBriefPanel } from "@/components/content/opportunity-brief";
import { RunNowButton, RunNowNote, useRunNow } from "@/components/agent-runs/run-now";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Select, TextInput } from "@/components/ui/field";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { queueConfirmation } from "@/lib/agent-runs/spend-confirm";
import { runHistoryListUrl } from "@/lib/agent-runs/run-history-view";
import { describeFetchState, evidenceSourcesUrl, evidenceUnitsUrl, isOutsideUrl, type EvidenceSource, type EvidenceUnit } from "@/lib/evidence/contract";
import {
  acceptedOpportunities,
  decideConfirmation,
  EVIDENCE_NOTE,
  extractionRuns,
  isAdmissible,
  latestCompletedSerp,
  NO_OPPORTUNITY_COPY,
  NO_OPPORTUNITY_TITLE,
  NOT_SET_UP_COPY,
  NOT_SET_UP_TITLE,
  opportunityLabel,
  readState,
  recordOffered,
  SERP_LABEL,
  serpConfirmation,
  serpEstimateUsd,
  SNIPPET_NOTE,
  sourceConfirmation,
  sourceStateTone,
  unitBadge,
  writeOutcome,
  type ReadState,
} from "@/lib/evidence/presenter";
import { opportunitiesUrl, type AcceptedOpportunity, type OpportunitiesView } from "@/lib/opportunities/contract";
import { resultsOfType, serpUrl, type SerpView } from "@/lib/serp/contract";
import type { Confirmation } from "@/lib/agent-runs/spend-confirm";
import { BRIEF_REQUEST, briefRuns } from "@/lib/briefs/presenter";
import type { AgentRun } from "@/types/agent-run";

/**
 * The *Evidence* tab in Content Studio (M4, PR 7). For one accepted opportunity: Google's results (one paid call,
 * confirmed with the cost and today's provider spend), the outside pages fetched for it, each page's extraction runs
 * and the claims recorded from them, with Admit / Reject. Every read is its own; a deployment without the M4 schema
 * reads "Not set up yet" and the other tabs are untouched. Every write opens a confirmation first.
 */

type Note = { readonly text: string; readonly tone: "neutral" | "warning" } | null;

function useRead<T>(url: string | null, pick: (body: Record<string, unknown>) => T | null, version: number): ReadState<T> {
  const [state, setState] = useState<ReadState<T>>({ status: "loading" });
  const pickRef = useRef(pick);
  useEffect(() => {
    if (url === null) return;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loading state belongs to this read
    setState((current) => (current.status === "ready" ? current : { status: "loading" }));
    fetch(url, { cache: "no-store", signal: controller.signal })
      .then(async (response) => setState(readState(response.status, await response.json().catch(() => null), pickRef.current)))
      .catch((error: unknown) => {
        if (!(error instanceof Error && error.name === "AbortError")) setState({ status: "failed" });
      });
    return () => controller.abort();
  }, [url, version]);
  return state;
}

/** One confirmed POST, its answer in words, then a re-read. */
function usePost(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const inFlight = useRef(false);
  const send = async (url: string, body: Record<string, unknown>, done: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setNote(null);
    try {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
      setNote(writeOutcome(response.status, await response.json().catch(() => null), done));
    } catch {
      setNote(writeOutcome(0, null, done));
    }
    inFlight.current = false;
    setBusy(false);
    onDone();
  };
  return { busy, note, send };
}

function NoteLine({ note }: { note: Note }) {
  if (note === null) return null;
  return (
    <p className={note.tone === "warning" ? "text-xs text-warning" : "text-xs text-fg-muted"} role="status">
      {note.text}
    </p>
  );
}

function ReadFallback({ state, what }: { state: ReadState<unknown>; what: string }) {
  if (state.status === "loading") return <Skeleton className="h-16 w-full" />;
  if (state.status === "not-set-up") return <EmptyState title={NOT_SET_UP_TITLE} description={NOT_SET_UP_COPY} size="sm" />;
  return <p className="text-sm text-warning">{what} could not be read. Nothing is shown in their place.</p>;
}

export function EvidenceTab({ projectId }: { projectId: string }) {
  const opportunities = useRead<OpportunitiesView>(opportunitiesUrl(projectId), (body) => (body.view as OpportunitiesView | undefined) ?? null, 0);
  const [chosen, setChosen] = useState<string | null>(null);

  if (opportunities.status !== "ready") return <ReadFallback state={opportunities} what="Accepted opportunities" />;
  const accepted = acceptedOpportunities(opportunities.value);
  if (accepted.length === 0) return <EmptyState title={NO_OPPORTUNITY_TITLE} description={NO_OPPORTUNITY_COPY} />;
  const opportunity = accepted.find((entry) => entry.id === chosen) ?? accepted[0]!;

  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-muted">{EVIDENCE_NOTE}</p>
      <label className="flex max-w-xl flex-col gap-1 text-xs text-fg-muted">
        Accepted opportunity
        <Select value={opportunity.id} onChange={(event) => setChosen(event.target.value)} options={accepted.map((entry) => ({ value: entry.id, label: opportunityLabel(entry) }))} />
      </label>
      <OpportunityEvidence key={opportunity.id} projectId={projectId} opportunity={opportunity} />
    </div>
  );
}

function OpportunityEvidence({ projectId, opportunity }: { projectId: string; opportunity: AcceptedOpportunity }) {
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const serp = useRead<SerpView>(serpUrl(projectId, opportunity.id), (body) => (body.view as SerpView | undefined) ?? null, version);
  const sources = useRead<readonly EvidenceSource[]>(evidenceSourcesUrl(projectId, opportunity.id), (body) => (Array.isArray(body.sources) ? (body.sources as EvidenceSource[]) : null), version);
  const runs = useRead<readonly AgentRun[]>(runHistoryListUrl({ projectId, agentId: "research-evidence", limit: 50, offset: 0 }), (body) => (Array.isArray(body.runs) ? (body.runs as AgentRun[]) : null), version);
  const strategistRuns = useRead<readonly AgentRun[]>(runHistoryListUrl({ projectId, agentId: BRIEF_REQUEST.agentId, limit: 50, offset: 0 }), (body) => (Array.isArray(body.runs) ? (body.runs as AgentRun[]) : null), version);
  const post = usePost(reload);
  const briefPost = usePost(reload);
  const [dialog, setDialog] = useState<{ readonly confirmation: Confirmation; readonly run: () => void; readonly provider?: boolean; readonly usage?: boolean } | null>(null);
  const briefRequest = { projectId, ...BRIEF_REQUEST, input: { opportunityId: opportunity.id } };
  const [typed, setTyped] = useState("");

  const fetchPage = (url: string, body: Record<string, unknown>) =>
    setDialog({ confirmation: sourceConfirmation(projectId, url), run: () => void post.send("/api/evidence/sources", { project: projectId, opportunity: opportunity.id, ...body }, "Page fetched and recorded.") });

  const serpView = serp.status === "ready" ? serp.value : null;
  const latest = serpView === null ? null : latestCompletedSerp(serpView);
  const mode = serpView?.provider.mode ?? "sandbox";

  return (
    <>
      <Panel>
        <PanelHeader
          title="Google results"
          description={`One DataForSEO call for "${opportunity.title}" — the keyword is the opportunity's own.`}
          actions={
            serpView !== null && serpView.provider.status === "ready" ? (
              <Button variant="primary" icon="search" disabled={post.busy} aria-busy={post.busy}
                onClick={() => setDialog({ provider: true, confirmation: serpConfirmation(projectId, opportunity, mode), run: () => void post.send("/api/serp", { project: projectId, opportunity: opportunity.id }, "Google results recorded.") })}>
                {SERP_LABEL}
              </Button>
            ) : undefined
          }
        />
        <PanelBody className="space-y-3">
          <NoteLine note={post.note} />
          {serp.status !== "ready" ? (
            <ReadFallback state={serp} what="Google results" />
          ) : serp.value.provider.status !== "ready" ? (
            <p className="text-sm text-fg-muted">DataForSEO is not usable on this deployment ({serp.value.provider.status === "not-configured" ? "no credentials" : "the daily cap is not usable"}).</p>
          ) : latest === null ? (
            <p className="text-sm text-fg-muted">No Google results recorded for this opportunity.</p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
              <ol className="space-y-2 text-sm">
                {resultsOfType(latest.results, "organic").map((result) => (
                  <li key={result.id} className="flex flex-wrap items-start justify-between gap-2 border-b border-border pb-2">
                    <div className="min-w-0">
                      <span className="text-xs text-fg-subtle">#{result.rank} · {result.domain}</span>
                      <div className="font-medium text-fg">{result.title}</div>
                      <div className="break-all text-xs text-fg-muted">{result.url}</div>
                    </div>
                    <Button size="sm" variant="secondary" disabled={post.busy} onClick={() => fetchPage(result.url ?? "", { serpResult: result.id })}>
                      Fetch page…
                    </Button>
                  </li>
                ))}
              </ol>
              <div className="space-y-3 text-xs text-fg-muted">
                <div>
                  <p className="font-medium text-fg">People also ask</p>
                  <ul className="mt-1 list-disc pl-4">{resultsOfType(latest.results, "people-also-ask").map((r) => <li key={r.id}>{r.title}</li>)}</ul>
                </div>
                <div>
                  <p className="font-medium text-fg">Related searches</p>
                  <ul className="mt-1 list-disc pl-4">{resultsOfType(latest.results, "related-search").map((r) => <li key={r.id}>{r.title}</li>)}</ul>
                </div>
              </div>
            </div>
          )}
        </PanelBody>
        <PanelFooter>
          <span>{SNIPPET_NOTE}</span>
          {latest !== null && <span>Fetched {latest.run.createdAt.slice(0, 16).replace("T", " ")} UTC · {latest.run.mode === "live" ? "live" : "sandbox — dummy data"}</span>}
        </PanelFooter>
      </Panel>

      <Panel>
        <PanelHeader title="Outside pages" description="Fetched under the crawler's rules: robots.txt first, HTML only, the visible text kept internally (at most 20,000 characters)." />
        <PanelBody className="space-y-3">
          <div className="flex max-w-xl flex-wrap items-end gap-2">
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-fg-muted">
              Another page (https)
              <TextInput value={typed} onChange={(event) => setTyped(event.target.value)} placeholder="https://" disabled={post.busy} />
            </label>
            <Button variant="secondary" disabled={post.busy || !isOutsideUrl(typed.trim())} onClick={() => fetchPage(typed.trim(), { url: typed.trim() })}>
              Fetch page…
            </Button>
          </div>
          {sources.status !== "ready" ? (
            <ReadFallback state={sources} what="Outside pages" />
          ) : sources.value.length === 0 ? (
            <p className="text-sm text-fg-muted">No page fetched for this opportunity.</p>
          ) : (
            <ul className="space-y-4">
              {sources.value.map((source) => (
                <SourceRow key={source.id} projectId={projectId} source={source} runs={runs.status === "ready" ? extractionRuns(runs.value, source.id) : null} version={version} onChanged={reload} />
              ))}
            </ul>
          )}
        </PanelBody>
      </Panel>

      <OpportunityBriefPanel
        runs={strategistRuns.status === "ready" ? briefRuns(strategistRuns.value, opportunity.id) : strategistRuns.status === "loading" ? "loading" : "failed"}
        busy={briefPost.busy}
        note={briefPost.note}
        onChanged={reload}
        onDraft={() => setDialog({ usage: true, confirmation: queueConfirmation(briefRequest), run: () => void briefPost.send("/api/agent-runs", briefRequest, "Brief queued, not run. Run now below, or the scheduled worker picks it up.") })}
      />

      {dialog !== null && (
        <SpendConfirmDialog confirmation={dialog.confirmation} projectId={dialog.usage ? projectId : null} busy={post.busy || briefPost.busy} onClose={() => setDialog(null)}
          onConfirm={() => {
            const chosen = dialog;
            setDialog(null);
            chosen.run();
          }}>
          {dialog.provider ? <ProviderUsageBlock projectId={projectId} estimateUsd={serpEstimateUsd(mode)} mode={mode} /> : null}
        </SpendConfirmDialog>
      )}
    </>
  );
}

function SourceRow({ projectId, source, runs, version, onChanged }: { projectId: string; source: EvidenceSource; runs: readonly AgentRun[] | null; version: number; onChanged: () => void }) {
  const units = useRead<readonly EvidenceUnit[]>(source.fetchState === "fetched" ? evidenceUnitsUrl(projectId, source.id) : null, (body) => (Array.isArray(body.units) ? (body.units as EvidenceUnit[]) : null), version);
  const post = usePost(onChanged);
  const { executing, executeNote, runNow } = useRunNow(() => onChanged());
  const [dialog, setDialog] = useState<{ readonly confirmation: Confirmation; readonly run: () => void; readonly usage: boolean } | null>(null);
  const tone = sourceStateTone(source);
  const unitList = units.status === "ready" ? units.value : [];

  return (
    <li className="space-y-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-fg">{source.title ?? "Untitled page"}</div>
          <div className="break-all text-xs text-fg-muted">{source.finalUrl ?? source.requestedUrl}</div>
          <div className="mt-1 flex flex-wrap gap-2 text-xs">
            <Badge tone={tone}>{describeFetchState(source.fetchState)}</Badge>
            {source.textChars !== null && <span className="text-fg-subtle">{source.textChars.toLocaleString("en")} characters kept · fetched {source.fetchedAt.slice(0, 10)}</span>}
          </div>
        </div>
        {source.fetchState === "fetched" && (
          <Button size="sm" variant="secondary" disabled={post.busy}
            onClick={() => setDialog({ usage: true, confirmation: queueConfirmation({ projectId, agentId: "research-evidence", taskType: "evidence-extract", input: { sourceId: source.id } }),
              run: () => void post.send("/api/agent-runs", { projectId, agentId: "research-evidence", taskType: "evidence-extract", input: { sourceId: source.id } }, "Extraction queued, not run.") })}>
            Queue extraction…
          </Button>
        )}
      </div>
      {source.preview !== null && <p className="text-xs text-fg-muted">“{source.preview}{(source.textChars ?? 0) > source.preview.length ? "…" : ""}”</p>}
      <NoteLine note={post.note} />
      <RunNowNote note={executeNote} />
      {runs !== null && runs.length > 0 && (
        <ul className="space-y-1.5 text-xs">
          {runs.map((run) => (
            <li key={run.id} className="flex flex-wrap items-center gap-2">
              <span className="text-fg-subtle">Extraction {run.id.slice(0, 8)} · {run.status}{run.executor === "mock" ? " · simulated, never evidence" : ""}</span>
              {run.status === "queued" && <RunNowButton run={run} executing={executing} onRunNow={() => void runNow(run)} />}
              {recordOffered(run, unitList) && (
                <Button size="sm" variant="secondary" disabled={post.busy} onClick={() => void post.send("/api/evidence/units", { project: projectId, source: source.id, run: run.id }, "Claims recorded; the database checked each quote.")}>
                  Record claims
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {source.fetchState === "fetched" && units.status !== "ready" && units.status !== "loading" && <ReadFallback state={units} what="Claims" />}
      {unitList.length > 0 && (
        <ul className="space-y-2">
          {unitList.map((unit) => {
            const badge = unitBadge(unit);
            return (
              <li key={unit.id} className="space-y-1 border-t border-border pt-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-fg">{unit.claim}</span>
                  <Badge tone={badge.tone}>{badge.label}</Badge>
                </div>
                <blockquote className="border-l-2 border-border pl-2 text-xs text-fg-muted">{unit.quote}</blockquote>
                {unit.decision === "pending" && (
                  <div className="flex gap-2">
                    {isAdmissible(unit) && (
                      <Button size="sm" variant="primary" disabled={post.busy} onClick={() => setDialog({ usage: false, confirmation: decideConfirmation(unit, "admitted"), run: () => void post.send(`/api/evidence/units/${unit.id}`, { project: projectId, decision: "admitted" }, "Admitted.") })}>
                        Admit…
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" disabled={post.busy} onClick={() => setDialog({ usage: false, confirmation: decideConfirmation(unit, "rejected"), run: () => void post.send(`/api/evidence/units/${unit.id}`, { project: projectId, decision: "rejected" }, "Rejected.") })}>
                      Reject…
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {dialog !== null && (
        <SpendConfirmDialog confirmation={dialog.confirmation} projectId={dialog.usage ? projectId : null} busy={post.busy} onClose={() => setDialog(null)}
          onConfirm={() => {
            const chosen = dialog;
            setDialog(null);
            chosen.run();
          }} />
      )}
    </li>
  );
}
