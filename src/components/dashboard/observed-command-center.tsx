"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { Icon } from "@/components/icons";
import { ReadyToPublish } from "@/components/publishing/ready-to-publish";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/field";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { SectionHeader } from "@/components/ui/section-header";
import { Skeleton } from "@/components/ui/skeleton";
import { ok, type Read } from "@/lib/content/studio";
import type { ArticleProposalStateView } from "@/lib/content/articles/proposals/service";
import {
  COMMAND_CENTER_NOTE,
  commandCenterUrls,
  presentCommandCenter,
  proposalReadIds,
  type CommandCenterInput,
  type CommandCenterTile,
  type ContentAnswer,
  type LatestFindingsAnswer,
} from "@/lib/dashboard/command-center";
import type { ProjectOption } from "@/lib/projects/selection";
import type { LatestWindowView } from "@/lib/search-console/latest/view";
import type { AgentTask } from "@/lib/agent-tasks/contract";
import type { AgentRun } from "@/types/agent-run";
import type { ArticleWorkspace } from "@/types/content-article-record";

/**
 * The Command Center over stored data (checkpoint 6.3): five tiles for one
 * stored project, each read from an existing route and linking to the screen
 * that owns it. Observed data only — no fixture, no write, no control that
 * starts anything.
 */

function ObservedBadge() {
  return (
    <Badge tone="accent" title="Read from this product's stored records for the chosen project. Not fixture data.">
      Observed
    </Badge>
  );
}

/** One read: 503 means the deployment keeps no such records; any other failure is a failed read. */
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
  const workspace = await read(commandCenterUrls.articles(projectId), signal, (body) => (body as { workspace: ArticleWorkspace }).workspace);
  if (workspace.status !== "ok") return workspace;
  const ids = proposalReadIds(workspace.value.articles);
  const states = await Promise.all(
    ids.map(async (id) => [id, await read(commandCenterUrls.proposal(projectId, id), signal, (body) => (body as { proposal: ArticleProposalStateView }).proposal)] as const),
  );
  return ok({ articles: workspace.value.articles, proposals: new Map(states) });
}

type Load = { readonly status: "loading" } | { readonly status: "loaded"; readonly tiles: readonly CommandCenterTile[] };

export function ObservedCommandCenter({ projects }: { projects: readonly ProjectOption[] }) {
  const searchParams = useSearchParams();
  const selectId = useId();
  const initialProject = searchParams.get("project");
  const [projectId, setProjectId] = useState<string | null>(() =>
    initialProject !== null && projects.some((p) => p.id === initialProject) ? initialProject : (projects[0]?.id ?? null),
  );
  const [load, setLoad] = useState<Load>({ status: "loading" });

  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    const { signal } = controller;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loading state belongs to this request
    setLoad({ status: "loading" });
    Promise.all([
      read(commandCenterUrls.searchConsole(projectId), signal, (body) => body as LatestWindowView),
      read(commandCenterUrls.findings(projectId), signal, (body) => body as LatestFindingsAnswer),
      read(commandCenterUrls.tasks(projectId), signal, (body) => (body as { tasks: AgentTask[] }).tasks),
      read(commandCenterUrls.runs(projectId), signal, (body) => (body as { runs: AgentRun[] }).runs),
      readContent(projectId, signal),
    ])
      .then(([searchConsole, findings, tasks, runs, content]) => {
        const input: CommandCenterInput = { projectId, searchConsole, findings, tasks, runs, content };
        setLoad({ status: "loaded", tiles: presentCommandCenter(input) });
      })
      .catch(() => {
        // Aborted: a newer project's reads replace these.
      });
    return () => controller.abort();
  }, [projectId]);

  const projectName = projects.find((p) => p.id === projectId)?.name ?? projectId ?? "";

  return (
    <div className="space-y-6">
      <SectionHeader
        size="page"
        title="Command Center"
        description={projectId ? `What is stored for ${projectName}: its Search Console window, crawl findings, tasks, agent runs and articles. Observed data only.` : "What is stored for a project. Observed data only."}
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

      {!projectId ? (
        <Panel>
          <EmptyState icon="projects" title="No stored project" description="Create a project on the Projects screen; its stored records appear here." />
        </Panel>
      ) : load.status === "loading" ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 5 }, (_, index) => (
            <Panel as="div" key={index} className="space-y-3 p-4">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-7 w-40" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-3/4" />
            </Panel>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {load.tiles.map((tile) => (
            <TileCard key={tile.id} tile={tile} />
          ))}
        </div>
      )}

      {projectId && <ReadyToPublish projectId={projectId} />}

      <p className="text-[11.5px] leading-relaxed text-fg-subtle">{COMMAND_CENTER_NOTE}</p>
    </div>
  );
}

function TileCard({ tile }: { tile: CommandCenterTile }) {
  const { state } = tile;
  return (
    <Panel className="flex flex-col">
      <PanelHeader title={tile.title} />
      <PanelBody className="flex-1">
        {state.kind === "figures" ? (
          <div className="space-y-3">
            <p className="tabular text-[18px] leading-tight font-semibold text-fg">{state.headline}</p>
            {state.lines.length > 0 && (
              <dl className="space-y-1.5">
                {state.lines.map((line, index) => (
                  <div key={`${line.label}-${index}`} className="flex items-baseline justify-between gap-3 text-[12.5px]">
                    <dt className="min-w-0 truncate text-fg-muted">{line.label}</dt>
                    <dd className="tabular shrink-0 font-medium text-fg">{line.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {state.note && <p className="text-[11.5px] leading-relaxed text-fg-subtle">{state.note}</p>}
          </div>
        ) : state.kind === "empty" ? (
          <div className="space-y-1">
            <p className="text-[13px] font-medium text-fg">{state.title}</p>
            <p className="text-[12px] leading-relaxed text-fg-subtle">{state.description}</p>
          </div>
        ) : (
          <p role="status" className={state.kind === "failed" ? "text-[12px] leading-relaxed text-critical" : "text-[12px] leading-relaxed text-fg-subtle"}>
            {state.description}
          </p>
        )}
      </PanelBody>
      <PanelFooter>
        <Link href={tile.href} className="inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline">
          {tile.linkLabel}
          <Icon name="arrow-right" className="h-3.5 w-3.5" />
        </Link>
      </PanelFooter>
    </Panel>
  );
}
