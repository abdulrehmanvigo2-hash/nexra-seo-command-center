import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { AGENT_REGISTRY } from "../mock/agents/registry.ts";
import { DAILY_CAP_MESSAGE } from "./daily-caps.ts";
import {
  DRAFT_NOTE,
  EMPTY_SELECTION,
  needsReviewUnits,
  QUEUED_NOTE,
  queueableTasks,
  queueFailure,
  queueRequest,
  queueUrls,
  RANGE_CHOICES,
  reviewableCrawls,
  type QueueableTask,
} from "./queue-control.ts";
import { TASK_TYPES } from "./task-types.ts";
import type { AgentId } from "../../types/agent.ts";
import type { ArticleCheckUnitView, ArticleVersionChecks } from "../../types/content-article-check.ts";
import type { Crawl } from "../../types/crawl.ts";

/**
 * Checkpoint 6.6b: "Queue a review" on each agent page. The control lists
 * exactly the agent's grounded task types from the registry, offers the one
 * record chooser each evidence kind needs, preselects nothing, and queues
 * through the existing POST /api/agent-runs only — never an execution.
 */

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const find = (agent: AgentId, taskType: string) => queueableTasks(agent).find((t) => t.taskType === taskType) as QueueableTask;

test("each agent's control lists exactly its grounded task types, in registry order", () => {
  for (const agent of AGENT_REGISTRY) {
    const expected = TASK_TYPES.filter((t) => t.evidence !== "none" && t.agents !== "any" && t.agents.includes(agent.id)).map((t) => t.id);
    assert.deepEqual(queueableTasks(agent.id).map((t) => t.taskType), expected, agent.id);
    assert.ok(expected.length >= 2, `${agent.id} has at least two grounded tasks`);
  }
  // project-review (any agent) and keyword-research (no evidence) are not grounded, so never listed.
  assert.deepEqual(queueableTasks("keyword-intent").map((t) => t.taskType), ["search-query-review", "keyword-opportunity-review"]);
  assert.deepEqual(queueableTasks("authority-backlink").map((t) => t.taskType), ["outbound-link-review", "internal-link-review"]);
  assert.deepEqual(queueableTasks("writer").map((t) => t.taskType), ["section-draft", "article-revision-draft", "article-part-draft"]);
  for (const t of queueableTasks("technical-seo")) assert.equal(t.description, TASK_TYPES.find((d) => d.id === t.taskType)?.description);
});

test("one chooser per evidence kind; the nine 6.5/6.6 tasks each get a chooser on the page", () => {
  const chooser = (agent: AgentId, taskType: string) => find(agent, taskType).chooser;
  assert.equal(chooser("technical-seo", "finding-history-review"), "crawl");
  assert.equal(chooser("content-strategist", "content-refresh-review"), "crawl");
  assert.equal(chooser("on-page-seo", "page-query-alignment-review"), "crawl");
  assert.equal(chooser("ai-visibility", "schema-entity-review"), "crawl");
  assert.equal(chooser("authority-backlink", "internal-link-review"), "crawl");
  assert.equal(chooser("keyword-intent", "keyword-opportunity-review"), "range");
  assert.equal(chooser("analytics-learning", "learning-review"), "range");
  assert.equal(chooser("market-intelligence", "competitor-page-gap-review"), "competitor");
  assert.equal(chooser("writer", "article-revision-draft"), "needs-review-unit");
  assert.equal(chooser("project-manager", "intake-review"), "none");
  assert.equal(chooser("seo-director", "project-priority-review"), "none");
  assert.equal(chooser("research-evidence", "evidence-pack-review"), "none");
  // Tasks whose record is chosen by its own control on the project screen say where, and cannot be queued here.
  for (const [agent, taskType] of [["seo-director", "priority-review"], ["writer", "section-draft"], ["research-evidence", "draft-fact-check"], ["research-evidence", "article-check-unit"]] as const) {
    const t = find(agent, taskType);
    assert.equal(t.chooser, "elsewhere", taskType);
    assert.match(t.elsewhere ?? "", /project screen/, taskType);
    assert.equal(queueRequest("nexra-agency", agent, t, EMPTY_SELECTION).ok, false, taskType);
  }
  // M4: an extraction names a fetched source, chosen on the Evidence tab.
  const extract = find("research-evidence", "evidence-extract");
  assert.equal(extract.chooser, "elsewhere");
  assert.match(extract.elsewhere ?? "", /Evidence tab/);
  assert.equal(queueRequest("nexra-agency", "research-evidence", extract, EMPTY_SELECTION).ok, false);
  // M6: a part draft names a completed brief, queued from the Evidence tab.
  const part = find("writer", "article-part-draft");
  assert.equal(part.chooser, "elsewhere");
  assert.match(part.elsewhere ?? "", /Evidence tab/);
  // M5: a brief names an accepted opportunity, chosen on the Evidence tab.
  const brief = find("content-strategist", "opportunity-brief");
  assert.equal(brief.chooser, "elsewhere");
  assert.match(brief.elsewhere ?? "", /Evidence tab/);
  assert.equal(queueRequest("nexra-agency", "content-strategist", brief, EMPTY_SELECTION).ok, false);
  assert.deepEqual(RANGE_CHOICES.map((r) => r.id), ["7d", "30d", "3m", "6m", "12m"]);
});

const crawl = (over: Partial<Crawl> = {}) => ({ id: "75d1bfbe-0000-4000-8000-000000000001", projectId: "nexra-agency", status: "partial", startedAt: "2026-09-27T09:00:00Z", pagesFetched: 5, pagesDiscovered: 7, ...over }) as Crawl;

test("nothing is preselected: no task, no record, and Queue stays disabled until the request is valid", () => {
  assert.deepEqual(EMPTY_SELECTION, { crawl: null, range: null, competitor: null, unit: null });
  assert.deepEqual(queueRequest("nexra-agency", "technical-seo", null, EMPTY_SELECTION), { ok: false, why: "Choose a task." });
  assert.deepEqual(queueRequest(null, "technical-seo", find("technical-seo", "crawl-review"), EMPTY_SELECTION), { ok: false, why: "Choose a project." });
  assert.deepEqual(queueRequest("nexra-agency", "technical-seo", find("technical-seo", "finding-history-review"), EMPTY_SELECTION), { ok: false, why: "Choose a crawl." });
  assert.deepEqual(queueRequest("nexra-agency", "analytics-learning", find("analytics-learning", "learning-review"), EMPTY_SELECTION), { ok: false, why: "Choose a Search Console window." });
  assert.deepEqual(queueRequest("nexra-agency", "market-intelligence", find("market-intelligence", "competitor-page-gap-review"), EMPTY_SELECTION), { ok: false, why: "Choose a recorded competitor." });
  assert.equal(queueRequest("nexra-agency", "writer", find("writer", "article-revision-draft"), EMPTY_SELECTION).ok, false);
  const screen = read("components/agents/queue-review-control.tsx");
  assert.match(screen, /useState\(""\)/, "the task starts empty");
  assert.match(screen, /useState<QueueSelection>\(EMPTY_SELECTION\)/);
  assert.match(screen, /disabled=\{!request\.ok \|\| phase\.status === "queuing"\}/);
  for (const label of ["Choose a task…", "Choose a crawl…", "Choose a window…", "Choose a competitor…", "Choose an article…", "Choose a unit…"]) assert.ok(screen.includes(label), label);
});

test("the request body is the existing create route's: project, agent, task and the chosen record only", () => {
  assert.deepEqual(queueRequest("nexra-agency", "technical-seo", find("technical-seo", "finding-history-review"), { ...EMPTY_SELECTION, crawl: crawl() }), {
    ok: true,
    body: { projectId: "nexra-agency", agentId: "technical-seo", taskType: "finding-history-review", input: { crawlId: "75d1bfbe-0000-4000-8000-000000000001" } },
  });
  assert.deepEqual(queueRequest("nexra-agency", "keyword-intent", find("keyword-intent", "keyword-opportunity-review"), { ...EMPTY_SELECTION, range: "30d" }), {
    ok: true,
    body: { projectId: "nexra-agency", agentId: "keyword-intent", taskType: "keyword-opportunity-review", input: { range: "30d" } },
  });
  assert.deepEqual(queueRequest("nexra-agency", "market-intelligence", find("market-intelligence", "competitor-page-gap-review"), { ...EMPTY_SELECTION, competitor: "2vautomation.ai" }), {
    ok: true,
    body: { projectId: "nexra-agency", agentId: "market-intelligence", taskType: "competitor-page-gap-review", input: { competitorDomain: "2vautomation.ai" } },
  });
  assert.deepEqual(queueRequest("nexra-agency", "project-manager", find("project-manager", "intake-review"), EMPTY_SELECTION), {
    ok: true,
    body: { projectId: "nexra-agency", agentId: "project-manager", taskType: "intake-review", input: {} },
  });
  // A crawl of another project, or one still running, is refused before the request.
  assert.equal(queueRequest("nexra-agency", "technical-seo", find("technical-seo", "crawl-review"), { ...EMPTY_SELECTION, crawl: crawl({ projectId: "other" }) }).ok, false);
  assert.equal(queueRequest("nexra-agency", "technical-seo", find("technical-seo", "crawl-review"), { ...EMPTY_SELECTION, crawl: crawl({ status: "running" }) }).ok, false);
  assert.deepEqual(reviewableCrawls([crawl(), crawl({ id: "b", status: "running" }), crawl({ id: "c", status: "failed" }), crawl({ id: "d", status: "completed" })]).map((c) => c.id), ["75d1bfbe-0000-4000-8000-000000000001", "d"]);
  assert.equal(queueRequest("nexra-agency", "analytics-learning", find("analytics-learning", "learning-review"), { ...EMPTY_SELECTION, range: "forever" }).ok, false);
});

test("the revision draft: only a unit whose recorded check needs review, named by the check's four inputs", () => {
  const unit = (index: number, status: string | null) => ({ index, label: `Unit ${index}`, record: status === null ? null : { status } }) as unknown as ArticleCheckUnitView;
  const checks = { version: 2, versionId: "b0000000-0000-4000-8000-000000000002", units: [unit(0, "needs-review"), unit(1, null), unit(2, "passed"), unit(3, "needs-review")] } as unknown as ArticleVersionChecks;
  assert.deepEqual(needsReviewUnits(checks).map((u) => u.index), [0, 3]);
  const task = find("writer", "article-revision-draft");
  assert.deepEqual(
    queueRequest("nexra-agency", "writer", task, { ...EMPTY_SELECTION, unit: { articleId: "c89182f9-4954-4834-8446-a831fc3c42d0", articleVersion: 2, articleVersionId: checks.versionId, unit: checks.units[3] } }),
    {
      ok: true,
      body: {
        projectId: "nexra-agency",
        agentId: "writer",
        taskType: "article-revision-draft",
        input: { articleId: "c89182f9-4954-4834-8446-a831fc3c42d0", articleVersion: 2, articleVersionId: checks.versionId, unitIndex: 3 },
      },
    },
  );
  assert.equal(queueRequest("nexra-agency", "writer", task, { ...EMPTY_SELECTION, unit: { articleId: "a", articleVersion: 2, articleVersionId: "v", unit: checks.units[2] } }).ok, false);
});

test("draft-policy tasks are labelled: a draft for your review, publishes nothing", () => {
  assert.equal(DRAFT_NOTE, "Writes a draft for your review, publishes nothing.");
  assert.equal(find("writer", "article-revision-draft").draftNote, DRAFT_NOTE);
  assert.equal(find("writer", "section-draft").draftNote, DRAFT_NOTE);
  for (const agent of AGENT_REGISTRY) {
    for (const t of queueableTasks(agent.id)) if (agent.id !== "writer") assert.equal(t.draftNote, null, t.taskType);
  }
  assert.match(read("components/agents/queue-review-control.tsx"), /\{task\.draftNote && <Badge tone="warning">\{task\.draftNote\}<\/Badge>\}/);
});

test("the daily cap and other refusals read in the review controls' words", () => {
  assert.equal(queueFailure(429, { error: "daily-cap" }, "technical-seo", "finding-history-review"), DAILY_CAP_MESSAGE);
  assert.match(queueFailure(403, { error: "task-not-allowed" }, "writer", "crawl-review"), /The Writer agent is not allowed to run this task/);
  assert.match(queueFailure(503, { error: "unavailable" }, "writer", "article-revision-draft"), /nothing can be queued/);
});

test("queueing calls the existing create route only, never an execution, and says who runs it", () => {
  assert.equal(queueUrls.create, "/api/agent-runs");
  const screen = read("components/agents/queue-review-control.tsx");
  assert.equal(screen.match(/method: "POST"/g)?.length, 1);
  assert.match(screen, /fetch\(queueUrls\.create, \{ method: "POST"/);
  assert.doesNotMatch(screen, /"execute"|action: "|\/api\/agent-runs\/|\/api\/worker/, "no execute action, run route or worker call");
  assert.match(screen, /This queues a run and executes nothing\./);
  assert.match(QUEUED_NOTE, /Queued, not run/);
  assert.match(QUEUED_NOTE, /Run History below/);
  assert.match(QUEUED_NOTE, /Run now here, or the scheduled worker picks it up\.$/);
  // The route files it reads exist and answer GET.
  for (const path of ["crawls", "crawls/competitor-overview", "content-articles", "content-article-checks"]) {
    assert.match(read(`app/api/${path}/route.ts`), /export async function GET/, path);
  }
  const section = read("components/agents/agent-runs-section.tsx");
  assert.ok(section.indexOf("<QueueReviewControl") < section.indexOf("<AgentRunHistory"), "the control sits above Run History");
  assert.match(section, /onQueued=\{\(\) => setRefreshToken\(\(n\) => n \+ 1\)\}/, "a queued run is listed");
});
