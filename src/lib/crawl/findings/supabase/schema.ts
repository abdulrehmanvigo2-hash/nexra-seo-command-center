import { MAX_URLS_PER_FINDING, type CrawlFinding, type FindingCategory, type FindingRuleId, type FindingSeverity, type ObservedValue } from "@/lib/crawl/findings/contract";
import { RULES } from "@/lib/crawl/findings/rules";
import type { RecordCrawlFindingsOutcome, StoredCrawlFinding, StoredCrawlFindingsReportHeader } from "@/lib/crawl/findings/store-contract";

/**
 * The shape of `nexra_crawl_findings_reports` and `nexra_crawl_findings`,
 * of what `nexra_crawl_findings_record` answers, and the translation into
 * the application's types. The tables grant no INSERT, UPDATE or DELETE:
 * the function is the only way in, so no write type exists here. A row
 * that does not match what the migration declares is refused at read time
 * rather than passed on.
 */

export class CrawlFindingRowError extends Error {
  constructor(message: string) {
    super(`Crawl finding row: ${message}`);
    this.name = "CrawlFindingRowError";
  }
}

export type CrawlFindingsReportRow = {
  id: string;
  crawl_id: string;
  project_id: string;
  rule_version: number;
  pages_total: number;
  pages_fetched: number;
  pages_not_fetched: number;
  pages_not_reached: number;
  links_read: number;
  links_cut: boolean;
  findings_total: number;
  counts: unknown;
  truncated_rules: string[];
  recorded_at: string;
};

export type CrawlFindingRow = {
  id: string;
  report_id: string;
  crawl_id: string;
  project_id: string;
  finding_key: string;
  rule: string;
  category: string;
  severity: string;
  urls: string[];
  url_count: number;
  observed: unknown;
  message: string;
  ordinal: number;
};

type ReadOnly<Row> = { Row: Row; Insert: never; Update: never; Relationships: [] };

export type CrawlFindingsDatabase = {
  public: {
    Tables: {
      nexra_crawl_findings_reports: ReadOnly<CrawlFindingsReportRow>;
      nexra_crawl_findings: ReadOnly<CrawlFindingRow>;
    };
    Views: { [_ in never]: never };
    Functions: {
      nexra_crawl_findings_record: {
        Args: {
          p_project_id: string;
          p_crawl_id: string;
          p_rule_version: number;
          p_pages_total: number;
          p_pages_fetched: number;
          p_pages_not_fetched: number;
          p_pages_not_reached: number;
          p_links_read: number;
          p_links_cut: boolean;
          p_counts: unknown;
          p_truncated_rules: string[];
          p_findings: unknown;
        };
        Returns: unknown;
      };
    };
  };
};

export const REPORT_READ_COLUMNS =
  "id, crawl_id, project_id, rule_version, pages_total, pages_fetched, pages_not_fetched, pages_not_reached, links_read, links_cut, findings_total, counts, truncated_rules, recorded_at";
export const FINDING_READ_COLUMNS = "id, report_id, crawl_id, project_id, finding_key, rule, category, severity, urls, url_count, observed, message, ordinal";

const CATEGORIES: readonly FindingCategory[] = ["metadata", "headings", "canonical", "http", "redirects", "links", "indexability", "sitemap", "structure", "schema"];
const SEVERITIES: readonly FindingSeverity[] = ["critical", "high", "medium", "low"];

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new CrawlFindingRowError(`${what} is not an object.`);
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string): string {
  if (typeof value !== "string") throw new CrawlFindingRowError(`${field} is not a string.`);
  return value;
}
function integer(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) throw new CrawlFindingRowError(`${field} is not an integer.`);
  return value;
}
function bool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new CrawlFindingRowError(`${field} is not a boolean.`);
  return value;
}
function strings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) throw new CrawlFindingRowError(`${field} is not a list of strings.`);
  return value as string[];
}

function countsOf(value: unknown): Readonly<Partial<Record<string, number>>> {
  const counts = record(value, "counts");
  const out: Partial<Record<string, number>> = {};
  for (const [rule, n] of Object.entries(counts)) out[rule] = integer(n, `counts.${rule}`);
  return out;
}

function observedOf(value: unknown): Readonly<Record<string, ObservedValue>> {
  const observed = record(value, "observed");
  const out: Record<string, ObservedValue> = {};
  for (const [key, v] of Object.entries(observed)) {
    if (v !== null && typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") throw new CrawlFindingRowError(`observed.${key} is not a scalar.`);
    out[key] = v;
  }
  return out;
}

export function reportRowToHeader(row: unknown): StoredCrawlFindingsReportHeader {
  const r = record(row, "the report row");
  return {
    id: text(r.id, "id"),
    crawlId: text(r.crawl_id, "crawl_id"),
    projectId: text(r.project_id, "project_id"),
    ruleVersion: integer(r.rule_version, "rule_version"),
    coverage: {
      pagesTotal: integer(r.pages_total, "pages_total"),
      pagesFetched: integer(r.pages_fetched, "pages_fetched"),
      pagesNotFetched: integer(r.pages_not_fetched, "pages_not_fetched"),
      pagesNotReached: integer(r.pages_not_reached, "pages_not_reached"),
    },
    linksRead: integer(r.links_read, "links_read"),
    linksCut: bool(r.links_cut, "links_cut"),
    findingsTotal: integer(r.findings_total, "findings_total"),
    counts: countsOf(r.counts),
    truncatedRules: strings(r.truncated_rules, "truncated_rules"),
    recordedAt: text(r.recorded_at, "recorded_at"),
  };
}

export function findingRowToFinding(row: unknown): StoredCrawlFinding {
  const r = record(row, "the finding row");
  const rule = text(r.rule, "rule");
  if (!Object.hasOwn(RULES, rule)) throw new CrawlFindingRowError(`rule "${rule}" is not one this product knows.`);
  const category = text(r.category, "category");
  if (!CATEGORIES.includes(category as FindingCategory)) throw new CrawlFindingRowError(`category "${category}" is not one this product knows.`);
  const severity = text(r.severity, "severity");
  if (!SEVERITIES.includes(severity as FindingSeverity)) throw new CrawlFindingRowError(`severity "${severity}" is not one this product knows.`);
  const urls = strings(r.urls, "urls");
  if (urls.length < 1 || urls.length > MAX_URLS_PER_FINDING) throw new CrawlFindingRowError("urls is out of range.");
  const key = text(r.finding_key, "finding_key");
  if (!key.startsWith(`${rule}:`)) throw new CrawlFindingRowError("finding_key does not name its rule.");
  return {
    id: key,
    rule: rule as FindingRuleId,
    category: category as FindingCategory,
    severity: severity as FindingSeverity,
    urls,
    urlCount: integer(r.url_count, "url_count"),
    observed: observedOf(r.observed),
    message: text(r.message, "message"),
    ordinal: integer(r.ordinal, "ordinal"),
  };
}

/** What the function answers, checked field by field: a shape it did not promise is an error, not a guess. */
export function recordResultToOutcome(data: unknown): RecordCrawlFindingsOutcome {
  const result = record(data, "the function's answer");
  switch (result.outcome) {
    case "created":
      return { status: "created", header: reportRowToHeader(result.report), findings: integer(result.findings, "findings") };
    case "exists":
      return { status: "exists", header: reportRowToHeader(result.report) };
    case "not-found":
    case "wrong-project":
    case "not-reviewable":
      return { status: result.outcome };
    default:
      throw new CrawlFindingRowError(`the function answered "${String(result.outcome)}", which this product does not recognise.`);
  }
}

/** A library finding as the record function takes it. */
export function findingToArgument(finding: CrawlFinding): Record<string, unknown> {
  return {
    key: finding.id,
    rule: finding.rule,
    category: finding.category,
    severity: finding.severity,
    urls: [...finding.urls],
    urlCount: finding.urlCount,
    observed: { ...finding.observed },
    message: finding.message,
  };
}
