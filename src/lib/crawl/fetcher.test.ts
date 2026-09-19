import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { DEFAULT_MAX_BYTES, fetchPage, fetchRobots } from "@/lib/crawl/fetcher";
import { MAX_HTML_BYTES, extractSignals } from "@/lib/crawl/html";
import type { AddressLookup } from "@/lib/crawl/url-policy";

/**
 * The fetcher never reaches the network here: `fetch` and the DNS lookup are
 * both arguments, which is why they are options on every entry point.
 *
 * Each route is a factory rather than a `Response`. A response body may be read
 * once, and `clone()` tees it — cancelling one branch of a tee never settles
 * while the other is unread, which hangs the test rather than failing it. Real
 * `fetch` hands back a fresh response every time, so a factory is also the
 * faithful shape.
 */

const publicDns: AddressLookup = async () => [{ address: "93.184.216.34" }];
const internalDns: AddressLookup = async () => [{ address: "10.0.0.1" }];

type Route = () => Response;

const html = (body: string, status = 200): Route =>
  () => new Response(body, { status, headers: { "content-type": "text/html" } });

const redirect = (location: string, status = 301): Route =>
  () => new Response("", { status, headers: { location } });

const plain = (body: string, status = 200): Route =>
  () => new Response(body, { status, headers: { "content-type": "text/plain" } });

function router(routes: Record<string, Route>) {
  const seen: string[] = [];
  const send = async (url: string) => {
    seen.push(url);
    const route = routes[url];
    return route ? route() : new Response("", { status: 404, headers: { "content-type": "text/html" } });
  };
  return { send, seen };
}

const neverCalled = async () => {
  throw new Error("fetch should not have been called");
};

describe("fetchPage", () => {
  test("returns the body of a page it is allowed to read", async () => {
    const { send } = router({ "https://example.com/": html("<html>hi</html>") });
    const outcome = await fetchPage("https://example.com/", { lookup: publicDns, fetch: send });
    assert.equal(outcome.state, "fetched");
    if (outcome.state !== "fetched") return;
    assert.equal(outcome.status, 200);
    assert.equal(outcome.body, "<html>hi</html>");
    assert.equal(outcome.contentType, "text/html");
  });

  test("identifies itself on every request", async () => {
    let agent: string | undefined;
    await fetchPage("https://example.com/", {
      lookup: publicDns,
      fetch: async (_url, init) => {
        agent = (init.headers as Record<string, string>)["user-agent"];
        return html("<html></html>")();
      },
    });
    assert.match(agent ?? "", /nexrabot/);
  });

  test("follows a redirect and records the chain", async () => {
    const { send } = router({
      "https://example.com/a": redirect("/b"),
      "https://example.com/b": html("<html>b</html>"),
    });
    const outcome = await fetchPage("https://example.com/a", { lookup: publicDns, fetch: send });
    assert.equal(outcome.state, "fetched");
    assert.equal(outcome.url, "https://example.com/b");
    assert.deepEqual(outcome.redirects, [
      { url: "https://example.com/a", status: 301, location: "/b" },
    ]);
  });

  test("refuses a redirect that leaves the site, without requesting it", async () => {
    const { send, seen } = router({
      "https://example.com/a": redirect("https://other.com/x", 302),
    });
    const outcome = await fetchPage("https://example.com/a", {
      site: "example.com",
      lookup: publicDns,
      fetch: send,
    });
    assert.equal(outcome.state, "failed");
    if (outcome.state !== "failed") return;
    assert.equal(outcome.failure, "redirect-refused");
    assert.equal(outcome.refusal, "off-site");
    assert.equal(seen.includes("https://other.com/x"), false);
  });

  test("stops a redirect loop at the cap", async () => {
    const seen: string[] = [];
    const outcome = await fetchPage("https://example.com/loop", {
      lookup: publicDns,
      fetch: async (url) => {
        seen.push(url);
        return redirect("/loop", 302)();
      },
    });
    assert.equal(outcome.state, "failed");
    if (outcome.state !== "failed") return;
    assert.equal(outcome.failure, "too-many-redirects");
    // The first request plus the five the cap allows.
    assert.equal(seen.length, 6);
  });

  test("refuses a body larger than the cap", async () => {
    const { send } = router({ "https://example.com/big": html("x".repeat(100)) });
    const outcome = await fetchPage("https://example.com/big", {
      lookup: publicDns,
      fetch: send,
      maxBytes: 10,
    });
    assert.equal(outcome.state, "failed");
    assert.equal(outcome.state === "failed" ? outcome.failure : null, "too-large");
  });

  test("refuses a content type it does not read", async () => {
    const { send } = router({
      "https://example.com/img": () =>
        new Response("binary", { status: 200, headers: { "content-type": "image/png" } }),
    });
    const outcome = await fetchPage("https://example.com/img", {
      lookup: publicDns,
      fetch: send,
    });
    assert.equal(outcome.state, "failed");
    assert.equal(outcome.state === "failed" ? outcome.failure : null, "unsupported-type");
  });

  test("an error status is a finding, not a failure", async () => {
    const { send } = router({ "https://example.com/gone": html("", 410) });
    const outcome = await fetchPage("https://example.com/gone", {
      lookup: publicDns,
      fetch: send,
    });
    assert.equal(outcome.state, "fetched");
    assert.equal(outcome.state === "fetched" ? outcome.status : null, 410);

    const missing = await fetchPage("https://example.com/nope", {
      lookup: publicDns,
      fetch: router({}).send,
    });
    assert.equal(missing.state, "fetched");
    assert.equal(missing.state === "fetched" ? missing.status : null, 404);
  });

  test("tells a timeout apart from a connection failure", async () => {
    const timedOut = await fetchPage("https://example.com/slow", {
      lookup: publicDns,
      fetch: async () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        throw error;
      },
    });
    assert.equal(timedOut.state === "failed" ? timedOut.failure : null, "timeout");

    const refused = await fetchPage("https://example.com/down", {
      lookup: publicDns,
      fetch: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    assert.equal(refused.state === "failed" ? refused.failure : null, "network");
  });

  test("never requests a host that resolves inside, and says which rule refused", async () => {
    const outcome = await fetchPage("https://intranet.example.com/", {
      lookup: internalDns,
      fetch: neverCalled,
    });
    assert.equal(outcome.state, "failed");
    if (outcome.state !== "failed") return;
    assert.equal(outcome.failure, "refused");
    assert.equal(outcome.refusal, "private-address");
  });

  test("a refusal is distinct from a network failure", async () => {
    const outcome = await fetchPage("https://other.com/x", {
      site: "example.com",
      lookup: publicDns,
      fetch: neverCalled,
    });
    assert.equal(outcome.state, "failed");
    if (outcome.state !== "failed") return;
    assert.equal(outcome.failure, "refused");
    assert.equal(outcome.refusal, "off-site");
  });
});

describe("fetchRobots", () => {
  const at = (route: Route) => router({ "https://example.com/robots.txt": route }).send;

  test("404 means the file is absent and everything is allowed", async () => {
    const policy = await fetchRobots("https://example.com", {
      lookup: publicDns,
      fetch: router({}).send,
    });
    assert.equal(policy.state, "missing");
  });

  test("a server error means nothing is allowed", async () => {
    const policy = await fetchRobots("https://example.com", {
      lookup: publicDns,
      fetch: at(plain("", 500)),
    });
    assert.equal(policy.state, "unavailable");
  });

  test("a connection failure means nothing is allowed", async () => {
    const policy = await fetchRobots("https://example.com", {
      lookup: publicDns,
      fetch: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    assert.equal(policy.state, "unavailable");
  });

  test("a served file is parsed", async () => {
    const policy = await fetchRobots("https://example.com", {
      lookup: publicDns,
      fetch: at(plain("User-agent: *\nDisallow: /x\nSitemap: https://example.com/s.xml")),
    });
    assert.equal(policy.state, "parsed");
    assert.deepEqual(
      policy.state === "parsed" ? policy.sitemaps : [],
      ["https://example.com/s.xml"],
    );
  });

  test("follows the apex-to-www redirect nearly every site serves", async () => {
    // The shape that made a reachable site read as unreachable: robots.txt on
    // the apex 308s to the canonical www host, the hop was refused as
    // off-site, and `unavailable` means the site never stated its rules — so
    // the crawl failed before it began.
    const { send, seen } = router({
      "https://example.com/robots.txt": redirect("https://www.example.com/robots.txt", 308),
      "https://www.example.com/robots.txt": plain(
        "User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: https://www.example.com/sitemap.xml",
      ),
    });
    const policy = await fetchRobots("https://example.com", { lookup: publicDns, fetch: send });
    assert.equal(policy.state, "parsed");
    assert.deepEqual(
      policy.state === "parsed" ? policy.sitemaps : [],
      ["https://www.example.com/sitemap.xml"],
    );
    assert.deepEqual(seen, [
      "https://example.com/robots.txt",
      "https://www.example.com/robots.txt",
    ]);
  });

  test("and the www-to-apex redirect, for a site canonicalising the other way", async () => {
    const { send } = router({
      "https://www.example.com/robots.txt": redirect("https://example.com/robots.txt", 301),
      "https://example.com/robots.txt": plain("User-agent: *\nDisallow: /x"),
    });
    const policy = await fetchRobots("https://www.example.com", { lookup: publicDns, fetch: send });
    assert.equal(policy.state, "parsed");
  });

  test("still refuses a redirect that leaves the site", async () => {
    const { send } = router({
      "https://example.com/robots.txt": redirect("https://evil-example.com/robots.txt", 302),
    });
    const policy = await fetchRobots("https://example.com", { lookup: publicDns, fetch: send });
    assert.equal(policy.state, "unavailable");
  });
});

describe("the body size cap", () => {
  /**
   * The cap that refused the Nexra Agency homepage. It was half a megabyte at
   * the crawl's fetch pass while the extractor was dimensioned for two, so
   * pages in between came back `too-large` — a fact about the cap, not the
   * page. These pin the two ends together and pin the ceiling itself down.
   */

  /** HTML of roughly `bytes`, shaped like a framework-rendered page. */
  const pageOf = (bytes: number) => {
    const head = "<html><head><title>Home</title></head><body><h1>Home</h1>";
    const tail = "</body></html>";
    const filler = '<script>self.__next_f.push([1,"' + "x".repeat(1_000) + '"])</script>';
    const repeats = Math.max(0, Math.ceil((bytes - head.length - tail.length) / filler.length));
    return head + filler.repeat(repeats) + tail;
  };

  test("the fetch cap is the extractor's ceiling, so nothing fetched is truncated", () => {
    // Two numbers for one thing is what caused the bug; they are now one.
    assert.equal(DEFAULT_MAX_BYTES, MAX_HTML_BYTES);
  });

  test("and the crawl's own pass does not set a tighter one of its own", () => {
    // `runtime.ts` wires the real crawl and cannot be imported here — it
    // pulls `next/server` — so it is read as text, the way the migration
    // check reads its SQL. A literal here is exactly the drift that refused
    // the Nexra Agency homepage while the parser was dimensioned for it.
    const wiring = readFileSync(new URL("./runtime.ts", import.meta.url), "utf8");
    const pass = wiring.split("export const PAGE_FETCH = {")[1]?.split("} as const;")[0];
    assert.ok(pass, "PAGE_FETCH is not in runtime.ts");
    assert.match(pass, /maxBytes:\s*MAX_HTML_BYTES\s*,/);
  });

  test("an ordinary page is read", async () => {
    const body = pageOf(20_000);
    const { send } = router({ "https://example.com/": html(body) });
    const outcome = await fetchPage("https://example.com/", { lookup: publicDns, fetch: send });
    assert.equal(outcome.state, "fetched");
    if (outcome.state !== "fetched") return;
    assert.equal(outcome.body.length, body.length);
  });

  test("a realistic large homepage is read whole", async () => {
    // ~900 KB: over the old half-megabyte cap, under the ceiling. This is the
    // shape that failed on the real site.
    const body = pageOf(900_000);
    assert.ok(body.length > 500_000 && body.length < MAX_HTML_BYTES);
    const { send } = router({ "https://example.com/": html(body) });
    const outcome = await fetchPage("https://example.com/", { lookup: publicDns, fetch: send });
    assert.equal(outcome.state, "fetched");
    if (outcome.state !== "fetched") return;
    assert.equal(outcome.body.length, body.length, "the body is not truncated");
    assert.equal(outcome.bytes, body.length);
  });

  test("and still parses, rather than being read and dropped", async () => {
    const body = pageOf(900_000);
    const { send } = router({ "https://example.com/": html(body) });
    const outcome = await fetchPage("https://example.com/", { lookup: publicDns, fetch: send });
    if (outcome.state !== "fetched") return assert.fail("expected a fetch");
    const signals = extractSignals({
      body: outcome.body,
      contentType: outcome.contentType,
      finalUrl: outcome.url,
      site: "example.com",
    });
    assert.equal(signals.state, "parsed");
    assert.equal(signals.title, "Home");
  });

  test("a genuinely oversized response is still refused", async () => {
    const body = pageOf(MAX_HTML_BYTES + 500_000);
    const { send } = router({ "https://example.com/": html(body) });
    const outcome = await fetchPage("https://example.com/", { lookup: publicDns, fetch: send });
    assert.equal(outcome.state, "failed");
    if (outcome.state !== "failed") return;
    assert.equal(outcome.failure, "too-large");
  });

  test("a declared length over the cap is refused without reading the body", async () => {
    // The fetcher checks the declared length before it takes a reader, so in
    // production nothing is pulled at all. The stream machinery fills its own
    // queue speculatively when the Response is built, so one chunk can be
    // pulled here regardless; what this pins down is that a nine-megabyte
    // body is refused without being transferred.
    const chunk = new TextEncoder().encode("y".repeat(64 * 1024));
    let pulled = 0;
    const send = async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            pulled += 1;
            controller.enqueue(chunk);
          },
        }),
        { status: 200, headers: { "content-type": "text/html", "content-length": "9000000" } },
      );
    const outcome = await fetchPage("https://example.com/", { lookup: publicDns, fetch: send });
    assert.equal(outcome.state === "failed" && outcome.failure, "too-large");
    assert.ok(pulled <= 1, `refused after ${pulled} chunks; the body is not transferred`);
  });

  test("the read is bounded: a stream that never ends is cut off, not drained", async () => {
    // No content-length, so the only thing that can stop this is the counter.
    const chunk = new TextEncoder().encode("y".repeat(64 * 1024));
    let pushed = 0;
    let cancelled = false;
    const send = async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            pushed += 1;
            // Far more than the cap: an unbounded read would never return.
            if (pushed > 10_000) return controller.close();
            controller.enqueue(chunk);
          },
          cancel() {
            cancelled = true;
          },
        }),
        { status: 200, headers: { "content-type": "text/html" } },
      );

    const outcome = await fetchPage("https://example.com/", { lookup: publicDns, fetch: send });
    assert.equal(outcome.state === "failed" && outcome.failure, "too-large");
    const ceiling = Math.ceil(MAX_HTML_BYTES / chunk.byteLength) + 2;
    assert.ok(
      pushed <= ceiling,
      `stopped after ${pushed} chunks, which must be at most ${ceiling}`,
    );
    assert.equal(cancelled, true, "the socket is released rather than left draining");
  });

  test("the cap travels through a redirect, and the redirect rules still hold", async () => {
    const body = pageOf(900_000);
    const { send } = router({
      "https://example.com/": redirect("https://www.example.com/", 308),
      "https://www.example.com/": html(body),
    });
    const outcome = await fetchPage("https://example.com/", {
      lookup: publicDns,
      fetch: send,
      site: "example.com",
    });
    assert.equal(outcome.state, "fetched");
    if (outcome.state !== "fetched") return;
    assert.equal(outcome.url, "https://www.example.com/");
    assert.equal(outcome.body.length, body.length);

    // A large page somewhere else is still off-site, cap or no cap.
    const away = router({
      "https://example.com/": redirect("https://evil-example.com/", 302),
      "https://evil-example.com/": html(body),
    });
    const refused = await fetchPage("https://example.com/", {
      lookup: publicDns,
      fetch: away.send,
      site: "example.com",
    });
    assert.equal(refused.state === "failed" && refused.failure, "redirect-refused");
  });
});
