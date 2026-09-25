/**
 * A project's latest recorded findings with the decisions recorded against
 * them, as plain data for the Technical SEO screen (milestone M3).
 *
 * The React component around this is a shell. Everything that could
 * misrepresent a finding or a decision — a finding with no decision shown as
 * anything but open, a cut list read as the whole, a decision made on an
 * older crawl shown without saying so — lives here, where `node --test`
 * reaches it without a DOM.
 *
 * The wording rule is the findings presenter's: every figure is "within this
 * crawl", never site-wide, and nothing here says anything about indexation,
 * rankings, traffic or vitals. A decision adds one more rule: it is what an
 * operator recorded, never what the site did.
 */

import { CATEGORY_LABEL, SEVERITY_LABEL, SEVERITY_ORDER, coverageLine, type Tone } from "@/lib/crawl/findings/present";
import { RULES } from "@/lib/crawl/findings/rules";
import type { FindingCategory, FindingRuleId, FindingSeverity } from "@/lib/crawl/findings/contract";
import type { StoredCrawlFinding, StoredCrawlFindingsReport } from "@/lib/crawl/findings/store-contract";
import { TRIAGE_STATUSES, TRIAGE_STATUS_META, type FindingTriage, type FindingTriageStatus } from "@/lib/crawl/findings/triage/contract";
import { pathOf } from "@/lib/crawl/pages-view";
import type { Crawl } from "@/types/crawl";

/** How many findings the screen lists. The true totals are always shown beside it. */
export const TRIAGE_LIST_LIMIT = 50;

export type TriagedFindingRow = {
  /** The library's stable key, which a decision is recorded against. */
  readonly key: string;
  readonly rule: FindingRuleId;
  readonly ruleLabel: string;
  readonly category: FindingCategory;
  readonly categoryLabel: string;
  readonly severity: FindingSeverity;
  readonly severityLabel: string;
  readonly severityTone: Tone;
  readonly message: string;
  readonly pages: readonly { readonly path: string; readonly url: string }[];
  readonly morePages: number;
  /** The recorded decision, or open with nothing recorded. */
  readonly status: FindingTriageStatus;
  readonly statusLabel: string;
  readonly statusTone: Tone;
  readonly note: string | null;
  /** When the decision was recorded, or null when none was. */
  readonly decidedAt: string | null;
  /** True when the decision was last made on an earlier crawl's finding with the same key. */
  readonly decidedOnEarlierCrawl: boolean;
};

export type TriageStatusCount = {
  readonly status: FindingTriageStatus;
  readonly label: string;
  readonly tone: Tone;
  /** Findings in this report with this status; open counts findings with no decision too. */
  readonly count: number;
};

export type TriagedFindingsView = {
  readonly crawl: {
    readonly id: string;
    readonly hostScope: string;
    readonly status: Crawl["status"];
    readonly startedAt: string;
    readonly finishedAt: string | null;
  };
  readonly recordedAt: string;
  readonly ruleVersion: number;
  /** Every severity, in fixed order, zeros included, from the true counts. */
  readonly severities: readonly { readonly severity: FindingSeverity; readonly label: string; readonly tone: Tone; readonly count: number }[];
  /** Every status, in fixed order, over the findings that were read. */
  readonly statuses: readonly TriageStatusCount[];
  /** The true number of findings recorded. */
  readonly total: number;
  /** How many were read from the store. */
  readonly read: number;
  /** How many are listed below. */
  readonly listed: number;
  readonly coverage: string;
  /** In recorded order (severity, rule, first URL), at most TRIAGE_LIST_LIMIT. */
  readonly rows: readonly TriagedFindingRow[];
  /** What was cut, and where the true totals are. Empty when nothing was cut. */
  readonly notes: readonly string[];
  readonly provenance: string;
};

export const TRIAGED_FINDINGS_PROVENANCE_NOTE =
  "Observed by this product's own crawl and computed by fixed rules when the crawl finished; decisions are what an operator recorded, never what the site did. Every count is within this crawl, not site-wide. Nothing here says whether a page is indexed, how it ranks, what traffic it gets, or how it performs for users; nothing here is fixture data.";

/** A rule the stored row names that this build does not know: shown by its id, never dropped. */
function ruleLabel(rule: FindingRuleId): string {
  return rule in RULES ? RULES[rule].label : rule;
}

function row(finding: StoredCrawlFinding, crawlId: string, decision: FindingTriage | undefined): TriagedFindingRow {
  const status = decision?.status ?? "open";
  return {
    key: finding.id,
    rule: finding.rule,
    ruleLabel: ruleLabel(finding.rule),
    category: finding.category,
    categoryLabel: CATEGORY_LABEL[finding.category],
    severity: finding.severity,
    severityLabel: SEVERITY_LABEL[finding.severity].label,
    severityTone: SEVERITY_LABEL[finding.severity].tone,
    message: finding.message,
    pages: finding.urls.map((url) => ({ path: pathOf(url), url })),
    morePages: Math.max(0, finding.urlCount - finding.urls.length),
    status,
    statusLabel: TRIAGE_STATUS_META[status].label,
    statusTone: TRIAGE_STATUS_META[status].tone,
    note: decision?.note ?? null,
    decidedAt: decision?.setAt ?? null,
    decidedOnEarlierCrawl: decision !== undefined && decision.crawlId !== crawlId,
  };
}

export function presentTriagedFindings(
  crawl: Crawl,
  report: StoredCrawlFindingsReport,
  triage: readonly FindingTriage[],
  limit: number = TRIAGE_LIST_LIMIT,
): TriagedFindingsView {
  const { header } = report;
  // Decisions are keyed by project and finding key; the store answers one
  // project's rows only, and a row for another crawl of the same project is
  // exactly what carries a decision forward to this crawl's finding.
  const byKey = new Map<string, FindingTriage>();
  for (const decision of triage) if (decision.projectId === header.projectId) byKey.set(decision.findingKey, decision);

  const rows = report.findings.slice(0, Math.max(0, limit)).map((finding) => row(finding, crawl.id, byKey.get(finding.id)));

  const statusCounts = new Map<FindingTriageStatus, number>(TRIAGE_STATUSES.map((status) => [status, 0]));
  for (const finding of report.findings) {
    const status = byKey.get(finding.id)?.status ?? "open";
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
  }

  const severityCounts = new Map<FindingSeverity, number>(SEVERITY_ORDER.map((severity) => [severity, 0]));
  for (const [rule, count] of Object.entries(header.counts) as [FindingRuleId, number | undefined][]) {
    if (!(rule in RULES) || typeof count !== "number" || count <= 0) continue;
    const severity = RULES[rule].severity;
    severityCounts.set(severity, (severityCounts.get(severity) ?? 0) + count);
  }

  const notes: string[] = [];
  if (report.findingsTruncated) {
    notes.push(`Only the first ${report.findings.length} of ${header.findingsTotal} recorded findings were read; the status counts cover those. The severity counts are the true totals within this crawl.`);
  }
  if (rows.length < report.findings.length) {
    notes.push(`The ${rows.length} most severe findings are listed; ${report.findings.length - rows.length} more were read. Open the crawl on the project's page for the full report.`);
  }
  if (header.truncatedRules.length > 0) {
    notes.push(`${header.truncatedRules.map((rule) => ruleLabel(rule as FindingRuleId)).join(", ")}: only the first findings per rule were recorded. The severity counts are the true totals within this crawl.`);
  }
  if (header.linksCut) notes.push("The link edges were cut at the read limit when the findings were computed, so link findings may be incomplete.");

  return {
    crawl: { id: crawl.id, hostScope: crawl.hostScope, status: crawl.status, startedAt: crawl.startedAt, finishedAt: crawl.finishedAt },
    recordedAt: header.recordedAt,
    ruleVersion: header.ruleVersion,
    severities: SEVERITY_ORDER.map((severity) => ({ severity, ...SEVERITY_LABEL[severity], count: severityCounts.get(severity) ?? 0 })),
    statuses: TRIAGE_STATUSES.map((status) => ({ status, label: TRIAGE_STATUS_META[status].label, tone: TRIAGE_STATUS_META[status].tone, count: statusCounts.get(status) ?? 0 })),
    total: header.findingsTotal,
    read: report.findings.length,
    listed: rows.length,
    coverage: coverageLine(header),
    rows,
    notes,
    provenance: TRIAGED_FINDINGS_PROVENANCE_NOTE,
  };
}

/** A project with no recorded findings at all. Says what did not happen; never that the site is clean. */
export const NO_RECORDED_FINDINGS_WORDING =
  "No crawl of this project has recorded findings yet. Findings are recorded when one of this product's own crawls of the project's site finishes; run one from the project's page. This says nothing about the site.";

/** The deployment keeps no crawls, so there are no recorded findings to show. */
export const LATEST_FINDINGS_UNAVAILABLE_WORDING =
  "Recorded findings are not stored on this deployment, so none can be shown here.";
