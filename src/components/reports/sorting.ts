import { reportPriority } from "@/lib/mock/reports";
import type { ProjectCoverage, ReportRecord } from "@/types/reports";

/**
 * Ordering for the report tables.
 *
 * Two sets of keys, one per table shape, kept beside the workspace rather than
 * inside the tables because a sort has to survive a filter change, a page
 * change and a tab change.
 *
 * Every key sorts both directions, and ties break on id the same way whichever
 * way the column points, so equal rows do not reshuffle when a reader flips the
 * arrow to look at the other end.
 */

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export type ReportSort =
  | "priority"
  | "due"
  | "readiness"
  | "period"
  | "updated"
  | "project"
  | "title";

export const REPORT_SORT_OPTIONS: readonly {
  readonly value: ReportSort;
  readonly label: string;
  /** The direction most people want first. */
  readonly desc: boolean;
}[] = [
  { value: "priority", label: "What to open next", desc: true },
  { value: "due", label: "Due date", desc: false },
  { value: "readiness", label: "Completeness", desc: true },
  { value: "period", label: "Period", desc: true },
  { value: "updated", label: "Last assembled", desc: true },
  { value: "project", label: "Project", desc: false },
  { value: "title", label: "Title", desc: false },
];

export function compareReports(
  a: ReportRecord,
  b: ReportRecord,
  sort: { key: ReportSort; desc: boolean },
): number {
  const direction = sort.desc ? -1 : 1;

  if (sort.key === "period" || sort.key === "updated") {
    const read = sort.key === "period" ? "period" : "updated";
    const left = read === "period" ? a.period.end : a.updatedAt;
    const right = read === "period" ? b.period.end : b.updatedAt;
    return left.localeCompare(right) * direction || a.id.localeCompare(b.id);
  }

  if (sort.key === "project" || sort.key === "title") {
    const left = sort.key === "project" ? a.projectName : a.title;
    const right = sort.key === "project" ? b.projectName : b.title;
    return left.localeCompare(right) * direction || a.id.localeCompare(b.id);
  }

  const read: Record<
    Extract<ReportSort, "priority" | "due" | "readiness">,
    (report: ReportRecord) => number
  > = {
    priority: reportPriority,
    due: (report) => report.dueInDays,
    readiness: (report) => report.readiness,
  };

  return (
    (read[sort.key](a) - read[sort.key](b)) * direction ||
    a.id.localeCompare(b.id)
  );
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

export type CoverageSort =
  | "overdue"
  | "readiness"
  | "reports"
  | "scheduled"
  | "project";

export const COVERAGE_SORT_OPTIONS: readonly {
  readonly value: CoverageSort;
  readonly label: string;
  readonly desc: boolean;
}[] = [
  { value: "overdue", label: "Overdue", desc: true },
  { value: "readiness", label: "Mean completeness", desc: false },
  { value: "reports", label: "Reports", desc: true },
  { value: "scheduled", label: "Schedules", desc: true },
  { value: "project", label: "Project", desc: false },
];

export function compareCoverage(
  a: ProjectCoverage,
  b: ProjectCoverage,
  sort: { key: CoverageSort; desc: boolean },
): number {
  const direction = sort.desc ? -1 : 1;

  if (sort.key === "project") {
    return (
      a.projectName.localeCompare(b.projectName) * direction ||
      a.projectId.localeCompare(b.projectId)
    );
  }

  const read: Record<
    Exclude<CoverageSort, "project">,
    (row: ProjectCoverage) => number
  > = {
    overdue: (row) => row.overdue,
    readiness: (row) => row.readiness,
    reports: (row) => row.reports,
    scheduled: (row) => row.scheduled,
  };

  return (
    (read[sort.key](a) - read[sort.key](b)) * direction ||
    a.projectId.localeCompare(b.projectId)
  );
}
