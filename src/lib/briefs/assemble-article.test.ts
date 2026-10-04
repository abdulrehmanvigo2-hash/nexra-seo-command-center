import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { assembleArticle, importText, sectionId } from "@/lib/briefs/assemble-article";
import { parseBrief, type OpportunityBriefInput } from "@/lib/briefs/brief";
import { importArticleJson } from "@/lib/content/articles/import";
import type { AgentRun } from "@/types/agent-run";

/** M6, PR 3: the part runs of one brief, assembled into import-ready article JSON with an evidence map. */

const BRIEF_RUN = "99999999-9999-4999-8999-999999999999";
const brief = parseBrief([
  "ANGLE: Show the approval gate most AI SDR pages skip.", "OUTLINE:", "H2: What an AI SDR does — Answer plainly.", "H2: Where a person approves — The gate.", "H2: What to measure — Replies and bookings.",
  "FAQ:", "Q: What does an AI SDR do?", "Q: Who approves a message?", "EVIDENCE:", "E: 1 — [evidence E1]", "E: 2 — [crawl /ai-sdr]", "E: 3 — opinion",
  "EVIDENCE NEEDED: None.", "LINKS:", "L: /ai-sdr — 2", "LIMITS: One outside page.", "NEXT: Draft the first H2.",
].join("\n"))!;

const records = {
  opportunity: { id: "o" },
  cluster: { topic: "AI SDR", intent: "commercial", keywords: [{ keyword: "AI SDR tools", role: "supporting" }, { keyword: "ai sdr", role: "primary" }, { keyword: "sdr jobs", role: "excluded" }, { keyword: "ai sdr", role: "supporting" }] },
  serp: null,
  admitted: [{ label: "E1", claim: "They reply fast.", quote: "reply within one minute", url: "https://alpha.example/guide", retrievedAt: "2026-10-03T12:05:00Z" }],
  searchConsole: null,
  site: { crawlId: "c", paths: ["/", "/ai-sdr"], existing: null },
} as unknown as OpportunityBriefInput;

const ANSWERS: Record<string, string> = {
  opening: ["TITLE: AI SDR with a person in the loop", "META TITLE: AI SDR with a person in the loop", "META DESCRIPTION: How an AI SDR replies to leads and where a person approves before anything is sent.", "SLUG: ai-sdr-approval", "EXCERPT: Where a person approves an AI SDR's message.", "LEAD: AI SDR tools reply to inbound leads within a minute. [evidence E1]", "P: This guide walks through the approval step. [connective]", "LIMITS: One outside page."].join("\n"),
  "section-1": ["P: An AI SDR replies to inbound leads within a minute. [evidence E1]", "P: The rest of this section explains each step. [connective]", "LIMITS: None."].join("\n"),
  "section-2": ["P: Our service page describes an approval step before sending. [crawl /ai-sdr]", "P: We think a person should approve every first message. [opinion]", "LINK: /ai-sdr — approval step", "LIMITS: None."].join("\n"),
  "section-3": ["P: Measure replies and bookings week by week. [connective]", "P: Pricing pages are often vague. [crawl /pricing]", "LIMITS: No client figures."].join("\n"),
  closing: ["A1: It replies to inbound leads and books meetings. [evidence E1]", "A2: A person on your team approves it. [opinion]", "CTA TITLE: Talk to us", "CTA BODY: Book a short call to see the approval step.", "LIMITS: None."].join("\n"),
};

let seq = 0;
const run = (part: string, over: Partial<AgentRun> = {}): AgentRun =>
  ({ id: `run-${part}-${(seq += 1)}`, taskType: "article-part-draft", input: { briefRunId: BRIEF_RUN, part }, status: "completed", executor: "ai", resultSummary: ANSWERS[part] ?? "", createdAt: `2026-10-03T14:${String(seq).padStart(2, "0")}:00Z`, ...over }) as AgentRun;
const allRuns = () => ["opening", "section-1", "section-2", "section-3", "closing"].map((part) => run(part));

describe("assembleArticle", () => {
  test("every part used: import-ready content that the editor's Import accepts", () => {
    const draft = assembleArticle({ briefRunId: BRIEF_RUN, brief, records, runs: allRuns() });
    assert.deepEqual(draft.parts.map((p) => p.state), ["used", "used", "used", "used", "used"]);
    const content = draft.content!;
    assert.equal(content.slug, "ai-sdr-approval");
    assert.equal(content.searchIntent, "commercial");
    assert.deepEqual(content.keywords, ["ai sdr", "AI SDR tools"], "primary first, excluded and repeated ones left out");
    assert.deepEqual(content.sections.map((s) => s.id), ["what-an-ai-sdr-does", "where-a-person-approves", "what-to-measure"]);
    assert.equal(content.sections[1]!.paragraphs[1], "We think a person should approve every first message.", "the tag is removed from the text");
    assert.deepEqual(content.attestations, [{ locator: "where-a-person-approves/1", basis: "opinion" }]);
    assert.deepEqual(content.internalLinks, [{ path: "/ai-sdr", anchorText: "approval step", sectionId: "where-a-person-approves" }]);
    assert.deepEqual(content.faqs.map((f) => f.question), ["What does an AI SDR do?", "Who approves a message?"]);
    assert.deepEqual(content.citations, [{ url: "https://alpha.example/guide", title: "alpha.example/guide", publisher: "alpha.example", retrievedAt: "2026-10-03" }]);
    assert.equal(content.topicDecision, "unset");
    assert.deepEqual(draft.issues, []);
    const imported = importArticleJson(importText(draft)!);
    assert.ok(imported.ok, JSON.stringify(imported));
  });

  test("the evidence map lists unsupported lines first, then the rest in article order; nothing is dropped", () => {
    const draft = assembleArticle({ briefRunId: BRIEF_RUN, brief, records, runs: allRuns() });
    const first = draft.evidenceMap[0]!;
    assert.equal(first.status, "unsupported");
    assert.equal(first.locator, "what-to-measure/1");
    assert.equal(first.note, "The newest crawl did not fetch /pricing.");
    assert.ok(draft.content!.sections[2]!.paragraphs.includes("Pricing pages are often vague."), "kept in the text");
    assert.deepEqual(draft.evidenceMap.slice(1).map((e) => `${e.locator}:${e.status}`), [
      "lead:record", "introduction/0:connective", "what-an-ai-sdr-does/0:record", "what-an-ai-sdr-does/1:connective",
      "where-a-person-approves/0:record", "where-a-person-approves/1:opinion", "what-to-measure/0:connective", "faq/0:record", "faq/1:opinion",
    ]);
    assert.ok(draft.notes.some((n) => n.startsWith('Category set to "AI Automation"')));
  });

  test("an untagged line, an unknown unit and an opinion with a number are flagged; the validator's issues are listed", () => {
    const base = allRuns();
    const runs = [...base, run("section-1", { resultSummary: ["P: AI SDRs never miss a lead.", "P: They book three meetings a day. [opinion]", "P: Reply rates rise. [evidence E9]", "LIMITS: x"].join("\n") })];
    const draft = assembleArticle({ briefRunId: BRIEF_RUN, brief, records, runs });
    const byLocator = new Map(draft.evidenceMap.map((e) => [e.locator, e]));
    assert.equal(byLocator.get("what-an-ai-sdr-does/0")!.note, "No tag: what it rests on is not named.");
    assert.equal(byLocator.get("what-an-ai-sdr-does/1")!.note, "States a number: an attested paragraph may not.");
    assert.equal(byLocator.get("what-an-ai-sdr-does/2")!.note, "No admitted unit E9 for this opportunity.");
    assert.ok(draft.issues.some((issue) => issue.code === "attestation-number"));
  });

  test("a part missing, pending, simulated or off-format leaves no content, and each is named", () => {
    const runs = [run("opening"), run("section-1", { status: "queued", resultSummary: null }), run("section-2", { executor: "mock", resultSummary: "Simulated" }), run("section-3", { resultSummary: "Here is the section." })];
    const draft = assembleArticle({ briefRunId: BRIEF_RUN, brief, records, runs });
    assert.equal(draft.content, null);
    assert.deepEqual(draft.parts.map((p) => p.state), ["used", "pending", "missing", "unparsed", "missing"]);
    assert.equal(importText(draft), null);
  });

  test("the newest completed run of a part wins; another brief's runs are never mixed in", () => {
    const base = allRuns();
    const newer = run("section-1", { resultSummary: ["P: Newer text. [connective]", "LIMITS: x"].join("\n") });
    const other = run("section-2", { input: { briefRunId: "88888888-8888-4888-8888-888888888888", part: "section-2" }, resultSummary: ["P: Other brief. [connective]", "LIMITS: x"].join("\n") });
    const draft = assembleArticle({ briefRunId: BRIEF_RUN, brief, records, runs: [...base, newer, other] });
    assert.deepEqual(draft.content!.sections[0]!.paragraphs, ["Newer text."]);
    assert.notDeepEqual(draft.content!.sections[1]!.paragraphs, ["Other brief."]);
  });

  test("a link the brief did not place, or whose anchor is not in the section, is left out and noted", () => {
    const base = allRuns();
    const runs = [...base, run("section-1", { resultSummary: ["P: Read the service page. [connective]", "LINK: /ai-sdr — service page", "LIMITS: x"].join("\n") }), run("section-2", { resultSummary: ["P: Approval matters. [opinion]", "LINK: /ai-sdr — not in text", "LIMITS: x"].join("\n") })];
    const draft = assembleArticle({ briefRunId: BRIEF_RUN, brief, records, runs });
    assert.deepEqual(draft.content!.internalLinks, []);
    assert.ok(draft.notes.includes('Link /ai-sdr under "What an AI SDR does" left out: the brief did not place it there.'));
    assert.ok(draft.notes.includes('Link /ai-sdr under "Where a person approves" left out: its anchor text is not in the section.'));
  });

  test("section ids are unique and in the contract's pattern", () => {
    const taken = new Set<string>();
    assert.deepEqual(["Café & AI!", "Café & AI!", "???"].map((h) => sectionId(h, taken)), ["cafe-ai", "cafe-ai-2", "section"]);
  });
});
