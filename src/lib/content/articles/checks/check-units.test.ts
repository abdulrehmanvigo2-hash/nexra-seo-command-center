import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseFactCheckOutput } from "../../drafts/parse-fact-check-output.ts";
import { buildUnitVerdict, deriveArticleCheckState, deriveUnitStatus, readUnitResult, unitFailure } from "./result.ts";
import { answer, content } from "./test-support/fixtures.ts";
import { unitSha256 } from "./unit-hash.ts";
import { ARTICLE_CHECK_UNIT_FORMAT, articleCheckUnits, MAX_UNIT_BYTES, MAX_UNIT_STATEMENTS, statementsIn } from "./units.ts";

/**
 * Stage 5, milestone C4: an article version cut into check units, and the
 * result and state rules over them. Offline and pure apart from the hash.
 */

const EVIDENCE = { crawlId: "8f1c0d2e-0000-4000-8000-000000000001", searchWindow: null, recordPaths: ["/services"] };
const RUN = "c0000000-0000-4000-8000-000000000001";

function verdict(lines: Parameters<typeof answer>[0], statementCount: number) {
  const parsed = parseFactCheckOutput(answer(lines));
  assert.ok(parsed.ok, "fixture answer parses");
  return buildUnitVerdict({ output: parsed.output, evidence: EVIDENCE, statementCount, checkedByRunId: RUN, checkedAt: "2026-09-23T12:05:00.000Z", recordedBy: "op", recordedAt: "2026-09-23T12:06:00.000Z" });
}

describe("unit generation", () => {
  const units = articleCheckUnits(content());

  test("orders units deterministically: metadata, lead-introduction, sections in article order, faq, cta", () => {
    assert.deepEqual(
      units.map((u) => [u.index, u.kind, u.key]),
      [
        [0, "metadata", "metadata"],
        [1, "lead-introduction", "lead-introduction"],
        [2, "section", "section:what-it-does"],
        [3, "section", "section:where-it-stops"],
        [4, "faq", "faq"],
        [5, "cta", "cta"],
      ],
    );
  });

  test("the metadata unit holds topic, intent, title, meta title, meta description, excerpt, category and keywords — and no slug, decision or links", () => {
    const parsed = JSON.parse(units[0].text) as { format: string; kind: string; key: string; content: Record<string, unknown> };
    assert.equal(parsed.format, ARTICLE_CHECK_UNIT_FORMAT);
    assert.deepEqual(Object.keys(parsed.content), ["topic", "searchIntent", "title", "metaTitle", "metaDescription", "excerpt", "category", "keywords"]);
    assert.equal(/slug|topicDecision|internalLinks|missed-call-text-back"/.test(units[0].text), false);
  });

  test("the lead-introduction unit holds the lead and the introduction paragraphs", () => {
    const parsed = JSON.parse(units[1].text) as { content: Record<string, unknown> };
    assert.deepEqual(Object.keys(parsed.content), ["lead", "introduction"]);
    assert.equal(units[1].label, "Lead and introduction");
  });

  test("a section unit holds its id, heading, paragraphs and its own H3 subsections only", () => {
    const first = JSON.parse(units[2].text) as { content: { id: string; heading: string; subsections: { id: string }[] } };
    assert.equal(first.content.id, "what-it-does");
    assert.deepEqual(first.content.subsections.map((s) => s.id), ["timing"]);
    assert.equal(units[2].label, "What a text-back does");
    assert.equal(units[3].text.includes("timing"), false, "a subsection belongs to its own section only");
    assert.equal(units[2].text.includes("where-it-stops"), false);
  });

  test("many sections give one unit each, in order", () => {
    const three = articleCheckUnits(
      content((raw) => {
        (raw.sections as unknown[]).push({ id: "third", heading: "Third", paragraphs: ["Three."], subsections: [] });
        (raw.internalLinks as unknown[]).length = 0;
      }),
    );
    assert.deepEqual(three.filter((u) => u.kind === "section").map((u) => [u.index, u.key]), [
      [2, "section:what-it-does"],
      [3, "section:where-it-stops"],
      [4, "section:third"],
    ]);
    assert.equal(three.at(-1)?.key, "cta");
  });

  test("the FAQ unit exists only when there are FAQs; the CTA unit is always last", () => {
    const none = articleCheckUnits(content((raw) => (raw.faqs = [])));
    assert.deepEqual(none.map((u) => u.key), ["metadata", "lead-introduction", "section:what-it-does", "section:where-it-stops", "cta"]);
    const faq = units.find((u) => u.kind === "faq");
    assert.ok(faq && faq.text.includes("Does the caller have to reply?"));
    const cta = JSON.parse(units[5].text) as { content: Record<string, unknown> };
    assert.deepEqual(Object.keys(cta.content), ["ctaTitle", "ctaBody"]);
  });

  test("keys and texts are stable: the same content always gives the same units and hashes", () => {
    const again = articleCheckUnits(content());
    assert.deepEqual(again, units);
    assert.deepEqual(again.map(unitSha256), units.map(unitSha256));
    for (const hash of units.map(unitSha256)) assert.match(hash, /^[0-9a-f]{64}$/);
    assert.equal(new Set(units.map(unitSha256)).size, units.length, "every unit hashes differently");
  });

  test("a content change changes only the affected unit's hash", () => {
    const before = units.map(unitSha256);
    const edited = articleCheckUnits(
      content((raw) => {
        const sections = raw.sections as { paragraphs: string[] }[];
        sections[1].paragraphs = ["It does not replace calling the lead back, and it never will."];
      }),
    ).map(unitSha256);
    assert.deepEqual(
      edited.map((hash, i) => hash !== before[i]),
      [false, false, false, true, false, false],
    );
    const retitled = articleCheckUnits(content((raw) => (raw.title = "A different title"))).map(unitSha256);
    assert.deepEqual(retitled.map((hash, i) => hash !== before[i]), [true, false, false, false, false, false]);
  });

  test("statements are counted per sentence and bound the unit; an oversized unit is marked, never cut", () => {
    assert.equal(statementsIn("One. Two! Three? Four"), 4);
    assert.equal(statementsIn(""), 0);
    assert.equal(units[5].statementCount, 2);
    assert.equal(units[0].statementCount, 8);
    assert.ok(units.every((u) => u.oversize === null));
    const big = articleCheckUnits(
      content((raw) => {
        const sections = raw.sections as { paragraphs: string[] }[];
        sections[0].paragraphs = [Array.from({ length: MAX_UNIT_STATEMENTS + 1 }, (_, i) => `Sentence ${i}.`).join(" ")];
      }),
    );
    assert.equal(big[2].oversize, "too-many-statements");
    assert.ok(big[2].text.includes(`Sentence ${MAX_UNIT_STATEMENTS}.`), "the text is kept whole, not truncated");
    const long = articleCheckUnits(content((raw) => ((raw.sections as { paragraphs: string[] }[])[0].paragraphs = ["x".repeat(MAX_UNIT_BYTES / 2), "y".repeat(MAX_UNIT_BYTES / 2)])));
    assert.equal(long[2].oversize, "too-many-bytes");
  });
});

describe("the pass rule", () => {
  test("supported only, every statement placed: passed", () => {
    assert.equal(verdict({ supported: 3 }, 3).status, "passed");
  });

  test("any partial, unsupported or unverifiable line: needs-review, never failed", () => {
    assert.equal(verdict({ supported: 2, partial: 1 }, 3).status, "needs-review");
    assert.equal(verdict({ supported: 2, unsupported: 1 }, 3).status, "needs-review");
    assert.equal(verdict({ supported: 2, unverifiable: 1 }, 3).status, "needs-review");
  });

  test("editorial lines never count against a unit; an editorial-only unit passes", () => {
    assert.equal(verdict({ supported: 1, editorial: 2 }, 3).status, "passed");
    assert.equal(verdict({ editorial: 2 }, 2).status, "passed");
  });

  test("a check that did not place every statement, or placed none, needs review", () => {
    const short = verdict({ supported: 2 }, 5);
    assert.equal(short.status, "needs-review");
    assert.equal(short.coverageComplete, false);
    assert.equal(deriveUnitStatus({ supported: [], partial: [], unsupported: [], unverifiable: [], editorial: [], statementCount: 0 }), "needs-review");
  });

  test("a supported line whose tag names no record in the evidence is moved to unverifiable", () => {
    const moved = verdict({ supported: 2, supportedTag: "[crawl /not-fetched]" }, 2);
    assert.equal(moved.status, "needs-review");
    assert.deepEqual(moved.counts, { supported: 0, partial: 0, unsupported: 0, unverifiable: 2, editorial: 0 });
  });

  test("an execution failure is `failed`, and carries no content verdict", () => {
    const failure = unitFailure("run-failed", RUN, "op", "2026-09-23T12:06:00.000Z");
    assert.deepEqual(failure, { status: "failed", reason: "run-failed", checkedByRunId: RUN, recordedBy: "op", recordedAt: "2026-09-23T12:06:00.000Z" });
  });

  test("a stored result reads back field by field; anything else is refused", () => {
    const stored = verdict({ supported: 1, editorial: 1 }, 2);
    assert.deepEqual(readUnitResult(JSON.parse(JSON.stringify(stored))), stored);
    assert.equal(readUnitResult({ ...stored, status: "approved" }), null);
    assert.equal(readUnitResult({ ...stored, counts: null }), null);
    assert.equal(readUnitResult({ status: "failed", reason: "nope", checkedByRunId: RUN, recordedBy: "op", recordedAt: "x" }), null);
  });
});

describe("the article check state, derived", () => {
  const row = (status: "pending" | "passed" | "needs-review" | "failed") => ({ record: { status } });
  test("unchecked with no rows, or while any unit has none and none is pending", () => {
    assert.equal(deriveArticleCheckState([{ record: null }, { record: null }]).state, "unchecked");
    assert.equal(deriveArticleCheckState([row("passed"), { record: null }]).state, "unchecked");
    assert.equal(deriveArticleCheckState([]).state, "unchecked");
  });
  test("checking while any unit is pending", () => {
    assert.equal(deriveArticleCheckState([row("passed"), row("pending"), { record: null }]).state, "checking");
  });
  test("needs-review when every unit finished and one is not passed", () => {
    assert.equal(deriveArticleCheckState([row("passed"), row("needs-review")]).state, "needs-review");
    assert.equal(deriveArticleCheckState([row("passed"), row("failed")]).state, "needs-review");
  });
  test("passed only when every unit passed", () => {
    const all = deriveArticleCheckState([row("passed"), row("passed"), row("passed")]);
    assert.equal(all.state, "passed");
    assert.deepEqual(all.tally, { total: 3, passed: 3, needsReview: 0, failed: 0, pending: 0, unchecked: 0 });
  });
});
