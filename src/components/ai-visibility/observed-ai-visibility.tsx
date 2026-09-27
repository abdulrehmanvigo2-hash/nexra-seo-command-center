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
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { READINESS_LABEL, WORD_COUNT_NOTE, presentReadiness, yesNoUnknown, type ReadinessRow } from "@/lib/crawl/declared-readiness";
import { overviewReadFailure, overviewUrl, type CrawlOverview } from "@/lib/crawl/overview/contract";
import { CRAWL_REVIEWS, reviewRequest } from "@/lib/crawl/review-request";
import { formatNumber } from "@/lib/format";
import type { ProjectOption } from "@/lib/projects/selection";

/**
 * The AI Visibility screen over stored crawls (Phase 4, checkpoint 4.5).
 *
 * One stored project, chosen on the screen. The latest own-site crawl, read
 * through the Technical SEO screen's own route (`GET
 * /api/crawls/latest-overview`), as one row per fetched page of the fields
 * the answer-readiness review reads, and that review through the existing
 * control. There is no visibility score, citation, mention share, entity,
 * fan-out, topic, gap, opportunity, evidence or AI-bot access reading here:
 * nothing this product records backs one. Hidden, not labelled (Q5).
 */

type Load = { readonly status: "loading" } | { readonly status: "failed"; readonly message: string } | { readonly status: "loaded"; readonly overview: CrawlOverview };

const ANSWER_READINESS = CRAWL_REVIEWS["answer-readiness-review"];

export function AiVisibilityScreen({ projects }: { projects: readonly ProjectOption[] }) {
  const searchParams = useSearchParams();
  const selectId = useId();
  const initialProject = searchParams.get("project");
  const [projectId, setProjectId] = useState<string | null>(() =>
    initialProject !== null && projects.some((p) => p.id === initialProject) ? initialProject : (projects[0]?.id ?? null),
  );
  const project = projects.find((p) => p.id === projectId) ?? null;

  return (
    <div className="space-y-6">
      <SectionHeader
        size="page"
        title="AI Visibility"
        description={`What ${project?.name ?? "the project"}'s pages declared to this product's crawler, in the fields an answer engine could read. Observed data only.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent" title="Read from this product's own crawl of the project's site. What each page declared, not whether any AI engine reads or cites it. Not fixture data.">
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
          <EmptyState icon="projects" title="No stored project" description="AI Visibility reads a stored project's own crawl. Add a project on the Projects screen." />
        </Panel>
      )}
      {projectId !== null && <Readiness key={projectId} projectId={projectId} />}
    </div>
  );
}

function Readiness({ projectId }: { projectId: string }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    fetch(overviewUrl(projectId), { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (response.status === 503) return setLoad({ status: "loaded", overview: { status: "unavailable" } });
        if (!response.ok) return setLoad({ status: "failed", message: overviewReadFailure(response.status) });
        setLoad({ status: "loaded", overview: (await response.json()) as CrawlOverview });
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setLoad({ status: "failed", message: overviewReadFailure(0) });
      });
    return () => controller.abort();
  }, [projectId]);

  const crawl = load.status === "loaded" && load.overview.status === "crawled" ? load.overview.crawl : null;
  const review = useQueuedReview(reviewRequest(projectId, crawl, ANSWER_READINESS), crawl?.id ?? null, ANSWER_READINESS, projectId);

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
  const view = presentReadiness(load.overview);
  if (view.status !== "crawled") {
    return (
      <Panel>
        <EmptyState
          icon="ai-visibility"
          title={view.status === "unavailable" ? "Crawls are not stored on this deployment" : "No crawl of this project's site yet"}
          description={view.status === "unavailable" ? "There is no recorded page to show." : "Crawl the project's own site from its screen; this table shows what that crawl recorded."}
        />
      </Panel>
    );
  }
  return (
    <Panel>
      <PanelHeader eyebrow="Latest own-site crawl" title="Answer-readiness declarations" description={READINESS_LABEL} />
      <p className="border-b border-border px-4 pb-3 text-[11.5px] text-fg-subtle sm:px-5" role="note">
        {view.banner}
      </p>
      <Table>
        <TableHead>
          <TableRow>
            <TableHeaderCell>Page</TableHeaderCell>
            <TableHeaderCell>H1</TableHeaderCell>
            <TableHeaderCell>Title · description</TableHeaderCell>
            <TableHeaderCell>Canonical</TableHeaderCell>
            <TableHeaderCell>Indexing</TableHeaderCell>
            <TableHeaderCell>Schema types</TableHeaderCell>
            <TableHeaderCell align="right">Words as served</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {view.rows.map((row) => (
            <ReadinessTableRow key={row.url} row={row} />
          ))}
        </TableBody>
      </Table>
      <PanelFooter>
        <span>
          {view.rows.length} fetched {view.rows.length === 1 ? "page" : "pages"}
          {view.notFetched > 0 ? `; ${view.notFetched} discovered but not fetched, so nothing is known about them` : ""}. {WORD_COUNT_NOTE}
        </span>
      </PanelFooter>
      <div className="px-4 py-4 sm:px-5">
        <QueuedReview review={ANSWER_READINESS} projectId={projectId} {...review} />
      </div>
    </Panel>
  );
}

function Missing() {
  return <span className="text-fg-subtle italic">none declared</span>;
}

function ReadinessTableRow({ row }: { row: ReadinessRow }) {
  return (
    <TableRow>
      <TableCell header className="font-mono text-[11.5px]">
        <span title={row.url}>{row.path}</span>
      </TableCell>
      <TableCell className="max-w-56">
        <span className="text-fg-subtle">{row.h1Count === null ? "not established" : `${row.h1Count} h1`}</span>
        {row.firstH1 !== null && <p className="truncate text-xs text-fg" title={row.firstH1}>{row.firstH1}</p>}
      </TableCell>
      <TableCell className="max-w-72">
        <p className="truncate text-xs" title={row.title ?? undefined}>{row.title ?? <Missing />}</p>
        <p className="truncate text-xs text-fg-muted" title={row.metaDescription ?? undefined}>{row.metaDescription ?? <Missing />}</p>
      </TableCell>
      <TableCell className="text-xs">{row.canonicalIsSelf === null ? <Missing /> : row.canonicalIsSelf ? "self" : "points elsewhere"}</TableCell>
      <TableCell className="text-xs">{yesNoUnknown(row.robotsNoindex, "noindex declared", "no noindex")}</TableCell>
      <TableCell className="max-w-56 text-xs">
        {row.schemaTypes.length > 0 ? row.schemaTypes.join(", ") : <Missing />}
        {row.schemaParseFailed && <p className="text-warning">a block failed to parse</p>}
      </TableCell>
      <TableCell numeric className="text-xs">{row.wordCount === null ? "not established" : formatNumber(row.wordCount)}</TableCell>
    </TableRow>
  );
}
