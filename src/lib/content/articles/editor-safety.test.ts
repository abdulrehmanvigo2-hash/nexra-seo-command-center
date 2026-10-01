import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { contentFromForm, emptyForm, type ArticleForm } from "./editor-form.ts";
import {
  addAttestation,
  attestationPreview,
  attestationsReady,
  chooseAttestation,
  editGuard,
  firstWords,
  followAttestations,
  initialBindings,
  removeAttestation,
} from "./editor-safety.ts";

/**
 * Fix F4 (audit A5-03, A5-04, A5-05): content safety in the article editor.
 * Editor state and wording only — the content the form sends, and so every
 * stored format, hash and pin, is unchanged.
 */

const PANEL = readFileSync(new URL("../../../components/content/article-panel.tsx", import.meta.url), "utf8");

const P1 = "Most leads go quiet after the first reply.";
const P2 = "We think a short, plain follow-up works better than a long one.";
const P3 = "The site lists its services on the homepage.";
const H3P = "A person still reviews every message before it is sent.";

function form(over: Partial<ArticleForm> = {}): ArticleForm {
  return {
    ...emptyForm(),
    sections: [
      { id: "why", heading: "Why leads go quiet", body: [P1, P2].join("\n"), subsections: [{ id: "review", heading: "Review", body: H3P }] },
      { id: "what", heading: "What the site says", body: P3, subsections: [] },
    ],
    attestations: [{ locator: "why/1", basis: "opinion" }],
    ...over,
  };
}

function edit(start: ArticleForm, change: (f: ArticleForm) => ArticleForm) {
  return followAttestations(change(start), initialBindings(start));
}

const withBody = (f: ArticleForm, section: number, body: string): ArticleForm => ({ ...f, sections: f.sections.map((s, i) => (i === section ? { ...s, body } : s)) });

describe("an attestation follows its paragraph through edits (A5-04)", () => {
  test("loaded: each attestation is bound to the text its locator names", () => {
    assert.deepEqual(initialBindings(form()), [{ text: P2, lost: false }]);
  });

  test("with no edit, following changes nothing — the form, and so the content, stay byte for byte", () => {
    const start = form();
    const followed = followAttestations(start, initialBindings(start));
    assert.deepEqual(followed.form, start);
    assert.equal(JSON.stringify(contentFromForm(followed.form)), JSON.stringify(contentFromForm(start)));
  });

  test("a line added above it: the locator moves with the paragraph (why/1 → why/2)", () => {
    const next = edit(form(), (f) => withBody(f, 0, ["A new opening line.", P1, P2].join("\n")));
    assert.equal(next.form.attestations[0]?.locator, "why/2");
    assert.deepEqual(next.bindings, [{ text: P2, lost: false }]);
    assert.deepEqual((contentFromForm(next.form) as { attestations: unknown }).attestations, [{ locator: "why/2", basis: "opinion" }]);
  });

  test("a line removed above it: the locator moves back (why/1 → why/0), never to the paragraph that took its index", () => {
    const next = edit(form(), (f) => withBody(f, 0, P2));
    assert.equal(next.form.attestations[0]?.locator, "why/0");
  });

  test("the paragraph moved to another section, or its section renamed: the mark follows the text", () => {
    const moved = edit(form(), (f) => withBody(withBody(f, 0, P1), 1, [P3, P2].join("\n")));
    assert.equal(moved.form.attestations[0]?.locator, "what/1");
    const renamed = edit(form(), (f) => ({ ...f, sections: f.sections.map((s, i) => (i === 0 ? { ...s, id: "why-quiet" } : s)) }));
    assert.equal(renamed.form.attestations[0]?.locator, "why-quiet/1");
  });

  test("the attested paragraph's own text changed: the mark is cleared and must be chosen again", () => {
    const next = edit(form(), (f) => withBody(f, 0, [P1, `${P2} Mostly.`].join("\n")));
    assert.equal(next.form.attestations[0]?.locator, "");
    assert.deepEqual(next.bindings, [{ text: P2, lost: true }]);
    const rows = attestationPreview(next.form, next.bindings);
    assert.equal(rows[0]?.state, "lost");
    assert.match(rows[0]?.note ?? "", /changed or the paragraph was removed after it was marked\. Choose the paragraph again\./);
    assert.equal(attestationsReady(rows), false);
    // An undo that restores the text binds it again.
    const undone = followAttestations(withBody(next.form, 0, [P1, P2].join("\n")), next.bindings);
    assert.equal(undone.form.attestations[0]?.locator, "why/1");
    assert.equal(undone.bindings[0]?.lost, false);
  });

  test("the H3 holding it removed: the mark is cleared, not moved to another paragraph", () => {
    const start = form({ attestations: [{ locator: "review/0", basis: "experience" }] });
    const next = edit(start, (f) => ({ ...f, sections: f.sections.map((s, i) => (i === 0 ? { ...s, subsections: [] } : s)) }));
    assert.equal(next.form.attestations[0]?.locator, "");
    assert.equal(next.bindings[0]?.lost, true);
  });

  test("identical paragraphs: the mark stays on its own one, and two marks never claim the same paragraph", () => {
    const start = form({
      sections: [{ id: "why", heading: "Why", body: [P2, P1, P2].join("\n"), subsections: [] }],
      attestations: [
        { locator: "why/2", basis: "opinion" },
        { locator: "why/0", basis: "opinion" },
      ],
    });
    const same = followAttestations(start, initialBindings(start));
    assert.deepEqual(same.form.attestations.map((a) => a.locator), ["why/2", "why/0"]);
    const shifted = edit(start, (f) => withBody(f, 0, ["New first line.", P2, P1, P2].join("\n")));
    assert.deepEqual(new Set(shifted.form.attestations.map((a) => a.locator)), new Set(["why/1", "why/3"]));
  });

  test("choosing a paragraph binds the row to its text now and clears a lost mark", () => {
    const lost = edit(form(), (f) => withBody(f, 0, [P1, "Rewritten opinion."].join("\n")));
    const chosen = chooseAttestation(lost.form, lost.bindings, 0, "why/1");
    assert.equal(chosen.form.attestations[0]?.locator, "why/1");
    assert.deepEqual(chosen.bindings, [{ text: "Rewritten opinion.", lost: false }]);
    assert.equal(attestationsReady(attestationPreview(chosen.form, chosen.bindings)), true);
  });

  test("adding and removing rows keeps each binding with its row", () => {
    const start = form();
    const added = addAttestation(start, initialBindings(start));
    assert.equal(added.form.attestations.length, 2);
    assert.deepEqual(added.bindings, [{ text: P2, lost: false }, { text: null, lost: false }]);
    const removed = removeAttestation(added.form, added.bindings, 0);
    assert.deepEqual(removed.form.attestations, [{ locator: "", basis: "" }]);
    assert.deepEqual(removed.bindings, [{ text: null, lost: false }]);
  });
});

describe("the pre-save preview (A5-04)", () => {
  test("each attested paragraph: the label readers see, where it is, and its first words", () => {
    const start = form({ attestations: [{ locator: "why/1", basis: "opinion" }, { locator: "review/0", basis: "experience" }] });
    const rows = attestationPreview(start, initialBindings(start));
    assert.deepEqual(rows[0], { row: 1, label: "Our view", where: "Why leads go quiet ¶2", words: "We think a short, plain follow-up works better than a …", state: "ready", note: null });
    assert.equal(rows[1]?.label, "From our client work — first-hand, not independently verified");
    assert.equal(rows[1]?.where, "Review ¶1");
    assert.equal(attestationsReady(rows), true);
  });

  test("a row with no paragraph or no basis must be settled before saving", () => {
    const start = form({ attestations: [{ locator: "", basis: "opinion" }, { locator: "why/1", basis: "" }] });
    const rows = attestationPreview(start, initialBindings(start));
    assert.deepEqual(rows.map((r) => r.state), ["unchosen", "no-basis"]);
    assert.equal(attestationsReady(rows), false);
  });

  test("first words: at most ten, marked when cut", () => {
    assert.equal(firstWords("one two three"), "one two three");
    assert.equal(firstWords("a b c d e f g h i j k l"), "a b c d e f g h i j …");
  });
});

describe("editing an approved article confirms first (A5-05)", () => {
  test("approved: a new version returns it to drafting; the approved version stays on record", () => {
    const guard = editGuard({ id: "c89182f9-4954-4834-8446-a831fc3c42d0", status: "approved", currentVersion: 4, approvedVersion: 4 });
    assert.ok(guard);
    assert.equal(guard.title, "Version 4 is approved. Edit it as version 5?");
    assert.match(guard.lines[0] ?? "", /creates version 5 and returns the article to drafting\. Version 5 needs a full re-check and its own approval/);
    assert.match(guard.lines[1] ?? "", /Version 4, its approval and any proposal for it stay on record, unchanged\./);
    assert.ok(guard.lines.every((line) => !/live on the website/.test(line)), "not a live article");
    assert.equal(guard.confirmLabel, "Edit as version 5");
  });

  test("the live article says it is live (the slug from the records, fix F9), and that saving does not change the live page", () => {
    const article = { id: "1003104c-6b25-456f-9304-eefa2ba88e7d", status: "approved", currentVersion: 6, approvedVersion: 6 };
    const guard = editGuard(article, { slug: "ai-dead-lead-reactivation" });
    assert.ok(guard?.lines.some((line) => line.includes("live on the website (/blog/ai-dead-lead-reactivation). Saving a version here does not change the live page")));
    assert.ok(editGuard(article)?.lines.every((line) => !/live on the website/.test(line)), "no live line without the records' slug");
  });

  test("checked: confirms too; drafting: no confirmation", () => {
    assert.match(editGuard({ id: "x", status: "checked", currentVersion: 2, approvedVersion: null })?.lines[0] ?? "", /returns the article to drafting; version 3 needs a full re-check/);
    assert.equal(editGuard({ id: "x", status: "drafting", currentVersion: 2, approvedVersion: null }), null);
  });
});

describe("the panel (wiring)", () => {
  test("Edit sits at the foot of the article, after the content, not beside the version selector or the approval", () => {
    const detail = PANEL.slice(PANEL.indexOf("function ArticleDetail("), PANEL.indexOf("function EditArticleRow("));
    assert.ok(detail.indexOf("<EditArticleRow") > detail.indexOf("<ArticleContentView"));
    assert.ok(detail.indexOf("<EditArticleRow") > detail.indexOf("<ArticleApprovalSection"));
    assert.doesNotMatch(detail.slice(0, detail.indexOf("<ArticleApprovalSection")), /Edit as version/);
    assert.match(PANEL, /const guard = editGuard\(article, liveSlug === null \? null : \{ slug: liveSlug \}\);/);
    assert.match(PANEL, /\/api\/content-article-proposals\?project=\$\{encodeURIComponent\(projectId\)\}&article=\$\{encodeURIComponent\(article\.id\)\}/);
    assert.match(PANEL, /onClick=\{\(\) => \(guard === null \? onEdit\(\) : setConfirming\(true\)\)\}/);
    assert.match(PANEL, /<Button variant="ghost" icon="edit"/);
  });

  test("every edit goes through followAttestations; the rows use the binding helpers", () => {
    assert.match(PANEL, /const update = \(change: \(f: ArticleForm\) => ArticleForm\) => setState\(\(current\) => followAttestations\(change\(current\.form\), current\.bindings\)\);/);
    assert.doesNotMatch(PANEL, /setForm\(/);
    assert.match(PANEL, /chooseAttestation\(current\.form, current\.bindings, index, e\.target\.value\)/);
    assert.match(PANEL, /removeAttestation\(current\.form, current\.bindings, index\)/);
    assert.match(PANEL, /addAttestation\(current\.form, current\.bindings\)/);
  });

  test("a save that attests anything shows the preview first; its save waits until every row is settled", () => {
    assert.match(PANEL, /onClick=\{\(\) => \(form\.attestations\.length > 0 \? setPreviewing\(true\) : void submit\(\)\)\}/);
    assert.match(PANEL, /disabled=\{!attestationsReady\(preview\)\}/);
    // The content sent is still contentFromForm's, unchanged.
    assert.match(PANEL, /const content = contentFromForm\(form\);/);
  });

  test("Add H3 and Add H2 section are labelled and set apart (A5-03)", () => {
    assert.match(PANEL, /Add H3 inside section \{index \+ 1\}/);
    assert.match(PANEL, /<Button variant="secondary" icon="plus" onClick=\{\(\) => set\("sections", \[\.\.\.form\.sections, emptySection\(\)\]\)\}>\s+Add H2 section/);
    assert.doesNotMatch(PANEL, />\s+Add section\s+</);
    assert.doesNotMatch(PANEL, />\s+Add H3\s+</);
  });
});
