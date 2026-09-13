"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelBody, PanelFooter } from "@/components/ui/panel";
import { SectionHeader } from "@/components/ui/section-header";
import { AGENT_NAMES } from "@/lib/mock/seo";
import { getPortfolioMetrics } from "@/lib/projects/portfolio";
import { buildDraftListItem } from "@/lib/projects/session-drafts";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import {
  EMPTY_FILTERS,
  hasActiveFilters,
  matchesFilters,
  needsAttention,
  type ProjectFilters,
} from "@/components/projects/filters";
import { PortfolioSummary } from "@/components/projects/portfolio-summary";
import { ProjectCard } from "@/components/projects/project-card";
import { ProjectsTable } from "@/components/projects/projects-table";
import { ProjectsToolbar } from "@/components/projects/projects-toolbar";
import {
  SORT_OPTIONS,
  compareProjects,
  type ProjectSort,
} from "@/components/projects/sorting";
import {
  setProjectView,
  useProjectView,
  type ProjectView,
} from "@/components/projects/view-preference";
import type { AgentId } from "@/types/seo";
import type {
  NewProjectInput,
  ProjectListItem,
  ProjectStatus,
} from "@/types/project";

/**
 * The Projects area: the whole client roster, the portfolio numbers above it,
 * and the intake flow that adds to it.
 *
 * Owns the search, filter, sort, and view selection; both views render the
 * same filtered rows, so switching between them never changes what is on
 * screen, only how it is read.
 *
 * A client component because the selection is interactive. The roster arrives
 * as a prop, read by the route through the project repository; projects
 * created here are added to it in this component's state only.
 */
export function ProjectsWorkspace({
  roster,
  asOf,
}: {
  /** Canonical roster rows from the project repository. */
  roster: readonly ProjectListItem[];
  /** The instant the roster's figures describe. */
  asOf: string;
}) {

  const [drafts, setDrafts] = useState<readonly ProjectListItem[]>([]);
  const [filters, setFilters] = useState<ProjectFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<{ key: ProjectSort; desc: boolean }>({
    key: "updated",
    desc: true,
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [created, setCreated] = useState<string | null>(null);

  const view = useProjectView();

  // The confirmation clears itself; the timer is tracked so an unmount cannot
  // leave a pending update to run against a component that is gone.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const projects = useMemo(() => [...drafts, ...roster], [drafts, roster]);

  const statusCounts = useMemo(() => {
    const tally = { all: projects.length } as Record<
      ProjectStatus | "all",
      number
    >;
    for (const project of projects) {
      tally[project.status] = (tally[project.status] ?? 0) + 1;
    }
    return tally;
  }, [projects]);

  const assignedAgents = useMemo(() => {
    const seen = new Set<AgentId>();
    for (const project of projects) {
      for (const agent of project.agents) seen.add(agent);
    }
    return (Object.keys(AGENT_NAMES) as AgentId[]).filter((agent) =>
      seen.has(agent),
    );
  }, [projects]);

  const visible = useMemo(
    () =>
      projects
        .filter((project) => matchesFilters(project, filters))
        .sort((a, b) => compareProjects(a, b, sort)),
    [projects, filters, sort],
  );

  const metrics = useMemo(() => getPortfolioMetrics(projects), [projects]);
  const attention = projects.filter(needsAttention).length;

  const changeFilters = (patch: Partial<ProjectFilters>) =>
    setFilters((current) => ({ ...current, ...patch }));

  /** Re-selecting the current key reverses it; a new key starts in its own default. */
  const changeSort = (key: ProjectSort) =>
    setSort((current) =>
      current.key === key
        ? { key, desc: !current.desc }
        : {
            key,
            desc: SORT_OPTIONS.find((option) => option.value === key)?.desc ?? true,
          },
    );

  const changeView = (next: ProjectView) => setProjectView(next);

  const createProject = (input: NewProjectInput) => {
    const draft = buildDraftListItem(input, asOf);

    setDrafts((current) => [draft, ...current]);
    setCreateOpen(false);
    setCreated(draft.name);
    setFilters(EMPTY_FILTERS);

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCreated(null), 8_000);
  };

  return (
    <>
      {/*
        Everything behind the dialog is inert while it is open. The dialog
        traps keyboard focus on its own, but without this the page's own
        "Create project" trigger stays in the accessibility tree — two controls
        with the same name, one of which does nothing useful at that moment.
      */}
      <div className="space-y-6" inert={createOpen}>
        <SectionHeader
          size="page"
          title="Projects"
          description="Every client project in the workspace, with the health, delivery state, and assigned agents behind each one."
          actions={
            <>
              <span className="hidden items-center gap-1.5 text-[11.5px] text-fg-subtle sm:inline-flex">
                <Icon name="alert" className="h-3.5 w-3.5" />
                {attention} needing attention
              </span>
              <Button
                variant="primary"
                icon="plus"
                onClick={() => setCreateOpen(true)}
              >
                Create project
              </Button>
            </>
          }
        />

        <div aria-live="polite">
          {created && (
            <div className="flex flex-wrap items-start gap-3 rounded-panel border border-positive/30 bg-positive/10 px-4 py-3">
              <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-positive" />
              <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-fg-muted">
                <span className="font-medium text-fg">{created}</span> was created
                and added to the roster. It is held in this session only — there
                is no backend yet, so it will not survive a reload.
              </p>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCreated(null)}
                aria-label="Dismiss confirmation"
              >
                <Icon name="close" className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        <PortfolioSummary metrics={metrics} />

        <Panel>
          <ProjectsToolbar
            filters={filters}
            onFilterChange={changeFilters}
            onReset={() => setFilters(EMPTY_FILTERS)}
            statusCounts={statusCounts}
            sort={sort}
            onSortChange={changeSort}
            view={view}
            onViewChange={changeView}
            agents={assignedAgents}
            total={projects.length}
            shown={visible.length}
          />

          {projects.length === 0 ? (
            <EmptyState
              icon="projects"
              title="No projects yet"
              description="Create the first project to start tracking health, keywords, and agent activity for a client."
              action={
                <Button
                  variant="primary"
                  icon="plus"
                  onClick={() => setCreateOpen(true)}
                >
                  Create project
                </Button>
              }
            />
          ) : visible.length === 0 ? (
            <EmptyState
              icon="search"
              title="No projects match these filters"
              description="Nothing in the roster matches the current search and filter combination."
              action={
                hasActiveFilters(filters) ? (
                  <Button icon="close" onClick={() => setFilters(EMPTY_FILTERS)}>
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          ) : view === "grid" ? (
            <PanelBody>
              <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {visible.map((project) => (
                  <li key={project.id} className="min-w-0">
                    <ProjectCard
                      project={project}
                      referenceIso={asOf}
                    />
                  </li>
                ))}
              </ul>
            </PanelBody>
          ) : (
            <ProjectsTable
              projects={visible}
              sort={sort}
              onSort={changeSort}
              referenceIso={asOf}
            />
          )}

          <PanelFooter>
            <span>
              All figures are mock data over the last 30 days. Open a project for
              its full workspace.
            </span>
            <span>
              {visible.length} of {projects.length} projects
            </span>
          </PanelFooter>
        </Panel>

      </div>

      {createOpen && (
        <CreateProjectDialog
          onClose={() => setCreateOpen(false)}
          onCreate={createProject}
        />
      )}
    </>
  );
}
