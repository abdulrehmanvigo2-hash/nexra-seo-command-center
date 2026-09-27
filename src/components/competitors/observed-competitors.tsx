"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { QueuedReview, useQueuedReview } from "@/components/agent-runs/queued-review";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/field";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { SectionHeader } from "@/components/ui/section-header";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DECLARATIONS_LABEL,
  DECLARATIONS_NOTE,
  RECORDED_NOTE,
  comparisonRunsFor,
  comparisonRunsUrl,
  competitorHref,
  competitorListUrl,
  competitorOverviewUrl,
  competitorReadFailure,
  type ComparisonRunRow,
  type CompetitorList,
  type CompetitorOverview,
  type DeclaredPage,
  type SiteSide,
} from "@/lib/crawl/competitor-overview";
import { STATUS_LABEL } from "@/lib/crawl/panel-state";
import { COMPETITOR_COMPARISON_REVIEW, competitorComparisonRequest } from "@/lib/crawl/review-request";
import { formatFullDate } from "@/lib/format";
import type { ProjectOption } from "@/lib/projects/selection";
import type { AgentRun } from "@/types/agent-run";

/**
 * The Competitor Intelligence screen over stored crawls (Phase 4, checkpoint
 * 4.4, decision Q3).
 *
 * One stored project, chosen on the screen. Its recorded competitor domains,
 * each with its newest crawl and that crawl's coverage banner, or "not crawled
 * yet"; for the chosen competitor, what each site's pages declared as crawled,
 * side by side, and the comparison review through the existing control. There
 * is no SERP, ranking, visibility, overlap, gap or authority figure anywhere
 * here: this product holds none. Hidden, not labelled.
 */

type Load<T> =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "loaded"; readonly view: T };

function useRead<T>(url: string | null): Load<T> {
  const [load, setLoad] = useState<Load<T>>({ status: "loading" });
  useEffect(() => {
    if (url === null) return;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loading state belongs to this request
    setLoad({ status: "loading" });
    fetch(url, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!response.ok) return setLoad({ status: "failed", message: competitorReadFailure(response.status, body?.error) });
        setLoad({ status: "loaded", view: body as T });
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setLoad({ status: "failed", message: competitorReadFailure(0) });
      });
    return () => controller.abort();
  }, [url]);
  return load;
}

function Failure({ message }: { message: string }) {
  return (
    <Panel>
      <PanelBody>
        <p className="text-sm text-critical" role="status">
          {message}
        </p>
      </PanelBody>
    </Panel>
  );
}

export function ObservedBadge() {
  return (
    <Badge tone="accent" title="Read from crawls this product recorded of the project's site and its recorded competitors. What pages declared, not a measurement. Not fixture data.">
      Observed
    </Badge>
  );
}

export function CompetitorsScreen({ projects }: { projects: readonly ProjectOption[] }) {
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
        title="Competitor Intelligence"
        description={`The competitor domains recorded for ${project?.name ?? "the project"}, and what each site's pages declared as this product crawled them. Observed data only.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ObservedBadge />
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
          <EmptyState icon="projects" title="No stored project" description="Competitor Intelligence reads a stored project's recorded competitor domains and crawls. Add a project on the Projects screen." />
        </Panel>
      )}
      {project !== null && <ProjectCompetitors key={project.id} project={project} />}
    </div>
  );
}

function ProjectCompetitors({ project }: { project: ProjectOption }) {
  const load = useRead<CompetitorList>(competitorListUrl(project.id));
  const [chosen, setChosen] = useState<string | null>(null);

  if (load.status === "loading") return <Skeleton className="h-40 w-full" />;
  if (load.status === "failed") return <Failure message={load.message} />;
  const list = load.view;
  if (list.competitors.length === 0) {
    return (
      <Panel>
        <EmptyState icon="competitors" title="No competitor domains recorded" description="This project's stored record lists no competitor domain. Competitor domains are recorded on the project's screen." />
      </Panel>
    );
  }
  const host = chosen ?? list.competitors[0].host;
  const recorded = list.competitors.map((c) => c.host);

  return (
    <>
      <Panel>
        <PanelHeader eyebrow="Recorded at intake" title="Competitor domains" description={RECORDED_NOTE} />
        <ul className="divide-y divide-border">
          {list.competitors.map((competitor) => (
            <li key={competitor.host} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
              <div className="min-w-0 space-y-1">
                <p className="font-mono text-[12.5px] text-fg">{competitor.host}</p>
                {competitor.latest !== null && competitor.banner !== null ? (
                  <p className="flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
                    <Badge tone={STATUS_LABEL[competitor.latest.status].tone} dot>
                      {STATUS_LABEL[competitor.latest.status].label}
                    </Badge>
                    <span>{competitor.banner}</span>
                  </p>
                ) : (
                  <p className="text-xs text-fg-subtle">Not crawled yet.</p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button type="button" className="text-xs text-accent hover:underline disabled:text-fg-subtle disabled:no-underline" disabled={competitor.host === host} onClick={() => setChosen(competitor.host)}>
                  {competitor.host === host ? "Shown below" : "Show declarations"}
                </button>
                <Link href={competitorHref(competitor.host, project.id)} className="text-xs text-accent hover:underline">
                  Open
                </Link>
              </div>
            </li>
          ))}
        </ul>
        <PanelFooter>
          <span>Crawls are started from the project&apos;s screen; nothing here fetches a website.</span>
        </PanelFooter>
      </Panel>
      <CompetitorDeclarations key={host} projectId={project.id} projectDomain={project.domain} recorded={recorded} host={host} />
    </>
  );
}

/** The two sites' declarations side by side, and the comparison review of this competitor. */
export function CompetitorDeclarations({ projectId, projectDomain, recorded, host }: { projectId: string; projectDomain: string; recorded: readonly string[]; host: string }) {
  const load = useRead<CompetitorOverview>(competitorOverviewUrl(projectId, host));
  const view = load.status === "loaded" ? load.view : null;
  const crawlOf = (side: SiteSide | undefined) => (side === undefined ? undefined : side.status === "crawled" ? side.crawl : null);
  const comparison = useQueuedReview(
    competitorComparisonRequest({ projectId, projectDomain, competitorDomain: host, recorded, projectCrawl: crawlOf(view?.project), competitorCrawl: crawlOf(view?.competitor) }),
    host,
    COMPETITOR_COMPARISON_REVIEW,
    projectId,
  );

  if (load.status === "loading") return <Skeleton className="h-64 w-full" />;
  if (load.status === "failed") return <Failure message={load.message} />;
  const overview = load.view;
  return (
    <Panel>
      <PanelHeader eyebrow="Stored crawls" title={DECLARATIONS_LABEL} description={DECLARATIONS_NOTE} />
      <div className="grid gap-4 px-4 pb-4 sm:px-5 lg:grid-cols-2">
        <SiteColumn heading="This project's site" side={overview.project} />
        <SiteColumn heading="Competitor's site" side={overview.competitor} />
      </div>
      <div className="px-4 pb-4 sm:px-5">
        <QueuedReview review={COMPETITOR_COMPARISON_REVIEW} projectId={projectId} {...comparison} />
      </div>
    </Panel>
  );
}

function SiteColumn({ heading, side }: { heading: string; side: SiteSide }) {
  return (
    <section className="min-w-0 space-y-2">
      <h4 className="text-xs font-medium text-fg">
        {heading} · <span className="font-mono">{side.host}</span>
      </h4>
      {side.status === "not-crawled" ? (
        <p className="text-xs text-fg-subtle">Not crawled yet. Nothing is known about this site&apos;s pages.</p>
      ) : (
        <>
          <p className="text-[11.5px] text-fg-subtle" role="note">
            {side.banner}
          </p>
          {side.pages.length === 0 ? (
            <p className="text-xs text-fg-subtle">
              {side.crawl.status === "completed" || side.crawl.status === "partial" ? "The crawl fetched no page to show." : `The newest crawl is ${STATUS_LABEL[side.crawl.status].label.toLowerCase()}, so it recorded no declarations to show.`}
            </p>
          ) : (
            <ul className="space-y-2">
              {side.pages.map((page) => (
                <DeclaredPageItem key={page.url} page={page} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function Declared({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-2 text-xs">
      <dt className="text-fg-subtle">{label}</dt>
      <dd className={value === null ? "text-fg-subtle italic" : "break-words text-fg"}>{value ?? "none declared"}</dd>
    </div>
  );
}

function DeclaredPageItem({ page }: { page: DeclaredPage }) {
  return (
    <li className="rounded-md border border-border px-3 py-2">
      <p className="mb-1 truncate font-mono text-[11.5px] text-fg-muted" title={page.url}>
        {page.path}
      </p>
      <dl className="space-y-0.5">
        <Declared label="Title" value={page.title} />
        <Declared label="First h1" value={page.firstH1} />
        <Declared label="Description" value={page.metaDescription} />
        <Declared label="Canonical" value={page.canonical} />
        <Declared label="Schema types" value={page.schemaTypes.length > 0 ? page.schemaTypes.join(", ") : null} />
      </dl>
    </li>
  );
}

/** This competitor's comparison reviews, newest first. */
export function ComparisonRuns({ projectId, host }: { projectId: string; host: string }) {
  const load = useRead<{ runs?: AgentRun[] }>(comparisonRunsUrl(projectId));
  if (load.status === "loading") return <Skeleton className="h-24 w-full" />;
  if (load.status === "failed") return <Failure message={load.message} />;
  const rows = comparisonRunsFor(load.view.runs ?? [], host);
  return (
    <Panel>
      <PanelHeader eyebrow="Market & Competitor Intelligence" title="Comparison reviews of this competitor" description="A model's reading of the two crawls' declarations, never a measurement of either business." />
      {rows.length === 0 ? (
        <EmptyState icon="agents" title="No comparison review yet" description="None has been queued for this competitor. One can be queued beneath the declarations above." />
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <RunItem key={row.id} row={row} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function RunItem({ row }: { row: ComparisonRunRow }) {
  return (
    <li className="space-y-1.5 px-4 py-3 sm:px-5">
      <p className="flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
        <Badge tone={row.status === "completed" ? "positive" : row.status === "failed" ? "critical" : "neutral"}>{row.status}</Badge>
        <span>
          run {row.id.slice(0, 8)} · queued {formatFullDate(row.createdAt)}
          {row.finishedAt !== null ? ` · finished ${formatFullDate(row.finishedAt)}` : ""}
          {row.simulated ? " · simulated (mock executor)" : ""}
          {row.errorCode !== null ? ` · ${row.errorCode}` : ""}
        </span>
      </p>
      {row.summary !== null && <p className="text-sm whitespace-pre-line text-fg">{row.summary}</p>}
    </li>
  );
}
