import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Checkpoint 5.5: every list screen that reads the stored project list is
 * rendered per request, so a project added after a deploy appears without a
 * rebuild (the build marks each `ƒ Dynamic`, not `○ Static`).
 */

const PAGES = ["", "projects/", "agents/", "settings/", "keywords/", "technical/", "competitors/", "ai-visibility/", "backlinks/", "analytics/", "content/"];

test("each roster-reading list page declares dynamic rendering", () => {
  for (const page of PAGES) {
    const source = readFileSync(new URL(`../../app/(app)/${page}page.tsx`, import.meta.url), "utf8");
    assert.match(source, /projectRepository/, `${page || "/"} reads the project list`);
    assert.match(source, /^export const dynamic = "force-dynamic";$/m, `${page || "/"} is dynamic`);
  }
});
