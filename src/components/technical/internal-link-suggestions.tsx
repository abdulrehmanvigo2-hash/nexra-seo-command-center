"use client";

import { useEffect, useRef, useState } from "react";
import { SpendConfirmDialog } from "@/components/spend/spend-confirm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { internalLinksUrl, NO_TEXT_NOTE, SUGGESTIONS_NOTE, taskConfirmation, taskOutcome, type InternalLinksView } from "@/lib/internal-links/contract";
import { PHRASE_SOURCE_LABELS, type LinkSuggestion } from "@/lib/internal-links/suggest";

/**
 * *Suggestions* on the Technical SEO screen's Internal links tab (M8, PR 5): the newest own-site crawl's internal-link
 * suggestions by fixed rules, each with *Record as task* (confirmed). Read on open; nothing edits a page.
 */
type Read = { readonly status: "loading" } | { readonly status: "failed"; readonly httpStatus: number } | { readonly status: "ready"; readonly view: InternalLinksView };

export function InternalLinkSuggestions({ projectId }: { projectId: string }) {
  const [read, setRead] = useState<Read>({ status: "loading" });
  const [dialog, setDialog] = useState<LinkSuggestion | null>(null);
  const [note, setNote] = useState<{ readonly text: string; readonly tone: "neutral" | "warning" } | null>(null);
  const [recorded, setRecorded] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(internalLinksUrl(projectId), { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { view?: InternalLinksView } | null;
        setRead(response.ok && body?.view ? { status: "ready", view: body.view } : { status: "failed", httpStatus: response.status });
      })
      .catch((error: unknown) => {
        if (!(error instanceof Error && error.name === "AbortError")) setRead({ status: "failed", httpStatus: 0 });
      });
    return () => controller.abort();
  }, [projectId]);

  const record = async (suggestion: LinkSuggestion, crawlId: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setNote(null);
    try {
      const response = await fetch("/api/internal-links/task", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project: projectId, crawl: crawlId, from: suggestion.fromUrl, to: suggestion.toUrl, anchor: suggestion.anchor }),
        cache: "no-store",
      });
      setNote(taskOutcome(response.status, await response.json().catch(() => null)));
      if (response.ok) setRecorded((current) => new Set([...current, `${suggestion.fromUrl} ${suggestion.toUrl}`]));
    } catch {
      setNote(taskOutcome(0, null));
    }
    inFlight.current = false;
    setBusy(false);
  };

  return (
    <Panel>
      <PanelHeader title="Suggestions" description={SUGGESTIONS_NOTE} actions={<Badge tone="neutral">Fixed rules · no AI</Badge>} />
      <PanelBody className="space-y-3">
        {note !== null && (
          <p className={note.tone === "warning" ? "text-xs text-warning" : "text-xs text-fg-muted"} role="status">
            {note.text}
          </p>
        )}
        {read.status === "loading" ? (
          <Skeleton className="h-16 w-full" />
        ) : read.status === "failed" ? (
          <p className="text-sm text-warning">{read.httpStatus === 503 ? "Crawls are not kept on this deployment." : "The suggestions could not be read. Nothing is shown in their place."}</p>
        ) : read.view.status === "none" ? (
          <p className="text-sm text-fg-muted">No own-site crawl is recorded for this project.</p>
        ) : (
          <Suggestions view={read.view} recorded={recorded} busy={busy} onRecord={setDialog} />
        )}
      </PanelBody>
      {read.status === "ready" && read.view.status === "read" && (
        <PanelFooter>
          <span>
            {read.view.textPages} of {read.view.fetchedPages} fetched pages had text kept.
            {!read.view.phrasesRead.liveArticles && " The live articles' keywords could not be read; h1s and titles were used."}
            {!read.view.phrasesRead.curatedKeywords && " The curated keywords could not be read."}
          </span>
        </PanelFooter>
      )}
      {dialog !== null && read.status === "ready" && read.view.status === "read" && (
        <SpendConfirmDialog
          confirmation={taskConfirmation(dialog, projectId)}
          projectId={null}
          busy={busy}
          onClose={() => setDialog(null)}
          onConfirm={() => {
            const chosen = dialog;
            setDialog(null);
            if (read.view.status === "read") void record(chosen, read.view.crawl.id);
          }}
        />
      )}
    </Panel>
  );
}

function Suggestions({ view, recorded, busy, onRecord }: { view: Extract<InternalLinksView, { status: "read" }>; recorded: ReadonlySet<string>; busy: boolean; onRecord: (suggestion: LinkSuggestion) => void }) {
  if (view.texts === "not-readable") return <p className="text-sm text-warning">The crawl&apos;s kept page text could not be read (the M8 migration may not be applied yet). Nothing is shown in its place.</p>;
  if (view.textPages === 0) return <p className="text-sm text-fg-muted">{NO_TEXT_NOTE}</p>;
  if (view.suggestions.length === 0) return <p className="text-sm text-fg-muted">No suggestion: no page&apos;s text names another page it does not already link to.</p>;
  return (
    <ul className="space-y-3">
      {view.suggestions.map((suggestion) => {
        const key = `${suggestion.fromUrl} ${suggestion.toUrl}`;
        return (
          <li key={key} className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3 text-sm">
            <div className="min-w-0 space-y-1">
              <div className="break-all font-medium text-fg">
                {suggestion.fromPath} → {suggestion.toPath}
              </div>
              <div className="text-xs text-fg-muted">
                Anchor “{suggestion.anchor}” · {PHRASE_SOURCE_LABELS[suggestion.source]} · the target has {suggestion.targetInbound} inbound {suggestion.targetInbound === 1 ? "link" : "links"} in this crawl
              </div>
              <blockquote className="border-l-2 border-border pl-2 text-xs text-fg-subtle">{suggestion.context}</blockquote>
            </div>
            {recorded.has(key) ? (
              <Badge tone="positive">Task recorded</Badge>
            ) : (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => onRecord(suggestion)}>
                Record as task…
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
