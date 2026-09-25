/**
 * One crawl's recorded findings, as plain data for a panel (checkpoint T4).
 *
 * The React component around this is a shell: it owns a fetch and some
 * markup. Everything that could misrepresent a finding — a true count shown
 * as the rows on screen, a cut list read as the whole, an absent observed
 * value shown as a zero, an empty report read as a clean site — lives here,
 * where `node --test` reaches it without a DOM.
 *
 * The rule the wording follows: every figure is "within this crawl", never
 * site-wide, and no line says anything about indexation, rankings or
 * traffic, because the rules that produced the findings cannot observe them.
 */

import { pathOf } from "@/lib/crawl/pages-view";
import type { FindingCategory, FindingRuleId, FindingSeverity, ObservedValue } from "@/lib/crawl/findings/contract";
import { MAX_FINDINGS_PER_RULE } from "@/lib/crawl/findings/contract";
import { RULES } from "@/lib/crawl/findings/rules";
import type { StoredCrawlFinding, StoredCrawlFindingsReport, StoredCrawlFindingsReportHeader } from "@/lib/crawl/findings/store-contract";
import type { CrawlStatus } from "@/types/crawl";

export type Tone = "neutral" | "accent" | "positive" | "warning" | "critical";

export const SEVERITY_ORDER: readonly FindingSeverity[] = ["critical", "high", "medium", "low"];

export const SEVERITY_LABEL: Readonly<Record<FindingSeverity, { readonly label: string; readonly tone: Tone }>> = {
  critical: { label: "Critical", tone: "critical" },
  high: { label: "High", tone: "warning" },
  medium: { label: "Medium", tone: "neutral" },
  low: { label: "Low", tone: "neutral" },
};

export const CATEGORY_LABEL: Readonly<Record<FindingCategory, string>> = {
  metadata: "Metadata",
  headings: "Headings",
  canonical: "Canonical",
  http: "HTTP",
  redirects: "Redirects",
  links: "Links",
  indexability: "Indexability",
  sitemap: "Sitemap",
  structure: "Structure",
  schema: "Structured data",
  images: "Images",
  content: "Content",
};

/** Shown wherever an observed value was not established. Never a zero. */
export const UNKNOWN = "—";

export type ObservedEntry = {
  readonly key: string;
  readonly text: string;
  /** Hover text; always present where `text` is the unknown marker. */
  readonly title?: string;
};

/**
 * The observed values behind a finding, in the order the rule recorded them.
 * A null is what the crawl could not establish, shown as such — it never
 * becomes 0, false or an empty string.
 */
export function observedEntries(observed: Readonly<Record<string, ObservedValue>>): readonly ObservedEntry[] {
  return Object.entries(observed).map(([key, value]) => {
    const label = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
    if (value === null) return { key: label, text: UNKNOWN, title: "Not established — the crawl did not record this value." };
    if (typeof value === "boolean") return { key: label, text: value ? "Yes" : "No" };
    return { key: label, text: String(value) };
  });
}

export type FindingRow = {
  readonly id: string;
  readonly message: string;
  /** The URLs the finding names, at most the stored 25, as paths for a dense list. */
  readonly pages: readonly { readonly path: string; readonly url: string }[];
  /** How many more URLs the finding is about than are listed. */
  readonly morePages: number;
  readonly observed: readonly ObservedEntry[];
};

export type RuleGroup = {
  readonly rule: FindingRuleId;
  readonly label: string;
  readonly category: FindingCategory;
  readonly categoryLabel: string;
  /** The true total for this rule within the crawl, from the report header. */
  readonly count: number;
  /** How many of them are on screen. */
  readonly shown: number;
  /** True when fewer are on screen than exist: cut when recorded, or cut at the read limit. */
  readonly cut: boolean;
  readonly findings: readonly FindingRow[];
};

export type SeverityGroup = {
  readonly severity: FindingSeverity;
  readonly label: string;
  readonly tone: Tone;
  /** The true total across this severity's rules. */
  readonly count: number;
  readonly rules: readonly RuleGroup[];
};

export type SeveritySummary = {
  readonly severity: FindingSeverity;
  readonly label: string;
  readonly tone: Tone;
  readonly count: number;
};

export type FindingsView = {
  readonly recordedAt: string;
  readonly ruleVersion: number;
  /** Every severity, in fixed order, zeros included, from the true counts. */
  readonly summary: readonly SeveritySummary[];
  /** The true number of findings recorded. */
  readonly total: number;
  /** How many findings are on screen. */
  readonly shown: number;
  /** What the rules could and could not look at, in one line. */
  readonly coverage: string;
  /** Non-empty severities only, in fixed order. */
  readonly groups: readonly SeverityGroup[];
  /** What was cut, and where the true totals are. Empty when nothing was cut. */
  readonly notes: readonly string[];
  readonly provenance: string;
};

const RULE_COUNT = Object.keys(RULES).length;

export const FINDINGS_PROVENANCE_NOTE =
  "Observed by this product's own crawl and computed by fixed rules when the crawl finished. Every count is within this crawl, not site-wide. Nothing here says whether a page is indexed, how it ranks, what traffic it gets, or how it performs for users; nothing here is fixture data.";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The true count for a rule: the header's total, or — for a header that lacks it — the rows themselves. */
function ruleTotal(header: StoredCrawlFindingsReportHeader, rule: FindingRuleId, shown: number): number {
  const recorded = header.counts[rule];
  return typeof recorded === "number" && recorded >= shown ? recorded : shown;
}

function findingRow(finding: StoredCrawlFinding): FindingRow {
  return {
    id: finding.id,
    message: finding.message,
    pages: finding.urls.map((url) => ({ path: pathOf(url), url })),
    morePages: Math.max(0, finding.urlCount - finding.urls.length),
    observed: observedEntries(finding.observed),
  };
}

export function coverageLine(header: StoredCrawlFindingsReportHeader): string {
  const { pagesTotal, pagesFetched, pagesNotFetched, pagesNotReached } = header.coverage;
  const links = `${plural(header.linksRead, "link edge")} read${header.linksCut ? ", cut at the read limit" : ""}`;
  return `${pagesFetched} of ${plural(pagesTotal, "recorded page")} fetched; ${pagesNotFetched} not fetched and ${pagesNotReached} not reached were not looked at. ${links}.`;
}

export function presentFindings(report: StoredCrawlFindingsReport): FindingsView {
  const { header } = report;

  // Recorded order is severity, then rule, then first URL, so grouping while
  // walking keeps it without sorting again.
  const bySeverity = new Map<FindingSeverity, Map<FindingRuleId, StoredCrawlFinding[]>>();
  for (const finding of report.findings) {
    const rules = bySeverity.get(finding.severity) ?? new Map<FindingRuleId, StoredCrawlFinding[]>();
    bySeverity.set(finding.severity, rules);
    const rows = rules.get(finding.rule) ?? [];
    rules.set(finding.rule, rows);
    rows.push(finding);
  }

  // A rule whose rows were all cut at the read limit still has a true count.
  const countedRules = new Map<FindingSeverity, Set<FindingRuleId>>();
  for (const [rule, count] of Object.entries(header.counts) as [FindingRuleId, number | undefined][]) {
    if (!(rule in RULES) || typeof count !== "number" || count <= 0) continue;
    const severity = RULES[rule].severity;
    const set = countedRules.get(severity) ?? new Set<FindingRuleId>();
    countedRules.set(severity, set);
    set.add(rule);
  }

  const groups: SeverityGroup[] = [];
  const summary: SeveritySummary[] = [];
  for (const severity of SEVERITY_ORDER) {
    const shownRules = bySeverity.get(severity) ?? new Map<FindingRuleId, StoredCrawlFinding[]>();
    const ruleIds = [...shownRules.keys()];
    for (const rule of countedRules.get(severity) ?? []) if (!ruleIds.includes(rule)) ruleIds.push(rule);

    const rules: RuleGroup[] = ruleIds.map((rule) => {
      const rows = shownRules.get(rule) ?? [];
      const count = ruleTotal(header, rule, rows.length);
      return {
        rule,
        label: RULES[rule].label,
        category: RULES[rule].category,
        categoryLabel: CATEGORY_LABEL[RULES[rule].category],
        count,
        shown: rows.length,
        cut: count > rows.length,
        findings: rows.map(findingRow),
      };
    });
    const count = rules.reduce((sum, group) => sum + group.count, 0);
    summary.push({ severity, ...SEVERITY_LABEL[severity], count });
    if (rules.length > 0) groups.push({ severity, ...SEVERITY_LABEL[severity], count, rules });
  }

  const notes: string[] = [];
  if (report.findingsTruncated) {
    notes.push(
      `Only the first ${report.findings.length} of ${report.header.findingsTotal} recorded findings were read. The count beside each rule is the true total within this crawl.`,
    );
  }
  if (header.truncatedRules.length > 0) {
    const labels = header.truncatedRules.map((rule) => (rule in RULES ? RULES[rule as FindingRuleId].label : rule));
    notes.push(
      `${labels.join(", ")}: only the first ${MAX_FINDINGS_PER_RULE} findings per rule were recorded. The count beside the rule is the true total within this crawl.`,
    );
  }
  if (header.linksCut) {
    notes.push("The link edges were cut at the read limit when the findings were computed, so link findings may be incomplete.");
  }

  return {
    recordedAt: header.recordedAt,
    ruleVersion: header.ruleVersion,
    summary,
    total: header.findingsTotal,
    shown: report.findings.length,
    coverage: coverageLine(header),
    groups,
    notes,
    provenance: FINDINGS_PROVENANCE_NOTE,
  };
}

/**
 * A report with no findings. Said carefully: the rules matched nothing
 * within what was fetched, which is not a clean result for the site.
 */
export function noFindingsWording(header: StoredCrawlFindingsReportHeader): string {
  const { pagesFetched, pagesNotFetched, pagesNotReached } = header.coverage;
  const unseen = pagesNotFetched + pagesNotReached;
  return `None of the ${RULE_COUNT} rules matched within the ${plural(pagesFetched, "page")} this crawl fetched.${
    unseen > 0 ? ` ${plural(unseen, "recorded page")} not fetched or not reached were not looked at.` : ""
  } This is not a clean result for the site, and it says nothing about indexation or rankings.`;
}

/**
 * Why a crawl the project owns has no recorded findings. Each line says
 * what did not happen; none of them says the site has no issues.
 */
export function notRecordedWording(status: CrawlStatus): string {
  switch (status) {
    case "running":
      return "Findings are recorded when a crawl finishes. This crawl is still running.";
    case "failed":
      return "This crawl failed before it finished, so no findings were recorded. Nothing about the site was established.";
    case "cancelled":
      return "This crawl was cancelled, so no findings were recorded.";
    case "completed":
    case "partial":
      return "No findings are recorded for this crawl. Findings are kept for crawls finished since they were introduced; run a new crawl to record them.";
  }
}

/** The deployment's store keeps no findings, so the panel cannot show any. */
export const FINDINGS_UNAVAILABLE_WORDING =
  "Findings are not stored on this deployment, so none could be recorded when the crawl finished.";
