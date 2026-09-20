/**
 * Where this crawler refuses to connect.
 *
 * A crawler takes a URL from a web page and fetches it. That is a
 * server-side request forgery primitive unless every address behind every
 * hostname is checked first, so this module resolves the name and refuses the
 * request if *any* answer lands on a private, loopback, link-local, or
 * otherwise internal address. The cloud metadata endpoint (169.254.169.254) is
 * the specific address that turns a crawler into a credential leak, and it
 * falls inside the link-local range refused below.
 *
 * The resolver is injected so the whole policy is testable without DNS.
 *
 * A check like this is worthless on its own, because the name can be resolved
 * again between the approval and the connection — a hostile resolver answers
 * the check with a public address and the connection with a private one. So
 * the verdict carries a `pin`: the one approved address the connection must
 * use. `pinnedLookup` turns it into the `lookup` function
 * `node:http`/`node:https` accept, which replaces address resolution for that
 * request and is therefore the point where this policy becomes binding rather
 * than advisory. See `./pinned-request`.
 */

import type { LookupFunction } from "node:net";
import { isWithinHostScope } from "./url-policy.ts";

export type ResolvedAddress = { readonly address: string; readonly family: 4 | 6 };

/** Resolves a hostname to every address it answers with. */
export type AddressResolver = (hostname: string) => Promise<readonly ResolvedAddress[]>;

export type GuardVerdict =
  | {
      readonly ok: true;
      readonly addresses: readonly ResolvedAddress[];
      /**
       * The one address the connection must use. Choosing it here rather than
       * letting the socket re-resolve is what closes the gap between approving
       * a name and connecting to it.
       */
      readonly pin: ResolvedAddress;
    }
  | { readonly ok: false; readonly reason: GuardRejection };

export type GuardRejection =
  /** The name did not resolve. */
  | "dns-error"
  /** At least one address is one this crawler will not connect to. */
  | "private-address"
  /** The host is outside the crawl's scope. */
  | "off-scope";

function ipv4ToNumber(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

/** CIDR blocks that must never be fetched, as [first, last] inclusive. */
const BLOCKED_V4: readonly (readonly [string, number])[] = [
  ["0.0.0.0", 8], //            this network
  ["10.0.0.0", 8], //           private
  ["100.64.0.0", 10], //        carrier-grade NAT
  ["127.0.0.0", 8], //          loopback
  ["169.254.0.0", 16], //       link-local — includes 169.254.169.254 metadata
  ["172.16.0.0", 12], //        private
  ["192.0.0.0", 24], //         IETF protocol assignments
  ["192.0.2.0", 24], //         documentation
  ["192.88.99.0", 24], //       6to4 relay anycast
  ["192.168.0.0", 16], //       private
  ["198.18.0.0", 15], //        benchmarking
  ["198.51.100.0", 24], //      documentation
  ["203.0.113.0", 24], //       documentation
  ["224.0.0.0", 4], //          multicast
  ["240.0.0.0", 4], //          reserved, includes 255.255.255.255
];

function isBlockedIpv4(address: string): boolean {
  const value = ipv4ToNumber(address);
  if (value === null) return true; // unparseable: refuse rather than guess
  return BLOCKED_V4.some(([network, bits]) => {
    const base = ipv4ToNumber(network);
    if (base === null) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) >>> 0 === (base & mask) >>> 0;
  });
}

/**
 * Expands an IPv6 literal to its sixteen bytes, or null if it will not parse.
 * Handles `::` compression and the IPv4-mapped tail (`::ffff:10.0.0.1`), which
 * is the form a blocked v4 address takes when it arrives dressed as v6.
 */
function ipv6Bytes(input: string): Uint8Array | null {
  let text = input.trim().toLowerCase();
  if (text.startsWith("[") && text.endsWith("]")) text = text.slice(1, -1);
  const zone = text.indexOf("%");
  if (zone !== -1) text = text.slice(0, zone);

  // An IPv4 tail (`::ffff:10.0.0.1`) is rewritten as the two hex groups it
  // stands for, so the rest of this function has one form to handle and the
  // group count stays 8.
  const lastColon = text.lastIndexOf(":");
  const suffix = lastColon === -1 ? "" : text.slice(lastColon + 1);
  if (suffix.includes(".")) {
    const value = ipv4ToNumber(suffix);
    if (value === null) return null;
    const high = ((value >>> 16) & 0xffff).toString(16);
    const low = (value & 0xffff).toString(16);
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const toGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const groups: number[] = [];
    for (const piece of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(piece)) return null;
      groups.push(Number.parseInt(piece, 16));
    }
    return groups;
  };
  const head = toGroups(halves[0]);
  const rest = halves.length === 2 ? toGroups(halves[1]) : [];
  if (head === null || rest === null) return null;

  const gap = 8 - head.length - rest.length;
  if (halves.length === 1 ? gap !== 0 : gap < 0) return null;
  const groups = [...head, ...Array.from({ length: halves.length === 2 ? gap : 0 }, () => 0), ...rest];

  const bytes = new Uint8Array(16);
  groups.forEach((group, index) => {
    bytes[index * 2] = (group >> 8) & 255;
    bytes[index * 2 + 1] = group & 255;
  });
  return bytes;
}

function isBlockedIpv6(address: string): boolean {
  const bytes = ipv6Bytes(address);
  if (bytes === null) return true; // unparseable: refuse rather than guess

  // An IPv4-mapped (::ffff:a.b.c.d) or IPv4-compatible address is judged by
  // the v4 rules, so a blocked v4 address cannot slip through in v6 clothing.
  const mapped =
    bytes.slice(0, 10).every((byte) => byte === 0) &&
    ((bytes[10] === 0xff && bytes[11] === 0xff) || (bytes[10] === 0 && bytes[11] === 0));
  if (mapped) {
    const v4 = `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
    if (v4 === "0.0.0.0") return true; // also the unspecified address ::
    return isBlockedIpv4(v4);
  }

  if (bytes[0] === 0 && bytes.every((byte) => byte === 0)) return true; // ::
  if (bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1) return true; // ::1
  if ((bytes[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique local
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if (bytes[0] === 0xff) return true; // ff00::/8 multicast
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) {
    return true; // 2001:db8::/32 documentation
  }
  return false;
}

/** Whether this address is one the crawler refuses to connect to. */
export function isBlockedAddress(address: string, family: 4 | 6): boolean {
  return family === 4 ? isBlockedIpv4(address) : isBlockedIpv6(address);
}

/**
 * The default resolver, over the system's DNS.
 *
 * Imported lazily so the pure parts of this module — and the tests over them —
 * never pull in `node:dns`.
 */
export const systemResolver: AddressResolver = async (hostname) => {
  const { lookup } = await import("node:dns/promises");
  const answers = await lookup(hostname, { all: true, verbatim: true });
  return answers.map((answer) => ({
    address: answer.address,
    family: answer.family === 6 ? 6 : 4,
  }));
};

export type GuardOptions = {
  readonly resolve?: AddressResolver;
  /** When set, the host must be within this scope as well as safe. */
  readonly hostScope?: string;
};

/**
 * Whether this URL may be fetched.
 *
 * Called for the start URL and again for every redirect hop, because a
 * redirect is an attacker-controlled way to reach an address the first check
 * approved nothing about.
 */
export async function guardUrl(url: URL, options: GuardOptions = {}): Promise<GuardVerdict> {
  const { resolve = systemResolver, hostScope } = options;

  if (hostScope !== undefined && !isWithinHostScope(url.hostname, hostScope)) {
    return { ok: false, reason: "off-scope" };
  }

  // A literal address in the URL never reaches DNS, so check it directly.
  const literal = url.hostname.startsWith("[")
    ? { address: url.hostname, family: 6 as const }
    : /^\d{1,3}(\.\d{1,3}){3}$/.test(url.hostname)
      ? { address: url.hostname, family: 4 as const }
      : null;
  if (literal !== null) {
    return isBlockedAddress(literal.address, literal.family)
      ? { ok: false, reason: "private-address" }
      : { ok: true, addresses: [literal], pin: literal };
  }

  let addresses: readonly ResolvedAddress[];
  try {
    addresses = await resolve(url.hostname);
  } catch {
    return { ok: false, reason: "dns-error" };
  }
  if (addresses.length === 0) return { ok: false, reason: "dns-error" };

  // Every answer must pass. One private address among several is enough to
  // refuse: we cannot choose which one the connection will use.
  const blocked = addresses.some((entry) => isBlockedAddress(entry.address, entry.family));
  if (blocked) return { ok: false, reason: "private-address" };

  // Every answer passed, so any of them is safe to use; the first is taken so
  // the choice is deterministic and the stored record matches what was dialled.
  return { ok: true, addresses, pin: addresses[0] };
}

/**
 * The `lookup` a pinned request installs.
 *
 * `node:http` and `node:https` pass this straight to `net.connect`, so
 * returning one address here *is* the connection target: no system resolver is
 * consulted and there is no second answer to poison. The address is checked
 * again here, at the moment of use, so no future refactor can route an
 * unchecked address into a socket.
 *
 * Node 22 calls this with `{ all: true }` and expects an array; the
 * three-argument form throws `ERR_INVALID_IP_ADDRESS`. Both shapes are
 * answered, because the option is defined for both.
 */
export function pinnedLookup(
  pin: ResolvedAddress,
  isBlocked: AddressPolicy = isBlockedAddress,
): LookupFunction {
  return (_hostname, options, callback) => {
    if (isBlocked(pin.address, pin.family)) {
      callback(new Error("refused-unsafe"), "", pin.family);
      return;
    }
    if (options.all === true) {
      callback(null, [{ address: pin.address, family: pin.family }]);
      return;
    }
    callback(null, pin.address, pin.family);
  };
}

/**
 * Whether an address is one to refuse.
 *
 * Injected for the same reason the resolver is: the tests that prove a socket
 * goes where it was pinned have to pin it at a loopback address, which the
 * real policy refuses. The default is always the real policy, and a test
 * covers that default refusing loopback — so overriding it is a deliberate act
 * in a test, never a quiet weakening of the production path.
 */
export type AddressPolicy = (address: string, family: 4 | 6) => boolean;

/** The shape `net.connect` expects of a `lookup` option, as Node defines it. */
export type { LookupFunction };
