import { type CrawlFinding, type FindingRuleId } from "@/lib/crawl/findings/contract";
import { RULES } from "@/lib/crawl/findings/rules";
import {
  FINDINGS_EVIDENCE_LIMITS_NOTE,
  MAX_DESCRIBED_PER_RULE,
  MAX_FINDINGS_EVIDENCE_BYTES,
  describeFinding,
} from "@/lib/crawl/findings/grounding";
import type { CrawlFindingsRead } from "@/lib/crawl/service";
import type { JsonObject } from "@/types/agent-run";

/**
 * The findings this product recorded for one crawl, serialised as evidence
 * for the SEO Director's `priority-review` (Technical SEO + On-Page SEO,
 * checkpoint T6).
 *
 * Appended AFTER the quoted upstream review, never in its place, and only
 * when that review was written over a crawl this product recorded. The two
 * blocks are different kinds of thing and the wording keeps them apart: the
 * review is a model's inference; a recorded finding is an observation by a
 * fixed rule, stored when the crawl finished (T3), read back from the
 * database by project and crawl and never recomputed here. The Director may
 * rank an action on a recorded finding by its rule id and URL, and must mark
 * it OBSERVED; anything resting on the review alone is PROPOSED.
 *
 * Bounded like the T2 block: at most MAX_DESCRIBED_PER_RULE findings per
 * rule, the whole block under MAX_FINDINGS_EVIDENCE_BYTES, the true counts
 * always given. Nothing recorded is one fixed line that says so, and says
 * not to infer findings in their place.
 */

const HEADING =
  "RECORDED CRAWL FINDINGS (observations by fixed rules this product applied when the crawl the review above was written from finished; read from this product's own records, not from the review, and not a model's reading)";

export const NO_RECORDED_FINDINGS_NOTE: Readonly<Record<Exclude<CrawlFindingsRead["status"], "recorded">, string>> = {
  unavailable:
    "RECORDED CRAWL FINDINGS: none available. This deployment does not keep recorded findings, so none were read. Rank nothing on findings; the review above stands alone, as a model's inference.",
  "not-found":
    "RECORDED CRAWL FINDINGS: none available. The crawl the review names is not one this project recorded, so no findings were read. Rank nothing on findings; the review above stands alone, as a model's inference.",
  "not-recorded":
    "RECORDED CRAWL FINDINGS: none recorded for this crawl. It finished before findings were kept, or did not finish, so no rule's observations exist for it. This is not a statement that the site has no issues. Rank nothing on findings; the review above stands alone, as a model's inference.",
};

export const NO_RECORDED_FINDING_FIRED_LINE =
  "No rule fired on the pages this crawl recorded. That is a statement about these rules over these pages, not a clean bill of health: pages not fetched were not examined, and the review above may still name things the rules do not check.";

export type RecordedFindingsGrounding = {
  readonly text: string;
  readonly summary: JsonObject & {
    readonly status: CrawlFindingsRead["status"];
    readonly crawlId: string;
    readonly reportId: string | null;
    readonly ruleVersion: number;
    readonly recordedAt: string | null;
    /** True total of findings recorded. */
    readonly findings: number;
    /** How many are written in the block. */
    readonly described: number;
    readonly rules: number;
    readonly rulesCut: readonly string[];
    readonly cutByBytes: number;
    /** Whether the read itself was cut at the store's limit. */
    readonly readCut: boolean;
    readonly bytes: number;
  };
};

const encoder = new TextEncoder();
const byteLength = (text: string) => encoder.encode(text).length;

function labelOf(rule: string): string {
  return rule in RULES ? RULES[rule as FindingRuleId].label : rule;
}

export function formatRecordedFindingsGrounding(crawlId: string, read: CrawlFindingsRead): RecordedFindingsGrounding {
  if (read.status !== "recorded") {
    const text = NO_RECORDED_FINDINGS_NOTE[read.status];
    return {
      text,
      summary: { status: read.status, crawlId, reportId: null, ruleVersion: 0, recordedAt: null, findings: 0, described: 0, rules: 0, rulesCut: [], cutByBytes: 0, readCut: false, bytes: byteLength(text) },
    };
  }

  const { header, findings, findingsTruncated } = read.report;
  const { crawl } = read;
  const ruleIds = Object.keys(header.counts).sort();
  const total = header.findingsTotal;

  // Per-rule cut first, in the recorded order (severity, rule, first URL).
  const perRule = new Map<string, number>();
  const candidates: CrawlFinding[] = [];
  const rulesCut = new Set<string>(header.truncatedRules);
  for (const finding of findings) {
    const seen = (perRule.get(finding.rule) ?? 0) + 1;
    perRule.set(finding.rule, seen);
    if (seen <= MAX_DESCRIBED_PER_RULE) candidates.push(finding);
    else rulesCut.add(finding.rule);
  }

  const c = header.coverage;
  const head = [
    HEADING,
    `Crawl: ${crawl.id} of host ${crawl.hostScope}, ${crawl.status}${crawl.stopReason ? ` (stopped on ${crawl.stopReason})` : ""}, started ${crawl.startedAt}${crawl.finishedAt ? `, finished ${crawl.finishedAt}` : ""}.`,
    `Recorded: ${header.recordedAt}, report ${header.id}, rule version ${header.ruleVersion}.`,
    `Coverage: ${c.pagesTotal} pages recorded (${c.pagesFetched} fetched and read, ${c.pagesNotFetched} not fetched, ${c.pagesNotReached} not reached within the budget); ${header.linksRead} link edges read${header.linksCut ? " (cut at the read limit; link findings may be incomplete)" : ""}.`,
    `Findings: ${total} in total across ${ruleIds.length} rule(s)${ruleIds.length ? ` — ${ruleIds.map((rule) => `${rule} (${labelOf(rule)}) ×${header.counts[rule]}`).join(", ")}` : ""}.${
      rulesCut.size ? ` Rules shown at most ${MAX_DESCRIBED_PER_RULE} each: ${[...rulesCut].sort().join(", ")}.` : ""
    }${findingsTruncated ? ` Only the first ${findings.length} recorded findings were read; the counts are complete.` : ""}`,
  ].join("\n");

  const cutNote = (n: number) => `(${n} further recorded finding(s) were cut to keep this evidence within its size bound; the counts above are complete)`;
  const reserved = byteLength(`\n\n${cutNote(candidates.length)}`) + byteLength(`\n\n${FINDINGS_EVIDENCE_LIMITS_NOTE}`);
  let bytes = byteLength(head);
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

  const sections = [head, lines.length ? lines.join("\n") : total === 0 ? NO_RECORDED_FINDING_FIRED_LINE : ""].filter(Boolean);
  if (cutByBytes > 0) sections.push(cutNote(cutByBytes));
  sections.push(FINDINGS_EVIDENCE_LIMITS_NOTE);
  const text = sections.join("\n\n");

  return {
    text,
    summary: {
      status: "recorded",
      crawlId: crawl.id,
      reportId: header.id,
      ruleVersion: header.ruleVersion,
      recordedAt: header.recordedAt,
      findings: total,
      described: lines.length,
      rules: ruleIds.length,
      rulesCut: [...rulesCut].sort(),
      cutByBytes,
      readCut: findingsTruncated,
      bytes: byteLength(text),
    },
  };
}
