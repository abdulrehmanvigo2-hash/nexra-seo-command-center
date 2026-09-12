import type {
  Cadence,
  ProjectCoverage,
  ReadinessBand,
  ReportAudience,
  ReportRecord,
  ReportSchedule,
  ReportTemplate,
} from "@/types/reports";

/**
 * Filtering for Reports.
 *
 * One filter object across four record shapes — reports, schedules, templates
 * and coverage rows. Somebody who narrows to monthly cadence expects the
 * schedule tab to narrow with the library, so they share a state object.
 *
 * The project lives outside this object, on the workspace, because it is the
 * selection rather than a narrowing of it: changing it rebuilds every count on
 * the screen.
 */

export type ReportFilters = {
  /** Matched against title, client, template and project text. */
  readonly query: string;
  readonly status: ReportRecord["status"] | "all";
  readonly band: ReadinessBand | "all";
  readonly audience: ReportAudience | "all";
  readonly cadence: Cadence | "all";
  readonly templateId: string | "all";
  /** Narrows to reports still needing a decision — the working queue. */
  readonly outstandingOnly: boolean;
};

export const EMPTY_REPORT_FILTERS: ReportFilters = {
  query: "",
  status: "all",
  band: "all",
  audience: "all",
  cadence: "all",
  templateId: "all",
  outstandingOnly: false,
};

const COUNTED: readonly (keyof ReportFilters)[] = [
  "status",
  "band",
  "audience",
  "cadence",
  "templateId",
];

export function activeReportFilterCount(filters: ReportFilters): number {
  return (
    COUNTED.filter((key) => filters[key] !== "all").length +
    (filters.outstandingOnly ? 1 : 0)
  );
}

export function hasActiveReportFilters(filters: ReportFilters): boolean {
  return (
    filters.query.trim().length > 0 || activeReportFilterCount(filters) > 0
  );
}

function matches(haystack: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  return haystack.toLowerCase().includes(needle);
}

/** A report still needing a decision: not issued, and not already approved. */
export function isOutstanding(report: ReportRecord): boolean {
  return report.status !== "issued" && report.status !== "approved";
}

export function matchesReport(
  report: ReportRecord,
  filters: ReportFilters,
): boolean {
  if (filters.status !== "all" && report.status !== filters.status) return false;
  if (filters.band !== "all" && report.band !== filters.band) return false;
  if (filters.audience !== "all" && report.audience !== filters.audience) {
    return false;
  }
  if (filters.cadence !== "all" && report.period.cadence !== filters.cadence) {
    return false;
  }
  if (filters.templateId !== "all" && report.templateId !== filters.templateId) {
    return false;
  }
  if (filters.outstandingOnly && !isOutstanding(report)) return false;

  return matches(
    `${report.title} ${report.projectName} ${report.client} ${report.templateName} ${report.period.label}`,
    filters.query,
  );
}

export function matchesSchedule(
  schedule: ReportSchedule,
  filters: ReportFilters,
): boolean {
  if (filters.cadence !== "all" && schedule.cadence !== filters.cadence) {
    return false;
  }
  if (filters.templateId !== "all" && schedule.templateId !== filters.templateId) {
    return false;
  }
  return matches(
    `${schedule.projectName} ${schedule.templateName} ${schedule.recipients
      .map((person) => `${person.name} ${person.role}`)
      .join(" ")}`,
    filters.query,
  );
}

export function matchesTemplate(
  template: ReportTemplate,
  filters: ReportFilters,
): boolean {
  if (filters.audience !== "all" && template.audience !== filters.audience) {
    return false;
  }
  if (filters.cadence !== "all" && template.cadence !== filters.cadence) {
    return false;
  }
  if (filters.templateId !== "all" && template.id !== filters.templateId) {
    return false;
  }
  return matches(`${template.name} ${template.description}`, filters.query);
}

export function matchesCoverage(
  row: ProjectCoverage,
  filters: ReportFilters,
): boolean {
  if (filters.band !== "all" && row.band !== filters.band) return false;
  if (filters.cadence !== "all" && row.cadence !== filters.cadence) return false;
  return matches(`${row.projectName} ${row.client}`, filters.query);
}
