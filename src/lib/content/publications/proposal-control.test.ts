import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { describe, test } from "node:test";

/**
 * The proposal control, its actions and its library, checked at the source,
 * the way the draft panel's tests check theirs: the Node test runner cannot
 * mount a client component. What is asserted is what must never drift: the
 * statement that nothing is published, the absence of any publish, merge,
 * deploy or pull-request control, a confirmation click before every write,
 * no write on mount, operator checks before anything else, and no network
 * code anywhere in the publication library.
 */

const SECTION = new URL("../../../components/content/publication-proposal-section.tsx", import.meta.url);
const PANEL = new URL("../../../components/content/draft-panel.tsx", import.meta.url);
const ACTIONS = new URL("../../../app/(app)/projects/publication-actions.ts", import.meta.url);
const ROUTE = new URL("../../../app/api/content-publications/route.ts", import.meta.url);
const LIBRARY = new URL("./", import.meta.url);

const FORBIDDEN_CONTROL = /publish(?!ation)|merge|deploy|pull request|create pr|\bPR\b/i;

describe("the proposal section", () => {
  test("is rendered by the draft panel for the version on screen, keyed by the draft, the version and the draft's state", async () => {
    const panel = await readFile(PANEL, "utf8");
    assert.match(panel, /import \{ PublicationProposalSection \} from "@\/components\/content\/publication-proposal-section";/);
    assert.match(
      panel,
      /<PublicationProposalSection\s+key=\{`proposal:\$\{draft\.id\}:\$\{viewing\.version\}:\$\{draft\.status\}:\$\{draft\.currentVersion\}`\}\s+projectId=\{projectId\}\s+draft=\{draft\}\s+version=\{viewing\}\s+\/>/,
    );
    assert.equal((panel.match(/<PublicationProposalSection/g) ?? []).length, 1);
  });

  test("states that a proposal does not publish content or create a GitHub pull request", async () => {
    const section = await readFile(SECTION, "utf8");
    assert.match(section, /<p className="text-xs text-fg-subtle">\{NO_PUBLICATION_STATEMENT\}<\/p>/, "the statement is shown whatever the state");
    assert.match(section, /import \{ DRAFT_SECTION_LABEL, NO_PUBLICATION_STATEMENT \} from "@\/lib\/content\/publications\/preview";/);
    assert.match(section, /\{DRAFT_SECTION_LABEL\}/, "the preview is labelled a draft section");
  });

  test("offers no publish, merge, deploy or pull-request control", async () => {
    const section = await readFile(SECTION, "utf8");
    const labels = [...section.matchAll(/<Button[^>]*>\s*([\s\S]*?)\s*<\/Button>/g)].map((m) => m[1].replace(/\s+/g, " ").trim());
    assert.ok(labels.length >= 5, `button labels found: ${labels.join(" | ")}`);
    for (const label of labels) assert.doesNotMatch(label, FORBIDDEN_CONTROL, label);
    assert.doesNotMatch(section, /onClick=\{[^}]*(publish(?!ation)|merge|deploy)[^}]*\}/i);
    assert.deepEqual(
      labels.filter((label) => /Prepare|Withdraw|Confirm|Cancel/.test(label)).length,
      labels.length,
      "every button prepares, confirms, withdraws or cancels",
    );
  });

  test("prepares and withdraws only after a confirmation click, each from exactly one place, with the server's version and hash", async () => {
    const section = await readFile(SECTION, "utf8");
    assert.equal((section.match(/preparePublicationProposal\(/g) ?? []).length, 1);
    assert.equal((section.match(/withdrawPublicationProposal\(/g) ?? []).length, 1);
    assert.match(section, /async function prepare\(\) \{\s*if \(working \|\| !open \|\| destination === null \|\| !slugCheck\.ok\) return;/);
    assert.match(section, /preparePublicationProposal\(projectId, draft\.id, candidate\.version, destination\.key, slugCheck\.slug, candidate\.contentSha256\)/);
    assert.match(section, /async function withdraw\(\) \{\s*if \(working \|\| !confirming\) return;/);
    assert.match(section, /Confirm: prepare proposal for version \$\{candidate\.version\}/);
    assert.match(section, /"Confirm: withdraw proposal"/);
  });

  test("writes nothing on its own: one effect, a GET read, no timers", async () => {
    const section = await readFile(SECTION, "utf8");
    assert.equal((section.match(/useEffect\(/g) ?? []).length, 1);
    const effect = section.match(/useEffect\(\(\) => \{([\s\S]*?)\}, \[projectId, draft\.id\]\);/);
    assert.ok(effect, "the read effect was not found");
    assert.doesNotMatch(effect[1], /preparePublicationProposal|withdrawPublicationProposal/);
    assert.match(section, /fetch\(`\/api\/content-publications\?\$\{params\.toString\(\)\}`, \{ cache: "no-store", signal \}\)/);
    assert.equal((section.match(/fetch\(/g) ?? []).length, 1, "the only request is the read");
    assert.doesNotMatch(section, /setInterval|setTimeout|debounce/);
  });

  test("an ineligible version shows the reason and offers no enabled proposal action", async () => {
    const section = await readFile(SECTION, "utf8");
    const ineligible = section.match(/\} else \{\s*\/\/ The server's reason[\s\S]*?main = \(([\s\S]*?)\);\s*\}/);
    assert.ok(ineligible, "the ineligible branch was not found");
    assert.match(ineligible[1], /Not eligible for a publication proposal/);
    assert.match(ineligible[1], /proposalRefusalMessage\(reason\)/);
    assert.doesNotMatch(ineligible[1], /<Button/, "the ineligible branch renders a button");
    // The prepare control exists only where the server returned a candidate for the current version.
    assert.match(section, /\} else if \(viewingCurrent && state\.candidate !== null\) \{/);
  });

  test("never sends the approval, the text or the operator: the browser names ids, the destination, the slug and the hash it was shown", async () => {
    const section = await readFile(SECTION, "utf8");
    const call = section.match(/preparePublicationProposal\(([^)]*)\)/)?.[1] ?? "";
    assert.doesNotMatch(call, /title|body|approved|operator|requestedBy/);
  });
});

describe("the proposal actions and read route", () => {
  test("each action confirms the operator first, treats every argument as unknown, and is rate limited and single-flight", async () => {
    const actions = await readFile(ACTIONS, "utf8");
    assert.match(actions, /^"use server";/);
    const exported = [...actions.matchAll(/^export async function (\w+)/gm)].map((m) => m[1]);
    assert.deepEqual(exported, ["preparePublicationProposal", "withdrawPublicationProposal"]);
    for (const name of exported) {
      const body = actions.match(new RegExp(`export async function ${name}\\(([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
      assert.match(body, /: unknown/, name);
      assert.doesNotMatch(body, /: string[,)]/, `${name} trusts an argument's type`);
      const first = body.indexOf("await getOperator()");
      assert.ok(first > 0 && first < body.indexOf("publicationService()"), `${name} reaches the service before the operator check`);
      assert.match(body, /if \(!operator\) return \{ ok: false, reason: "unauthorized" \};/);
      assert.match(body, /inFlight\.has\(operator\.id\)/);
      assert.match(body, /appRateLimiter\("publications\.(propose|withdraw)"/);
      assert.match(body, /operatorId: operator\.id/, `${name} takes the operator from the session`);
    }
  });

  test("the read route is operators-only and reads only", async () => {
    const route = await readFile(ROUTE, "utf8");
    assert.match(route, /const operator = await getOperator\(\);\s*if \(!operator\) return errorResponse\("unauthorized", 401\);/);
    assert.deepEqual([...route.matchAll(/^export async function (\w+)/gm)].map((m) => m[1]), ["GET"]);
    assert.doesNotMatch(route, /\.propose\(|\.withdraw\(/);
  });
});

describe("the publication library", () => {
  test("contains no network code, no GitHub client and no credential: nothing can reach a repository, a website or a deployment", async () => {
    const files: string[] = [];
    for (const entry of await readdir(LIBRARY, { recursive: true })) {
      if (typeof entry === "string" && /\.tsx?$/.test(entry) && !/\.test\.ts$/.test(entry)) files.push(entry);
    }
    assert.ok(files.length >= 8, files.join(", "));
    const sources = [
      ...(await Promise.all(files.map(async (file) => [file, await readFile(new URL(file, LIBRARY), "utf8")] as const))),
      ["publication-actions.ts", await readFile(ACTIONS, "utf8")] as const,
      ["publication-proposal-section.tsx", await readFile(SECTION, "utf8")] as const,
    ];
    for (const [file, source] of sources) {
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      assert.doesNotMatch(code, /octokit|api\.github\.com|github\.com\/|node:https?|node:net|child_process|XMLHttpRequest|WebSocket/i, file);
      assert.doesNotMatch(code, /GITHUB_|GH_TOKEN|VERCEL_|DEPLOY_HOOK/i, `${file} reads a credential`);
      if (file !== "publication-proposal-section.tsx") assert.doesNotMatch(code, /\bfetch\(/, `${file} makes a request`);
    }
  });
});
