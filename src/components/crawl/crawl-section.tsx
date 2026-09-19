"use client";

import { useCallback, useState } from "react";
import { CrawlPanel } from "@/components/crawl/crawl-panel";
import { CrawlSignalsPanel } from "@/components/crawl/signals-panel";

/**
 * The crawl panel and the signals panel, and the one thing they share.
 *
 * They are separate panels because they answer separate questions and read
 * separate endpoints: one polls a crawl's single status row every few seconds
 * while a pass runs, the other reads a few hundred signal rows and is not
 * polled. Left unconnected, though, the second one is stale for the whole of
 * a pass — it says nothing has been read while the first says six pages were
 * fetched, which is the state an operator actually sees.
 *
 * So the polling panel reports that it moved and the reading panel re-reads.
 * A counter, not the data: the panels stay independent, nothing is duplicated
 * between them, and no second poll is added.
 */
export function CrawlSection({ projectId }: { readonly projectId: string }) {
  const [progress, setProgress] = useState(0);
  const advance = useCallback(() => setProgress((count) => count + 1), []);

  return (
    <>
      <CrawlPanel projectId={projectId} onProgress={advance} />
      <CrawlSignalsPanel projectId={projectId} progress={progress} />
    </>
  );
}
