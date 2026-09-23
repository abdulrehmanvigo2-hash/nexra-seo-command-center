"use client";

import { useCallback, useEffect, useState } from "react";
import { approveArticleVersion, type ApproveArticleVersionActionResult } from "@/app/(app)/projects/article-approval-actions";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { approvalBlockMessage } from "@/lib/content/articles/approvals/eligibility";
import { formatFullDate, formatTimeUtc } from "@/lib/format";
import type { ArticleApproval, ArticleApprovalState } from "@/types/content-article-approval";
import type { ArticleCheckState } from "@/types/content-article-check";
import type { ArticleTopicDecision } from "@/types/content-article";

/**
 * Article approval for the current, exact article version (Stage 5,
 * milestone C5).
 *
 * Shows the current version, its check state and unit counts, whether it
 * may be approved under the rule in `lib/content/articles/approvals/
 * eligibility` — with every reason it may not — and the article's immutable
 * approval history. The Approve control appears only when the server says
 * the version is eligible, and asks for an explicit confirmation before
 * anything is sent. The server re-reads everything before approving, and
 * the database checks it all again.
 *
 * Approval only. There is no publish, proposal, pull request, merge, deploy
 * or delete control here.
 */

export const ARTICLE_APPROVAL_NOTICE = "Approval only — nothing is published.";

type Load =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly state: ArticleApprovalState }
  | { readonly status: "unavailable" }
  | { readonly status: "failed" };

const CHECK_LABEL: Readonly<Record<ArticleCheckState, string>> = {
  unchecked: "Unchecked",
  checking: "Checking",
  "needs-review": "Needs review",
  passed: "All units passed",
};

const TOPIC_LABEL: Readonly<Record<ArticleTopicDecision, string>> = {
  "update-existing": "Update existing",
  "different-angle": "Different angle",
  "do-not-create": "Do not create",
  unset: "Unset",
};

const APPROVE_FAILURE: Readonly<Record<Exclude<ApproveArticleVersionActionResult, { ok: true }>["reason"], string>> = {
  unauthorized: "Your session has ended. Reload the page to sign in again.",
  "rate-limited": "Too many requests. Wait a moment and try again.",
  invalid: "This approval cannot be sent: its identifiers are not what the server expects.",
  unavailable: "Article approvals are not persisted on this deployment, so nothing can be approved.",
  "not-found": "The article could not be found in this project.",
  "version-not-found": "The article's current version could not be read.",
  stale: "The article has a newer version than the one shown. Nothing was approved; review the current version.",
  ineligible: "The server found this version is not eligible. Nothing was approved.",
  refused: "The database refused the approval on one of its own checks. Nothing was written.",
  failed: "The approval could not be completed. Nothing is known to have been written.",
};

async function readApproval(projectId: string, articleId: string, signal?: AbortSignal): Promise<Load> {
  const url = `/api/content-article-approvals?project=${encodeURIComponent(projectId)}&article=${encodeURIComponent(articleId)}`;
  const response = await fetch(url, { cache: "no-store", signal });
  if (response.status === 503) return { status: "unavailable" };
  if (!response.ok) return { status: "failed" };
  const body = (await response.json()) as { approval?: ArticleApprovalState };
  return body.approval ? { status: "ready", state: body.approval } : { status: "failed" };
}

function stamp(iso: string): string {
  return `${formatFullDate(iso)} ${formatTimeUtc(iso)}`;
}

export function ArticleApprovalSection({
  projectId,
  articleId,
  onArticleChanged,
}: {
  projectId: string;
  articleId: string;
  /** Called when an approval moved the article's own status, so the panel re-reads it. */
  onArticleChanged: () => void;
}) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [confirming, setConfirming] = useState(false);
  const [approving, setApproving] = useState(false);
  const [note, setNote] = useState<{ readonly tone: "positive" | "critical"; readonly text: string } | null>(null);

  const reload = useCallback(async () => {
    try {
      setLoad(await readApproval(projectId, articleId));
    } catch {
      setLoad({ status: "failed" });
    }
  }, [projectId, articleId]);

  useEffect(() => {
    const controller = new AbortController();
    readApproval(projectId, articleId, controller.signal)
      .then(setLoad)
      .catch(() => {
        if (!controller.signal.aborted) setLoad({ status: "failed" });
      });
    return () => controller.abort();
  }, [projectId, articleId]);

  const state = load.status === "ready" ? load.state : null;
  const eligible = state !== null && state.eligibility.status === "eligible";

  async function approve() {
    if (approving || state === null || !eligible) return;
    setApproving(true);
    setNote(null);
    try {
      const result = await approveArticleVersion(projectId, state.articleId, state.currentVersion);
      if (result.ok) {
        setLoad({ status: "ready", state: result.state });
        setNote({
          tone: "positive",
          text: result.approved
            ? `Version ${result.approval.articleVersion} is approved. Nothing was published.`
            : `Version ${result.approval.articleVersion} was already approved; nothing was written.`,
        });
        onArticleChanged();
      } else {
        if ("state" in result) setLoad({ status: "ready", state: result.state });
        setNote({ tone: "critical", text: APPROVE_FAILURE[result.reason] });
      }
    } catch {
      setNote({ tone: "critical", text: APPROVE_FAILURE.failed });
    } finally {
      setApproving(false);
      setConfirming(false);
    }
  }

  return (
    <section className="space-y-2 rounded border border-border p-3" aria-label="Article approval">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
          Article approval{state !== null ? ` · version ${state.currentVersion}` : ""}
        </h4>
        {state !== null && <EligibilityBadge state={state} />}
      </div>
      <p className="rounded border border-border bg-surface-raised px-3 py-2 text-xs text-fg-muted" role="note">
        {ARTICLE_APPROVAL_NOTICE}
      </p>
      <p className="text-xs text-fg-subtle">
        Only the current version can be approved, and only when every check unit of that exact version passed. An approval names one version and never
        carries to a later one.
      </p>

      {load.status === "loading" && <p className="text-xs text-fg-subtle">Reading approval state…</p>}
      {load.status === "unavailable" && <p className="text-xs text-warning">Article approvals are not persisted on this deployment.</p>}
      {load.status === "failed" && (
        <div className="flex items-center gap-2 text-xs text-critical" role="status">
          <span>The approval state could not be read.</span>
          <Button variant="ghost" onClick={() => void reload()}>
            Retry
          </Button>
        </div>
      )}
      {note !== null && (
        <p className={note.tone === "positive" ? "text-xs text-positive" : "text-xs text-critical"} role="status">
          {note.text}
        </p>
      )}

      {state !== null && (
        <>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
            <div className="flex gap-2">
              <dt className="text-fg-subtle">Current version</dt>
              <dd className="text-fg">
                {state.currentVersion} · hash {state.contentSha256.slice(0, 12)}…
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-fg-subtle">Article check</dt>
              <dd className="text-fg">
                {state.checkState === null ? "Not available" : CHECK_LABEL[state.checkState]} · {state.unitCounts.passed} of {state.unitCounts.total} units passed
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-fg-subtle">Topic decision</dt>
              <dd className="text-fg">{state.topicDecision === null ? "Not readable" : TOPIC_LABEL[state.topicDecision]}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-fg-subtle">Approved version</dt>
              <dd className="text-fg">
                {state.approvedVersion === null
                  ? "None"
                  : state.approvedVersion === state.currentVersion && state.articleStatus === "approved"
                    ? `Version ${state.approvedVersion} (current)`
                    : `Version ${state.approvedVersion} — history only, not the current version`}
              </dd>
            </div>
          </dl>

          {state.eligibility.status === "blocked" && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-fg">Not eligible for approval:</p>
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-fg-muted">
                {state.eligibility.blocks.map((block) => (
                  <li key={block}>
                    {approvalBlockMessage(block)}
                    {block === "units-unchecked" && ` (${state.unitCounts.unchecked} unchecked)`}
                    {block === "units-needs-review" && ` (${state.unitCounts.needsReview} need review)`}
                    {block === "units-failed" && ` (${state.unitCounts.failed} failed)`}
                    {block === "units-checking" && ` (${state.unitCounts.pending} checking)`}
                    {block === "units-mismatch" && ` (${state.unitCounts.mismatched} mismatched)`}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {state.eligibility.status === "approved" && (
            <p className="text-xs text-positive">
              Version {state.eligibility.approval.articleVersion} is approved by {state.eligibility.approval.approvedBy} on {stamp(state.eligibility.approval.approvedAt)}.
              Nothing was published.
            </p>
          )}

          {eligible && (
            <div className="space-y-2 border-l-2 border-border pl-3">
              {!confirming ? (
                <Button onClick={() => setConfirming(true)} disabled={approving}>
                  Approve version {state.currentVersion}…
                </Button>
              ) : (
                <div className="space-y-2" role="group" aria-label="Confirm approval">
                  <p className="text-xs text-fg">
                    Approve version {state.currentVersion} (hash {state.contentSha256.slice(0, 12)}…, {state.unitCounts.total} check units passed)? {ARTICLE_APPROVAL_NOTICE}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => void approve()} disabled={approving}>
                      {approving ? "Approving…" : `Confirm approval of version ${state.currentVersion}`}
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirming(false)} disabled={approving}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          <ApprovalHistory history={state.history} currentVersion={state.currentVersion} />
        </>
      )}
    </section>
  );
}

function EligibilityBadge({ state }: { state: ArticleApprovalState }) {
  const meta: { readonly label: string; readonly tone: BadgeTone } =
    state.eligibility.status === "approved"
      ? { label: "Approved", tone: "positive" }
      : state.eligibility.status === "eligible"
        ? { label: "Eligible for approval", tone: "accent" }
        : { label: "Not eligible", tone: "neutral" };
  return (
    <Badge tone={meta.tone} dot>
      {meta.label}
    </Badge>
  );
}

function ApprovalHistory({ history, currentVersion }: { history: readonly ArticleApproval[]; currentVersion: number }) {
  return (
    <div>
      <p className="text-xs font-medium text-fg">Approval history ({history.length})</p>
      {history.length === 0 ? (
        <p className="text-xs text-fg-subtle">No version of this article has been approved.</p>
      ) : (
        <ul className="mt-1 space-y-1 text-xs text-fg-muted">
          {history.map((entry) => (
            <li key={entry.id}>
              Version {entry.articleVersion}
              {entry.articleVersion === currentVersion ? " (current)" : ""} · approved {stamp(entry.approvedAt)} by {entry.approvedBy} · content hash{" "}
              {entry.contentSha256.slice(0, 12)}… · {entry.unitCount} units · unit set {entry.unitsSha256.slice(0, 12)}…
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
