"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { AssembledDraft } from "@/lib/briefs/assemble-article";
import { draftUrl, editorHref, openable, STATUS_LABELS, statusCounts } from "@/lib/briefs/handoff";
import { issueMessage } from "@/lib/content/articles/editor-form";

/**
 * The assembled article draft of one brief (M6, PR 5), read from `GET /api/briefs/draft` once every part is drafted:
 * the evidence map with unsupported lines first, the validator's issues, the notes, and *Open in editor*. Read-only.
 */
export function AssembledDraftView({ projectId, briefRunId, version }: { projectId: string; briefRunId: string; version: string }) {
  const [state, setState] = useState<{ readonly status: "loading" } | { readonly status: "failed" } | { readonly status: "ready"; readonly draft: AssembledDraft }>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetch(draftUrl(projectId, briefRunId), { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { draft?: AssembledDraft } | null;
        setState(response.ok && body?.draft ? { status: "ready", draft: body.draft } : { status: "failed" });
      })
      .catch((error: unknown) => {
        if (!(error instanceof Error && error.name === "AbortError")) setState({ status: "failed" });
      });
    return () => controller.abort();
  }, [projectId, briefRunId, version]);

  if (state.status === "loading") return <Skeleton className="h-16 w-full" />;
  if (state.status === "failed") return <p className="text-xs text-warning">The assembled draft could not be read. Nothing is shown in its place.</p>;
  const { draft } = state;
  if (draft.content === null) return null;
  const counts = statusCounts(draft);
  const unsupported = draft.evidenceMap.filter((entry) => entry.status === "unsupported");

  return (
    <div className="space-y-2 rounded-md border border-border p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-fg">Assembled draft</span>
          <Badge tone={counts.unsupported > 0 ? "critical" : "positive"}>{counts.unsupported} unsupported</Badge>
          <span className="text-fg-subtle">{counts.record} on a record · {counts.opinion} our view · {counts.connective} no fact</span>
        </div>
        {openable(draft) ? (
          <Link href={editorHref(projectId, briefRunId)} className="rounded-md border border-border px-2.5 py-1 font-medium text-fg hover:bg-surface-raised">
            Open in editor
          </Link>
        ) : (
          <span className="text-warning">Fix the issues below before it can be opened in the editor.</span>
        )}
      </div>
      {unsupported.length > 0 && (
        <ul className="space-y-1">
          {unsupported.map((entry) => (
            <li key={entry.locator} className="border-l-2 border-critical pl-2">
              <span className="text-fg-subtle">{entry.locator} · {STATUS_LABELS.unsupported}</span>
              <div className="text-fg">{entry.text}</div>
              {entry.note !== null && <div className="text-fg-muted">{entry.note}</div>}
            </li>
          ))}
        </ul>
      )}
      {draft.issues.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-critical" role="alert">
          {draft.issues.slice(0, 20).map((issue, i) => <li key={`${i}-${issue.path}`}>{issueMessage(issue)}</li>)}
        </ul>
      )}
      {draft.evidenceMap.some((entry) => entry.status === "opinion" && entry.note !== null) && (
        <p className="text-warning">An “our view” line states a number; an attested paragraph may not.</p>
      )}
      {draft.notes.length > 0 && <ul className="list-disc space-y-0.5 pl-4 text-fg-muted">{draft.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
      <p className="text-fg-subtle">A model&apos;s draft from a model&apos;s brief: every statement is checked again when the saved article is fact-checked. Nothing here is saved.</p>
    </div>
  );
}
