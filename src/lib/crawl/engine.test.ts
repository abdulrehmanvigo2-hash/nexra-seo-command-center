import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { runCrawl, type CrawledPage } from "./engine.ts";
import type { Fetch } from "./fetcher.ts";
import type { AddressResolver } from "./network-guard.ts";

/**
 * An in-memory site. No network, no DNS, no clock — so a whole crawl runs in
 * a millisecond and the crawler is never pointed at anybody's real server.
 */
type Route = {
  readonly status?: number;
  readonly type?: string;
  readonly body?: string;
  readonly location?: string;
  readonly fail?: "timeout" | "connection";
};

const PUBLIC_RESOLVER: AddressResolver = async () => [{ address: "93.184.216.34", family: 4 }];

function siteFetch(routes: Readonly<Record<string, Route>>): Fetch {
  return async (input) => {
    const route = routes[input];
    if (route === undefined) {
      return new Response("nope", { status: 404, headers: { "content-type": "text/html" } });
    }
    if (route.fail === "timeout") {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    }
    if (route.fail === "connection") throw new Error("socket hang up");

    const headers: Record<string, string> = { "content-type": route.type ?? "text/html" };
    if (route.location !== undefined) headers.location = route.location;
    return new Response(route.body ?? "", { status: route.status ?? 200, headers });
  };
}

function page(pages: readonly CrawledPage[], url: string): CrawledPage {
  const found = pages.find((entry) => entry.url === url);
  assert.ok(found, `expected a page record for ${url}`);
  return found;
}

const BUDGET = { maxPages: 50, maxDepth: 3, maxDurationMs: 60_000 };

function crawl(routes: Readonly<Record<string, Route>>, overrides: Record<string, unknown> = {}) {
  return runCrawl({
    startUrl: "https://example.com/",
    hostScope: "example.com",
    userAgent: "NexraBot/0.1",
    budget: BUDGET,
    concurrency: 2,
    fetch: siteFetch(routes),
    resolve: PUBLIC_RESOLVER,
    sleep: async () => {},
    ...overrides,
  });
}

const ROBOTS_ALLOW_ALL: Route = { type: "text/plain", body: "User-agent: *\nDisallow:" };

describe("runCrawl", () => {
  test("walks a small site breadth-first and records depth", async () => {
    const result = await crawl({
      "https://example.com/robots.txt": ROBOTS_ALLOW_ALL,
      "https://example.com/sitemap.xml": { status: 404, type: "application/xml" },
      "https://example.com/": { body: `<a href="/a">a</a><a href="/b">b</a>` },
      "https://example.com/a": { body: `<a href="/c">c</a>` },
      "https://example.com/b": { body: `<a href="/c">c</a>` },
      "https://example.com/c": { body: `<h1>C</h1>` },
    });

    assert.equal(result.stopReason, "completed");
    assert.equal(result.pagesFetched, 4);
    assert.equal(page(result.pages, "https://example.com/").depth, 0);
    assert.equal(page(result.pages, "https://example.com/a").depth, 1);
    // Reached from both /a and /b: breadth-first gives it the shortest
    // distance, not the first one found.
    assert.equal(page(result.pages, "https://example.com/c").depth, 2);
    assert.equal(page(result.pages, "https://example.com/c").internalLinksIn, 2);
  });

  test("fetches each URL once however many links point at it", async () => {
    let fetches = 0;
    const routes = {
      "https://example.com/robots.txt": ROBOTS_ALLOW_ALL,
      "https://example.com/sitemap.xml": { status: 404, type: "application/xml" },
      "https://example.com/": { body: `<a href="/dup">1</a><a href="/dup?utm_source=x">2</a><a href="/dup#frag">3</a>` },
      "https://example.com/dup": { body: "<h1>once</h1>" },
    } satisfies Record<string, Route>;

    const counted: Fetch = async (input, init) => {
      if (input === "https://example.com/dup") fetches += 1;
      return siteFetch(routes)(input, init);
    };

    const result = await crawl(routes, { fetch: counted });
    assert.equal(fetches, 1);
    assert.equal(result.pages.filter((entry) => entry.url.includes("/dup")).length, 1);
  });

  test("obeys robots.txt and records the refusal", async () => {
    const result = await crawl({
      "https://example.com/robots.txt": {
        type: "text/plain",
        body: "User-agent: *\nDisallow: /private/",
      },
      "https://example.com/sitemap.xml": { status: 404, type: "application/xml" },
      "https://example.com/": { body: `<a href="/private/x">p</a><a href="/ok">o</a>` },
      "https://example.com/ok": { body: "<h1>ok</h1>" },
      "https://example.com/private/x": { body: "<h1>should never be fetched</h1>" },
    });

    const blocked = page(result.pages, "https://example.com/private/x");
    assert.equal(blocked.fetchState, "blocked-by-robots");
    assert.equal(blocked.robotsTxtAllowed, false);
    assert.equal(blocked.httpStatus, null, "a page we never fetched has no status");
    assert.equal(blocked.title, null);
  });

  test("a robots.txt that could not be read leaves permission unknown, not granted", async () => {
    const result = await crawl({
      "https://example.com/robots.txt": { fail: "connection" },
      "https://example.com/sitemap.xml": { status: 404, type: "application/xml" },
      "https://example.com/": { body: "<h1>home</h1>" },
    });
    assert.equal(result.robotsState, "unavailable");
    assert.equal(page(result.pages, "https://example.com/").robotsTxtAllowed, null);
  });

  test("refuses to start when robots.txt disallows the start URL", async () => {
    const result = await crawl({
      "https://example.com/robots.txt": { type: "text/plain", body: "User-agent: *\nDisallow: /" },
      "https://example.com/": { body: "<h1>home</h1>" },
    });
    assert.equal(result.startFailure, "blocked-by-robots");
    assert.equal(result.stopReason, "error");
    assert.equal(result.pages.length, 0);
  });

  test("stops on the page budget and marks what it never reached", async () => {
    const routes: Record<string, Route> = {
      "https://example.com/robots.txt": ROBOTS_ALLOW_ALL,
      "https://example.com/sitemap.xml": { status: 404, type: "application/xml" },
      "https://example.com/": {
        body: Array.from({ length: 10 }, (_, index) => `<a href="/p${index}">p</a>`).join(""),
      },
    };
    for (let index = 0; index < 10; index += 1) {
      routes[`https://example.com/p${index}`] = { body: "<h1>p</h1>" };
    }

    const result = await crawl(routes, { budget: { ...BUDGET, maxPages: 4 } });
    assert.equal(result.stopReason, "page-budget");
    assert.equal(result.pagesFetched, 4);

    const skipped = result.pages.filter((entry) => entry.fetchState === "budget-skipped");
    assert.ok(skipped.length > 0, "URLs we never reached must be recorded, not omitted");
    assert.equal(skipped[0].httpStatus, null);
    assert.equal(skipped[0].fetchedAt, null);
  });

  test("stops on the time budget", async () => {
    let clock = 0;
    const result = await crawl(
      {
        "https://example.com/robots.txt": ROBOTS_ALLOW_ALL,
        "https://example.com/sitemap.xml": { status: 404, type: "application/xml" },
        "https://example.com/": { body: `<a href="/a">a</a><a href="/b">b</a>` },
        "https://example.com/a": { body: `<a href="/c">c</a>` },
        "https://example.com/b": { body: "<h1>b</h1>" },
        "https://example.com/c": { body: "<h1>c</h1>" },
      },
      {
        // Every reading advances the clock; the budget runs out mid-walk.
        now: () => {
          clock += 400;
          return clock;
        },
        budget: { ...BUDGET, maxDurationMs: 1_000 },
      },
    );
    assert.equal(result.stopReason, "time-budget");
  });

  test("does not follow a link off the host, but records it", async () => {
    const result = await crawl({
      "https://example.com/robots.txt": ROBOTS_ALLOW_ALL,
      "https://example.com/sitemap.xml": { status: 404, type: "application/xml" },
      "https://example.com/": { body: `<a href="https://elsewhere.example.net/x">out</a>` },
    });

    assert.equal(result.pages.length, 1, "an external URL is never a page of this crawl");
    const external = result.links.find((link) => link.toUrl.includes("elsewhere"));
    assert.ok(external);
    assert.equal(external.isInternal, false);
  });

  test("a subdomain is in scope but a look-alike host is not", async () => {
    const result = await crawl({
      "https://example.com/robots.txt": ROBOTS_ALLOW_ALL,
      "https://example.com/sitemap.xml": { status: 404, type: "application/xml" },
      "https://example.com/": {
        body: `<a href="https://blog.example.com/p">in</a><a href="https://evil-example.com/p">out</a>`,
      },
      "https://blog.example.com/robots.txt": ROBOTS_ALLOW_ALL,
      "https://blog.example.com/p": { body: "<h1>blog</h1>" },
    });

    assert.ok(result.pages.some((entry) => entry.url === "https://blog.example.com/p"));
    assert.ok(!result.pages.some((entry) => entry.url.includes("evil-example.com")));
  });

  test("follows a redirect and records the chain", async () => {
    const result = await crawl({
      "https://example.com/robots.txt": ROBOTS_ALLOW_ALL,
      "https://example.com/sitemap.xml": { status: 404, type: "application/xml" },
      "https://example.com/": { body: `<a href="/old">old</a>` },
      "https://example.com/old": { status: 301, location: "/new" },
      "https://example.com/new": { body: "<h1>new</h1>" },
    });

    const redirected = page(result.pages, "https://example.com/old");
    assert.equal(redirected.fetchState, "fetched");
    assert.equal(redirected.finalUrl, "https://example.com/new");
    assert.equal(redirected.redirectHops, 1);
    assert.deepEqual(redirected.redirectChain, ["https://example.com/old"]);
  });

  test("abandons a redirect loop", async () => {
    const result = await crawl({
      "https://example.com/robots.txt": ROBOTS_ALLOW_ALL,
      "https://example.com/sitemap.xml": { status: 404, type: "application/xml" },
      "https://example.com/": { body: `<a href="/loop">loop</a>` },
      "https://example.com/loop": { status: 302, location: "/loop2" },
      "https://example.com/loop2": { status: 302, location: "/loop" },
    });
    assert.equal(page(result.pages, "https://example.com/loop").fetchState, "redirect-loop");
  });

  test("records failure states without inventing readings", async () => {
    const result = await crawl({
      "https://example.com/robots.txt": ROBOTS_ALLOW_ALL,
      "https://example.com/sitemap.xml": { status: 404, type: "application/xml" },
      "https://example.com/": {
        body: `<a href="/gone">g</a><a href="/slow">s</a><a href="/down">d</a><a href="/doc.pdf">p</a>`,
      },
      "https://example.com/gone": { status: 404 },
      "https://example.com/slow": { fail: "timeout" },
      "https://example.com/down": { fail: "connection" },
      "https://example.com/doc.pdf": { type: "application/pdf", body: "%PDF" },
    });

    assert.equal(page(result.pages, "https://example.com/gone").fetchState, "http-error");
    assert.equal(page(result.pages, "https://example.com/gone").httpStatus, 404);
    assert.equal(page(result.pages, "https://example.com/slow").fetchState, "timeout");
    assert.equal(page(result.pages, "https://example.com/down").fetchState, "connection-error");

    const pdf = page(result.pages, "https://example.com/doc.pdf");
    assert.equal(pdf.fetchState, "non-html");
    assert.equal(pdf.title, null, "nothing is extracted from a document we did not parse");

    for (const url of ["https://example.com/slow", "https://example.com/down"]) {
      assert.equal(page(result.pages, url).httpStatus, null);
      assert.equal(page(result.pages, url).title, null);
    }
  });

  test("refuses a host that resolves to a private address", async () => {
    const result = await crawl(
      {
        "https://example.com/robots.txt": ROBOTS_ALLOW_ALL,
        "https://example.com/sitemap.xml": { status: 404, type: "application/xml" },
        "https://example.com/": { body: `<a href="https://internal.example.com/">in</a>` },
        "https://internal.example.com/": { body: "<h1>secret</h1>" },
      },
      {
        resolve: (async (hostname: string) =>
          hostname === "internal.example.com"
            ? [{ address: "10.0.0.5", family: 4 as const }]
            : [{ address: "93.184.216.34", family: 4 as const }]) satisfies AddressResolver,
      },
    );

    const refused = page(result.pages, "https://internal.example.com/");
    assert.equal(refused.fetchState, "refused-unsafe");
    assert.equal(refused.title, null);
  });

  test("reads sitemap membership, and leaves it unknown when there is no sitemap", async () => {
    const withSitemap = await crawl({
      "https://example.com/robots.txt": ROBOTS_ALLOW_ALL,
      "https://example.com/sitemap.xml": {
        type: "application/xml",
        body: `<urlset><url><loc>https://example.com/</loc></url></urlset>`,
      },
      "https://example.com/": { body: `<a href="/unlisted">u</a>` },
      "https://example.com/unlisted": { body: "<h1>u</h1>" },
    });
    assert.equal(withSitemap.sitemapState, "fetched");
    assert.equal(page(withSitemap.pages, "https://example.com/").inSitemap, true);
    assert.equal(page(withSitemap.pages, "https://example.com/unlisted").inSitemap, false);

    const noSitemap = await crawl({
      "https://example.com/robots.txt": ROBOTS_ALLOW_ALL,
      "https://example.com/sitemap.xml": { fail: "connection" },
      "https://example.com/": { body: "<h1>home</h1>" },
    });
    assert.equal(noSitemap.sitemapState, "unavailable");
    assert.equal(
      page(noSitemap.pages, "https://example.com/").inSitemap,
      null,
      "unknown membership must stay null, never false",
    );
  });

  test("resolves a canonical and says whether it is self-referential", async () => {
    const result = await crawl({
      "https://example.com/robots.txt": ROBOTS_ALLOW_ALL,
      "https://example.com/sitemap.xml": { status: 404, type: "application/xml" },
      "https://example.com/": {
        body: `<link rel="canonical" href="/"><a href="/dupe">d</a>`,
      },
      "https://example.com/dupe": { body: `<link rel="canonical" href="https://example.com/">` },
    });

    assert.equal(page(result.pages, "https://example.com/").canonicalIsSelf, true);
    const dupe = page(result.pages, "https://example.com/dupe");
    assert.equal(dupe.canonicalResolved, "https://example.com/");
    assert.equal(dupe.canonicalIsSelf, false);
  });

  test("a page with no canonical reports unknown, not false", async () => {
    const result = await crawl({
      "https://example.com/robots.txt": ROBOTS_ALLOW_ALL,
      "https://example.com/sitemap.xml": { status: 404, type: "application/xml" },
      "https://example.com/": { body: "<h1>no canonical here</h1>" },
    });
    const home = page(result.pages, "https://example.com/");
    assert.equal(home.canonicalHref, null);
    assert.equal(home.canonicalIsSelf, null);
  });

  test("does not follow links from a page that says nofollow", async () => {
    const result = await crawl({
      "https://example.com/robots.txt": ROBOTS_ALLOW_ALL,
      "https://example.com/sitemap.xml": { status: 404, type: "application/xml" },
      "https://example.com/": {
        body: `<meta name="robots" content="noindex,nofollow"><a href="/hidden">h</a>`,
      },
      "https://example.com/hidden": { body: "<h1>hidden</h1>" },
    });
    assert.equal(result.pages.length, 1);
    assert.equal(page(result.pages, "https://example.com/").robotsMeta, "noindex,nofollow");
  });

  test("honours depth as a stopping rule", async () => {
    const result = await crawl(
      {
        "https://example.com/robots.txt": ROBOTS_ALLOW_ALL,
        "https://example.com/sitemap.xml": { status: 404, type: "application/xml" },
        "https://example.com/": { body: `<a href="/one">1</a>` },
        "https://example.com/one": { body: `<a href="/two">2</a>` },
        "https://example.com/two": { body: `<a href="/three">3</a>` },
        "https://example.com/three": { body: "<h1>3</h1>" },
      },
      { budget: { ...BUDGET, maxDepth: 1 } },
    );

    assert.ok(result.pages.some((entry) => entry.url === "https://example.com/one"));
    assert.ok(
      !result.pages.some((entry) => entry.url === "https://example.com/two"),
      "a URL past the depth limit is never queued",
    );
  });

  test("stores no indexation or vitals reading anywhere", async () => {
    const result = await crawl({
      "https://example.com/robots.txt": ROBOTS_ALLOW_ALL,
      "https://example.com/sitemap.xml": { status: 404, type: "application/xml" },
      "https://example.com/": { body: "<h1>home</h1>" },
    });
    const keys = Object.keys(page(result.pages, "https://example.com/"));
    for (const forbidden of ["indexStatus", "indexed", "coverageState", "lcp", "inp", "cls", "vitals"]) {
      assert.ok(!keys.includes(forbidden), `${forbidden} must not exist on a crawl reading`);
    }
  });
});
