/**
 * Crawl finding triage (Technical SEO + On-Page SEO, milestone M3): an
 * operator's standing decision about one recorded finding.
 *
 * A recorded finding (T3) is an immutable observation. A decision about it —
 * seen, dealt with, not worth acting on — is a different kind of thing:
 * mutable, an operator's, and never written into the observation. It is kept
 * in `nexra_crawl_finding_triage` (migration 20261002120000), one row per
 * project and finding key, so a decision made on one crawl's finding still
 * applies when a later crawl records the same finding again.
 *
 * What triage is not: a fix, a verdict about the site, or an automatic
 * resolution. `resolved` records that an operator says the matter is dealt
 * with; whether the page changed is for the next crawl's findings to show.
 */

export const TRIAGE_STATUSES = ["open", "acknowledged", "resolved", "ignored"] as const;

export type FindingTriageStatus = (typeof TRIAGE_STATUSES)[number];

/** The longest note the table keeps (its CHECK), in characters. */
export const TRIAGE_NOTE_MAX_LENGTH = 500;

export function isTriageStatus(value: unknown): value is FindingTriageStatus {
  return typeof value === "string" && (TRIAGE_STATUSES as readonly string[]).includes(value);
}

export type TriageTone = "neutral" | "accent" | "positive" | "warning" | "critical";

/** How each status reads on screen. Wording says what an operator decided, never what the site does. */
export const TRIAGE_STATUS_META: Readonly<Record<FindingTriageStatus, { readonly label: string; readonly tone: TriageTone; readonly description: string }>> = {
  open: { label: "Open", tone: "warning", description: "No decision recorded, or reopened." },
  acknowledged: { label: "Acknowledged", tone: "accent", description: "Seen by an operator; not yet dealt with." },
  resolved: { label: "Resolved", tone: "positive", description: "An operator says this is dealt with. The next crawl's findings show whether the page changed." },
  ignored: { label: "Ignored", tone: "neutral", description: "An operator decided not to act on this finding." },
};

/** One stored decision, as the table holds it. */
export type FindingTriage = {
  readonly id: string;
  readonly projectId: string;
  /** The library's stable finding id: rule, a colon, sixteen hex characters. */
  readonly findingKey: string;
  readonly rule: string;
  /** The recorded finding, report and crawl the decision was last made on. */
  readonly findingId: string;
  readonly reportId: string;
  readonly crawlId: string;
  readonly status: FindingTriageStatus;
  readonly note: string | null;
  readonly setBy: string;
  /** ISO timestamps. */
  readonly setAt: string;
  readonly createdAt: string;
};

export type SetFindingTriageInput = {
  readonly projectId: string;
  readonly crawlId: string;
  readonly findingKey: string;
  readonly status: FindingTriageStatus;
  /** Already normalised: trimmed, null when blank, within the length limit. */
  readonly note: string | null;
  readonly operatorId: string;
};

export type SetFindingTriageOutcome =
  /** Written (inserted or updated in place). `previous` is the status it replaced, or null for a first decision. */
  | { readonly status: "set"; readonly previous: FindingTriageStatus | null; readonly triage: FindingTriage }
  /** No such crawl of this project. Never says which of the two. */
  | { readonly status: "not-found" }
  /** The crawl is the project's, but no finding with that key was recorded for it. */
  | { readonly status: "not-recorded" };

/**
 * A note as an operator typed it: trimmed, blank means none, and never
 * longer than the table keeps. Anything but a string (or an absent value)
 * is refused rather than coerced.
 */
export type NoteCheck = { readonly ok: true; readonly note: string | null } | { readonly ok: false; readonly reason: "not-text" | "too-long" };

export function normaliseTriageNote(value: unknown): NoteCheck {
  if (value === undefined || value === null) return { ok: true, note: null };
  if (typeof value !== "string") return { ok: false, reason: "not-text" };
  const note = value.trim();
  if (note.length === 0) return { ok: true, note: null };
  if (note.length > TRIAGE_NOTE_MAX_LENGTH) return { ok: false, reason: "too-long" };
  return { ok: true, note };
}

const PROJECT_ID = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The same shape the findings table enforces on a key. */
const FINDING_KEY = /^[a-z][a-z0-9-]{2,63}:[0-9a-f]{16}$/;

const BODY_FIELDS: readonly string[] = ["project", "findingKey", "status", "note"];

export type TriageSetRequest =
  | { readonly ok: true; readonly projectId: string; readonly crawlId: string; readonly findingKey: string; readonly status: FindingTriageStatus; readonly note: string | null }
  | { readonly ok: false; readonly error: "invalid" };

/**
 * A triage request as the route receives it: the crawl from the path, the
 * rest from a JSON body with exactly these fields. Shape only — whether the
 * crawl is the project's and the key recorded is the database's decision.
 */
export function parseTriageSetRequest(crawlId: string, body: unknown): TriageSetRequest {
  if (!UUID.test(crawlId)) return { ok: false, error: "invalid" };
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "invalid" };
  const fields = body as Record<string, unknown>;
  if (Object.keys(fields).some((key) => !BODY_FIELDS.includes(key))) return { ok: false, error: "invalid" };
  const { project, findingKey, status, note } = fields;
  if (typeof project !== "string" || project.length > 64 || !PROJECT_ID.test(project)) return { ok: false, error: "invalid" };
  if (typeof findingKey !== "string" || !FINDING_KEY.test(findingKey)) return { ok: false, error: "invalid" };
  if (!isTriageStatus(status)) return { ok: false, error: "invalid" };
  const checked = normaliseTriageNote(note);
  if (!checked.ok) return { ok: false, error: "invalid" };
  return { ok: true, projectId: project, crawlId: crawlId.toLowerCase(), findingKey, status, note: checked.note };
}
