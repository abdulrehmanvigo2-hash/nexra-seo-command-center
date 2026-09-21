"use client";

import { useEffect, useState } from "react";
import { QueuedReview, useQueuedReview } from "@/components/agent-runs/queued-review";
import { Panel, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { EVIDENCE_PACK_REVIEW, evidencePackRequest } from "@/lib/crawl/review-request";
import type { Crawl } from "@/types/crawl";

/**
 * The Research & Evidence agent's evidence pack for the project on screen.
 *
 * The same shared control the other reviews use, over the records this
 * product holds for the project: the newest own-site crawl, the default
 * Search Console window where connected, and which competitor crawls exist.
 * Every record is found on the server from the persisted run, so the request
 * carries no input and the project id is both the evidence key and the
 * restore key — the control drops its run only when the project does, and
 * reads the newest persisted pack back after every page load.
 *
 * The crawl is the one record the pack cannot do without, so the panel reads
 * the project's newest own-site crawl once, after hydration, through the
 * same listing the crawl panel reads, and offers the control only when that
 * crawl is one the server's reader would accept. Search Console and
 * competitor crawls never block it: an absent one is written into the pack
 * as not established. Queueing and Run Now stay two separate operator
 * actions, and the completed result never offers a Director hand-off.
 */
export function EvidencePackPanel({ projectId }: { projectId: string }) {
  const [projectCrawl, setProjectCrawl] = useState<Crawl | null | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/crawls?project=${encodeURIComponent(projectId)}&limit=1`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json()) as { crawls?: Crawl[] };
        setProjectCrawl(body.crawls?.[0] ?? null);
      })
      .catch(() => {
        /* Left unknown: the control says the project's crawl history has not loaded. */
      });
    return () => controller.abort();
  }, [projectId]);

  const pack = useQueuedReview(evidencePackRequest(projectId, projectCrawl), projectId, EVIDENCE_PACK_REVIEW, projectId);

  return (
    <Panel>
      <PanelHeader
        eyebrow="Research & Evidence"
        title="Evidence pack"
        description="What the records this product holds for this project establish and cannot establish: the newest site crawl, the Search Console window where connected, and which competitor crawls exist. Each supportable claim is tagged with the record it rests on. No outside source is consulted; intake notes and earlier agent reviews are not evidence and are not read."
      />
      {/* The header already rules the section off; the control's own top rule is dropped. */}
      <div className="px-4 pb-4 sm:px-5 [&>section]:border-t-0">
        <QueuedReview review={EVIDENCE_PACK_REVIEW} projectId={projectId} {...pack} />
      </div>
      <PanelFooter>
        <span>
          Read-only. The pack organises recorded evidence; it is advice about that evidence, not a new measurement, and it
          changes nothing.
        </span>
      </PanelFooter>
    </Panel>
  );
}
