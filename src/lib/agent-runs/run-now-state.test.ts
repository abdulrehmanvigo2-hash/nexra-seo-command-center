import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { runNowButtonState } from "@/lib/agent-runs/run-now-state";

describe("Run Now in a list of queued runs", () => {
  test("nothing in flight: every button is ready", () => {
    assert.deepEqual(runNowButtonState("a", null), { executing: false, blocked: false });
  });

  test("only the pressed run shows running; the others are held, not running", () => {
    const ids = ["opening", "section-1", "section-2", "closing"];
    const states = ids.map((id) => runNowButtonState(id, "section-1"));
    assert.deepEqual(states.map((s) => s.executing), [false, true, false, false]);
    assert.deepEqual(states.map((s) => s.blocked), [true, false, true, true]);
  });

  test("every list of runs passes each button its own state, never the hook's shared flag", () => {
    for (const file of ["src/components/content/opportunity-brief.tsx", "src/components/content/evidence-tab.tsx"]) {
      const text = readFileSync(file, "utf8");
      assert.doesNotMatch(text, /executing=\{executing\}/, file);
      assert.match(text, /runNowButtonState\(run\.id, executingId\)/, file);
    }
  });
});
