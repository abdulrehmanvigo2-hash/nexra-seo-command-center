import {
  isKeywordEventType,
  isKeywordStatus,
  type AddKeywordOutcome,
  type CuratedKeyword,
  type KeywordAction,
  type KeywordActionOutcome,
  type KeywordEvent,
} from "@/lib/keywords/contract";

/**
 * The shape of `nexra_keywords` and `nexra_keyword_events`, of what the five
 * functions answer, and the translation into the application's types. The
 * tables grant no INSERT, UPDATE or DELETE: the functions are the only way
 * in. A row that does not match what the migration declares is refused at
 * read time rather than passed on.
 */

export class KeywordRowError extends Error {
  constructor(message: string) {
    super(`Curated keyword row: ${message}`);
    this.name = "KeywordRowError";
  }
}

export type KeywordRow = {
  id: string;
  project_id: string;
  query: string;
  group_label: string | null;
  note: string | null;
  target_page: string | null;
  status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type KeywordEventRow = {
  id: string;
  seq: number;
  keyword_id: string;
  project_id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  from_value: string | null;
  to_value: string | null;
  actor: string;
  created_at: string;
};

type ReadOnly<Row> = { Row: Row; Insert: never; Update: never; Relationships: [] };
type Setter<Value extends string> = { Args: { p_project_id: string; p_keyword_id: string; p_operator: string } & Record<Value, string | null>; Returns: unknown };

export type KeywordsDatabase = {
  public: {
    Tables: {
      nexra_keywords: ReadOnly<KeywordRow>;
      nexra_keyword_events: ReadOnly<KeywordEventRow>;
    };
    Views: { [_ in never]: never };
    Functions: {
      nexra_keyword_add: {
        Args: { p_project_id: string; p_query: string; p_group_label: string | null; p_note: string | null; p_target_page: string | null; p_operator: string };
        Returns: unknown;
      };
      nexra_keyword_set_status: Setter<"p_status">;
      nexra_keyword_set_group: Setter<"p_group_label">;
      nexra_keyword_set_target: Setter<"p_target_page">;
      nexra_keyword_set_note: Setter<"p_note">;
    };
  };
};

export const KEYWORD_READ_COLUMNS = "id, project_id, query, group_label, note, target_page, status, created_by, created_at, updated_at";
export const KEYWORD_EVENT_READ_COLUMNS = "id, seq, keyword_id, project_id, event_type, from_status, to_status, from_value, to_value, actor, created_at";

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new KeywordRowError(`${what} is not an object.`);
  return value as Record<string, unknown>;
}
function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new KeywordRowError(`${key} is not text.`);
  return value;
}
function optional(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new KeywordRowError(`${key} is not text.`);
  return value;
}

export function keywordRowToKeyword(value: unknown): CuratedKeyword {
  const row = record(value, "a keyword row");
  const status = row.status;
  if (!isKeywordStatus(status)) throw new KeywordRowError(`status "${String(status)}" is not one of the three.`);
  return {
    id: text(row, "id"),
    projectId: text(row, "project_id"),
    query: text(row, "query"),
    groupLabel: optional(row, "group_label"),
    note: optional(row, "note"),
    targetPage: optional(row, "target_page"),
    status,
    createdBy: text(row, "created_by"),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
  };
}

export function eventRowToEvent(value: unknown): KeywordEvent {
  const row = record(value, "a keyword event row");
  const type = row.event_type;
  if (!isKeywordEventType(type)) throw new KeywordRowError(`event type "${String(type)}" is not one of the five.`);
  const fromStatus = optional(row, "from_status");
  const toStatus = optional(row, "to_status");
  if ((fromStatus !== null && !isKeywordStatus(fromStatus)) || (toStatus !== null && !isKeywordStatus(toStatus))) throw new KeywordRowError("an event status is not one of the three.");
  const seq = row.seq;
  if (typeof seq !== "number" && typeof seq !== "string") throw new KeywordRowError("seq is not a number.");
  return {
    id: text(row, "id"),
    seq: Number(seq),
    keywordId: text(row, "keyword_id"),
    projectId: text(row, "project_id"),
    type,
    fromStatus,
    toStatus,
    fromValue: optional(row, "from_value"),
    toValue: optional(row, "to_value"),
    actor: text(row, "actor"),
    createdAt: text(row, "created_at"),
  };
}

export function addResultToOutcome(data: unknown): AddKeywordOutcome {
  const result = record(data, "the function's answer");
  switch (result.outcome) {
    case "added":
      return { status: "added", keyword: keywordRowToKeyword(result.keyword) };
    case "exists":
      return { status: "exists", keyword: keywordRowToKeyword(result.keyword) };
    case "project-not-found":
      return { status: "project-not-found" };
    case "target-off-host":
      return { status: "target-off-host" };
    default:
      throw new KeywordRowError(`the add function answered "${String(result.outcome)}", which this product does not recognise.`);
  }
}

const CHANGED: Readonly<Record<KeywordAction, string>> = { status: "status-changed", group: "group-changed", target: "target-changed", note: "note-changed" };
const SAME: Readonly<Record<KeywordAction, string>> = { status: "same-status", group: "same-group", target: "same-target", note: "same-note" };

export function actionResultToOutcome(action: KeywordAction, data: unknown): KeywordActionOutcome {
  const result = record(data, "the function's answer");
  if (result.outcome === "keyword-not-found") return { status: "keyword-not-found" };
  if (result.outcome === CHANGED[action]) return { status: "changed", keyword: keywordRowToKeyword(result.keyword), event: eventRowToEvent(result.event) };
  if (result.outcome === SAME[action]) return { status: "unchanged", keyword: keywordRowToKeyword(result.keyword) };
  if (action === "target" && result.outcome === "target-off-host") return { status: "target-off-host", keyword: keywordRowToKeyword(result.keyword) };
  throw new KeywordRowError(`the ${action} function answered "${String(result.outcome)}", which this product does not recognise.`);
}
