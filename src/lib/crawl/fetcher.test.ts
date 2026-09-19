import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { fetchPage, fetchRobots } from "@/lib/crawl/fetcher";
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
});
