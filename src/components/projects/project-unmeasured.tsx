import Link from "next/link";
import { Icon, type IconName } from "@/components/icons";
import {
  ProjectMonogram,
  ProjectStatusBadge,
} from "@/components/projects/project-chrome";
import { CrawlSection } from "@/components/crawl/crawl-section";
import { SearchConsolePanel } from "@/components/search-console/search-console-panel";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import { formatFullDate } from "@/lib/format";
import { PROJECT_GOAL_META, PROJECT_TYPE_META } from "@/lib/mock/projects";
import type { ProjectRecord } from "@/types/project";

/**
 * The workspace of a project that exists but has not been measured.
 *
 * A project created through intake is stored with everything the agency told
 * us about it and nothing else: no crawl has run, so there is no health score,
 * traffic, keyword set, issue list, or assigned team to show. Rendering the
 * full workspace would mean inventing all of that, and a 404 would deny a
 * project that plainly exists. This shows what is known, in the same header
 * the measured workspace uses, and says plainly what is not there yet.
 *
 * Unmeasured is not the same as unknown. Where the project is mapped to a
 * Search Console property, Google has observed it whether or not anything in
 * this product has, so that report is shown here — the one screen for the
 * project that would otherwise hold nothing. It is the same panel Analytics
 * and Keyword Intelligence use, kept above the modelled-figures notice rather
 * than inside it: observed clicks are not a health score, and nothing below
 * borrows a number from it.
 */
export function ProjectUnmeasured({ project }: { project: ProjectRecord }) {
  const facts: { icon: IconName; label: string; value: string }[] = [
    { icon: "briefcase", label: "Client", value: project.client },
    { icon: "layers", label: "Industry", value: project.industry },
    { icon: "map-pin", label: "Market", value: project.market },
    { icon: "globe", label: "Language", value: project.language },
    {
      icon: PROJECT_TYPE_META[project.type].icon,
      label: "Type",
      value: PROJECT_TYPE_META[project.type].label,
    },
    {
      icon: PROJECT_GOAL_META[project.goal].icon,
      label: "Main goal",
      value: PROJECT_GOAL_META[project.goal].label,
    },
    { icon: "target", label: "Target location", value: project.targetLocation },
    {
      icon: "calendar",
      label: "Engagement started",
      value: formatFullDate(project.startedAt),
    },
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-panel border border-border bg-surface">
        <nav aria-label="Breadcrumb" className="px-4 pt-3.5 sm:px-5">
          <ol className="flex items-center gap-1.5 text-[11.5px] text-fg-subtle">
            <li>
              <Link
                href="/projects"
                className="inline-flex items-center gap-1.5 transition-colors hover:text-fg-muted"
              >
                <Icon name="arrow-left" className="h-3.5 w-3.5" />
                All projects
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li className="truncate text-fg-muted">{project.name}</li>
          </ol>
        </nav>

        <div className="flex min-w-0 items-start gap-3.5 px-4 pt-3 pb-4 sm:px-5">
          <ProjectMonogram
            initials={project.initials}
            size="lg"
            className="mt-0.5 hidden sm:flex"
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-[20px] leading-tight font-semibold tracking-tight text-fg">
                {project.name}
              </h2>
              <ProjectStatusBadge status={project.status} />
            </div>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-fg-muted">
              <span className="inline-flex items-center gap-1.5 font-mono text-[11.5px] text-fg-subtle">
                <Icon name="globe" className="h-3.5 w-3.5" />
                {project.domain}
              </span>
              <span aria-hidden="true">·</span>
              <span>{project.client}</span>
            </p>
            {project.summary && (
              <p className="mt-2 max-w-2xl text-[12.5px] leading-relaxed text-fg-muted">
                {project.summary}
              </p>
            )}
          </div>
        </div>

        <dl className="grid gap-x-6 gap-y-3 border-t border-border px-4 py-3.5 sm:grid-cols-2 sm:px-5 lg:grid-cols-4">
          {facts.map((fact) => (
            <div key={fact.label} className="flex min-w-0 items-start gap-2">
              <Icon
                name={fact.icon}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-subtle"
              />
              <div className="min-w-0">
                <dt className="text-[10.5px] font-medium tracking-[0.05em] text-fg-subtle uppercase">
                  {fact.label}
                </dt>
                <dd className="truncate text-[12px] text-fg-muted">{fact.value}</dd>
              </div>
            </div>
          ))}
        </dl>
      </section>

      {/*
        The one action this screen offers. Discovery is the first real
        measurement of the site, and it is deliberately above the observed and
        modelled panels: it is what an operator came here to do.
      */}
      {/*
        …and, directly below it, what that crawl read out of the pages it
        fetched: counts only, so a page with no title is reported as a page
        with no title and not as an issue with a severity. The two are one
        component because the second has to know when the first has advanced.
      */}
      <CrawlSection projectId={project.id} />

      {/*
        Thirty days, the window the rest of the product defaults to. This
        screen has no window selector and does not gain one here: a control
        that only reshapes one panel is not worth the second reading of the
        page. Every state the panel can be in — not configured, no property,
        access refused, no data, unavailable — says so itself.
      */}
      <SearchConsolePanel projectId={project.id} rangeId="30d" view="summary" />

      <Panel>
        <EmptyState
          icon="clock"
          title="Awaiting first crawl"
          description="This project is saved, but nothing has measured it yet. Health, traffic, keywords, issues, and the assigned team appear here once reporting data exists for it — none of it is estimated in the meantime."
          action={
            <Link href="/projects" className={buttonClasses("secondary", "md")}>
              <Icon name="arrow-left" className="h-4 w-4" />
              Back to all projects
            </Link>
          }
        />
      </Panel>
    </div>
  );
}
