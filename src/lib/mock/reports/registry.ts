/**
 * The report library and the schedules behind it.
 *
 * Two ideas do most of the work here.
 *
 * A report exists only for a period the engagement was actually running in.
 * Northgate Legal started on 24 August 2026, so it has no June report to be
 * late with — inventing one would mean inventing a month of work. Its August
 * report covers a fortnight and says so.
 *
 * `overdue` is derived, never assigned. A report is overdue when its due date
 * has passed and it is not yet approved or issued, which means the status on a
 * row cannot contradict the date beside it.
 *
 * Client contacts, names and addresses are invented fixtures on the reserved
 * `.example` domains the roster already uses. Nothing is sent to any of them.
 */
import { DATA_AS_OF, randInt } from "@/lib/mock/dashboard/core";
import { PROJECTS } from "@/lib/mock/projects/roster";
import {
  addDays,
  daysBetween,
  readinessBandFor,
  readinessScore,
  DUE_OFFSET_DAYS,
} from "@/lib/mock/reports/scoring";
import {
  AS_OF_TOLERANCE_DAYS,
  buildSections,
  type SectionContext,
} from "@/lib/mock/reports/sections";
import { getTemplate } from "@/lib/mock/reports/templates";
import type { AgentId } from "@/types/dashboard";
import type { Project } from "@/types/project";
import type {
  Cadence,
  DeliveryChannel,
  DeliveryState,
  Recipient,
  ReportPeriod,
  ReportRecord,
  ReportSchedule,
  ReportSection,
  ReportStatus,
} from "@/types/reports";

const TODAY = DATA_AS_OF.slice(0, 10);

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

/**
 * The windows reports are written about.
 *
 * Fixed literals against the reference instant the fixtures are authored for,
 * the same convention the project roster uses. A period is open when today
 * falls inside it, which is a fact about the dates rather than a flag.
 */
function period(
  id: string,
  label: string,
  start: string,
  end: string,
  cadence: Cadence,
): ReportPeriod {
  return {
    id,
    label,
    start,
    end,
    state: daysBetween(TODAY, end) >= 0 ? "open" : "closed",
    cadence,
  };
}

export const MONTHLY_PERIODS: readonly ReportPeriod[] = [
  period("2026-06", "June 2026", "2026-06-01", "2026-06-30", "monthly"),
  period("2026-07", "July 2026", "2026-07-01", "2026-07-31", "monthly"),
  period("2026-08", "August 2026", "2026-08-01", "2026-08-31", "monthly"),
  period("2026-09", "September 2026", "2026-09-01", "2026-09-30", "monthly"),
];

export const WEEKLY_PERIODS: readonly ReportPeriod[] = [
  period("2026-w34", "Week of 17 August", "2026-08-17", "2026-08-23", "weekly"),
  period("2026-w35", "Week of 24 August", "2026-08-24", "2026-08-30", "weekly"),
  period("2026-w36", "Week of 31 August", "2026-08-31", "2026-09-06", "weekly"),
  period("2026-w37", "Week of 7 September", "2026-09-07", "2026-09-13", "weekly"),
];

export const QUARTERLY_PERIODS: readonly ReportPeriod[] = [
  period("2026-q2", "Q2 2026", "2026-04-01", "2026-06-30", "quarterly"),
  period("2026-q3", "Q3 2026", "2026-07-01", "2026-09-30", "quarterly"),
];

export const ON_DEMAND_PERIOD: ReportPeriod = period(
  "audit-2026-08",
  "Audit window to 31 August",
  "2026-06-01",
  "2026-08-31",
  "on-demand",
);

const PERIODS_FOR_CADENCE: Readonly<Record<Cadence, readonly ReportPeriod[]>> = {
  monthly: MONTHLY_PERIODS,
  weekly: WEEKLY_PERIODS,
  quarterly: QUARTERLY_PERIODS,
  "on-demand": [ON_DEMAND_PERIOD],
};

// ---------------------------------------------------------------------------
// The reporting plan
// ---------------------------------------------------------------------------

/**
 * What each account is reported on.
 *
 * Written out rather than derived, because which template a client is on is a
 * commercial decision an agency makes per account, not something that follows
 * from the data. The choices track the roster: the account in recovery gets a
 * technical readout, the account whose stated goal is generative search gets
 * the AI briefing, and the two smallest engagements get the one-page brief.
 */
type Plan = {
  readonly projectId: string;
  readonly templateIds: readonly string[];
  readonly channel: DeliveryChannel;
};

const REPORTING_PLAN: readonly Plan[] = [
  {
    projectId: "halcyon-fintech",
    templateIds: ["client-monthly", "weekly-pulse", "quarterly-review"],
    channel: "email",
  },
  {
    projectId: "verdant-home",
    templateIds: ["client-monthly", "quarterly-review", "technical-readout"],
    channel: "shared-link",
  },
  {
    projectId: "fieldnote-media",
    templateIds: ["client-monthly", "weekly-pulse"],
    channel: "email",
  },
  {
    projectId: "orbit-logistics",
    templateIds: ["client-monthly", "quarterly-review"],
    channel: "email",
  },
  {
    projectId: "meridian-clinics",
    templateIds: ["executive-brief"],
    channel: "manual-handover",
  },
  {
    projectId: "skyline-outdoors",
    templateIds: ["client-monthly", "weekly-pulse"],
    channel: "shared-link",
  },
  {
    projectId: "northgate-legal",
    templateIds: ["executive-brief"],
    channel: "email",
  },
  {
    projectId: "atlas-industrial",
    templateIds: ["client-monthly", "technical-readout"],
    channel: "email",
  },
  {
    projectId: "cobalt-ridge",
    templateIds: ["client-monthly", "ai-visibility-briefing"],
    channel: "shared-link",
  },
];

// ---------------------------------------------------------------------------
// Recipients
// ---------------------------------------------------------------------------

const FIRST_NAMES = [
  "Priya",
  "Marcus",
  "Elena",
  "Tomas",
  "Nadia",
  "Callum",
  "Ingrid",
  "Rafael",
  "Saoirse",
  "Dimitri",
] as const;

const LAST_NAMES = [
  "Raman",
  "Whitfield",
  "Sorensen",
  "Okafor",
  "Lindqvist",
  "Barros",
  "Hollis",
  "Nakamura",
  "Delacroix",
  "Ferreira",
] as const;

const ROLES = [
  "Head of Marketing",
  "Marketing Director",
  "Growth Lead",
  "Commercial Director",
  "Digital Manager",
  "Chief Executive",
] as const;

function recipientsFor(project: Project): readonly Recipient[] {
  const count = randInt(project.seed, 41, 2, 3);

  return Array.from({ length: count }, (_, index) => {
    const first =
      FIRST_NAMES[randInt(project.seed, 50 + index, 0, FIRST_NAMES.length - 1)];
    const last =
      LAST_NAMES[randInt(project.seed, 70 + index, 0, LAST_NAMES.length - 1)];
    const role = ROLES[(randInt(project.seed, 90 + index, 0, 5) + index) % ROLES.length];

    return {
      name: `${first} ${last}`,
      role,
      email: `${first}.${last}@${project.domain}`.toLowerCase(),
    };
  });
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/** Who owns the report internally. Follows the audience, not the project. */
const OWNER_FOR_TEMPLATE: Readonly<Record<string, AgentId>> = {
  "client-monthly": "analytics-learning",
  "executive-brief": "project-manager",
  "weekly-pulse": "analytics-learning",
  "quarterly-review": "seo-director",
  "technical-readout": "technical-seo",
  "ai-visibility-briefing": "ai-visibility",
};

/**
 * Where a report sits in the workflow.
 *
 * An open period can only be a draft or an assembly in progress. A closed
 * period reaches a workflow state that depends on how long it has been closed
 * and on the account itself — and then the due date has the final say, because
 * a report past its date that nobody has cleared is overdue whatever anyone
 * marked it.
 */
function statusFor(
  project: Project,
  periodEntry: ReportPeriod,
  index: number,
  dueAt: string,
): ReportStatus {
  if (periodEntry.state === "open") {
    return randInt(project.seed, 110 + index, 0, 2) === 0 ? "draft" : "assembling";
  }

  const daysClosed = daysBetween(periodEntry.end, TODAY);

  // Anything closed for over a month has been through the cycle already.
  const settled: ReportStatus =
    daysClosed > 35
      ? "issued"
      : ([
          "issued",
          "approved",
          "in-review",
          "in-review",
          "approved",
        ] as const)[randInt(project.seed, 130 + index, 0, 4)];

  const overdue = daysBetween(dueAt, TODAY) > 0;
  return overdue && settled === "in-review" ? "overdue" : settled;
}

// ---------------------------------------------------------------------------
// Building a report
// ---------------------------------------------------------------------------

function buildReport(
  project: Project,
  templateId: string,
  periodEntry: ReportPeriod,
  channel: DeliveryChannel,
  index: number,
): { report: ReportRecord; sections: readonly ReportSection[] } | null {
  const template = getTemplate(templateId);
  if (!template) return null;

  const engagementStart = project.startedAt.slice(0, 10);

  // A period that ended before the engagement began is not a report we failed
  // to write — it is a period we were not working in.
  if (daysBetween(periodEntry.end, engagementStart) > 0) return null;

  const partialStart = daysBetween(periodEntry.start, engagementStart) > 0;

  // A closed period is only reportable as itself while the modules still reach
  // back that far. Past that, the figures are current readings of the right
  // shape, and the section says so rather than letting the heading imply a
  // measurement nobody took.
  const historical =
    periodEntry.state === "closed" &&
    daysBetween(periodEntry.end, TODAY) > AS_OF_TOLERANCE_DAYS[periodEntry.cadence];

  const context: SectionContext = {
    project,
    cadence: periodEntry.cadence,
    periodLabel: periodEntry.label,
    open: periodEntry.state === "open",
    partialStart,
    historical,
  };

  const sections = buildSections(template.sections, context);
  const readiness = readinessScore(sections);

  const dueAt = addDays(periodEntry.end, DUE_OFFSET_DAYS[periodEntry.cadence]);
  const status = statusFor(project, periodEntry, index, dueAt);

  // Last touched somewhere between the period closing and today, so an issued
  // report is never stamped in the future and a live one is never stale.
  const updatedAt = assembledAt(project, periodEntry, index);

  const id = `${project.id}-${template.id}-${periodEntry.id}`;

  return {
    report: {
      id,
      title: `${template.name} · ${periodEntry.label}`,
      projectId: project.id,
      projectName: project.name,
      client: project.client,
      templateId: template.id,
      templateName: template.name,
      audience: template.audience,
      period: periodEntry,
      status,
      readiness,
      band: readinessBandFor(readiness),
      sectionCount: sections.length,
      completeSections: sections.filter((entry) => entry.state === "complete")
        .length,
      partialSections: sections.filter((entry) => entry.state === "partial")
        .length,
      unavailableSections: sections.filter(
        (entry) => entry.state === "unavailable",
      ).length,
      owner: OWNER_FOR_TEMPLATE[template.id] ?? "analytics-learning",
      updatedAt,
      dueAt,
      dueInDays: daysBetween(TODAY, dueAt),
      channel,
      recipients: recipientsFor(project),
      href: `/reports/${id}`,
    },
    sections,
  };
}

/**
 * When the assembly was last refreshed.
 *
 * Never later than the reference instant, to the minute. Clamping to the date
 * alone is not enough: a working-hours stamp on today's date lands after
 * 08:45, and a relative age against the reference would then read "just now"
 * for something that has not happened yet.
 */
function assembledAt(
  project: Project,
  periodEntry: ReportPeriod,
  index: number,
): string {
  const anchor =
    periodEntry.state === "open" ? addDays(TODAY, -1) : periodEntry.end;
  const offset = randInt(project.seed, 150 + index, 1, 4);
  const candidate = addDays(anchor, offset);
  const date = daysBetween(candidate, TODAY) < 0 ? TODAY : candidate;
  const hour = String(randInt(project.seed, 170 + index, 8, 17)).padStart(2, "0");
  const minute = String(randInt(project.seed, 190 + index, 0, 11) * 5).padStart(
    2,
    "0",
  );

  const stamp = `${date}T${hour}:${minute}:00Z`;
  if (Date.parse(stamp) <= Date.parse(DATA_AS_OF)) return stamp;

  // Past the reference: pull it back to earlier the same morning.
  const earlyHour = String(randInt(project.seed, 210 + index, 6, 7)).padStart(
    2,
    "0",
  );
  const earlyMinute = String(
    randInt(project.seed, 230 + index, 0, 11) * 5,
  ).padStart(2, "0");

  return `${date}T${earlyHour}:${earlyMinute}:00Z`;
}

// ---------------------------------------------------------------------------
// The library
// ---------------------------------------------------------------------------

type Built = {
  readonly reports: readonly ReportRecord[];
  readonly sections: ReadonlyMap<string, readonly ReportSection[]>;
};

let cache: Built | null = null;

function build(): Built {
  const reports: ReportRecord[] = [];
  const sections = new Map<string, readonly ReportSection[]>();

  for (const plan of REPORTING_PLAN) {
    const project = PROJECTS.find((entry) => entry.id === plan.projectId);
    if (!project) continue;

    let index = 0;

    for (const templateId of plan.templateIds) {
      const template = getTemplate(templateId);
      if (!template) continue;

      for (const periodEntry of PERIODS_FOR_CADENCE[template.cadence]) {
        const built = buildReport(
          project,
          templateId,
          periodEntry,
          plan.channel,
          index,
        );
        index += 1;
        if (built === null) continue;

        reports.push(built.report);
        sections.set(built.report.id, built.sections);
      }
    }
  }

  // Newest period first, then by project, so the library opens on the work in
  // flight rather than on last quarter.
  reports.sort(
    (a, b) =>
      b.period.end.localeCompare(a.period.end) ||
      a.projectName.localeCompare(b.projectName) ||
      a.templateName.localeCompare(b.templateName),
  );

  return { reports, sections };
}

function built(): Built {
  cache ??= build();
  return cache;
}

export function getReports(): readonly ReportRecord[] {
  return built().reports;
}

export function getReport(id: string): ReportRecord | undefined {
  return built().reports.find((entry) => entry.id === id);
}

export function getReportSections(id: string): readonly ReportSection[] {
  return built().sections.get(id) ?? [];
}

export function getReportIds(): readonly string[] {
  return built().reports.map((entry) => entry.id);
}

export function reportsForProject(projectId: string): readonly ReportRecord[] {
  return built().reports.filter((entry) => entry.projectId === projectId);
}

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------

/** The next run of a cadence after the reference date. */
const NEXT_RUN: Readonly<Record<Cadence, string>> = {
  weekly: "2026-09-14T07:00:00Z",
  monthly: "2026-10-01T07:00:00Z",
  quarterly: "2026-10-01T07:00:00Z",
  "on-demand": "2026-10-01T07:00:00Z",
};

/**
 * What a schedule will do at its next run, and why.
 *
 * Every state here is derived from the account and from the reports the
 * schedule has already produced. A schedule is blocked when it cannot fill
 * enough of its template to be worth preparing — which is a fact about the
 * data, not a flag someone set.
 */
function scheduleState(
  project: Project,
  latest: ReportRecord | undefined,
): { state: DeliveryState; blockedReason: string | null } {
  if (project.status === "paused") {
    return {
      state: "paused",
      blockedReason: "The engagement is paused. No runs until it resumes.",
    };
  }

  if (latest !== undefined && latest.band === "not-ready") {
    return {
      state: "blocked",
      blockedReason: `Only ${latest.completeSections} of ${latest.sectionCount} sections can be filled for this account, so a prepared report would be mostly empty headings.`,
    };
  }

  if (latest !== undefined && latest.dueInDays < 0) {
    return { state: "ready-to-prepare", blockedReason: null };
  }

  return { state: "scheduled", blockedReason: null };
}

let scheduleCache: readonly ReportSchedule[] | null = null;

function buildSchedules(): readonly ReportSchedule[] {
  const schedules: ReportSchedule[] = [];

  for (const plan of REPORTING_PLAN) {
    const project = PROJECTS.find((entry) => entry.id === plan.projectId);
    if (!project) continue;

    for (const templateId of plan.templateIds) {
      const template = getTemplate(templateId);
      if (!template) continue;

      // On-demand templates are prepared when asked for. A schedule would be
      // a standing arrangement, which is the opposite of what they are.
      if (template.cadence === "on-demand") continue;

      const produced = built()
        .reports.filter(
          (entry) =>
            entry.projectId === project.id && entry.templateId === template.id,
        )
        .filter((entry) => entry.period.state === "closed");

      const latest = produced[0];
      const { state, blockedReason } = scheduleState(project, latest);

      schedules.push({
        id: `${project.id}-${template.id}-schedule`,
        projectId: project.id,
        projectName: project.name,
        templateId: template.id,
        templateName: template.name,
        cadence: template.cadence,
        channel: plan.channel,
        state,
        nextRunAt: NEXT_RUN[template.cadence],
        lastPreparedAt: latest?.updatedAt ?? null,
        recipients: recipientsFor(project),
        owner: OWNER_FOR_TEMPLATE[template.id] ?? "analytics-learning",
        blockedReason,
      });
    }
  }

  return schedules.sort(
    (a, b) =>
      a.nextRunAt.localeCompare(b.nextRunAt) ||
      a.projectName.localeCompare(b.projectName) ||
      a.templateName.localeCompare(b.templateName),
  );
}

export function getSchedules(): readonly ReportSchedule[] {
  scheduleCache ??= buildSchedules();
  return scheduleCache;
}

export function schedulesForProject(
  projectId: string,
): readonly ReportSchedule[] {
  return getSchedules().filter((entry) => entry.projectId === projectId);
}

/** Projects with any reporting configured, for the project filter. */
export function getReportProjectOptions(): readonly {
  readonly id: string;
  readonly name: string;
}[] {
  const active = new Set(getReports().map((entry) => entry.projectId));
  return PROJECTS.filter((project) => active.has(project.id)).map((project) => ({
    id: project.id,
    name: project.name,
  }));
}
