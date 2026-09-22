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
    assert.match(control, /A fact-check and an approval\s+each belong to the exact version they were recorded for\. Publishing is not available yet/);
  });

  test("the client imports no provider, crawl, publishing or agent-run action", async () => {
    const control = await readFile(PANEL, "utf8");
    const imports = [...control.matchAll(/^(?:import\b[^;]*?|\} )from "([^"]+)";$/gm)].map((match) => match[1]);
    assert.deepEqual(imports.sort(), [
      "@/app/(app)/projects/draft-actions",
      "@/components/agent-runs/queued-review",
      "@/components/content/publication-proposal-section",
      "@/components/ui/badge",
      "@/components/ui/button",
      "@/components/ui/field",
      "@/lib/content/drafts/approval-rules",
      "@/lib/content/drafts/edit-rules",
      "@/lib/content/drafts/fact-check-eligibility",
      "@/lib/content/drafts/parse-fact-check-output",
      "@/lib/crawl/review-request",
      "@/lib/format",
      "@/types/agent-run",
      "@/types/content-draft",
      "react",
    ]);
  });
});

/**
 * Stage 3: the fact-check on the same panel. Checked at the source, as the
 * editing path is: the check is queued and started through the shared
 * review control's own clicks, its result is recorded by one explicit click
 * bound to the version on screen, nothing runs or records on its own, and
 * no approve or publish control exists.
 */
describe("the draft panel's fact-check path", () => {
  test("the fact-check section is keyed to one draft and one version, asks the shared control for exactly that version, and records only on its own click", async () => {
    const control = await readFile(PANEL, "utf8");
    assert.match(control, /<FactCheckSection\s+key=\{`\$\{draft\.id\}:\$\{viewing\.version\}`\}/);
    assert.match(control, /const request = factCheckRequest\(projectId, draft, version\);/);
    assert.match(control, /useQueuedReview\(request, `\$\{draft\.id\}:\$\{version\.version\}`, DRAFT_FACT_CHECK, projectId\)/);
    assert.equal((control.match(/recordDraftFactCheck\(/g) ?? []).length, 1, "the record action is invoked from exactly one place");
    assert.match(control, /async function record\(\) \{\s*if \(recording \|\| run === null \|\| !recordable\) return;/);
    assert.match(control, /recordDraftFactCheck\(projectId, draft\.id, version\.version, run\.id\)/);
    assert.match(control, /onClick=\{\(\) => void record\(\)\} disabled=\{!recordable \|\| recording\}/);
    // The button is offered only for a completed run whose own metadata names this version.
    assert.match(control, /const recordable = run !== null && offersRecordFactCheck\(run, draft\.id, version\.version\);/);
    // Still the one restore effect in the file: nothing checks or records on mount, and no timer.
    assert.equal((control.match(/useEffect\(/g) ?? []).length, 1);
    assert.doesNotMatch(control, /setInterval|setTimeout|debounce/);
  });

  test("an unchecked version says so; the control is offered for the current version of a live draft only; a recorded result is shown with its groups and its wording", async () => {
    const control = await readFile(PANEL, "utf8");
    assert.match(control, /<Badge tone="neutral">Not fact-checked<\/Badge>/);
    assert.match(control, /Only the current version \(\$\{draft\.currentVersion\}\) can be checked\./);
    assert.match(control, /\{isCurrent && draft\.status !== "archived" && \(/);
    assert.match(control, /if \(stored !== null\) return <FactCheckResult check=\{stored\} \/>;/);
    assert.match(control, /const stored = readFactCheck\(version\.factCheck\);/);
    for (const label of ["Supported", "Partly supported", "Unsupported — no record holds this", "Unverifiable from these records", "Editorial — no factual claim"]) {
      assert.ok(control.includes(`<FactCheckGroup label="${label}"`), label);
    }
    assert.match(control, /Version \{check\.version\} checked/);
    assert.match(control, /Unsupported means no record holds\s+the statement, not that it is false\. This is not an approval, and nothing was published\./);
    assert.match(control, /passed: \{ tone: "positive", label: "Passed" \}/);
    assert.match(control, /"needs-review": \{ tone: "warning", label: "Needs review" \}/);
    assert.match(control, /failed: \{ tone: "critical", label: "Failed" \}/);
  });

  test("no publish or delete control exists on the panel, and the fact-check itself approves nothing", async () => {
    const control = await readFile(PANEL, "utf8");
    const buttonLabels = [...control.matchAll(/<Button[^>]*>\s*([^<{]+?)\s*<\/Button>/g)].map((match) => match[1].trim());
    for (const label of buttonLabels) assert.doesNotMatch(label, /publish|delete/i, label);
    assert.doesNotMatch(control, /onClick=\{[^}]*(publish|delete)[^}]*\}/i);
    // Recording a fact-check never approves: the record control's own wording, and its action, say so.
    assert.match(control, /Writes this run's result onto this version, once\. The text is not changed, and nothing is approved or published\./);
    assert.doesNotMatch(control, /async function record\(\) \{[\s\S]*?approveDraftVersion[\s\S]*?\n  \}/);
  });

  test("the record control's failure wording covers every server answer and treats a mismatched version as a refusal, not a retry", async () => {
    const control = await readFile(PANEL, "utf8");
    for (const reason of ["unauthorized", '"rate-limited"', "invalid", "unavailable", '"not-found"', '"version-not-found"', '"already-checked"', '"run-not-found"', "failed"]) {
      assert.ok(control.includes(`${reason}:`), reason);
    }
    assert.match(control, /result\.refusal === "version-mismatch"\s*\? "This run checked a different version, so its result cannot be recorded here\."/);
    assert.match(control, /a version is checked once/);
  });
});

/**
 * Stage 4: approval on the same panel. Checked at the source: the policy
 * decides what is shown, the button exists only for an eligible current
 * version, a confirmation click stands between the button and the write,
 * the write is one action bound to the version on screen, an approved
 * version stays identifiable in history, and no publish control exists.
 */
describe("the draft panel's approval path", () => {
  test("the approval section is keyed to one draft, one version and the parent's status, decides by the shared policy, and approves only after a confirmation click", async () => {
    const control = await readFile(PANEL, "utf8");
    assert.match(control, /<ApprovalSection\s+key=\{`approval:\$\{draft\.id\}:\$\{viewing\.version\}:\$\{draft\.status\}`\}/);
    assert.match(control, /const eligibility = approvalEligibility\(draft, version\);/);
    assert.equal((control.match(/approveDraftVersion\(/g) ?? []).length, 1, "the approve action is invoked from exactly one place");
    assert.match(control, /async function approve\(\) \{\s*if \(approving \|\| !confirming \|\| !eligibility\.ok\) return;/);
    assert.match(control, /approveDraftVersion\(projectId, draft\.id, version\.version\)/);
    assert.match(control, /<Button onClick=\{\(\) => setConfirming\(true\)\} icon="check">\s*Approve version \{version\.version\}/);
    assert.match(control, /Confirm: approve version \$\{version\.version\}/);
    assert.match(control, /<Button onClick=\{\(\) => setConfirming\(false\)\} disabled=\{approving\}>\s*Cancel/);
    assert.equal((control.match(/useEffect\(/g) ?? []).length, 1, "no effect approves or records on its own");
  });

  test("an eligible version reads Ready for approval; an ineligible current version reads Not eligible with the policy's reason; an approved version shows version, approver and time", async () => {
    const control = await readFile(PANEL, "utf8");
    assert.match(control, /<Badge tone="accent">Ready for approval<\/Badge>/);
    assert.match(control, /The recorded fact-check of this version passed\. Approving records this exact text as approved; it\s+publishes nothing\./);
    assert.match(control, /\{isCurrent \? "Not eligible for approval" : "Not approved"\}/);
    assert.match(control, /\{approvalRefusalMessage\(eligibility\.reason\)\}/);
    assert.match(control, /<Badge tone="positive" dot>\s*Approved\s*<\/Badge>/);
    assert.match(control, /Approved version \{draft\.approvedVersion\}/);
    assert.match(control, /by operator \$\{draft\.approvedBy\}/);
    assert.match(control, /formatFullDate\(draft\.approvedAt\)/);
    // History: the approved version keeps its badge whatever the parent's status is now.
    assert.match(control, /\{isApprovedVersion\(draft, viewing\) && <Badge tone="positive">Approved version<\/Badge>\}/);
    assert.match(control, /This version was approved as it stood; version \$\{draft\.currentVersion\} is current now and has not been approved\./);
    // A stale refusal names the newer version and approves nothing.
    assert.match(control, /so nothing was approved\. Reload the draft to read the current version\./);
  });

  test("no publish or delete control exists, and approval says it publishes nothing", async () => {
    const control = await readFile(PANEL, "utf8");
    const buttonLabels = [...control.matchAll(/<Button[^>]*>\s*([^<{]+?)\s*<\/Button>/g)].map((match) => match[1].trim());
    for (const label of buttonLabels) assert.doesNotMatch(label, /publish|delete/i, label);
    assert.doesNotMatch(control, /onClick=\{[^}]*(publish|delete)[^}]*\}/i);
    assert.match(control, /It is not published: publishing is not available yet\./);
    assert.match(control, /Publishing is not available yet, and this draft is\s+not published anywhere\./);
  });
});
