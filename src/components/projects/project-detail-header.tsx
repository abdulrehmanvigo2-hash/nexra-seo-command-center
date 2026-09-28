"use client";

import Link from "next/link";
import { Icon, type IconName } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import {
  ProjectMonogram,
  ProjectStatusBadge,
} from "@/components/projects/project-chrome";
import { formatFullDate, formatRelative } from "@/lib/format";
import { DATE_RANGES } from "@/lib/mock/dashboard";
import { PROJECT_GOAL_META, PROJECT_TYPE_META } from "@/lib/mock/projects";
import type { RangeId } from "@/types/dashboard";
import type { Project, ProjectSettings } from "@/types/project";
import { ModelledBadge } from "@/components/ui/modelled-badge";

/**
 * The project workspace header: who the client is, what state the engagement
 * is in, and the window everything below is measured over.
 *
 * Reads the live settings rather than the fixture record, so an edit saved on
 * the settings tab is visible here immediately — which is the only way a
 * frontend-only save can honestly show that it did something.
 */
export function ProjectDetailHeader({
  project,
  settings,
  range,
  onRangeChange,
  generatedAt,
  analysisQueued,
  onRunAnalysis,
}: {
  project: Project;
  settings: ProjectSettings;
  range: RangeId;
  onRangeChange: (range: RangeId) => void;
  /** ISO instant the fixtures represent. */
  generatedAt: string;
  analysisQueued: boolean;
  onRunAnalysis: () => void;
}) {
  const facts: readonly { icon: IconName; label: string; value: string }[] = [
    { icon: "briefcase", label: "Client", value: settings.client },
    { icon: "layers", label: "Industry", value: settings.industry },
    { icon: "map-pin", label: "Market", value: settings.market },
    { icon: "globe", label: "Language", value: settings.language },
    {
      icon: PROJECT_TYPE_META[project.type].icon,
      label: "Type",
      value: PROJECT_TYPE_META[project.type].label,
    },
    {
      icon: PROJECT_GOAL_META[settings.goal].icon,
      label: "Main goal",
      value: PROJECT_GOAL_META[settings.goal].label,
    },
    {
      icon: "target",
      label: "Target location",
      value: project.targetLocation,
    },
    {
      icon: "calendar",
      label: "Engagement started",
      value: formatFullDate(project.startedAt),
    },
  ];

  return (
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
          <li className="truncate text-fg-muted">{settings.name}</li>
        </ol>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4 px-4 pt-3 pb-4 sm:px-5">
        <div className="flex min-w-0 items-start gap-3.5">
          <ProjectMonogram
            initials={project.initials}
            size="lg"
            className="mt-0.5 hidden sm:flex"
          />

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-[20px] leading-tight font-semibold tracking-tight text-fg">
                {settings.name}
              </h2>
              <ProjectStatusBadge status={settings.status} />
              <ModelledBadge />
            </div>

            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-fg-muted">
              <span className="inline-flex items-center gap-1.5 font-mono text-[11.5px] text-fg-subtle">
                <Icon name="globe" className="h-3.5 w-3.5" />
                {settings.domain}
              </span>
              <span aria-hidden="true">·</span>
              <span>{settings.client}</span>
            </p>

            <p className="mt-2 max-w-2xl text-[12.5px] leading-relaxed text-fg-muted">
              {project.summary}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button variant="primary" icon="bolt" onClick={onRunAnalysis}>
            Run SEO Analysis
          </Button>
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

      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 border-t border-border px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium tracking-[0.03em] text-fg-subtle uppercase">
            <Icon name="calendar" className="h-3.5 w-3.5" />
            Date range
          </span>
          <Segmented
            label="Date range"
            value={range}
            onChange={onRangeChange}
            options={DATE_RANGES.map((entry) => ({
              value: entry.id,
              label: entry.label,
              title: entry.caption,
            }))}
          />
        </div>

        <p
          aria-live="polite"
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-fg-subtle"
        >
          {analysisQueued ? (
            <span className="inline-flex items-center gap-1.5 text-positive">
              <Icon name="check" className="h-3.5 w-3.5" />
              Analysis simulated — no agent run was started
            </span>
          ) : (
            <>
              <Icon name="clock" className="h-3.5 w-3.5" />
              <span>
                Updated {formatRelative(project.updatedAt, generatedAt)}
              </span>
              <span aria-hidden="true">·</span>
              <span>Mock data</span>
            </>
          )}
        </p>
      </div>
    </section>
  );
}
