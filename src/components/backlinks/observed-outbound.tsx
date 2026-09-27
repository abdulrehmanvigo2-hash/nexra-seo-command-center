"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { QueuedReview, useQueuedReview } from "@/components/agent-runs/queued-review";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/field";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { SectionHeader } from "@/components/ui/section-header";
import { Skeleton } from "@/components/ui/skeleton";
import { OUTBOUND_HEADER, OUTBOUND_NOTE, latestOutboundUrl, type LatestOutbound, type OutboundHost } from "@/lib/authority/outbound-view";
import { overviewReadFailure } from "@/lib/crawl/overview/contract";
import { OUTBOUND_LINK_REVIEW, reviewRequest } from "@/lib/crawl/review-request";
import type { ProjectOption } from "@/lib/projects/selection";

/**
 * The Outbound Links screen over stored crawls (Phase 4, checkpoint 4.5,
 * decision Q4: the navigation label is "Outbound Links"; the route stays
 * /backlinks).
 *
 * One stored project, chosen on the screen. The external edges its latest
 * own-site crawl recorded (`GET /api/crawls/latest-outbound`), grouped by
 * host with rel values, source paths and anchor text, and the outbound-link
 * review through the existing control. There is no authority score,
 * backlink, referring domain, inbound anchor, link gap, risk or outreach
 * reading here: nothing this product records backs one. Hidden, not
 * labelled.
 */

type Load = { readonly status: "loading" } | { readonly status: "failed"; readonly message: string } | { readonly status: "loaded"; readonly answer: LatestOutbound };

export function OutboundLinksScreen({ projects }: { projects: readonly ProjectOption[] }) {
  const searchParams = useSearchParams();
  const selectId = useId();
  const initialProject = searchParams.get("project");
  const [projectId, setProjectId] = useState<string | null>(() =>
    initialProject !== null && projects.some((p) => p.id === initialProject) ? initialProject : (projects[0]?.id ?? null),
  );

  return (
    <div className="space-y-6">
      <SectionHeader
        size="page"
        title="Outbound Links"
        description={OUTBOUND_HEADER}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent" title="Read from this product's own crawl of the project's site: the links found on its pages. Not fixture data.">
              Observed
            </Badge>
            {projects.length > 0 && (
              <>
                <label htmlFor={selectId} className="text-xs text-fg-subtle">
                  Stored project
                </label>
                <Select id={selectId} size="sm" value={projectId ?? ""} onChange={(event) => setProjectId(event.target.value)} options={projects.map((p) => ({ value: p.id, label: p.name }))} />
              </>
            )}
          </div>
        }
      />
      {projects.length === 0 && (
        <Panel>
          <EmptyState icon="projects" title="No stored project" description="Outbound Links reads a stored project's own crawl. Add a project on the Projects screen." />
        </Panel>
      )}
      {projectId !== null && <Outbound key={projectId} projectId={projectId} />}
    </div>
  );
}

function Outbound({ projectId }: { projectId: string }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    fetch(latestOutboundUrl(projectId), { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (response.status === 503) return setLoad({ status: "loaded", answer: { status: "unavailable" } });
        if (!response.ok) return setLoad({ status: "failed", message: overviewReadFailure(response.status) });
        setLoad({ status: "loaded", answer: (await response.json()) as LatestOutbound });
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setLoad({ status: "failed", message: overviewReadFailure(0) });
      });
    return () => controller.abort();
  }, [projectId]);

  const crawl = load.status === "loaded" && load.answer.status === "crawled" ? load.answer.crawl : null;
  const review = useQueuedReview(reviewRequest(projectId, crawl, OUTBOUND_LINK_REVIEW), crawl?.id ?? null, OUTBOUND_LINK_REVIEW, projectId);

  if (load.status === "loading") return <Skeleton className="h-64 w-full" />;
  if (load.status === "failed") {
    return (
      <Panel>
        <PanelBody>
          <p className="text-sm text-critical" role="status">
            {load.message}
          </p>
        </PanelBody>
      </Panel>
    );
  }
  const answer = load.answer;
  if (answer.status !== "crawled") {
    return (
      <Panel>
        <EmptyState
          icon="backlinks"
          title={answer.status === "unavailable" ? "Crawls are not stored on this deployment" : "No crawl of this project's site yet"}
          description={answer.status === "unavailable" ? "There is no recorded link to show." : "Crawl the project's own site from its screen; this list shows the outbound links that crawl recorded."}
        />
      </Panel>
    );
  }
  const { view } = answer;
  return (
    <Panel>
      <PanelHeader eyebrow="Latest own-site crawl" title="Outbound hosts" description={OUTBOUND_NOTE} />
      <p className="border-b border-border px-4 pb-3 text-[11.5px] text-fg-subtle sm:px-5" role="note">
        {answer.banner}
      </p>
      {view.hosts.length === 0 ? (
        <EmptyState icon="backlinks" title="No outbound link recorded" description="The fetched pages link to no outside host. This is what the crawl recorded, not a verdict on the site." />
      ) : (
        <ul className="divide-y divide-border">
          {view.hosts.map((host) => (
            <HostItem key={host.host} host={host} />
          ))}
        </ul>
      )}
      <PanelFooter>
        <span>
          {view.externalEdges} external {view.externalEdges === 1 ? "edge" : "edges"} to {view.hosts.length + view.moreHosts} {view.hosts.length + view.moreHosts === 1 ? "host" : "hosts"}
          {view.moreHosts > 0 ? `, ${view.moreHosts} not listed` : ""}
          {answer.cut ? "; the edge read reached its bound, so some edges may be missing" : ""}.
        </span>
      </PanelFooter>
      <div className="px-4 py-4 sm:px-5">
        <QueuedReview review={OUTBOUND_LINK_REVIEW} projectId={projectId} {...review} />
      </div>
    </Panel>
  );
}

function HostItem({ host }: { host: OutboundHost }) {
  return (
    <li className="space-y-1.5 px-4 py-3 sm:px-5">
      <p className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[12.5px] text-fg">{host.host}</span>
        <span className="text-xs text-fg-subtle">
          {host.edges} {host.edges === 1 ? "edge" : "edges"}
        </span>
      </p>
      <dl className="grid gap-1 text-xs sm:grid-cols-[7rem_1fr]">
        <dt className="text-fg-subtle">rel as written</dt>
        <dd>{host.rels.map((r) => `${r.rel} (${r.edges})`).join(" · ")}</dd>
        <dt className="text-fg-subtle">From our pages</dt>
        <dd className="font-mono text-[11.5px]">{host.sources.join("  ")}</dd>
        <dt className="text-fg-subtle">Anchor text</dt>
        <dd>
          {host.anchors.length > 0 ? host.anchors.map((a) => `“${a}”`).join(", ") : <span className="text-fg-subtle italic">none recorded</span>}
          {host.emptyAnchors > 0 ? ` · ${host.emptyAnchors} with no text` : ""}
          {host.unrecordedAnchors > 0 ? ` · ${host.unrecordedAnchors} recorded before anchor text was kept` : ""}
        </dd>
      </dl>
    </li>
  );
}
