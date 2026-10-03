"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { formatFullDate, formatTimeUtc } from "@/lib/format";
import { PUBLICATION_STATUS_LABEL, liveUrl } from "@/lib/publishing/contract";
import {
  MODE_EXPLANATION,
  MODE_LABEL,
  NOT_SET_UP_MESSAGE,
  STEPS,
  canAbandon,
  errorText,
  pageAction,
  publishOutcome,
  refusalText,
  shortId,
  viewFromResponse,
  type ViewLoad,
} from "@/lib/publishing/presenter";

/**
 * The publish page's body (P-L2, PR 7): the request as bound, its steps, the exact files (rendered at the website's
 * current `main` while the request waits) and one button — *Publish…* (confirmed; it consumes the approval) or *Check
 * status* (continues from the last recorded step). Reading the page writes nothing.
 */

function stamp(iso: string): string {
  return `${formatFullDate(iso)} ${formatTimeUtc(iso)}`;
}

export function PublishView({ approvalId, role }: { approvalId: string; role: "operator" | "reviewer" }) {
  const [load, setLoad] = useState<ViewLoad>({ status: "loading" });
  const [version, setVersion] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [abandoning, setAbandoning] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [note, setNote] = useState<ReturnType<typeof publishOutcome> | null>(null);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/publications?approval=${encodeURIComponent(approvalId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => setLoad(viewFromResponse(response.status, await response.json().catch(() => null), Date.now())))
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setLoad({ status: "failed", message: "This publication could not be read just now." });
      });
    return () => controller.abort();
  }, [approvalId, version]);

  const press = async (publicationId: string, action: "publish" | "abandon" = "publish") => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const response = await fetch(`/api/publications/${publicationId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }), cache: "no-store" });
      setNote(publishOutcome(response.status, await response.json().catch(() => null)));
    } catch {
      setNote(publishOutcome(0, null));
    }
    inFlight.current = false;
    setBusy(false);
    setConfirming(false);
    setAbandoning(false);
    reload();
  };

  if (load.status === "loading") return <p className="text-[13px] text-fg-muted">Reading the publication…</p>;
  if (load.status === "not-set-up") return <p className="text-[13px] text-fg-subtle">{NOT_SET_UP_MESSAGE}</p>;
  if (load.status === "not-found") return <p className="text-[13px] text-fg-subtle">No publication request has this link.</p>;
  if (load.status === "failed") return <p role="status" className="text-[13px] text-critical">{load.message}</p>;

  const { publication, approval } = load.entry;
  const action = pageAction(load);
  const current = publication.status === "abandoned" ? -1 : STEPS.indexOf(publication.status);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-[11.5px] font-medium tracking-wide text-fg-subtle uppercase">Publish an article</p>
          <h1 className="text-[20px] font-semibold break-words text-fg">/blog/{publication.slug}</h1>
          <p className="text-[12.5px] text-fg-muted">{MODE_EXPLANATION[load.mode]}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={load.mode === "off" ? "neutral" : "accent"}>{MODE_LABEL[load.mode]}</Badge>
          {role === "operator" && (
            <Link href={`/?project=${encodeURIComponent(publication.projectId)}`} className="text-[12px] font-medium text-accent hover:underline">
              Command Center
            </Link>
          )}
        </div>
      </div>

      <Panel>
        <PanelHeader title="The request" description="Bound when it was requested; the approval checks every field again before anything is written." />
        <PanelBody>
          <dl className="grid gap-x-6 gap-y-1.5 text-[12.5px] sm:grid-cols-2">
            {[
              ["Article", `${shortId(publication.articleId)} · version ${publication.articleVersion}`],
              ["Content SHA-256", shortId(publication.contentSha256)],
              ["Published date", publication.publishedOn],
              ["Cross-link", publication.crossLinkAnchor ?? "none"],
              ["Requested", stamp(publication.requestedAt)],
              ["Approval", approval === null ? shortId(publication.approvalId) : approval.usedAt !== null ? `used ${stamp(approval.usedAt)}` : `expires ${stamp(approval.expiresAt)}`],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3">
                <dt className="text-fg-muted">{label}</dt>
                <dd className="min-w-0 text-right font-medium break-words text-fg">{value}</dd>
              </div>
            ))}
          </dl>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title="Steps" description="Each step is recorded before the next one starts." />
        <PanelBody className="space-y-3">
          <ol className="flex flex-wrap gap-2">
            {STEPS.map((step, index) => (
              <li key={step}>
                <Badge tone={index < current ? "positive" : index === current ? "accent" : "neutral"}>{PUBLICATION_STATUS_LABEL[step]}</Badge>
              </li>
            ))}
            {publication.status === "abandoned" && (
              <li>
                <Badge tone="warning">Abandoned</Badge>
              </li>
            )}
          </ol>
          {publication.pullRequestUrl !== null && (
            <p className="text-[12.5px] text-fg-muted">
              Pull request{" "}
              <a href={publication.pullRequestUrl} className="font-medium text-accent hover:underline" rel="noreferrer" target="_blank">
                #{publication.pullRequestNumber}
              </a>{" "}
              on branch <code className="break-all">{publication.branch}</code>, head {shortId(publication.headCommit ?? "")}
            </p>
          )}
          {publication.mergeCommit !== null && <p className="text-[12.5px] text-fg-muted">Merged as {shortId(publication.mergeCommit)}.</p>}
          {publication.status === "live" && (
            <p className="text-[12.5px] text-fg-muted">
              Live at{" "}
              <a href={liveUrl(publication.slug)} className="font-medium text-accent hover:underline break-all" rel="noreferrer" target="_blank">
                {liveUrl(publication.slug)}
              </a>
            </p>
          )}
          {publication.lastError !== null && (
            <p role="status" className="text-[12.5px] text-warning">
              {errorText(publication.lastError.code)} ({publication.lastError.step}, {stamp(publication.lastError.at)})
            </p>
          )}
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader
          title="Files"
          description={
            publication.status === "requested"
              ? "Rendered now from the stored, approved version against the website's current main. Publish writes exactly these, if main has not moved."
              : "Recorded when the approval was consumed."
          }
        />
        <PanelBody className="space-y-3">
          {publication.status !== "requested" && publication.files !== null && (
            <>
              <p className="text-[12px] text-fg-subtle">Base commit {shortId(publication.baseCommit ?? "")}</p>
              <ul className="space-y-1.5 text-[12.5px]">
                {publication.files.map((file) => (
                  <li key={file.path} className="flex flex-wrap justify-between gap-2">
                    <code className="break-all text-fg">{file.path}</code>
                    <span className="text-fg-muted">
                      {file.kind === "new-file" ? "new" : "modified"} · {shortId(file.sha256)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {publication.status === "requested" && load.preview !== null && (
            <>
              {load.preview.status === "ready" && (
                <>
                  <p className="text-[12px] text-fg-subtle">main is at {shortId(load.preview.commit)}</p>
                  {load.preview.files.map((file) => (
                    <details key={file.path} className="rounded-control border border-border">
                      <summary className="flex cursor-pointer flex-wrap justify-between gap-2 px-3 py-2 text-[12.5px]">
                        <code className="break-all text-fg">{file.path}</code>
                        <span className="text-fg-muted">
                          {file.kind === "new-file" ? "new" : "modified"} · {shortId(file.sha256)}
                        </span>
                      </summary>
                      <pre className="max-h-96 overflow-auto border-t border-border p-3 text-[11.5px] leading-relaxed whitespace-pre text-fg-muted">{file.content}</pre>
                    </details>
                  ))}
                </>
              )}
              {load.preview.status === "refused" && (
                <p role="status" className="text-[12.5px] text-warning">
                  {refusalText(load.preview.refusal)}
                </p>
              )}
              {load.preview.status === "not-configured" && <p className="text-[12.5px] text-fg-subtle">The GitHub token is not configured on this deployment, so the website cannot be read.</p>}
              {load.preview.status === "github-failed" && <p className="text-[12.5px] text-warning">GitHub could not be read just now ({load.preview.code}). Reload in a moment.</p>}
              {load.preview.status === "records-unread" && <p className="text-[12.5px] text-warning">The stored version could not be read.</p>}
            </>
          )}
        </PanelBody>
      </Panel>

      <div className="space-y-2">
        {action.kind === "publish" && (
          <Button disabled={busy} onClick={() => setConfirming(true)}>
            Publish…
          </Button>
        )}
        {action.kind === "check" && (
          <Button variant="secondary" disabled={busy} onClick={() => void press(publication.id)}>
            {busy ? "Checking…" : "Check status"}
          </Button>
        )}
        {canAbandon(load) && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setAbandoning(true)}>
            Abandon…
          </Button>
        )}
        {action.reason !== null && <p className="text-[12.5px] text-fg-subtle">{action.reason}</p>}
        {note && (
          <p role="status" className={note.tone === "warning" ? "text-[12.5px] text-warning" : note.tone === "positive" ? "text-[12.5px] text-positive" : "text-[12.5px] text-fg-muted"}>
            {note.text}
          </p>
        )}
      </div>

      {abandoning && (
        <Modal
          title="Abandon this publication?"
          description="Records that this publication will not continue; nothing is sent to GitHub. Close its pull request there if it is still open. The article can then be requested again."
          onClose={() => setAbandoning(false)}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setAbandoning(false)}>
                Keep it
              </Button>
              <Button variant="danger" size="sm" disabled={busy} onClick={() => void press(publication.id, "abandon")}>
                Abandon
              </Button>
            </div>
          }
        >
          <p className="text-[12.5px] text-fg-muted">/blog/{publication.slug} · {PUBLICATION_STATUS_LABEL[publication.status]}</p>
        </Modal>
      )}

      {confirming && (
        <Modal
          title="Publish this article?"
          description={
            load.mode === "merge"
              ? "This uses the approval (once), commits the files on a new branch of nexra-ai, opens the pull request and, when its checks are green, merges it — the article goes live."
              : "This uses the approval (once), commits the files on a new branch of nexra-ai and opens the pull request. Nothing is merged: you merge it on GitHub."
          }
          onClose={() => setConfirming(false)}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button size="sm" disabled={busy} onClick={() => void press(publication.id)}>
                {busy ? "Publishing…" : "Publish"}
              </Button>
            </div>
          }
        >
          <p className="text-[12.5px] text-fg-muted">
            /blog/{publication.slug} · version {publication.articleVersion} · {load.preview?.status === "ready" ? `${load.preview.files.length} files on main ${shortId(load.preview.commit)}` : ""}
          </p>
        </Modal>
      )}
    </div>
  );
}
