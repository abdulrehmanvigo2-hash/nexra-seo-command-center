"use client";

import { useEffect, useState } from "react";
import { saveWriterRunAsDraft, type SaveWriterRunAsDraftResult } from "@/app/(app)/projects/draft-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatFullDate, formatTimeUtc } from "@/lib/format";
import type { AgentRun } from "@/types/agent-run";
import type { DraftWithCurrentVersion } from "@/types/content-draft";

/**
 * The operator control that turns one completed Writer run into a saved
 * draft, and the read-only panel that shows the saved draft afterwards.
 *
 * Nothing saves on its own: the control reads whether a draft already exists
 * for the run on screen (a GET, never a write) and shows either the "Save as
 * draft" button or the draft. Saving is one explicit click, answered by the
 * server from the run's own record — the text shown here is what the server
 * stored, never what the browser held. The same run saved again returns the
 * same draft. There is no edit, fact-check, approve, publish or delete
 * control, because none of those exists yet; the panel says so.
 */

type State =
  | { readonly status: "loading" }
  | { readonly status: "none" }
  | { readonly status: "saved"; readonly saved: DraftWithCurrentVersion; readonly justSaved: boolean }
  | { readonly status: "unavailable" }
  | { readonly status: "failed"; readonly message: string };

const FAILURE: Readonly<Record<Exclude<SaveWriterRunAsDraftResult, { ok: true }>["reason"], string>> = {
  unauthorized: "Your session has ended. Reload the page to sign in again.",
  "rate-limited": "Too many saves. Wait a moment and try again.",
  invalid: "This run cannot be saved: its identifiers are not what the server expects.",
  unavailable: "Drafts are not persisted on this deployment, so nothing can be saved.",
  "not-found": "This run no longer exists on the server.",
  ineligible: "This run is not a completed, grounded Writer draft, so it cannot be saved.",
  failed: "The draft could not be saved. Nothing is known to have been written.",
};

export function SaveDraftControl({ projectId, run }: { projectId: string; run: AgentRun }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [saving, setSaving] = useState(false);

  // Restore: does a draft for this run already exist? A read, keyed by the
  // project and the run. The parent keys this component by the run's id, so
  // a new run on screen mounts a fresh control that asks again from "loading".
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ project: projectId, writerRun: run.id });
    fetch(`/api/content-drafts?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (response.status === 503) {
          setState({ status: "unavailable" });
          return;
        }
        if (!response.ok) {
          setState({ status: "failed", message: "The saved draft could not be read. Reload to try again." });
          return;
        }
        const body = (await response.json()) as { draft?: DraftWithCurrentVersion | null };
        setState(body.draft ? { status: "saved", saved: body.draft, justSaved: false } : { status: "none" });
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setState({ status: "failed", message: "The saved draft could not be read. Reload to try again." });
      });
    return () => controller.abort();
  }, [projectId, run.id]);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const result = await saveWriterRunAsDraft(projectId, run.id);
      if (result.ok) setState({ status: "saved", saved: result.saved, justSaved: result.created });
      else setState({ status: "failed", message: FAILURE[result.reason] });
    } catch {
      setState({ status: "failed", message: FAILURE.failed });
    } finally {
      setSaving(false);
    }
  }

  if (state.status === "loading") {
    return <p className="text-xs text-fg-subtle">Checking for a saved draft…</p>;
  }

  if (state.status === "saved") return <DraftPanel saved={state.saved} justSaved={state.justSaved} />;

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
      {state.status === "unavailable" && <p className="text-xs text-warning">{FAILURE.unavailable}</p>}
      {state.status === "failed" && (
        <p className="text-xs text-critical" role="status">
          {state.message}
        </p>
      )}
    </div>
  );
}

function DraftPanel({ saved, justSaved }: { saved: DraftWithCurrentVersion; justSaved: boolean }) {
  const { draft, version } = saved;
  return (
    <section className="space-y-3 border-t border-border pt-3" aria-label="Saved draft">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="accent">Draft</Badge>
        <Badge tone="neutral">Version {version.version}</Badge>
        <Badge tone="neutral">{version.origin === "writer" ? "AI-generated original" : "Operator edit"}</Badge>
        <span className="text-xs text-fg-subtle">
          {justSaved ? "Saved just now" : "Restored from the saved draft"} · created {formatFullDate(version.createdAt)},{" "}
          {formatTimeUtc(version.createdAt)}
        </span>
      </div>

      <dl className="space-y-2 text-sm">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Section</dt>
          <dd className="text-fg">{draft.sectionLabel}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Body</dt>
          <dd className="whitespace-pre-wrap text-fg-muted">{version.body}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Claims used</dt>
          <dd className="text-fg-muted">
            {version.claims.length === 0 ? (
              "none"
            ) : (
              <ul className="list-disc space-y-0.5 pl-5">
                {version.claims.map((claim) => (
                  <li key={claim}>{claim}</li>
                ))}
              </ul>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Placeholders</dt>
          <dd className="text-fg-muted">
            {version.placeholders.length === 0 ? (
              "none"
            ) : (
              <ul className="list-disc space-y-0.5 pl-5">
                {version.placeholders.map((placeholder) => (
                  <li key={placeholder}>{placeholder}</li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>

      <p className="text-xs text-fg-subtle">
        Status: {draft.status}. Editing, fact-checking, approval and publishing are not available yet; this draft is
        stored for a person to review and is not published anywhere.
      </p>
    </section>
  );
}
