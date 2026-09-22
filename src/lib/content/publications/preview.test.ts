import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { contentSha256, isSha256Hex, previewSha256 } from "./content-hash.ts";
import { NEXRA_AGENCY_WEBSITE } from "./destinations.ts";
import { buildPublicationPreview, DRAFT_SECTION_LABEL, NO_PUBLICATION_STATEMENT, PREVIEW_FORMAT } from "./preview.ts";
import { APPROVED_AT, APPROVER, DRAFT_ID, VERSION_2, VERSION_2_ID, VERSION_2_SQL_HASH } from "./test-support/fixtures.ts";

/**
 * The content hash matches what Postgres computes from the stored row, and
 * the preview is the version's exact text inside a fixed, labelled frame.
 */

const INPUT = {
  destination: NEXRA_AGENCY_WEBSITE,
  slug: "lead-follow-up",
  projectId: "nexra-agency",
  draftId: DRAFT_ID,
  version: 2,
  versionId: VERSION_2_ID,
  contentSha256: VERSION_2_SQL_HASH,
  approvedBy: APPROVER,
  approvedAt: APPROVED_AT,
  title: VERSION_2.title,
  body: VERSION_2.body,
};

describe("contentSha256", () => {
  test("equals the hash nexra_content_publication_propose computes in Postgres for the same text, accents, CJK and emoji included", () => {
    assert.equal(contentSha256(VERSION_2), VERSION_2_SQL_HASH);
  });

  test("the NUL separator keeps the title and body apart: moving text across the boundary changes the hash", () => {
    assert.notEqual(contentSha256({ title: "ab", body: "c" }), contentSha256({ title: "a", body: "bc" }));
    assert.notEqual(contentSha256({ title: "a", body: "b" }), contentSha256({ title: "b", body: "a" }));
    assert.equal(contentSha256({ title: "a", body: "b" }), contentSha256({ title: "a", body: "b" }));
    assert.equal(isSha256Hex(contentSha256({ title: "a", body: "b" })), true);
  });

  test("isSha256Hex accepts only 64 lowercase hex characters", () => {
    assert.equal(isSha256Hex("a".repeat(64)), true);
    assert.equal(isSha256Hex("A".repeat(64)), false);
    assert.equal(isSha256Hex("a".repeat(63)), false);
    assert.equal(isSha256Hex(null), false);
  });
});

describe("buildPublicationPreview", () => {
  test("carries the approved version's exact title and body, unaltered, and is labelled a draft section that publishes nothing", () => {
    const preview = buildPublicationPreview(INPUT);
    assert.equal(preview.format, PREVIEW_FORMAT);
    assert.equal(preview.title, VERSION_2.title);
    assert.equal(preview.body, VERSION_2.body);
    assert.ok(preview.document.endsWith(`TITLE\n${VERSION_2.title}\n\nBODY\n${VERSION_2.body}`), "the text is the document's last part, verbatim");
    assert.ok(preview.document.includes(DRAFT_SECTION_LABEL));
    assert.equal(NO_PUBLICATION_STATEMENT, "This proposal does not publish content or create a GitHub pull request.");
    assert.ok(preview.document.includes(NO_PUBLICATION_STATEMENT));
    assert.match(preview.document, /Content path: unresolved/);
    assert.match(preview.document, new RegExp(`Version: 2 \\(row ${VERSION_2_ID}\\)`));
    assert.match(preview.document, new RegExp(`Content SHA-256: ${VERSION_2_SQL_HASH}`));
  });

  test("whitespace and markup in the text are kept exactly, never trimmed or rendered", () => {
    const body = "  Leading spaces.\n\n<script>alert(1)</script>\n**bold**  ";
    const preview = buildPublicationPreview({ ...INPUT, body });
    assert.equal(preview.body, body);
    assert.ok(preview.document.endsWith(`BODY\n${body}`));
  });

  test("is deterministic, and its hash changes with every bound field", () => {
    const base = previewSha256(buildPublicationPreview(INPUT).document);
    assert.equal(previewSha256(buildPublicationPreview(INPUT).document), base);
    for (const change of [{ slug: "other-slug" }, { version: 3 }, { versionId: "00000000-0000-4000-8000-0000000000e3" }, { body: `${VERSION_2.body}!` }, { approvedAt: "2026-09-22T15:00:00.123457+00:00" }]) {
      assert.notEqual(previewSha256(buildPublicationPreview({ ...INPUT, ...change }).document), base, JSON.stringify(change));
    }
  });
});
