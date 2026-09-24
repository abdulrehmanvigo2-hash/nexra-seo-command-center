"use client";

import { useCallback, useEffect, useState } from "react";
import { recordArticleProposal, withdrawArticleProposal } from "@/app/(app)/projects/article-proposal-actions";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  RECORD_PROPOSAL_CONFIRMATION,
  RECORD_PROPOSAL_CONFIRMATION_TEXT,
  WITHDRAW_PROPOSAL_CONFIRMATION,
  WITHDRAW_PROPOSAL_CONFIRMATION_TEXT,
} from "@/lib/content/articles/proposals/confirmation";
import { articleProposalBlockMessage, articleProposalWarningMessage } from "@/lib/content/articles/proposals/eligibility";
import {
  HEADLINE_LABEL,
  LOAD_MESSAGE,
  PROPOSAL_EXPLANATION,
  PROPOSAL_ONLY_BANNER,
  PROPOSAL_SECTION_TITLE,
  canRecord,
  canWithdraw,
  proposalHeadline,
  proposalLoadFromResponse,
  proposalStanding,
  recordNote,
  shortHash,
  withdrawNote,
  type ProposalHeadline,
  type ProposalLoad,
  type ProposalNote,
} from "@/lib/content/articles/proposals/view";
import type { ArticleProposalStateView } from "@/lib/content/articles/proposals/service";
import { formatFullDate, formatTimeUtc } from "@/lib/format";
import type { WebsiteCompletenessReport } from "@/types/content-article";
import type { ArticlePublicationProposal } from "@/types/content-article-proposal";

/**
 * The record-only article publication proposal for the current, exact
 * article version (Stage 5, milestone C6, Checkpoint 4).
 *
 * Shows the server's proposal state — eligibility with every reason and the
 * D2 warning, the destination and the route it would take (not written),
 * the completeness report, the read-only preview and its SHA-256, the
 * active proposal and whether it is still current, and the immutable
 * history. Record appears only when the server says the version is eligible
 * and has built a preview; Withdraw only for the active proposal. Each asks
 * for an explicit confirmation in a dialog, then sends only the project, the
 * article, the version shown, the destination key or the proposal id, and
 * the confirmation token. The server rebuilds everything, and the database
 * decides.
 *
 * A proposal is not a publication. There is no publish, pull request,
 * merge, deploy or schedule control here, and none is implied.
 */

async function readProposal(projectId: string, articleId: string, signal?: AbortSignal): Promise<ProposalLoad> {
  const url = `/api/content-article-proposals?project=${encodeURIComponent(projectId)}&article=${encodeURIComponent(articleId)}`;
  const response = await fetch(url, { cache: "no-store", signal });
  const body: unknown = response.status === 200 ? await response.json() : null;
  return proposalLoadFromResponse(response.status, body);
}

function stamp(iso: string): string {
  return `${formatFullDate(iso)} ${formatTimeUtc(iso)}`;
}

const HEADLINE_TONE: Readonly<Record<ProposalHeadline, BadgeTone>> = {
  eligible: "accent",
  "not-eligible": "neutral",
  active: "positive",
  "active-stale": "warning",
};

export function ArticleProposalSection({ projectId, articleId }: { projectId: string; articleId: string }) {
  const [load, setLoad] = useState<ProposalLoad>({ status: "loading" });
  const [dialog, setDialog] = useState<"record" | "withdraw" | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<ProposalNote | null>(null);

  const reload = useCallback(async () => {
    try {
      setLoad(await readProposal(projectId, articleId));
    } catch {
      setLoad({ status: "failed" });
    }
  }, [projectId, articleId]);

  useEffect(() => {
    const controller = new AbortController();
    readProposal(projectId, articleId, controller.signal)
      .then(setLoad)
      .catch(() => {
        if (!controller.signal.aborted) setLoad({ status: "failed" });
      });
    return () => controller.abort();
  }, [projectId, articleId]);

  const state = load.status === "ready" ? load.state : null;

  async function record() {
    if (busy || state === null || !canRecord(load) || state.destination === null) return;
    setBusy(true);
    setNote(null);
    try {
      const result = await recordArticleProposal(projectId, state.articleId, state.currentVersion, state.destination.key, RECORD_PROPOSAL_CONFIRMATION);
      setNote(recordNote(result));
      // Created, exists, stale and ineligible carry the server's state; a refusal or failure re-reads it.
      if ("state" in result) setLoad({ status: "ready", state: result.state });
      else await reload();
    } catch {
      setNote(recordNote({ ok: false, reason: "failed" }));
      await reload();
    } finally {
      setBusy(false);
      setDialog(null);
    }
  }

  async function withdraw() {
    if (busy || state === null || state.activeProposal === null || !canWithdraw(load)) return;
    setBusy(true);
    setNote(null);
    try {
      const result = await withdrawArticleProposal(projectId, state.articleId, state.activeProposal.id, WITHDRAW_PROPOSAL_CONFIRMATION);
      setNote(withdrawNote(result));
      if (result.ok) setLoad({ status: "ready", state: result.state });
      else await reload();
    } catch {
      setNote(withdrawNote({ ok: false, reason: "failed" }));
      await reload();
    } finally {
      setBusy(false);
      setDialog(null);
    }
  }

  const headline = state === null ? null : proposalHeadline(state);

  return (
    <section className="min-w-0 space-y-2 rounded border border-border p-3" aria-label={PROPOSAL_SECTION_TITLE}>
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
          {PROPOSAL_SECTION_TITLE}
          {state !== null ? ` · version ${state.currentVersion}` : ""}
        </h4>
        {headline !== null && (
          <Badge tone={HEADLINE_TONE[headline]} dot>
            {HEADLINE_LABEL[headline]}
          </Badge>
        )}
      </div>
      <p className="rounded border border-border bg-surface-raised px-3 py-2 text-xs text-fg-muted" role="note">
        <span className="font-semibold text-fg">{PROPOSAL_ONLY_BANNER}</span> {PROPOSAL_EXPLANATION}
      </p>

      {load.status !== "ready" && (
        <div className={load.status === "loading" ? "text-xs text-fg-subtle" : "flex flex-wrap items-center gap-2 text-xs text-critical"} role="status">
          <span>{LOAD_MESSAGE[load.status]}</span>
          {load.status === "failed" && (
            <Button variant="ghost" onClick={() => void reload()}>
              Retry
            </Button>
          )}
        </div>
      )}
      {note !== null && (
        <p className={note.tone === "positive" ? "text-xs text-positive" : "text-xs text-critical"} role="status">
          {note.text}
        </p>
      )}

      {state !== null && (
        <>
          <Summary state={state} />

          {state.eligibility.status === "blocked" && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-fg">Not eligible for a proposal:</p>
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-fg-muted">
                {state.eligibility.blocks.map((block) => (
                  <li key={block}>{articleProposalBlockMessage(block)}</li>
                ))}
              </ul>
            </div>
          )}
          {state.eligibility.warnings.map((warning) => (
            <p key={warning} className="rounded border border-warning/40 px-3 py-2 text-xs text-warning" role="note">
              {articleProposalWarningMessage(warning)}
            </p>
          ))}

          {state.activeProposal !== null && <ActiveProposal proposal={state.activeProposal} current={state.activeProposalCurrent === true} />}

          <div className="flex flex-wrap gap-2">
            {canRecord(load) && (
              <Button onClick={() => setDialog("record")} disabled={busy} aria-haspopup="dialog">
                Record proposal for version {state.currentVersion}…
              </Button>
            )}
            {canWithdraw(load) && (
              <Button variant="secondary" onClick={() => setDialog("withdraw")} disabled={busy} aria-haspopup="dialog">
                Withdraw proposal…
              </Button>
            )}
          </div>

          {state.eligibility.status === "eligible" && <Completeness report={state.eligibility.completeness} />}
          {state.preview !== null && (
            <details className="min-w-0 text-xs">
              <summary className="cursor-pointer text-fg-muted">
                Read-only preview · {state.preview.format} · SHA-256 {shortHash(state.preview.previewSha256)}
              </summary>
              <p className="mt-1 break-all font-mono text-[11px] text-fg-subtle">Preview SHA-256 {state.preview.previewSha256}</p>
              <pre className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-surface-raised p-2 font-mono text-[11px] text-fg">
                {state.preview.document}
              </pre>
            </details>
          )}

          <History state={state} />

          {dialog === "record" && state.eligibility.status === "eligible" && state.preview !== null && state.destination !== null && (
            <Modal
              title={`Record proposal for version ${state.currentVersion}?`}
              description={RECORD_PROPOSAL_CONFIRMATION_TEXT}
              onClose={() => !busy && setDialog(null)}
              footer={
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="ghost" onClick={() => setDialog(null)} disabled={busy}>
                    Cancel
                  </Button>
                  <Button onClick={() => void record()} disabled={busy}>
                    {busy ? "Recording…" : "Record proposal only"}
                  </Button>
                </div>
              }
            >
              <dl className="space-y-1 text-xs">
                <Row label="Article version" value={`${state.currentVersion}`} />
                <Row label="Destination" value={`${state.destination.label} (${state.destination.key})`} />
                <Row label="Proposed route (not written)" value={state.eligibility.route ?? "Unresolved"} />
                <Row label="Slug" value={state.eligibility.binding.slug} />
                <Row label="Canonical content SHA-256" value={state.eligibility.binding.contentSha256} mono />
                <Row label="Preview SHA-256" value={state.preview.previewSha256} mono />
                <Row label="Approved" value={`${stamp(state.eligibility.binding.approvedAt)} by ${state.eligibility.binding.approvedBy}`} />
              </dl>
              {state.eligibility.warnings.map((warning) => (
                <p key={warning} className="mt-2 text-xs text-warning">
                  {articleProposalWarningMessage(warning)}
                </p>
              ))}
            </Modal>
          )}

          {dialog === "withdraw" && state.activeProposal !== null && (
            <Modal
              title="Withdraw this proposal?"
              description={WITHDRAW_PROPOSAL_CONFIRMATION_TEXT}
              onClose={() => !busy && setDialog(null)}
              footer={
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="ghost" onClick={() => setDialog(null)} disabled={busy}>
                    Cancel
                  </Button>
                  <Button variant="danger" onClick={() => void withdraw()} disabled={busy}>
                    {busy ? "Withdrawing…" : "Withdraw proposal"}
                  </Button>
                </div>
              }
            >
              <dl className="space-y-1 text-xs">
                <Row label="Proposal" value={state.activeProposal.id} mono />
                <Row label="Article version" value={`${state.activeProposal.articleVersion} (row ${state.activeProposal.articleVersionId})`} />
                <Row label="Destination and slug" value={`${state.activeProposal.destination} · ${state.activeProposal.slug}`} />
                <Row label="Recorded" value={`${stamp(state.activeProposal.createdAt)} by ${state.activeProposal.requestedBy}`} />
              </dl>
            </Modal>
          )}
        </>
      )}
    </section>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-[12rem_1fr]">
      <dt className="text-fg-subtle">{label}</dt>
      <dd className={mono ? "break-all font-mono text-[11px] text-fg" : "break-words text-fg"}>{value}</dd>
    </div>
  );
}

function Summary({ state }: { state: ArticleProposalStateView }) {
  const binding = state.eligibility.status === "eligible" ? state.eligibility.binding : null;
  return (
    <dl className="space-y-1 text-xs">
      <Row label="Current version" value={`${state.currentVersion} · article status ${state.articleStatus}`} />
      <Row label="Destination" value={state.destination === null ? "None registered for this project" : `${state.destination.label} (${state.destination.key}, ${state.destination.host})`} />
      {state.eligibility.status === "eligible" && <Row label="Proposed route (not written)" value={state.eligibility.route ?? "Unresolved"} />}
      {binding !== null && (
        <>
          <Row label="Slug" value={binding.slug} />
          <Row label="Canonical content SHA-256" value={binding.contentSha256} mono />
          <Row label="C5 approval" value={`${binding.approvalId} · ${stamp(binding.approvedAt)} by ${binding.approvedBy}`} mono />
        </>
      )}
    </dl>
  );
}

function ActiveProposal({ proposal, current }: { proposal: ArticlePublicationProposal; current: boolean }) {
  return (
    <div className={current ? "space-y-1 rounded border border-border p-2" : "space-y-1 rounded border border-warning/40 p-2"} aria-label="Active proposal">
      <p className="text-xs font-medium text-fg">
        {current ? "Active proposal — recorded, not published." : "Active proposal is stale — it no longer names the current approved version. Not published."}
      </p>
      <dl className="space-y-1 text-xs">
        <Row label="Proposal" value={proposal.id} mono />
        <Row label="Bound version" value={`${proposal.articleVersion} (row ${proposal.articleVersionId})`} />
        <Row label="Destination and slug" value={`${proposal.destination} · ${proposal.slug}`} />
        <Row label="Content SHA-256" value={proposal.contentSha256} mono />
        <Row label="Preview SHA-256" value={proposal.previewSha256} mono />
        <Row label="Recorded" value={`${stamp(proposal.createdAt)} by ${proposal.requestedBy}`} />
      </dl>
    </div>
  );
}

function Completeness({ report }: { report: WebsiteCompletenessReport }) {
  const keys = (fields: readonly { readonly key: string }[]) => (fields.length === 0 ? "none" : fields.map((f) => f.key).join(", "));
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-fg-muted">Website completeness ({report.templateId}) — informational, not a blocker</summary>
      <dl className="mt-1 space-y-1">
        <Row label="Supplied by the content" value={keys(report.presentRequired)} />
        <Row label="Derived by a fixed rule" value={keys(report.derived)} />
        <Row label="Set only at publication" value={keys(report.publicationTime)} />
        <Row label="Not in the content model" value={keys(report.missingRequired)} />
        <Row label="Optional" value={report.optional.map((f) => `${f.key} ${f.state}`).join(", ")} />
      </dl>
    </details>
  );
}

function History({ state }: { state: ArticleProposalStateView }) {
  return (
    <div>
      <p className="text-xs font-medium text-fg">Proposal history ({state.history.length})</p>
      {state.history.length === 0 ? (
        <p className="text-xs text-fg-subtle">No proposal of this article has been recorded.</p>
      ) : (
        <ul className="mt-1 space-y-1 text-xs text-fg-muted">
          {state.history.map((proposal) => (
            <li key={proposal.id} className="break-words">
              Version {proposal.articleVersion} · {proposal.destination} · {proposal.slug} · {proposalStanding(proposal, state)} · recorded {stamp(proposal.createdAt)}
              {proposal.withdrawnAt !== null && ` · withdrawn ${stamp(proposal.withdrawnAt)} by ${proposal.withdrawnBy}`} · preview {shortHash(proposal.previewSha256)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
