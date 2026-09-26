import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";

/**
 * The operator surface of the Director's project review (M5), checked as
 * source: one panel, mounted once on the project screen, that previews the
 * server's selection rule over the same listing the Run History panel reads
 * and offers the shared control — and nothing that could execute, publish or
 * name a source of its own.
 */
const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

describe("the project Director panel", () => {
  test("previews the server's rule with the pure selector over one bounded GET per supported agent, and queues through the shared control", async () => {
    const panel = await read("../../components/projects/project-director-panel.tsx");
    assert.match(panel, /^"use client";/);
    assert.match(panel, /selectDirectorSources\(projectId, listed\)/);
    assert.match(panel, /DIRECTOR_SOURCE_SLOTS\.map\(async \(slot\) =>/);
    assert.match(panel, /new URLSearchParams\(\{ project: projectId, agent: slot\.agentId, limit: String\(SOURCE_SCAN_LIMIT\) \}\)/);
    assert.match(panel, /fetch\(`\/api\/agent-runs\?\$\{params\.toString\(\)\}`, \{ cache: "no-store", signal: controller\.signal \}\)/);
    assert.equal((panel.match(/fetch\(/g) ?? []).length, 1, "one read, and only of the run list");
    assert.match(panel, /useQueuedReview\(projectDirectorRequest\(projectId, sources\), projectId, PROJECT_PRIORITY_REVIEW, projectId\)/);
    assert.match(panel, /<QueuedReview review=\{PROJECT_PRIORITY_REVIEW\} projectId=\{projectId\} \{\.\.\.review\} \/>/);
    assert.doesNotMatch(panel, /method: "POST"|action: "execute"|sourceRunId|run-next|agent-runs\/worker/);
    assert.doesNotMatch(panel, /@\/lib\/mock\/(?!agents\/registry)/, "no fixture data reaches the panel");
  });

  test("says what the preview is and is not, and shows each supported review as eligible or missing", async () => {
    const panel = await read("../../components/projects/project-director-panel.tsx");
    assert.match(panel, /Sources the Director would read now/);
    assert.match(panel, /The server re-selects when the run executes; the completed result names what it read\./);
    assert.match(panel, /Eligible/);
    assert.match(panel, /Missing/);
    assert.match(panel, /newer not eligible/);
    assert.match(panel, /Reading the project&apos;s run history…/);
    assert.match(panel, /The project&apos;s run history could not be read/);
    assert.match(panel, /it does not see the crawls or reports themselves, and it ranks nothing on general SEO knowledge/);
    assert.match(panel, /assigns nothing, schedules nothing, and changes nothing/);
  });

  test("is mounted exactly once, on the project screen, beneath the specialist controls", async () => {
    const screen = await read("../../components/projects/project-unmeasured.tsx");
    assert.equal((screen.match(/<ProjectDirectorPanel projectId=\{project\.id\} \/>/g) ?? []).length, 1);
    assert.ok(screen.indexOf("<ProjectDirectorPanel") > screen.indexOf("<CrawlPanel"), "after the crawl panel it draws on");
    assert.ok(screen.indexOf("<ProjectDirectorPanel") > screen.indexOf("<SearchConsolePanel"), "after the Search Console panel it draws on");
    for (const other of ["agents-workspace.tsx", "agent-run-history.tsx"]) {
      const source = await read(`../../components/agents/${other}`);
      assert.doesNotMatch(source, /ProjectDirectorPanel/, `${other} is not redesigned`);
    }
  });

  test("the task is read-only, Director-only, input-free, and is never a hand-off source", async () => {
    const types = await read("./task-types.ts");
    assert.match(types, /id: "project-priority-review",\n  label: "Project Director review",[\s\S]*?agents: \["seo-director"\],\n  policy: "read-only",\n  evidence: "agent-runs",/);
    const grounding = await read("./run-grounding.ts");
    assert.doesNotMatch(grounding.slice(grounding.indexOf("UPSTREAM_TASK_TYPES: readonly"), grounding.indexOf("];")), /project-priority-review/);
    const mock = await read("./mock-executor.ts");
    assert.match(mock, /case "project-priority-review": \{[\s\S]*?simulated: true,[\s\S]*?grounded: false,/);
  });
});
