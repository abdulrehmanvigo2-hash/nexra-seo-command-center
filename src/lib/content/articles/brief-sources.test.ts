import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { validateSourceReferences } from "./provenance.ts";
import { createArticleService } from "./service.ts";
import { completeArticle } from "./test-support/fixtures.ts";
import { memoryArticleStore, memoryRuns, OPERATOR, PLAN_RUN, PROJECT, planRun, RUNS, SOURCE_1 } from "./test-support/memory-store.ts";

/**
 * OC1 (migration 20261030120000, owner option A): an article planned by an opportunity brief may be created and saved
 * with no source draft — its provenance is the brief and the Writer's part runs. Every other article names at least one.
 */

const BRIEF = "10000000-0000-4000-8000-000000000201";
function setup() {
  const runs = [...RUNS, planRun({ id: BRIEF, taskType: "opportunity-brief", resultSummary: "ANGLE: …" })];
  return createArticleService({ store: memoryArticleStore({ runs }), runs: memoryRuns(runs) });
}

describe("source drafts for a brief-planned article", () => {
  test("the validator: none is required unless allowed", () => {
    assert.deepEqual(validateSourceReferences([]), { ok: false, issues: [{ path: "sources", code: "required" }] });
    assert.deepEqual(validateSourceReferences([], { allowEmpty: true }), { ok: true, references: [] });
    assert.equal(validateSourceReferences(Array.from({ length: 21 }, () => SOURCE_1), { allowEmpty: true }).ok, false);
  });

  test("create: a brief plan with no source draft is created; a content plan still needs one", async () => {
    const service = setup();
    const brief = await service.create({ projectId: PROJECT, planRunId: BRIEF, content: completeArticle(), sources: [], operatorId: OPERATOR });
    assert.ok(brief.ok && brief.created);
    const plan = await service.create({ projectId: PROJECT, planRunId: PLAN_RUN, content: completeArticle(), sources: [], operatorId: OPERATOR });
    assert.equal(plan.ok, false);
    assert.ok(!plan.ok && plan.reason === "invalid-sources");
  });

  test("save: the brief-planned article saves with none; the content-plan article cannot drop its drafts", async () => {
    const service = setup();
    const brief = await service.create({ projectId: PROJECT, planRunId: BRIEF, content: completeArticle(), sources: [], operatorId: OPERATOR });
    const plan = await service.create({ projectId: PROJECT, planRunId: PLAN_RUN, content: completeArticle(), sources: [SOURCE_1], operatorId: OPERATOR });
    assert.ok(brief.ok && plan.ok);
    const edited = { ...completeArticle(), ctaBody: "Ask us about setting this up." };
    const a = await service.saveVersion({ projectId: PROJECT, articleId: brief.history.article.id, expectedVersion: 1, content: edited, sources: [], operatorId: OPERATOR });
    assert.ok(a.ok);
    const p = await service.saveVersion({ projectId: PROJECT, articleId: plan.history.article.id, expectedVersion: 1, content: edited, sources: [], operatorId: OPERATOR });
    assert.ok(!p.ok && p.reason === "invalid-sources");
  });

  test("the editor allows none only for a brief plan (create) or an article already without one (edit)", () => {
    const panel = readFileSync(new URL("../../../components/content/article-panel.tsx", import.meta.url), "utf8");
    assert.match(panel, /workspace\.planCandidates\.some\(\(c\) => c\.runId === planRunId && c\.kind === "brief"\)/);
    assert.match(panel, /if \(sources\.length === 0 && !briefPlanned\)/);
  });
});

describe("migration 20261030120000", () => {
  const root = new URL("../../../../supabase/migrations/", import.meta.url);
  const read = (name: string) => readFileSync(new URL(name, root), "utf8");
  const body = (sql: string, head: string) => {
    const start = sql.indexOf(head);
    assert.ok(start >= 0, head);
    return sql.slice(start, sql.indexOf("$$;", start) + 3);
  };
  const after = read("20261030120000_brief_articles_without_draft_sources.sql");
  const BRIEF_RULE = (planRef: string) => `
  -- ${planRef === "p_source_plan_run_id" ? "OC1: only an article planned by an opportunity brief may have no source draft (its provenance is the brief run and\n  -- the Writer's part runs); every other article still names at least one." : "OC1: a version may name no source draft only when its article was planned by an opportunity brief."}
  if jsonb_array_length(p_sources) = 0 and not exists (
    select 1 from public.agent_runs where id = ${planRef} and task_type = 'opportunity-brief'
  ) then
    return jsonb_build_object('outcome', 'source-invalid', 'index', null, 'reason', 'count');
  end if;
`;
  const SOURCES_CHECK = "  v_source_refusal := public.nexra_article_check_sources(p_project_id, p_sources);\n  if v_source_refusal is not null then\n    return v_source_refusal;\n  end if;\n";

  test("check_sources: 20260923120000's body except the count, now 0 to 20", () => {
    const before = body(read("20260923120000_create_articles.sql"), "create function public.nexra_article_check_sources(");
    assert.equal(body(after, "create or replace function public.nexra_article_check_sources("), before.replace("create function", "create or replace function").replace("not between 1 and 20", "not between 0 and 20"));
  });

  test("create: 20261028120000's body plus the brief rule after the sources check", () => {
    const before = body(read("20261028120000_article_plan_from_brief.sql"), "create or replace function public.nexra_article_create(");
    assert.equal(body(after, "create or replace function public.nexra_article_create("), before.replace(SOURCES_CHECK, SOURCES_CHECK + BRIEF_RULE("p_source_plan_run_id")));
  });

  test("save_version: 20260923120000's body plus the same rule on the article's plan run", () => {
    const before = body(read("20260923120000_create_articles.sql"), "create function public.nexra_article_save_version(");
    assert.equal(body(after, "create or replace function public.nexra_article_save_version("), before.replace("create function", "create or replace function").replace(SOURCES_CHECK, SOURCES_CHECK + BRIEF_RULE("v_article.source_plan_run_id")));
  });

  test("no table, trigger, grant or owner change", () => {
    const code = after.replace(/--[^\n]*/g, "").replace(/'(?:[^']|'')*'/g, "''");
    assert.doesNotMatch(code, /\b(alter|drop|grant|revoke|create table|create trigger)\b/i);
  });
});
