"use client";

import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Meter } from "@/components/ui/meter";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { SortableHeader } from "@/components/ui/sortable-header";
import { TrendIndicator } from "@/components/ui/trend-indicator";
import { cn } from "@/lib/cn";
import { formatCompact, formatRelative } from "@/lib/format";
import {
  AgentStack,
  HEALTH_DOT,
  HEALTH_LABEL,
  HEALTH_METER,
  ProjectMonogram,
  ProjectStatusBadge,
} from "@/components/projects/project-chrome";
import { PROJECT_TYPE_META } from "@/lib/mock/projects";
import type { ProjectListItem } from "@/types/project";
import {
  SORT_OPTIONS,
  type ProjectSort,
} from "@/components/projects/sorting";

/**
 * The roster as a dense table.
 *
 * The same rows the cards show, read as a comparison instead of as a set of
 * summaries. Sorting is owned by the workspace above, so switching between the
 * two views keeps the order the user chose.
 */
export function ProjectsTable({
  projects,
  sort,
  onSort,
  referenceIso,
}: {
  projects: readonly ProjectListItem[];
  sort: { key: ProjectSort; desc: boolean };
  onSort: (key: ProjectSort) => void;
  referenceIso: string;
}) {
  return (
    <Table caption="Projects with health, traffic, keywords, and open issues">
      <TableHead>
        <TableRow>
          <SortableHeader
            label="Project"
            sortKey="name"
            options={SORT_OPTIONS}
            sort={sort}
            onSort={onSort}
          />
          <TableHeaderCell>Status</TableHeaderCell>
          <SortableHeader
            label="SEO health"
            sortKey="health"
            options={SORT_OPTIONS}
            align="right"
            sort={sort}
            onSort={onSort}
          />
          <SortableHeader
            label="Traffic"
            sortKey="traffic"
            options={SORT_OPTIONS}
            align="right"
            sort={sort}
            onSort={onSort}
          />
          <TableHeaderCell align="right">Keywords</TableHeaderCell>
          <SortableHeader
            label="Visibility"
            sortKey="visibility"
            options={SORT_OPTIONS}
            align="right"
            sort={sort}
            onSort={onSort}
          />
          <TableHeaderCell align="right">AI</TableHeaderCell>
          <SortableHeader
            label="Issues"
            sortKey="issues"
            options={SORT_OPTIONS}
            align="right"
            sort={sort}
            onSort={onSort}
          />
          <TableHeaderCell>Team</TableHeaderCell>
          <SortableHeader
            label="Updated"
            sortKey="updated"
            options={SORT_OPTIONS}
            align="right"
            sort={sort}
            onSort={onSort}
          />
          <TableHeaderCell>
            <span className="sr-only">Open</span>
          </TableHeaderCell>
        </TableRow>
      </TableHead>

      <TableBody>
        {projects.map((project) => (
          <TableRow key={project.id}>
            <TableCell header className="max-w-[280px]">
              <span className="flex items-center gap-2.5">
                <ProjectMonogram initials={project.initials} size="sm" />
                <span className="min-w-0">
                  <span className="block truncate text-fg">{project.name}</span>
                  <span className="block truncate text-[11px] font-normal text-fg-subtle">
                    {project.client} ·{" "}
                    {PROJECT_TYPE_META[project.type].label}
                  </span>
                </span>
              </span>
            </TableCell>

            <TableCell>
              <ProjectStatusBadge status={project.status} />
            </TableCell>

            <TableCell numeric>
              {!project.measured ? (
                <span className="text-fg-subtle">—</span>
              ) : (
                <span className="inline-flex items-center justify-end gap-2">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      HEALTH_DOT[project.healthState],
                    )}
                  />
                  <span className="font-medium text-fg">{project.health}</span>
                  <span className="hidden w-12 lg:block">
                    <Meter
                      size="sm"
                      value={project.health}
                      tone={HEALTH_METER[project.healthState]}
                      label={`${project.name} health: ${project.health} out of 100, ${HEALTH_LABEL[project.healthState]}`}
                    />
                  </span>
                </span>
              )}
            </TableCell>

            <TableCell numeric>
              {!project.measured ? (
                <span className="text-fg-subtle">—</span>
              ) : (
                <span className="inline-flex items-center justify-end gap-2">
                  <span className="text-fg">
                    {formatCompact(project.organicTraffic)}
                  </span>
                  <span className="hidden sm:inline-flex">
                    <TrendIndicator value={project.trafficTrend.value} />
                  </span>
                </span>
              )}
            </TableCell>

            <TableCell numeric>
              {!project.measured ? "—" : formatCompact(project.rankingKeywords)}
            </TableCell>

            <TableCell numeric>
              {!project.measured ? "—" : project.visibility.toFixed(1)}
            </TableCell>

            <TableCell numeric>
              {!project.measured ? "—" : project.aiVisibility}
            </TableCell>

            <TableCell numeric>
              {!project.measured ? (
                <span className="text-fg-subtle">—</span>
              ) : (
                <Badge
                  tone={
                    project.criticalIssues > 0
                      ? "critical"
                      : project.openIssues > 0
                        ? "warning"
                        : "positive"
                  }
                >
                  {project.openIssues}
                  {project.criticalIssues > 0 && (
                    <span className="text-[10.5px]">
                      · {project.criticalIssues} critical
                    </span>
                  )}
                </Badge>
              )}
            </TableCell>

            <TableCell>
              <AgentStack agents={project.agents} max={3} />
            </TableCell>

            <TableCell numeric className="whitespace-nowrap">
              {formatRelative(project.updatedAt, referenceIso)}
            </TableCell>

            <TableCell align="right">
              {project.href ? (
                <Link
                  href={project.href}
                  aria-label={`Open ${project.name}`}
                  className="inline-flex items-center gap-1 rounded text-[12px] font-medium whitespace-nowrap text-accent transition-colors hover:text-accent-hover"
                >
                  Open
                  <Icon name="chevron-right" className="h-3.5 w-3.5" />
                </Link>
              ) : (
                <span
                  title="The workspace opens once the first crawl has completed"
                  className="text-[11.5px] whitespace-nowrap text-fg-subtle"
                >
                  Awaiting crawl
                </span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
