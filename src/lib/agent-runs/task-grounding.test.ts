import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Crawl, CrawlPage } from "../../types/crawl.ts";
import { formatCrawlGrounding } from "../crawl/grounding.ts";
import { createAiExecutor } from "./ai-executor.ts";
import type { ExecutionTask } from "./executor.ts";
import { createTaskGrounding } from "./task-grounding.ts";

/**
 * One crawl, two agents, one reader.
 *
 * The runtime decides what evidence a task sees from the task type's own
 * declaration, so the On-Page SEO agent's `on-page-review` reads exactly the
 * block the Technical SEO agent's `crawl-review` reads — through the same
 * ownership check, with the same refusals, and with the same guarantee that a
 * refused grounding never reaches the model. Everything below runs against an
 * in-memory crawl and a provider that only records what it was asked.
 */

const CRAWL: Crawl = {
  id: "8f1c0d2e-0000-4000-8000-000000000001",
  projectId: "nexra-agency",
  startUrl: "https://nexraagency.com/",
  hostScope: "nexraagency.com",
  status: "partial",
  stopReason: "page-budget",
  budget: { maxPages: 5, maxDepth: 1, maxDurationMs: 60_000 },
  userAgent: "NexraBot/0.1",
  robotsState: "fetched",
  sitemapState: "unavailable",
  pagesDiscovered: 7,
  pagesFetched: 5,
  pagesFailed: 0,
  error: null,
  createdBy: "00000000-0000-4000-8000-00000000000a",
  startedAt: "2026-09-20T10:00:00.000Z",
  finishedAt: "2026-09-20T10:00:04.500Z",
};

const PAGE: CrawlPage = {
  id: "page-1",
  crawlId: CRAWL.id,
  url: "https://nexraagency.com/services",
  finalUrl: "https://nexraagency.com/services",
  fetchState: "fetched",
  httpStatus: 200,
  redirectHops: 0,
  redirectChain: [],
  contentType: "text/html; charset=utf-8",
  contentBytes: 40_000,
  robotsMeta: null,
  robotsTxtAllowed: true,
  canonicalHref: "https://nexraagency.com/services",
  canonicalResolved: "https://nexraagency.com/services",
  canonicalIsSelf: true,
  title: "Services",
  titleLength: 8,
  metaDescription: "What the agency does.",
  metaDescriptionLength: 21,
  h1Count: 1,
  firstH1: "Services",
  schemaTypes: ["Organization"],
  schemaBlocks: 1,
  schemaParseFailed: false,
  inSitemap: null,
  depth: 1,
  internalLinksIn: 3,
  internalLinksOut: 9,
  fetchedAt: "2026-09-20T10:00:02.000Z",
  errorCode: null,
};

const SKIPPED: CrawlPage = {
  ...PAGE,
  id: "page-2",
  url: "https://nexraagency.com/privacy",
  finalUrl: null,
  fetchState: "budget-skipped",
  httpStatus: null,
  contentType: null,
  canonicalHref: null,
  canonicalResolved: null,
  canonicalIsSelf: null,
  title: null,
  titleLength: null,
  metaDescription: null,
  metaDescriptionLength: null,
  h1Count: null,
  firstH1: null,
  schemaTypes: [],
  schemaBlocks: 0,
  depth: null,
  internalLinksOut: 0,
  fetchedAt: null,
};

const PAGES = [PAGE, SKIPPED];

/** An in-memory crawl store that also counts how often it was read. */
function crawlStore(crawl: Crawl = CRAWL, pages: readonly CrawlPage[] = PAGES) {
  let reads = 0;
  return {
    reads: () => reads,
    reader: {
      async getCrawl(id: string) {
        reads += 1;
        return id === crawl.id ? { crawl, pages } : null;
      },
    },
  };
}

function capturingProvider() {
  const seen: { system?: string; prompt?: string; calls: number } = { calls: 0 };
  return {
    seen,
    provider: {
      id: "anthropic" as const,
      model: "test-model",
      async generate(request: { system: string; prompt: string }) {
        seen.calls += 1;
        seen.system = request.system;
        seen.prompt = request.prompt;
        return { text: "ok", model: "test-model", inputTokens: 1, outputTokens: 1 };
      },
    },
  };
}

const onPageTask: ExecutionTask = {
  runId: "00000000-0000-4000-8000-00000000000b",
  attempt: 1,
  agent: { id: "on-page-seo", name: "On-Page SEO" },
  project: { id: "nexra-agency", name: "Nexra Agency", domain: "nexraagency.com" },
  taskType: "on-page-review",
  input: { crawlId: CRAWL.id },
};

const crawlReviewTask: ExecutionTask = {
  ...onPageTask,
  agent: { id: "technical-seo", name: "Technical SEO" },
  taskType: "crawl-review",
};

describe("which tasks are grounded", () => {
  test("on-page-review is grounded in the crawl, through the shared reader", async () => {
    const store = crawlStore();
    const result = await createTaskGrounding(store.reader)(onPageTask);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(result.grounding, "no grounding was supplied");
    assert.equal(store.reads(), 1);
    assert.equal(result.grounding?.summary.crawlId, CRAWL.id);
  });

  test("both crawl-grounded tasks receive byte-identical evidence", async () => {
    const grounding = createTaskGrounding(crawlStore().reader);
    const [onPage, technical] = await Promise.all([grounding(onPageTask), grounding(crawlReviewTask)]);

    assert.ok(onPage.ok && technical.ok);
    if (!onPage.ok || !technical.ok) return;
    assert.equal(onPage.grounding?.text, technical.grounding?.text);
    assert.deepEqual(onPage.grounding?.summary, technical.grounding?.summary);
    // And it is the block the grounding module itself would produce.
    assert.equal(onPage.grounding?.text, formatCrawlGrounding(CRAWL, PAGES).text);
  });

  test("a task that declares no evidence gets none, and the crawl store is never read", async () => {
    const store = crawlStore();
    const result = await createTaskGrounding(store.reader)({
      ...onPageTask,
      agent: { id: "seo-director", name: "SEO Director" },
      taskType: "project-review",
      input: {},
    });

    assert.deepEqual(result, { ok: true, grounding: null });
    assert.equal(store.reads(), 0);
  });

  test("an unknown task type is not grounded rather than guessed at", async () => {
    const store = crawlStore();
    const result = await createTaskGrounding(store.reader)({
      ...onPageTask,
      taskType: "made-up-task" as ExecutionTask["taskType"],
    });
    assert.deepEqual(result, { ok: true, grounding: null });
    assert.equal(store.reads(), 0);
  });
});

describe("refusals, shared by both tasks", () => {
  const cases = [
    ["on-page-review", onPageTask],
    ["crawl-review", crawlReviewTask],
  ] as const;

  for (const [name, task] of cases) {
    test(`${name}: a missing crawl id is refused before the store is read`, async () => {
      const store = crawlStore();
      const result = await createTaskGrounding(store.reader)({ ...task, input: {} });
      assert.deepEqual(result, { ok: false, reason: "crawl-id-missing" });
      assert.equal(store.reads(), 0);
    });

    test(`${name}: a crawl id that is not a string is refused`, async () => {
      const result = await createTaskGrounding(crawlStore().reader)({ ...task, input: { crawlId: 42 } });
      assert.deepEqual(result, { ok: false, reason: "crawl-id-missing" });
    });

    test(`${name}: an unknown crawl is refused`, async () => {
      const result = await createTaskGrounding(crawlStore().reader)({
        ...task,
        input: { crawlId: "8f1c0d2e-0000-4000-8000-00000000ffff" },
      });
      assert.deepEqual(result, { ok: false, reason: "crawl-not-found" });
    });

    test(`${name}: another project's crawl is refused, not described`, async () => {
      const result = await createTaskGrounding(crawlStore().reader)({
        ...task,
        project: { id: "other-client", name: "Other Client", domain: "other.example" },
      });
      assert.deepEqual(result, { ok: false, reason: "crawl-not-in-project" });
    });

    test(`${name}: a running crawl is refused`, async () => {
      const result = await createTaskGrounding(crawlStore({ ...CRAWL, status: "running", finishedAt: null }).reader)(task);
      assert.deepEqual(result, { ok: false, reason: "crawl-unfinished" });
    });

    test(`${name}: a failed crawl is refused`, async () => {
      const result = await createTaskGrounding(crawlStore({ ...CRAWL, status: "failed", stopReason: "error" }).reader)(task);
      assert.deepEqual(result, { ok: false, reason: "crawl-not-reviewable" });
    });
  }
});

describe("the On-Page SEO agent through the executor", () => {
  test("the evidence and the on-page instructions reach the prompt, and the run is marked grounded", async () => {
    const { seen, provider } = capturingProvider();
    const executor = createAiExecutor(provider, createTaskGrounding(crawlStore().reader));

    const output = await executor.execute(onPageTask, new AbortController().signal);

    assert.equal(seen.calls, 1);
    assert.match(seen.system ?? "", /You are the On-Page SEO agent/);
    assert.match(seen.prompt ?? "", /Task: On-page review/);
    assert.match(seen.prompt ?? "", /Evidence recorded by this product/);
    assert.match(seen.prompt ?? "", /OBSERVED .* INFERENCE .* RECOMMENDATION/);
    assert.match(seen.prompt ?? "", /cannot edit, publish, or change any page/);
    // The page texts an on-page review needs are present, quoted.
    assert.ok((seen.prompt ?? "").includes('Title: "Services"'));
    assert.ok((seen.prompt ?? "").includes('Meta description: "What the agency does."'));
    assert.ok((seen.prompt ?? "").includes("Meta description length: 21"));
    assert.ok((seen.prompt ?? "").includes('First h1: "Services"'));
    // And the page nobody fetched is named as unaudited, not described.
    assert.match(seen.prompt ?? "", /NOT REACHED — NOT AUDITED/);
    assert.ok((seen.prompt ?? "").includes("https://nexraagency.com/privacy"));

    assert.equal(output.metadata?.grounded, true);
    assert.equal(output.metadata?.simulated, false);
    assert.equal(output.metadata?.taskType, "on-page-review");
    assert.deepEqual(output.metadata?.evidence, { ...formatCrawlGrounding(CRAWL, PAGES).summary });
  });

  test("the partial-crawl scope language is in the prompt, so the agent cannot read five pages as a site", async () => {
    const { seen, provider } = capturingProvider();
    const executor = createAiExecutor(provider, createTaskGrounding(crawlStore().reader));
    await executor.execute(onPageTask, new AbortController().signal);

    assert.match(seen.prompt ?? "", /Status: partial \(page-budget\)/);
    assert.match(seen.prompt ?? "", /bounded crawl of a few pages, not a full site audit/);
    assert.match(seen.prompt ?? "", /Do not describe this as a site-wide review/);
    assert.match(seen.prompt ?? "", /Internal link counts are within this crawl only and cannot show that a page is orphaned/);
    assert.match(seen.system ?? "", /crawl evidence supplied with it, and from nothing else/);
  });

  test("a refused grounding reaches no provider, whatever the refusal", async () => {
    const refusedTasks: readonly ExecutionTask[] = [
      { ...onPageTask, input: {} },
      { ...onPageTask, project: { id: "other-client", name: "Other", domain: "other.example" } },
      { ...onPageTask, input: { crawlId: "8f1c0d2e-0000-4000-8000-00000000ffff" } },
    ];
    for (const task of refusedTasks) {
      const { seen, provider } = capturingProvider();
      const executor = createAiExecutor(provider, createTaskGrounding(crawlStore().reader));
      await assert.rejects(() => executor.execute(task, new AbortController().signal));
      assert.equal(seen.calls, 0, "the provider was called for a refused grounding");
    }
  });

  test("the Technical SEO crawl review still reaches the model with its own instructions", async () => {
    const { seen, provider } = capturingProvider();
    const executor = createAiExecutor(provider, createTaskGrounding(crawlStore().reader));
    const output = await executor.execute(crawlReviewTask, new AbortController().signal);

    assert.equal(seen.calls, 1);
    assert.match(seen.system ?? "", /You are the Technical SEO agent/);
    assert.match(seen.prompt ?? "", /Task: Crawl review/);
    assert.doesNotMatch(seen.prompt ?? "", /cannot edit, publish, or change any page/);
    assert.equal(output.metadata?.grounded, true);
    assert.equal(output.metadata?.taskType, "crawl-review");
  });
});
