import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { briefPlanChoice } from "@/lib/briefs/handoff";
import { createArticleService, PLAN_TASK_TYPES } from "./service.ts";
import { completeArticle } from "./test-support/fixtures.ts";
import { memoryArticleStore, memoryRuns, OPERATOR, OTHER_PROJECT, PLAN_RUN, PROJECT, planRun, RUNS, SOURCE_1 } from "./test-support/memory-store.ts";

/**
 * Part 2b (migration 20261028120000): a completed opportunity brief of the project is an article's plan, as a content
 * plan review is; one article per plan run. "Open in editor" pre-selects the brief it was opened from.
 */

const root = new URL("../../../../", import.meta.url);
const BRIEF = "10000000-0000-4000-8000-000000000101";
const brief = (over = {}) => planRun({ id: BRIEF, taskType: "opportunity-brief", resultSummary: "ANGLE: …", ...over });

function setup(extra: Parameters<typeof planRun>[0][]) {
  const runs = [...RUNS, ...extra.map((over) => brief(over))];
  const store = memoryArticleStore({ runs });
  return createArticleService({ store, runs: memoryRuns(runs) });
}
const create = (service: ReturnType<typeof setup>, planRunId: string) => service.create({ projectId: PROJECT, planRunId, content: completeArticle(), sources: [SOURCE_1], operatorId: OPERATOR });

describe("an opportunity brief as an article's plan", () => {
  test("the plan task types: a content plan review or an opportunity brief", () => {
    assert.deepEqual(PLAN_TASK_TYPES, { "content-plan-review": "content-plan", "opportunity-brief": "brief" });
  });

  test("a completed brief of the project is a plan; a second create on it answers the existing article", async () => {
    const service = setup([{}]);
    const first = await create(service, BRIEF);
    assert.ok(first.ok && first.created);
    assert.equal(first.history.article.sourcePlanRunId, BRIEF);
    const again = await create(service, BRIEF);
    assert.ok(again.ok && !again.created, "one article per plan run");
    assert.ok((await create(service, PLAN_RUN)).ok, "a content plan run is still a plan");
  });

  test("a brief that is not completed, another project's, or not the Content Strategist's is refused", async () => {
    for (const over of [{ status: "queued" as const, finishedAt: null, resultSummary: null }, { projectId: OTHER_PROJECT }, { agentId: "writer" as const }]) {
      const result = await create(setup([over]), BRIEF);
      assert.deepEqual(result, { ok: false, reason: "plan-run-invalid" }, JSON.stringify(over));
    }
  });

  test("the workspace offers the brief as a plan candidate, labelled as one, until it has an article", async () => {
    const service = setup([{}]);
    const before = await service.getWorkspace(PROJECT);
    assert.ok(before.ok);
    assert.deepEqual(before.workspace.planCandidates.find((c) => c.runId === BRIEF)?.kind, "brief");
    assert.equal(before.workspace.planCandidates.find((c) => c.runId === PLAN_RUN)?.kind, "content-plan");
    await create(service, BRIEF);
    const after = await service.getWorkspace(PROJECT);
    assert.ok(after.ok && !after.workspace.planCandidates.some((c) => c.runId === BRIEF));
  });

  test("Open in editor pre-selects the brief it was opened from, only when it is a candidate", () => {
    const candidates = [{ runId: PLAN_RUN, kind: "content-plan" }, { runId: BRIEF, kind: "brief" }];
    assert.equal(briefPlanChoice(BRIEF.toUpperCase(), candidates), BRIEF);
    assert.equal(briefPlanChoice(BRIEF, [{ runId: PLAN_RUN, kind: "content-plan" }]), "", "the brief already has an article, or is not a plan");
    assert.equal(briefPlanChoice(PLAN_RUN, candidates), "", "only a brief is pre-selected");
    assert.equal(briefPlanChoice(null, candidates), "");
    const panel = readFileSync(new URL("src/components/content/article-panel.tsx", root), "utf8");
    assert.match(panel, /useState\(\(\) => briefPlanChoice\(fromBrief, workspace\.planCandidates\)\)/);
  });
});

describe("migration 20261028120000", () => {
  const read = (name: string) => readFileSync(new URL(`supabase/migrations/${name}`, root), "utf8");
  const fn = (text: string, head: string) => text.slice(text.indexOf(head), text.indexOf("$$;", text.indexOf(head)) + 3);

  test("the create function is 20260923120000's word for word except the plan check", () => {
    const before = fn(read("20260923120000_create_articles.sql"), "create function public.nexra_article_create(");
    const after = fn(read("20261028120000_article_plan_from_brief.sql"), "create or replace function public.nexra_article_create(");
    assert.equal(
      after,
      before
        .replace("create function public.nexra_article_create(", "create or replace function public.nexra_article_create(")
        .replace("and task_type = 'content-plan-review'", "and task_type in ('content-plan-review', 'opportunity-brief')"),
    );
  });

  test("it changes no table, trigger or grant", () => {
    const text = read("20261028120000_article_plan_from_brief.sql").replace(/^--.*$/gm, "");
    assert.doesNotMatch(text, /\b(create table|alter table|create trigger|grant|revoke|drop)\b/i);
  });
});
