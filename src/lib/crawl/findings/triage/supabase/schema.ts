import { isTriageStatus, type FindingTriage, type SetFindingTriageOutcome } from "@/lib/crawl/findings/triage/contract";

/**
 * The shape of `nexra_crawl_finding_triage`, of what
 * `nexra_crawl_finding_triage_set` answers, and the translation into the
 * application's types. The table grants no INSERT, UPDATE or DELETE: the
 * function is the only way in, so no write type exists here. A row that
 * does not match what the migration declares is refused at read time rather
 * than passed on.
 */

export class CrawlFindingTriageRowError extends Error {
  constructor(message: string) {
    super(`Crawl finding triage row: ${message}`);
    this.name = "CrawlFindingTriageRowError";
  }
}

export type CrawlFindingTriageRow = {
  id: string;
  project_id: string;
  finding_key: string;
  rule: string;
  finding_id: string;
  report_id: string;
  crawl_id: string;
  status: string;
  note: string | null;
  set_by: string;
  set_at: string;
  created_at: string;
};

type ReadOnly<Row> = { Row: Row; Insert: never; Update: never; Relationships: [] };

export type CrawlFindingTriageDatabase = {
  public: {
    Tables: {
      nexra_crawl_finding_triage: ReadOnly<CrawlFindingTriageRow>;
    };
    Views: { [_ in never]: never };
    Functions: {
      nexra_crawl_finding_triage_set: {
        Args: {
          p_project_id: string;
          p_crawl_id: string;
          p_finding_key: string;
          p_status: string;
          p_note: string | null;
          p_operator: string;
        };
        Returns: unknown;
      };
    };
  };
};

export const TRIAGE_READ_COLUMNS = "id, project_id, finding_key, rule, finding_id, report_id, crawl_id, status, note, set_by, set_at, created_at";

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new CrawlFindingTriageRowError(`${what} is not an object.`);
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string): string {
  if (typeof value !== "string") throw new CrawlFindingTriageRowError(`${field} is not a string.`);
  return value;
}

export function triageRowToTriage(row: unknown): FindingTriage {
  const r = record(row, "the triage row");
  const status = text(r.status, "status");
  if (!isTriageStatus(status)) throw new CrawlFindingTriageRowError(`status "${status}" is not one this product knows.`);
  const key = text(r.finding_key, "finding_key");
  const rule = text(r.rule, "rule");
  if (!key.startsWith(`${rule}:`)) throw new CrawlFindingTriageRowError("finding_key does not name its rule.");
  if (r.note !== null && typeof r.note !== "string") throw new CrawlFindingTriageRowError("note is neither text nor null.");
  return {
    id: text(r.id, "id"),
    projectId: text(r.project_id, "project_id"),
    findingKey: key,
    rule,
    findingId: text(r.finding_id, "finding_id"),
    reportId: text(r.report_id, "report_id"),
    crawlId: text(r.crawl_id, "crawl_id"),
    status,
    note: r.note,
    setBy: text(r.set_by, "set_by"),
    setAt: text(r.set_at, "set_at"),
    createdAt: text(r.created_at, "created_at"),
  };
}

/** What the function answers, checked field by field: a shape it did not promise is an error, not a guess. */
export function setResultToOutcome(data: unknown): SetFindingTriageOutcome {
  const result = record(data, "the function's answer");
  switch (result.outcome) {
    case "set": {
      const previous = result.previous;
      if (previous !== null && previous !== undefined && !isTriageStatus(previous)) {
        throw new CrawlFindingTriageRowError(`previous status "${String(previous)}" is not one this product knows.`);
      }
      return { status: "set", previous: previous ?? null, triage: triageRowToTriage(result.triage) };
    }
    case "not-found":
    case "not-recorded":
      return { status: result.outcome };
    default:
      throw new CrawlFindingTriageRowError(`the function answered "${String(result.outcome)}", which this product does not recognise.`);
  }
}
