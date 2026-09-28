"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/field";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { SectionHeader } from "@/components/ui/section-header";
import { Skeleton } from "@/components/ui/skeleton";
import { ok, type Read } from "@/lib/content/studio";
import type { ArticleProposalStateView } from "@/lib/content/articles/proposals/service";
import type { FindingHistoryRead } from "@/lib/crawl/service";
import type { ContentAnswer, LatestFindingsAnswer } from "@/lib/dashboard/command-center";
import { formatFullDate, formatTimeUtc } from "@/lib/format";
import type { ProjectOption } from "@/lib/projects/selection";
import {
  presentReport,
  proposalReadIds,
  REPORT_NOTE,
  reportUrls,
  SECTION_STATE_LABEL,
  type ProjectReport,
  type ReportSection,
} from "@/lib/reports/project-report";
import type { HistoryView } from "@/lib/search-console/history/view";
import type { LatestWindowView } from "@/lib/search-console/latest/view";
import type { AgentTask } from "@/lib/agent-tasks/contract";
import type { AgentRun } from "@/types/agent-run";
import type { ArticleWorkspace } from "@/types/content-article-record";

/**
 * Reports on read (checkpoint 6.4): one stored project's report, generated
 * from its stored records each time the screen opens. Observed data only —
 * no fixture, no stored report, no write, no control that starts anything.
 * Print keeps the report and drops the shell and the controls.
 */

/** One read: 503 means the deployment keeps no such records; any other failure, or a missing answer, is a failed read. */
async function read<T>(url: string, signal: AbortSignal, pick: (body: unknown) => T): Promise<Read<T>> {
  try {
    const response = await fetch(url, { cache: "no-store", signal });
    if (response.status === 503) return { status: "unavailable" };
    if (!response.ok) return { status: "failed" };
    const value = pick(await response.json());
    return value === undefined || value === null ? { status: "failed" } : ok(value);
  } catch (error) {
    if (signal.aborted) throw error;
    return { status: "failed" };
  }
}

async function readContent(projectId: string, signal: AbortSignal): Promise<Read<ContentAnswer>> {
  const workspace = await read(reportUrls.articles(projectId), signal, (body) => (body as { workspace: ArticleWorkspace }).workspace);
  if (workspace.status !== "ok") return workspace;
  const ids = proposalReadIds(workspace.value.articles);
  const states = await Promise.all(
    ids.map(async (id) => [id, await read(reportUrls.proposal(projectId, id), signal, (body) => (body as { proposal: ArticleProposalStateView }).proposal)] as const),
  );
  return ok({ articles: workspace.value.articles, proposals: new Map(states) });
}

type Load = { readonly status: "loading" } | { readonly status: "loaded"; readonly report: ProjectReport };

export function ObservedReport({ projects }: { projects: readonly ProjectOption[] }) {
  const searchParams = useSearchParams();
  const selectId = useId();
  const initialProject = searchParams.get("project");
  const [projectId, setProjectId] = useState<string | null>(() =>
    initialProject !== null && projects.some((p) => p.id === initialProject) ? initialProject : (projects[0]?.id ?? null),
  );
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const projectName = projects.find((p) => p.id === projectId)?.name ?? projectId ?? "";

  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    const { signal } = controller;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loading state belongs to this request
    setLoad({ status: "loading" });
    Promise.all([
      read(reportUrls.searchConsole(projectId), signal, (body) => body as LatestWindowView),
      read(reportUrls.history(projectId), signal, (body) => body as HistoryView),
      read(reportUrls.findings(projectId), signal, (body) => body as LatestFindingsAnswer),
      read(reportUrls.findingHistory(projectId), signal, (body) => body as FindingHistoryRead),
      read(reportUrls.tasks(projectId), signal, (body) => (body as { tasks: AgentTask[] }).tasks),
      read(reportUrls.director(projectId), signal, (body) => (body as { runs: AgentRun[] }).runs),
      readContent(projectId, signal),
    ])
      .then(([searchConsole, history, findings, findingHistory, tasks, director, content]) => {
        const name = projects.find((p) => p.id === projectId)?.name ?? projectId;
        const report = presentReport({ projectId, projectName: name, generatedAt: new Date().toISOString(), searchConsole, history, findings, findingHistory, tasks, director, content });
        setLoad({ status: "loaded", report });
      })
      .catch(() => {
        // Aborted: a newer project's reads replace these.
      });
    return () => controller.abort();
  }, [projectId, projects]);

  return (
    <div className="space-y-6">
      <SectionHeader
        size="page"
        title={projectId ? `Report · ${projectName}` : "Reports"}
        description="A project report generated on read from its stored Search Console windows, crawl findings, tasks, SEO Director plan and articles. Observed data only."
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <Badge tone="accent" title="Read from this product's stored records for the chosen project. Not fixture data.">
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
            <Button icon="reports" size="sm" disabled={load.status !== "loaded" || !projectId} onClick={() => window.print()}>
              Print
            </Button>
          </div>
        }
      />

      {!projectId ? (
        <Panel>
          <EmptyState icon="reports" title="No stored project" description="Create a project on the Projects screen; its report is generated here from its stored records." />
        </Panel>
      ) : load.status === "loading" ? (
        <div className="space-y-4" aria-busy="true">
          {Array.from({ length: 5 }, (_, index) => (
            <Panel as="div" key={index} className="space-y-3 p-4">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-3/4" />
            </Panel>
          ))}
        </div>
      ) : (
        <ReportBody report={load.report} />
      )}

      <p className="text-[11.5px] leading-relaxed text-fg-subtle">{REPORT_NOTE}</p>
    </div>
  );
}

function ReportBody({ report }: { report: ProjectReport }) {
  return (
    <div className="space-y-4">
      <p className="text-[12px] text-fg-muted">
        Generated {formatFullDate(report.generatedAt)} at {formatTimeUtc(report.generatedAt)} for {report.projectName}.
      </p>
      {report.sections.map((section) => (
        <SectionCard key={section.id} section={section} />
      ))}
      <Panel className="break-inside-avoid">
        <PanelHeader title="Windows and records used" />
        <PanelBody>
          <ul className="space-y-1 text-[12px] leading-relaxed text-fg-muted">
            {report.sources.map((source) => (
              <li key={source}>{source}</li>
            ))}
          </ul>
        </PanelBody>
      </Panel>
    </div>
  );
}

function SectionCard({ section }: { section: ReportSection }) {
  const { state } = section;
  return (
    <Panel className="break-inside-avoid">
      <PanelHeader
        title={section.title}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={state.kind === "observed" ? "accent" : state.kind === "failed" ? "critical" : "neutral"}>{SECTION_STATE_LABEL[state.kind]}</Badge>
            <Link href={section.href} className="inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline print:hidden">
              Open
              <Icon name="arrow-right" className="h-3.5 w-3.5" />
            </Link>
          </div>
        }
      />
      <PanelBody className="space-y-3">
        {state.kind === "observed" ? (
          <>
            {state.lines.length > 0 && (
              <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                {state.lines.map((line, index) => (
                  <div key={`${line.label}-${index}`} className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1 text-[12.5px]">
                    <dt className="min-w-0 text-fg-muted">{line.label}</dt>
                    <dd className="tabular shrink-0 text-right font-medium text-fg">{line.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {state.quote !== null && (
              <blockquote className="rounded-md border border-border bg-surface-raised px-3 py-2.5 text-[12.5px] leading-relaxed whitespace-pre-wrap text-fg">{state.quote}</blockquote>
            )}
            <Notes notes={state.notes} />
          </>
        ) : state.kind === "not-recorded" ? (
          <>
            <p className="text-[12.5px] leading-relaxed text-fg-muted">{state.description}</p>
            <Notes notes={state.notes} />
          </>
        ) : (
          <p role="status" className={state.kind === "failed" ? "text-[12.5px] leading-relaxed text-critical" : "text-[12.5px] leading-relaxed text-fg-subtle"}>
            {state.description}
          </p>
        )}
      </PanelBody>
    </Panel>
  );
}

function Notes({ notes }: { notes: readonly string[] }) {
  if (notes.length === 0) return null;
  return (
    <ul className="space-y-1 text-[11.5px] leading-relaxed text-fg-subtle">
      {notes.map((note) => (
        <li key={note}>{note}</li>
      ))}
    </ul>
  );
}
