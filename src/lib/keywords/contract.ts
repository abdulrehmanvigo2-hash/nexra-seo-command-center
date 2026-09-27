/**
 * Curated keywords (Phase 3, checkpoint 3.5): the operator's own list of the
 * queries a project tracks, kept in `nexra_keywords` (migration
 * 20261006120000).
 *
 * A curated keyword is the exact query text, a status and three optional
 * operator fields — a group label, a target page on the project's host and a
 * note — and nothing else: no volume, difficulty, cost per click, position,
 * rank, traffic or any other figure. Observed figures stay in the stored
 * Search Console rows and are joined on read by exact query text; a keyword
 * with no match reads "not observed in stored rows", never zero (decision
 * Q5). Every change is one operator action through one database function,
 * with an immutable event behind it. Curated keywords are not agent
 * grounding (decision Q6).
 */

export const KEYWORD_STATUSES = ["tracked", "paused", "archived"] as const;
export type CuratedKeywordStatus = (typeof KEYWORD_STATUSES)[number];

export const KEYWORD_EVENT_TYPES = ["created", "status-changed", "group-changed", "target-changed", "note-changed"] as const;
export type KeywordEventType = (typeof KEYWORD_EVENT_TYPES)[number];

/** The table's CHECK bounds, in characters. */
export const KEYWORD_QUERY_MAX_LENGTH = 2_048;
export const KEYWORD_GROUP_MAX_LENGTH = 80;
export const KEYWORD_NOTE_MAX_LENGTH = 500;
export const KEYWORD_TARGET_MAX_LENGTH = 2_048;
/** The most keywords one list read returns. */
export const KEYWORD_READ_LIMIT = 500;
/** The most events one history read returns. */
export const KEYWORD_EVENT_READ_LIMIT = 200;
/** The most queries one add request (a pasted import) carries. */
export const KEYWORD_IMPORT_LIMIT = 100;

export function isKeywordStatus(value: unknown): value is CuratedKeywordStatus {
  return typeof value === "string" && (KEYWORD_STATUSES as readonly string[]).includes(value);
}
export function isKeywordEventType(value: unknown): value is KeywordEventType {
  return typeof value === "string" && (KEYWORD_EVENT_TYPES as readonly string[]).includes(value);
}

export type CuratedKeyword = {
  readonly id: string;
  readonly projectId: string;
  /** The exact query text, as stored: never trimmed or re-cased. */
  readonly query: string;
  readonly groupLabel: string | null;
  readonly note: string | null;
  readonly targetPage: string | null;
  readonly status: CuratedKeywordStatus;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type KeywordEvent = {
  readonly id: string;
  readonly seq: number;
  readonly keywordId: string;
  readonly projectId: string;
  readonly type: KeywordEventType;
  readonly fromStatus: CuratedKeywordStatus | null;
  readonly toStatus: CuratedKeywordStatus | null;
  readonly fromValue: string | null;
  readonly toValue: string | null;
  readonly actor: string;
  readonly createdAt: string;
};

export type AddKeywordInput = {
  readonly projectId: string;
  readonly query: string;
  readonly groupLabel: string | null;
  readonly note: string | null;
  readonly targetPage: string | null;
  readonly operatorId: string;
};
export type AddKeywordOutcome =
  | { readonly status: "added"; readonly keyword: CuratedKeyword }
  | { readonly status: "exists"; readonly keyword: CuratedKeyword }
  | { readonly status: "project-not-found" }
  | { readonly status: "target-off-host" };

export type KeywordAction = "status" | "group" | "target" | "note";
export type KeywordActionInput = {
  readonly projectId: string;
  readonly keywordId: string;
  readonly action: KeywordAction;
  /** The new status for `status`; the new value, or null to clear, for the others. */
  readonly value: string | null;
  readonly operatorId: string;
};
export type KeywordActionOutcome =
  | { readonly status: "changed"; readonly keyword: CuratedKeyword; readonly event: KeywordEvent }
  | { readonly status: "unchanged"; readonly keyword: CuratedKeyword }
  | { readonly status: "target-off-host"; readonly keyword: CuratedKeyword }
  | { readonly status: "keyword-not-found" };

// ---------------------------------------------------------------------------
// Request shapes. Shape only: whether the project is stored, the keyword the
// project's, or the target on its host is the database's decision.

const PROJECT_ID = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL = /[\u0000-\u001f\u007f]/;
/** Control characters other than a line break, tab or carriage return — what a note may not hold. */
const NOTE_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const TARGET = /^https?:\/\/[^/?#\s@]+(\/\S*)?$/;

export function isKeywordId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function isProjectId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && PROJECT_ID.test(value);
}

/** A query as the database accepts it: 1 to 2048 characters, not blank, no control characters. Never trimmed. */
export function isKeywordQuery(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= KEYWORD_QUERY_MAX_LENGTH && value.trim().length > 0 && !CONTROL.test(value);
}

/** An optional operator field, trimmed; empty is none. Null when the value is malformed. */
type Optional = { readonly ok: true; readonly value: string | null } | { readonly ok: false };
function optionalText(value: unknown, max: number, control: RegExp): Optional {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  if (trimmed.length > max || control.test(trimmed)) return { ok: false };
  return { ok: true, value: trimmed };
}
export const checkGroupLabel = (value: unknown) => optionalText(value, KEYWORD_GROUP_MAX_LENGTH, CONTROL);
export const checkNote = (value: unknown) => optionalText(value, KEYWORD_NOTE_MAX_LENGTH, NOTE_CONTROL);
export function checkTargetPage(value: unknown): Optional {
  const checked = optionalText(value, KEYWORD_TARGET_MAX_LENGTH, CONTROL);
  if (!checked.ok || checked.value === null) return checked;
  return TARGET.test(checked.value) ? checked : { ok: false };
}

/**
 * Whether a target page is on the project's host: the host of the stored
 * domain (up to its first `/`), or that host with or without `www.`. The
 * database decides with the same rule; this lets the form say so first.
 */
export function isOnProjectHost(target: string, domain: string): boolean {
  if (!TARGET.test(target)) return false;
  const host = (target.match(/^https?:\/\/([^/?#]+)/)?.[1] ?? "").toLowerCase().replace(/:\d+$/, "");
  const projectHost = domain.split("/")[0];
  const bare = projectHost.startsWith("www.") ? projectHost.slice(4) : projectHost;
  return host === projectHost || host === `www.${projectHost}` || host === bare;
}

export type AddKeywordsRequest =
  | {
      readonly ok: true;
      readonly projectId: string;
      readonly entries: readonly { readonly query: string; readonly groupLabel: string | null; readonly note: string | null; readonly targetPage: string | null }[];
    }
  | { readonly ok: false; readonly error: "invalid" };

const ADD_FIELDS: readonly string[] = ["project", "queries", "groupLabel", "note", "targetPage"];

/**
 * An add request: a project and 1 to 100 exact queries sharing an optional
 * group label, note and target page — one query from an inventory row, or a
 * pasted list from Import. Duplicates within the request are dropped, in
 * order; each query is kept exactly as sent.
 */
export function parseAddKeywordsRequest(body: unknown): AddKeywordsRequest {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "invalid" };
  const fields = body as Record<string, unknown>;
  if (Object.keys(fields).some((key) => !ADD_FIELDS.includes(key))) return { ok: false, error: "invalid" };
  if (!isProjectId(fields.project)) return { ok: false, error: "invalid" };
  const queries = fields.queries;
  if (!Array.isArray(queries) || queries.length < 1 || queries.length > KEYWORD_IMPORT_LIMIT) return { ok: false, error: "invalid" };
  if (!queries.every(isKeywordQuery)) return { ok: false, error: "invalid" };
  const group = checkGroupLabel(fields.groupLabel);
  const note = checkNote(fields.note);
  const target = checkTargetPage(fields.targetPage);
  if (!group.ok || !note.ok || !target.ok) return { ok: false, error: "invalid" };
  const unique = [...new Set(queries as string[])];
  return { ok: true, projectId: fields.project, entries: unique.map((query) => ({ query, groupLabel: group.value, note: note.value, targetPage: target.value })) };
}

export type KeywordActionRequest =
  | { readonly ok: true; readonly projectId: string; readonly action: KeywordAction; readonly value: string | null }
  | { readonly ok: false; readonly error: "invalid" };

const ACTION_FIELDS: readonly string[] = ["project", "action", "value"];

/** One change to one keyword: a status, or a group label, target page or note (null or blank clears it). */
export function parseKeywordActionRequest(body: unknown): KeywordActionRequest {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "invalid" };
  const fields = body as Record<string, unknown>;
  if (Object.keys(fields).some((key) => !ACTION_FIELDS.includes(key))) return { ok: false, error: "invalid" };
  if (!isProjectId(fields.project)) return { ok: false, error: "invalid" };
  switch (fields.action) {
    case "status":
      return isKeywordStatus(fields.value) ? { ok: true, projectId: fields.project, action: "status", value: fields.value } : { ok: false, error: "invalid" };
    case "group": {
      const checked = checkGroupLabel(fields.value);
      return checked.ok ? { ok: true, projectId: fields.project, action: "group", value: checked.value } : { ok: false, error: "invalid" };
    }
    case "target": {
      const checked = checkTargetPage(fields.value);
      return checked.ok ? { ok: true, projectId: fields.project, action: "target", value: checked.value } : { ok: false, error: "invalid" };
    }
    case "note": {
      const checked = checkNote(fields.value);
      return checked.ok ? { ok: true, projectId: fields.project, action: "note", value: checked.value } : { ok: false, error: "invalid" };
    }
    default:
      return { ok: false, error: "invalid" };
  }
}

export type ListKeywordsRequest =
  | { readonly ok: true; readonly projectId: string; readonly status: CuratedKeywordStatus | null }
  | { readonly ok: false; readonly error: "invalid" };

export function parseListKeywordsRequest(params: { readonly project: string | null; readonly status: string | null }): ListKeywordsRequest {
  if (!isProjectId(params.project)) return { ok: false, error: "invalid" };
  if (params.status !== null && !isKeywordStatus(params.status)) return { ok: false, error: "invalid" };
  return { ok: true, projectId: params.project, status: params.status };
}

/**
 * Splits a pasted list into queries: one per line, surrounding whitespace
 * removed (a pasted line's padding is not part of the query), blank lines and
 * repeats dropped, in order. Lines that are not valid queries are returned
 * apart so the form can name them.
 */
export function splitImport(text: string): { readonly queries: readonly string[]; readonly rejected: readonly string[] } {
  const queries: string[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || seen.has(line)) continue;
    seen.add(line);
    if (isKeywordQuery(line)) queries.push(line);
    else rejected.push(line);
  }
  return { queries, rejected };
}

// ---------------------------------------------------------------------------
// The browser's side.

export function keywordsListUrl(projectId: string, status?: CuratedKeywordStatus): string {
  const params = new URLSearchParams({ project: projectId });
  if (status) params.set("status", status);
  return `/api/keywords?${params.toString()}`;
}

export function keywordUrl(keywordId: string): string {
  return `/api/keywords/${encodeURIComponent(keywordId)}`;
}

export function keywordDetailHref(keywordId: string): string {
  return `/keywords/${encodeURIComponent(keywordId)}`;
}

export const STATUS_LABEL: Readonly<Record<CuratedKeywordStatus, { readonly label: string; readonly tone: "positive" | "neutral" | "warning" }>> = {
  tracked: { label: "Tracked", tone: "positive" },
  paused: { label: "Paused", tone: "warning" },
  archived: { label: "Archived", tone: "neutral" },
};

/** What a refused or failed request means, in the operator's terms. Never the server's text. */
export function keywordRequestFailure(httpStatus: number, error?: unknown): string {
  switch (error) {
    case "target-off-host":
      return "The target page is not on this project's site. Use a page on the project's own host.";
    case "keyword-not-found":
      return "This keyword is not stored for this project.";
    case "project-not-found":
      return "This project is not stored, so nothing was recorded.";
    case "unavailable":
      return "Curated keywords are not kept on this deployment, so nothing was recorded.";
  }
  if (httpStatus === 401) return "Your session has ended. Reload the page to sign in again.";
  if (httpStatus === 403) return "This request was refused. Reload the page and try again.";
  if (httpStatus === 429) return "Too many changes in a short time. Wait a moment and try again.";
  if (httpStatus === 400) return "The request was not valid. Check the fields and try again.";
  return "The change could not be recorded. Try again in a moment.";
}
