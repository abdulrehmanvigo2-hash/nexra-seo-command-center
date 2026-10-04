import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";
import type { ExecutionTask } from "@/lib/agent-runs/executor";
import { createTaskGrounding, type TaskGroundingReaders } from "@/lib/agent-runs/task-grounding";
import { getTaskType } from "@/lib/agent-runs/task-types";
import { ARTICLE_PART_INSTRUCTIONS, ARTICLE_PARTS, formatPartBlock, parsePart, partsFor, splitTag } from "@/lib/briefs/article-part";
import { MAX_OUTLINE, parseBrief, type OpportunityBriefInput } from "@/lib/briefs/brief";
import type { AgentRun } from "@/types/agent-run";

/** M6, PR 2: the article-part-draft task, its grounding and the part parser. */

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const PROJECT = "nexra-agency";
const BRIEF_RUN = "99999999-9999-4999-8999-999999999999";
const OPP = "11111111-1111-4111-8111-111111111111";
const BRIEF_TEXT = [
  "ANGLE: Show the approval gate most AI SDR pages skip.", "OUTLINE:", "H2: What an AI SDR does — Answer plainly.", "H2: Where a person approves — The gate.", "H2: What to measure — Replies and bookings.",
  "FAQ:", "Q: What does an AI SDR do?", "Q: Who approves a message?", "EVIDENCE:", "E: 1 — [evidence E1]", "E: 2 — [crawl /ai-sdr]", "E: 3 — opinion",
  "EVIDENCE NEEDED: None.", "LINKS:", "L: /ai-sdr — 2", "LIMITS: One outside page.", "NEXT: Draft the first H2.",
].join("\n");
const brief = parseBrief(BRIEF_TEXT)!;

describe("the article-part-draft task", () => {
  test("Writer only, policy draft, over one brief run and one part", () => {
    const task = getTaskType("article-part-draft");
    assert.ok(task);
    assert.deepEqual(task.agents, ["writer"]);
    assert.equal(task.policy, "draft");
    assert.equal(task.evidence, "brief");
    assert.deepEqual(task.parseInput({ briefRunId: BRIEF_RUN.toUpperCase(), part: "section-2" }), { ok: true, value: { briefRunId: BRIEF_RUN, part: "section-2" } });
    for (const bad of [{ briefRunId: BRIEF_RUN, part: "section-7" }, { briefRunId: BRIEF_RUN, part: "middle" }, { briefRunId: "x", part: "opening" }, { briefRunId: BRIEF_RUN }, { briefRunId: BRIEF_RUN, part: "opening", extra: 1 }]) {
      assert.equal(task.parseInput(bad).ok, false, JSON.stringify(bad));
    }
    assert.deepEqual(ARTICLE_PARTS, ["opening", "section-1", "section-2", "section-3", "section-4", "section-5", "section-6", "closing"]);
    assert.equal(ARTICLE_PARTS.length, MAX_OUTLINE + 2, "a part per possible H2, plus the opening and closing");
    assert.deepEqual(partsFor(brief), ["opening", "section-1", "section-2", "section-3", "closing"]);
  });

  test("the instructions are pinned; a full-caps answer of every part stays under the worker's 2,000 ceiling", () => {
    assert.equal(sha256(ARTICLE_PART_INSTRUCTIONS), "b9a2e82a3ef69d41006e5e689997ac39b1fb6b253058e3b1c0b522cd2f36d231");
    const w = (n: number) => Array(n).fill("abcdefgh").join(" ");
    const tag = "[evidence E12]";
    const limits = `LIMITS: ${w(19)}`;
    const opening = [`TITLE: ${w(11)}`, `META TITLE: ${"a".repeat(59)}`, `META DESCRIPTION: ${"a".repeat(154)}`, `SLUG: ${Array(8).fill("abcdefgh").join("-")}`, `EXCERPT: ${w(24)}`, `LEAD: ${w(34)} ${tag}`, `P: ${w(39)} ${tag}`, limits].join("\n");
    const section = [...Array.from({ length: 3 }, () => `P: ${w(44)} [crawl /abcdefgh-abcdefgh]`), `LINK: /abcdefgh-abcdefgh — ${w(5)}`, limits].join("\n");
    const closing = [...Array.from({ length: 4 }, (_, i) => `A${i + 1}: ${w(24)} ${tag}`), `CTA TITLE: ${w(7)}`, `CTA BODY: ${w(24)}`, limits].join("\n");
    for (const [name, answer] of [["opening", opening], ["section", section], ["closing", closing]] as const) assert.ok(answer.length < 2_000, `${name} ${answer.length}`);
  });
});

describe("tags and the part block", () => {
  test("one closing tag is split from its text; a missing tag reads none", () => {
    assert.deepEqual(splitTag("AI SDRs reply fast. [evidence E1]"), { text: "AI SDRs reply fast.", tag: { kind: "evidence", label: "E1" } });
    assert.deepEqual(splitTag("The page says so. [crawl /ai-sdr]"), { text: "The page says so.", tag: { kind: "crawl", path: "/ai-sdr" } });
    assert.deepEqual(splitTag("We think so. [opinion]"), { text: "We think so.", tag: { kind: "opinion" } });
    assert.deepEqual(splitTag("Here is how. [connective]"), { text: "Here is how.", tag: { kind: "connective" } });
    assert.deepEqual(splitTag("No tag at all."), { text: "No tag at all.", tag: { kind: "none" } });
    assert.deepEqual(splitTag("A tag mid-line [opinion] then text."), { text: "A tag mid-line [opinion] then text.", tag: { kind: "none" } });
  });

  test("the block quotes the brief as a proposal and names the part, its support and its links", () => {
    const block = formatPartBlock(brief, "section-2");
    assert.ok(block.startsWith("BRIEF (a model's proposal, never evidence)"));
    assert.ok(block.includes('Write the body of H2 2: "Where a person approves"'));
    assert.ok(block.includes('The brief\'s support for it: "[crawl /ai-sdr]".'));
    assert.ok(block.includes("Paths you may link: /ai-sdr."));
    assert.ok(formatPartBlock(brief, "section-1").includes("No link is placed under this H2; write no LINK line."));
    assert.ok(formatPartBlock(brief, "closing").includes('Q2: "Who approves a message?"'));
  });
});

describe("parsePart", () => {
  test("each part's fixed order reads back", () => {
    const opening = parsePart(["TITLE: AI SDR with a person in the loop", "META TITLE: AI SDR with approval", "META DESCRIPTION: How an AI SDR replies and who approves.", "SLUG: ai-sdr-approval", "EXCERPT: Where the person approves.", "LEAD: AI SDRs reply within a minute. [evidence E1]", "P: This guide covers the approval step. [connective]", "LIMITS: One outside page."].join("\n"), "opening");
    assert.ok(opening && opening.part === "opening" && opening.slug === "ai-sdr-approval" && opening.lead.tag.kind === "evidence");
    const section = parsePart(["P: The page names the gate. [crawl /ai-sdr]", "P: We think a person should approve. [opinion]", "LINK: /ai-sdr — names the gate", "LIMITS: No client figures."].join("\n"), "section-2");
    assert.ok(section && "paragraphs" in section && section.section === 2 && section.paragraphs.length === 2);
    assert.deepEqual(section.link, { path: "/ai-sdr", anchorText: "names the gate" });
    const closing = parsePart(["A1: It replies and books. [evidence E1]", "A2: A person approves. [opinion]", "CTA TITLE: Talk to us", "CTA BODY: Book a call.", "LIMITS: None."].join("\n"), "closing");
    assert.ok(closing && "answers" in closing && closing.answers.length === 2 && closing.ctaTitle === "Talk to us");
  });

  test("off-order, stray paragraphs, a bad slug, four paragraphs or a repeated answer are not a part", () => {
    const ok = ["P: One. [connective]", "LIMITS: None."];
    assert.ok(parsePart(ok.join("\n"), "section-1"));
    assert.equal(parsePart(["Here is the section.", ...ok].join("\n"), "section-1"), null);
    assert.equal(parsePart(["P: a [connective]", "P: b [connective]", "P: c [connective]", "P: d [connective]", "LIMITS: x"].join("\n"), "section-1"), null);
    assert.equal(parsePart(["P: a [connective]"].join("\n"), "section-1"), null, "no LIMITS line");
    assert.equal(parsePart(["P: a [connective]", "LINK: https://x.example — a", "LIMITS: x"].join("\n"), "section-1"), null);
    assert.equal(parsePart(["TITLE: t", "META TITLE: m", "META DESCRIPTION: d", "SLUG: Not A Slug", "EXCERPT: e", "LEAD: l [connective]", "P: p [connective]", "LIMITS: x"].join("\n"), "opening"), null);
    assert.equal(parsePart(["A1: a [connective]", "A1: b [connective]", "CTA TITLE: t", "CTA BODY: b", "LIMITS: x"].join("\n"), "closing"), null);
    assert.equal(parsePart("Simulated article part draft by Writer.", "opening"), null);
  });
});

describe("the grounding", () => {
  const briefRun = (over: Partial<AgentRun> = {}) => ({ id: BRIEF_RUN, projectId: PROJECT, taskType: "opportunity-brief", status: "completed", executor: "ai", resultSummary: BRIEF_TEXT, input: { opportunityId: OPP }, ...over }) as AgentRun;
  const records = { opportunity: { id: OPP, title: "Write: AI SDR", action: "write", score: 62, acceptedAt: "2026-10-03T11:40:00Z", signals: [] }, cluster: null, serp: null, admitted: [{ label: "E1", claim: "c", quote: "q", url: "https://a.example/" }], searchConsole: null, site: null } as unknown as OpportunityBriefInput;
  const readersWith = (run: AgentRun | null, opportunity: OpportunityBriefInput | null = records) =>
    ({ runs: { getById: async () => run }, opportunities: async () => opportunity }) as unknown as TaskGroundingReaders;
  const task = (part: string) => ({ taskType: "article-part-draft", project: { id: PROJECT }, input: { briefRunId: BRIEF_RUN, part } }) as unknown as ExecutionTask;

  test("a usable brief grounds the part with the brief block and the opportunity's records", async () => {
    const result = await createTaskGrounding(readersWith(briefRun()))(task("section-2"));
    assert.ok(result.ok && result.grounding !== null);
    assert.ok(result.grounding.text.startsWith("BRIEF (a model's proposal, never evidence)"));
    assert.ok(result.grounding.text.includes("OPPORTUNITY (accepted by the operator"));
    assert.equal(result.grounding.summary.part, "section-2");
    assert.equal(result.grounding.source?.label, "brief and opportunity records");
  });

  test("another project's, a simulated, an unfinished or an off-format brief refuses before any provider call", async () => {
    for (const run of [null, briefRun({ projectId: "other" }), briefRun({ executor: "mock" }), briefRun({ status: "queued" }), briefRun({ resultSummary: "Here is a brief." }), briefRun({ taskType: "content-plan-review" })]) {
      assert.deepEqual(await createTaskGrounding(readersWith(run))(task("opening")), { ok: false, reason: "brief-not-usable" });
    }
    assert.deepEqual(await createTaskGrounding(readersWith(briefRun()))(task("section-4")), { ok: false, reason: "brief-part-missing" });
    assert.deepEqual(await createTaskGrounding(readersWith(briefRun(), null))(task("opening")), { ok: false, reason: "opportunity-not-readable" });
    assert.deepEqual(await createTaskGrounding({ runs: { getById: async () => briefRun() } } as unknown as TaskGroundingReaders)(task("opening")), { ok: false, reason: "opportunities-not-kept" });
  });
});
