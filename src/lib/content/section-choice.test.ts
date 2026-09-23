import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { getTaskType } from "../agent-runs/task-types.ts";
import type { AgentRun } from "../../types/agent-run.ts";
import type { EvidencePackGrounding } from "../research/evidence-pack.ts";
import {
  DRAFT_LIMITS_NOTE,
  formatDraftGrounding,
  MAX_SECTION_INDEX,
  planSections,
  resolveSection,
  SECTION_DRAFT_INSTRUCTIONS,
  type SectionTarget,
} from "./draft-grounding.ts";
import { writerRunEligibility } from "./drafts/eligibility.ts";
import { writerRun } from "./drafts/test-support/fixtures.ts";

/**
 * Stage 5, milestone C3: the Writer drafts the one outline section the
 * operator chose. The resolver, the evidence block, the instructions, the
 * run metadata and the boundaries of the change, all offline: no provider,
 * no store, no network.
 */

const PLAN_TEXT = [
  "PAGE AND GOAL\n/services, to state what the agency does.",
  "OUTLINE",
  "1. What the agency does [crawl /services]",
  "2. **How an engagement runs** [crawl /process].",
  "3. Who the agency has worked with [needs evidence]",
  "4. The brand query this page answers [search console 2026-08-19 to 2026-09-17]",
  "5. [crawl /about]",
  "6. A line with no tag at all",
  "",
  "NEXT OPERATOR ACTION\nCompile or refresh the evidence pack.",
].join("\n");

const CRAWL_ID = "8f1c0d2e-0000-4000-8000-000000000001";

const PLAN: AgentRun = {
  ...writerRun(),
  id: "11111111-0000-4000-8000-000000000060",
  agentId: "content-strategist",
  taskType: "content-plan-review",
  input: {},
  resultSummary: PLAN_TEXT,
  resultMetadata: { simulated: false, grounded: true, taskType: "content-plan-review", evidence: { source: "evidence-pack", crawlId: CRAWL_ID } },
};

const RECORDS = {
  text: "RECORDED PAGES\n- /services: Title: \"Services\"",
  summary: { source: "evidence-pack", projectId: "nexra-agency", projectHost: "nexraagency.com", crawlId: CRAWL_ID },
} as unknown as EvidencePackGrounding;

function target(index: number): SectionTarget {
  const result = resolveSection(PLAN_TEXT, index);
  assert.ok(result.ok, `section ${index} should resolve: ${JSON.stringify(result)}`);
  return result.target;
}

describe("the section resolver", () => {
  test("lists every outline line in order with its zero-based index and heading", () => {
    assert.deepEqual(
      planSections(PLAN_TEXT).map((s) => [s.index, s.heading, s.draftable, s.needsEvidence]),
      [
        [0, "What the agency does", true, false],
        [1, "How an engagement runs", true, false],
        [2, "Who the agency has worked with", false, true],
        [3, "The brand query this page answers", true, false],
        [4, "", true, false],
        [5, "A line with no tag at all", false, false],
      ],
    );
  });

  test("section 0, a middle section and the last draftable section resolve to their own exact plan lines", () => {
    assert.deepEqual(target(0), { sectionIndex: 0, position: 1, outlineLine: "1. What the agency does [crawl /services]", heading: "What the agency does" });
    assert.deepEqual(target(1), { sectionIndex: 1, position: 2, outlineLine: "2. **How an engagement runs** [crawl /process].", heading: "How an engagement runs" });
    assert.deepEqual(target(3), {
      sectionIndex: 3,
      position: 4,
      outlineLine: "4. The brand query this page answers [search console 2026-08-19 to 2026-09-17]",
      heading: "The brand query this page answers",
    });
    const lines = [0, 1, 3].map((i) => target(i).outlineLine);
    assert.equal(new Set(lines).size, 3, "different choices resolved the same content");
  });

  test("the last outline line resolves when it is draftable", () => {
    const text = "OUTLINE\nFirst [crawl /]\nSecond [crawl /a]\nLast [crawl /b]";
    const last = resolveSection(text, 2);
    assert.ok(last.ok && last.target.heading === "Last" && last.target.position === 3);
  });

  test("a missing, negative, non-integer or out-of-range index is refused", () => {
    assert.deepEqual(resolveSection(PLAN_TEXT, undefined), { ok: false, reason: "section-index-missing" });
    assert.deepEqual(resolveSection(PLAN_TEXT, null), { ok: false, reason: "section-index-missing" });
    for (const bad of [-1, -0.5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "1", true, [1], { index: 1 }, MAX_SECTION_INDEX + 1]) {
      assert.deepEqual(resolveSection(PLAN_TEXT, bad), { ok: false, reason: "section-index-invalid" }, String(bad));
    }
    assert.deepEqual(resolveSection(PLAN_TEXT, 6), { ok: false, reason: "section-out-of-range" });
    assert.deepEqual(resolveSection(PLAN_TEXT, MAX_SECTION_INDEX), { ok: false, reason: "section-out-of-range" });
    assert.deepEqual(resolveSection("PAGE AND GOAL\n/services.", 0), { ok: false, reason: "plan-outline-missing" });
  });

  test("a malformed or untagged selected section is refused, never swapped for another", () => {
    assert.deepEqual(resolveSection(PLAN_TEXT, 4), { ok: false, reason: "section-malformed" }, "a tag with no heading");
    assert.deepEqual(resolveSection(PLAN_TEXT, 2), { ok: false, reason: "section-not-draftable" }, "a needs-evidence line");
    assert.deepEqual(resolveSection(PLAN_TEXT, 5), { ok: false, reason: "section-not-draftable" }, "a bare line");
  });

  test("there is no fallback to the first section, no clamping and no auto-selection", () => {
    for (const choice of [undefined, 2, 5, 6, 99, -1]) {
      const result = resolveSection(PLAN_TEXT, choice);
      assert.equal(result.ok, false, String(choice));
    }
    assert.notEqual(target(3).outlineLine, target(0).outlineLine);
    const source = readFileSync(new URL("./draft-grounding.ts", import.meta.url), "utf8");
    const resolver = source.slice(source.indexOf("export function resolveSection"), source.indexOf("/**\n * The plan, quoted as one JSON string"));
    assert.equal(/Math\.(min|max)|\?\? 0|\|\| 0|sections\[0\]/.test(resolver), false, "the resolver clamps or defaults");
  });

  test("is deterministic: the same text and index always give the same target", () => {
    assert.deepEqual(resolveSection(PLAN_TEXT, 1), resolveSection(PLAN_TEXT, 1));
  });
});

describe("the Writer's evidence block and instructions", () => {
  test("name the selected section by index and heading, and no other section as the one to draft", () => {
    for (const index of [0, 1, 3]) {
      const chosen = target(index);
      const { text } = formatDraftGrounding(PLAN, RECORDS, chosen);
      const header = text.slice(0, text.indexOf("=== CONTENT PLAN"));
      assert.ok(header.includes(`SECTION TO DRAFT: section index ${index} (zero-based; outline line ${index + 1} of the plan), chosen by the operator.`));
      assert.ok(header.includes(`Heading, quoted as data: ${JSON.stringify(chosen.heading)}`));
      assert.ok(header.includes("Draft this one section only. Do not draft any earlier or later outline line, and do not assemble the full article."));
      for (const other of [0, 1, 3].filter((i) => i !== index)) {
        assert.ok(!header.includes(target(other).heading), `section ${other} is named in the header of section ${index}`);
      }
    }
  });

  test("the instructions draft one chosen section only, never another or the whole article", () => {
    assert.match(SECTION_DRAFT_INSTRUCTIONS, /Draft only the section the operator chose, named under SECTION TO DRAFT by index and heading; draft no earlier or later section and never the full article\./);
    assert.doesNotMatch(SECTION_DRAFT_INSTRUCTIONS, /first outline|first section|draft (every|all) sections/i);
    assert.equal(getTaskType("section-draft")?.instructions, SECTION_DRAFT_INSTRUCTIONS);
  });

  test("every existing grounding, evidence, length and safety rule is still present", () => {
    for (const rule of [
      /the CONTENT PLAN, which is a model-generated proposal and not evidence, and RECORDED PROJECT EVIDENCE, which is the only source of facts/,
      /Every factual sentence must rest on a record in RECORDED PROJECT EVIDENCE/,
      /a claim without such a tag is forbidden, and a tag must name a path or window present in the records/,
      /\[NEEDS EVIDENCE: what is missing\]/,
      /Keep the whole answer under 1,500 characters/,
      /DRAFT: coherent English prose, at most 90 words/,
      /Never state or estimate keyword volume/,
      /Name no page the crawl did not fetch and no study, publication, citation, source, organisation or person/,
      /STATUS: exactly this line: Draft for operator review\. Not published, not approved, not final\./,
    ]) {
      assert.match(SECTION_DRAFT_INSTRUCTIONS, rule);
    }
    assert.match(SECTION_DRAFT_INSTRUCTIONS, /Do not describe the draft as approved, fact-checked, final or published/);
    const { text } = formatDraftGrounding(PLAN, RECORDS, target(0));
    assert.ok(text.endsWith(DRAFT_LIMITS_NOTE), "the draft limits no longer close the block");
    assert.match(text, /=== CONTENT PLAN \(MODEL-GENERATED PROPOSAL — NOT FACTUAL EVIDENCE/);
    assert.ok(text.includes(RECORDS.text));
  });
});

describe("result metadata", () => {
  test("carries the zero-based choice and its heading, and keeps the 1-based position a saved draft reads", () => {
    const { summary } = formatDraftGrounding(PLAN, RECORDS, target(3));
    assert.equal(summary.selectedSectionIndex, 3);
    assert.equal(summary.sectionHeading, "The brand query this page answers");
    assert.equal(summary.sectionSelection, "operator");
    assert.equal(summary.sectionIndex, 4, "the stored position stays 1-based, as the draft table expects");
    assert.equal(summary.section, "4. The brand query this page answers [search console 2026-08-19 to 2026-09-17]");
    // A completed Writer run with this metadata is still saveable as a draft, at the chosen section.
    const run = writerRun({ resultMetadata: { ...writerRun().resultMetadata, evidence: { ...summary, records: { ...summary.records } } } });
    const eligibility = writerRunEligibility(run, "nexra-agency");
    assert.ok(eligibility.ok, JSON.stringify(eligibility));
    assert.equal(eligibility.ok && eligibility.source.sectionIndex, 4);
  });
});

describe("the boundaries of the change", () => {
  test("the Writer path writes nothing and touches no article, fact-check, approval or publication code", () => {
    for (const file of ["./draft-grounding.ts", "../agent-runs/task-types.ts", "../crawl/review-request.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      assert.equal(/from "@\/lib\/content\/(articles|publications)|approveVersion|recordFactCheck|nexra_article|propose\(/.test(source), false, file);
    }
    const panel = readFileSync(new URL("../../components/agent-runs/queued-review.tsx", import.meta.url), "utf8");
    const writer = panel.slice(panel.indexOf("function WriterDraft"));
    assert.match(writer, /<option value="">Choose a section…<\/option>/);
    assert.match(writer, /useState<number \| null>\(null\)/, "the chooser starts with no section chosen");
    assert.equal(/approve|publish|fact-?check|createArticle/i.test(writer.slice(0, writer.indexOf("\n}\n"))), false);
  });

  test("the task's policy is still draft, and only the Writer may run it", () => {
    const definition = getTaskType("section-draft");
    assert.equal(definition?.policy, "draft");
    assert.deepEqual(definition?.agents, ["writer"]);
  });
});
