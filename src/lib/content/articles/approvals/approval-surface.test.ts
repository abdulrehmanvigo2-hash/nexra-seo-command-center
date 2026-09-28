import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * Stage 5, milestone C5: the surfaces around the approval service — the
 * migration's shape, the Server Action, the read route and the panel
 * section. The migration's behaviour, grants and concurrency were run
 * against PostgreSQL 16; these checks keep its promises from drifting in
 * the file itself.
 */

const root = new URL("../../../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

const MIGRATION = read("supabase/migrations/20260924120000_create_article_approvals.sql");
const ACTIONS = read("src/app/(app)/projects/article-approval-actions.ts");
const ROUTE = read("src/app/api/content-article-approvals/route.ts");
const SECTION = read("src/components/content/article-approval-section.tsx");
const PANEL = read("src/components/content/article-panel.tsx");
const CHECK_SECTION = read("src/components/content/article-check-section.tsx");

/** The SQL without comments, so prose cannot satisfy or break a check. */
const SQL = MIGRATION.split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

const FUNCTION = SQL.slice(SQL.indexOf("create function public.nexra_article_approve_version"), SQL.indexOf("comment on function public.nexra_article_approve_version"));

describe("the migration", () => {
  test("one new append-only table binding the exact version, its hashes and unit set; one per version", () => {
    assert.match(SQL, /create table public\.nexra_article_approvals/);
    for (const column of ["article_id uuid not null", "article_version smallint not null", "article_version_id uuid not null", "content_sha256 text not null", "unit_count smallint not null", "units_sha256 text not null", "approved_by uuid not null", "approved_at timestamptz not null"]) {
      assert.ok(SQL.includes(column), column);
    }
    assert.match(SQL, /foreign key \(article_id, article_version\) references public\.nexra_article_versions \(article_id, version\)/);
    assert.match(SQL, /unique \(article_id, article_version\)/);
    for (const trigger of ["check_insert", "guard_update", "guard_delete", "guard_truncate"]) assert.match(SQL, new RegExp(`create trigger nexra_article_approvals_${trigger}\\b`));
  });

  test("changes no earlier object except one constraint on nexra_articles: approved names the current version", () => {
    assert.equal(/\bdrop\s|\bcreate or replace\b/i.test(SQL), false);
    const alters = [...SQL.matchAll(/alter table public\.(\w+)/g)].map((m) => m[1]);
    assert.deepEqual(alters, ["nexra_articles", "nexra_article_approvals"]);
    assert.match(SQL, /add constraint nexra_articles_approved_is_current\s+check \(status <> 'approved' or \(approved_version is not null and approved_version = current_version\)\)/);
    assert.equal(/'published'|published_/.test(SQL), false, "no published state or column");
  });

  test("the gate locks the parent, re-checks everything, and writes the row and pointer together", () => {
    assert.match(FUNCTION, /security definer\s+set search_path = ''/);
    assert.match(FUNCTION, /where id = p_article_id and project_id = p_project_id\s+for update/);
    const order = [
      "'not-found'",
      "'archived'",
      "'stale'",
      "'version-not-found'",
      "'version-mismatch'",
      "'content-mismatch'",
      "'exists'",
      "'status-unexpected'",
      "'units-mismatch'",
      "'units-not-passed'",
      "'units-incomplete'",
      "'topic-decision'",
      "'unresolved-placeholder'",
      "insert into public.nexra_article_approvals",
      "set status = 'approved'",
    ];
    const positions = order.map((token) => FUNCTION.indexOf(token));
    assert.ok(positions.every((p) => p > 0), JSON.stringify(order.filter((_, i) => positions[i] <= 0)));
    assert.deepEqual([...positions].sort((a, b) => a - b), positions, "refusals come in the documented order, the writes last");
    assert.match(FUNCTION, /nexra_article_check_version_complete\(p_article_version_id, v_version\.canonical_content, v_unit_count\)/);
    assert.match(FUNCTION, /v_topic not in \('update-existing', 'different-angle'\)/);
    assert.match(FUNCTION, /strpos\(lower\(v_version\.canonical_content\), '\[needs evidence'\) > 0/);
    assert.match(FUNCTION, /'nexra-article-approval-units\/1' \|\| chr\(10\)/);
  });

  test("RLS on, no policies; service_role gets SELECT on the table and EXECUTE on the gate only", () => {
    assert.match(SQL, /alter table public\.nexra_article_approvals enable row level security/);
    assert.equal(/create policy/i.test(SQL), false);
    const grants = [...SQL.matchAll(/grant (\w+) on (table|function) public\.(\w+)/g)].map((m) => `${m[1]} ${m[3]}`);
    assert.deepEqual(grants, ["select nexra_article_approvals", "execute nexra_article_approve_version"]);
    const definers = [...SQL.matchAll(/create function public\.(\w+)\([^)]*\)[\s\S]*?\$\$;/g)].filter((m) => /security definer/.test(m[0])).map((m) => m[1]);
    assert.deepEqual(definers, ["nexra_article_approve_version"]);
  });
});

describe("the action and the route", () => {
  test("the action confirms the operator first and takes no hash, version row, unit, status or operator from the browser", () => {
    const body = ACTIONS.slice(ACTIONS.indexOf("export async function approveArticleVersion"));
    assert.ok(body.indexOf("getOperator()") < body.indexOf("articleApprovalService()"));
    const signature = body.slice(0, body.indexOf(")"));
    assert.equal(/sha|hash|unit|status|version_?id|operator|approvedBy/i.test(signature), false, signature);
    assert.match(body, /operatorId: operator\.id/);
    assert.deepEqual([...ACTIONS.matchAll(/export async function (\w+)/g)].map((m) => m[1]), ["approveArticleVersion"]);
  });

  test("the route is read-only and operator-only", () => {
    assert.equal(/export async function (POST|PUT|PATCH|DELETE)/.test(ROUTE), false);
    assert.ok(ROUTE.indexOf("getOperator()") < ROUTE.indexOf("articleApprovalService()"));
  });
});

describe("the panel section", () => {
  test("labels the action plainly and is mounted in the article panel", () => {
    assert.ok(SECTION.includes('"Approval only — nothing is published."'));
    assert.match(PANEL, /<ArticleApprovalSection\b/);
  });

  test("the Approve control renders only when eligible, behind an explicit confirmation", () => {
    assert.match(SECTION, /\{eligible && \(/);
    assert.match(SECTION, /setConfirming\(true\)/);
    assert.match(SECTION, /Confirm approval of version/);
    const approveCall = SECTION.indexOf("approveArticleVersion(projectId");
    assert.ok(approveCall > SECTION.indexOf("async function approve()"));
    // 6.8b: and, for a version with attested paragraphs, only with the operator's tick.
    assert.match(SECTION.slice(SECTION.indexOf("async function approve()"), approveCall), /!eligible \|\| \(needsTick && !attestationTicked\)\) return;/);
  });

  test("shows every blocking reason and the immutable history", () => {
    assert.match(SECTION, /state\.eligibility\.blocks\.map/);
    assert.match(SECTION, /approvalBlockMessage\(block\)/);
    assert.match(SECTION, /Approval history/);
  });

  test("offers no publish, proposal, pull request, merge, deploy or delete control, and no override", () => {
    for (const source of [SECTION, PANEL]) {
      for (const forbidden of [/>\s*(Publish|Create PR|Merge|Deploy|Delete)\b/, /preparePublicationProposal|PublicationProposalSection/, /override/i]) {
        assert.equal(forbidden.test(source), false, String(forbidden));
      }
    }
    assert.equal(/approveArticleVersion|ArticleApprovalSection/.test(CHECK_SECTION), false, "the fact-check section stays a fact-check only");
  });
});
