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
    const control = await readFile(new URL("../../../components/content/draft-panel.tsx", import.meta.url), "utf8");
    const calls = control.match(/saveWriterRunAsDraft\(/g) ?? [];
    assert.equal(calls.length, 1, "the save action is invoked from exactly one place");
    assert.match(control, /async function save\(\)[\s\S]*saveWriterRunAsDraft\(projectId, run\.id\)/);
    const effect = control.match(/useEffect\(\(\) => \{([\s\S]*?)\}, \[projectId, run\.id\]\);/);
    assert.ok(effect, "the restore effect was not found");
    assert.doesNotMatch(effect[1], /saveWriterRunAsDraft/, "the restore effect must not save");
    assert.match(effect[1], /fetch\(`\/api\/content-drafts\?/, "the restore effect reads through the GET route");
  });
});
