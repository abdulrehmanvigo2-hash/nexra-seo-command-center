"use client";

import { useEffect, useState } from "react";
import { QueuedReview, useQueuedReview } from "@/components/agent-runs/queued-review";
import { Panel, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { CONTENT_PLAN_REVIEW, contentPlanRequest } from "@/lib/crawl/review-request";
import type { Crawl } from "@/types/crawl";

/**
 * The Content Strategist's plan for one page of the project on screen.
 *
 * The same shared control the other reviews use, over the same records the
 * evidence pack reads: the newest own-site crawl, the default Search Console
 * window where connected, and which competitor crawls exist. Every record is
 * found on the server from the persisted run, so the request carries no
 * input and the project id is both the evidence key and the restore key.
 * The pack's output is not read: the plan and the pack are two readings of
 * one set of records, and the pack's supported-claims list stays the
 * authority a draft will cite.
 *
 * The crawl is the one record the plan cannot do without, so the panel reads
 * the project's newest own-site crawl once, after hydration, through the
 * same listing the crawl panel reads, and offers the control only when that
 * crawl is one the server's reader would accept. Queueing and Run Now stay
 * two separate operator actions, and the completed result never offers a
 * Director hand-off.
 */
export function ContentPlanPanel({ projectId }: { projectId: string }) {
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

  const plan = useQueuedReview(contentPlanRequest(projectId, projectCrawl), projectId, CONTENT_PLAN_REVIEW, projectId);

  return (
    <Panel>
      <PanelHeader
        eyebrow="Content Strategist"
        title="Content plan"
        description="One page planned from the records this product holds for this project: the newest site crawl, the Search Console window where connected, and which competitor crawls exist. Every recorded fact is tagged with its record; every section without one is marked as needing evidence. No keyword volume, difficulty, ranking or competitor figure is named, and no earlier agent's output is read."
      />
      {/* The header already rules the section off; the control's own top rule is dropped. */}
      <div className="px-4 pb-4 sm:px-5 [&>section]:border-t-0">
        <QueuedReview review={CONTENT_PLAN_REVIEW} projectId={projectId} {...plan} />
      </div>
      <PanelFooter>
        <span>
          Read-only. The plan is a proposal over recorded evidence, not a measurement; factual claims in a draft come
          only from the Research &amp; Evidence pack&apos;s supported list.
        </span>
      </PanelFooter>
    </Panel>
  );
}
