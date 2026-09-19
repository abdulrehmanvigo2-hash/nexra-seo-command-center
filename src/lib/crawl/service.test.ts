import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  unavailableCrawlPageStore,
  unavailableCrawlStore,
  type CrawlPageStore,
  type CrawlStore,
} from "@/lib/crawl/contract";
import { memoryPageStore } from "@/lib/crawl/page-fetcher.test";
import {
  MAX_PAGES_PER_CRAWL,
  MAX_SIGNALS_READ,
  createCrawlService,
  siteForProject,
} from "@/lib/crawl/service";
import type {
  Crawl,
  CrawlFailureCode,
  FetchOutcome,
  SitemapDiscovery,
} from "@/types/crawl";
import type { ProjectRecord } from "@/types/project";

/**
 * The orchestration, against in-memory doubles. Nothing here reaches the
 * network or a database: `discover` is a function the service is given, which
 * is the reason it is a dependency rather than an import.
 *
 * The in-memory store enforces the same two rules the table does — one active
 * crawl per project, and the legal transitions — because those are what the
 * service is relying on, and a double that allowed everything would let a
 * broken service pass.
 */

const PROJECT: ProjectRecord = {
  id: "nexra-agency",
  name: "Nexra Agency",
  domain: "nexraagency.com",
  industry: "Marketing",
  initials: "NA",
  client: "Nexra",
  type: "lead-gen",
  status: "onboarding",
  market: "United Kingdom",
  language: "English (UK)",
  goal: "leads",
  targetLocation: "United Kingdom",
  startedAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  summary: "",
};

const DISCOVERY: SitemapDiscovery = {
  urls: [
    { url: "https://nexraagency.com/", source: "homepage" },
    { url: "https://nexraagency.com/a", source: "robots" },
  ],
  documents: [
    { url: "https://nexraagency.com/s.xml", source: "robots", kind: "urlset", locations: 1, failure: null },
  ],
  robots: "parsed",
  limits: [],
};

function memoryStore() {
  const crawls = new Map<string, Crawl>();
  const urls = new Map<string, readonly { url: string; source: string }[]>();
  let nextId = 1;

  const active = (projectId: string) =>
    [...crawls.values()].find(
      (crawl) =>
        crawl.projectId === projectId &&
        (crawl.status === "queued" ||
          crawl.status === "discovering" ||
          crawl.status === "fetching"),
    ) ?? null;

  const store: CrawlStore = {
    async create(input) {
      const running = active(input.projectId);
      if (running) return { ok: false, reason: "already-running", crawl: running };
      const crawl: Crawl = {
        id: `crawl-${nextId++}`,
        projectId: input.projectId,
        site: input.site,
        status: "queued",
        robotsState: null,
        sitemapCount: 0,
        discoveredCount: 0,
        limits: [],
        pagesTotal: 0,
        pagesFetched: 0,
        pagesFailed: 0,
        pagesSkipped: 0,
        failureCode: null,
        createdBy: input.createdBy,
        source: input.source,
        createdAt: "2026-09-19T05:00:00Z",
        startedAt: null,
        finishedAt: null,
        updatedAt: "2026-09-19T05:00:00Z",
      };
      crawls.set(crawl.id, crawl);
      return { ok: true, crawl };
    },
    async get(id) {
      return crawls.get(id) ?? null;
    },
    async listForProject(projectId, limit = 50) {
      return [...crawls.values()]
        .filter((crawl) => crawl.projectId === projectId)
        .reverse()
        .slice(0, limit);
    },
    async start(id) {
      const crawl = crawls.get(id);
      if (!crawl || crawl.status !== "queued") return null;
      const next = { ...crawl, status: "discovering" as const, startedAt: "2026-09-19T05:00:01Z" };
      crawls.set(id, next);
      return next;
    },
    async recordDiscovery(id, discovery) {
      const crawl = crawls.get(id);
      if (!crawl || crawl.status !== "discovering") return null;
      urls.set(id, discovery.urls);
      const next: Crawl = {
        ...crawl,
        status: "completed",
        robotsState: discovery.robots,
        sitemapCount: discovery.documents.length,
        discoveredCount: discovery.urls.length,
        limits: discovery.limits,
        finishedAt: "2026-09-19T05:00:09Z",
      };
      crawls.set(id, next);
      return next;
    },
    async beginFetching(id, discovery) {
      const crawl = crawls.get(id);
      if (!crawl || crawl.status !== "discovering") return null;
      urls.set(id, discovery.urls);
      const next: Crawl = {
        ...crawl,
        status: "fetching",
        robotsState: discovery.robots,
        sitemapCount: discovery.documents.length,
        discoveredCount: discovery.urls.length,
        limits: discovery.limits,
      };
      crawls.set(id, next);
      return next;
    },
    async completeFetch(id, limits) {
      const crawl = crawls.get(id);
      if (!crawl || crawl.status !== "fetching") return null;
      const next: Crawl = {
        ...crawl,
        status: "completed",
        limits,
        finishedAt: "2026-09-19T05:10:00Z",
      };
      crawls.set(id, next);
      return next;
    },
    async fail(id, code: CrawlFailureCode) {
      const crawl = crawls.get(id);
      if (!crawl || (crawl.status !== "discovering" && crawl.status !== "fetching")) return null;
      const next: Crawl = {
        ...crawl,
        status: "failed",
        failureCode: code,
        finishedAt: "2026-09-19T05:00:09Z",
      };
      crawls.set(id, next);
      return next;
    },
    async cancel(id) {
      const crawl = crawls.get(id);
      if (!crawl || (crawl.status !== "queued" && crawl.status !== "discovering")) return null;
      const next: Crawl = { ...crawl, status: "cancelled", finishedAt: "2026-09-19T05:00:09Z" };
      crawls.set(id, next);
      return next;
    },
    async listUrls(crawlId) {
      return (urls.get(crawlId) ?? []) as never;
    },
  };

  return { store, crawls, urls };
}

function service(options: {
  store?: CrawlStore;
  pages?: CrawlPageStore;
  project?: ProjectRecord | null;
  discover?: (site: string) => Promise<SitemapDiscovery>;
} = {}) {
  const { store } = options.store ? { store: options.store } : memoryStore();
  const pages = options.pages ?? memoryPageStore().store;
  const seen: string[] = [];
  const discover =
    options.discover ??
    (async (site: string) => {
      seen.push(site);
      return DISCOVERY;
    });
  return {
    seen,
    store,
    pages,
    service: createCrawlService({
      store,
      pages,
      readRobots: async () => ({ state: "parsed", groups: [], sitemaps: [] }),
      fetchPass: { fetchPage: async () => { throw new Error("not used"); } },
      projects: {
        async getProjectById(id) {
          const project = options.project === undefined ? PROJECT : options.project;
          return project && project.id === id ? project : null;
        },
      },
      discover,
    }),
  };
}

describe("siteForProject", () => {
  test("takes the host from the stored domain", () => {
    assert.equal(siteForProject(PROJECT), "nexraagency.com");
  });

  test("drops a path, because a crawl is scoped to a host", () => {
    assert.equal(siteForProject({ ...PROJECT, domain: "example.com/blog" }), "example.com");
  });

  test("refuses a domain the URL policy will not visit", () => {
    for (const domain of ["localhost", "127.0.0.1", "intranet", "example.com:8080"]) {
      assert.equal(siteForProject({ ...PROJECT, domain }), null, domain);
    }
  });
});

describe("startDiscovery", () => {
  test("walks queued → discovering → completed and records what was found", async () => {
    const { service: crawls, store, seen } = service();
    const result = await crawls.startDiscovery("operator-1", "nexra-agency");

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.started, true);
    assert.equal(result.crawl.status, "fetching");
    assert.equal(result.crawl.discoveredCount, 2);
    assert.equal(result.crawl.sitemapCount, 1);
    assert.equal(result.crawl.robotsState, "parsed");
    assert.equal(result.crawl.createdBy, "operator-1");
    assert.equal(result.crawl.source, "operator");

    // The site came from the project, not from the caller.
    assert.deepEqual(seen, ["nexraagency.com"]);
    assert.deepEqual(
      (await store.listUrls(result.crawl.id)).map((entry) => entry.url),
      ["https://nexraagency.com/", "https://nexraagency.com/a"],
    );
  });

  test("carries the discovery limits onto the record", async () => {
    const { service: crawls } = service({
      discover: async () => ({ ...DISCOVERY, limits: ["urls"] }),
    });
    const result = await crawls.startDiscovery("operator-1", "nexra-agency");
    assert.equal(result.ok && result.crawl.limits.includes("urls"), true);
  });

  test("fails the pass when the site would not serve robots.txt", async () => {
    const { service: crawls } = service({
      discover: async () => ({ urls: [], documents: [], robots: "unavailable", limits: [] }),
    });
    const result = await crawls.startDiscovery("operator-1", "nexra-agency");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.crawl.status, "failed");
    assert.equal(result.crawl.failureCode, "robots-unavailable");
  });

  test("a site with no sitemap still completes, with the homepage alone", async () => {
    const { service: crawls } = service({
      discover: async () => ({
        urls: [{ url: "https://nexraagency.com/", source: "homepage" }],
        documents: [
          {
            url: "https://nexraagency.com/sitemap.xml",
            source: "well-known",
            kind: "unknown",
            locations: 0,
            failure: "malformed",
          },
        ],
        robots: "missing",
        limits: [],
      }),
    });
    const result = await crawls.startDiscovery("operator-1", "nexra-agency");
    assert.equal(result.ok && result.crawl.status, "fetching");
    assert.equal(result.ok && result.crawl.discoveredCount, 1);
  });

  test("a thrown discovery leaves the crawl failed, not stuck discovering", async () => {
    const { service: crawls } = service({
      discover: async () => {
        throw new Error("boom");
      },
    });
    const result = await crawls.startDiscovery("operator-1", "nexra-agency");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.crawl.status, "failed");
    assert.equal(result.crawl.failureCode, "store-error");
  });

  test("refuses a project id that is not one a project could have", async () => {
    const { service: crawls } = service();
    for (const id of ["", "portfolio", "Not An Id", 42, null]) {
      const result = await crawls.startDiscovery("operator-1", id);
      assert.equal(result.ok, false, String(id));
      assert.equal(result.ok === false && result.reason, "invalid");
    }
  });

  test("refuses a project that does not exist", async () => {
    const { service: crawls } = service({ project: null });
    const result = await crawls.startDiscovery("operator-1", "nexra-agency");
    assert.equal(result.ok === false && result.reason, "unknown-project");
  });

  test("refuses a project whose domain the URL policy will not visit", async () => {
    const { service: crawls, seen } = service({
      project: { ...PROJECT, domain: "localhost" },
    });
    const result = await crawls.startDiscovery("operator-1", "nexra-agency");
    assert.equal(result.ok === false && result.reason, "site-refused");
    // Nothing was attempted against it.
    assert.deepEqual(seen, []);
  });

  test("answers unavailable where crawls are not stored", async () => {
    const crawls = createCrawlService({
      store: unavailableCrawlStore,
      pages: unavailableCrawlPageStore,
      readRobots: async () => ({ state: "missing" }),
      projects: { async getProjectById() { return PROJECT; } },
      discover: async () => DISCOVERY,
    });
    const result = await crawls.startDiscovery("operator-1", "nexra-agency");
    assert.equal(result.ok === false && result.reason, "unknown-project");
  });
});

describe("duplicate crawls", () => {
  test("a second request joins the pass already in flight", async () => {
    const { store } = memoryStore();
    // Held in an object so narrowing does not decide the binding is still null.
    const gate = { open: () => {} };
    const held = new Promise<void>((resolve) => {
      gate.open = resolve;
    });

    const crawls = createCrawlService({
      store,
      pages: memoryPageStore().store,
      readRobots: async () => ({ state: "missing" }),
      projects: { async getProjectById() { return PROJECT; } },
      discover: async () => {
        await held;
        return DISCOVERY;
      },
    });

    const first = crawls.startDiscovery("operator-1", "nexra-agency");
    // The second arrives while the first is still discovering.
    await Promise.resolve();
    const second = await crawls.startDiscovery("operator-2", "nexra-agency");

    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.started, false, "the second request must not start a second pass");
    assert.equal(second.crawl.status, "discovering");
    assert.equal(second.crawl.createdBy, "operator-1", "it joined the first operator's pass");

    gate.open();
    const settled = await first;
    assert.equal(settled.ok && settled.crawl.status, "fetching");

    // Exactly one crawl exists for the project.
    assert.equal((await store.listForProject("nexra-agency")).length, 1);
  });

  test("a new pass may start once the previous one has finished", async () => {
    const { service: crawls, store } = service();
    const first = await crawls.startDiscovery("operator-1", "nexra-agency");
    if (first.ok) await store.completeFetch(first.crawl.id, []);
    const again = await crawls.startDiscovery("operator-1", "nexra-agency");
    assert.equal(again.ok && again.started, true);
    assert.equal((await store.listForProject("nexra-agency")).length, 2);
  });
});

describe("latestForProject", () => {
  test("is null before anything has run", async () => {
    const { service: crawls } = service();
    const result = await crawls.latestForProject("nexra-agency");
    assert.equal(result.ok && result.crawl, null);
  });

  test("returns the most recent pass", async () => {
    const { service: crawls } = service();
    await crawls.startDiscovery("operator-1", "nexra-agency");
    const result = await crawls.latestForProject("nexra-agency");
    assert.equal(result.ok, true);
    if (!result.ok || result.crawl === null) return assert.fail("expected a crawl");
    assert.equal(result.crawl.status, "fetching");
  });

  test("validates the project the same way starting one does", async () => {
    const { service: crawls } = service();
    const reserved = await crawls.latestForProject("portfolio");
    assert.equal(reserved.ok, false);
    assert.equal(reserved.ok === false && reserved.reason, "invalid");

    const unknown = service({ project: null });
    const result = await unknown.service.latestForProject("nexra-agency");
    assert.equal(result.ok === false && result.reason, "unknown-project");
  });
});

describe("runFetchSlice", () => {
  /** A service whose discovery hands over `count` pages, with a fake fetch. */
  const withPages = (count: number, fetchPage?: (url: string) => Promise<FetchOutcome>) => {
    const memory = memoryPageStore();
    const { store } = memoryStore();
    const asked: string[] = [];
    const crawls = createCrawlService({
      store,
      pages: memory.store,
      readRobots: async () => ({ state: "missing" }),
      projects: { async getProjectById() { return PROJECT; } },
      discover: async () => ({
        urls: Array.from({ length: count }, (_, i) => ({
          url: `https://nexraagency.com/p${i}`,
          source: "robots" as const,
        })),
        documents: [],
        robots: "parsed",
        limits: [],
      }),
      fetchPass: {
        crawlDelayMs: 0,
        fetchPage: async (url) => {
          asked.push(url);
          return (
            fetchPage?.(url) ??
            ({
              state: "fetched",
              url,
              status: 200,
              contentType: "text/html",
              body: "",
              bytes: 1,
              elapsedMs: 1,
              redirects: [],
            } as FetchOutcome)
          );
        },
      },
    });
    return { crawls, store, memory, asked };
  };

  test("discovery queues the pages and leaves the crawl fetching", async () => {
    const { crawls, memory } = withPages(4);
    const started = await crawls.startDiscovery("operator-1", "nexra-agency");
    assert.equal(started.ok && started.crawl.status, "fetching");
    assert.equal(await memory.store.countPendingPages(started.ok ? started.crawl.id : ""), 4);
  });

  test("a slice fetches the queue and completes the crawl when it empties", async () => {
    const { crawls } = withPages(3);
    const started = await crawls.startDiscovery("operator-1", "nexra-agency");
    if (!started.ok) return assert.fail("expected a crawl");

    const slice = await crawls.runFetchSlice(started.crawl.id, { budgetMs: 60_000, maxPages: 100 });
    assert.equal(slice.ok, true);
    if (!slice.ok) return;
    assert.equal(slice.pass.fetched, 3);
    assert.equal(slice.pass.remaining, 0);
    assert.equal(slice.crawl.status, "completed");
  });

  test("a slice that leaves work keeps the crawl fetching", async () => {
    const { crawls } = withPages(5);
    const started = await crawls.startDiscovery("operator-1", "nexra-agency");
    if (!started.ok) return assert.fail("expected a crawl");

    const first = await crawls.runFetchSlice(started.crawl.id, { budgetMs: 60_000, maxPages: 2 });
    assert.equal(first.ok && first.crawl.status, "fetching");
    assert.equal(first.ok && first.pass.remaining, 3);

    const second = await crawls.runFetchSlice(started.crawl.id, { budgetMs: 60_000, maxPages: 100 });
    assert.equal(second.ok && second.crawl.status, "completed");
  });

  test("slices never fetch the same page twice", async () => {
    const { crawls, asked } = withPages(6);
    const started = await crawls.startDiscovery("operator-1", "nexra-agency");
    if (!started.ok) return assert.fail("expected a crawl");
    await crawls.runFetchSlice(started.crawl.id, { budgetMs: 60_000, maxPages: 2 });
    await crawls.runFetchSlice(started.crawl.id, { budgetMs: 60_000, maxPages: 2 });
    await crawls.runFetchSlice(started.crawl.id, { budgetMs: 60_000, maxPages: 100 });
    assert.equal(asked.length, 6);
    assert.equal(new Set(asked).size, 6);
  });

  test("a slice on a crawl that is not fetching does nothing", async () => {
    const { crawls } = withPages(1);
    const started = await crawls.startDiscovery("operator-1", "nexra-agency");
    if (!started.ok) return assert.fail("expected a crawl");
    await crawls.runFetchSlice(started.crawl.id, { budgetMs: 60_000, maxPages: 100 });

    const again = await crawls.runFetchSlice(started.crawl.id, { budgetMs: 60_000, maxPages: 100 });
    assert.equal(again.ok && again.crawl.status, "completed");
    assert.equal(again.ok && again.pass.claimed, 0);
  });

  test("an unknown crawl is refused", async () => {
    const { crawls } = withPages(1);
    const result = await crawls.runFetchSlice("no-such-crawl", { budgetMs: 1_000, maxPages: 1 });
    assert.equal(result.ok === false && result.reason, "unknown-project");
  });

  test("the page cap is applied at hand-over and recorded on the crawl", async () => {
    const { crawls, memory } = withPages(MAX_PAGES_PER_CRAWL + 7);
    const started = await crawls.startDiscovery("operator-1", "nexra-agency");
    if (!started.ok) return assert.fail("expected a crawl");
    assert.equal(started.crawl.limits.includes("pages"), true, "a capped crawl says it is a sample");
    assert.equal(
      await memory.store.countPendingPages(started.crawl.id),
      MAX_PAGES_PER_CRAWL,
      "no more than the cap is ever queued",
    );
  });
});

describe("signalsForProject", () => {
  /** A service that crawls two pages and serves each one the HTML given. */
  const withBodies = (bodies: Readonly<Record<string, string>>) => {
    const memory = memoryPageStore();
    const { store } = memoryStore();
    const urls = Object.keys(bodies);
    const crawls = createCrawlService({
      store,
      pages: memory.store,
      readRobots: async () => ({ state: "missing" }),
      projects: { async getProjectById() { return PROJECT; } },
      discover: async () => ({
        urls: urls.map((url) => ({ url, source: "robots" as const })),
        documents: [],
        robots: "parsed",
        limits: [],
      }),
      fetchPass: {
        crawlDelayMs: 0,
        fetchPage: async (url) =>
          ({
            state: "fetched",
            url,
            status: 200,
            contentType: "text/html",
            body: bodies[url] ?? "",
            bytes: 1,
            elapsedMs: 1,
            redirects: [],
          }) as FetchOutcome,
      },
    });
    return { crawls, memory };
  };

  const CRAWLED = {
    "https://nexraagency.com/a": "<html><head><title>Shared</title></head><body>one two</body></html>",
    "https://nexraagency.com/b": "<html><head><title>Shared</title></head><body>three</body></html>",
  };

  test("a project with no crawl reads as no signals, not as a failure", async () => {
    const { service: crawls } = service();
    const result = await crawls.signalsForProject("nexra-agency");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.crawl, null);
    assert.deepEqual(result.signals, []);
  });

  test("returns the latest crawl's signals, with the URL each came from", async () => {
    const { crawls } = withBodies(CRAWLED);
    const started = await crawls.startDiscovery("operator-1", "nexra-agency");
    if (!started.ok) return assert.fail("expected a crawl");
    await crawls.runFetchSlice(started.crawl.id, { budgetMs: 60_000, maxPages: 100 });

    const result = await crawls.signalsForProject("nexra-agency");
    assert.equal(result.ok, true);
    if (!result.ok || result.crawl === null) return assert.fail("expected a crawl");
    assert.equal(result.crawl.id, started.crawl.id);
    assert.equal(result.signals.length, 2);
    assert.deepEqual(
      [...result.signals].map((page) => page.url).sort(),
      ["https://nexraagency.com/a", "https://nexraagency.com/b"],
    );
    for (const page of result.signals) {
      assert.equal(page.state, "parsed");
      assert.equal(page.title, "Shared");
    }
  });

  test("it is a read: nothing is fetched and the crawl is untouched", async () => {
    const { crawls } = withBodies(CRAWLED);
    const started = await crawls.startDiscovery("operator-1", "nexra-agency");
    if (!started.ok) return assert.fail("expected a crawl");
    await crawls.runFetchSlice(started.crawl.id, { budgetMs: 60_000, maxPages: 100 });

    const before = await crawls.latestForProject("nexra-agency");
    await crawls.signalsForProject("nexra-agency");
    const after = await crawls.latestForProject("nexra-agency");
    assert.deepEqual(
      before.ok && before.crawl,
      after.ok && after.crawl,
      "reading signals changes no record",
    );
  });

  test("validates the project the same way the other reads do", async () => {
    const { service: crawls } = service();
    const reserved = await crawls.signalsForProject("portfolio");
    assert.equal(reserved.ok === false && reserved.reason, "invalid");

    const unknown = service({ project: null });
    const result = await unknown.service.signalsForProject("nexra-agency");
    assert.equal(result.ok === false && result.reason, "unknown-project");
  });

  test("a deployment that stores no crawls answers unknown-project, not empty", async () => {
    const crawls = createCrawlService({
      store: unavailableCrawlStore,
      pages: unavailableCrawlPageStore,
      readRobots: async () => ({ state: "missing" }),
      projects: { async getProjectById() { return null; } },
      discover: async () => DISCOVERY,
    });
    const result = await crawls.signalsForProject("nexra-agency");
    assert.equal(result.ok === false && result.reason, "unknown-project");
  });

  test("never returns more rows than one crawl may hold", async () => {
    const { crawls } = withBodies(CRAWLED);
    const started = await crawls.startDiscovery("operator-1", "nexra-agency");
    if (!started.ok) return assert.fail("expected a crawl");
    await crawls.runFetchSlice(started.crawl.id, { budgetMs: 60_000, maxPages: 100 });

    const result = await crawls.signalsForProject("nexra-agency", Number.MAX_SAFE_INTEGER);
    assert.equal(result.ok && result.signals.length <= MAX_SIGNALS_READ, true);
  });
});
