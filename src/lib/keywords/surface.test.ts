import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

/**
 * Checkpoint 3.5: the curated keyword surfaces that are not pure modules —
 * the migration's column list, the routes' gates, the replaced detail page,
 * the store's writes, and that nothing reaches agent grounding (Q6) — kept
 * from drifting in the files themselves.
 */

const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

const MIGRATION = read("supabase/migrations/20261006120000_curated_keywords.sql");
const LIST_ROUTE = read("src/app/api/keywords/route.ts");
const ACTION_ROUTE = read("src/app/api/keywords/[keywordId]/route.ts");
const PAGE = read("src/app/(app)/keywords/[keywordId]/page.tsx");
const STORE = read("src/lib/keywords/supabase/store.ts");
const CONTRACT = read("src/lib/keywords/contract.ts");
const DETAIL = read("src/components/keywords/live-keyword-detail.tsx");
const LIST = read("src/components/keywords/curated-keywords.tsx");

function filesUnder(dir: string): string[] {
  const full = new URL(dir, root).pathname;
  return readdirSync(full).flatMap((name) => {
    const path = join(full, name);
    return statSync(path).isDirectory() ? filesUnder(`${dir}/${name}`) : [path];
  });
}

describe("the migration", () => {
  test("pins the keyword columns: the exact query and the operator's fields, never a figure", () => {
    const table = MIGRATION.slice(MIGRATION.indexOf("create table public.nexra_keywords ("), MIGRATION.indexOf("comment on table public.nexra_keywords"));
    const columns = [...table.matchAll(/^ {2}([a-z_]+) (?:uuid|text|timestamptz)/gm)].map((m) => m[1]);
    assert.deepEqual(columns, ["id", "project_id", "query", "group_label", "note", "target_page", "status", "created_by", "created_at", "updated_at"]);
    assert.doesNotMatch(table, /volume|difficulty|cpc|position|rank|traffic|serp|intent|score/i);
    assert.match(table, /constraint nexra_keywords_project_query_key unique \(project_id, query\)/);
    assert.match(MIGRATION, /grant select on table public\.nexra_keywords to service_role;/);
    assert.doesNotMatch(MIGRATION, /grant (insert|update|delete)/i);
  });
});

describe("the routes", () => {
  test("list and add: operator first, the request's shape, the limiter, then the service; writes from this site only", () => {
    const get = LIST_ROUTE.slice(LIST_ROUTE.indexOf("export async function GET"), LIST_ROUTE.indexOf("export async function POST"));
    const order = ["await getOperator()", "parseListKeywordsRequest(", 'keywordLimiter("read")', "keywordService().listKeywords("].map((s) => get.indexOf(s));
    assert.ok(order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1])), `GET order ${order}`);
    const post = LIST_ROUTE.slice(LIST_ROUTE.indexOf("export async function POST"));
    const postOrder = ["isSameOrigin(request)", "await getOperator()", "parseAddKeywordsRequest(", 'keywordLimiter("write")', "keywordService().addKeywords("].map((s) => post.indexOf(s));
    assert.ok(postOrder.every((i, n) => i > 0 && (n === 0 || i > postOrder[n - 1])), `POST order ${postOrder}`);
    const actionOrder = ["isSameOrigin(request)", "await getOperator()", "isKeywordId(keywordId)", "parseKeywordActionRequest(", 'keywordLimiter("write")', "keywordService().act("].map((s) => ACTION_ROUTE.indexOf(s));
    assert.ok(actionOrder.every((i, n) => i > 0 && (n === 0 || i > actionOrder[n - 1])), `action order ${actionOrder}`);
    for (const route of [LIST_ROUTE, ACTION_ROUTE]) assert.doesNotMatch(route, /error\.message|String\(error\)/);
    assert.doesNotMatch(ACTION_ROUTE, /export async function (GET|PUT|PATCH|DELETE)/);
  });

  test("the store writes only through the five database functions", () => {
    const rpcs = [...STORE.matchAll(/rpc\("([a-z_]+)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(rpcs, ["nexra_keyword_add", "nexra_keyword_set_group", "nexra_keyword_set_note", "nexra_keyword_set_status", "nexra_keyword_set_target"]);
    assert.doesNotMatch(STORE, /\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
  });
});

describe("the detail page, replaced in place (Q2)", () => {
  test("checks the id's shape, then the operator, then the read limit, then reads; nothing prerendered, no fixture", () => {
    const order = ["isKeywordId(id)", "await getOperator()", 'keywordLimiter("read").consume(operator.id)', "keywordService().readKeyword("].map((s) => PAGE.indexOf(s));
    assert.ok(order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1])), `order ${order}`);
    assert.doesNotMatch(PAGE, /generateStaticParams|@\/lib\/mock|KeywordWorkspace/);
    assert.match(PAGE, /if \(detail\.status === "not-found"\) notFound\(\);/);
  });

  test("the detail and list show no external or predicted figure and say an unobserved keyword is not observed", () => {
    for (const file of [DETAIL, LIST]) {
      const rendered = file.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/There is no search volume, keyword difficulty, cost per click, traffic estimate or SERP feature here/, "").replace(/A curated keyword holds no volume, difficulty, rank or traffic/, "");
      assert.doesNotMatch(rendered, /search volume|difficulty|cost per click|traffic potential|upside/i);
      assert.doesNotMatch(file, /@\/lib\/mock\/keywords|@\/types\/keyword"/);
    }
    assert.match(CONTRACT, /never zero/);
    assert.match(read("src/lib/keywords/observed.ts"), /export const NOT_OBSERVED = "Not observed in stored rows";/);
  });
});

describe("curated keywords are not agent grounding (Q6)", () => {
  test("nothing under the agent runtime or the task grounding reads the keyword store or table", () => {
    const files = [...filesUnder("src/lib/agent-runs"), ...filesUnder("src/lib/agent-tasks")].filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    assert.ok(files.length > 10);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      assert.doesNotMatch(source, /@\/lib\/keywords|nexra_keywords|keywordService\(/, file);
    }
  });
});
