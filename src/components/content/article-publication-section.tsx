"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { PublicationHistory } from "@/components/publishing/publication-history";
import {
  MODE_EXPLANATION,
  MODE_LABEL,
  NOT_SET_UP_MESSAGE,
  READ_FAILED_MESSAGE,
  latestFor,
  listFromResponse,
  publishPath,
  requestOutcome,
  todayUtc,
  type ListLoad,
} from "@/lib/publishing/presenter";

/**
 * *Request publication…* (P-L2, PR 7): on an approved article with its active publication proposal, the operator
 * chooses the published date and, optionally, a cross-link — words in the live follow-up article to link from — and
 * confirms. One POST records a single-use, 24-hour approval bound to that exact request and the publication row; the
 * request then appears as *Ready to publish* in the Command Center. Nothing is published here: the publish page is
 * where the press is. The server and the database decide eligibility; this section shows the latest request.
 */
export function ArticlePublicationSection({ projectId, articleId }: { projectId: string; articleId: string }) {
  const [load, setLoad] = useState<ListLoad>({ status: "loading" });
  const [version, setVersion] = useState(0);
  const [dialog, setDialog] = useState(false);
  const [published, setPublished] = useState(() => todayUtc(Date.now()));
  const [anchor, setAnchor] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [note, setNote] = useState<ReturnType<typeof requestOutcome> | null>(null);
  const dateId = useId();
  const anchorId = useId();
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/publications?project=${encodeURIComponent(projectId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => setLoad(listFromResponse(response.status, await response.json().catch(() => null), Date.now())))
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setLoad({ status: "failed", message: READ_FAILED_MESSAGE });
      });
    return () => controller.abort();
  }, [projectId, version]);

  const request = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const response = await fetch("/api/publications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project: projectId, articleId, publishedOn: published, crossLinkAnchor: anchor.trim() === "" ? null : anchor }),
        cache: "no-store",
      });
      setNote(requestOutcome(response.status, await response.json().catch(() => null)));
    } catch {
      setNote(requestOutcome(0, null));
    }
    inFlight.current = false;
    setBusy(false);
    setDialog(false);
    reload();
  };

  const latest = load.status === "loaded" ? latestFor(load.entries, articleId) : null;
  const inProgress = latest !== null && latest.publication.status !== "requested";

  return (
    <section className="space-y-3 rounded-panel border border-border p-4" aria-label="Publication">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-0.5">
          <h3 className="text-[13px] font-semibold text-fg">Publication</h3>
          <p className="text-[12px] text-fg-subtle">Publishes the active proposal&apos;s slug to the website through one nexra-ai pull request.</p>
        </div>
        {load.status === "loaded" && <Badge tone={load.mode === "off" ? "neutral" : "accent"}>{MODE_LABEL[load.mode]}</Badge>}
      </div>

      {load.status === "loading" && <p className="text-[12px] text-fg-muted">Reading the publication requests…</p>}
      {load.status === "not-set-up" && <p className="text-[12px] text-fg-subtle">{NOT_SET_UP_MESSAGE}</p>}
      {load.status === "failed" && (
        <p role="status" className="text-[12px] text-critical">
          {load.message}
        </p>
      )}

      {load.status === "loaded" && (
        <>
          <p className="text-[12px] text-fg-subtle">{MODE_EXPLANATION[load.mode]}</p>
          <PublicationHistory entries={load.entries} articleId={articleId} readAt={load.readAt} />
          {!inProgress && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setDialog(true)}>
              Request publication…
            </Button>
          )}
        </>
      )}

      {note && (
        <p role="status" className={note.tone === "warning" ? "text-[12px] text-warning" : "text-[12px] text-fg-muted"}>
          {note.text}{" "}
          {note.approvalId !== null && (
            <Link href={publishPath(note.approvalId)} className="font-medium text-accent hover:underline">
              Open publish page
            </Link>
          )}
        </p>
      )}

      {dialog && (
        <Modal
          title="Request publication"
          description="Records one approval, single use and valid for 24 hours, bound to this exact version, its active proposal, the date and the cross-link below. Nothing is published until Publish is pressed on the publish page."
          onClose={() => setDialog(false)}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setDialog(false)}>
                Cancel
              </Button>
              <Button size="sm" disabled={busy || published === ""} onClick={() => void request()}>
                Record request
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            <Field label="Published date" htmlFor={dateId} required hint="The date the article shows as published (the site's own record).">
              <TextInput id={dateId} type="date" value={published} onChange={(event) => setPublished(event.target.value)} />
            </Field>
            <Field
              label="Cross-link (optional)"
              htmlFor={anchorId}
              hint="Exact words on one line of the live follow-up article to link to the new article from. Leave empty for no cross-link."
            >
              <TextInput id={anchorId} value={anchor} maxLength={120} onChange={(event) => setAnchor(event.target.value)} placeholder="e.g. The AI layer reads what someone actually wrote" />
            </Field>
          </div>
        </Modal>
      )}
    </section>
  );
}
