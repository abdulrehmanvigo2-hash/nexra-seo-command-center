"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { formatFullDate, formatTimeUtc } from "@/lib/format";
import {
  NOT_SET_UP_MESSAGE,
  READ_FAILED_MESSAGE,
  errorText,
  historyFacts,
  historyFor,
  listFromResponse,
  publishPath,
  standing,
  type ListLoad,
  type PublicationEntry,
} from "@/lib/publishing/presenter";

/**
 * Publication history (P-L2, PR 8): every publication request of one article, newest first — where it stands, what
 * it bound and recorded (version, date, cross-link, mode, base commit, files, merge commit), its pull request and its
 * last error — each linking to its publish page. Read only; it renders what the list route answered.
 */
export function PublicationHistory({ entries, articleId, readAt }: { entries: readonly PublicationEntry[]; articleId: string; readAt: number }) {
  const history = historyFor(entries, articleId);
  if (history.length === 0) return <p className="text-[12px] text-fg-muted">No publication has been requested for this article.</p>;
  return (
    <ol className="divide-y divide-border rounded-control border border-border" aria-label="Publication history">
      {history.map((entry) => {
        const { publication } = entry;
        const shown = standing(entry, readAt);
        return (
          <li key={publication.id} className="space-y-1 px-3 py-2.5 text-[12px]">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={shown.tone}>{shown.label}</Badge>
              <span className="text-fg-muted">
                Requested {formatFullDate(publication.requestedAt)} {formatTimeUtc(publication.requestedAt)}
              </span>
              <Link href={publishPath(publication.approvalId)} className="font-medium text-accent hover:underline">
                Publish page
              </Link>
              {publication.pullRequestUrl !== null && (
                <a href={publication.pullRequestUrl} className="font-medium text-accent hover:underline" rel="noreferrer" target="_blank">
                  Pull request #{publication.pullRequestNumber}
                </a>
              )}
            </div>
            <p className="text-fg-subtle">{historyFacts(publication).join(" · ")}</p>
            {publication.lastError !== null && (
              <p className="text-warning">
                {errorText(publication.lastError.code)} ({publication.lastError.step}, {formatFullDate(publication.lastError.at)} {formatTimeUtc(publication.lastError.at)})
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The article detail page's read of the same history (`/content/[articleId]`): one read of the list route, no
 * control — requesting and publishing happen on the project screen and the publish page.
 */
export function ArticlePublicationHistory({ projectId, articleId }: { projectId: string; articleId: string }) {
  const [load, setLoad] = useState<ListLoad>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/publications?project=${encodeURIComponent(projectId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => setLoad(listFromResponse(response.status, await response.json().catch(() => null), Date.now())))
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setLoad({ status: "failed", message: READ_FAILED_MESSAGE });
      });
    return () => controller.abort();
  }, [projectId]);

  return (
    <div className="space-y-2 text-xs" aria-label="Publications">
      <div className="font-medium text-fg">Publications</div>
      {load.status === "loading" && <p className="text-fg-muted">Reading the publication requests…</p>}
      {load.status === "not-set-up" && <p className="text-fg-muted">{NOT_SET_UP_MESSAGE}</p>}
      {load.status === "failed" && (
        <p role="status" className="text-critical">
          {load.message}
        </p>
      )}
      {load.status === "loaded" && <PublicationHistory entries={load.entries} articleId={articleId} readAt={load.readAt} />}
    </div>
  );
}
