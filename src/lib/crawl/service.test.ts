import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createCrawlService } from "./service.ts";
import { unavailableCrawlStore, type CrawlStore } from "./contract.ts";
import { DEFAULT_USER_AGENT, type CrawlConfig } from "./config.ts";
import type { CrawlResult } from "./engine.ts";
import type { CrawlFindingsStore, StoredCrawlFindingsReport } from "./findings/store-contract.ts";
import type { ProjectRepository } from "@/lib/projects/contract";
import type { Crawl } from "@/types/crawl";
import type { ProjectIntake, ProjectRecord } from "@/types/project";

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
  concurrency: 1,
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
    async listLinks() {
      calls.push("listLinks");
      return [];
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

  test("the configured concurrency reaches the engine", async () => {
    // A setting that is read but never passed on is worse than no setting:
    // the operator believes the crawl is limited and it is not.
    let concurrency: unknown = null;
    const service = createCrawlService({
      store: recordingStore(),
      projects: projectsWith(PROJECT),
      config: { ...CONFIG, concurrency: 1 },
      engine: async (options) => {
        concurrency = options.concurrency;
        return engineReturning({})();
      },
    });

    await service.startCrawl("nexra-agency", OPERATOR);
    assert.equal(concurrency, 1);
  });

  test("the budget the crawl is recorded under is the one it ran with", async () => {
    // The row carries the limits, so a reader can tell a five-page crawl from
    // a site with five pages.
    const store = recordingStore();
    const service = createCrawlService({
      store,
      projects: projectsWith(PROJECT),
      config: CONFIG,
      engine: engineReturning({}),
    });

    const result = await service.startCrawl("nexra-agency", OPERATOR);
    assert.ok(result.ok);
    assert.deepEqual(result.crawl.budget, { maxPages: 5, maxDepth: 1, maxDurationMs: 60_000 });
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

/**
 * Competitor crawls: the same service, one more argument, and every gate the
 * project's own crawl runs under. The fakes below add what the competitor
 * path reads — the stored intake list — and a store that remembers which
 * host each listing asked for, because keeping own-site and competitor
 * crawls apart is the whole point.
 */

const INTAKE: ProjectIntake = {
  competitorDomains: ["rival.example", "https://Other.Example/", "nexraagency.com", "not a domain"],
  intakeNotes: "",
};

const COMPETITOR_CONFIG: CrawlConfig = { ...CONFIG, allowedHosts: ["nexraagency.com", "rival.example"] };

function projectsWithIntake(project: ProjectRecord | null, intake: ProjectIntake | null = INTAKE): ProjectRepository & {
  readonly intakeReads: string[];
} {
  const intakeReads: string[] = [];
  return {
    intakeReads,
    async getProjectById(id) {
      return project !== null && project.id === id ? project : null;
    },
    async getProjectIntake(id) {
      intakeReads.push(id);
      return project !== null && project.id === id ? intake : null;
    },
  } as ProjectRepository & { readonly intakeReads: string[] };
}

/** A store holding rows for two hosts, answering listings by exact host. */
function twoHostStore(): CrawlStore & { readonly listings: { projectId: string; hostScope: string | undefined }[] } {
  const base = recordingStore();
  const row = (id: string, projectId: string, hostScope: string, startedAt: string): Crawl => ({
    id,
    projectId,
    startUrl: `https://${hostScope}/`,
    hostScope,
    status: "partial",
    stopReason: "page-budget",
    budget: CONFIG.budget,
    userAgent: CONFIG.userAgent,
    robotsState: "fetched",
    sitemapState: "unavailable",
    pagesDiscovered: 7,
    pagesFetched: 5,
    pagesFailed: 0,
    error: null,
    createdBy: OPERATOR,
    startedAt,
    finishedAt: startedAt,
  });
  const rows = [
    row("own-1", "nexra-agency", "nexraagency.com", "2026-09-20T00:00:00.000Z"),
    row("rival-1", "nexra-agency", "rival.example", "2026-09-21T00:00:00.000Z"),
    row("other-1", "nexra-agency", "other.example", "2026-09-21T01:00:00.000Z"),
    row("foreign-1", "another-project", "rival.example", "2026-09-21T02:00:00.000Z"),
  ];
  const listings: { projectId: string; hostScope: string | undefined }[] = [];
  return {
    ...base,
    listings,
    async listByProject(projectId, limit, hostScope) {
      listings.push({ projectId, hostScope });
      return rows
        .filter((crawl) => crawl.projectId === projectId && (hostScope === undefined || crawl.hostScope === hostScope))
        .slice(0, limit);
    },
  };
}

describe("startCrawl — a competitor site", () => {
  const target = { competitorDomain: "rival.example" };

  test("a recorded competitor host is crawled, with the same engine, budget, concurrency and user agent", async () => {
    let seen: { startUrl: string; hostScope: string; budget: unknown; concurrency: unknown; userAgent: string } | null = null;
    const store = recordingStore();
    const projects = projectsWithIntake(PROJECT);
    const service = createCrawlService({
      store,
      projects,
      config: COMPETITOR_CONFIG,
      engine: async (options) => {
        seen = {
          startUrl: options.startUrl,
          hostScope: options.hostScope,
          budget: options.budget,
          concurrency: options.concurrency,
          userAgent: options.userAgent,
        };
        return engineReturning({ stopReason: "page-budget", pagesFetched: 5, pagesDiscovered: 9 })();
      },
    });

    const result = await service.startCrawl("nexra-agency", OPERATOR, target);
    assert.ok(result.ok);
    assert.deepEqual(seen, {
      startUrl: "https://rival.example/",
      hostScope: "rival.example",
      budget: { maxPages: 5, maxDepth: 1, maxDurationMs: 60_000 },
      concurrency: 1,
      userAgent: DEFAULT_USER_AGENT,
    });
    // The list was read from the stored project, by the authorised project id.
    assert.deepEqual(projects.intakeReads, ["nexra-agency"]);
    assert.deepEqual(store.calls, ["insert", "savePages", "saveLinks", "finish"]);
  });

  test("the crawl is recorded under the project and the competitor's exact host", async () => {
    let inserted: { projectId: string; hostScope: string; startUrl: string } | null = null;
    const store = recordingStore();
    const original = store.insert;
    store.insert = async (crawl) => {
      inserted = { projectId: crawl.projectId, hostScope: crawl.hostScope, startUrl: crawl.startUrl };
      return original(crawl);
    };
    const service = createCrawlService({ store, projects: projectsWithIntake(PROJECT), config: COMPETITOR_CONFIG, engine: engineReturning({}) });

    await service.startCrawl("nexra-agency", OPERATOR, { competitorDomain: "RIVAL.example" });
    assert.deepEqual(inserted, { projectId: "nexra-agency", hostScope: "rival.example", startUrl: "https://rival.example/" });
  });

  test("every refusal happens before the engine runs and before a row is written", async () => {
    const cases: [string, unknown, CrawlConfig, ProjectRepository, string][] = [
      ["unrecorded domain", { competitorDomain: "unrecorded.example" }, COMPETITOR_CONFIG, projectsWithIntake(PROJECT), "competitor-not-recorded"],
      ["another project's rival", { competitorDomain: "rival.example" }, COMPETITOR_CONFIG, projectsWithIntake(PROJECT, { competitorDomains: ["someone-elses.example"], intakeNotes: "" }), "competitor-not-recorded"],
      ["no intake recorded", { competitorDomain: "rival.example" }, COMPETITOR_CONFIG, projectsWithIntake(PROJECT, null), "competitor-not-recorded"],
      ["the project's own site", { competitorDomain: "nexraagency.com" }, COMPETITOR_CONFIG, projectsWithIntake(PROJECT), "competitor-is-project-site"],
      ["a subdomain of the project's site", { competitorDomain: "blog.nexraagency.com" }, COMPETITOR_CONFIG, projectsWithIntake(PROJECT, { competitorDomains: ["blog.nexraagency.com"], intakeNotes: "" }), "competitor-is-project-site"],
      ["a URL", { competitorDomain: "https://rival.example/" }, COMPETITOR_CONFIG, projectsWithIntake(PROJECT), "competitor-invalid"],
      ["a path", { competitorDomain: "rival.example/pricing" }, COMPETITOR_CONFIG, projectsWithIntake(PROJECT), "competitor-invalid"],
      ["a port", { competitorDomain: "rival.example:8443" }, COMPETITOR_CONFIG, projectsWithIntake(PROJECT), "competitor-invalid"],
      ["an address", { competitorDomain: "169.254.169.254" }, COMPETITOR_CONFIG, projectsWithIntake(PROJECT), "competitor-invalid"],
      ["an empty domain", { competitorDomain: "" }, COMPETITOR_CONFIG, projectsWithIntake(PROJECT), "competitor-invalid"],
      ["a host off the allow-list", { competitorDomain: "other.example" }, COMPETITOR_CONFIG, projectsWithIntake(PROJECT), "host-not-allowed"],
      ["a recorded host on nobody's allow-list", { competitorDomain: "rival.example" }, CONFIG, projectsWithIntake(PROJECT), "host-not-allowed"],
      ["crawling switched off", { competitorDomain: "rival.example" }, { ...COMPETITOR_CONFIG, enabled: false }, projectsWithIntake(PROJECT), "disabled"],
      ["an unknown project", { competitorDomain: "rival.example" }, COMPETITOR_CONFIG, projectsWithIntake(null), "unknown-project"],
      ["a project without a usable domain", { competitorDomain: "rival.example" }, COMPETITOR_CONFIG, projectsWithIntake({ ...PROJECT, domain: "not a domain" } as ProjectRecord), "no-domain"],
    ];
    for (const [name, target, config, projects, reason] of cases) {
      let engineRan = false;
      const store = recordingStore();
      const service = createCrawlService({
        store,
        projects,
        config,
        engine: async () => {
          engineRan = true;
          return engineReturning({})();
        },
      });
      const result = await service.startCrawl("nexra-agency", OPERATOR, target as { competitorDomain: string });
      assert.deepEqual(result, { ok: false, failure: { reason } }, name);
      assert.equal(engineRan, false, `${name}: the engine ran`);
      assert.deepEqual(store.calls, [], `${name}: a row was written`);
    }
  });

  test("the unavailable store refuses a competitor crawl without fetching", async () => {
    let engineRan = false;
    const service = createCrawlService({
      store: unavailableCrawlStore,
      projects: projectsWithIntake(PROJECT),
      config: COMPETITOR_CONFIG,
      engine: async () => {
        engineRan = true;
        return engineReturning({})();
      },
    });
    assert.deepEqual(await service.startCrawl("nexra-agency", OPERATOR, target), { ok: false, failure: { reason: "unavailable" } });
    assert.equal(engineRan, false);
  });

  test("the project's own crawl is unchanged by the competitor path: no target, no intake read", async () => {
    const projects = projectsWithIntake(PROJECT);
    let seen: string | null = null;
    const service = createCrawlService({
      store: recordingStore(),
      projects,
      config: COMPETITOR_CONFIG,
      engine: async (options) => {
        seen = options.hostScope;
        return engineReturning({})();
      },
    });
    const result = await service.startCrawl("nexra-agency", OPERATOR);
    assert.ok(result.ok);
    assert.equal(seen, "nexraagency.com");
    assert.deepEqual(projects.intakeReads, []);
  });
});

describe("own-site and competitor crawls are listed apart", () => {
  test("listCrawls returns the project's own-site crawls only, by exact host", async () => {
    const store = twoHostStore();
    const service = createCrawlService({ store, projects: projectsWithIntake(PROJECT), config: COMPETITOR_CONFIG, engine: engineReturning({}) });

    const own = await service.listCrawls("nexra-agency");
    assert.deepEqual(own.map((crawl) => crawl.id), ["own-1"]);
    assert.deepEqual(store.listings, [{ projectId: "nexra-agency", hostScope: "nexraagency.com" }]);
  });

  test("listCompetitorCrawls returns one recorded competitor's crawls only, under this project", async () => {
    const store = twoHostStore();
    const service = createCrawlService({ store, projects: projectsWithIntake(PROJECT), config: COMPETITOR_CONFIG, engine: engineReturning({}) });

    const rival = await service.listCompetitorCrawls("nexra-agency", "Rival.example");
    assert.ok(rival.ok);
    assert.equal(rival.host, "rival.example");
    assert.deepEqual(rival.crawls.map((crawl) => crawl.id), ["rival-1"], "another project's crawl of the same host must not appear");

    const other = await service.listCompetitorCrawls("nexra-agency", "other.example");
    assert.ok(other.ok);
    assert.deepEqual(other.crawls.map((crawl) => crawl.id), ["other-1"]);
    assert.deepEqual(store.listings, [
      { projectId: "nexra-agency", hostScope: "rival.example" },
      { projectId: "nexra-agency", hostScope: "other.example" },
    ]);
  });

  test("a competitor listing is refused for the same reasons a competitor crawl is, without touching the store", async () => {
    const store = twoHostStore();
    const service = createCrawlService({ store, projects: projectsWithIntake(PROJECT), config: COMPETITOR_CONFIG, engine: engineReturning({}) });

    assert.deepEqual(await service.listCompetitorCrawls("nexra-agency", "unrecorded.example"), { ok: false, failure: { reason: "competitor-not-recorded" } });
    assert.deepEqual(await service.listCompetitorCrawls("nexra-agency", "nexraagency.com"), { ok: false, failure: { reason: "competitor-is-project-site" } });
    assert.deepEqual(await service.listCompetitorCrawls("nexra-agency", "https://rival.example/"), { ok: false, failure: { reason: "competitor-invalid" } });
    assert.deepEqual(await service.listCompetitorCrawls("another-project", "rival.example"), { ok: false, failure: { reason: "unknown-project" } });
    assert.deepEqual(store.listings, []);
  });

  test("a project with no usable domain lists no own-site crawl", async () => {
    const store = twoHostStore();
    const service = createCrawlService({
      store,
      projects: projectsWithIntake({ ...PROJECT, domain: "not a domain" } as ProjectRecord),
      config: COMPETITOR_CONFIG,
      engine: engineReturning({}),
    });
    assert.deepEqual(await service.listCrawls("nexra-agency"), []);
    assert.deepEqual(store.listings, []);
  });
});

describe("recording the deterministic findings when a crawl finishes (T3)", () => {
  type Recorded = Parameters<CrawlFindingsStore["record"]>[0];
  function findingsStore(options: { keeps?: boolean; throws?: boolean; report?: StoredCrawlFindingsReport | null } = {}) {
    const recorded: Recorded[] = [];
    const reads: [string, string][] = [];
    const store: CrawlFindingsStore = {
      storesFindings: options.keeps ?? true,
      async record(input) {
        if (options.throws) throw new Error("findings store down");
        recorded.push(input);
        return { status: "created", findings: input.report.findings.length, header: { id: "rep-1", crawlId: input.crawlId, projectId: input.projectId, ruleVersion: input.report.ruleVersion, coverage: input.report.coverage, linksRead: input.links.read, linksCut: input.links.cut, findingsTotal: input.report.findings.length, counts: input.report.counts, truncatedRules: input.report.truncatedRules, recordedAt: "2026-09-20T00:01:01.000Z" } };
      },
      async getReport(projectId, crawlId) {
        reads.push([projectId, crawlId]);
        return options.report ?? null;
      },
    };
    return { store, recorded, reads };
  }
  const crawledPage = (path: string, overrides: Partial<CrawlResult["pages"][number]> = {}): CrawlResult["pages"][number] => ({
    url: `https://nexraagency.com${path}`, finalUrl: `https://nexraagency.com${path}`, fetchState: "fetched", httpStatus: 200, redirectHops: 0, redirectChain: [],
    contentType: "text/html", contentBytes: 100, robotsMeta: null, robotsTxtAllowed: true, canonicalHref: null, canonicalResolved: null, canonicalIsSelf: null,
    title: `A long enough title for the ${path} page here`, titleLength: 38, metaDescription: `Description for ${path}`, metaDescriptionLength: 20, h1Count: 1, firstH1: "h", schemaTypes: [], schemaBlocks: 1,
    schemaParseFailed: false, inSitemap: null, depth: path === "/" ? 0 : 1, internalLinksIn: path === "/" ? 0 : 1, internalLinksOut: 1, fetchedAt: null, errorCode: null, ...overrides,
  });

  test("a finished own-site crawl records the rules' findings over the pages and links it just saved, bound to its project and id", async () => {
    const findings = findingsStore();
    const store = recordingStore();
    const service = createCrawlService({
      store, projects: projectsWith(PROJECT), config: CONFIG, findings: findings.store,
      engine: engineReturning({ pages: [crawledPage("/"), crawledPage("/a", { h1Count: 0 })], links: [{ fromUrl: "https://nexraagency.com/", toUrl: "https://nexraagency.com/a", rel: null, isInternal: true }], pagesDiscovered: 2, pagesFetched: 2 }),
    });
    const result = await service.startCrawl("nexra-agency", OPERATOR);
    assert.ok(result.ok);
    assert.equal(findings.recorded.length, 1);
    const [input] = findings.recorded;
    assert.deepEqual([input.projectId, input.crawlId, input.links], ["nexra-agency", "crawl-1", { read: 1, cut: false }]);
    assert.deepEqual(input.report.findings.map((f) => [f.rule, f.urls[0]]), [["h1-missing", "https://nexraagency.com/a"]]);
    assert.deepEqual(input.report.coverage.pagesTotal, 2);
    // Recorded after the crawl row was closed, never before.
    assert.deepEqual(store.calls.slice(-1), ["finish"]);
  });

  test("nothing is recorded for a crawl that failed to start, a competitor crawl, or a store that keeps no findings", async () => {
    const failed = findingsStore();
    await createCrawlService({ store: recordingStore(), projects: projectsWith(PROJECT), config: CONFIG, findings: failed.store, engine: engineReturning({ startFailure: "start-unreachable", stopReason: "error" }) }).startCrawl("nexra-agency", OPERATOR);
    assert.equal(failed.recorded.length, 0);

    const competitor = findingsStore();
    const rival = await createCrawlService({ store: recordingStore(), projects: projectsWithIntake(PROJECT, { competitorDomains: ["rival.example"], intakeNotes: "" }), config: COMPETITOR_CONFIG, findings: competitor.store, engine: engineReturning({ pages: [crawledPage("/", { h1Count: 0 })], pagesFetched: 1 }) }).startCrawl("nexra-agency", OPERATOR, { competitorDomain: "rival.example" });
    assert.ok(rival.ok, JSON.stringify(rival));
    assert.equal(competitor.recorded.length, 0);

    const none = findingsStore({ keeps: false });
    await createCrawlService({ store: recordingStore(), projects: projectsWith(PROJECT), config: CONFIG, findings: none.store, engine: engineReturning({ pages: [crawledPage("/", { h1Count: 0 })], pagesFetched: 1 }) }).startCrawl("nexra-agency", OPERATOR);
    assert.equal(none.recorded.length, 0);
  });

  test("a findings store that throws never fails the crawl", async () => {
    const service = createCrawlService({ store: recordingStore(), projects: projectsWith(PROJECT), config: CONFIG, findings: findingsStore({ throws: true }).store, engine: engineReturning({ pages: [crawledPage("/")], pagesFetched: 1 }) });
    const result = await service.startCrawl("nexra-agency", OPERATOR);
    assert.ok(result.ok && result.crawl.status === "completed");
  });

  /** The recording store forgets what it finished; this one holds the finished crawl so it can be read back by id. */
  function storeHoldingFinished(): CrawlStore {
    const base = recordingStore();
    let held: Crawl | null = null;
    return {
      ...base,
      async finish(id, completion) {
        held = await base.finish(id, completion);
        return held;
      },
      async getById(id) {
        return held !== null && held.id === id ? held : null;
      },
    };
  }

  test("getCrawlFindings answers the recorded report for the project's own crawl, and reads the store for that project and crawl only", async () => {
    const stored: StoredCrawlFindingsReport = { header: { id: "rep-1", crawlId: "crawl-1", projectId: "nexra-agency", ruleVersion: 1, coverage: { pagesTotal: 1, pagesFetched: 1, pagesNotFetched: 0, pagesNotReached: 0 }, linksRead: 0, linksCut: false, findingsTotal: 0, counts: {}, truncatedRules: [], recordedAt: "2026-09-20T00:01:01.000Z" }, findings: [], findingsTruncated: false };
    const findings = findingsStore({ report: stored });
    const store = storeHoldingFinished();
    const service = createCrawlService({ store, projects: projectsWith(PROJECT), config: CONFIG, findings: findings.store, engine: engineReturning({ pages: [crawledPage("/")], pagesFetched: 1 }) });
    const started = await service.startCrawl("nexra-agency", "op-1");
    assert.ok(started.ok);

    const read = await service.getCrawlFindings("nexra-agency", started.crawl.id);
    assert.equal(read.status, "recorded");
    assert.ok(read.status === "recorded");
    assert.equal(read.report, stored);
    assert.equal(read.crawl.id, started.crawl.id);
    assert.deepEqual(findings.reads, [["nexra-agency", started.crawl.id]]);
  });

  test("getCrawlFindings (T4): another project's crawl and an unknown crawl are not-found before the store is asked; nothing recorded is not-recorded with the crawl's status; no store is unavailable", async () => {
    const findings = findingsStore({ report: null });
    const store = storeHoldingFinished();
    const service = createCrawlService({ store, projects: projectsWith(PROJECT), config: CONFIG, findings: findings.store, engine: engineReturning({ pages: [crawledPage("/")], pagesFetched: 1 }) });
    const started = await service.startCrawl("nexra-agency", "op-1");
    assert.ok(started.ok);

    assert.deepEqual(await service.getCrawlFindings("other-project", started.crawl.id), { status: "not-found" });
    assert.deepEqual(await service.getCrawlFindings("nexra-agency", "00000000-0000-4000-8000-000000000000"), { status: "not-found" });
    assert.deepEqual(findings.reads, [], "the store is never asked for a crawl that is not the project's");

    const read = await service.getCrawlFindings("nexra-agency", started.crawl.id);
    assert.equal(read.status, "not-recorded");
    assert.ok(read.status === "not-recorded");
    assert.equal(read.crawl.status, started.crawl.status);
    assert.deepEqual(findings.reads, [["nexra-agency", started.crawl.id]]);

    assert.deepEqual(await createCrawlService({ store, projects: projectsWith(PROJECT), config: CONFIG }).getCrawlFindings("nexra-agency", started.crawl.id), { status: "unavailable" });
  });
});
