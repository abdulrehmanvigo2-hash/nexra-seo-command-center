/**
 * Shapes for the Reports module (CLAUDE.md §14, Phase 12).
 *
 * Reports are the one module in this product that owns almost no numbers. A
 * report is an arrangement of figures other modules already publish, cut to a
 * period and an audience — so the vocabulary here is about assembly, state and
 * delivery, not about measurement.
 *
 * Two deliberate absences, both load-bearing:
 *
 * `ReportProvenance` has no `measured` member. Nothing in a report is closer
 * to observed reality than the module it was quoted from, and every one of
 * those modules already says what it is.
 *
 * `DeliveryState` has no `sent` member. No mail provider, client portal, or
 * webhook is connected (CLAUDE.md §4), so a report cannot leave this machine
 * except through a file the user downloads. Offering the state would mean
 * offering a status the product can never truthfully reach.
 */
import type { IconName } from "@/components/icons";
import type { AgentId } from "@/types/dashboard";

// ---------------------------------------------------------------------------
// Provenance and bands
// ---------------------------------------------------------------------------

/**
 * Where a figure on a report came from.
 *
 * `composed` is the important one and the common case: the number was quoted
 * verbatim from another module's published reading. Reports do not recompute,
 * so a figure in a client report and the same figure in its own module are one
 * reading rather than two.
 */
export type ReportProvenance = "composed" | "derived" | "modelled";

/** How complete a report is against the template it was built from. */
export type ReadinessBand = "ready" | "nearly" | "thin" | "not-ready";

/** Where a report stands in the agency's own workflow. */
export type ReportStatus =
  | "draft"
  | "assembling"
  | "in-review"
  | "approved"
  | "issued"
  | "overdue";

/**
 * Whether the reporting period has finished.
 *
 * A report covering a window that has not closed can only quote figures to
 * date, which is why an open period pulls its sections down to `partial`
 * rather than letting them read as final.
 */
export type PeriodState = "closed" | "open";

/** Who the report is written for. Drives tone, depth and section order. */
export type ReportAudience =
  | "client-executive"
  | "client-marketing"
  | "internal-strategy";

/** How often a template is issued. */
export type Cadence = "weekly" | "monthly" | "quarterly" | "on-demand";

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/**
 * The parts a report can be built from.
 *
 * Each kind maps to exactly one source module, which is what makes a template
 * a reading order rather than a second data model.
 */
export type SectionKind =
  | "executive-summary"
  | "performance"
  | "keywords"
  | "content"
  | "technical"
  | "ai-visibility"
  | "authority"
  | "competitors"
  | "agent-activity"
  | "next-actions"
  | "methodology";

/**
 * Whether a section can be filled for this project and period.
 *
 * `unavailable` is a real outcome, not an error: a project with no tracked
 * competitors has no competitive section, and saying so is more useful than
 * printing an empty heading.
 */
export type SectionState = "complete" | "partial" | "unavailable";

/** One figure inside a section. Pre-formatted — the source owns the format. */
export type ReportFigure = {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly provenance: ReportProvenance;
  readonly tone?: "positive" | "warning" | "critical";
};

/** One assembled section of a report. */
export type ReportSection = {
  readonly id: string;
  readonly kind: SectionKind;
  readonly title: string;
  /** The paragraph a client reads. Written from the figures below it. */
  readonly summary: string;
  readonly figures: readonly ReportFigure[];
  readonly highlights: readonly string[];
  readonly state: SectionState;
  readonly provenance: ReportProvenance;
  /** The module this section was composed from. */
  readonly sourceLabel: string;
  readonly sourceHref: string | null;
  /** Why the section is not complete, where it is not. */
  readonly caveat: string | null;
};

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/**
 * A reusable arrangement of sections.
 *
 * A template holds no data. It is an ordered list of section kinds plus the
 * audience it is written for, which is the whole of what makes one report
 * different from another.
 */
export type ReportTemplate = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly audience: ReportAudience;
  readonly cadence: Cadence;
  readonly sections: readonly SectionKind[];
  readonly icon: IconName;
  /** Whether the template ships with the product or was cloned here. */
  readonly builtIn: boolean;
};

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

/** How a finished report is meant to reach the client. */
export type DeliveryChannel = "email" | "shared-link" | "manual-handover";

/**
 * What a schedule will do at its next run.
 *
 * There is no `sent` member, and there cannot be one: no mail provider,
 * client portal or webhook is connected. A schedule prepares a report and
 * marks it ready; a person downloads it and sends it.
 */
export type DeliveryState =
  | "scheduled"
  | "ready-to-prepare"
  | "blocked"
  | "paused";

/** Who a report is meant for. Names and addresses are invented fixtures. */
export type Recipient = {
  readonly name: string;
  readonly role: string;
  readonly email: string;
};

/** A standing arrangement to prepare a report on a cadence. */
export type ReportSchedule = {
  readonly id: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly templateId: string;
  readonly templateName: string;
  readonly cadence: Cadence;
  readonly channel: DeliveryChannel;
  readonly state: DeliveryState;
  /** ISO 8601 timestamp of the next preparation run. */
  readonly nextRunAt: string;
  /** ISO 8601 timestamp of the last report this schedule produced. */
  readonly lastPreparedAt: string | null;
  readonly recipients: readonly Recipient[];
  readonly owner: AgentId;
  /** Why the schedule cannot run, where it cannot. */
  readonly blockedReason: string | null;
};

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

/** The window a report covers. */
export type ReportPeriod = {
  readonly id: string;
  readonly label: string;
  /** ISO 8601 date, inclusive. */
  readonly start: string;
  /** ISO 8601 date, inclusive. */
  readonly end: string;
  readonly state: PeriodState;
  readonly cadence: Cadence;
};

/** One report in the library. */
export type ReportRecord = {
  readonly id: string;
  readonly title: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly client: string;
  readonly templateId: string;
  readonly templateName: string;
  readonly audience: ReportAudience;
  readonly period: ReportPeriod;
  readonly status: ReportStatus;
  /** 0-100, weighted over the template's sections. */
  readonly readiness: number;
  readonly band: ReadinessBand;
  readonly sectionCount: number;
  readonly completeSections: number;
  readonly partialSections: number;
  readonly unavailableSections: number;
  readonly owner: AgentId;
  /** ISO 8601 timestamp the assembly was last refreshed. */
  readonly updatedAt: string;
  /** ISO 8601 date the report is due with the client. */
  readonly dueAt: string;
  /** Days until due; negative once overdue. */
  readonly dueInDays: number;
  readonly channel: DeliveryChannel;
  readonly recipients: readonly Recipient[];
  readonly href: string;
};

/** A report plus everything its preview and its exports need. */
export type ReportDetail = {
  readonly report: ReportRecord;
  readonly template: ReportTemplate;
  readonly sections: readonly ReportSection[];
  /** The line printed under the report title in every export. */
  readonly subtitle: string;
  /** Every distinct module this report quotes, for the provenance block. */
  readonly sources: readonly {
    readonly label: string;
    readonly href: string | null;
    readonly note: string;
  }[];
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * What a report can be written out as.
 *
 * All four are produced in the browser from the assembled report and saved by
 * the user. Nothing is uploaded, and no document service is involved.
 */
export type ExportFormat = "markdown" | "html" | "csv" | "json";

export type ExportDescriptor = {
  readonly id: ExportFormat;
  readonly label: string;
  readonly extension: string;
  readonly mimeType: string;
  readonly description: string;
  readonly icon: IconName;
};

// ---------------------------------------------------------------------------
// Display vocabulary
// ---------------------------------------------------------------------------

export type ReportStateMeta = {
  readonly label: string;
  readonly tone: "positive" | "accent" | "warning" | "critical" | "neutral";
  readonly description: string;
};

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

/** One row of a distribution bar on the overview. */
export type ReportDistributionRow = {
  readonly id: string;
  readonly label: string;
  readonly count: number;
  readonly share: number;
  readonly tone: ReportStateMeta["tone"];
  readonly description: string;
};

/** How well a project's reporting is covered, for the coverage table. */
export type ProjectCoverage = {
  readonly projectId: string;
  readonly projectName: string;
  readonly client: string;
  readonly reports: number;
  readonly scheduled: number;
  readonly cadence: Cadence | null;
  /** Mean readiness across this project's reports, 0-100. */
  readonly readiness: number;
  readonly band: ReadinessBand;
  readonly overdue: number;
  readonly nextDueAt: string | null;
  readonly href: string;
};

/** Everything the Reports overview tab renders. */
export type ReportsOverview = {
  readonly reports: readonly ReportRecord[];
  readonly schedules: readonly ReportSchedule[];
  readonly coverage: readonly ProjectCoverage[];
  readonly statusRows: readonly ReportDistributionRow[];
  readonly readinessRows: readonly ReportDistributionRow[];
  readonly sectionRows: readonly ReportDistributionRow[];
  /** Reports past their due date, soonest first. */
  readonly overdue: readonly ReportRecord[];
  /** Reports due next, excluding those already overdue. */
  readonly upcoming: readonly ReportRecord[];
  readonly meanReadiness: number;
  readonly band: ReadinessBand;
  /** Section kinds that could not be filled in scope, with their reasons. */
  readonly blocked: readonly {
    readonly kind: SectionKind;
    readonly count: number;
    readonly reason: string;
  }[];
};

/** Counts and an integrity pass, for the development inspector. */
export type ReportsDatasetCounts = {
  readonly templates: number;
  readonly reports: number;
  readonly schedules: number;
  readonly sections: number;
  readonly recipients: number;
  readonly projects: number;
  readonly byStatus: Readonly<Record<string, number>>;
  readonly byState: Readonly<Record<string, number>>;
  readonly byBand: Readonly<Record<string, number>>;
  readonly byDelivery: Readonly<Record<string, number>>;
  readonly integrity: readonly string[];
};
