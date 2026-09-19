import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { discoverSitemapUrls, initialSitemaps, parseSitemap } from "@/lib/crawl/sitemap";
import type { AddressLookup } from "@/lib/crawl/url-policy";
import type { RobotsPolicy } from "@/types/crawl";

const publicDns: AddressLookup = async () => [{ address: "93.184.216.34" }];

type Route = () => Response;

const xml = (body: string, status = 200): Route =>
  () => new Response(body, { status, headers: { "content-type": "application/xml" } });

const robotsFile = (body: string): Route =>
  () => new Response(body, { status: 200, headers: { "content-type": "text/plain" } });

function router(routes: Record<string, Route>) {
  const seen: string[] = [];
  const send = async (url: string) => {
    seen.push(url);
    const route = routes[url];
    return route ? route() : new Response("", { status: 404, headers: { "content-type": "text/html" } });
  };
  return { send, seen };
}

const urlset = (...locs: string[]) =>
  `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs
    .map((loc) => `<url><loc>${loc}</loc><changefreq>daily</changefreq></url>`)
    .join("")}</urlset>`;

const index = (...locs: string[]) =>
  `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs
    .map((loc) => `<sitemap><loc>${loc}</loc></sitemap>`)
    .join("")}</sitemapindex>`;

const discover = (routes: Record<string, Route>, options = {}) =>
  discoverSitemapUrls("example.com", {
    lookup: publicDns,
    fetch: router(routes).send,
    ...options,
  });

const found = (result: { urls: readonly { url: string }[] }) => result.urls.map((u) => u.url).sort();

describe("parseSitemap", () => {
  test("reads a urlset", () => {
    const parsed = parseSitemap(urlset("https://example.com/a", "https://example.com/b"));
    assert.equal(parsed.kind, "urlset");
    assert.deepEqual(parsed.locations, ["https://example.com/a", "https://example.com/b"]);
  });

  test("reads an index", () => {
    const parsed = parseSitemap(index("https://example.com/s1.xml"));
    assert.equal(parsed.kind, "sitemapindex");
    assert.deepEqual(parsed.locations, ["https://example.com/s1.xml"]);
  });

  test("unwraps CDATA", () => {
    const parsed = parseSitemap(
      "<urlset><url><loc><![CDATA[https://example.com/a?x=1&y=2]]></loc></url></urlset>",
    );
    assert.deepEqual(parsed.locations, ["https://example.com/a?x=1&y=2"]);
  });

  test("resolves the entities a sitemap may contain", () => {
    const parsed = parseSitemap(
      "<urlset><url><loc>https://example.com/a?x=1&amp;y=2&#38;z=3</loc></url></urlset>",
    );
    assert.deepEqual(parsed.locations, ["https://example.com/a?x=1&y=2&z=3"]);
  });

  test("ignores a commented-out location", () => {
    const parsed = parseSitemap(
      "<urlset><!-- <url><loc>https://example.com/hidden</loc></url> --><url><loc>https://example.com/a</loc></url></urlset>",
    );
    assert.deepEqual(parsed.locations, ["https://example.com/a"]);
  });

  test("recovers the locations it can from a truncated document", () => {
    const parsed = parseSitemap(
      "<urlset><url><loc>https://example.com/a</loc></url><url><loc>https://exa",
    );
    assert.deepEqual(parsed.locations, ["https://example.com/a"]);
  });

  test("reports an unrecognised document as unknown", () => {
    assert.equal(parseSitemap("<html><body>not a sitemap</body></html>").kind, "unknown");
    assert.equal(parseSitemap("").kind, "unknown");
  });

  test("does not expand an external or custom entity", () => {
    const parsed = parseSitemap(
      '<!DOCTYPE x [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><urlset><url><loc>https://example.com/&xxe;</loc></url></urlset>',
    );
    assert.deepEqual(parsed.locations, ["https://example.com/&xxe;"]);
  });
});

describe("initialSitemaps", () => {
  test("prefers what robots.txt names", () => {
    const robots: RobotsPolicy = {
      state: "parsed",
      groups: [],
      sitemaps: ["https://example.com/a.xml", "https://example.com/b.xml"],
    };
    assert.deepEqual(initialSitemaps("https://example.com", robots), [
      { url: "https://example.com/a.xml", source: "robots" },
      { url: "https://example.com/b.xml", source: "robots" },
    ]);
  });

  test("falls back to the conventional location", () => {
    assert.deepEqual(initialSitemaps("https://example.com", { state: "missing" }), [
      { url: "https://example.com/sitemap.xml", source: "well-known" },
    ]);
  });
});

describe("discoverSitemapUrls", () => {
  test("reads the sitemap robots.txt advertises", async () => {
    const result = await discover({
      "https://example.com/robots.txt": robotsFile("Sitemap: https://example.com/s.xml"),
      "https://example.com/s.xml": xml(urlset("https://example.com/a", "https://example.com/b")),
    });
    assert.deepEqual(found(result), [
      "https://example.com/",
      "https://example.com/a",
      "https://example.com/b",
    ]);
    assert.equal(result.robots, "parsed");
    assert.deepEqual(result.limits, []);
    assert.equal(result.documents[0].source, "robots");
  });

  test("falls back to /sitemap.xml when robots.txt names none", async () => {
    const result = await discover({
      "https://example.com/robots.txt": robotsFile("User-agent: *\nDisallow:"),
      "https://example.com/sitemap.xml": xml(urlset("https://example.com/a")),
    });
    assert.deepEqual(found(result), ["https://example.com/", "https://example.com/a"]);
    assert.equal(result.documents[0].source, "well-known");
  });

  test("walks a sitemap index into its children", async () => {
    const result = await discover({
      "https://example.com/robots.txt": robotsFile("Sitemap: https://example.com/i.xml"),
      "https://example.com/i.xml": xml(
        index("https://example.com/s1.xml", "https://example.com/s2.xml"),
      ),
      "https://example.com/s1.xml": xml(urlset("https://example.com/a")),
      "https://example.com/s2.xml": xml(urlset("https://example.com/b")),
    });
    assert.deepEqual(found(result), [
      "https://example.com/",
      "https://example.com/a",
      "https://example.com/b",
    ]);
    assert.equal(result.documents.length, 3);
    assert.equal(result.documents[0].kind, "sitemapindex");
  });

  test("deduplicates a URL listed in more than one sitemap", async () => {
    const result = await discover({
      "https://example.com/robots.txt": robotsFile("Sitemap: https://example.com/i.xml"),
      "https://example.com/i.xml": xml(
        index("https://example.com/s1.xml", "https://example.com/s2.xml"),
      ),
      "https://example.com/s1.xml": xml(urlset("https://example.com/a")),
      "https://example.com/s2.xml": xml(urlset("https://example.com/a", "https://example.com/b")),
    });
    assert.deepEqual(found(result), [
      "https://example.com/",
      "https://example.com/a",
      "https://example.com/b",
    ]);
  });

  test("drops URLs the policy refuses, without requesting them", async () => {
    const routes = {
      "https://example.com/robots.txt": robotsFile("Sitemap: https://example.com/s.xml"),
      "https://example.com/s.xml": xml(
        urlset(
          "https://example.com/good",
          "https://other.com/off-site",
          "http://127.0.0.1/internal",
          "javascript:alert(1)",
          "https://user:pass@example.com/creds",
        ),
      ),
    };
    const { send, seen } = router(routes);
    const result = await discoverSitemapUrls("example.com", { lookup: publicDns, fetch: send });
    assert.deepEqual(found(result), ["https://example.com/", "https://example.com/good"]);
    assert.equal(
      seen.some((url) => url.includes("other.com") || url.includes("127.0.0.1")),
      false,
    );
  });

  test("refuses an index that points at another site", async () => {
    const { send, seen } = router({
      "https://example.com/robots.txt": robotsFile("Sitemap: https://example.com/i.xml"),
      "https://example.com/i.xml": xml(index("https://other.com/s.xml")),
    });
    const result = await discoverSitemapUrls("example.com", { lookup: publicDns, fetch: send });
    assert.equal(result.documents.length, 1);
    assert.equal(seen.includes("https://other.com/s.xml"), false);
  });

  test("stops at the depth limit", async () => {
    const routes: Record<string, Route> = {
      "https://example.com/robots.txt": robotsFile("Sitemap: https://example.com/i0.xml"),
    };
    for (let level = 0; level < 6; level += 1) {
      routes[`https://example.com/i${level}.xml`] = xml(
        index(`https://example.com/i${level + 1}.xml`),
      );
    }
    const result = await discover(routes, { maxDepth: 2 });
    assert.equal(result.limits.includes("depth"), true);
    assert.equal(result.documents.length, 3);
  });

  test("stops at the document limit", async () => {
    const children = Array.from({ length: 20 }, (_, i) => `https://example.com/s${i}.xml`);
    const routes: Record<string, Route> = {
      "https://example.com/robots.txt": robotsFile("Sitemap: https://example.com/i.xml"),
      "https://example.com/i.xml": xml(index(...children)),
    };
    for (const [i, child] of children.entries()) {
      routes[child] = xml(urlset(`https://example.com/p${i}`));
    }
    const result = await discover(routes, { maxDocuments: 5 });
    assert.equal(result.limits.includes("sitemaps"), true);
    assert.ok(result.documents.length <= 5);
  });

  test("stops at the URL limit", async () => {
    const many = Array.from({ length: 40 }, (_, i) => `https://example.com/p${i}`);
    const result = await discover(
      {
        "https://example.com/robots.txt": robotsFile("Sitemap: https://example.com/s.xml"),
        "https://example.com/s.xml": xml(urlset(...many)),
      },
      { maxUrls: 10 },
    );
    assert.equal(result.limits.includes("urls"), true);
    assert.equal(result.urls.length, 10);
  });

  test("a site with no sitemap still yields its homepage", async () => {
    const result = await discover({
      "https://example.com/robots.txt": robotsFile("User-agent: *\nDisallow:"),
    });
    assert.deepEqual(found(result), ["https://example.com/"]);
    assert.equal(result.documents[0].failure, "malformed");
  });

  test("records why a sitemap could not be read", async () => {
    const result = await discover({
      "https://example.com/robots.txt": robotsFile("Sitemap: https://example.com/s.xml"),
      "https://example.com/s.xml": xml("", 500),
    });
    assert.equal(result.documents[0].failure, "malformed");
    assert.deepEqual(found(result), ["https://example.com/"]);
  });

  test("an unreadable robots.txt still reports its state", async () => {
    const result = await discover({
      "https://example.com/robots.txt": () =>
        new Response("", { status: 503, headers: { "content-type": "text/plain" } }),
      "https://example.com/sitemap.xml": xml(urlset("https://example.com/a")),
    });
    assert.equal(result.robots, "unavailable");
  });

  test("does not refetch a sitemap two indexes both name", async () => {
    const { send, seen } = router({
      "https://example.com/robots.txt": robotsFile("Sitemap: https://example.com/i.xml"),
      "https://example.com/i.xml": xml(
        index("https://example.com/s.xml", "https://example.com/s.xml"),
      ),
      "https://example.com/s.xml": xml(urlset("https://example.com/a")),
    });
    await discoverSitemapUrls("example.com", { lookup: publicDns, fetch: send });
    assert.equal(seen.filter((url) => url.endsWith("/s.xml")).length, 1);
  });

  test("accepts a bare domain and a full URL alike", async () => {
    const routes = {
      "https://example.com/robots.txt": robotsFile("Sitemap: https://example.com/s.xml"),
      "https://example.com/s.xml": xml(urlset("https://example.com/a")),
    };
    for (const site of ["example.com", "https://example.com", "https://example.com/"]) {
      const result = await discoverSitemapUrls(site, {
        lookup: publicDns,
        fetch: router(routes).send,
      });
      assert.deepEqual(found(result), ["https://example.com/", "https://example.com/a"], site);
    }
  });

  test("a site whose domain fails the policy discovers nothing", async () => {
    const result = await discoverSitemapUrls("127.0.0.1", {
      lookup: publicDns,
      fetch: async () => {
        throw new Error("fetch should not have been called");
      },
    });
    assert.deepEqual(result.urls, []);
    assert.equal(result.robots, "unavailable");
  });

  test("reuses a robots policy it is given rather than fetching one", async () => {
    const { send, seen } = router({
      "https://example.com/s.xml": xml(urlset("https://example.com/a")),
    });
    const result = await discoverSitemapUrls("example.com", {
      lookup: publicDns,
      fetch: send,
      robots: { state: "parsed", groups: [], sitemaps: ["https://example.com/s.xml"] },
    });
    assert.equal(seen.some((url) => url.endsWith("robots.txt")), false);
    assert.deepEqual(found(result), ["https://example.com/", "https://example.com/a"]);
  });
});
