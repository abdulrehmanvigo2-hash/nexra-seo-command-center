import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { assembleArticle } from "@/lib/briefs/assemble-article";
import { ARTICLE_PART_INSTRUCTIONS, formatPartBlock } from "@/lib/briefs/article-part";
import { OPPORTUNITY_BRIEF_INSTRUCTIONS, parseBrief, type OpportunityBriefInput } from "@/lib/briefs/brief";
import { draftWarnings } from "@/lib/briefs/draft-presenter";
import { supportLabel } from "@/lib/briefs/presenter";
import type { AgentRun } from "@/types/agent-run";

/**
 * The first live auto-drafted article (4 Oct) failed C1: opinion paragraphs held numbers ("three", "a second opinion")
 * and most of the body. The brief and Writer instructions now keep opinion within the attestation rules and prefer
 * advice, and the assembly warns part by part as soon as a drafted section breaks a rule.
 */

const BRIEF_RUN = "99999999-9999-4999-8999-999999999999";
const brief = parseBrief([
  "ANGLE: A pricing-first guide.", "OUTLINE:", "H2: What it is — Answer plainly.", "H2: How to choose — A checklist.", "H2: When to skip it — Honest limits.",
  "FAQ:", "Q: What does it cost?", "Q: Is it worth it?", "EVIDENCE:", "E: 1 — opinion", "E: 2 — advice", "E: 3 — opinion",
  "EVIDENCE NEEDED: None.", "LINKS:", "LIMITS: One outside page.", "NEXT: Draft the first H2.",
].join("\n"))!;
const records = { opportunity: { id: "o" }, cluster: null, serp: null, admitted: [], searchConsole: null, site: { crawlId: "c", paths: ["/"], existing: null } } as unknown as OpportunityBriefInput;

let seq = 0;
const run = (part: string, answer: string): AgentRun =>
  ({ id: `run-${part}-${(seq += 1)}`, taskType: "article-part-draft", input: { briefRunId: BRIEF_RUN, part }, status: "completed", executor: "ai", resultSummary: answer, createdAt: `2026-10-04T03:${String(seq).padStart(2, "0")}:00Z` }) as unknown as AgentRun;

describe("the instructions keep opinion within the attestation rules", () => {
  test("the Writer prefers advice, bans every number form in opinion, and allows one one-sentence opinion line per section", () => {
    assert.match(ARTICLE_PART_INSTRUCTIONS, /Prefer advice to opinion: write guidance to the reader — what to check, ask or choose — as \[connective\], not \[opinion\]\./);
    assert.match(ARTICLE_PART_INSTRUCTIONS, /An \[opinion\] line states no number in any form: no digit, percentage, price, count word such as three, or ordinal such as second or third; only one and first are allowed\./);
    assert.match(ARTICLE_PART_INSTRUCTIONS, /two or three P: lines, each under 45 words, of which at most one is \[opinion\], and only beside two lines that are not, and it is one sentence;/);
  });

  test("the brief may mark an H2 advice, and names the limits", () => {
    assert.match(OPPORTUNITY_BRIEF_INSTRUCTIONS, /the word advice when it can be written as guidance to the reader that states no fact, or the word opinion\. Prefer advice to opinion: an article's opinion paragraphs may hold at most 40% of its body and at most half of any section, and never a number\./);
    assert.equal(supportLabel("advice"), "Advice — guidance to the reader, stating no fact");
    assert.equal(supportLabel("opinion"), "Opinion — would be an attested paragraph");
  });

  test("a section the brief marks advice tells the Writer to write guidance, tagged connective", () => {
    assert.match(formatPartBlock(brief, "section-2"), /The brief marks it advice: write it as guidance to the reader, tagged \[connective\]\./);
    assert.doesNotMatch(formatPartBlock(brief, "section-1"), /marks it advice/);
  });
});

describe("the assembly warns part by part", () => {
  const section1 = ["P: In our view it is software that answers calls. [opinion]", "P: We think the distinction is scripted versus conversational. [opinion]", "P: Start from your call pattern. Judge it on coverage. [connective]", "LIMITS: None."].join("\n");
  const section2 = ["P: Start with your three most common calls. A tool that handles them beats one that claims everything. [opinion]", "P: Ask how it hands over to a person. [connective]", "LIMITS: None."].join("\n");

  test("before the other parts exist: a number in an opinion line and opinion over half a section are named on their part", () => {
    const runs = [run("section-1", section1), run("section-2", section2)];
    const draft = assembleArticle({ briefRunId: BRIEF_RUN, brief, records, runs });
    assert.equal(draft.content, null, "the opening and closing are not drafted yet");
    assert.deepEqual(draft.warnings, [
      { part: "section-2", text: "Section 2: opinion paragraph 1 states a number, which an attested paragraph may not; remove it or queue the part again." },
      { part: "section-2", text: "Section 2: opinion is 2 of 3 sentences, over half the section; rewrite some as advice or queue the part again." },
      { part: null, text: "Opinion is 4 of 7 sentences in the drafted sections, over 40% of the body; the assembled draft will fail until some becomes advice." },
    ]);
    assert.deepEqual(draftWarnings(brief, runs, BRIEF_RUN), draft.warnings, "the panel shows the same warnings");
  });

  test("half a section exactly is allowed; a section within the rules has no warning", () => {
    const ok = ["P: In our view it answers calls. [opinion]", "P: Start from your call pattern. [connective]", "P: Ask how it hands over. [connective]", "LIMITS: None."].join("\n");
    assert.deepEqual(assembleArticle({ briefRunId: BRIEF_RUN, brief, records, runs: [run("section-1", ok)] }).warnings, []);
  });
});
