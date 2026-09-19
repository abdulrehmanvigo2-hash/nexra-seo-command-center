import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { unavailableCrawlStore, type CrawlStore } from "@/lib/crawl/contract";
import { createCrawlService, siteForProject } from "@/lib/crawl/service";
import type { Crawl, CrawlFailureCode, SitemapDiscovery } from "@/types/crawl";
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
        (crawl.status === "queued" || crawl.status === "discovering"),
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
    async fail(id, code: CrawlFailureCode) {
      const crawl = crawls.get(id);
      if (!crawl || crawl.status !== "discovering") return null;
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
  project?: ProjectRecord | null;
  discover?: (site: string) => Promise<SitemapDiscovery>;
} = {}) {
  const { store } = options.store ? { store: options.store } : memoryStore();
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
    service: createCrawlService({
      store,
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
    assert.equal(result.crawl.status, "completed");
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
    assert.equal(result.ok && result.crawl.status, "completed");
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
    assert.equal(settled.ok && settled.crawl.status, "completed");

    // Exactly one crawl exists for the project.
    assert.equal((await store.listForProject("nexra-agency")).length, 1);
  });

  test("a new pass may start once the previous one has finished", async () => {
    const { service: crawls, store } = service();
    await crawls.startDiscovery("operator-1", "nexra-agency");
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
    assert.equal(result.crawl.status, "completed");
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
