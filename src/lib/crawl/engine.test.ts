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

    const counted: Fetch = async (input, init, pin) => {
      if (input === "https://example.com/dup") fetches += 1;
      return siteFetch(routes)(input, init, pin);
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

describe("per-hop pinning", () => {
  test("every redirect hop is resolved, validated and pinned on its own", async () => {
    /*
     * A redirect is an attacker-controlled way to reach an address nothing has
     * approved, so hop three must be pinned by hop three's own check — never
     * by hop zero's. Here each host resolves to a different address; the test
     * asserts each request carried the pin belonging to its own hostname.
     */
    const addresses: Readonly<Record<string, string>> = {
      "example.com": "93.184.216.34",
      "a.example.com": "93.184.216.35",
      "b.example.com": "93.184.216.36",
    };
    const resolve: AddressResolver = async (hostname) => {
      const address = addresses[hostname];
      if (address === undefined) throw new Error("ENOTFOUND");
      return [{ address, family: 4 as const }];
    };

    const routes: Record<string, Route> = {
      "https://example.com/robots.txt": ROBOTS_ALLOW_ALL,
      "https://example.com/sitemap.xml": { status: 404, type: "application/xml" },
      "https://example.com/": { body: `<a href="/hop">h</a>` },
      "https://example.com/hop": { status: 301, location: "https://a.example.com/next" },
      "https://a.example.com/next": { status: 302, location: "https://b.example.com/final" },
      "https://b.example.com/final": { body: "<h1>final</h1>" },
      "https://a.example.com/robots.txt": ROBOTS_ALLOW_ALL,
      "https://b.example.com/robots.txt": ROBOTS_ALLOW_ALL,
    };

    const pins: { url: string; pin: string }[] = [];
    const recording: Fetch = async (input, init, pin) => {
      pins.push({ url: input, pin: pin.address });
      return siteFetch(routes)(input, init, pin);
    };

    await crawl(routes, { fetch: recording, resolve });

    const hopPins = pins.filter((entry) => /\/(hop|next|final)$/.test(entry.url));
    assert.deepEqual(hopPins, [
      { url: "https://example.com/hop", pin: "93.184.216.34" },
      { url: "https://a.example.com/next", pin: "93.184.216.35" },
      { url: "https://b.example.com/final", pin: "93.184.216.36" },
    ]);
  });

  test("a hop that resolves to a private address is refused mid-chain", async () => {
    // Hop zero is fine; hop one points at the metadata endpoint. The chain
    // must stop there rather than inheriting hop zero's approval.
    const resolve: AddressResolver = async (hostname) =>
      hostname === "example.com"
        ? [{ address: "93.184.216.34", family: 4 as const }]
        : [{ address: "169.254.169.254", family: 4 as const }];

    const result = await crawl(
      {
        "https://example.com/robots.txt": ROBOTS_ALLOW_ALL,
        "https://example.com/sitemap.xml": { status: 404, type: "application/xml" },
        "https://example.com/": { body: `<a href="/bad">b</a>` },
        "https://example.com/bad": { status: 302, location: "https://inside.example.com/secret" },
        "https://inside.example.com/secret": { body: "<h1>never reached</h1>" },
      },
      { resolve },
    );

    const refused = page(result.pages, "https://example.com/bad");
    assert.equal(refused.fetchState, "refused-unsafe");
    assert.equal(refused.title, null);
  });
});

describe("concurrency", () => {
  test("concurrency 1 never has two requests in flight at once", async () => {
    // What the first controlled crawl relies on: one request at a time
    // against a client's server.
    let inFlight = 0;
    let peak = 0;

    const routes: Record<string, Route> = {
      "https://example.com/robots.txt": ROBOTS_ALLOW_ALL,
      "https://example.com/sitemap.xml": { status: 404, type: "application/xml" },
      "https://example.com/": {
        body: Array.from({ length: 6 }, (_, index) => `<a href="/p${index}">p</a>`).join(""),
      },
    };
    for (let index = 0; index < 6; index += 1) {
      routes[`https://example.com/p${index}`] = { body: "<h1>p</h1>" };
    }

    const watched: Fetch = async (input, init, pin) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resume) => setTimeout(resume, 1));
      try {
        return await siteFetch(routes)(input, init, pin);
      } finally {
        inFlight -= 1;
      }
    };

    await crawl(routes, { fetch: watched, concurrency: 1 });
    assert.equal(peak, 1, "one request at a time means one request at a time");
  });

  test("a higher concurrency does overlap, so the setting is doing something", async () => {
    let inFlight = 0;
    let peak = 0;

    const routes: Record<string, Route> = {
      "https://example.com/robots.txt": ROBOTS_ALLOW_ALL,
      "https://example.com/sitemap.xml": { status: 404, type: "application/xml" },
      "https://example.com/": {
        body: Array.from({ length: 6 }, (_, index) => `<a href="/p${index}">p</a>`).join(""),
      },
    };
    for (let index = 0; index < 6; index += 1) {
      routes[`https://example.com/p${index}`] = { body: "<h1>p</h1>" };
    }

    const watched: Fetch = async (input, init, pin) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resume) => setTimeout(resume, 1));
      try {
        return await siteFetch(routes)(input, init, pin);
      } finally {
        inFlight -= 1;
      }
    };

    await crawl(routes, { fetch: watched, concurrency: 3 });
    assert.ok(peak > 1, "concurrency 3 must actually overlap requests");
    assert.ok(peak <= 3, "and must not exceed what was asked for");
  });

  test("depth 1 follows the start page's links and goes no further", async () => {
    const result = await crawl(
      {
        "https://example.com/robots.txt": ROBOTS_ALLOW_ALL,
        "https://example.com/sitemap.xml": { status: 404, type: "application/xml" },
        "https://example.com/": { body: `<a href="/one">1</a>` },
        "https://example.com/one": { body: `<a href="/two">2</a>` },
        "https://example.com/two": { body: "<h1>2</h1>" },
      },
      { budget: { ...BUDGET, maxDepth: 1 } },
    );

    assert.equal(page(result.pages, "https://example.com/").depth, 0);
    assert.equal(page(result.pages, "https://example.com/one").depth, 1);
    assert.ok(
      !result.pages.some((entry) => entry.url === "https://example.com/two"),
      "depth 1 must not reach a page two links from the start",
    );
  });

  test("depth 0 fetches the start URL and follows nothing", async () => {
    const result = await crawl(
      {
        "https://example.com/robots.txt": ROBOTS_ALLOW_ALL,
        "https://example.com/sitemap.xml": { status: 404, type: "application/xml" },
        "https://example.com/": { body: `<a href="/one">1</a>` },
        "https://example.com/one": { body: "<h1>1</h1>" },
      },
      { budget: { ...BUDGET, maxDepth: 0 } },
    );

    assert.equal(result.pages.length, 1);
    assert.equal(page(result.pages, "https://example.com/").depth, 0);
  });
});

// ---------------------------------------------------------------------------
// Internal links out: one distinct recorded internal edge from the page, once.
// ---------------------------------------------------------------------------

describe("internal links out", () => {
  const SITE = {
    "https://example.com/robots.txt": ROBOTS_ALLOW_ALL,
    "https://example.com/sitemap.xml": { status: 404, type: "application/xml" },
  } satisfies Record<string, Route>;

  type Result = Awaited<ReturnType<typeof crawl>>;

  const internalEdges = (result: Result) => result.links.filter((link) => link.isInternal);
  const sumOut = (result: Result) => result.pages.reduce((sum, entry) => sum + entry.internalLinksOut, 0);

  /**
   * The invariant every case below holds: the pages' outbound counts add up
   * to the recorded internal edges, and each page's count is its own edges.
   * (The inbound side has no such sum: an internal target that was never
   * queued — a nofollow link, say — has an edge but no page row.)
   */
  function consistent(result: Result): void {
    assert.equal(sumOut(result), internalEdges(result).length, "sum of internalLinksOut ≠ recorded internal edges");
    for (const entry of result.pages) {
      const from = result.links.filter((link) => link.isInternal && link.fromUrl === entry.url).length;
      assert.equal(entry.internalLinksOut, from, `${entry.url}: internalLinksOut ≠ its recorded internal edges`);
    }
  }

  test("only internal links: the count is the number of distinct internal targets", async () => {
    const result = await crawl({
      ...SITE,
      "https://example.com/": { body: `<a href="/a">a</a><a href="/b">b</a><a href="/c">c</a>` },
      "https://example.com/a": { body: "<h1>a</h1>" },
      "https://example.com/b": { body: "<h1>b</h1>" },
      "https://example.com/c": { body: "<h1>c</h1>" },
    });
    assert.equal(page(result.pages, "https://example.com/").internalLinksOut, 3);
    for (const path of ["/a", "/b", "/c"]) assert.equal(page(result.pages, `https://example.com${path}`).internalLinksOut, 0);
    consistent(result);
  });

  test("internal plus external links: only the internal edges are counted, the external ones are recorded", async () => {
    const result = await crawl({
      ...SITE,
      "https://example.com/": {
        body: `<a href="/a">a</a><a href="https://elsewhere.example.net/x">out</a><a href="https://other.example.org/">out2</a>`,
      },
      "https://example.com/a": { body: "<h1>a</h1>" },
    });
    assert.equal(page(result.pages, "https://example.com/").internalLinksOut, 1);
    assert.equal(result.links.filter((link) => !link.isInternal).length, 2);
    assert.equal(result.links.length, 3);
    consistent(result);
  });

  test("a duplicate target, with a tracking parameter and with a fragment, is one edge and counts once", async () => {
    const result = await crawl({
      ...SITE,
      "https://example.com/": { body: `<a href="/dup">1</a><a href="/dup?utm_source=x">2</a><a href="/dup#frag">3</a>` },
      "https://example.com/dup": { body: "<h1>once</h1>" },
    });
    assert.equal(internalEdges(result).length, 1);
    assert.equal(page(result.pages, "https://example.com/").internalLinksOut, 1);
    assert.equal(page(result.pages, "https://example.com/dup").internalLinksIn, 1);
    consistent(result);
  });

  test("mailto, tel, javascript, ftp and malformed hrefs contribute nothing; a bare # resolves to the page itself under the existing normalisation", async () => {
    const result = await crawl({
      ...SITE,
      "https://example.com/": {
        body: [
          `<a href="mailto:hello@example.com">m</a>`,
          `<a href="tel:+15551234567">t</a>`,
          `<a href="javascript:void(0)">j</a>`,
          `<a href="ftp://example.com/file">f</a>`,
          `<a href="http://[not-a-host/">bad</a>`,
          `<a href="https://user:pw@example.com/secret">creds</a>`,
        ].join(""),
      },
    });
    assert.equal(result.links.length, 0);
    assert.equal(page(result.pages, "https://example.com/").internalLinksOut, 0);
    consistent(result);

    // `#` is not a second normalisation rule: it resolves to the page's own
    // URL, the fragment is dropped, and the edge table records a self-link.
    const hash = await crawl({
      ...SITE,
      "https://example.com/": { body: `<a href="#">top</a><a href="#top">top again</a>` },
    });
    assert.deepEqual(
      hash.links.map((link) => [link.fromUrl, link.toUrl, link.isInternal]),
      [["https://example.com/", "https://example.com/", true]],
    );
    assert.equal(page(hash.pages, "https://example.com/").internalLinksOut, 1);
    consistent(hash);
  });

  test("relative and absolute same-host URLs count as the URLs they normalise to", async () => {
    const result = await crawl({
      ...SITE,
      "https://example.com/": {
        body: [
          `<a href="/a">1</a>`,
          `<a href="https://example.com/a">2</a>`,
          `<a href="a">3</a>`,
          `<a href="https://EXAMPLE.com/a">4</a>`,
          `<a href="https://example.com:443/a">5</a>`,
          `<a href="/A">6</a>`,
          `<a href="/a/">7</a>`,
          `<a href="http://example.com/a">8</a>`,
        ].join(""),
      },
      "https://example.com/a": { body: "<h1>a</h1>" },
    });
    // /a (five spellings), /A, /a/ and http://…/a are four distinct normalised URLs.
    assert.equal(page(result.pages, "https://example.com/").internalLinksOut, 4);
    assert.deepEqual(
      internalEdges(result).map((link) => link.toUrl).sort(),
      ["http://example.com/a", "https://example.com/A", "https://example.com/a", "https://example.com/a/"],
    );
    consistent(result);
  });

  test("a www subdomain is internal by the label-boundary rule; a look-alike host and a suffix host are external", async () => {
    const result = await crawl({
      ...SITE,
      "https://example.com/": {
        body: [
          `<a href="https://www.example.com/p">www</a>`,
          `<a href="https://evil-example.com/p">lookalike</a>`,
          `<a href="https://example.com.evil.net/">suffix</a>`,
        ].join(""),
      },
      "https://www.example.com/robots.txt": ROBOTS_ALLOW_ALL,
      "https://www.example.com/p": { body: "<h1>www</h1>" },
    });
    assert.equal(page(result.pages, "https://example.com/").internalLinksOut, 1);
    assert.deepEqual(
      result.links.map((link) => [new URL(link.toUrl).hostname, link.isInternal]),
      [["www.example.com", true], ["evil-example.com", false], ["example.com.evil.net", false]],
    );
    consistent(result);
  });

  test("in a competitor crawl the project's own site is external, and only the rival's internal edges are counted", async () => {
    const result = await crawl(
      {
        "https://rival.example/robots.txt": ROBOTS_ALLOW_ALL,
        "https://rival.example/sitemap.xml": { status: 404, type: "application/xml" },
        "https://rival.example/": { body: `<a href="/about">about</a><a href="https://example.com/">the project</a>` },
        "https://rival.example/about": { body: "<h1>about</h1>" },
      },
      { startUrl: "https://rival.example/", hostScope: "rival.example" },
    );
    assert.equal(page(result.pages, "https://rival.example/").internalLinksOut, 1);
    const toProject = result.links.find((link) => link.toUrl === "https://example.com/");
    assert.ok(toProject);
    assert.equal(toProject.isInternal, false);
    assert.ok(!result.pages.some((entry) => entry.url.includes("example.com/")), "the project's site was fetched from a rival's crawl");
    consistent(result);
  });

  test("a nofollow anchor is recorded and counted as an internal edge, but not followed", async () => {
    const result = await crawl({
      ...SITE,
      "https://example.com/": { body: `<a href="/n" rel="nofollow">n</a><a href="/f">f</a>` },
      "https://example.com/n": { body: "<h1>never fetched</h1>" },
      "https://example.com/f": { body: "<h1>f</h1>" },
    });
    assert.equal(page(result.pages, "https://example.com/").internalLinksOut, 2);
    assert.deepEqual(
      result.links.map((link) => [link.toUrl, link.rel]),
      [["https://example.com/n", "nofollow"], ["https://example.com/f", null]],
    );
    assert.ok(!result.pages.some((entry) => entry.url === "https://example.com/n"), "a nofollow link was followed");
    consistent(result);
  });

  test("a page whose robots meta says nofollow or none records no edges and counts zero", async () => {
    for (const directive of ["noindex,nofollow", "none"]) {
      const result = await crawl({
        ...SITE,
        "https://example.com/": { body: `<meta name="robots" content="${directive}"><a href="/hidden">h</a><a href="/also">a</a>` },
        "https://example.com/hidden": { body: "<h1>hidden</h1>" },
        "https://example.com/also": { body: "<h1>also</h1>" },
      });
      assert.equal(result.links.length, 0, directive);
      assert.equal(page(result.pages, "https://example.com/").internalLinksOut, 0, directive);
      assert.equal(result.pages.length, 1, directive);
      consistent(result);
    }
  });

  test("a self-link is recorded once and counted once, on both ends", async () => {
    const result = await crawl({
      ...SITE,
      "https://example.com/": { body: `<a href="/">home</a><a href="https://example.com/">home again</a><a href="/a">a</a>` },
      "https://example.com/a": { body: `<a href="/a">me</a><a href="/a">me too</a>` },
    });
    const home = page(result.pages, "https://example.com/");
    assert.equal(home.internalLinksOut, 2);
    assert.equal(home.internalLinksIn, 1);
    const a = page(result.pages, "https://example.com/a");
    assert.equal(a.internalLinksOut, 1);
    assert.equal(a.internalLinksIn, 2);
    assert.equal(internalEdges(result).length, 3);
    consistent(result);
  });

  test("the 300-anchor extraction cap keeps the count equal to the recorded edges", async () => {
    const anchors = Array.from({ length: 400 }, (_, index) => `<a href="/p${index}">${index}</a>`).join("");
    const result = await crawl(
      { ...SITE, "https://example.com/": { body: anchors } },
      { budget: { maxPages: 1, maxDepth: 1, maxDurationMs: 60_000 } },
    );
    assert.equal(internalEdges(result).length, 300);
    assert.equal(page(result.pages, "https://example.com/").internalLinksOut, 300);
    // Discovered-but-unreached pages carry no counts of their own.
    for (const entry of result.pages) {
      if (entry.url === "https://example.com/") continue;
      assert.equal(entry.fetchState, "budget-skipped");
      assert.equal(entry.internalLinksOut, 0);
    }
    consistent(result);
  });

  test("a page that never answered has no outbound count; an error page whose body was read keeps its recorded edges", async () => {
    const result = await crawl({
      ...SITE,
      "https://example.com/": { body: `<a href="/gone">gone</a><a href="/down">down</a>` },
      // An HTTP error with an HTML body is parsed, as it always was, so its
      // anchors are edges of the graph and the page's count says so.
      "https://example.com/gone": { status: 500, body: `<a href="/a">a</a>` },
      "https://example.com/down": { fail: "connection" },
    });
    assert.equal(page(result.pages, "https://example.com/gone").fetchState, "http-error");
    assert.equal(page(result.pages, "https://example.com/gone").internalLinksOut, 1);
    assert.equal(page(result.pages, "https://example.com/down").internalLinksOut, 0);
    assert.equal(page(result.pages, "https://example.com/").internalLinksOut, 2);
    consistent(result);
  });
});
