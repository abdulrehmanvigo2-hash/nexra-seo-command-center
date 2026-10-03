import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { describeFetchState, isOutsideUrl, parseSourceFetchRequest, PREVIEW_CHARS, type EvidenceSource } from "@/lib/evidence/contract";
import { fetchSource, sourceHostScope, type FetchedSource } from "@/lib/evidence/fetch";
import { createEvidenceService } from "@/lib/evidence/service";
import type { EvidenceStore } from "@/lib/evidence/store-contract";
import { sourceRowToSource } from "@/lib/evidence/supabase/schema";
import { capText, extractPageText, MAX_TEXT_CHARS } from "@/lib/evidence/text";

/** M4, PR 5: the text extractor, the fetch under the crawler's rules, the request shape and the sources service. */

const OPP = "22222222-2222-4222-8222-222222222222";
const SERP = "33333333-3333-4333-8333-333333333333";
const PUBLIC = async () => [{ address: "93.184.216.34", family: 4 as const }];

describe("extractPageText", () => {
  test("keeps what a reader sees; drops head, scripts, chrome and hidden parts", () => {
    const page = extractPageText(`<!doctype html><html><head><title> The  Guide </title><style>p{}</style><script>var secret = "x";</script></head>
      <body><header>Menu</header><nav>Home About</nav><main><h1>AI SDRs</h1><p>They reply   within a minute.</p><p hidden>Hidden text</p>
      <div aria-hidden="true">Decor</div><!-- a comment --><ul><li>One</li><li>Two</li></ul><template><p>Template</p></template></main>
      <aside>Related</aside><footer>© Alpha</footer><noscript>Enable JS</noscript></body></html>`);
    assert.equal(page.title, "The Guide");
    assert.equal(page.text, "AI SDRs They reply within a minute. One Two");
  });

  test("no visible text is null; the cap holds at a word boundary", () => {
    assert.deepEqual(extractPageText("<html><head><title></title></head><body><script>x</script></body></html>"), { title: null, text: null });
    const long = capText(("word ").repeat(5000), MAX_TEXT_CHARS);
    assert.ok(long.length <= MAX_TEXT_CHARS && !long.endsWith(" ") && long.endsWith("word"));
    assert.equal(extractPageText(`<p>${"a".repeat(30000)}</p>`).text?.length, MAX_TEXT_CHARS);
  });
});

type Route = { status?: number; body?: string; type?: string; location?: string };
function network(routes: Record<string, Route>, seen: string[] = []) {
  return async (input: string) => {
    seen.push(input);
    const route = routes[input];
    if (!route) throw Object.assign(new Error("connect"), { cause: { code: "ECONNREFUSED" } });
    const headers = new Headers({ "content-type": route.type ?? "text/html" });
    if (route.location) headers.set("location", route.location);
    return new Response(route.body ?? "", { status: route.status ?? 200, headers });
  };
}
const HTML = "<html><head><title>Alpha guide</title></head><body><p>AI SDRs reply within one minute.</p></body></html>";

describe("fetchSource", () => {
  test("robots.txt first; an allowed HTML page is fetched and its text kept", async () => {
    const seen: string[] = [];
    const result = await fetchSource("https://alpha.example/guide", {
      userAgent: "NexraBot/0.1", resolve: PUBLIC,
      fetch: network({ "https://alpha.example/robots.txt": { body: "User-agent: *\nDisallow: /private", type: "text/plain" }, "https://alpha.example/guide": { body: HTML } }, seen),
    });
    assert.deepEqual(seen, ["https://alpha.example/robots.txt", "https://alpha.example/guide"]);
    assert.deepEqual(result, { requestedUrl: "https://alpha.example/guide", finalUrl: "https://alpha.example/guide", httpStatus: 200, title: "Alpha guide", text: "AI SDRs reply within one minute.", state: "fetched", robots: "allowed" } satisfies FetchedSource);
  });

  test("a disallowed page is never requested", async () => {
    const seen: string[] = [];
    const result = await fetchSource("https://alpha.example/private/x", { userAgent: "NexraBot/0.1", resolve: PUBLIC, fetch: network({ "https://alpha.example/robots.txt": { body: "User-agent: *\nDisallow: /private", type: "text/plain" } }, seen) });
    assert.equal(result.state, "robots-disallowed");
    assert.equal(result.robots, "disallowed");
    assert.deepEqual(seen, ["https://alpha.example/robots.txt"]);
  });

  test("a robots.txt that errors is not permission; a missing one allows", async () => {
    const seen: string[] = [];
    const failed = await fetchSource("https://alpha.example/guide", { userAgent: "NexraBot/0.1", resolve: PUBLIC, fetch: network({ "https://alpha.example/robots.txt": { status: 503 } }, seen) });
    assert.equal(failed.state, "robots-unreachable");
    assert.deepEqual(seen, ["https://alpha.example/robots.txt"]);
    const missing = await fetchSource("https://alpha.example/guide", { userAgent: "NexraBot/0.1", resolve: PUBLIC, fetch: network({ "https://alpha.example/robots.txt": { status: 404 }, "https://alpha.example/guide": { body: HTML } }) });
    assert.equal(missing.state, "fetched");
  });

  test("a redirect to another site is not followed; www and the bare host are one site", async () => {
    const off = await fetchSource("https://alpha.example/go", { userAgent: "NexraBot/0.1", resolve: PUBLIC, fetch: network({ "https://alpha.example/robots.txt": { status: 404 }, "https://alpha.example/go": { status: 301, location: "https://elsewhere.example/" } }) });
    assert.equal(off.state, "off-site");
    assert.equal(off.text, null);
    const www = await fetchSource("https://alpha.example/a", { userAgent: "NexraBot/0.1", resolve: PUBLIC, fetch: network({ "https://alpha.example/robots.txt": { status: 404 }, "https://alpha.example/a": { status: 301, location: "https://www.alpha.example/a" }, "https://www.alpha.example/a": { body: HTML } }) });
    assert.equal(www.state, "fetched");
    assert.equal(sourceHostScope(new URL("https://www.Alpha.example/x")), "alpha.example");
  });

  test("a private address, a non-HTML page and an error page keep no text", async () => {
    const privateHost = await fetchSource("https://intranet.example/", { userAgent: "u", resolve: async () => [{ address: "10.0.0.5", family: 4 }], fetch: network({}) });
    assert.equal(privateHost.state, "refused-unsafe");
    const pdf = await fetchSource("https://alpha.example/doc.pdf", { userAgent: "u", resolve: PUBLIC, fetch: network({ "https://alpha.example/robots.txt": { status: 404 }, "https://alpha.example/doc.pdf": { type: "application/pdf", body: "%PDF" } }) });
    assert.ok(pdf.state === "non-html" && pdf.text === null);
    const error = await fetchSource("https://alpha.example/gone", { userAgent: "u", resolve: PUBLIC, fetch: network({ "https://alpha.example/robots.txt": { status: 404 }, "https://alpha.example/gone": { status: 500 } }) });
    assert.ok(error.state === "http-error" && error.httpStatus === 500 && error.text === null);
    assert.equal((await fetchSource("file:///etc/passwd", { userAgent: "u", resolve: PUBLIC, fetch: network({}) })).state, "refused-unsafe");
  });
});

describe("the request shape", () => {
  test("a SERP result or a typed URL, never both", () => {
    assert.deepEqual(parseSourceFetchRequest({ project: "nexra-agency", opportunity: OPP, serpResult: SERP }), { ok: true, projectId: "nexra-agency", opportunityId: OPP, target: { serpResultId: SERP } });
    assert.deepEqual(parseSourceFetchRequest({ project: "nexra-agency", opportunity: OPP, url: "https://a.example/x" }), { ok: true, projectId: "nexra-agency", opportunityId: OPP, target: { url: "https://a.example/x" } });
    assert.equal(parseSourceFetchRequest({ project: "nexra-agency", opportunity: OPP, serpResult: SERP, url: "https://a.example" }).ok, false);
    assert.equal(parseSourceFetchRequest({ project: "nexra-agency", opportunity: OPP }).ok, false);
    assert.equal(isOutsideUrl("https://user:pass@a.example/"), false);
    assert.equal(isOutsideUrl("javascript:alert(1)"), false);
    assert.equal(describeFetchState("robots-disallowed"), "Not fetched — robots.txt disallows it");
  });

  test("a stored source's text becomes a preview and goes no further", () => {
    const source = sourceRowToSource({ id: "s", project_id: "p", opportunity_id: OPP, serp_result_id: null, requested_url: "https://a.example", final_url: "https://a.example", fetch_state: "fetched",
      http_status: 200, robots: "allowed", title: "T", page_text: "x".repeat(5000), text_sha256: "a".repeat(64), text_chars: 5000, fetched_by: "o", fetched_at: "2026-10-03T12:00:00Z" });
    assert.equal(source.preview?.length, PREVIEW_CHARS);
    assert.ok(!("pageText" in source) && !("page_text" in source));
  });
});

describe("the sources service", () => {
  function store(overrides: Partial<EvidenceStore> = {}) {
    const recorded: unknown[] = [];
    const base: EvidenceStore = {
      storesEvidence: true,
      async serpResultUrl(_p, _o, id) { return id === SERP ? "https://alpha.example/guide" : null; },
      async sourcesToday() { return 0; },
      async recordSource(input) { recorded.push(input); return { status: "recorded", source: { id: "s1" } as EvidenceSource }; },
      async listSources() { return []; },
      ...overrides,
    };
    return { store: base, recorded };
  }
  const fetched: FetchedSource = { requestedUrl: "https://alpha.example/guide", finalUrl: "https://alpha.example/guide", state: "fetched", httpStatus: 200, robots: "allowed", title: "T", text: "x" };

  test("a SERP result's URL comes from the record, not the request", async () => {
    const urls: string[] = [];
    const { store: s, recorded } = store();
    const result = await createEvidenceService(s, { fetch: async (url) => { urls.push(url); return fetched; } }).fetchSource("nexra-agency", OPP, { serpResultId: SERP }, "op");
    assert.equal(result.status, "recorded");
    assert.deepEqual(urls, ["https://alpha.example/guide"]);
    assert.deepEqual(recorded, [{ projectId: "nexra-agency", opportunityId: OPP, serpResultId: SERP, fetched, operatorId: "op" }]);
  });

  test("an unknown SERP result and the day's limit stop before any fetch", async () => {
    const urls: string[] = [];
    const fetch = async (url: string) => { urls.push(url); return fetched; };
    assert.equal((await createEvidenceService(store().store, { fetch }).fetchSource("p1", OPP, { serpResultId: OPP }, "op")).status, "serp-result-not-found");
    assert.equal((await createEvidenceService(store({ async sourcesToday() { return 5; } }).store, { fetch }).fetchSource("p1", OPP, { url: "https://b.example" }, "op")).status, "source-limit");
    assert.equal((await createEvidenceService({ ...store().store, storesEvidence: false }, { fetch }).fetchSource("p1", OPP, { url: "https://b.example" }, "op")).status, "not-set-up");
    assert.deepEqual(urls, []);
  });
});
