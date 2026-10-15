"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { approveArticleVersion } from "@/app/(app)/projects/article-approval-actions";
import { recordArticleProposal } from "@/app/(app)/projects/article-proposal-actions";
import { SpendConfirmDialog } from "@/components/spend/spend-confirm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { RECORD_PROPOSAL_CONFIRMATION } from "@/lib/content/articles/proposals/confirmation";
import type { ArticleProposalStateView } from "@/lib/content/articles/proposals/service";
import { proposalLoadFromResponse } from "@/lib/content/articles/proposals/view";
import { GATE2_LABEL, checkStatus, gate2Confirmation, gate2View, indexingLink, runGate2, type Gate2Io, type Gate2Outcome, type Gate2Snapshot } from "@/lib/pipeline/gate2";
import { listFromResponse, MODE_LABEL, todayUtc, type PublicationEntry } from "@/lib/publishing/presenter";
import type { ArticleApprovalState } from "@/types/content-article-approval";

/**
 * Gate 2 — *Approve & publish* (OC1, PR 7; docs/roadmap/OC1-one-click-article.md). Beneath the article's check table on
 * the Gate 1 panel, once every unit passed: the steps still to do, the published date, the owner's attestation tick
 * when the version attests paragraphs, and one confirmation that runs approve → propose → request → Publish through
 * the existing actions and routes (`runGate2`). A publication under way shows *Check status*; a live one, its page and
 * the Search Console inspection link for *Request indexing*.
 */

type Load = { readonly status: "loading" } | { readonly status: "failed" } | { readonly status: "ready"; readonly snapshot: Gate2Snapshot };

async function readSnapshot(projectId: string, articleId: string, signal?: AbortSignal): Promise<Gate2Snapshot | null> {
  const q = `project=${encodeURIComponent(projectId)}&article=${encodeURIComponent(articleId)}`;
  const [a, p, l] = await Promise.all([
    fetch(`/api/content-article-approvals?${q}`, { cache: "no-store", signal }),
    fetch(`/api/content-article-proposals?${q}`, { cache: "no-store", signal }),
    fetch(`/api/publications?project=${encodeURIComponent(projectId)}`, { cache: "no-store", signal }),
  ]);
  const approval = a.ok ? ((await a.json().catch(() => null)) as { approval?: ArticleApprovalState } | null)?.approval ?? null : null;
  const proposal = proposalLoadFromResponse(p.status, p.status === 200 ? await p.json().catch(() => null) : null);
  const list = listFromResponse(l.status, await l.json().catch(() => null), Date.now());
  if (approval === null || proposal.status !== "ready" || list.status !== "loaded") return null;
  return { approval, proposal: proposal.state, mode: list.mode, configured: list.configured, publications: list.entries };
}

export function Gate2Panel({ projectId, articleId, onChanged }: { projectId: string; articleId: string; onChanged: () => void }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [version, setVersion] = useState(0);
  const [publishedOn, setPublishedOn] = useState(() => todayUtc(Date.now()));
  const [ticked, setTicked] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Gate2Outcome | { text: string; tone: Gate2Outcome["tone"] } | null>(null);
  const inFlight = useRef(false);
  const dateId = useId();
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    readSnapshot(projectId, articleId, controller.signal)
      .then((snapshot) => setLoad(snapshot === null ? { status: "failed" } : { status: "ready", snapshot }))
      .catch((error: unknown) => {
        if (!(error instanceof Error && error.name === "AbortError")) setLoad({ status: "failed" });
      });
    return () => controller.abort();
  }, [projectId, articleId, version]);

  const io: Gate2Io = {
    approve: async (attestationConfirmed) => {
      const answer = load.status === "ready" ? await approveArticleVersion(projectId, articleId, load.snapshot.approval.currentVersion, attestationConfirmed) : null;
      return answer === null ? { ok: false } : answer.ok ? { ok: true } : { ok: false, reason: answer.reason };
    },
    readProposal: async () => {
      const response = await fetch(`/api/content-article-proposals?project=${encodeURIComponent(projectId)}&article=${encodeURIComponent(articleId)}`, { cache: "no-store" });
      const read = proposalLoadFromResponse(response.status, response.status === 200 ? await response.json().catch(() => null) : null);
      return read.status === "ready" ? (read.state as ArticleProposalStateView) : null;
    },
    propose: async (destination, articleVersion) => {
      const answer = await recordArticleProposal(projectId, articleId, articleVersion, destination, RECORD_PROPOSAL_CONFIRMATION);
      return answer.ok ? { ok: true } : { ok: false, reason: answer.reason };
    },
    request: async (date) => {
      const response = await fetch("/api/publications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project: projectId, articleId, publishedOn: date, crossLinkAnchor: null }), cache: "no-store" });
      return { status: response.status, body: await response.json().catch(() => null) };
    },
    readPublications: async () => {
      const response = await fetch(`/api/publications?project=${encodeURIComponent(projectId)}`, { cache: "no-store" });
      const list = listFromResponse(response.status, await response.json().catch(() => null), Date.now());
      return list.status === "loaded" ? (list.entries as readonly PublicationEntry[]) : null;
    },
    publish: async (publicationId) => {
      const response = await fetch(`/api/publications/${encodeURIComponent(publicationId)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "publish" }), cache: "no-store" });
      return { status: response.status, body: await response.json().catch(() => null) };
    },
  };

  const finish = (result: { text: string; tone: Gate2Outcome["tone"] }) => {
    setOutcome(result);
    inFlight.current = false;
    setBusy(false);
    reload();
    onChanged();
  };

  if (load.status === "loading") return <Skeleton className="h-10 w-full" />;
  if (load.status === "failed") return <p className="text-xs text-warning">The approval, proposal or publication state could not be read, so Gate 2 is not offered here. Use the project screen.</p>;

  const { snapshot } = load;
  const view = gate2View(snapshot);
  if (view.state === "not-checked") return null;

  return (
    <div className="space-y-2 rounded-md border border-border p-3" aria-label="Approve publishing">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-0.5">
          <p className="text-xs font-medium text-fg">Approve publishing</p>
          <p className="text-[12px] text-fg-subtle">Gate 2 of the one-click article. Every check unit passed.</p>
        </div>
        <Badge tone={snapshot.mode === "off" ? "neutral" : "accent"}>{MODE_LABEL[snapshot.mode]}</Badge>
      </div>
      {outcome !== null && (
        <p className={outcome.tone === "warning" ? "text-xs text-warning" : "text-xs text-fg-muted"} role="status">{outcome.text}</p>
      )}

      {view.state === "blocked" && <p className="text-xs text-warning">{view.reason}</p>}

      {view.state === "live" && (
        <div className="space-y-1 text-xs">
          <p className="text-fg">Live: <a href={view.url} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">{view.url}</a></p>
          <p className="text-fg-muted">
            Last step: open{" "}
            <a href={indexingLink(view.url)} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">URL inspection in Search Console</a>
            {" "}and press Request indexing.
          </p>
        </div>
      )}

      {view.state === "in-progress" && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-fg-muted">Publication under way ({view.status}).</span>
          {view.pullRequestUrl !== null && (
            <a href={view.pullRequestUrl} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">Open the pull request</a>
          )}
          <Button
            size="sm"
            variant="secondary"
            icon="refresh"
            disabled={busy}
            aria-busy={busy}
            onClick={async () => {
              if (inFlight.current) return;
              inFlight.current = true;
              setBusy(true);
              finish(await checkStatus(io, view.publicationId));
            }}
          >
            Check status
          </Button>
        </div>
      )}

      {view.state === "ready" && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Published date" htmlFor={dateId} hint="The date the article shows as published.">
              <TextInput id={dateId} type="date" value={publishedOn} onChange={(event) => setPublishedOn(event.target.value)} />
            </Field>
            <Link href={`/content/${encodeURIComponent(articleId)}?project=${encodeURIComponent(projectId)}`} className="pb-2 text-xs text-fg-muted underline underline-offset-2 hover:text-fg">
              Read the article first
            </Link>
          </div>
          {view.needsAttestation && (
            <label className="flex items-start gap-2 text-xs text-fg">
              <input type="checkbox" className="mt-0.5" checked={ticked} onChange={(event) => setTicked(event.target.checked)} disabled={busy} />
              <span>
                I attest the {view.attestedCount} marked {view.attestedCount === 1 ? "paragraph" : "paragraphs"}: first-hand client experience or our own view, as each is labelled. They are not checked against the records, and readers will see the label beside each.
              </span>
            </label>
          )}
          <Button variant="primary" icon="check" disabled={busy || publishedOn === "" || (view.needsAttestation && !ticked)} aria-busy={busy} onClick={() => setConfirming(true)}>
            {GATE2_LABEL}
          </Button>
          {confirming && (
            <SpendConfirmDialog
              projectId={projectId}
              confirmation={gate2Confirmation(projectId, snapshot, view.steps, publishedOn)}
              busy={busy}
              onClose={() => setConfirming(false)}
              onConfirm={async () => {
                setConfirming(false);
                if (inFlight.current) return;
                inFlight.current = true;
                setBusy(true);
                finish(await runGate2(io, snapshot, view.steps, { attestationConfirmed: view.needsAttestation && ticked, publishedOn }));
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
