import type { FindingTriage, SetFindingTriageInput, SetFindingTriageOutcome } from "@/lib/crawl/findings/triage/contract";

/**
 * What the crawl service needs from wherever triage decisions are kept
 * (milestone M3). Storage-agnostic, like the findings store: the one write
 * is the database's own `nexra_crawl_finding_triage_set`, which re-checks
 * that the crawl is the project's and the finding recorded before anything
 * is written; the one read is bounded and scoped to one project.
 */

/** The most decisions one read returns. A project's findings are read at most 3,000 at a time; this matches. */
export const TRIAGE_READ_LIMIT = 3_000;

export type CrawlFindingTriageStore = {
  /** Whether this store keeps decisions. The fixture data source does not. */
  readonly storesTriage: boolean;
  /** Every decision recorded for the project, newest first, at most `limit`. Never another project's. */
  listForProject(projectId: string, limit: number): Promise<readonly FindingTriage[]>;
  /** One decision, through the one database function. */
  set(input: SetFindingTriageInput): Promise<SetFindingTriageOutcome>;
};

/** The store used when findings are not persisted anywhere. It refuses rather than pretends. */
export const unavailableCrawlFindingTriageStore: CrawlFindingTriageStore = {
  storesTriage: false,
  async listForProject() {
    return [];
  },
  async set() {
    return { status: "not-found" };
  },
};
