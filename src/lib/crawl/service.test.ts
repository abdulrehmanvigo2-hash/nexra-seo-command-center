import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createCrawlService } from "./service.ts";
import { unavailableCrawlStore, type CrawlStore } from "./contract.ts";
import { DEFAULT_USER_AGENT, type CrawlConfig } from "./config.ts";
import type { CrawlResult } from "./engine.ts";
import type { ProjectRepository } from "@/lib/projects/contract";
import type { ProjectRecord } from "@/types/project";

/**
 * The service over fake boundaries: a fake store, a fake project repository,
 * and a fake engine. Nothing here touches a database or a website.
 *
 * The engine is the important fake. The real one makes outbound requests, and
 * the point of these tests is the rules *around* a crawl — who may start one,
 * against what, and what is recorded when it ends — which must hold whatever
 * the engine did.
 */

const PROJECT: ProjectRecord = {
  id: "nexra-agency",
  name: "Nexra Agency",
  domain: "nexraagency.com",
} as ProjectRecord;

const CONFIG: CrawlConfig = {
  enabled: true,
  allowedHosts: ["nexraagency.com"],
  userAgent: DEFAULT_USER_AGENT,
  budget: { maxPages: 5, maxDepth: 1, maxDurationMs: 60_000 },
};

const OPERATOR = "00000000-0000-4000-8000-00000000aaaa";

function projectsWith(project: ProjectRecord | null): ProjectRepository {
  return {
    async getProjectById(id) {
      return project !== null && project.id === id ? project : null;
    },
  } as ProjectRepository;
}

/** A store that records what it was asked to do. */
function recordingStore(): CrawlStore & {
  readonly calls: string[];
  readonly finished: { status: string; stopReason: string; errorCode: string | null }[];
  pages: number;
  links: number;
} {
  const calls: string[] = [];
  const finished: { status: string; stopReason: string; errorCode: string | null }[] = [];
  const state = {
    calls,
    finished,
    pages: 0,
    links: 0,
    storesCrawls: true,
    async insert(crawl) {
      calls.push("insert");
      return {
        status: "inserted" as const,
        crawl: {
          id: "crawl-1",
          projectId: crawl.projectId,
          startUrl: crawl.startUrl,
          hostScope: crawl.hostScope,
          status: "running" as const,
          stopReason: null,
          budget: crawl.budget,
          userAgent: crawl.userAgent,
          robotsState: "unavailable" as const,
          sitemapState: "unavailable" as const,
          pagesDiscovered: 0,
          pagesFetched: 0,
          pagesFailed: 0,
          error: null,
          createdBy: crawl.createdBy,
          startedAt: "2026-09-20T00:00:00.000Z",
          finishedAt: null,
        },
      };
    },
    async finish(id, completion) {
      calls.push("finish");
      finished.push({
        status: completion.status,
        stopReason: completion.stopReason,
        errorCode: completion.error?.code ?? null,
      });
      return {
        id,
        projectId: "nexra-agency",
        startUrl: "https://nexraagency.com/",
        hostScope: "nexraagency.com",
        status: completion.status,
        stopReason: completion.stopReason,
        budget: CONFIG.budget,
        userAgent: CONFIG.userAgent,
        robotsState: completion.robotsState,
        sitemapState: completion.sitemapState,
        pagesDiscovered: completion.pagesDiscovered,
        pagesFetched: completion.pagesFetched,
        pagesFailed: completion.pagesFailed,
        error: completion.error,
        createdBy: OPERATOR,
        startedAt: "2026-09-20T00:00:00.000Z",
        finishedAt: "2026-09-20T00:01:00.000Z",
      };
    },
    async getById() {
      calls.push("getById");
      return null;
    },
    async listByProject() {
      calls.push("listByProject");
      return [];
    },
    async savePages(_id, pages) {
      calls.push("savePages");
      state.pages = pages.length;
    },
    async saveLinks(_id, links) {
      calls.push("saveLinks");
      state.links = links.length;
    },
    async listPages() {
      calls.push("listPages");
      return [];
    },
  } satisfies CrawlStore & Record<string, unknown>;
  return state as ReturnType<typeof recordingStore>;
}

function engineReturning(result: Partial<CrawlResult>) {
  return async (): Promise<CrawlResult> => ({
    pages: [],
    links: [],
    robotsState: "fetched",
    sitemapState: "absent",
    stopReason: "completed",
    pagesDiscovered: 0,
    pagesFetched: 0,
    pagesFailed: 0,
    startFailure: null,
    ...result,
  });
}

describe("startCrawl — gates", () => {
  test("refuses when the store does not persist crawls", async () => {
    let engineRan = false;
    const service = createCrawlService({
      store: unavailableCrawlStore,
      projects: projectsWith(PROJECT),
      config: CONFIG,
      engine: async () => {
        engineRan = true;
        return engineReturning({})();
      },
    });

    const result = await service.startCrawl("nexra-agency", OPERATOR);
    assert.deepEqual(result, { ok: false, failure: { reason: "unavailable" } });
    assert.equal(engineRan, false, "nothing may be fetched when nothing can be recorded");
  });

  test("refuses when crawling is switched off, before any outbound request", async () => {
    let engineRan = false;
    const service = createCrawlService({
      store: recordingStore(),
      projects: projectsWith(PROJECT),
      config: { ...CONFIG, enabled: false },
      engine: async () => {
        engineRan = true;
        return engineReturning({})();
      },
    });

    const result = await service.startCrawl("nexra-agency", OPERATOR);
    assert.deepEqual(result, { ok: false, failure: { reason: "disabled" } });
    assert.equal(engineRan, false);
  });

  test("refuses a host that is not on the allow-list", async () => {
    const store = recordingStore();
    const service = createCrawlService({
      store,
      projects: projectsWith(PROJECT),
      config: { ...CONFIG, allowedHosts: ["someone-else.com"] },
      engine: engineReturning({}),
    });

    const result = await service.startCrawl("nexra-agency", OPERATOR);
    assert.deepEqual(result, { ok: false, failure: { reason: "host-not-allowed" } });
    assert.deepEqual(store.calls, [], "no row may be written for a crawl that cannot run");
  });

  test("a parent domain on the allow-list does not authorise a subdomain", async () => {
    const service = createCrawlService({
      store: recordingStore(),
      projects: projectsWith({ ...PROJECT, domain: "blog.nexraagency.com" } as ProjectRecord),
      config: CONFIG,
      engine: engineReturning({}),
    });

    const result = await service.startCrawl("nexra-agency", OPERATOR);
    assert.deepEqual(result, { ok: false, failure: { reason: "host-not-allowed" } });
  });

  test("refuses an unknown project", async () => {
    const service = createCrawlService({
      store: recordingStore(),
      projects: projectsWith(null),
      config: CONFIG,
      engine: engineReturning({}),
    });
    const result = await service.startCrawl("no-such-project", OPERATOR);
    assert.deepEqual(result, { ok: false, failure: { reason: "unknown-project" } });
  });

  test("refuses a project whose domain is not a usable hostname", async () => {
    const service = createCrawlService({
      store: recordingStore(),
      projects: projectsWith({ ...PROJECT, domain: "not a domain" } as ProjectRecord),
      config: CONFIG,
      engine: engineReturning({}),
    });
    const result = await service.startCrawl("nexra-agency", OPERATOR);
    assert.deepEqual(result, { ok: false, failure: { reason: "no-domain" } });
  });

  test("the crawl target comes from the stored project, never from the caller", async () => {
    let seen: { startUrl: string; hostScope: string } | null = null;
    const service = createCrawlService({
      store: recordingStore(),
      projects: projectsWith(PROJECT),
      config: CONFIG,
      engine: async (options) => {
        seen = { startUrl: options.startUrl, hostScope: options.hostScope };
        return engineReturning({})();
      },
    });

    await service.startCrawl("nexra-agency", OPERATOR);
    assert.deepEqual(seen, {
      startUrl: "https://nexraagency.com/",
      hostScope: "nexraagency.com",
    });
  });

  test("the configured budget is what the engine is given", async () => {
    let budget: unknown = null;
    const service = createCrawlService({
      store: recordingStore(),
      projects: projectsWith(PROJECT),
      config: CONFIG,
      engine: async (options) => {
        budget = options.budget;
        return engineReturning({})();
      },
    });

    await service.startCrawl("nexra-agency", OPERATOR);
    assert.deepEqual(budget, { maxPages: 5, maxDepth: 1, maxDurationMs: 60_000 });
  });
});

describe("startCrawl — terminal states", () => {
  test("a drained frontier is completed", async () => {
    const store = recordingStore();
    const service = createCrawlService({
      store,
      projects: projectsWith(PROJECT),
      config: CONFIG,
      engine: engineReturning({ stopReason: "completed", pagesFetched: 4, pagesDiscovered: 4 }),
    });

    const result = await service.startCrawl("nexra-agency", OPERATOR);
    assert.ok(result.ok);
    assert.equal(result.crawl.status, "completed");
    assert.deepEqual(store.finished[0], {
      status: "completed",
      stopReason: "completed",
      errorCode: null,
    });
  });

  test("a budgeted stop is partial, and carries no error", async () => {
    const store = recordingStore();
    const service = createCrawlService({
      store,
      projects: projectsWith(PROJECT),
      config: CONFIG,
      engine: engineReturning({ stopReason: "page-budget", pagesFetched: 5, pagesDiscovered: 37 }),
    });

    const result = await service.startCrawl("nexra-agency", OPERATOR);
    assert.ok(result.ok);
    assert.equal(result.crawl.status, "partial", "a budgeted stop is a result, not a failure");
    assert.equal(result.crawl.error, null);
    assert.deepEqual(store.finished[0], {
      status: "partial",
      stopReason: "page-budget",
      errorCode: null,
    });
  });

  test("a start failure is recorded as failed with its fixed code", async () => {
    const store = recordingStore();
    const service = createCrawlService({
      store,
      projects: projectsWith(PROJECT),
      config: CONFIG,
      engine: engineReturning({ stopReason: "error", startFailure: "blocked-by-robots" }),
    });

    const result = await service.startCrawl("nexra-agency", OPERATOR);
    assert.equal(result.ok, false);
    assert.ok(!result.ok);
    assert.equal(result.failure.reason, "blocked-by-robots");
    assert.deepEqual(store.finished[0], {
      status: "failed",
      stopReason: "error",
      errorCode: "blocked-by-robots",
    });
  });

  test("pages and links are written before the crawl is marked finished", async () => {
    const store = recordingStore();
    const service = createCrawlService({
      store,
      projects: projectsWith(PROJECT),
      config: CONFIG,
      engine: engineReturning({}),
    });

    await service.startCrawl("nexra-agency", OPERATOR);
    // A row saying "completed, 40 pages" with no pages behind it would be a
    // claim the reader cannot check.
    assert.deepEqual(store.calls, ["insert", "savePages", "saveLinks", "finish"]);
  });
});

describe("startCrawl — a crawl that throws", () => {
  test("an engine failure still closes the crawl instead of leaving it running", async () => {
    const store = recordingStore();
    const service = createCrawlService({
      store,
      projects: projectsWith(PROJECT),
      config: CONFIG,
      engine: async () => {
        throw new Error("socket exploded");
      },
    });

    const result = await service.startCrawl("nexra-agency", OPERATOR);
    assert.equal(result.ok, false);
    assert.ok(store.calls.includes("finish"), "a crawl row must never be left running");
    assert.equal(store.finished[0]?.status, "failed");
  });

  test("a failure while saving pages still closes the crawl", async () => {
    const store = recordingStore();
    const broken: CrawlStore = {
      ...store,
      async savePages() {
        throw new Error("insert failed");
      },
    };
    const service = createCrawlService({
      store: broken,
      projects: projectsWith(PROJECT),
      config: CONFIG,
      engine: engineReturning({}),
    });

    const result = await service.startCrawl("nexra-agency", OPERATOR);
    assert.equal(result.ok, false);
    assert.equal(store.finished[0]?.status, "failed");
  });

  test("no exception text from the failure reaches the stored record", async () => {
    const store = recordingStore();
    const service = createCrawlService({
      store,
      projects: projectsWith(PROJECT),
      config: CONFIG,
      engine: async () => {
        throw new Error("connect ECONNREFUSED 10.0.0.5:5432");
      },
    });

    await service.startCrawl("nexra-agency", OPERATOR);
    assert.equal(store.finished[0]?.errorCode, "crawl-failed");
  });
});

describe("reads", () => {
  test("getCrawl returns null for an unknown crawl rather than an empty one", async () => {
    const service = createCrawlService({
      store: recordingStore(),
      projects: projectsWith(PROJECT),
      config: CONFIG,
      engine: engineReturning({}),
    });
    assert.equal(await service.getCrawl("crawl-1"), null);
  });

  test("the unavailable store reports nothing rather than an empty site", async () => {
    const service = createCrawlService({
      store: unavailableCrawlStore,
      projects: projectsWith(PROJECT),
      config: CONFIG,
      engine: engineReturning({}),
    });

    assert.equal(await service.getCrawl("crawl-1"), null);
    assert.deepEqual(await service.listCrawls("nexra-agency"), []);
  });
});
