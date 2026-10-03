import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * "Check all units", step 3: the control is mounted on the fact-check panel
 * for the current version only, opens the one fix-F3 dialog from the
 * planner's facts, offers Stop while running, and both the panel and the
 * loop's hook read the same refusal wording from one module.
 */
const root = new URL("../../../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const SECTION = read("src/components/content/article-check-section.tsx");
const CONTROL = read("src/components/content/check-all-control.tsx");
const HOOK = read("src/components/content/use-check-all.ts");
const COPY = read("src/components/content/check-failure-copy.ts");

describe("the Check all units control", () => {
  test("mounted in the fact-check panel's header, for the current version of an article that is not archived or approved", () => {
    assert.match(SECTION, /import \{ CheckAllControl \} from "@\/components\/content\/check-all-control"/);
    assert.match(SECTION, /checks\.refusal === null && isCurrent && article\.status !== "archived" && article\.status !== "approved" && \(\s*<CheckAllControl/);
    assert.equal((SECTION.match(/<CheckAllControl/g) ?? []).length, 1);
  });

  test("one confirmation from the planner, through the spending dialog; the loop starts only on its confirm", () => {
    assert.match(CONTROL, /import \{ SpendConfirmDialog \} from "@\/components\/spend\/spend-confirm"/);
    assert.match(CONTROL, /checkAllConfirmation\(plan, \{ projectId, version: checks\.version \}\)/);
    assert.match(CONTROL, /refusalMessage\(plan\.refusal\)/);
    assert.match(CONTROL, /onConfirm=\{\(\) => \{\s*setConfirming\(null\);\s*void start\(\);/);
    assert.ok(!/start\(\)/.test(CONTROL.replace(/onConfirm=\{\(\) => \{\s*setConfirming\(null\);\s*void start\(\);/, "")), "start is called from the dialog's confirm only");
  });

  test("the button, the Stop, the progress line and the end summary with the needs-review list", () => {
    assert.match(CONTROL, /export const CHECK_ALL_LABEL = "Check all units…"/);
    assert.match(CONTROL, /export const CHECK_ALL_STOP_LABEL = "Stop after this unit"/);
    assert.match(CONTROL, /Stopping after this unit…/);
    assert.match(CONTROL, /aria-live="polite"/);
    assert.match(CONTROL, /needing review: \$\{list\}\. Open each row to read the agent's answer; nothing was edited or re-run\./);
    assert.match(CONTROL, /No unit needs review\./);
    assert.match(CONTROL, /Press again to resume from the unchecked rows\./);
    for (const kind of ["run-failed", "check-failed", "refused", "timed-out", "unreadable"]) assert.match(CONTROL, new RegExp(`case "${kind}":`), kind);
    assert.match(CONTROL, /no automatic re-run/);
  });

  test("the hook makes the panel's own requests and nothing else", () => {
    assert.match(HOOK, /fetch\("\/api\/agent-runs", \{ method: "POST"/);
    assert.match(HOOK, /\{ action: "execute" \}/);
    assert.match(HOOK, /carryArticleCheckUnit\(projectId, article\.id, version\.version, unitIndex\)/);
    assert.match(HOOK, /recordArticleCheckUnit\(projectId, article\.id, version\.version, unitIndex, runId\)/);
    assert.match(HOOK, /\/api\/content-article-checks\?project=/);
    assert.doesNotMatch(HOOK, /worker|run-next|Promise\.all/);
    assert.match(HOOK, /queueRefusal\(response\.status, body, ARTICLE_CHECK_UNIT\)/);
  });

  test("the refusal wording lives in one module, read by the panel and the hook", () => {
    assert.match(COPY, /export const CARRY_FAILURE/);
    assert.match(COPY, /export const RECORD_FAILURE/);
    assert.match(SECTION, /import \{ CARRY_FAILURE, RECORD_FAILURE \} from "@\/components\/content\/check-failure-copy"/);
    assert.match(HOOK, /import \{ CARRY_FAILURE, RECORD_FAILURE \} from "@\/components\/content\/check-failure-copy"/);
    assert.doesNotMatch(SECTION, /^export const (CARRY|RECORD)_FAILURE/m);
  });
});
