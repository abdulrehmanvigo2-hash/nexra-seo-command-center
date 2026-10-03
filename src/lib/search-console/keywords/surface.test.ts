import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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
const VIEWS = read("src/components/keywords/observed-views.tsx");
const SCREEN = read("src/lib/search-console/keywords/screen.ts");
const RUNTIME = read("src/lib/agent-runs/index.ts");
const GROUNDING = read("src/lib/agent-runs/task-grounding.ts");
const INSTRUCTIONS = read("src/lib/search-console/grounding.ts");
const INVENTORY = read("src/lib/search-console/keywords/inventory.ts");

describe("M4 keeps no new raw data", () => {
  test("adds no migration and reads through the two existing stores only", () => {
    const migrations = readdirSync(new URL("supabase/migrations", root)).filter((f) => f.endsWith(".sql")).sort();
    assert.ok(migrations.includes("20261002120000_create_crawl_finding_triage.sql"), "the M3 migration is present");
    // The curated keyword entity (checkpoint 3.5) and the pinned article's keywords (M2, 20261020120000) are their own
    // migrations, not M4's; M4 added none.
    const notM4 = new Set(["20261006120000_curated_keywords.sql", "20261020120000_pinned_article_keywords.sql"]);
    assert.equal(migrations.filter((file) => !notM4.has(file)).some((file) => /keyword|search_console_keywords|inventory/.test(file)), false, "M4 added no migration of its own");
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

describe("the Keyword Intelligence screen (checkpoint 3.4): observed data only", () => {
  const FIXTURE_COMPONENTS = [
    "keywords-table",
    "keywords-toolbar",
    "bulk-actions",
    "keyword-portfolio",
    "discover-dialog",
    "import-dialog",
    "gap-views",
    "serp-view",
    "ai-view",
    "ai-readiness-note",
    "lists-view",
    "clusters-view",
    "movement-view",
    "opportunities-view",
    "cannibalization-view",
    "pagination",
  ];

  test("imports no fixture, no modelled keyword record and no modelled component, and carries no modelled label", () => {
    for (const file of [WORKSPACE, VIEWS, SECTION, SCREEN]) {
      assert.doesNotMatch(file, /@\/lib\/mock|@\/types\/keyword|KeywordRecord/);
      assert.doesNotMatch(file, /Mock data|Modelled|modelled data/);
    }
    for (const name of FIXTURE_COMPONENTS) assert.ok(!WORKSPACE.includes(`@/components/keywords/${name}"`), name);
    assert.doesNotMatch(WORKSPACE, /DiscoverDialog|ImportDialog|BulkActions|Discover keywords/);
  });

  test("shows the five observed tabs and the curated Lists tab (3.5); content gap, competitors, SERP and AI search are absent", () => {
    assert.match(WORKSPACE, /const TABS = KEYWORD_TABS/);
    assert.match(WORKSPACE, /resolveKeywordTab\(searchParams\.get\("tab"\)\)/);
    for (const hidden of ['tab === "gaps"', 'tab === "competitors"', 'tab === "serp"', 'tab === "ai"']) assert.ok(!WORKSPACE.includes(hidden), hidden);
    for (const shown of ['tab === "keywords"', 'tab === "clusters"', 'tab === "opportunities"', 'tab === "movement"', 'tab === "cannibalization"', 'tab === "lists"']) assert.ok(WORKSPACE.includes(shown), shown);
    assert.match(WORKSPACE, /\{tab === "lists" && <CuratedKeywordsList projectId=\{projectId\} load=\{curated\} onChanged=\{reloadCurated\} \/>\}/);
  });

  test("one read for the inventory and one for the curated list, through the project the screen chose, with every state shown", () => {
    assert.equal((WORKSPACE.match(/fetch\(/g) ?? []).length, 2);
    assert.match(WORKSPACE, /fetch\(keywordsUrl\(projectId\)/);
    assert.match(WORKSPACE, /fetch\(keywordsListUrl\(projectId\)/);
    assert.match(WORKSPACE, /useEffect\(\(\) => \{\s+if \(projectId === null\) return;/);
    assert.match(WORKSPACE, /projects\.map\(\(p\) => \(\{ value: p\.id, label: p\.name \}\)\)/, "the stored roster only");
    assert.match(WORKSPACE, /title="No stored project"/);
    for (const state of ['"loading"', '"failed"']) assert.match(WORKSPACE, new RegExp(`load\\.status === ${state}`));
    assert.match(WORKSPACE, /load\.view\.status !== "inventory"/);
    assert.match(WORKSPACE, /describeKeywordStatus\(load\.view\)/);
    assert.match(WORKSPACE, /keywordsReadFailure\(/);
    assert.match(WORKSPACE, /\{OBSERVED_FOOTER\}/);
    assert.match(WORKSPACE, /\{screen\.windows\}/, "the footer states the stored windows read");
  });

  test("the Keywords tab: observed portfolio, then the inventory table, then the Search Console summary", () => {
    const keywordsTab = WORKSPACE.slice(WORKSPACE.indexOf('{tab === "keywords" && ('));
    const portfolio = keywordsTab.indexOf("<ObservedPortfolio");
    const table = keywordsTab.indexOf("<SearchConsoleKeywords");
    const summary = keywordsTab.indexOf('<SearchConsolePanel projectId={projectId} rangeId="30d" view="summary" />');
    assert.ok(portfolio > 0 && portfolio < table && table < summary);
    assert.equal((WORKSPACE.match(/<SearchConsoleKeywords/g) ?? []).length, 1);
    assert.match(VIEWS, /POSITION_NOTE/);
    assert.match(VIEWS, /hint · \{count\}/);
  });

  test("the other tabs: groups inline, the four rule labels, the stored-window comparison and the pair overlap", () => {
    assert.match(WORKSPACE, /\{tab === "clusters" && <ObservedGroups view=\{inventory\} \/>\}/);
    assert.match(WORKSPACE, /\{tab === "opportunities" && <ObservedOpportunities screen=\{screen\} projectId=\{projectId\} curation=\{curation\} \/>\}/);
    assert.match(WORKSPACE, /\{tab === "movement" && <ObservedMovement projectId=\{projectId\} \/>\}/);
    assert.match(WORKSPACE, /\{tab === "cannibalization" && <ObservedCannibalization projectId=\{projectId\} \/>\}/);
    assert.match(VIEWS, /<SearchConsoleHistory projectId=\{projectId\} view="queries" \/>/);
    assert.match(VIEWS, /<SearchConsoleQueryPages projectId=\{projectId\} \/>/);
    assert.match(VIEWS, /GROUP_NOTE/);
    assert.match(VIEWS, /MOVEMENT_NOTE/);
    assert.match(VIEWS, /CANNIBALIZATION_NOTE/);
    const rendered = VIEWS.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/No upside, target CTR or forecast is computed/, "");
    assert.doesNotMatch(rendered, /upside|target CTR|search volume|difficulty|cost per click/i, "no predicted or external figure is rendered");
  });

  test("the cluster detail route is gone (Q2); the keyword detail route exists (replaced in place in 3.5)", () => {
    assert.equal(existsSync(new URL("src/app/(app)/keywords/clusters", root)), false);
    assert.equal(existsSync(new URL("src/app/(app)/keywords/[keywordId]/page.tsx", root)), true);
  });
});

describe("the observed query inventory section", () => {
  test("is the screen's table: no read or selector of its own, the rows the screen's filters keep", () => {
    assert.doesNotMatch(SECTION, /fetch\(|useEffect|<Select|keywordsUrl/);
    assert.match(SECTION, /rows: readonly ObservedQueryView\[\];/);
    assert.match(SECTION, /<ObservedQueryTable rows=\{rows\} projectId=\{projectId\} caption="Observed queries" curation=\{curation\} \/>/);
    assert.match(SECTION, /<CurateKeywordControl projectId=\{projectId\} query=\{row\.query\} curatedId=\{curation\.ids\.get\(row\.query\) \?\? null\} onAdded=\{curation\.onAdded\} \/>/, "3.5: the exact stored query is what is curated");
    assert.match(SECTION, /title="No observed query matches these filters"/);
  });

  test("offers only Record as task, over the full stored query, displays the cut label, and labels its provenance", () => {
    assert.doesNotMatch(SECTION, /method: "POST"|<Button|<form|onClick|useQueuedReview|@\/lib\/mock/);
    assert.match(SECTION, /<RecordTaskControl projectId=\{projectId\} proposal=\{keywordTaskProposal\(row\.query\)\} compact \/>/);
    assert.match(SECTION, /<span title=\{row\.queryLabel\}>\{row\.queryLabel\}<\/span>/);
    assert.match(SECTION, /Observed · derived labels/);
    assert.match(SECTION, /Not fixture data/);
    assert.match(SECTION, /Intent hints \(lexical, derived\)/);
    assert.match(SECTION, /never predicted wins/);
    assert.match(SECTION, /view\.caveats/);
    assert.doesNotMatch(SECTION, /search volume|difficulty score|rank tracker\b(?! reading| 's)/i);
  });
});

describe("the agent wiring", () => {
  test("the inventory reader is wired last, read for the Keyword & Search Intent review only, and the instructions name the block as derived", () => {
    assert.match(RUNTIME, /searchConsoleKeywords: \(projectId\) => readKeywordIntelligence\(projectId\)/);
    // Since 6.5 the keyword opportunity review (the same agent) reads it too; the performance and learning reviews never do.
    assert.match(GROUNDING, /if \(task\.taskType === "search-query-review" \|\| task\.taskType === "keyword-opportunity-review"\) \{\s+try \{\s+keywords = \(await readers\.searchConsoleKeywords\?\.\(task\.project\.id\)\)/);
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
