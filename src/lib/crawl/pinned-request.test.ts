import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { pinnedRequest } from "./pinned-request.ts";
import { isBlockedAddress, pinnedLookup, type ResolvedAddress } from "./network-guard.ts";

/**
 * These are the tests that decide whether this crawler may ever be pointed at
 * a real website. Everything runs against a server on the loopback interface —
 * no external network, no DNS, no real site.
 *
 * The loopback address is one the crawler's real policy refuses — which is a
 * problem for a test that needs to watch where a socket actually goes, since
 * the only server it can reach is on loopback. So these tests pass a narrowed
 * policy that permits 127.0.0.1 and nothing else, and the first test below
 * pins down that the *default* policy still refuses loopback, so the override
 * cannot quietly become the production behaviour. Whether an address ought to
 * be approved at all is `network-guard.test.ts`'s question, with its own
 * fourteen cases.
 */

const LOOPBACK: ResolvedAddress = { address: "127.0.0.1", family: 4 };

type Seen = { host?: string; url?: string; remote?: string };

let server: http.Server;
let port: number;
let seen: Seen[] = [];
let sockets = 0;

before(async () => {
  server = http.createServer((request, response) => {
    seen.push({
      host: request.headers.host,
      url: request.url,
      remote: request.socket.remoteAddress ?? undefined,
    });
    if (request.url === "/empty") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.url === "/notmodified") {
      response.writeHead(304);
      response.end();
      return;
    }
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "/next" });
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<h1>pinned</h1>");
  });
  server.on("connection", () => {
    sockets += 1;
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  port = (server.address() as AddressInfo).port;
});

after(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

/** Permits exactly the loopback address these tests serve from, nothing else. */
const allowLoopback = (address: string, family: 4 | 6): boolean =>
  address === "127.0.0.1" && family === 4 ? false : isBlockedAddress(address, family);

function send(path = "/", host = "pinned.example.test", pin: ResolvedAddress = LOOPBACK) {
  return pinnedRequest(
    `http://${host}:${port}${path}`,
    { method: "GET", headers: { "user-agent": "NexraBot/0.1" }, signal: new AbortController().signal },
    pin,
    { isBlocked: allowLoopback },
  );
}

describe("pinnedRequest", () => {
  test("the default policy refuses loopback, so the test override is not production behaviour", async () => {
    const before = sockets;
    await assert.rejects(
      () =>
        pinnedRequest(
          `http://pinned.example.test:${port}/`,
          { method: "GET", headers: {}, signal: new AbortController().signal },
          LOOPBACK,
        ),
      /refused-unsafe/,
    );
    assert.equal(sockets, before, "no connection may be attempted at all");
  });

  test("connects to the pinned address, not to whatever the name resolves to", async () => {
    // `pinned.example.test` resolves nowhere. If the request reaches the
    // server at all, it can only be because the pin decided the target.
    seen = [];
    const response = await send("/");
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "<h1>pinned</h1>");
    assert.equal(seen[0].remote, "127.0.0.1");
  });

  test("keeps the hostname in the Host header, never the address", async () => {
    seen = [];
    await send("/");
    assert.equal(seen[0].host, `pinned.example.test:${port}`);
    assert.ok(!seen[0].host?.includes("127.0.0.1"));
  });

  test("refuses a pin that is itself a blocked address", async () => {
    // The re-check at the moment of use: even handed directly to the
    // transport, the metadata endpoint never opens a socket.
    const before = sockets;
    await assert.rejects(
      () => send("/", "metadata.example.test", { address: "169.254.169.254", family: 4 }),
      /refused-unsafe/,
    );
    assert.equal(sockets, before, "no connection may be attempted at all");
  });

  test("refuses a scheme that is not http or https", async () => {
    await assert.rejects(
      () =>
        pinnedRequest(
          "file:///etc/passwd",
          { method: "GET", headers: {}, signal: new AbortController().signal },
          LOOPBACK,
          { isBlocked: allowLoopback },
        ),
      /refused-unsafe/,
    );
  });

  test("does not pool connections between requests", async () => {
    const before = sockets;
    await (await send("/")).text();
    await (await send("/")).text();
    assert.equal(sockets - before, 2, "each request must open its own pinned connection");
  });

  test("returns a null body for statuses that may not carry one", async () => {
    // Before this, a 304 from a real origin threw
    // "Invalid response status code" out of the Response constructor.
    for (const [path, status] of [
      ["/empty", 204],
      ["/notmodified", 304],
    ] as const) {
      const response = await send(path);
      assert.equal(response.status, status);
      assert.equal(response.body, null);
    }
  });

  test("surfaces a redirect without following it", async () => {
    const response = await send("/redirect");
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/next");
  });

  test("aborts on signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () =>
        pinnedRequest(
          `http://pinned.example.test:${port}/`,
          { method: "GET", headers: {}, signal: controller.signal },
          LOOPBACK,
          { isBlocked: allowLoopback },
        ),
      (error: Error) => error.name === "AbortError",
    );
  });
});

describe("DNS rebinding", () => {
  test("a resolver that changes its answer cannot move the connection", async () => {
    /*
     * The attack this whole design exists to stop.
     *
     * A hostile resolver answers the validation with a public address and the
     * connection with a private one. Here the resolver is rigged to do exactly
     * that: call one returns the address we approve, and every later call
     * returns the cloud metadata endpoint.
     *
     * The proof is in two parts: the socket went to the approved address, and
     * the resolver was asked exactly once — so there was no second answer for
     * the attacker to poison.
     */
    let calls = 0;
    const rebinding = (): ResolvedAddress => {
      calls += 1;
      return calls === 1 ? LOOPBACK : { address: "169.254.169.254", family: 4 };
    };

    const approved = rebinding(); // the validation step
    assert.equal(calls, 1);

    seen = [];
    const response = await send("/", "rebind.example.test", approved);
    await response.text();

    assert.equal(response.status, 200, "the request reached the approved host");
    assert.equal(seen[0].remote, "127.0.0.1", "the socket used the approved address");
    assert.equal(calls, 1, "the connection never re-resolved, so nothing could rebind it");
  });

  test("pinnedLookup answers only the approved address, in both call shapes", async () => {
    const lookup = pinnedLookup(LOOPBACK, allowLoopback);

    const all = await new Promise((done) =>
      lookup("anything.example.test", { all: true }, (_error, address) => done(address)),
    );
    assert.deepEqual(all, [{ address: "127.0.0.1", family: 4 }]);

    const single = await new Promise((done) =>
      lookup("anything.example.test", {}, (_error, address, family) => done({ address, family })),
    );
    assert.deepEqual(single, { address: "127.0.0.1", family: 4 });
  });

  test("pinnedLookup refuses a blocked pin instead of answering it", async () => {
    const lookup = pinnedLookup({ address: "169.254.169.254", family: 4 });
    const error = await new Promise<Error | null>((done) =>
      lookup("metadata.example.test", { all: true }, (failure) => done(failure)),
    );
    assert.ok(error instanceof Error);
    assert.match(error.message, /refused-unsafe/);
  });
});
