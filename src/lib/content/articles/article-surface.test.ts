import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { contentFromForm, emptyForm, formFromContent, issueMessage, issuePathLabel, lines } from "./editor-form.ts";
import { completeArticle } from "./test-support/fixtures.ts";
import { validateArticleContent } from "./validate.ts";

/**
 * The C2 surfaces that are not the service: the editor form's translation,
 * the migration's shape, and the article panel's controls. The migration's
 * behaviour was run against PostgreSQL 16; these checks keep its promises
 * from drifting in the file itself.
 */

const MIGRATION = readFileSync(new URL("../../../../supabase/migrations/20260923120000_create_articles.sql", import.meta.url), "utf8");
const PANEL = readFileSync(new URL("../../../components/content/article-panel.tsx", import.meta.url), "utf8");
const ACTIONS = readFileSync(new URL("../../../app/(app)/projects/article-actions.ts", import.meta.url), "utf8");
const ROUTE = readFileSync(new URL("../../../app/api/content-articles/route.ts", import.meta.url), "utf8");
const WORKSPACE = readFileSync(new URL("../../../components/projects/project-unmeasured.tsx", import.meta.url), "utf8");

/** The SQL without comments, so prose cannot satisfy or break a check. */
const SQL = MIGRATION.split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

describe("editor form", () => {
  test("round-trips validated content exactly", () => {
    const validated = validateArticleContent(completeArticle());
    assert.ok(validated.ok);
    const again = validateArticleContent(contentFromForm(formFromContent(validated.article)));
    assert.ok(again.ok);
    assert.deepEqual(again.article, validated.article);
  });

  test("one paragraph per line; only empty lines are skipped, nothing is trimmed", () => {
    assert.deepEqual(lines("One.\n\nTwo.\n"), ["One.", "Two."]);
    assert.deepEqual(lines(" padded "), [" padded "]);
    const form = { ...emptyForm(), introduction: " spaced " };
    const check = validateArticleContent(contentFromForm(form));
    assert.ok(!check.ok && check.issues.some((i) => i.path === "introduction[0]" && i.code === "surrounding-whitespace"));
  });

  test("the search intent and topic decision are never chosen for the operator", () => {
    const check = validateArticleContent(contentFromForm(emptyForm()));
    assert.ok(!check.ok);
    assert.ok(check.issues.some((i) => i.path === "searchIntent" && i.code === "required"));
    assert.ok(check.issues.some((i) => i.path === "topicDecision" && i.code === "required"));
  });

  test("issues read as sentences with 1-based positions", () => {
    assert.equal(issuePathLabel("sections[1].subsections[0].heading"), "Sections 2 › subsections 1 › heading");
    assert.equal(issueMessage({ path: "slug", code: "format" }), "Slug is not in the required format.");
  });
});

describe("migration", () => {
  test("creates only new nexra_ objects and alters nothing that exists", () => {
    const created = [...SQL.matchAll(/create (?:table|function|trigger|index|unique index) public\.(\w+)|create trigger (\w+)|create index (\w+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
    assert.ok(created.length > 10);
    assert.ok(created.every((name) => name.startsWith("nexra_article")), created.join(", "));
    assert.equal(/\balter\s+(table|function)\s+public\.(?!nexra_article)/i.test(SQL), false, "no existing table or function is altered");
    assert.equal(/\bdrop\s/i.test(SQL), false);
    assert.equal(/\bcreate or replace\b/i.test(SQL), false);
    for (const existing of ["nexra_content_drafts", "nexra_content_draft_versions", "nexra_content_publication_proposals", "agent_runs", "projects"]) {
      assert.equal(new RegExp(`(grant|revoke|alter|update|insert into|delete from)[^;]*public\\.${existing}\\b`, "i").test(SQL), false, existing);
    }
  });

  test("every function pins an empty search_path; only the two write functions are security definer", () => {
    const functions = SQL.split(/create function /).slice(1);
    assert.equal(functions.length, 10);
    for (const fn of functions) assert.match(fn, /set search_path = ''/);
    const definers = functions.filter((fn) => /security definer/.test(fn)).map((fn) => fn.slice(0, fn.indexOf("(")));
    assert.deepEqual(definers, ["public.nexra_article_create", "public.nexra_article_save_version"]);
  });

  test("row level security on, client roles revoked, service_role gets SELECT and the two functions only", () => {
    for (const table of ["nexra_articles", "nexra_article_versions", "nexra_article_version_sources"]) {
      assert.match(SQL, new RegExp(`alter table public\\.${table} enable row level security`));
    }
    assert.match(SQL, /array\['anon', 'authenticated', 'service_role'\]/);
    const grants = [...SQL.matchAll(/grant ([a-z, ]+) on (table|function) public\.(\w+)/g)].map((m) => `${m[1]} ${m[3]}`);
    assert.deepEqual(grants.sort(), [
      "execute nexra_article_create",
      "execute nexra_article_save_version",
      "select nexra_article_version_sources",
      "select nexra_article_versions",
      "select nexra_articles",
    ]);
    assert.equal(/create policy/i.test(SQL), false);
  });

  test("versions and sources are immutable; hash and format are enforced by the database", () => {
    for (const trigger of [
      "nexra_article_versions_guard_update",
      "nexra_article_versions_guard_delete",
      "nexra_article_versions_guard_truncate",
      "nexra_article_version_sources_guard_update",
      "nexra_article_version_sources_guard_delete",
      "nexra_article_version_sources_guard_truncate",
      "nexra_articles_guard_update",
      "nexra_articles_guard_delete",
      "nexra_articles_guard_truncate",
    ]) {
      assert.match(SQL, new RegExp(`create trigger ${trigger}\\b`));
    }
    assert.match(SQL, /content_sha256 = encode\(sha256\(convert_to\(canonical_content, 'UTF8'\)\), 'hex'\)/);
    assert.match(SQL, /starts_with\(canonical_content, '\{"format":"nexra-article-content\/1",'\)/);
    assert.equal(/'published'|published_/i.test(SQL), false, "no published state or column");
  });

  test("an edit returns the status to drafting and never touches the approval columns", () => {
    const save = SQL.slice(SQL.indexOf("create function public.nexra_article_save_version"));
    const update = save.slice(save.indexOf("update public.nexra_articles"), save.indexOf("returning * into v_article;", save.indexOf("update public.nexra_articles")));
    assert.match(update, /status = 'drafting'/);
    assert.equal(/approved_/.test(update), false);
  });
});

describe("article panel and server surface", () => {
  test("says plainly that nothing is checked, approved or published", () => {
    assert.ok(PANEL.includes('"Article persistence only — no fact-check, approval or publication occurs here."'));
  });

  test("offers no fact-check, approval, proposal or publish control", () => {
    for (const forbidden of [/approveDraftVersion|approveArticle/, /recordDraftFactCheck|factCheckRequest|DRAFT_FACT_CHECK/, /preparePublicationProposal|PublicationProposalSection/, />\s*(Approve|Publish|Fact-check|Create PR|Merge|Deploy|Delete)\b/]) {
      assert.equal(forbidden.test(PANEL), false, String(forbidden));
    }
    const actions = [...ACTIONS.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    assert.deepEqual(actions, ["createArticle", "saveArticleVersion"]);
    assert.equal(/export async function (POST|PUT|PATCH|DELETE)/.test(ROUTE), false, "the route is read-only");
  });

  test("actions confirm the operator before anything else and never take a hash or actor from the browser", () => {
    for (const name of ["createArticle", "saveArticleVersion"]) {
      const body = ACTIONS.slice(ACTIONS.indexOf(`export async function ${name}`));
      assert.ok(body.indexOf("getOperator()") < body.indexOf("articleService()"), name);
      assert.match(body, /operatorId: operator\.id/);
    }
    assert.equal(/contentSha256|createdBy/.test(ACTIONS), false);
  });

  test("the panel is mounted on the project workspace beside the content plan", () => {
    assert.match(WORKSPACE, /<ArticlePanel projectId=\{project\.id\} \/>/);
  });
});
