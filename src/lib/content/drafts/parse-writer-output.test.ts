import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SECTION_DRAFT_STATUS } from "../draft-grounding.ts";
import { WRITER_OUTPUT } from "./test-support/fixtures.ts";
import {
  MAX_DRAFT_BODY_LENGTH,
  WRITER_HEADINGS,
  WRITER_STATUS_LINE,
  parseWriterOutput,
} from "./parse-writer-output.ts";

/**
 * The failure this file exists to prevent is a draft version that holds
 * something the Writer did not say: a guessed section, a status sentence
 * inside the prose, or a claim list invented from nothing.
 */

describe("parseWriterOutput", () => {
  test("the fixed status line is the Writer's own", () => {
    assert.equal(WRITER_STATUS_LINE, SECTION_DRAFT_STATUS);
    assert.deepEqual([...WRITER_HEADINGS], ["SECTION", "DRAFT", "CLAIMS USED", "PLACEHOLDERS", "STATUS"]);
  });

  test("a valid five-section answer parses, with the prose kept exactly and the status kept out of it", () => {
    const result = parseWriterOutput(WRITER_OUTPUT);
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.output.sectionLabel, "What automated lead follow-up does [crawl /]");
    assert.equal(
      result.output.body,
      "Nexra Agency's home page presents automated lead follow-up as the service it leads with. Its title names automation and its one heading repeats it, so a visitor arriving from search meets the same promise twice.\nThe page describes itself as the canonical address for that offer.",
    );
    assert.deepEqual(result.output.claims, [
      "The home page title names automation. [crawl /]",
      "The page has one h1. [crawl /]",
      "The canonical points at itself. [crawl /]",
    ]);
    assert.deepEqual(result.output.placeholders, ["[NEEDS EVIDENCE: how quickly a lead is contacted]"]);
    assert.equal(result.output.status, WRITER_STATUS_LINE);
    assert.ok(!result.output.body.includes("Draft for operator review"));
    assert.ok(!result.output.body.includes("Every claim in this draft"));
  });

  test("none under CLAIMS USED or PLACEHOLDERS becomes an empty list, however it is punctuated", () => {
    for (const none of ["none", "None", "none.", "**none**", "NONE"]) {
      const text = WRITER_OUTPUT.replace(/CLAIMS USED\n[\s\S]*?\n\nPLACEHOLDERS\n[^\n]+/, `CLAIMS USED\n${none}\n\nPLACEHOLDERS\n${none}`);
      const result = parseWriterOutput(text);
      assert.ok(result.ok, none);
      if (!result.ok) return;
      assert.deepEqual(result.output.claims, [], none);
      assert.deepEqual(result.output.placeholders, [], none);
    }
  });

  test("headings are matched by their words, so decoration and CRLF endings do not change the result", () => {
    const decorated = WRITER_OUTPUT.replace("SECTION\n", "**SECTION:**\n")
      .replace("DRAFT\n", "## Draft\n")
      .replace("CLAIMS USED\n", "3. CLAIMS USED —\n")
      .replace("PLACEHOLDERS\n", "- Placeholders:\n")
      .replace("STATUS\n", "__STATUS__\n");
    const plain = parseWriterOutput(WRITER_OUTPUT);
    for (const text of [decorated, WRITER_OUTPUT.replace(/\n/g, "\r\n")]) {
      const result = parseWriterOutput(text);
      assert.ok(result.ok);
      if (!result.ok || !plain.ok) return;
      assert.equal(result.output.sectionLabel, plain.output.sectionLabel);
      assert.deepEqual(result.output.claims, plain.output.claims);
      assert.equal(result.output.body.replace(/\r/g, ""), plain.output.body);
    }
  });

  test("a missing heading is refused, whichever one it is", () => {
    for (const heading of WRITER_HEADINGS) {
      const text = WRITER_OUTPUT.replace(`${heading}\n`, "");
      const result = parseWriterOutput(text);
      assert.deepEqual(result, { ok: false, reason: "headings" }, heading);
    }
  });

  test("headings out of order, or repeated, are refused", () => {
    const swapped = WRITER_OUTPUT.replace("CLAIMS USED\n", "PLACEHOLDERS\n").replace(/PLACEHOLDERS\n\[NEEDS/, "CLAIMS USED\n[NEEDS");
    assert.deepEqual(parseWriterOutput(swapped), { ok: false, reason: "headings" });
    assert.deepEqual(parseWriterOutput(`${WRITER_OUTPUT}\n\nSTATUS\nagain`), { ok: false, reason: "headings" });
  });

  test("an empty section line, an empty draft, a missing or unexpected status line are refused, and nothing is inferred", () => {
    assert.deepEqual(parseWriterOutput(WRITER_OUTPUT.replace("SECTION\nWhat automated lead follow-up does [crawl /]", "SECTION\n")), { ok: false, reason: "section-empty" });
    assert.deepEqual(parseWriterOutput(WRITER_OUTPUT.replace(/DRAFT\n[\s\S]*?\n\nCLAIMS USED/, "DRAFT\n\nCLAIMS USED")), { ok: false, reason: "body-empty" });
    assert.deepEqual(parseWriterOutput(WRITER_OUTPUT.replace(`STATUS\n${WRITER_STATUS_LINE}\n\n`, "STATUS\n")), { ok: false, reason: "status-unexpected" });
    assert.deepEqual(parseWriterOutput(WRITER_OUTPUT.replace(`STATUS\n${WRITER_STATUS_LINE}`, "STATUS\nApproved and published.")), { ok: false, reason: "status-unexpected" });
    assert.deepEqual(parseWriterOutput(`${WRITER_OUTPUT.split("STATUS\n")[0]}STATUS\n`), { ok: false, reason: "status-missing" });
  });

  test("the Writer's evidence-needed answer is not a draft: SECTION none is refused", () => {
    const none = WRITER_OUTPUT.replace("SECTION\nWhat automated lead follow-up does [crawl /]", "SECTION\nnone — no outline section carries a record tag");
    assert.deepEqual(parseWriterOutput(none), { ok: false, reason: "section-none" });
  });

  test("a body over the column's bound is refused rather than cut", () => {
    const long = WRITER_OUTPUT.replace(/DRAFT\n[\s\S]*?\n\nCLAIMS USED/, `DRAFT\n${"x".repeat(MAX_DRAFT_BODY_LENGTH + 1)}\n\nCLAIMS USED`);
    assert.deepEqual(parseWriterOutput(long), { ok: false, reason: "body-too-long" });
  });

  test("text that is not the Writer's contract at all is refused", () => {
    for (const text of ["", "Simulated section draft by Writer for nexraagency.com. The mock executor read no plan and no record.", "SECTION\nonly a section", "# A heading\nsome prose"]) {
      assert.equal(parseWriterOutput(text).ok, false, JSON.stringify(text));
    }
  });
});
