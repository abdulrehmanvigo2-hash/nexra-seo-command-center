import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { FINDINGS_READ_LIMIT, type CrawlFindingsStore, type RecordCrawlFindingsOutcome } from "@/lib/crawl/findings/store-contract";
import {
  FINDING_READ_COLUMNS,
  findingRowToFinding,
  findingToArgument,
  recordResultToOutcome,
  REPORT_READ_COLUMNS,
  reportRowToHeader,
  type CrawlFindingsDatabase,
} from "@/lib/crawl/findings/supabase/schema";

/**
 * The findings store over `nexra_crawl_findings_reports` and
 * `nexra_crawl_findings`. A thin translation into Supabase calls: the
 * library computes, the service decides when, and the one database function
 * and the tables' constraints enforce the binding and the shape again for
 * any caller. The only write is that function; both reads are bounded and
 * scoped to one project and one crawl.
 */

export class CrawlFindingsStoreError extends Error {
  readonly code: string | null;

  constructor(operation: string, cause: PostgrestError | Error) {
    const code = "code" in cause && typeof cause.code === "string" ? cause.code : null;
    super(`Crawl findings store: ${operation} failed${code ? ` (${code})` : ""}: ${cause.message}`);
    this.name = "CrawlFindingsStoreError";
    this.code = code;
  }
}

export function createSupabaseCrawlFindingsStore(client: SupabaseClient<CrawlFindingsDatabase>): CrawlFindingsStore {
  return {
    storesFindings: true,

    // One function, one transaction; the unique key serialises two recordings of one crawl.
    async record(input): Promise<RecordCrawlFindingsOutcome> {
      const { report } = input;
      const { data, error } = await client.rpc("nexra_crawl_findings_record", {
        p_project_id: input.projectId,
        p_crawl_id: input.crawlId,
        p_rule_version: report.ruleVersion,
        p_pages_total: report.coverage.pagesTotal,
        p_pages_fetched: report.coverage.pagesFetched,
        p_pages_not_fetched: report.coverage.pagesNotFetched,
        p_pages_not_reached: report.coverage.pagesNotReached,
        p_links_read: input.links.read,
        p_links_cut: input.links.cut,
        p_counts: { ...report.counts },
        p_truncated_rules: [...report.truncatedRules],
        p_findings: report.findings.map(findingToArgument),
      });
      if (error) throw new CrawlFindingsStoreError("record crawl findings", error);
      return recordResultToOutcome(data);
    },

    // The newest report for the project's crawl, then its findings in recorded order.
    async getReport(projectId, crawlId) {
      const reports = await client
        .from("nexra_crawl_findings_reports")
        .select(REPORT_READ_COLUMNS)
        .eq("project_id", projectId)
        .eq("crawl_id", crawlId)
        .order("rule_version", { ascending: false })
        .limit(1);
      if (reports.error) throw new CrawlFindingsStoreError("read crawl findings report", reports.error);
      if (reports.data.length === 0) return null;
      const header = reportRowToHeader(reports.data[0]);

      const rows = await client
        .from("nexra_crawl_findings")
        .select(FINDING_READ_COLUMNS)
        .eq("project_id", projectId)
        .eq("report_id", header.id)
        .order("ordinal", { ascending: true })
        .limit(FINDINGS_READ_LIMIT);
      if (rows.error) throw new CrawlFindingsStoreError("read crawl findings", rows.error);
      return {
        header,
        findings: rows.data.map(findingRowToFinding),
        findingsTruncated: rows.data.length >= FINDINGS_READ_LIMIT,
      };
    },
  };
}
