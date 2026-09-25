import type { CrawlFinding, CrawlFindingsCoverage, CrawlFindingsReport, FindingRuleId } from "@/lib/crawl/findings/contract";

/**
 * What the crawl service needs from wherever recorded findings are kept
 * (Technical SEO + On-Page SEO, checkpoint T3).
 *
 * Storage-agnostic, like the crawl store: the library computes, the
 * service decides when, and the one database function
 * (`nexra_crawl_findings_record`, migration 20260928120000) re-checks that
 * the crawl is the project's and finished before anything is written.
 * A report is recorded once per crawl and rule version and never changed.
 */

export type RecordCrawlFindingsInput = {
  readonly projectId: string;
  readonly crawlId: string;
  readonly report: CrawlFindingsReport;
  /** How many edges the findings were computed over, and whether that read hit its limit. */
  readonly links: { readonly read: number; readonly cut: boolean };
};

/** A recorded report's header, as the database holds it. */
export type StoredCrawlFindingsReportHeader = {
  readonly id: string;
  readonly crawlId: string;
  readonly projectId: string;
  readonly ruleVersion: number;
  readonly coverage: Pick<CrawlFindingsCoverage, "pagesTotal" | "pagesFetched" | "pagesNotFetched" | "pagesNotReached">;
  readonly linksRead: number;
  readonly linksCut: boolean;
  readonly findingsTotal: number;
  readonly counts: Readonly<Partial<Record<string, number>>>;
  readonly truncatedRules: readonly string[];
  readonly recordedAt: string;
};

/** A recorded finding: the library's finding plus its stored identity. */
export type StoredCrawlFinding = CrawlFinding & {
  readonly ordinal: number;
};

export type StoredCrawlFindingsReport = {
  readonly header: StoredCrawlFindingsReportHeader;
  /** In the report's recorded order; cut at the read limit, with the true total in the header. */
  readonly findings: readonly StoredCrawlFinding[];
  readonly findingsTruncated: boolean;
};

export type RecordCrawlFindingsOutcome =
  | { readonly status: "created"; readonly header: StoredCrawlFindingsReportHeader; readonly findings: number }
  /** That crawl and rule version were already recorded; nothing written. */
  | { readonly status: "exists"; readonly header: StoredCrawlFindingsReportHeader }
  | { readonly status: "not-found" | "wrong-project" | "not-reviewable" };

export const FINDINGS_READ_LIMIT = 3_000;

export type CrawlFindingsStore = {
  /** Whether this store keeps findings. The fixture data source does not. */
  readonly storesFindings: boolean;
  /** One report and its findings, in one transaction, through the one database function. */
  record(input: RecordCrawlFindingsInput): Promise<RecordCrawlFindingsOutcome>;
  /** The newest report recorded for the project's crawl, or null. Never another project's. */
  getReport(projectId: string, crawlId: string): Promise<StoredCrawlFindingsReport | null>;
  /**
   * The header of the most recently recorded report across all of the
   * project's crawls, or null when none was ever recorded. The header only:
   * the caller reads the report through `getReport` once it knows the crawl.
   */
  getLatestReportHeader(projectId: string): Promise<StoredCrawlFindingsReportHeader | null>;
};

/** The store used when crawls are not persisted anywhere. It refuses rather than pretends. */
export const unavailableCrawlFindingsStore: CrawlFindingsStore = {
  storesFindings: false,
  async record() {
    return { status: "not-found" };
  },
  async getReport() {
    return null;
  },
  async getLatestReportHeader() {
    return null;
  },
};

export type { FindingRuleId };
