import { FINDINGS_LIMITATIONS, type CrawlFinding, type CrawlFindingsReport, type FindingRuleId } from "@/lib/crawl/findings/contract";
import { RULES } from "@/lib/crawl/findings/rules";
import type { JsonObject } from "@/types/agent-run";

/**
 * Deterministic crawl findings, serialised as evidence an agent may cite
 * (Technical SEO + On-Page SEO, checkpoint T2).
 *
 * Appended AFTER the crawl evidence, never in its place, for the two reviews
 * that read a crawl as the project's own pages: `crawl-review` and
 * `on-page-review`. Each finding is written as an observation by a fixed
 * rule — rule id, severity, the URLs it names, the exact recorded values,
 * one sentence — and the block ends with the T1 limitations, restated so
 * the model reads what a finding cannot mean beside the finding itself.
 *
 * Bounded: at most MAX_DESCRIBED_PER_RULE findings per rule, at most
 * MAX_URLS_DESCRIBED URLs per finding, and the whole block under
 * MAX_FINDINGS_EVIDENCE_BYTES. Findings are added in the report's own order
 * (severity, rule, URL) and the first that would not fit ends the list with
 * a note saying how many were cut; the coverage line and the limitations are
 * always kept. An empty report is one line that says no rule fired, and
 * that this is not a clean bill of health.
 */

export const MAX_FINDINGS_EVIDENCE_BYTES = 16_000;
export const MAX_DESCRIBED_PER_RULE = 10;
export const MAX_URLS_DESCRIBED = 5;
/** The most link edges read for one crawl's findings; the coverage line says when the read was cut. */
export const FINDINGS_LINK_LIMIT = 5_000;

export type CrawlFindingsGrounding = {
  readonly text: string;
  readonly summary: JsonObject & {
    readonly status: "available" | "unavailable";
    readonly ruleVersion: number;
    /** True total of findings the rules produced. */
    readonly findings: number;
    /** How many are written in the block. */
    readonly described: number;
    readonly rules: number;
    /** Rules cut to MAX_DESCRIBED_PER_RULE in the block. */
    readonly rulesCut: readonly string[];
    /** Findings cut by the byte ceiling after the per-rule cut. */
    readonly cutByBytes: number;
    readonly linksRead: number;
    readonly linksCut: boolean;
    readonly bytes: number;
  };
};

const encoder = new TextEncoder();
const byteLength = (text: string) => encoder.encode(text).length;

const HEADING = "DETERMINISTIC CRAWL FINDINGS (fixed rules this product applied to the pages and links this crawl recorded; observations, not a model's reading)";

export const FINDINGS_EVIDENCE_LIMITS_NOTE = [
  "LIMITS OF THESE FINDINGS",
  ...FINDINGS_LIMITATIONS.map((line) => `- ${line}`),
  "- A finding is an observation by a fixed rule. What it means and what to do about it is the reviewer's inference and recommendation, and must be marked as such.",
  "- Nothing here maps a search query to a page; no cannibalisation conclusion can be drawn from a crawl.",
].join("\n");

export const NO_FINDINGS_LINE =
  "No rule fired on the pages this crawl recorded. That is a statement about these rules over these pages, not a clean bill of health: pages not fetched were not examined.";

function observedText(finding: CrawlFinding): string {
  return Object.entries(finding.observed)
    .map(([key, value]) => `${key}=${value === null ? "null" : typeof value === "string" ? JSON.stringify(value) : String(value)}`)
    .join("; ");
}

/** One finding as one evidence line: rule id, severity, label, the URLs it names (bounded), the exact observed values, its sentence and its id. */
export function describeFinding(finding: CrawlFinding): string {
  const shown = finding.urls.slice(0, MAX_URLS_DESCRIBED);
  const more = finding.urlCount - shown.length;
  const urls = `${shown.join(", ")}${more > 0 ? ` (+${more} more of ${finding.urlCount})` : ""}`;
  return `- [${finding.rule}] ${finding.severity} · ${RULES[finding.rule].label} · ${urls} · observed: ${observedText(finding)} · ${finding.message} (id ${finding.id})`;
}

function coverageLine(report: CrawlFindingsReport, linksRead: number, linksCut: boolean): string {
  const c = report.coverage;
  return [
    `Coverage: ${c.pagesTotal} pages recorded (${c.pagesFetched} fetched and read, ${c.pagesNotFetched} not fetched, ${c.pagesNotReached} not reached within the budget); ${linksRead} link edges read${linksCut ? ` (cut at ${FINDINGS_LINK_LIMIT}; link findings may be incomplete)` : ""}; crawl ${c.status}${c.stopReason ? `, stopped on ${c.stopReason}` : ""}; robots.txt ${c.robotsState}; sitemap ${c.sitemapState}; host ${c.hostScope}; rule version ${report.ruleVersion}.`,
  ].join("");
}

export function formatCrawlFindingsGrounding(
  report: CrawlFindingsReport,
  links: { readonly read: number; readonly cut: boolean },
): CrawlFindingsGrounding {
  const total = Object.values(report.counts).reduce((sum, n) => sum + (n ?? 0), 0);
  const ruleIds = Object.keys(report.counts).sort() as FindingRuleId[];

  // Per-rule cut first, in the report's order.
  const perRule = new Map<FindingRuleId, number>();
  const candidates: CrawlFinding[] = [];
  const rulesCut = new Set<FindingRuleId>();
  for (const finding of report.findings) {
    const seen = (perRule.get(finding.rule) ?? 0) + 1;
    perRule.set(finding.rule, seen);
    if (seen <= MAX_DESCRIBED_PER_RULE) candidates.push(finding);
    else rulesCut.add(finding.rule);
  }
  for (const rule of report.truncatedRules) rulesCut.add(rule);

  const header = [
    HEADING,
    coverageLine(report, links.read, links.cut),
    `Findings: ${total} in total across ${ruleIds.length} rule(s)${ruleIds.length ? ` — ${ruleIds.map((rule) => `${rule} ×${report.counts[rule]}`).join(", ")}` : ""}.${rulesCut.size ? ` Rules shown at most ${MAX_DESCRIBED_PER_RULE} each: ${[...rulesCut].sort().join(", ")}.` : ""}`,
  ].join("\n");

  // Then the byte ceiling, with the limits note and a cut notice always fitting.
  const cutNote = (n: number) => `(${n} further finding(s) were cut to keep this evidence within its size bound; the counts above are complete)`;
  const reserved = byteLength(`\n\n${cutNote(candidates.length)}`) + byteLength(`\n\n${FINDINGS_EVIDENCE_LIMITS_NOTE}`);
  let bytes = byteLength(header);
  const lines: string[] = [];
  let cutByBytes = 0;
  for (const finding of candidates) {
    const line = describeFinding(finding);
    const cost = byteLength(line) + 1;
    if (bytes + cost + reserved > MAX_FINDINGS_EVIDENCE_BYTES) {
      cutByBytes = candidates.length - lines.length;
      break;
    }
    lines.push(line);
    bytes += cost;
  }

  const sections = [header, lines.length ? lines.join("\n") : total === 0 ? NO_FINDINGS_LINE : ""].filter(Boolean);
  if (cutByBytes > 0) sections.push(cutNote(cutByBytes));
  sections.push(FINDINGS_EVIDENCE_LIMITS_NOTE);
  const text = sections.join("\n\n");

  return {
    text,
    summary: {
      status: "available",
      ruleVersion: report.ruleVersion,
      findings: total,
      described: lines.length,
      rules: ruleIds.length,
      rulesCut: [...rulesCut].sort(),
      cutByBytes,
      linksRead: links.read,
      linksCut: links.cut,
      bytes: byteLength(text),
    },
  };
}

/** When the crawl's edges could not be read: the crawl evidence stands alone and says so. */
export function unavailableCrawlFindingsGrounding(): CrawlFindingsGrounding {
  const text = "DETERMINISTIC CRAWL FINDINGS: unavailable. The crawl's recorded link edges could not be read for this run, so no rule was applied. The crawl evidence above stands alone; do not infer findings in their place.";
  return {
    text,
    summary: { status: "unavailable", ruleVersion: 0, findings: 0, described: 0, rules: 0, rulesCut: [], cutByBytes: 0, linksRead: 0, linksCut: false, bytes: byteLength(text) },
  };
}
