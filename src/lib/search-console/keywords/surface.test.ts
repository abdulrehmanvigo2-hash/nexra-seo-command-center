import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * Milestone M4: the surfaces that are not the pure modules — the route, the
 * section and its mount, the agent wiring and the instructions — kept from
 * drifting in the files themselves. Behaviour lives in `keywords.test.ts`
 * and the task-grounding tests; there is no migration, and this pins that
 * too.
 */

const root = new URL("../../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

const ROUTE = read("src/app/api/search-console/keywords/route.ts");
const PAIRS_ROUTE = read("src/app/api/search-console/query-pages/route.ts");
const READER = read("src/lib/search-console/keywords/index.ts");
const SECTION = read("src/components/search-console/search-console-keywords.tsx");
const WORKSPACE = read("src/components/keywords/keywords-workspace.tsx");
const RUNTIME = read("src/lib/agent-runs/index.ts");
const GROUNDING = read("src/lib/agent-runs/task-grounding.ts");
const INSTRUCTIONS = read("src/lib/search-console/grounding.ts");
const INVENTORY = read("src/lib/search-console/keywords/inventory.ts");

describe("M4 keeps no new raw data", () => {
  test("adds no migration and reads through the two existing stores only", () => {
    const migrations = readdirSync(new URL("supabase/migrations", root)).filter((f) => f.endsWith(".sql")).sort();
    assert.equal(migrations.at(-1), "20261002120000_create_crawl_finding_triage.sql", "the newest migration is still M3's");
    assert.match(READER, /searchConsoleSnapshotStore\(\)/);
    assert.match(READER, /searchConsoleQueryPageStore\(\)/);
    assert.match(READER, /searchConsoleProperties\(\)\.get\(projectId\)/);
    assert.doesNotMatch(READER, /from\("|\.rpc\(|createSupabaseServerClient|google|fetch\(/);
    assert.doesNotMatch(INVENTORY, /server-only|supabase|fetch\(/);
  });
});

describe("the keywords read route", () => {
  test("mirrors the query-pages route's gates: operator, project shape, the one range, the project stored, then the reader", () => {
    assert.match(ROUTE, /export async function GET\(/);
    assert.doesNotMatch(ROUTE, /export async function (POST|PUT|PATCH|DELETE)/);
    const operator = ROUTE.indexOf("await getOperator()");
    const shape = ROUTE.indexOf("isStorableProjectId(projectId)");
    const range = ROUTE.indexOf("rangeId !== KEYWORDS_VIEW_RANGE_ID");
    const exists = ROUTE.indexOf("projectRepository.getProjectById(projectId)");
    const readAt = ROUTE.indexOf("readKeywordIntelligence(projectId)");
    assert.ok(operator > 0 && operator < shape && shape < exists && range > 0 && range < exists && exists < readAt);
    assert.match(ROUTE, /"Cache-Control": "private, no-store"/);
    assert.match(ROUTE, /presentKeywordIntelligence\(intelligence\)/);
    for (const code of ['{ error: "unauthorized" }, { status: 401', '{ error: "bad-request" }, { status: 400', '{ error: "not-found" }, { status: 404', '{ error: "unavailable" }, { status: 503']) {
      assert.ok(ROUTE.includes(code), code);
      assert.ok(PAIRS_ROUTE.includes(code), `${code} in the P4c route too`);
    }
    assert.doesNotMatch(ROUTE, /error\.message|String\(error\)/);
    assert.doesNotMatch(ROUTE, /searchParams\.get\("property"\)/, "no request names a property");
  });
});

describe("the observed query inventory section", () => {
  test("is mounted exactly once whenever the Keywords tab is active, whatever the project filter says, beneath the Search Console panel", () => {
    assert.match(WORKSPACE, /import \{ SearchConsoleKeywords \} from "@\/components\/search-console\/search-console-keywords"/);
    assert.equal((WORKSPACE.match(/<SearchConsoleKeywords/g) ?? []).length, 1);
    assert.match(WORKSPACE, /\{tab === "keywords" && \(\s+<SearchConsoleKeywords\s+projects=\{projects\}\s+initialProjectId=\{filters\.project === "all" \? null : filters\.project\}\s+\/>/);
    assert.doesNotMatch(WORKSPACE, /filters\.project !== "all" && \(\s+<SearchConsoleKeywords/, "the mount no longer depends on the filter");
    assert.ok(WORKSPACE.indexOf("<SearchConsolePanel") < WORKSPACE.indexOf("<SearchConsoleKeywords"), "beneath the panel");
    assert.match(WORKSPACE, /Mock data over the/, "the modelled universe keeps its label");
    assert.match(WORKSPACE, /projects: readonly ProjectOption\[\];/, "the roster it hands down is the stored roster");
  });

  test("carries its own stored-project selector, seeded from the filter when that names a stored project", () => {
    assert.match(SECTION, /projects: readonly ProjectOption\[\];/);
    assert.match(SECTION, /initialProjectId: string \| null;/);
    assert.match(SECTION, /useState<string \| null>\(\(\) =>\s+initialProjectId !== null && projects\.some\(\(project\) => project\.id === initialProjectId\) \? initialProjectId : null,/);
    assert.match(SECTION, /<Select\s+id=\{selectId\}/);
    assert.match(SECTION, /Stored project/);
    assert.match(SECTION, /\.\.\.projects\.map\(\(project\) => \(\{ value: project\.id, label: project\.name \}\)\)/, "the roster only");
    assert.match(SECTION, /label: "Choose a project"/);
    assert.match(SECTION, /title="Choose a single project"/);
    assert.match(SECTION, /title="No stored project"/);
  });

  test("reads nothing until a project is chosen, then the keywords endpoint only", () => {
    assert.match(SECTION, /useState<Load>\(\{ status: "idle" \}\)/);
    assert.match(SECTION, /useEffect\(\(\) => \{\s+if \(projectId === null\) return;/);
    assert.match(SECTION, /keywordsUrl\(projectId\)/);
    assert.equal((SECTION.match(/fetch\(/g) ?? []).length, 1);
    assert.match(SECTION, /setLoad\(\{ status: "idle" \}\)/, "clearing the selection clears the read");
  });

  test("offers no control beyond the selector, imports no fixture, and labels its provenance", () => {
    assert.doesNotMatch(SECTION, /method: "POST"|<Button|<form|onClick|useQueuedReview|@\/lib\/mock/);
    assert.match(SECTION, /Observed · derived labels/);
    assert.match(SECTION, /Not the modelled keyword universe above/);
    assert.match(SECTION, /Not fixture data/);
    assert.match(SECTION, /Intent hints \(lexical, derived\)/);
    assert.match(SECTION, /a shared word, not a topic/);
    assert.match(SECTION, /never predicted wins/);
    for (const state of ['"loading"', '"failed"']) assert.match(SECTION, new RegExp(`load\\.status === ${state}`));
    assert.match(SECTION, /load\.view\.status !== "inventory"/);
    assert.match(SECTION, /describeKeywordStatus\(/);
    assert.match(SECTION, /keywordsReadFailure\(/);
    assert.match(SECTION, /view\.caveats/);
    assert.doesNotMatch(SECTION, /search volume|difficulty score|rank tracker\b(?! reading| 's)/i);
  });
});

describe("the agent wiring", () => {
  test("the inventory reader is wired last, read for the Keyword & Search Intent review only, and the instructions name the block as derived", () => {
    assert.match(RUNTIME, /searchConsoleKeywords: \(projectId\) => readKeywordIntelligence\(projectId\)/);
    assert.match(GROUNDING, /if \(task\.taskType === "search-query-review"\) \{\s+try \{\s+keywords = \(await readers\.searchConsoleKeywords\?\.\(task\.project\.id\)\)/);
    assert.match(GROUNDING, /keywords: keywordGrounding\.summary/);
    assert.ok(GROUNDING.indexOf("formatQueryPageGrounding(queryPages, audience)") < GROUNDING.indexOf("formatKeywordGrounding(keywords)"), "after the pairs");
    assert.match(INSTRUCTIONS, /Where an OBSERVED QUERY INVENTORY block follows/);
    assert.match(INSTRUCTIONS, /must never cite as OBSERVED/);
    assert.match(INSTRUCTIONS, /never a predicted gain/);
    assert.match(INSTRUCTIONS, /If no such block follows, infer nothing in its place/);
    const performance = INSTRUCTIONS.slice(INSTRUCTIONS.indexOf("PERFORMANCE_REVIEW_INSTRUCTIONS = ["));
    assert.doesNotMatch(performance, /OBSERVED QUERY INVENTORY/, "the performance review's instructions are untouched");
  });
});
