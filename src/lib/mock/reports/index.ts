/**
 * The public surface of the Reports module.
 *
 * Everything the screens read comes through this file, so the components never
 * reach into a fixture directly and the dependency direction stays one way:
 * `reports/*` reads Analytics, Technical SEO, Keyword Intelligence, Content
 * Studio, AI Visibility, Backlinks, Competitor Intelligence, AI Agents and the
 * project roster. None of them reads this module.
 *
 * The two integration strips on the Command Center and the project workspace
 * read back from the *component* layer rather than from here, which is the
 * same convention Phases 9, 10 and 11 established and the reason no import
 * cycle closes.
 */
import type { MetricTileData } from "@/components/ui/metric-tile";
import { formatNumber } from "@/lib/format";
import { DATA_AS_OF } from "@/lib/mock/dashboard";
import { PROJECTS } from "@/lib/mock/projects/roster";
import {
  BAND_META,
  BAND_ORDER,
  SECTION_META,
  SECTION_STATE_META,
  SECTION_STATE_ORDER,
  STATUS_META,
  STATUS_ORDER,
} from "@/lib/mock/reports/meta";
import {
  getReport,
  getReportSections,
  getReports,
  getSchedules,
  reportsForProject,
  schedulesForProject,
} from "@/lib/mock/reports/registry";
import {
  daysBetween,
  readinessBandFor,
  reportPriority,
} from "@/lib/mock/reports/scoring";
import { getTemplate, getReportTemplates } from "@/lib/mock/reports/templates";
import { RANGE_FOR_CADENCE } from "@/lib/mock/reports/sections";
import type {
  ProjectCoverage,
  ReadinessBand,
  ReportDetail,
  ReportDistributionRow,
  ReportRecord,
  ReportSchedule,
  ReportsDatasetCounts,
  ReportsOverview,
  SectionKind,
} from "@/types/reports";

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export {
  AUDIENCE_META,
  AUDIENCE_ORDER,
  BAND_META,
  BAND_ORDER,
  CADENCE_META,
  CADENCE_ORDER,
  CHANNEL_META,
  CHANNEL_ORDER,
  DELIVERY_NOTE,
  DELIVERY_NOTE_SHORT,
  DELIVERY_STATE_META,
  DELIVERY_STATE_ORDER,
  EXPORT_FORMATS,
  EXPORT_META,
  EXPORT_NOTE,
  PROVENANCE_META,
  REPORTS_SOURCE_NOTE,
  REPORTS_SOURCE_SHORT,
  REPORT_BRAND,
  SECTION_META,
  SECTION_ORDER,
  SECTION_STATE_META,
  SECTION_STATE_ORDER,
  STATUS_META,
  STATUS_ORDER,
} from "@/lib/mock/reports/meta";

export {
  READINESS_BANDS,
  SECTION_VALUE,
  SECTION_WEIGHT,
  daysBetween,
  readinessBandFor,
  readinessScore,
  reportPriority,
} from "@/lib/mock/reports/scoring";

export {
  MONTHLY_PERIODS,
  QUARTERLY_PERIODS,
  WEEKLY_PERIODS,
  getReport,
  getReportIds,
  getReportProjectOptions,
  getReportSections,
  getReports,
  getSchedules,
  reportsForProject,
  schedulesForProject,
} from "@/lib/mock/reports/registry";

export {
  REPORT_TEMPLATES,
  getReportTemplates,
  getTemplate,
} from "@/lib/mock/reports/templates";

export {
  exportFilename,
  renderExport,
  toCsv,
  toHtml,
  toJson,
  toMarkdown,
} from "@/lib/mock/reports/export";

export { RANGE_FOR_CADENCE } from "@/lib/mock/reports/sections";

/** The reference instant every report is dated against. */
export const REPORTS_AS_OF = DATA_AS_OF;

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

/**
 * One report, assembled.
 *
 * The sections were composed when the library was built, so opening a report
 * costs a lookup rather than a re-read of nine modules — and, more usefully,
 * the readiness on the row and the sections on the page are guaranteed to be
 * the same assembly rather than two runs of the same builder.
 */
export function getReportDetail(id: string): ReportDetail | null {
  const report = getReport(id);
  if (!report) return null;

  const template = getTemplate(report.templateId);
  if (!template) return null;

  const sections = getReportSections(id);

  const sources = [
    ...new Map(
      sections
        .filter((section) => section.state !== "unavailable")
        .map((section) => [
          section.sourceLabel,
          {
            label: section.sourceLabel,
            href: section.sourceHref,
            note: SECTION_META[section.kind].description,
          },
        ]),
    ).values(),
  ];

  return {
    report,
    template,
    sections,
    subtitle: subtitleFor(report),
    sources,
  };
}

/** The line under the title, in every format this report is written out as. */
function subtitleFor(report: ReportRecord): string {
  const window =
    report.period.state === "open"
      ? `${report.period.label}, to date`
      : report.period.label;

  const completeness =
    report.unavailableSections > 0
      ? ` ${report.unavailableSections} of ${report.sectionCount} sections had nothing in scope to report and are marked as such.`
      : report.partialSections > 0
        ? ` ${report.partialSections} of ${report.sectionCount} sections cover a shorter window than the heading implies, and say so.`
        : "";

  return `${report.templateName} for ${report.client}, covering ${window}. Every figure is quoted from the module that publishes it.${completeness}`;
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function tally<T extends string>(values: readonly T[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return result;
}

function distribution<T extends string>(
  order: readonly T[],
  counts: Record<string, number>,
  meta: Readonly<
    Record<T, { label: string; tone: ReportDistributionRow["tone"]; description: string }>
  >,
  total: number,
): readonly ReportDistributionRow[] {
  return order
    .filter((key) => (counts[key] ?? 0) > 0)
    .map((key) => ({
      id: key,
      label: meta[key].label,
      count: counts[key] ?? 0,
      share: total === 0 ? 0 : Math.round(((counts[key] ?? 0) / total) * 100),
      tone: meta[key].tone,
      description: meta[key].description,
    }));
}

function meanOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return Math.round(
    values.reduce((carry, value) => carry + value, 0) / values.length,
  );
}

/** Reports in scope. `"portfolio"` means every project. */
function scopedReports(projectId: string): readonly ReportRecord[] {
  return projectId === "portfolio" ? getReports() : reportsForProject(projectId);
}

function scopedSchedules(projectId: string): readonly ReportSchedule[] {
  return projectId === "portfolio"
    ? getSchedules()
    : schedulesForProject(projectId);
}

/**
 * How each project's reporting stands.
 *
 * Built over the roster rather than over the reports, so a project with no
 * reporting configured appears as a row with zeroes instead of vanishing —
 * which is the coverage question this table exists to answer.
 */
export function getCoverage(projectId: string): readonly ProjectCoverage[] {
  const projects =
    projectId === "portfolio"
      ? PROJECTS
      : PROJECTS.filter((project) => project.id === projectId);

  return projects
    .map((project) => {
      const reports = reportsForProject(project.id);
      const schedules = schedulesForProject(project.id);
      const readiness = meanOf(reports.map((entry) => entry.readiness));

      const due = reports
        .filter((entry) => entry.dueInDays >= 0)
        .map((entry) => entry.dueAt)
        .sort();

      return {
        projectId: project.id,
        projectName: project.name,
        client: project.client,
        reports: reports.length,
        scheduled: schedules.length,
        cadence: schedules[0]?.cadence ?? null,
        readiness,
        band: readinessBandFor(readiness),
        overdue: reports.filter((entry) => entry.status === "overdue").length,
        nextDueAt: due[0] ?? null,
        href: `/projects/${project.id}`,
      };
    })
    .sort(
      (a, b) =>
        b.overdue - a.overdue ||
        a.readiness - b.readiness ||
        a.projectName.localeCompare(b.projectName),
    );
}

/**
 * Section kinds that could not be filled anywhere in scope.
 *
 * Worth surfacing on the overview rather than leaving to be discovered one
 * report at a time: a section that is unavailable across the portfolio is a
 * gap in what the product covers, not a gap in one client's month.
 */
function blockedSections(reports: readonly ReportRecord[]): ReportsOverview["blocked"] {
  const counts = new Map<SectionKind, number>();

  for (const report of reports) {
    for (const section of getReportSections(report.id)) {
      if (section.state !== "unavailable") continue;
      counts.set(section.kind, (counts.get(section.kind) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([kind, count]) => ({
      kind,
      count,
      reason: `Nothing in ${SECTION_META[kind].source} covers the accounts asking for this section.`,
    }))
    .sort((a, b) => b.count - a.count);
}

export function getReportsOverview(projectId: string): ReportsOverview {
  const reports = scopedReports(projectId);
  const schedules = scopedSchedules(projectId);

  const sectionStates = reports.flatMap((report) =>
    getReportSections(report.id).map((section) => section.state),
  );

  const meanReadiness = meanOf(reports.map((entry) => entry.readiness));

  const overdue = [...reports]
    .filter((entry) => entry.status === "overdue")
    .sort((a, b) => a.dueInDays - b.dueInDays);

  const upcoming = [...reports]
    .filter((entry) => entry.status !== "overdue" && entry.status !== "issued")
    .sort(
      (a, b) =>
        reportPriority(b) - reportPriority(a) || a.id.localeCompare(b.id),
    )
    .slice(0, 6);

  return {
    reports,
    schedules,
    coverage: getCoverage(projectId),
    statusRows: distribution(
      STATUS_ORDER,
      tally(reports.map((entry) => entry.status)),
      STATUS_META,
      reports.length,
    ),
    readinessRows: distribution(
      BAND_ORDER,
      tally(reports.map((entry) => entry.band)),
      BAND_META,
      reports.length,
    ),
    sectionRows: distribution(
      SECTION_STATE_ORDER,
      tally(sectionStates),
      SECTION_STATE_META,
      sectionStates.length,
    ),
    overdue,
    upcoming,
    meanReadiness,
    band: readinessBandFor(meanReadiness),
    blocked: blockedSections(reports),
  };
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/** The tiles above the workspace. */
export function getReportMetrics(
  overview: ReportsOverview,
): readonly MetricTileData[] {
  const { reports, schedules } = overview;

  const live = reports.filter(
    (entry) => entry.status !== "issued" && entry.status !== "overdue",
  ).length;

  const dueSoon = reports.filter(
    (entry) => entry.dueInDays >= 0 && entry.dueInDays <= 7,
  ).length;

  const blockedRuns = schedules.filter(
    (entry) => entry.state === "blocked" || entry.state === "paused",
  ).length;

  const ready = reports.filter((entry) => entry.band === "ready").length;

  return [
    {
      id: "reports",
      label: "Reports in the library",
      value: formatNumber(reports.length),
      detail: `${live} still in flight, ${reports.length - live} closed out.`,
      icon: "reports",
    },
    {
      id: "readiness",
      label: "Mean completeness",
      value: `${overview.meanReadiness}`,
      unit: "/ 100",
      detail: BAND_META[overview.band].description,
      icon: "gauge",
      health: healthForBand(overview.band),
    },
    {
      id: "ready",
      label: "Ready to go out",
      value: formatNumber(ready),
      detail: "Every section a client would notice is filled.",
      icon: "check",
      health: ready > 0 ? "positive" : "neutral",
    },
    {
      id: "overdue",
      label: "Overdue",
      value: formatNumber(overview.overdue.length),
      detail:
        overview.overdue.length === 0
          ? "Nothing past its date without a decision on it."
          : "Past the due date and not yet approved or issued.",
      icon: "alert",
      health: overview.overdue.length > 0 ? "negative" : "positive",
    },
    {
      id: "due-soon",
      label: "Due within a week",
      value: formatNumber(dueSoon),
      detail: "Counted from the reference date, not from today.",
      icon: "calendar",
      health: dueSoon > 3 ? "warning" : "neutral",
    },
    {
      id: "schedules",
      label: "Schedules configured",
      value: formatNumber(schedules.length),
      detail: `${blockedRuns} blocked or paused. Schedules prepare; they do not send.`,
      icon: "clock",
      health: blockedRuns > 0 ? "warning" : "neutral",
    },
    {
      id: "sections",
      label: "Sections composed",
      value: formatNumber(
        reports.reduce((carry, entry) => carry + entry.sectionCount, 0),
      ),
      detail: `${reports.reduce((carry, entry) => carry + entry.unavailableSections, 0)} had nothing in scope to report.`,
      icon: "layers",
    },
    {
      id: "recipients",
      label: "Client contacts",
      value: formatNumber(
        new Set(
          reports.flatMap((entry) =>
            entry.recipients.map((person) => person.email),
          ),
        ).size,
      ),
      detail: "Who each report is written for. Nothing is transmitted.",
      icon: "user",
    },
  ];
}

function healthForBand(band: ReadinessBand): MetricTileData["health"] {
  return band === "ready"
    ? "positive"
    : band === "nearly"
      ? "neutral"
      : band === "thin"
        ? "warning"
        : "negative";
}

// ---------------------------------------------------------------------------
// Snapshot, for the Command Center and the project workspace
// ---------------------------------------------------------------------------

/**
 * The figures both integration strips read.
 *
 * Published from here so the reporting line on the dashboard and the same
 * figure inside this module are one reading rather than two. `"portfolio"`
 * means every project.
 */
export type ReportsSnapshotCounts = {
  readonly reports: number;
  readonly schedules: number;
  readonly readiness: number;
  readonly band: ReadinessBand;
  readonly overdue: number;
  readonly dueSoon: number;
  readonly ready: number;
  readonly blockedRuns: number;
  readonly unavailableSections: number;
  /** The one to open next, or null where there is nothing outstanding. */
  readonly next: ReportRecord | null;
  readonly nextSchedule: ReportSchedule | null;
};

export function getReportsSnapshotCounts(
  projectId: string,
): ReportsSnapshotCounts {
  const reports = scopedReports(projectId);
  const schedules = scopedSchedules(projectId);
  const readiness = meanOf(reports.map((entry) => entry.readiness));

  const outstanding = [...reports]
    .filter((entry) => entry.status !== "issued")
    .sort(
      (a, b) =>
        reportPriority(b) - reportPriority(a) || a.id.localeCompare(b.id),
    );

  return {
    reports: reports.length,
    schedules: schedules.length,
    readiness,
    band: readinessBandFor(readiness),
    overdue: reports.filter((entry) => entry.status === "overdue").length,
    dueSoon: reports.filter(
      (entry) => entry.dueInDays >= 0 && entry.dueInDays <= 7,
    ).length,
    ready: reports.filter((entry) => entry.band === "ready").length,
    blockedRuns: schedules.filter(
      (entry) => entry.state === "blocked" || entry.state === "paused",
    ).length,
    unavailableSections: reports.reduce(
      (carry, entry) => carry + entry.unavailableSections,
      0,
    ),
    next: outstanding[0] ?? null,
    nextSchedule:
      [...schedules].sort((a, b) =>
        a.nextRunAt.localeCompare(b.nextRunAt),
      )[0] ?? null,
  };
}

// ---------------------------------------------------------------------------
// Development inspector
// ---------------------------------------------------------------------------

/**
 * Counts and an integrity pass, for `/dev/data`.
 *
 * Every finding the pass can return is a way this module could contradict the
 * modules it quotes, leak one project's work into another's report, or make a
 * claim the product has no right to make. An empty list is the passing result.
 */
export function getReportsDatasetCounts(): ReportsDatasetCounts {
  const reports = getReports();
  const schedules = getSchedules();
  const templates = getReportTemplates();
  const integrity: string[] = [];

  const ids = new Set(reports.map((entry) => entry.id));
  if (ids.size !== reports.length) {
    integrity.push("Duplicate report id.");
  }

  const scheduleIds = new Set(schedules.map((entry) => entry.id));
  if (scheduleIds.size !== schedules.length) {
    integrity.push("Duplicate schedule id.");
  }

  const projectIds = new Set<string>(PROJECTS.map((project) => project.id));
  const templateIds = new Set(templates.map((entry) => entry.id));

  let sections = 0;
  const sectionStates: string[] = [];

  for (const report of reports) {
    if (!projectIds.has(report.projectId)) {
      integrity.push(`${report.id}: unknown project ${report.projectId}.`);
    }
    if (!templateIds.has(report.templateId)) {
      integrity.push(`${report.id}: unknown template ${report.templateId}.`);
    }

    const template = getTemplate(report.templateId);
    const composed = getReportSections(report.id);
    sections += composed.length;

    for (const section of composed) {
      sectionStates.push(section.state);

      // A section must belong to the template that asked for it, and it must
      // be scoped to this report's project — a section carrying another
      // project's id would put one client's figures in another's report.
      if (template && !template.sections.includes(section.kind)) {
        integrity.push(
          `${report.id}: section ${section.kind} is not in template ${template.id}.`,
        );
      }
      if (!section.id.startsWith(`${report.projectId}-`)) {
        integrity.push(
          `${report.id}: section ${section.kind} is not scoped to ${report.projectId}.`,
        );
      }
      if (
        section.sourceHref !== null &&
        !section.sourceHref.includes(report.projectId)
      ) {
        integrity.push(
          `${report.id}: section ${section.kind} links outside its project.`,
        );
      }
      if (section.state === "unavailable" && section.figures.length > 0) {
        integrity.push(
          `${report.id}: section ${section.kind} is unavailable but carries figures.`,
        );
      }
      if (section.state !== "complete" && section.caveat === null) {
        integrity.push(
          `${report.id}: section ${section.kind} is ${section.state} without a reason.`,
        );
      }
    }

    if (composed.length !== report.sectionCount) {
      integrity.push(`${report.id}: section count disagrees with the assembly.`);
    }

    // Readiness has to agree with the sections it was scored over.
    if (
      report.completeSections +
        report.partialSections +
        report.unavailableSections !==
      report.sectionCount
    ) {
      integrity.push(`${report.id}: section states do not sum to the total.`);
    }
    if (report.band !== readinessBandFor(report.readiness)) {
      integrity.push(`${report.id}: band disagrees with readiness.`);
    }

    // The workflow cannot contradict the calendar.
    if (report.status === "overdue" && report.dueInDays >= 0) {
      integrity.push(`${report.id}: marked overdue but not past its due date.`);
    }
    if (
      report.dueInDays < 0 &&
      (report.status === "draft" || report.status === "assembling")
    ) {
      integrity.push(`${report.id}: past due while still assembling.`);
    }
    if (report.period.state === "open" && report.status === "issued") {
      integrity.push(`${report.id}: issued while its period is still open.`);
    }

    // Nothing is dated after the instant the dataset describes — to the
    // minute, not to the day: a stamp later the same afternoon would read as
    // having happened before it did.
    if (Date.parse(report.updatedAt) > Date.parse(REPORTS_AS_OF)) {
      integrity.push(`${report.id}: assembled in the future.`);
    }

    // A report for a period the engagement was not running in would be a
    // month of work invented out of nothing.
    const project = PROJECTS.find((entry) => entry.id === report.projectId);
    if (
      project &&
      daysBetween(report.period.end, project.startedAt.slice(0, 10)) > 0
    ) {
      integrity.push(`${report.id}: covers a period before the engagement.`);
    }

    if (report.recipients.length === 0) {
      integrity.push(`${report.id}: no recipient on a client report.`);
    }
  }

  for (const schedule of schedules) {
    if (!projectIds.has(schedule.projectId)) {
      integrity.push(`${schedule.id}: unknown project.`);
    }
    if (schedule.state === "blocked" && schedule.blockedReason === null) {
      integrity.push(`${schedule.id}: blocked without a reason.`);
    }
    if (schedule.state === "paused" && schedule.blockedReason === null) {
      integrity.push(`${schedule.id}: paused without a reason.`);
    }
    if (daysBetween(REPORTS_AS_OF.slice(0, 10), schedule.nextRunAt.slice(0, 10)) < 0) {
      integrity.push(`${schedule.id}: next run is in the past.`);
    }
  }

  // Templates are a reading order, not a data model: a template asking for a
  // section no builder knows about would print an empty heading.
  const known = new Set(Object.keys(SECTION_META));
  for (const template of templates) {
    for (const kind of template.sections) {
      if (!known.has(kind)) {
        integrity.push(`${template.id}: unknown section ${kind}.`);
      }
    }
    if (template.sections.length === 0) {
      integrity.push(`${template.id}: template with no sections.`);
    }
  }

  return {
    templates: templates.length,
    reports: reports.length,
    schedules: schedules.length,
    sections,
    recipients: new Set(
      reports.flatMap((entry) => entry.recipients.map((person) => person.email)),
    ).size,
    projects: new Set(reports.map((entry) => entry.projectId)).size,
    byStatus: tally(reports.map((entry) => entry.status)),
    byState: tally(sectionStates),
    byBand: tally(reports.map((entry) => entry.band)),
    byDelivery: tally(schedules.map((entry) => entry.state)),
    integrity,
  };
}

/** The analytics window each cadence quotes, for the methodology panel. */
export function getCadenceWindows(): readonly {
  readonly cadence: string;
  readonly range: string;
}[] {
  return Object.entries(RANGE_FOR_CADENCE).map(([cadence, range]) => ({
    cadence,
    range,
  }));
}
