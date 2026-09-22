import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import { offersSaveAsDraft } from "./eligibility.ts";
import { writerRun } from "./test-support/fixtures.ts";

/**
 * The failure this file exists to prevent: the Save-as-draft control never
 * rendering because the nested Writer review was handed no project. The
 * review control is a client component the Node test runner cannot mount,
 * so the render path is checked at the source, the way the review-request
 * tests check theirs, beside the eligibility rule the render condition uses.
 */

const COMPONENT = new URL("../../../components/agent-runs/queued-review.tsx", import.meta.url);

describe("the Save-as-draft control's render path", () => {
  test("the nested Writer review is handed the project id, so its result can carry the control", async () => {
    const source = await readFile(COMPONENT, "utf8");
    const nested = source.match(/<QueuedReview review=\{SECTION_DRAFT\}[^>]*\/>/);
    assert.ok(nested, "the nested Writer review render was not found");
    assert.match(nested[0], /\bnested\b/);
    assert.match(nested[0], /projectId=\{projectId\}/, "the nested Writer review must receive the project id");
    // WriterDraft holds a string project id, not a nullable one.
    assert.match(source, /function WriterDraft\(\{ projectId, plan \}: \{ projectId: string; plan: AgentRun \}\)/);
  });

  test("the control renders under a result exactly when the project is known and the run is an eligible Writer draft", async () => {
    const source = await readFile(COMPONENT, "utf8");
    assert.match(
      source,
      /\{projectId !== null && offersSaveAsDraft\(run\) && <SaveDraftControl key=\{run\.id\} projectId=\{projectId\} run=\{run\} \/>\}/,
    );
    assert.match(source, /import \{ offersSaveAsDraft \} from "@\/lib\/content\/drafts\/eligibility";/);
    assert.match(source, /import \{ SaveDraftControl \} from "@\/components\/content\/draft-panel";/);
    // The Director hand-off and the Writer control are still gated the same way; neither was loosened.
    assert.match(source, /\{projectId !== null && offersHandoff\(run\) && <DirectorHandoff/);
    assert.match(source, /\{projectId !== null && offersDraft\(run\) && <WriterDraft/);
  });

  test("a completed, grounded, model-executed section draft satisfies the render condition's eligibility half", () => {
    assert.equal(offersSaveAsDraft(writerRun()), true);
    // And a section draft is never itself a hand-off or plan source, so the
    // project id now reaching the nested review adds no other control.
    assert.equal(writerRun().taskType, "section-draft");
  });

  test("the control itself saves only on a click, never on mount", async () => {
    const control = await readFile(PANEL, "utf8");
    const calls = control.match(/saveWriterRunAsDraft\(/g) ?? [];
    assert.equal(calls.length, 1, "the save action is invoked from exactly one place");
    assert.match(control, /async function save\(\)[\s\S]*saveWriterRunAsDraft\(projectId, run\.id\)/);
    const effect = control.match(/useEffect\(\(\) => \{([\s\S]*?)\}, \[projectId, run\.id\]\);/);
    assert.ok(effect, "the restore effect was not found");
    assert.doesNotMatch(effect[1], /saveWriterRunAsDraft|saveDraftVersion/, "the restore effect must not save");
    assert.match(effect[1], /readHistory\(projectId, \{ writerRun: run\.id \}/, "the restore effect reads the saved history");
    assert.match(control, /async function readHistory\([\s\S]*?fetch\(`\/api\/content-drafts\?/, "the read goes through the GET route");
    // The only effect in the file is that restore: no autosave timer, no save on change.
    assert.equal((control.match(/useEffect\(/g) ?? []).length, 1);
    assert.doesNotMatch(control, /setInterval|setTimeout|debounce/);
  });
});

const PANEL = new URL("../../../components/content/draft-panel.tsx", import.meta.url);

/**
 * Stage 2: the same panel edits the current version and shows the history.
 * The rules the control must keep are checked at the source: an edit is
 * saved by one explicit click, from the current version only, with the
 * version the operator started from sent along; a historical version is
 * read-only; and nothing on the client calls a provider, a crawl or a
 * publisher.
 */
describe("the draft panel's editing and history path", () => {
  test("an edit is saved from exactly one place, on the Save click, carrying the draft, the version edited from and the text", async () => {
    const control = await readFile(PANEL, "utf8");
    assert.equal((control.match(/saveDraftVersion\(/g) ?? []).length, 1, "the edit action is invoked from exactly one place");
    assert.match(control, /async function saveEdit\(\) \{\s*if \(saving \|\| !text\.ok \|\| !dirty\) return;/);
    assert.match(control, /saveDraftVersion\(projectId, draft\.id, current\.version, title, body\)/);
    assert.match(control, /onClick=\{saveEdit\} disabled=\{saving \|\| !dirty \|\| !text\.ok \|\| stale !== null\}/);
    // Typing only updates local state.
    assert.match(control, /onChange=\{\(event\) => setTitle\(event\.target\.value\)\}/);
    assert.match(control, /onChange=\{\(event\) => setBody\(event\.target\.value\)\}/);
    assert.match(control, /import \{ isUnchanged, normaliseVersionText, refusalMessage \} from "@\/lib\/content\/drafts\/edit-rules";/);
    assert.match(control, /const text = normaliseVersionText\(title, body\);/);
    assert.match(control, /const dirty = editing && !isUnchanged\(\{ title, body \}, current\);/);
  });

  test("only the current version of a live draft can be edited; a historical version is read-only with a way back", async () => {
    const control = await readFile(PANEL, "utf8");
    assert.match(control, /const viewingCurrent = viewing\.version === current\.version;/);
    assert.match(control, /const canEdit = viewingCurrent && !editing && draft\.status !== "archived";/);
    assert.match(control, /\{canEdit && \(\s*<Button onClick=\{beginEdit\}/);
    assert.match(control, /\{!viewingCurrent && <Badge tone="warning">Historical, read-only<\/Badge>\}/);
    assert.match(control, /\{!viewingCurrent && \(\s*<Button onClick=\{\(\) => setSelectedNumber\(current\.version\)\}/);
    // The selector lists every version and marks the current one; it is locked while editing.
    assert.match(control, /options=\{versions\.map\(\(entry\) => \(\{/);
    assert.match(control, /\$\{entry\.version === current\.version \? " \(current\)" : ""\}/);
    assert.match(control, /disabled=\{editing\}/);
    // Version 1 is labelled as the model's original, every other version as a person's edit.
    assert.match(control, /version\.origin === "writer" \? "AI-generated original" : "Operator edit"/);
  });

  test("a stale refusal is shown, blocks the save, and reload reads the current version without saving", async () => {
    const control = await readFile(PANEL, "utf8");
    assert.match(control, /else if \(result\.reason === "stale"\) \{\s*setStale\(result\.currentVersion\);/);
    assert.match(control, /async function reloadAfterStale\(\) \{\s*const fresh = await onReload\(draft\.id\);/);
    assert.match(control, /async function reload\(draftId: string\): Promise<DraftHistory \| null> \{[\s\S]*?readHistory\(projectId, \{ draft: draftId \}\)/);
    const reload = control.match(/async function reload\(draftId: string\)[\s\S]*?\n  \}/);
    assert.ok(reload);
    assert.doesNotMatch(reload[0], /saveDraftVersion|saveWriterRunAsDraft/);
  });

  test("an operator-edited version is shown as unverified, with the Writer's claims attributed to version 1 only", async () => {
    const control = await readFile(PANEL, "utf8");
    assert.match(control, /\{viewing\.origin === "writer" \? \(\s*<>\s*<ListRow label="Claims used" items=\{viewing\.claims\} \/>/);
    assert.match(control, /Not verified\. This version was edited by a person/);
    assert.match(control, /require re-verification before any approval/);
    assert.match(control, /Recorded for version 1, not for this text/);
    assert.match(control, /Fact-checking, approval and\s+publishing are not available yet/);
  });

  test("the client imports no provider, crawl, publishing or agent-run action", async () => {
    const control = await readFile(PANEL, "utf8");
    const imports = [...control.matchAll(/^(?:import\b[^;]*?|\} )from "([^"]+)";$/gm)].map((match) => match[1]);
    assert.deepEqual(imports.sort(), [
      "@/app/(app)/projects/draft-actions",
      "@/components/ui/badge",
      "@/components/ui/button",
      "@/components/ui/field",
      "@/lib/content/drafts/edit-rules",
      "@/lib/format",
      "@/types/agent-run",
      "@/types/content-draft",
      "react",
    ]);
  });
});
