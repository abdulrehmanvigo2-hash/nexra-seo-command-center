"use client";

import { useEffect, useId, useState } from "react";
import {
  approveDraftVersion,
  recordDraftFactCheck,
  saveDraftVersion,
  saveWriterRunAsDraft,
  type ApproveDraftVersionActionResult,
  type RecordDraftFactCheckActionResult,
  type SaveDraftVersionActionResult,
  type SaveWriterRunAsDraftResult,
} from "@/app/(app)/projects/draft-actions";
import { QueuedReview, useQueuedReview } from "@/components/agent-runs/queued-review";
import { PublicationProposalSection } from "@/components/content/publication-proposal-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Select, TextArea, TextInput } from "@/components/ui/field";
import { approvalEligibility, approvalRefusalMessage, isApprovedVersion } from "@/lib/content/drafts/approval-rules";
import { isUnchanged, normaliseVersionText, refusalMessage } from "@/lib/content/drafts/edit-rules";
import { offersRecordFactCheck } from "@/lib/content/drafts/fact-check-eligibility";
import { readFactCheck } from "@/lib/content/drafts/parse-fact-check-output";
import { DRAFT_FACT_CHECK, factCheckRequest } from "@/lib/crawl/review-request";
import { formatFullDate, formatTimeUtc } from "@/lib/format";
import type { AgentRun } from "@/types/agent-run";
import type { ContentDraft, ContentDraftVersion, DraftFactCheck, DraftHistory, FactCheckItem } from "@/types/content-draft";

/**
 * The operator control that turns one completed Writer run into a saved
 * draft, and the panel that shows the draft, its version history, and the
 * editing surface.
 *
 * Nothing saves on its own. The control reads whether a draft already exists
 * for the run on screen (a GET, never a write) and shows either the "Save as
 * draft" button or the draft. Saving the Writer's output is one explicit
 * click; saving an edit is another, and creates a new immutable version
 * rather than changing any earlier one — version 1 is always the Writer's
 * text, selectable from the history and read-only there. The server decides
 * every save from its own records: the text bounds, the draft's ownership,
 * and whether the version the person started from is still current. A
 * fact-check is one more explicit pair of clicks: the Research & Evidence
 * run is queued and started through the shared review control, and its
 * result is recorded on the exact version it checked by a click of its own,
 * which the server validates against the run's own metadata. Approval is
 * one more explicit action with a confirmation step, offered only for the
 * current version whose recorded check passed, and bound to that exact
 * version; the server applies the same policy again and writes in one
 * conditional statement. A publication proposal for the approved current
 * version is its own section (`./publication-proposal-section`): it
 * publishes nothing and creates no pull request. There is no publish or
 * delete control, and an edited version says plainly that its claims are
 * not verified until a check is recorded for it.
 */

type State =
  | { readonly status: "loading" }
  | { readonly status: "none" }
  | { readonly status: "saved"; readonly history: DraftHistory; readonly note: string }
  | { readonly status: "unavailable" }
  | { readonly status: "failed"; readonly message: string };

const READ_FAILED = "The saved draft could not be read. Reload to try again.";

const SAVE_FAILURE: Readonly<Record<Exclude<SaveWriterRunAsDraftResult, { ok: true }>["reason"], string>> = {
  unauthorized: "Your session has ended. Reload the page to sign in again.",
  "rate-limited": "Too many saves. Wait a moment and try again.",
  invalid: "This run cannot be saved: its identifiers are not what the server expects.",
  unavailable: "Drafts are not persisted on this deployment, so nothing can be saved.",
  "not-found": "This run no longer exists on the server.",
  ineligible: "This run is not a completed, grounded Writer draft, so it cannot be saved.",
  failed: "The draft could not be saved. Nothing is known to have been written.",
};

async function readHistory(projectId: string, key: { writerRun: string } | { draft: string }, signal?: AbortSignal): Promise<State> {
  const params = new URLSearchParams({ project: projectId, ...key });
  const response = await fetch(`/api/content-drafts?${params.toString()}`, { cache: "no-store", signal });
  if (response.status === 503) return { status: "unavailable" };
  if (!response.ok) return { status: "failed", message: READ_FAILED };
  const body = (await response.json()) as { draft?: DraftHistory | null };
  return body.draft ? { status: "saved", history: body.draft, note: "Restored from the saved draft" } : { status: "none" };
}

export function SaveDraftControl({ projectId, run }: { projectId: string; run: AgentRun }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [saving, setSaving] = useState(false);

  // Restore: does a draft for this run already exist? A read, keyed by the
  // project and the run. The parent keys this component by the run's id, so
  // a new run on screen mounts a fresh control that asks again from "loading".
  useEffect(() => {
    const controller = new AbortController();
    readHistory(projectId, { writerRun: run.id }, controller.signal)
      .then(setState)
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setState({ status: "failed", message: READ_FAILED });
      });
    return () => controller.abort();
  }, [projectId, run.id]);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const result = await saveWriterRunAsDraft(projectId, run.id);
      if (result.ok) setState({ status: "saved", history: result.saved, note: result.created ? "Saved just now" : "Already saved" });
      else setState({ status: "failed", message: SAVE_FAILURE[result.reason] });
    } catch {
      setState({ status: "failed", message: SAVE_FAILURE.failed });
    } finally {
      setSaving(false);
    }
  }

  /** Re-reads the draft after another session advanced it. Returns what is now current, or null when the read failed. */
  async function reload(draftId: string): Promise<DraftHistory | null> {
    try {
      const next = await readHistory(projectId, { draft: draftId });
      setState(next);
      return next.status === "saved" ? next.history : null;
    } catch {
      setState({ status: "failed", message: READ_FAILED });
      return null;
    }
  }

  if (state.status === "loading") {
    return <p className="text-xs text-fg-subtle">Checking for a saved draft…</p>;
  }

  if (state.status === "saved") {
    return (
      <DraftPanel
        projectId={projectId}
        history={state.history}
        note={state.note}
        onHistory={(history, note) => setState({ status: "saved", history, note })}
        onReload={reload}
      />
    );
  }

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" icon="check" onClick={save} disabled={saving || state.status === "unavailable"}>
          {saving ? "Saving…" : "Save as draft"}
        </Button>
        <span className="text-xs text-fg-subtle">
          Keeps this section as draft version 1, exactly as the Writer produced it. Publishes nothing.
        </span>
      </div>
      {state.status === "unavailable" && <p className="text-xs text-warning">{SAVE_FAILURE.unavailable}</p>}
      {state.status === "failed" && (
        <p className="text-xs text-critical" role="status">
          {state.message}
        </p>
      )}
    </div>
  );
}

const EDIT_FAILURE: Readonly<Record<Exclude<SaveDraftVersionActionResult, { ok: true } | { reason: "text" } | { reason: "stale" }>["reason"], string>> = {
  unauthorized: "Your session has ended. Reload the page to sign in again.",
  "rate-limited": "Too many saves. Wait a moment and try again.",
  invalid: "This edit cannot be saved: its identifiers are not what the server expects.",
  unavailable: "Drafts are not persisted on this deployment, so nothing can be saved.",
  "not-found": "This draft no longer exists on the server, or belongs to another project.",
  archived: "This draft is archived and cannot be edited.",
  failed: "The edit could not be saved. Nothing is known to have been written.",
};

function originLabel(version: ContentDraftVersion): string {
  return version.origin === "writer" ? "AI-generated original" : "Operator edit";
}

function DraftPanel({
  projectId,
  history,
  note,
  onHistory,
  onReload,
}: {
  projectId: string;
  history: DraftHistory;
  note: string;
  onHistory: (history: DraftHistory, note: string) => void;
  onReload: (draftId: string) => Promise<DraftHistory | null>;
}) {
  const { draft, version: current, versions } = history;
  const id = useId();
  // Which version is on screen. A save or a reload that advances the draft
  // selects the new current version itself, so this never points past the
  // list; a number the list no longer has falls back to the current version.
  const [selectedNumber, setSelectedNumber] = useState<number>(current.version);
  const viewing = versions.find((entry) => entry.version === selectedNumber) ?? current;
  const viewingCurrent = viewing.version === current.version;
  const original = versions.find((entry) => entry.version === 1) ?? null;

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(current.title);
  const [body, setBody] = useState(current.body);
  const [saving, setSaving] = useState(false);
  const [editNote, setEditNote] = useState<{ tone: "critical" | "warning" | "neutral"; text: string } | null>(null);
  const [stale, setStale] = useState<number | null>(null);

  const text = normaliseVersionText(title, body);
  const dirty = editing && !isUnchanged({ title, body }, current);
  const canEdit = viewingCurrent && !editing && draft.status !== "archived";

  function beginEdit() {
    setTitle(current.title);
    setBody(current.body);
    setEditNote(null);
    setStale(null);
    setEditing(true);
  }

  function discard() {
    setTitle(current.title);
    setBody(current.body);
    setEditNote(null);
    setStale(null);
    setEditing(false);
  }

  /** After a stale refusal: read what is current now. The operator's text stays in the form until they discard it. */
  async function reloadAfterStale() {
    const fresh = await onReload(draft.id);
    if (fresh === null) return;
    setSelectedNumber(fresh.version.version);
    setStale(null);
    setEditNote({ tone: "warning", text: `Version ${fresh.version.version} is current now. Your unsaved text is still here; saving it creates version ${fresh.version.version + 1}.` });
  }

  async function saveEdit() {
    if (saving || !text.ok || !dirty) return;
    setSaving(true);
    setEditNote(null);
    try {
      const result = await saveDraftVersion(projectId, draft.id, current.version, title, body);
      if (result.ok) {
        setEditing(false);
        setSelectedNumber(result.saved.version.version);
        onHistory(result.saved, result.created ? `Saved version ${result.saved.version.version} just now` : "No change to save");
      } else if (result.reason === "stale") {
        setStale(result.currentVersion);
      } else if (result.reason === "text") {
        setEditNote({ tone: "critical", text: refusalMessage(result.refusal) });
      } else {
        setEditNote({ tone: "critical", text: EDIT_FAILURE[result.reason] });
      }
    } catch {
      setEditNote({ tone: "critical", text: EDIT_FAILURE.failed });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-3 border-t border-border pt-3" aria-label="Saved draft">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="accent">Draft</Badge>
        <Badge tone="neutral">Version {viewing.version}</Badge>
        <Badge tone="neutral">{originLabel(viewing)}</Badge>
        {!viewingCurrent && <Badge tone="warning">Historical, read-only</Badge>}
        {isApprovedVersion(draft, viewing) && <Badge tone="positive">Approved version</Badge>}
        <span className="text-xs text-fg-subtle">
          {viewingCurrent ? note : `Version ${current.version} is current`} · created {formatFullDate(viewing.createdAt)},{" "}
          {formatTimeUtc(viewing.createdAt)}
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Field label="Version" htmlFor={`${id}-version`} className="min-w-64">
          <Select
            id={`${id}-version`}
            size="sm"
            value={String(viewing.version)}
            disabled={editing}
            onChange={(event) => setSelectedNumber(Number(event.target.value))}
            options={versions.map((entry) => ({
              value: String(entry.version),
              label: `Version ${entry.version} — ${originLabel(entry)}${entry.version === current.version ? " (current)" : ""}`,
            }))}
          />
        </Field>
        {!viewingCurrent && (
          <Button onClick={() => setSelectedNumber(current.version)} icon="arrow-right">
            Back to current
          </Button>
        )}
        {canEdit && (
          <Button onClick={beginEdit} icon="edit">
            Edit
          </Button>
        )}
      </div>

      {editing ? (
        <div className="space-y-3">
          <Field
            label="Section title"
            htmlFor={`${id}-title`}
            required
            error={!text.ok && text.refusal.field === "title" ? refusalMessage(text.refusal) : undefined}
          >
            <TextInput id={`${id}-title`} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={400} />
          </Field>
          <Field
            label="Body"
            htmlFor={`${id}-body`}
            required
            hint="Saved as a new version; earlier versions stay exactly as they were."
            error={!text.ok && text.refusal.field === "body" ? refusalMessage(text.refusal) : undefined}
          >
            <TextArea id={`${id}-body`} rows={8} value={body} onChange={(event) => setBody(event.target.value)} />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" icon="check" onClick={saveEdit} disabled={saving || !dirty || !text.ok || stale !== null}>
              {saving ? "Saving…" : `Save as version ${current.version + 1}`}
            </Button>
            <Button onClick={discard} disabled={saving}>
              Discard
            </Button>
            <span className="text-xs text-fg-subtle">
              {stale !== null
                ? ""
                : dirty
                  ? "Unsaved changes"
                  : "No changes yet — saving the same text creates no version"}
            </span>
          </div>
          {stale !== null && (
            <p className="text-xs text-warning" role="status">
              Version {stale} was saved by another session while you were editing, so this edit was not saved. Reload
              the draft to read it; your text stays here until you discard it.{" "}
              <Button size="sm" onClick={() => void reloadAfterStale()}>
                Reload draft
              </Button>
            </p>
          )}
          {editNote && (
            <p
              className={editNote.tone === "critical" ? "text-xs text-critical" : editNote.tone === "warning" ? "text-xs text-warning" : "text-xs text-fg-subtle"}
              role="status"
            >
              {editNote.text}
            </p>
          )}
        </div>
      ) : (
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Section</dt>
            <dd className="text-fg">{viewing.title}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Body</dt>
            <dd className="whitespace-pre-wrap text-fg-muted">{viewing.body}</dd>
          </div>
          <FactCheckSection
            key={`${draft.id}:${viewing.version}`}
            projectId={projectId}
            draft={draft}
            version={viewing}
            onHistory={onHistory}
          />
          <ApprovalSection
            key={`approval:${draft.id}:${viewing.version}:${draft.status}`}
            projectId={projectId}
            draft={draft}
            version={viewing}
            onHistory={onHistory}
          />
          <PublicationProposalSection
            key={`proposal:${draft.id}:${viewing.version}:${draft.status}:${draft.currentVersion}`}
            projectId={projectId}
            draft={draft}
            version={viewing}
          />
          {viewing.origin === "writer" ? (
            <>
              <ListRow label="Claims used" items={viewing.claims} />
              <ListRow label="Placeholders" items={viewing.placeholders} />
            </>
          ) : (
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Claims used</dt>
              <dd className="space-y-1 text-fg-muted">
                <p className="text-warning">
                  Not verified. This version was edited by a person; the Writer&apos;s recorded claims apply to version 1
                  only, and the factual claims in this text require re-verification before any approval.
                </p>
                {original && original.claims.length > 0 && (
                  <p className="text-xs text-fg-subtle">
                    Recorded for version 1, not for this text: {original.claims.join(" · ")}
                  </p>
                )}
              </dd>
            </div>
          )}
        </dl>
      )}

      <p className="text-xs text-fg-subtle">
        Status: {draft.status}. Every save is a new version; nothing earlier is changed. A fact-check and an approval
        each belong to the exact version they were recorded for. Publishing is not available yet, and this draft is
        not published anywhere.
      </p>
    </section>
  );
}

const APPROVE_FAILURE: Readonly<Record<Exclude<ApproveDraftVersionActionResult, { ok: true } | { reason: "ineligible" } | { reason: "stale" }>["reason"], string>> = {
  unauthorized: "Your session has ended. Reload the page to sign in again.",
  "rate-limited": "Too many requests. Wait a moment and try again.",
  invalid: "This approval cannot be recorded: its identifiers are not what the server expects.",
  unavailable: "Drafts are not persisted on this deployment, so nothing can be approved.",
  "not-found": "This draft no longer exists on the server, or belongs to another project.",
  "version-not-found": "This version no longer exists on the server.",
  failed: "The approval could not be recorded. Nothing is known to have been written.",
};

/**
 * One version's approval state: the recorded approval where this version
 * is the approved one; otherwise, for the current version, whether the
 * explicit policy makes it eligible and, if so, the two-step control that
 * approves it. Nothing here publishes, and nothing approves without the
 * confirmation click; the server applies the policy again and writes in
 * one conditional statement bound to this exact version.
 */
function ApprovalSection({
  projectId,
  draft,
  version,
  onHistory,
}: {
  projectId: string;
  draft: ContentDraft;
  version: ContentDraftVersion;
  onHistory: (history: DraftHistory, note: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [approving, setApproving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const isCurrent = version.version === draft.currentVersion;
  const approvedHere = isApprovedVersion(draft, version);
  const eligibility = approvalEligibility(draft, version);

  async function approve() {
    if (approving || !confirming || !eligibility.ok) return;
    setApproving(true);
    setNote(null);
    try {
      const result = await approveDraftVersion(projectId, draft.id, version.version);
      if (result.ok) {
        setConfirming(false);
        onHistory(result.saved, result.approved ? `Version ${version.version} approved` : `Version ${version.version} was already approved`);
      } else if (result.reason === "stale") {
        setConfirming(false);
        setNote(`Version ${result.currentVersion} was saved while you were looking at version ${version.version}, so nothing was approved. Reload the draft to read the current version.`);
      } else if (result.reason === "ineligible") {
        setConfirming(false);
        setNote(approvalRefusalMessage(result.refusal));
      } else {
        setNote(APPROVE_FAILURE[result.reason]);
      }
    } catch {
      setNote(APPROVE_FAILURE.failed);
    } finally {
      setApproving(false);
    }
  }

  if (approvedHere) {
    return (
      <div>
        <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Approval</dt>
        <dd className="space-y-1 text-fg-muted">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="positive" dot>
              Approved
            </Badge>
            <span className="text-xs text-fg-subtle">
              Approved version {draft.approvedVersion}
              {draft.approvedAt ? ` · ${formatFullDate(draft.approvedAt)}, ${formatTimeUtc(draft.approvedAt)}` : ""}
              {draft.approvedBy ? ` · by operator ${draft.approvedBy}` : ""}
            </span>
          </div>
          <p className="text-xs text-fg-subtle">
            {draft.status === "approved"
              ? "This exact text is approved. It is not published: publishing is not available yet."
              : `This version was approved as it stood; version ${draft.currentVersion} is current now and has not been approved.`}
          </p>
        </dd>
      </div>
    );
  }

  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Approval</dt>
      <dd className="space-y-2 text-fg-muted">
        {eligibility.ok ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="accent">Ready for approval</Badge>
              <span className="text-xs text-fg-subtle">
                The recorded fact-check of this version passed. Approving records this exact text as approved; it
                publishes nothing.
              </span>
            </div>
            {confirming ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="primary" icon="check" onClick={() => void approve()} disabled={approving}>
                  {approving ? "Approving…" : `Confirm: approve version ${version.version}`}
                </Button>
                <Button onClick={() => setConfirming(false)} disabled={approving}>
                  Cancel
                </Button>
                <span className="text-xs text-fg-subtle">
                  Approval is recorded against version {version.version} only. If a newer version is saved first, nothing
                  is approved.
                </span>
              </div>
            ) : (
              <Button onClick={() => setConfirming(true)} icon="check">
                Approve version {version.version}
              </Button>
            )}
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={isCurrent ? "warning" : "neutral"}>{isCurrent ? "Not eligible for approval" : "Not approved"}</Badge>
            <span className="text-xs text-fg-subtle">{approvalRefusalMessage(eligibility.reason)}</span>
          </div>
        )}
        {note && (
          <p className="text-xs text-critical" role="status">
            {note}
          </p>
        )}
      </dd>
    </div>
  );
}

const FACT_CHECK_TONE: Readonly<Record<DraftFactCheck["status"], { readonly tone: "positive" | "warning" | "critical"; readonly label: string }>> = {
  passed: { tone: "positive", label: "Passed" },
  "needs-review": { tone: "warning", label: "Needs review" },
  failed: { tone: "critical", label: "Failed" },
};

const RECORD_FAILURE: Readonly<Record<Exclude<RecordDraftFactCheckActionResult, { ok: true } | { reason: "ineligible" }>["reason"], string>> = {
  unauthorized: "Your session has ended. Reload the page to sign in again.",
  "rate-limited": "Too many requests. Wait a moment and try again.",
  invalid: "This result cannot be recorded: its identifiers are not what the server expects.",
  unavailable: "Drafts are not persisted on this deployment, so nothing can be recorded.",
  "not-found": "This draft no longer exists on the server, or belongs to another project.",
  "version-not-found": "This version no longer exists on the server.",
  "already-checked": "This version already carries a fact-check from another run; a version is checked once.",
  "run-not-found": "This run no longer exists on the server.",
  failed: "The result could not be recorded. Nothing is known to have been written.",
};

/**
 * One version's fact-check: the recorded result where there is one, and
 * otherwise, for the current version of a live draft, the control that
 * queues and starts a check and the click that records its result.
 *
 * Keyed by draft and version by the caller, so the queued-review state and
 * the record note belong to exactly one version. Nothing here runs or
 * records on its own: the run is queued and started by the shared control's
 * own clicks, and recording is the button below, which the server validates
 * against the run's own metadata before writing anything.
 */
function FactCheckSection({
  projectId,
  draft,
  version,
  onHistory,
}: {
  projectId: string;
  draft: ContentDraft;
  version: ContentDraftVersion;
  onHistory: (history: DraftHistory, note: string) => void;
}) {
  const stored = readFactCheck(version.factCheck);
  const request = factCheckRequest(projectId, draft, version);
  const check = useQueuedReview(request, `${draft.id}:${version.version}`, DRAFT_FACT_CHECK, projectId);
  const [recording, setRecording] = useState(false);
  const [recordNote, setRecordNote] = useState<string | null>(null);
  const run = check.state.status === "queued" ? check.state.run : null;
  const recordable = run !== null && offersRecordFactCheck(run, draft.id, version.version);

  async function record() {
    if (recording || run === null || !recordable) return;
    setRecording(true);
    setRecordNote(null);
    try {
      const result = await recordDraftFactCheck(projectId, draft.id, version.version, run.id);
      if (result.ok) {
        onHistory(
          result.saved,
          result.recorded
            ? `Fact-check recorded on version ${version.version}${result.draftStatusAdvanced ? "; the draft is now fact-checked" : ""}`
            : `Version ${version.version} already carried this run's result`,
        );
      } else if (result.reason === "ineligible") {
        setRecordNote(
          result.refusal === "version-mismatch"
            ? "This run checked a different version, so its result cannot be recorded here."
            : result.refusal === "output-malformed"
              ? "This run's answer is not in the fact-check's fixed form, so nothing was recorded."
              : "This run is not a completed, grounded fact-check of this version, so nothing was recorded.",
        );
      } else {
        setRecordNote(RECORD_FAILURE[result.reason]);
      }
    } catch {
      setRecordNote(RECORD_FAILURE.failed);
    } finally {
      setRecording(false);
    }
  }

  if (stored !== null) return <FactCheckResult check={stored} />;

  const isCurrent = version.version === draft.currentVersion;
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Fact-check</dt>
      <dd className="space-y-2 text-fg-muted">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">Not fact-checked</Badge>
          <span className="text-xs text-fg-subtle">
            {isCurrent
              ? "No check has been recorded for this version. A check reads this exact text against the records this product holds."
              : `No check was recorded for this version. Only the current version (${draft.currentVersion}) can be checked.`}
          </span>
        </div>
        {isCurrent && draft.status !== "archived" && (
          <>
            <QueuedReview review={DRAFT_FACT_CHECK} nested {...check} />
            {run !== null && run.status === "completed" && (
              <div className="space-y-1 border-l-2 border-border pl-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="primary" icon="check" onClick={() => void record()} disabled={!recordable || recording}>
                    {recording ? "Recording…" : `Record result on version ${version.version}`}
                  </Button>
                  <span className="text-xs text-fg-subtle">
                    {recordable
                      ? "Writes this run's result onto this version, once. The text is not changed, and nothing is approved or published."
                      : "This run's result cannot be recorded here: it is simulated, ungrounded, or checked another version."}
                  </span>
                </div>
                {recordNote && (
                  <p className="text-xs text-critical" role="status">
                    {recordNote}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </dd>
    </div>
  );
}

function FactCheckResult({ check }: { check: DraftFactCheck }) {
  const status = FACT_CHECK_TONE[check.status];
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Fact-check</dt>
      <dd className="space-y-2 text-fg-muted">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={status.tone} dot>
            {status.label}
          </Badge>
          <span className="text-xs text-fg-subtle">
            Version {check.version} checked {formatFullDate(check.checkedAt)}, {formatTimeUtc(check.checkedAt)} by run{" "}
            {check.checkedByRunId} against crawl {check.crawlId}
            {check.searchWindow ? ` and Search Console ${check.searchWindow}` : ""} · recorded {formatFullDate(check.recordedAt)},{" "}
            {formatTimeUtc(check.recordedAt)}
          </span>
        </div>
        <p className="text-sm">{check.summary}</p>
        <FactCheckGroup label="Supported" items={check.supported} />
        <FactCheckGroup label="Partly supported" items={check.partial} />
        <FactCheckGroup label="Unsupported — no record holds this" items={check.unsupported} />
        <FactCheckGroup label="Unverifiable from these records" items={check.unverifiable} />
        <FactCheckGroup label="Editorial — no factual claim" items={check.editorial} />
        <p className="text-xs text-fg-subtle">
          A check against the records this product holds, for this exact version. Unsupported means no record holds
          the statement, not that it is false. This is not an approval, and nothing was published.
        </p>
      </dd>
    </div>
  );
}

function FactCheckGroup({ label, items }: { label: string; items: readonly FactCheckItem[] }) {
  return (
    <div>
      <p className="text-xs font-medium text-fg">
        {label} ({items.length})
      </p>
      {items.length === 0 ? (
        <p className="text-xs text-fg-subtle">none</p>
      ) : (
        <ul className="list-disc space-y-0.5 pl-5 text-sm">
          {items.map((item, index) => (
            <li key={`${index}-${item.text}`}>
              &ldquo;{item.text}&rdquo;
              {item.note ? ` — ${item.note}` : ""}
              {item.evidence ? <span className="text-xs text-fg-subtle"> [{item.evidence}]</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ListRow({ label, items }: { label: string; items: readonly string[] }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{label}</dt>
      <dd className="text-fg-muted">
        {items.length === 0 ? (
          "none"
        ) : (
          <ul className="list-disc space-y-0.5 pl-5">
            {items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </dd>
    </div>
  );
}
