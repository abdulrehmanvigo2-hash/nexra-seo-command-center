"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { formatFullDate, formatTimeUtc } from "@/lib/format";
import { MODE_LABEL, NOT_SET_UP_MESSAGE, READ_FAILED_MESSAGE, listFromResponse, publishPath, type ListLoad } from "@/lib/publishing/presenter";

/**
 * *Ready to publish* (P-L2, PR 7): the Command Center's list of publication requests whose approval is unused,
 * unexpired and the article's newest — each a link to its publish page. A read only; the page is where Publish is.
 * Before migration 20261023120000 it says publishing is not set up yet.
 */
export function ReadyToPublish({ projectId }: { projectId: string }) {
  const [load, setLoad] = useState<ListLoad>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loading state belongs to this request
    setLoad({ status: "loading" });
    fetch(`/api/publications?project=${encodeURIComponent(projectId)}&view=ready`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => setLoad(listFromResponse(response.status, await response.json().catch(() => null))))
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setLoad({ status: "failed", message: READ_FAILED_MESSAGE });
      });
    return () => controller.abort();
  }, [projectId]);

  return (
    <Panel>
      <PanelHeader
        title="Ready to publish"
        description="Publication requests waiting for one press on their publish page. Each request is single use and expires 24 hours after it was made."
        actions={load.status === "loaded" ? <Badge tone={load.mode === "off" ? "neutral" : "accent"}>{MODE_LABEL[load.mode]}</Badge> : undefined}
      />
      <PanelBody>
        {load.status === "loading" && <p className="text-[12.5px] text-fg-muted">Reading the publication requests…</p>}
        {load.status === "not-set-up" && <p className="text-[12.5px] text-fg-subtle">{NOT_SET_UP_MESSAGE}</p>}
        {load.status === "failed" && (
          <p role="status" className="text-[12.5px] text-critical">
            {load.message}
          </p>
        )}
        {load.status === "loaded" &&
          (load.entries.length === 0 ? (
            <p className="text-[12.5px] text-fg-subtle">Nothing is waiting to be published. Request publication from an approved article with an active proposal.</p>
          ) : (
            <ul className="divide-y divide-border">
              {load.entries.map(({ publication, approval }) => (
                <li key={publication.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-[13px] font-medium break-words text-fg">/blog/{publication.slug}</p>
                    <p className="text-[11.5px] text-fg-subtle">
                      Version {publication.articleVersion} · published date {publication.publishedOn}
                      {publication.crossLinkAnchor === null ? " · no cross-link" : " · with a cross-link"}
                      {approval !== null && ` · expires ${formatFullDate(approval.expiresAt)} ${formatTimeUtc(approval.expiresAt)}`}
                    </p>
                  </div>
                  <Link href={publishPath(publication.approvalId)} className="inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline">
                    Open publish page
                    <Icon name="arrow-right" className="h-3.5 w-3.5" />
                  </Link>
                </li>
              ))}
            </ul>
          ))}
      </PanelBody>
    </Panel>
  );
}
