"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SpendConfirmDialog } from "@/components/spend/spend-confirm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import type { DailyUsage } from "@/lib/agent-runs/daily-usage";
import type { ParsedBrief } from "@/lib/briefs/brief";
import { draftParts, partsToQueue } from "@/lib/briefs/draft-presenter";
import { evidenceUnitsUrl, type EvidenceSource, type EvidenceUnit } from "@/lib/evidence/contract";
import { GATE1_LABEL, gate1Confirmation, gate1Requests, gate1State, partsEstimate, runGate1, type Gate1Outcome } from "@/lib/pipeline/gate1";
import { confirmTicks, gate1Evidence } from "@/lib/pipeline/stage-a";
import type { AgentRun } from "@/types/agent-run";

/**
 * Gate 1 — *Approve the plan* (OC1, PR 4; docs/roadmap/OC1-one-click-article.md). Beneath the brief on the Evidence tab:
 * the claims the database would admit, ticked; the others counted, never ticked; the parts the Writer will draft and an
 * estimate. One button opens one confirmation, then admits the ticked claims and queues every part. Nothing here runs a
 * model or writes an article. Once a part run names the brief, the panel shows the plan as approved.
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
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="positive">Plan approved</Badge>
            <span className="text-xs text-fg-subtle">
              {state.at.slice(0, 16).replace("T", " ")} UTC · {state.runs} Writer part {state.runs === 1 ? "run" : "runs"} for brief {briefRun.id.slice(0, 8)} — follow them in the article draft above.
            </span>
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
