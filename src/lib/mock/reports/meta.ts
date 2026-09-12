/**
 * Every label, tone, order and explanation in Reports.
 *
 * Vocabulary lives here rather than in the components, so a status reads the
 * same in the library table, on a filter chip, on the Command Center strip and
 * inside an exported file.
 *
 * The wording carries weight in two places. Nothing below says a report was
 * sent, because nothing in this product can send one — the delivery vocabulary
 * stops at "prepared". And nothing below describes a figure as measured, for
 * the reason given in `src/types/reports.ts`.
 */
import {
  CURRENT_USER,
  DEFAULT_WORKSPACE_ID,
  WORKSPACES,
} from "@/lib/mock/workspace";
import type {
  Cadence,
  DeliveryChannel,
  DeliveryState,
  ExportDescriptor,
  ExportFormat,
  ReadinessBand,
  ReportAudience,
  ReportProvenance,
  ReportStateMeta,
  ReportStatus,
  SectionKind,
  SectionState,
} from "@/types/reports";

// ---------------------------------------------------------------------------
// Source notes
// ---------------------------------------------------------------------------

/** Stated wherever a report figure appears, and printed into every export. */
export const REPORTS_SOURCE_NOTE =
  "Every figure in a report is quoted from the module that publishes it — Analytics, Technical SEO, Keyword Intelligence, Content Studio, AI Visibility, Backlinks and Competitor Intelligence. Reports recompute nothing, so a number here and the same number in its own module are one reading. Those modules run on the development dataset: no analytics property, Search Console, crawler or vendor API is connected.";

export const REPORTS_SOURCE_SHORT =
  "Composed from module readings — reports recompute nothing.";

/** Stated wherever delivery appears, on screen and in exports. */
export const DELIVERY_NOTE =
  "Nothing is sent from here. No mail provider, client portal or webhook is connected (CLAUDE.md §4), so a schedule prepares a report and marks it ready — a person downloads it and sends it. Recipients describe who a report is written for, not an address anything is transmitted to.";

export const DELIVERY_NOTE_SHORT =
  "Schedules prepare reports. Nothing is transmitted — no provider is connected.";

/** Stated on the export panel. */
export const EXPORT_NOTE =
  "Exports are written in your browser from the report on screen and saved to your machine. No document service, storage bucket or upload is involved.";

// ---------------------------------------------------------------------------
// Branding
// ---------------------------------------------------------------------------

/**
 * What goes at the top of an export.
 *
 * Read from the workspace fixture rather than restated, so the name on a
 * client PDF and the name in the sidebar cannot drift apart.
 */
export const REPORT_BRAND = {
  workspace:
    WORKSPACES.find((entry) => entry.id === DEFAULT_WORKSPACE_ID)?.name ??
    "Nexra",
  product: "Nexra SEO Command Center",
  preparedBy: CURRENT_USER.name,
  preparedByRole: CURRENT_USER.role,
  /** Used for the accent rule in the HTML export. */
  accent: "#4f7cff",
} as const;

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

export const PROVENANCE_META: Readonly<
  Record<ReportProvenance, { label: string; description: string }>
> = {
  composed: {
    label: "Composed",
    description:
      "Quoted verbatim from the module that publishes it. Reports do not recalculate; this figure and the one in its own module are the same reading.",
  },
  derived: {
    label: "Derived",
    description:
      "Arithmetic over composed figures — a share, a total, or a count of records already on screen elsewhere.",
  },
  modelled: {
    label: "Modelled",
    description:
      "Workflow state no source here supplies: who a report is for, when it was last assembled, when it is due.",
  },
};

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export const STATUS_META: Readonly<Record<ReportStatus, ReportStateMeta>> = {
  draft: {
    label: "Draft",
    tone: "neutral",
    description: "Started, with the period still open behind it.",
  },
  assembling: {
    label: "Assembling",
    tone: "accent",
    description:
      "Sections are being composed from the modules. Figures will move until the period closes.",
  },
  "in-review": {
    label: "In review",
    tone: "warning",
    description: "Complete enough to read, waiting on an internal check.",
  },
  approved: {
    label: "Approved",
    tone: "positive",
    description: "Checked and cleared to go out. Not yet handed over.",
  },
  issued: {
    label: "Issued",
    tone: "positive",
    description:
      "Marked as handed over in this workspace. Nothing was transmitted from here — no provider is connected.",
  },
  overdue: {
    label: "Overdue",
    tone: "critical",
    description:
      "Past its due date and not yet approved or issued. Derived from the date, not set by hand.",
  },
};

export const STATUS_ORDER: readonly ReportStatus[] = [
  "overdue",
  "in-review",
  "assembling",
  "draft",
  "approved",
  "issued",
];

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

export const BAND_META: Readonly<Record<ReadinessBand, ReportStateMeta>> = {
  ready: {
    label: "Ready",
    tone: "positive",
    description: "Every section a client would notice is filled.",
  },
  nearly: {
    label: "Nearly there",
    tone: "accent",
    description: "Assembled, with a section or two thin or missing.",
  },
  thin: {
    label: "Thin",
    tone: "warning",
    description:
      "Enough gaps that sending it would raise more questions than it answers.",
  },
  "not-ready": {
    label: "Not ready",
    tone: "critical",
    description:
      "Most of the template could not be filled for this project and period.",
  },
};

export const BAND_ORDER: readonly ReadinessBand[] = [
  "ready",
  "nearly",
  "thin",
  "not-ready",
];

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export const SECTION_STATE_META: Readonly<
  Record<SectionState, ReportStateMeta>
> = {
  complete: {
    label: "Complete",
    tone: "positive",
    description: "Filled from a closed period, with every figure available.",
  },
  partial: {
    label: "Partial",
    tone: "warning",
    description:
      "Filled, but the window it covers has not closed or a figure inside it is missing.",
  },
  unavailable: {
    label: "Unavailable",
    tone: "neutral",
    description:
      "Nothing in scope to report. Stated rather than printed as an empty heading.",
  },
};

export const SECTION_STATE_ORDER: readonly SectionState[] = [
  "complete",
  "partial",
  "unavailable",
];

/**
 * What each section is and where it comes from.
 *
 * `source` is the module the section is composed from, and `href` is the
 * screen a reader can check it against — every claim on a report is one click
 * from the records behind it.
 *
 * `scope` says how that link is narrowed to the project. Most modules read a
 * `project` query parameter; the agent board does not, and its per-project
 * view is the project workspace instead. A link that quietly landed on an
 * unscoped screen would be showing a reader the whole portfolio while the
 * heading above it named one client.
 */
export const SECTION_META: Readonly<
  Record<
    SectionKind,
    {
      readonly label: string;
      readonly description: string;
      readonly source: string;
      readonly href: string | null;
      readonly scope: "query" | "project-route";
    }
  >
> = {
  "executive-summary": {
    label: "Executive summary",
    description:
      "The window in five figures and a paragraph, for a reader who will not go further.",
    source: "Analytics, Technical SEO, AI Visibility and Backlinks",
    href: "/analytics",
    scope: "query",
  },
  performance: {
    label: "Performance",
    description:
      "Traffic, visibility and conversions over the period, with the movement read against what the series normally does.",
    source: "Analytics",
    href: "/analytics",
    scope: "query",
  },
  keywords: {
    label: "Rankings and keywords",
    description:
      "Position bands, movement, and where the unclaimed room sits.",
    source: "Keyword Intelligence",
    href: "/keywords",
    scope: "query",
  },
  content: {
    label: "Content",
    description:
      "What was published in the window, what is decaying, and what is queued.",
    source: "Content Studio",
    href: "/content",
    scope: "query",
  },
  technical: {
    label: "Technical health",
    description:
      "Crawlability, indexation, Core Web Vitals and the findings still open.",
    source: "Technical SEO",
    href: "/technical",
    scope: "query",
  },
  "ai-visibility": {
    label: "AI visibility",
    description:
      "Answer-readiness and the gaps holding pages back from being usable by a generative engine.",
    source: "AI Visibility",
    href: "/ai-visibility",
    scope: "query",
  },
  authority: {
    label: "Authority and links",
    description:
      "Link profile movement, referring-domain quality, and the risk flags on it.",
    source: "Backlinks & Authority",
    href: "/backlinks",
    scope: "query",
  },
  competitors: {
    label: "Competitive position",
    description:
      "Who is contesting the same terms and where the gap between us sits.",
    source: "Competitor Intelligence",
    href: "/competitors",
    scope: "query",
  },
  "agent-activity": {
    label: "Work delivered",
    description:
      "What the agents completed for this project in the window, by stage.",
    source: "AI Agents",
    // The agent board has no project filter in the URL; the per-project view
    // of the same work is the project workspace's task board.
    href: "/projects",
    scope: "project-route",
  },
  "next-actions": {
    label: "What happens next",
    description:
      "The queue the next cycle starts from, taken from the module that raised each item.",
    source: "Every module's opportunity queue",
    href: "/analytics?tab=learnings",
    scope: "query",
  },
  methodology: {
    label: "Methodology and sources",
    description:
      "Where each figure came from, what is modelled, and what this product does not measure.",
    source: "This module",
    href: null,
    scope: "query",
  },
};

export const SECTION_ORDER: readonly SectionKind[] = [
  "executive-summary",
  "performance",
  "keywords",
  "content",
  "technical",
  "ai-visibility",
  "authority",
  "competitors",
  "agent-activity",
  "next-actions",
  "methodology",
];

// ---------------------------------------------------------------------------
// Audience and cadence
// ---------------------------------------------------------------------------

export const AUDIENCE_META: Readonly<
  Record<ReportAudience, { label: string; description: string }>
> = {
  "client-executive": {
    label: "Client executive",
    description:
      "Short, outcome-first, no diagnostics. Written for someone who will read one page.",
  },
  "client-marketing": {
    label: "Client marketing",
    description:
      "The full picture with the working shown, for the team who will act on it.",
  },
  "internal-strategy": {
    label: "Internal strategy",
    description:
      "Everything, including what is not going well and what is not measurable.",
  },
};

export const AUDIENCE_ORDER: readonly ReportAudience[] = [
  "client-executive",
  "client-marketing",
  "internal-strategy",
];

export const CADENCE_META: Readonly<
  Record<Cadence, { label: string; description: string }>
> = {
  weekly: {
    label: "Weekly",
    description: "A short check-in on movement, issued three days after close.",
  },
  monthly: {
    label: "Monthly",
    description: "The standard client report, issued a week after close.",
  },
  quarterly: {
    label: "Quarterly",
    description:
      "The strategic review, issued a fortnight after close with the full history behind it.",
  },
  "on-demand": {
    label: "On demand",
    description: "Prepared when asked for rather than on a schedule.",
  },
};

export const CADENCE_ORDER: readonly Cadence[] = [
  "weekly",
  "monthly",
  "quarterly",
  "on-demand",
];

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

export const CHANNEL_META: Readonly<
  Record<DeliveryChannel, { label: string; description: string }>
> = {
  email: {
    label: "Email",
    description:
      "How the client expects it. No mail provider is connected, so the file is attached by hand.",
  },
  "shared-link": {
    label: "Shared link",
    description:
      "The client reads it in their own workspace. No portal is connected, so the export is uploaded by hand.",
  },
  "manual-handover": {
    label: "Handover",
    description: "Walked through live, with the export as the leave-behind.",
  },
};

export const CHANNEL_ORDER: readonly DeliveryChannel[] = [
  "email",
  "shared-link",
  "manual-handover",
];

export const DELIVERY_STATE_META: Readonly<
  Record<DeliveryState, ReportStateMeta>
> = {
  scheduled: {
    label: "Scheduled",
    tone: "accent",
    description:
      "Will assemble its report at the next run. It will not send anything.",
  },
  "ready-to-prepare": {
    label: "Ready to prepare",
    tone: "positive",
    description:
      "The period has closed and every section it needs is available.",
  },
  blocked: {
    label: "Blocked",
    tone: "critical",
    description:
      "Cannot fill enough of its template to be worth preparing. The reason is named on the row.",
  },
  paused: {
    label: "Paused",
    tone: "neutral",
    description: "Held by the account team. No runs until it is resumed.",
  },
};

export const DELIVERY_STATE_ORDER: readonly DeliveryState[] = [
  "ready-to-prepare",
  "scheduled",
  "blocked",
  "paused",
];

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const EXPORT_FORMATS: readonly ExportDescriptor[] = [
  {
    id: "markdown",
    label: "Markdown",
    extension: "md",
    mimeType: "text/markdown;charset=utf-8",
    description:
      "The report as text. Pastes into a doc, a ticket or a client email without losing its structure.",
    icon: "note",
  },
  {
    id: "html",
    label: "HTML",
    extension: "html",
    mimeType: "text/html;charset=utf-8",
    description:
      "A branded, self-contained page. Opens in any browser and prints to PDF from there.",
    icon: "reports",
  },
  {
    id: "csv",
    label: "CSV",
    extension: "csv",
    mimeType: "text/csv;charset=utf-8",
    description:
      "Every figure as a row, with its section and its provenance. For a spreadsheet.",
    icon: "rows",
  },
  {
    id: "json",
    label: "JSON",
    extension: "json",
    mimeType: "application/json;charset=utf-8",
    description:
      "The assembled report exactly as the app holds it, including section state.",
    icon: "layers",
  },
];

export const EXPORT_META: Readonly<Record<ExportFormat, ExportDescriptor>> =
  Object.fromEntries(
    EXPORT_FORMATS.map((entry) => [entry.id, entry]),
  ) as Readonly<Record<ExportFormat, ExportDescriptor>>;
