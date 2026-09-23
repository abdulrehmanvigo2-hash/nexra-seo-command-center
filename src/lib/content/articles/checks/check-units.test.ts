import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseFactCheckOutput } from "../../drafts/parse-fact-check-output.ts";
import { buildUnitVerdict, deriveArticleCheckState, deriveUnitStatus, readUnitResult, statementCoverage, statementNumberOf, unitFailure } from "./result.ts";
import { answer, content } from "./test-support/fixtures.ts";
import { unitSha256 } from "./unit-hash.ts";
import {
  ARTICLE_CHECK_UNIT_FORMAT,
  articleCheckPlan,
  articleStatements,
  MAX_ARTICLE_UNITS,
  MAX_UNIT_BYTES,
  MAX_UNIT_STATEMENTS,
  sentencesOf,
  statementsIn,
} from "./units.ts";
import type { ArticleCheckUnit } from "../../../../types/content-article-check.ts";

/**
 * Stage 5, milestone C4: an article version cut into bounded check units —
 * blocks cut into parts of at most 10 statements and 6,000 bytes — and the
 * result and state rules over them. Offline and pure apart from the hash.
 */

const EVIDENCE = { crawlId: "8f1c0d2e-0000-4000-8000-000000000001", searchWindow: null, recordPaths: ["/services"] };
const RUN = "c0000000-0000-4000-8000-000000000001";

function unitsOf(value = content()): readonly ArticleCheckUnit[] {
  const plan = articleCheckPlan(value);
  assert.equal(plan.refusal, null, "fixture content is checkable");
  return plan.units;
}

function verdict(lines: Parameters<typeof answer>[0], statementCount: number) {
  const parsed = parseFactCheckOutput(answer(lines));
  assert.ok(parsed.ok, "fixture answer parses");
  return buildUnitVerdict({ output: parsed.output, evidence: EVIDENCE, statementCount, checkedByRunId: RUN, checkedAt: "2026-09-23T12:05:00.000Z", recordedBy: "op", recordedAt: "2026-09-23T12:06:00.000Z" });
}

const sentences = (n: number, word: string) => Array.from({ length: n }, (_, i) => `${word} ${i + 1} is here.`).join(" ");

/** A realistic long article: a 1,800-word-scale body with H3s, long paragraphs and many FAQs. */
function longArticle() {
  return content((raw) => {
    raw.introduction = [sentences(4, "Intro"), sentences(3, "Context")];
    raw.sections = [
      {
        id: "what-it-does",
        heading: "What a text-back does",
        paragraphs: [sentences(4, "Alpha"), sentences(5, "Beta"), sentences(12, "Gamma"), sentences(3, "Delta")],
        subsections: [
          { id: "timing", heading: "Timing", paragraphs: [sentences(6, "Tick"), sentences(6, "Tock")] },
          { id: "tone", heading: "Tone", paragraphs: [sentences(2, "Warm")] },
        ],
      },
      { id: "where-it-stops", heading: "Where it stops", paragraphs: [sentences(9, "Stop"), sentences(9, "Halt")], subsections: [] },
    ];
    raw.faqs = Array.from({ length: 8 }, (_, i) => ({ question: `Question ${i + 1}?`, answer: sentences(i === 3 ? 14 : 2, `Answer${i}`) }));
    raw.internalLinks = [{ path: "/services#automation", anchorText: "our automation services", sectionId: "where-it-stops" }];
  });
}

describe("unit generation: blocks, keys and order", () => {
  const units = unitsOf();

  test("a short article yields one part per block, in the fixed order, with <block>:<part> keys", () => {
    assert.deepEqual(
      units.map((u) => [u.index, u.kind, u.key, u.part, u.partCount]),
      [
        [0, "metadata", "metadata:1", 1, 1],
        [1, "lead-introduction", "lead-introduction:1", 1, 1],
        [2, "section", "section:what-it-does:1", 1, 1],
        [3, "section", "section:where-it-stops:1", 1, 1],
        [4, "faq", "faq:1", 1, 1],
        [5, "cta", "cta:1", 1, 1],
      ],
    );
    const parsed = JSON.parse(units[0].text) as Record<string, unknown>;
    assert.deepEqual(Object.keys(parsed), ["format", "kind", "block", "key", "part", "partCount", "context", "statements"]);
    assert.equal(parsed.format, ARTICLE_CHECK_UNIT_FORMAT);
  });

  test("metadata statements cover topic, intent, title, meta title, meta description, excerpt, category and keywords — no slug, decision or links", () => {
    assert.deepEqual(units[0].statements.map((s) => s.field), ["topic", "searchIntent", "title", "metaTitle", "metaDescription", "excerpt", "category", "keywords"]);
    assert.equal(/slug|topicDecision|internalLinks|missed-call-text-back"/.test(units[0].text), false);
  });

  test("the FAQ block exists only when there are FAQs; the CTA block is always last", () => {
    const none = unitsOf(content((raw) => (raw.faqs = [])));
    assert.deepEqual(none.map((u) => u.block), ["metadata", "lead-introduction", "section:what-it-does", "section:where-it-stops", "cta"]);
  });
});

describe("packing: exact coverage, bounds and grouping", () => {
  for (const [name, value] of [
    ["the short fixture", content()],
    ["a long, realistic article", longArticle()],
  ] as const) {
    test(`${name}: every statement appears exactly once, in order, and no unit exceeds 10 statements or 6,000 bytes`, () => {
      const units = unitsOf(value);
      const packed = units.flatMap((u) => u.statements.map((s) => ({ block: u.block, field: s.field, text: s.text })));
      assert.deepEqual(packed, articleStatements(value));
      for (const u of units) {
        assert.ok(u.statementCount >= 1 && u.statementCount <= MAX_UNIT_STATEMENTS, `${u.key}: ${u.statementCount}`);
        assert.ok(u.bytes <= MAX_UNIT_BYTES && u.bytes === new TextEncoder().encode(u.text).length, u.key);
        assert.deepEqual(u.statements.map((s) => s.n), Array.from({ length: u.statementCount }, (_, i) => i + 1), "numbered S1 … Sn");
      }
      assert.deepEqual(units.map((u) => u.index), units.map((_, i) => i), "indexes are positions");
      for (const block of new Set(units.map((u) => u.block))) {
        const parts = units.filter((u) => u.block === block);
        assert.deepEqual(parts.map((u) => u.part), parts.map((_, i) => i + 1), `${block}: parts 1 … n`);
        assert.ok(parts.every((u) => u.partCount === parts.length && u.key === `${block}:${u.part}`), block);
      }
    });
  }

  test("statements are whole sentences of the source, never cut mid-sentence", () => {
    const paragraph = "Gamma one is here. Gamma two is here! Is gamma three here? Gamma four…  Gamma five";
    assert.deepEqual(sentencesOf(paragraph), ["Gamma one is here.", "Gamma two is here!", "Is gamma three here?", "Gamma four…", "Gamma five"]);
    assert.equal(statementsIn(""), 0);
    const units = unitsOf(longArticle());
    const sourceSentences = new Set(articleStatements(longArticle()).map((s) => s.text));
    for (const u of units) for (const s of u.statements) assert.ok(sourceSentences.has(s.text), s.text);
  });

  test("a long section splits into parts; whole paragraphs stay together when they fit", () => {
    const units = unitsOf(longArticle()).filter((u) => u.block === "section:what-it-does");
    assert.ok(units.length > 1, "a normal long H2 section is checkable, split into parts");
    // Paragraphs of 5 or fewer sentences are never split across two parts.
    for (const field of ["paragraphs[0]", "paragraphs[1]", "paragraphs[3]", "subsections[1].paragraphs[0]"]) {
      assert.equal(units.filter((u) => u.statements.some((s) => s.field === field)).length, 1, field);
    }
    // The 12-sentence paragraph is split, only between sentences.
    const gamma = units.filter((u) => u.statements.some((s) => s.field === "paragraphs[2]"));
    assert.ok(gamma.length >= 2);
    assert.equal(gamma.flatMap((u) => u.statements.filter((s) => s.field === "paragraphs[2]")).length, 12);
  });

  test("an H3 heading stays with its first paragraph when they fit", () => {
    const units = unitsOf(longArticle()).filter((u) => u.block === "section:what-it-does");
    const withTone = units.find((u) => u.statements.some((s) => s.field === "subsections[1].heading"));
    assert.ok(withTone?.statements.some((s) => s.field === "subsections[1].paragraphs[0]"));
  });

  test("FAQ question-answer pairs stay together when they fit; a long answer carries its question as context", () => {
    const faqs = unitsOf(longArticle()).filter((u) => u.block === "faq");
    assert.ok(faqs.length > 1, "eight FAQs are checkable, split into parts");
    for (const i of [0, 1, 2, 4, 5, 6, 7]) {
      assert.equal(faqs.filter((u) => u.statements.some((s) => s.field === `faqs[${i}].question` || s.field === `faqs[${i}].answer`)).length, 1, `faq ${i}`);
    }
    const long = faqs.filter((u) => u.statements.some((s) => s.field === "faqs[3].answer"));
    assert.ok(long.length >= 2);
    const later = long.find((u) => !u.statements.some((s) => s.field === "faqs[3].question"));
    assert.deepEqual(later?.context, [{ field: "faqs[3].question", text: "Question 4?" }]);
  });
});

describe("context and headings", () => {
  const units = unitsOf(longArticle());

  test("no part ends with a heading or question whose text continues in the next part", () => {
    for (const [i, u] of units.entries()) {
      const last = u.statements.at(-1);
      const next = units[i + 1];
      if (last === undefined || next === undefined || next.block !== u.block) continue;
      assert.equal(next.context.some((c) => c.field === last.field), false, `${u.key} ends with ${last.field}`);
    }
  });

  test("every heading is a statement exactly once, and never context in the unit that checks it", () => {
    const headingFields = units.flatMap((u) => u.statements.filter((s) => /heading$|question$/.test(s.field)).map((s) => `${u.block}|${s.field}`));
    assert.equal(new Set(headingFields).size, headingFields.length, "no heading is checked twice");
    for (const u of units) {
      for (const c of u.context) assert.equal(u.statements.some((s) => s.field === c.field), false, `${u.key}: ${c.field} is both`);
    }
  });

  test("a later part of a section carries its H2 (and the open H3) as context, and the text keeps context apart from statements", () => {
    const section = units.filter((u) => u.block === "section:what-it-does");
    assert.deepEqual(section[0].context, [], "part 1 checks the H2 itself");
    assert.equal(section[0].statements[0].field, "heading");
    for (const u of section.slice(1)) assert.equal(u.context[0]?.field, "heading", u.key);
    const timing = section.find((u) => u.statements.some((s) => s.field === "subsections[0].paragraphs[1]") && !u.statements.some((s) => s.field === "subsections[0].heading"));
    assert.deepEqual(timing?.context.map((c) => c.field), ["heading", "subsections[0].heading"]);
    const parsed = JSON.parse(section[1].text) as { context: unknown[]; statements: { n: number }[] };
    assert.ok(Array.isArray(parsed.context) && parsed.statements.every((s, i) => s.n === i + 1));
  });
});

describe("determinism, hashes and refusals", () => {
  test("the same content always gives the same units and hashes; every hash differs", () => {
    const a = unitsOf(longArticle());
    const b = unitsOf(longArticle());
    assert.deepEqual(a, b);
    assert.deepEqual(a.map(unitSha256), b.map(unitSha256));
    assert.equal(new Set(a.map(unitSha256)).size, a.length);
  });

  test("editing one section changes only that block's units", () => {
    const before = unitsOf(longArticle());
    const after = unitsOf(
      content((raw) => {
        const base = longArticle();
        Object.assign(raw, JSON.parse(JSON.stringify(base)));
        (raw.sections as { paragraphs: string[] }[])[1].paragraphs = [sentences(9, "Stop"), sentences(9, "Pause")];
      }),
    );
    const changed = (block: string) => {
      const x = before.filter((u) => u.block === block).map(unitSha256);
      const y = after.filter((u) => u.block === block).map(unitSha256);
      return JSON.stringify(x) !== JSON.stringify(y);
    };
    assert.equal(changed("section:where-it-stops"), true);
    for (const block of ["metadata", "lead-introduction", "section:what-it-does", "faq", "cta"]) assert.equal(changed(block), false, block);
  });

  test("a single statement too large for a unit refuses the whole version; nothing is cut", () => {
    const plan = articleCheckPlan(content((raw) => ((raw.sections as { paragraphs: string[] }[])[0].paragraphs = ["é".repeat(3_400)])));
    assert.deepEqual([plan.refusal, plan.units.length], ["statement-too-large", 0]);
  });

  test("a version yielding more than 150 units is refused whole", () => {
    const plan = articleCheckPlan(
      content((raw) => {
        raw.sections = Array.from({ length: 30 }, (_, i) => ({
          id: `s${i}`,
          heading: `Section ${i}`,
          paragraphs: Array.from({ length: 6 }, (_, p) => sentences(10, `P${p}`)),
          subsections: [],
        }));
        raw.internalLinks = [];
      }),
    );
    assert.equal(plan.refusal, "too-many-units");
    assert.equal(plan.units.length, 0);
    assert.ok(plan.unitCount > MAX_ARTICLE_UNITS);
  });
});

describe("the pass rule: exact statement coverage", () => {
  test("every statement once, all supported: passed", () => {
    const v = verdict({ supported: 3 }, 3);
    assert.equal(v.status, "passed");
    assert.deepEqual([v.coverageComplete, v.missingStatements, v.duplicateStatements, v.unnumberedLines], [true, [], [], 0]);
  });

  test("a statement left out while another is placed twice cannot pass by count", () => {
    const v = verdict({ supported: 3, numberOf: (line) => (line === 3 ? 2 : line) }, 3);
    assert.equal(v.classifiedCount, 3, "the line count alone would have matched");
    assert.equal(v.status, "needs-review");
    assert.deepEqual([v.missingStatements, v.duplicateStatements], [[3], [2]]);
  });

  test("an unnumbered or out-of-range line is not coverage", () => {
    assert.equal(verdict({ supported: 3, numberOf: (line) => (line === 2 ? null : line) }, 3).unnumberedLines, 1);
    assert.equal(verdict({ supported: 3, numberOf: (line) => (line === 3 ? 7 : line) }, 3).status, "needs-review");
    assert.deepEqual(statementCoverage(["S1: a", "S2: b"], 2), { complete: true, missing: [], duplicate: [], unnumbered: 0 });
    assert.equal(statementNumberOf("S10: text"), 10);
    assert.equal(statementNumberOf("Text S1: no"), null);
  });

  test("any partial, unsupported or unverifiable line: needs-review, never failed", () => {
    assert.equal(verdict({ supported: 2, partial: 1 }, 3).status, "needs-review");
    assert.equal(verdict({ supported: 2, unsupported: 1 }, 3).status, "needs-review");
    assert.equal(verdict({ supported: 2, unverifiable: 1 }, 3).status, "needs-review");
  });

  test("editorial lines never count against a unit; an editorial-only unit passes", () => {
    assert.equal(verdict({ supported: 1, editorial: 2 }, 3).status, "passed");
    assert.equal(verdict({ editorial: 2 }, 2).status, "passed");
    assert.equal(deriveUnitStatus({ partial: [], unsupported: [], unverifiable: [], coverageComplete: false }), "needs-review");
  });

  test("a supported line whose tag names no record in the evidence is moved to unverifiable, keeping its number", () => {
    const moved = verdict({ supported: 2, supportedTag: "[crawl /not-fetched]" }, 2);
    assert.equal(moved.status, "needs-review");
    assert.deepEqual(moved.counts, { supported: 0, partial: 0, unsupported: 0, unverifiable: 2, editorial: 0 });
    assert.equal(moved.coverageComplete, true);
  });

  test("an execution failure is `failed`, and carries no content verdict", () => {
    assert.deepEqual(unitFailure("run-failed", RUN, "op", "2026-09-23T12:06:00.000Z"), { status: "failed", reason: "run-failed", checkedByRunId: RUN, recordedBy: "op", recordedAt: "2026-09-23T12:06:00.000Z" });
  });

  test("a stored result reads back field by field; anything else is refused", () => {
    const stored = verdict({ supported: 1, editorial: 1 }, 2);
    assert.deepEqual(readUnitResult(JSON.parse(JSON.stringify(stored))), stored);
    assert.equal(readUnitResult({ ...stored, status: "approved" }), null);
    assert.equal(readUnitResult({ ...stored, missingStatements: "x" }), null);
  });
});

describe("the article check state, derived", () => {
  const row = (status: "pending" | "passed" | "needs-review" | "failed") => ({ record: { status } });
  test("unchecked, checking, needs-review and passed", () => {
    assert.equal(deriveArticleCheckState([{ record: null }, row("passed")]).state, "unchecked");
    assert.equal(deriveArticleCheckState([row("passed"), row("pending")]).state, "checking");
    assert.equal(deriveArticleCheckState([row("passed"), row("failed")]).state, "needs-review");
    assert.equal(deriveArticleCheckState([row("passed"), row("passed")]).state, "passed");
    assert.equal(deriveArticleCheckState([]).state, "unchecked");
  });
});
