import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { describe, test } from "node:test";

/**
 * The website dry-run panel and its read route, checked at the source (the
 * test runner cannot mount a client component): the panel is read-only,
 * has no control at all, always says nothing was created, and reads through
 * the one GET route; the route is operators-only and reads; and nothing in
 * the website dry-run code can reach the network or GitHub.
 */

const PANEL = new URL("../../../../components/content/website-dry-run-panel.tsx", import.meta.url);
const SECTION = new URL("../../../../components/content/publication-proposal-section.tsx", import.meta.url);
const ROUTE = new URL("../../../../app/api/content-publications/dry-run/route.ts", import.meta.url);
const LIBRARY = new URL("./", import.meta.url);

describe("the website dry-run panel", () => {
  test("is rendered for the active proposal only, keyed by it, inside the proposal section", async () => {
    const section = await readFile(SECTION, "utf8");
    assert.match(section, /import \{ WebsiteDryRunPanel \} from "@\/components\/content\/website-dry-run-panel";/);
    assert.equal((section.match(/<WebsiteDryRunPanel /g) ?? []).length, 1);
    assert.match(section, /<WebsiteDryRunPanel key=\{proposal\.id\} projectId=\{projectId\} draftId=\{proposal\.draftId\} proposalId=\{proposal\.id\} \/>/);
    const active = section.match(/function ActiveProposal\([\s\S]*$/)?.[0] ?? "";
    assert.ok(active.includes("<WebsiteDryRunPanel "), "the panel is not inside the active proposal's view");
  });

  test("has no control of any kind: no button, no click handler, no form, no action import", async () => {
    const panel = await readFile(PANEL, "utf8");
    assert.doesNotMatch(panel, /<Button|<button|onClick|<form|onSubmit|use server|publication-actions|draft-actions/);
    assert.doesNotMatch(panel, /Create PR|Publish|Merge|Deploy/);
  });

  test("always states that nothing was created, and shows the status, checklist, warnings and both artifacts with their hashes", async () => {
    const panel = await readFile(PANEL, "utf8");
    assert.match(panel, /<p className="text-xs text-fg-subtle">\{NO_EXTERNAL_ACTION_NOTICE\}<\/p>/, "the notice is not unconditional");
    for (const part of [
      "{load.dryRun.statusLabel}",
      "Destination repository: {template.repository}",
      "Pinned template: {template.id} at commit {template.pinnedCommit}",
      "Route: {dryRun.route}",
      "Page file: {dryRun.page.path}",
      "Registry file: {dryRun.registry.path}",
      "dryRun.fields.map",
      "dryRun.missingRequired.map",
      "dryRun.warnings.map",
      "SHA-256: {artifact.sha256}",
      "{artifact.content}",
      '<ArtifactPreview title="page.tsx dry-run" artifact={dryRun.page} />',
      '<ArtifactPreview title="lib/blog.ts record dry-run" artifact={dryRun.registry} />',
    ]) {
      assert.ok(panel.includes(part), part);
    }
    // Artifact text is shown as text inside <pre>, never as HTML.
    assert.doesNotMatch(panel, /dangerouslySetInnerHTML|innerHTML/);
  });

  test("reads once through the dry-run GET route, and writes nothing", async () => {
    const panel = await readFile(PANEL, "utf8");
    assert.equal((panel.match(/fetch\(/g) ?? []).length, 1);
    assert.match(panel, /fetch\(`\/api\/content-publications\/dry-run\?\$\{params\.toString\(\)\}`, \{ cache: "no-store", signal \}\)/);
    assert.doesNotMatch(panel, /method:/);
    assert.equal((panel.match(/useEffect\(/g) ?? []).length, 1);
    assert.doesNotMatch(panel, /setInterval|setTimeout/);
  });
});

describe("the dry-run read route", () => {
  test("is operators-only, GET-only, and calls only the dry-run read", async () => {
    const route = await readFile(ROUTE, "utf8");
    assert.match(route, /const operator = await getOperator\(\);\s*if \(!operator\) return errorResponse\("unauthorized", 401\);/);
    assert.deepEqual([...route.matchAll(/^export async function (\w+)/gm)].map((m) => m[1]), ["GET"]);
    assert.match(route, /websiteDryRunService\(\)\.getDryRun\(project, draft, proposal\)/);
    assert.doesNotMatch(route, /\.propose\(|\.withdraw\(|fetch\(/);
  });
});

describe("the website dry-run library", () => {
  test("contains no network code, no GitHub client, no credential, no eval and no template engine", async () => {
    const files = (await readdir(LIBRARY)).filter((name) => /\.tsx?$/.test(name) && !name.endsWith(".test.ts"));
    assert.deepEqual(files.sort(), ["article-contract.ts", "index.ts", "render.ts", "service.ts", "template.ts", "topic-overlap.ts", "tsx-literal.ts"]);
    const sources = await Promise.all([...files.map((f) => new URL(f, LIBRARY)), PANEL, ROUTE].map(async (url) => [url.pathname, await readFile(url, "utf8")] as const));
    for (const [file, source] of sources) {
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      assert.doesNotMatch(code, /octokit|api\.github\.com|github\.com\/|node:https?|node:net|child_process|XMLHttpRequest|WebSocket/i, file);
      assert.doesNotMatch(code, /GITHUB_|GH_TOKEN|VERCEL_|DEPLOY_HOOK|process\.env/, `${file} reads configuration or a credential`);
      assert.doesNotMatch(code, /\beval\(|new Function\(|vm\.run|renderToString|dangerouslySetInnerHTML/, file);
      if (!file.endsWith("website-dry-run-panel.tsx")) assert.doesNotMatch(code, /\bfetch\(/, `${file} makes a request`);
    }
  });
});
