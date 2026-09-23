import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * Stage 5, milestone C4: the surfaces that are not the service — the
 * migration's shape, the Server Action, the read route and the panel. The
 * migration's behaviour was run against PostgreSQL 16 (identity, transitions,
 * run binding, version safety, the checked transition, grants, and two
 * concurrent last-unit records); these checks keep its promises from
 * drifting in the file itself.
 */

const root = new URL("../../../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

const MIGRATION = read("supabase/migrations/20260923180000_create_article_check_units.sql");
const SQL = MIGRATION.split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");
const ACTIONS = read("src/app/(app)/projects/article-check-actions.ts");
const ROUTE = read("src/app/api/content-article-checks/route.ts");
const SECTION = read("src/components/content/article-check-section.tsx");
const PANEL = read("src/components/content/article-panel.tsx");

describe("migration", () => {
  test("creates only new nexra_article_check objects and alters, drops or replaces nothing", () => {
    const created = [...SQL.matchAll(/create (?:table|function|index) public\.(\w+)|create trigger (\w+)|create index (\w+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
    assert.ok(created.length >= 10);
    assert.ok(created.every((name) => name.startsWith("nexra_article_check")), created.join(", "));
    assert.equal(/\balter\s+(table|function)\s+public\.(?!nexra_article_check_units\b)/i.test(SQL), false);
    assert.equal(/\bdrop\s|\bcreate or replace\b/i.test(SQL), false);
    for (const existing of ["nexra_content_drafts", "nexra_content_draft_versions", "nexra_content_publication_proposals", "nexra_article_versions", "nexra_article_version_sources", "agent_runs", "projects"]) {
      assert.equal(new RegExp(`(grant|revoke|alter|update|insert into|delete from)[^;]*public\\.${existing}\\b`, "i").test(SQL), false, existing);
    }
    assert.equal(/fact_check/.test(SQL), false, "the draft fact-check column is not touched");
  });

  test("the only write to an existing table moves an article from drafting to checked — never to approved", () => {
    const updates = [...SQL.matchAll(/update public\.nexra_articles([\s\S]*?);/g)].map((m) => m[1]);
    assert.equal(updates.length, 1);
    assert.match(updates[0], /set status = 'checked'/);
    assert.match(updates[0], /status = 'drafting' and current_version = p_article_version/);
    assert.equal(/approved|published/i.test(updates[0]), false);
    assert.equal(/'approved'|'published'|published_/.test(SQL), false);
  });

  test("RLS on, no policies; service_role gets SELECT on the table and EXECUTE on the record function only", () => {
    assert.match(SQL, /alter table public\.nexra_article_check_units enable row level security/);
    assert.equal(/create policy/i.test(SQL), false);
    assert.match(SQL, /array\['anon', 'authenticated', 'service_role'\]/);
    const grants = [...SQL.matchAll(/grant ([a-z, ]+) on (table|function) public\.(\w+)/g)].map((m) => `${m[1]} ${m[3]}`);
    assert.deepEqual(grants.sort(), ["execute nexra_article_check_unit_record", "select nexra_article_check_units"]);
  });

  test("every function pins an empty search_path; only the record function is security definer", () => {
    const functions = SQL.split(/create function /).slice(1);
    assert.equal(functions.length, 7);
    for (const fn of functions) assert.match(fn, /set search_path = ''/);
    const definers = functions.filter((fn) => /security definer/.test(fn)).map((fn) => fn.slice(0, fn.indexOf("(")));
    assert.deepEqual(definers, ["public.nexra_article_check_unit_record"]);
  });

  test("parts, part counts and the unit count are columns bound by the 150-unit cap, and the key carries the part", () => {
    assert.match(SQL, /unit_index smallint not null\s+constraint nexra_article_check_units_unit_index_range check \(unit_index between 0 and 149\)/);
    assert.match(SQL, /check \(unit_count between 1 and 150 and unit_index < unit_count and part_count <= unit_count\)/);
    assert.match(SQL, /check \(part >= 1 and part <= part_count and part_count <= 150\)/);
    assert.match(SQL, /:\[1-9\]\[0-9\]\{0,2\}\$'/);
    assert.match(SQL, /right\(unit_key, char_length\(part::text\) \+ 1\) = ':' \|\| part::text/);
    for (const column of ["part", "part_count", "unit_count"]) assert.match(SQL, new RegExp(`new\\.${column} is distinct from old\\.${column}`), `${column} is immutable`);
  });

  test("the article moves to checked only through the completeness rule", () => {
    const record = SQL.slice(SQL.indexOf("create function public.nexra_article_check_unit_record"));
    assert.match(record, /public\.nexra_article_check_version_complete\(p_article_version_id, v_version\.canonical_content, p_unit_count\)\s+then\s+update public\.nexra_articles/);
    const complete = SQL.slice(SQL.indexOf("create function public.nexra_article_check_version_complete"), SQL.indexOf("create function public.nexra_article_check_units_check_insert"));
    for (const rule of ["u.status <> 'passed' or u.unit_count <> p_unit_count", "<> p_unit_count", "s.n = 0 or s.lo <> s.hi or s.n <> s.lo", "row_number() over (order by b.ordinality, u.part) - 1"]) {
      assert.ok(complete.includes(rule), rule);
    }
  });

  test("rows bind one exact version and unit, identity is immutable, and nothing is deleted", () => {
    for (const trigger of ["nexra_article_check_units_check_insert", "nexra_article_check_units_guard_update", "nexra_article_check_units_guard_delete", "nexra_article_check_units_guard_truncate"]) {
      assert.match(SQL, new RegExp(`create trigger ${trigger}\\b`));
    }
    assert.match(SQL, /constraint nexra_article_check_units_index_unique unique \(article_version_id, unit_index\)/);
    assert.match(SQL, /constraint nexra_article_check_units_key_unique unique \(article_version_id, unit_key\)/);
    assert.match(SQL, /status in \('pending', 'passed', 'needs-review', 'failed'\)/);
    assert.equal(/canonical_content text|\btitle text|\bbody text/.test(SQL.slice(SQL.indexOf("create table public.nexra_article_check_units"), SQL.indexOf("comment on table"))), false, "no article text is stored");
  });

  test("the record function re-reads the run and binds it to this exact unit", () => {
    const fn = SQL.slice(SQL.indexOf("create function public.nexra_article_check_unit_record"));
    for (const clause of [
      "agent_id = 'research-evidence'",
      "task_type = 'article-check-unit'",
      "input -> 'articleVersionId'",
      "input -> 'unitIndex'",
      "->> 'unitSha256' = p_unit_sha256",
      "v_evidence -> 'part' = to_jsonb(p_part::integer)",
      "v_evidence -> 'partCount' = to_jsonb(p_part_count::integer)",
      "v_evidence -> 'unitCount' = to_jsonb(p_unit_count::integer)",
      "'count-mismatch'",
      "for update",
    ]) {
      assert.ok(fn.includes(clause), clause);
    }
  });
});

describe("server surface", () => {
  test("the action confirms the operator first and takes no hash, text, status or result from the browser", () => {
    assert.deepEqual([...ACTIONS.matchAll(/export async function (\w+)/g)].map((m) => m[1]), ["recordArticleCheckUnit"]);
    assert.ok(ACTIONS.indexOf("getOperator()") < ACTIONS.indexOf("articleCheckService()"));
    assert.match(ACTIONS, /operatorId: operator\.id/);
    const signature = ACTIONS.slice(ACTIONS.indexOf("export async function recordArticleCheckUnit("), ACTIONS.indexOf("): Promise<"));
    assert.equal(/sha|hash|text|status|result|version_?id/i.test(signature), false, signature);
  });

  test("the route is read-only and operator-only", () => {
    assert.equal(/export async function (POST|PUT|PATCH|DELETE)/.test(ROUTE), false);
    assert.ok(ROUTE.indexOf("getOperator()") < ROUTE.indexOf("articleCheckService()"));
  });
});

describe("panel", () => {
  test("labels the check plainly and mounts it on the article version view", () => {
    assert.ok(SECTION.includes('"Article fact-check only — this does not approve or publish the article."'));
    assert.match(PANEL, /<ArticleCheckSection projectId=\{projectId\} article=\{article\} version=\{viewing\.version\}/);
  });

  test("offers no approval, proposal, publish, merge, deploy or delete control", () => {
    for (const source of [SECTION, PANEL]) {
      for (const forbidden of [/approveDraftVersion|approveArticle/, /preparePublicationProposal|PublicationProposalSection/, />\s*(Approve|Publish|Create PR|Merge|Deploy|Delete)\b/]) {
        assert.equal(forbidden.test(source), false, String(forbidden));
      }
    }
    assert.equal(/recordDraftFactCheck|DRAFT_FACT_CHECK|factCheckRequest/.test(SECTION), false, "the draft fact-check is not reused or shown as the article's");
  });

  test("queues through the shared control and records through the one action, one explicit click each", () => {
    assert.match(SECTION, /useQueuedReview\(request, `\$\{checks\.articleId\}:\$\{checks\.version\}:\$\{unit\.index\}`, ARTICLE_CHECK_UNIT, projectId\)/);
    assert.match(SECTION, /recordArticleCheckUnit\(projectId, checks\.articleId, checks\.version, unit\.index, run\.id\)/);
    assert.equal(/useEffect\([^)]*recordArticleCheckUnit/.test(SECTION), false, "nothing records on its own");
  });
});
