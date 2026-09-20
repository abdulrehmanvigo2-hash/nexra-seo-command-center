/**
 * One HTTP request, connected to an address that was already approved.
 *
 * This is where the address policy in `./network-guard` stops being advisory.
 * The global `fetch` gives no way to say which address a request may connect
 * to: it takes a URL, resolves the hostname itself, and connects to whatever
 * comes back — which may not be what was approved a moment earlier. That gap
 * (validate, then re-resolve) is the DNS-rebinding hole, and no amount of
 * checking beforehand closes it.
 *
 * `node:http` and `node:https` do give us that say. Their `lookup` option is
 * handed straight to `net.connect`, so supplying our own replaces address
 * resolution for the request: the socket goes to the approved address and the
 * system resolver is never consulted. Node's bundled `undici` would also work
 * through a custom dispatcher, but it is not reachable from any builtin
 * module, so using it would mean a dependency for something the platform
 * already does.
 *
 * What is deliberately *not* changed is the hostname. `host` stays the name
 * from the URL, so the `Host` header, the TLS SNI extension, and certificate
 * hostname verification all still work against the name — only the address
 * lookup is replaced. `rejectUnauthorized` is left at its default, there is no
 * custom `checkServerIdentity`, and `servername` is never set to an address.
 * A certificate that does not cover the hostname is still refused.
 */

import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import {
  isBlockedAddress,
  pinnedLookup,
  type AddressPolicy,
  type ResolvedAddress,
} from "./network-guard.ts";

/**
 * Statuses that may not carry a body.
 *
 * The `Response` constructor throws `TypeError: Invalid response status code`
 * if one is given a body, so a 304 from a real origin would otherwise crash
 * the fetch rather than being reported as a reading.
 */
const NULL_BODY_STATUSES: readonly number[] = [101, 204, 205, 304];

export type PinnedRequestInit = {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
};

export type PinnedRequestOptions = {
  /**
   * Which addresses to refuse. Defaults to the crawler's real policy; a test
   * overrides it to pin at a loopback address the real policy rejects.
   */
  readonly isBlocked?: AddressPolicy;
};

/**
 * Sends one request to `url`, connected only to `pin`.
 *
 * Returns a standard `Response` so callers — and the tests that fake this —
 * work in the same shape as `fetch`. Redirects are never followed here: the
 * caller re-validates and re-pins each hop itself, because a redirect is an
 * attacker-controlled way to reach an address nothing has approved.
 */
export function pinnedRequest(
  url: string,
  init: PinnedRequestInit,
  pin: ResolvedAddress,
  options: PinnedRequestOptions = {},
): Promise<Response> {
  const { isBlocked = isBlockedAddress } = options;
  return new Promise((resolve, reject) => {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      reject(new Error("refused-unsafe"));
      return;
    }

    // Checked again at the moment of use. `pinnedLookup` checks it once more
    // inside the socket callback; both are cheap, and together they mean no
    // refactor can route an unchecked address into a connection.
    if (isBlocked(pin.address, pin.family)) {
      reject(new Error("refused-unsafe"));
      return;
    }

    const secure = target.protocol === "https:";
    if (!secure && target.protocol !== "http:") {
      reject(new Error("refused-unsafe"));
      return;
    }

    // Checked before the request exists: destroying one that has no error
    // handler yet raises the abort as an uncaught exception instead.
    if (init.signal?.aborted === true) {
      reject(new DOMException("The operation was aborted.", "AbortError"));
      return;
    }

    const transport = secure ? https : http;
    const request = transport.request({
      // The hostname, not the address: this is what the Host header carries,
      // what SNI announces, and what the certificate is checked against.
      host: target.hostname,
      servername: secure ? target.hostname : undefined,
      port: target.port !== "" ? Number(target.port) : secure ? 443 : 80,
      path: `${target.pathname}${target.search}`,
      method: init.method ?? "GET",
      headers: init.headers ?? {},
      // The pin. Node asks this instead of the system resolver.
      lookup: pinnedLookup(pin, isBlocked),
      // No pooling. The default agent keys sockets by host and port, so a
      // reused socket could outlive the pin that opened it; a fresh connection
      // per request costs little at this crawler's concurrency and removes the
      // question entirely.
      agent: false,
      // Redirects are the caller's to validate, one hop at a time.
      setHost: true,
    });

    const signal = init.signal;
    const abort = (): void => {
      request.destroy(new DOMException("The operation was aborted.", "AbortError"));
    };
    const release = (): void => {
      signal?.removeEventListener("abort", abort);
    };
    signal?.addEventListener("abort", abort, { once: true });

    request.on("response", (message) => {
      release();
      const status = message.statusCode ?? 0;
      const headers = new Headers();
      for (const [name, value] of Object.entries(message.headers)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) for (const entry of value) headers.append(name, entry);
        else headers.set(name, value);
      }

      const empty = NULL_BODY_STATUSES.includes(status);
      if (empty) message.resume(); // drain, so the socket can close

      // `Response` rejects a status below 200, which no response callback
      // should carry; treat one as a connection that did not produce a reading.
      if (status < 200 || status > 599) {
        reject(new Error("connection-error"));
        return;
      }

      resolve(
        new Response(empty ? null : (Readable.toWeb(message) as ReadableStream<Uint8Array>), {
          status,
          headers,
        }),
      );
    });

    request.on("error", (error) => {
      release();
      reject(error);
    });

    request.end();
  });
}
