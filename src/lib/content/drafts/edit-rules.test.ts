import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isUnchanged, MAX_DRAFT_BODY_LENGTH, MAX_DRAFT_TITLE_LENGTH, normaliseText, normaliseVersionText, refusalMessage } from "./edit-rules.ts";

/**
 * The rules an edit must meet before it can be a version, applied by the
 * control before asking and by the server before writing. Pure: nothing
 * here reads or writes anything.
 */

describe("normaliseVersionText", () => {
  test("folds line endings, trims, and accepts text within the columns' bounds", () => {
    const result = normaliseVersionText("  A title\r\n", "First line.\r\nSecond line.\r\n\r\n");
    assert.deepEqual(result, { ok: true, value: { title: "A title", body: "First line.\nSecond line." } });
    assert.equal(normaliseText("a\r\nb\rc\n"), "a\nb\nc");
  });

  test("refuses an empty title or body, including whitespace-only and non-string input, naming the field", () => {
    assert.deepEqual(normaliseVersionText("", "Body."), { ok: false, refusal: { reason: "empty", field: "title" } });
    assert.deepEqual(normaliseVersionText("Title", ""), { ok: false, refusal: { reason: "empty", field: "body" } });
    assert.deepEqual(normaliseVersionText("Title", " \n\r\n\t "), { ok: false, refusal: { reason: "empty", field: "body" } });
    assert.deepEqual(normaliseVersionText(undefined, "Body."), { ok: false, refusal: { reason: "empty", field: "title" } });
    assert.deepEqual(normaliseVersionText("Title", 42), { ok: false, refusal: { reason: "empty", field: "body" } });
    assert.deepEqual(normaliseVersionText("Title", null), { ok: false, refusal: { reason: "empty", field: "body" } });
  });

  test("refuses text over the bounds the migration declares, and accepts text exactly at them", () => {
    assert.equal(MAX_DRAFT_TITLE_LENGTH, 400);
    assert.equal(MAX_DRAFT_BODY_LENGTH, 20_000);
    assert.deepEqual(normaliseVersionText("t".repeat(401), "Body."), { ok: false, refusal: { reason: "too-long", field: "title" } });
    assert.deepEqual(normaliseVersionText("Title", "b".repeat(20_001)), { ok: false, refusal: { reason: "too-long", field: "body" } });
    assert.ok(normaliseVersionText("t".repeat(400), "b".repeat(20_000)).ok);
    // Surrounding whitespace does not count towards the bound.
    assert.ok(normaliseVersionText("Title", `  ${"b".repeat(20_000)}\n`).ok);
    // The title is judged before the body, so a request with both wrong names the title.
    assert.deepEqual(normaliseVersionText("", ""), { ok: false, refusal: { reason: "empty", field: "title" } });
  });
});

describe("isUnchanged", () => {
  test("is true only when both title and body match the saved text after normalisation", () => {
    const saved = { title: "A title", body: "Line one.\nLine two." };
    assert.equal(isUnchanged({ title: "A title", body: "Line one.\nLine two." }, saved), true);
    assert.equal(isUnchanged({ title: " A title\r\n", body: "Line one.\r\nLine two.\n\n" }, saved), true);
    assert.equal(isUnchanged({ title: "A title!", body: saved.body }, saved), false);
    assert.equal(isUnchanged({ title: saved.title, body: "Line one.\nLine two" }, saved), false);
    assert.equal(isUnchanged({ title: saved.title, body: "Line one.\n\nLine two." }, saved), false, "inner whitespace is content");
    assert.equal(isUnchanged({ title: saved.title.toLowerCase(), body: saved.body }, saved), false, "case is content");
  });
});

describe("refusalMessage", () => {
  test("names the field and, for a bound, the limit", () => {
    assert.equal(refusalMessage({ reason: "empty", field: "title" }), "The section title cannot be empty.");
    assert.equal(refusalMessage({ reason: "empty", field: "body" }), "The body cannot be empty.");
    assert.equal(refusalMessage({ reason: "too-long", field: "title" }), "The section title is over 400 characters.");
    assert.equal(refusalMessage({ reason: "too-long", field: "body" }), "The body is over 20,000 characters.");
  });
});
