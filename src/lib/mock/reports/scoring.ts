/**
 * Every threshold, weight and band in Reports, in one file.
 *
 * A report has one number of its own — readiness, meaning how much of the
 * template it was built from could actually be filled. Everything else on a
 * report is quoted from the module that owns it, so this file is much smaller
 * than its equivalent in Technical SEO or Analytics, and that is the point:
 * a second scoring model over figures another module has already scored would
 * be a second opinion the product has no basis for.
 */
import type {
  Cadence,
  ReadinessBand,
  ReportRecord,
  ReportSection,
  SectionKind,
  SectionState,
} from "@/types/reports";

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

/**
 * What each section contributes to readiness.
 *
 * A report missing its executive summary is not the same as a report missing
 * its methodology note, and a flat mean would say it was. The weights say
 * which sections a client would notice the absence of.
 */
export const SECTION_WEIGHT: Readonly<Record<SectionKind, number>> = {
  "executive-summary": 1.4,
  performance: 1.3,
  "next-actions": 1.2,
  technical: 1,
  keywords: 1,
  content: 1,
  "ai-visibility": 0.9,
  authority: 0.9,
  competitors: 0.8,
  "agent-activity": 0.6,
  methodology: 0.4,
};

/**
 * What each section state is worth.
 *
 * A partial section is worth well under half a complete one: a client reading
 * a figure that covers three weeks of a four-week month is being given a
 * number they will compare against a full month, so an incomplete section
 * carries risk a missing one does not.
 */
export const SECTION_VALUE: Readonly<Record<SectionState, number>> = {
  complete: 100,
  partial: 55,
  unavailable: 0,
};

export const READINESS_BANDS = {
  ready: 85,
  nearly: 65,
  thin: 40,
} as const;

export function readinessBandFor(score: number): ReadinessBand {
  if (score >= READINESS_BANDS.ready) return "ready";
  if (score >= READINESS_BANDS.nearly) return "nearly";
  if (score >= READINESS_BANDS.thin) return "thin";
  return "not-ready";
}

/**
 * How complete a report is, 0-100.
 *
 * Weighted over the sections the template asked for, so a template that does
 * not request a competitive section is not penalised for lacking one — only a
 * template that asked and could not be answered is.
 */
export function readinessScore(sections: readonly ReportSection[]): number {
  if (sections.length === 0) return 0;

  let weighted = 0;
  let total = 0;

  for (const section of sections) {
    const weight = SECTION_WEIGHT[section.kind];
    weighted += SECTION_VALUE[section.state] * weight;
    total += weight;
  }

  return Math.round(weighted / total);
}

// ---------------------------------------------------------------------------
// Cadence
// ---------------------------------------------------------------------------

/** How long after a period closes the report is due with the client. */
export const DUE_OFFSET_DAYS: Readonly<Record<Cadence, number>> = {
  weekly: 3,
  monthly: 7,
  quarterly: 14,
  "on-demand": 5,
};

/** How far apart two runs of a schedule sit. */
export const CADENCE_DAYS: Readonly<Record<Cadence, number>> = {
  weekly: 7,
  monthly: 30,
  quarterly: 91,
  "on-demand": 0,
};

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

/**
 * Where a report sits in the queue of work.
 *
 * Overdue first and by how far, then by how soon it is due, and completeness
 * only as the tie-break — a report that is nearly finished but not due for a
 * fortnight is not the one to open next.
 *
 * Status comes first of all, though. A report that has been issued is not
 * waiting on anyone, and ranking it by how long ago it was due would put a
 * closed-out June report at the head of a queue of live work simply because it
 * is the oldest thing in the library. An approved one is nearly as settled: it
 * is cleared and only needs sending, so it sits behind everything unfinished.
 */
export function reportPriority(report: ReportRecord): number {
  if (report.status === "issued") return 0;

  const overdue = report.dueInDays < 0 ? 1000 - report.dueInDays * 10 : 0;
  const urgency = Math.max(0, 120 - Math.max(report.dueInDays, 0) * 3);
  const shortfall = (100 - report.readiness) / 10;
  const settled = report.status === "approved" ? 0.1 : 1;

  return Math.round((overdue + urgency + shortfall) * settled);
}

/**
 * Days between two ISO dates, counted forward from the first.
 *
 * Both sides are truncated to midnight UTC before subtracting, so the result
 * is a whole number of days regardless of the time of day either side carries.
 */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

/** An ISO date a number of days after another. Dates only, no time. */
export function addDays(iso: string, days: number): string {
  const base = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}
