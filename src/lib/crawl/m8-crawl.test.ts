import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { runCrawl } from "./engine.ts";
import { boundText, extractDocument, MAX_VISIBLE_TEXT } from "./extract.ts";
import type { Fetch } from "./fetcher.ts";
import type { AddressResolver } from "./network-guard.ts";

/** M8, PR 3: visible text kept per page, and an own-site crawl seeded from the sitemap. */

type Route = { readonly status?: number; readonly type?: string; readonly body?: string };
const RESOLVER: AddressResolver = async () => [{ address: "93.184.216.34", family: 4 }];
const site = (routes: Readonly<Record<string, Route>>): Fetch => async (input) => {
  const route = routes[input];
  if (route === undefined) return new Response("nope", { status: 404, headers: { "content-type": "text/html" } });
  return new Response(route.body ?? "", { status: route.status ?? 200, headers: { "content-type": route.type ?? "text/html" } });
};
const crawl = (routes: Readonly<Record<string, Route>>, overrides: Record<string, unknown> = {}) =>
  runCrawl({ startUrl: "https://example.com/", hostScope: "example.com", userAgent: "NexraBot/0.1", budget: { maxPages: 50, maxDepth: 3, maxDurationMs: 60_000 }, concurrency: 2, fetch: site(routes), resolve: RESOLVER, sleep: async () => {}, ...overrides });

const SITEMAP: Route = {
  type: "application/xml",
  body: `<urlset><url><loc>https://example.com/orphan</loc></url><url><loc>https://example.com/a</loc></url><url><loc>https://other.example/x</loc></url></urlset>`,
};
const ROUTES: Record<string, Route> = {
  "https://example.com/robots.txt": { type: "text/plain", body: "User-agent: *\nDisallow: /private" },
  "https://example.com/sitemap.xml": SITEMAP,
  "https://example.com/": { body: `<a href="/a">a</a>` },
  "https://example.com/a": { body: `<p>A page</p>` },
  "https://example.com/orphan": { body: `<p>Nothing links here</p>` },
};

describe("visible text", () => {
  test("what a reader sees, whitespace collapsed, text nodes set apart; never script, style, svg or the head", () => {
    const doc = extractDocument(`<html><head><title>T</title><style>p{}</style></head><body><h1>AI   SDR</h1><p>Replies <b>fast</b>.</p><script>var x = 1</script><svg><text>no</text></svg><noscript>no</noscript></body></html>`);
    assert.equal(doc.visibleText, "AI SDR Replies fast .");
    assert.equal(doc.wordCount, 5, "the word count is unchanged");
    assert.equal(extractDocument("<html><body></body></html>").visibleText, "");
  });

  test("bounded at 20,000 characters, cut on a word, never on half a surrogate pair", () => {
    const long = Array(5000).fill("abcdefgh").join(" ");
    const bounded = boundText(long);
    assert.ok(bounded.length <= MAX_VISIBLE_TEXT && bounded.endsWith("abcdefgh"));
    const emoji = "a".repeat(MAX_VISIBLE_TEXT - 1) + "😀" + "b".repeat(10);
    assert.ok(!/[\uD800-\uDBFF]$/.test(boundText(emoji)));
    assert.equal(extractDocument(`<p>${long}</p>`).visibleText.length <= MAX_VISIBLE_TEXT, true);
  });
});

describe("sitemap seeding", () => {
  test("an own-site crawl queues the sitemap's in-scope URLs at depth 1 and fetches a page nothing links to", async () => {
    const result = await crawl(ROUTES, { seedFromSitemap: true });
    const orphan = result.pages.find((p) => p.url === "https://example.com/orphan");
    assert.equal(orphan?.fetchState, "fetched");
    assert.equal(orphan?.depth, 1);
    assert.equal(orphan?.inSitemap, true);
    assert.equal(orphan?.visibleText, "Nothing links here");
    assert.ok(!result.pages.some((p) => p.url.startsWith("https://other.example")), "an out-of-scope sitemap URL is never queued");
    assert.equal(result.pages.filter((p) => p.url === "https://example.com/a").length, 1, "a URL both linked and listed is fetched once");
  });

  test("without seeding (a competitor crawl) the walk follows links only, as before", async () => {
    const result = await crawl(ROUTES);
    assert.ok(!result.pages.some((p) => p.url === "https://example.com/orphan"));
  });

  test("a seeded URL robots.txt disallows is recorded as blocked, and one beyond the budget as budget-skipped", async () => {
    const routes = { ...ROUTES, "https://example.com/sitemap.xml": { type: "application/xml", body: `<urlset><url><loc>https://example.com/private/x</loc></url><url><loc>https://example.com/z1</loc></url><url><loc>https://example.com/z2</loc></url></urlset>` } };
    const result = await crawl(routes, { seedFromSitemap: true, budget: { maxPages: 3, maxDepth: 3, maxDurationMs: 60_000 } });
    assert.equal(result.pages.find((p) => p.url === "https://example.com/private/x")?.fetchState, "blocked-by-robots");
    assert.ok(result.pages.some((p) => p.fetchState === "budget-skipped"));
    assert.equal(result.stopReason, "page-budget");
  });

  test("depth 0 seeds nothing: the start page only", async () => {
    const result = await crawl(ROUTES, { seedFromSitemap: true, budget: { maxPages: 50, maxDepth: 0, maxDurationMs: 60_000 } });
    assert.equal(result.pagesFetched, 1);
  });
});
